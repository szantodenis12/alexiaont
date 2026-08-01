import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { doc, runTransaction } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase/config';
import { applyWatermark } from '../utils/watermarkProcessor';

export interface PhotoItem {
  name: string;
  url: string;
  path: string;
  width?: number;
  height?: number;
  cleanUrl?: string;
  cleanPath?: string;
}

export interface ProgressItem {
  name: string;
  progress: number;
  status: string;
}

export interface UploadJob {
  jobKey: string;        // unique key = galleryId + ':' + subId
  galleryId: string;
  subId: string;
  filesTotal: number;
  filesUploaded: number;
  isFinished: boolean;
  progressMap: Record<string, ProgressItem>;
}

interface UploadContextType {
  // Legacy single-job fields kept for backward compatibility with PhotoGalleryCreator
  galleryId: string | null;
  activeSubId: string | null;
  filesTotal: number;
  filesUploaded: number;
  isUploading: boolean;
  progressMap: Record<string, ProgressItem>;
  // All active jobs (for BackgroundUploadBar)
  jobs: UploadJob[];
  startUpload: (
    filesArray: File[],
    targetGalleryId: string,
    targetSubId: string,
    watermarkEnabled: boolean,
    globalWatermark: any | null,
    watermarkPosition: 'center' | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'bottom-center' | 'tile' | null,
    watermarkOffsetX: number,
    watermarkOffsetY: number
  ) => Promise<void>;
  onPhotoUploaded: (galleryId: string, callback: (photo: PhotoItem) => void) => () => void;
  resetUploadState: () => void;
  dismissJob: (jobKey: string) => void;
}

const UploadContext = createContext<UploadContextType | undefined>(undefined);

export const useUpload = () => {
  const context = useContext(UploadContext);
  if (!context) {
    throw new Error('useUpload must be used within an UploadProvider');
  }
  return context;
};

export const UploadProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Multi-job state: map from jobKey -> UploadJob
  const [jobs, setJobs] = useState<Record<string, UploadJob>>({});

  // Store listeners for real-time photo addition callbacks
  const listenersRef = useRef<Record<string, ((photo: PhotoItem) => void)[]>>({});

  const onPhotoUploaded = useCallback((targetGalleryId: string, callback: (photo: PhotoItem) => void) => {
    const current = listenersRef.current[targetGalleryId] || [];
    listenersRef.current[targetGalleryId] = [...current, callback];

    return () => {
      const current = listenersRef.current[targetGalleryId] || [];
      listenersRef.current[targetGalleryId] = current.filter(cb => cb !== callback);
    };
  }, []);

  // Dismiss a finished job (close its tile in the bar)
  const dismissJob = useCallback((jobKey: string) => {
    setJobs(prev => {
      const next = { ...prev };
      delete next[jobKey];
      return next;
    });
  }, []);

  // Legacy resetUploadState — dismisses all finished jobs
  const resetUploadState = useCallback(() => {
    setJobs(prev => {
      const next: Record<string, UploadJob> = {};
      Object.values(prev).forEach(job => {
        if (!job.isFinished) next[job.jobKey] = job;
      });
      return next;
    });
  }, []);

  const updateFirestoreGalleryPhotos = async (targetGalleryId: string, targetSubId: string, newPhotos: PhotoItem[]) => {
    const galleryRef = doc(db, 'photo_galleries', targetGalleryId);
    try {
      await runTransaction(db, async (transaction) => {
        const sfDoc = await transaction.get(galleryRef);
        if (!sfDoc.exists()) return;

        const data = sfDoc.data();
        const subCollections = data.subCollections || [];

        const updatedSubCollections = subCollections.map((sub: any) => {
          if (sub.id === targetSubId) {
            const existingPhotos = sub.photos || [];
            const combined = [...existingPhotos];

            newPhotos.forEach(p => {
              if (!combined.some(existing => existing.path === p.path)) {
                combined.push(p);
              }
            });

            const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
            combined.sort((a, b) => collator.compare(a.name, b.name));
            return { ...sub, photos: combined };
          }
          return sub;
        });

        transaction.update(galleryRef, { subCollections: updatedSubCollections });
      });
    } catch (e) {
      console.error("Failed to update firestore photos in transaction:", e);
    }
  };

  const startUpload = useCallback(async (
    filesArray: File[],
    targetGalleryId: string,
    targetSubId: string,
    watermarkEnabled: boolean,
    globalWatermark: any | null,
    watermarkPosition: 'center' | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'bottom-center' | 'tile' | null,
    watermarkOffsetX: number,
    watermarkOffsetY: number
  ) => {
    const jobKey = `${targetGalleryId}:${targetSubId}`;

    // If a job for this exact folder is already running, queue files on top of it
    // by simply appending. We achieve this by checking if the job exists and is not finished.
    // For simplicity and robustness: always start a fresh job entry merging progress.
    const initialProgressMap: Record<string, ProgressItem> = {};
    filesArray.forEach(file => {
      initialProgressMap[file.name] = {
        name: file.name,
        progress: 0,
        status: 'Pregătire...'
      };
    });

    // Create / reset job entry
    setJobs(prev => ({
      ...prev,
      [jobKey]: {
        jobKey,
        galleryId: targetGalleryId,
        subId: targetSubId,
        filesTotal: (prev[jobKey]?.isFinished === false ? prev[jobKey].filesTotal : 0) + filesArray.length,
        filesUploaded: prev[jobKey]?.isFinished === false ? prev[jobKey].filesUploaded : 0,
        isFinished: false,
        progressMap: {
          ...(prev[jobKey]?.isFinished === false ? prev[jobKey].progressMap : {}),
          ...initialProgressMap
        }
      }
    }));

    const yieldToMain = () => new Promise(resolve => setTimeout(resolve, 60));
    const BATCH_SIZE = 2;

    const processOne = async (file: File) => {
      try {
        await yieldToMain();
        const imgDims = await new Promise<{ width: number, height: number }>((resolveDim) => {
          const imgObj = new Image();
          imgObj.src = URL.createObjectURL(file);
          imgObj.onload = () => {
            resolveDim({ width: imgObj.naturalWidth, height: imgObj.naturalHeight });
            URL.revokeObjectURL(imgObj.src);
          };
          imgObj.onerror = () => {
            resolveDim({ width: 2000, height: 1333 });
            URL.revokeObjectURL(imgObj.src);
          };
        });

        setJobs(prev => {
          const job = prev[jobKey];
          if (!job) return prev;
          return {
            ...prev,
            [jobKey]: {
              ...job,
              progressMap: {
                ...job.progressMap,
                [file.name]: {
                  ...job.progressMap[file.name],
                  status: watermarkEnabled ? 'Aplicare watermark...' : 'Optimizare...'
                }
              }
            }
          };
        });

        await yieldToMain();

        let cleanBlob: Blob = file;
        let wmBlob: Blob | null = null;

        try {
          cleanBlob = await applyWatermark(
            file,
            null,
            watermarkPosition,
            watermarkOffsetX,
            watermarkOffsetY,
            4096,
            0.92
          );

          await yieldToMain();

          if (watermarkEnabled && globalWatermark) {
            wmBlob = await applyWatermark(
              file,
              globalWatermark.url,
              watermarkPosition,
              watermarkOffsetX,
              watermarkOffsetY
            );
            await yieldToMain();
          }
        } catch (wmErr) {
          console.error('Failed to optimize and compress file:', file.name, wmErr);
          throw new Error('Eroare la optimizarea imaginii.');
        }

        const cleanStoragePath = `galleries/${targetGalleryId}/${targetSubId}/clean_${Date.now()}_${file.name}`;
        const cleanStorageRef = ref(storage, cleanStoragePath);

        const uploadTasks: Promise<any>[] = [
          uploadBytesResumable(cleanStorageRef, cleanBlob).then(async (snap) => {
            const cleanUrl = await getDownloadURL(snap.ref);
            return { cleanUrl, cleanPath: cleanStoragePath };
          })
        ];

        let wmStoragePath = '';
        if (wmBlob) {
          wmStoragePath = `galleries/${targetGalleryId}/${targetSubId}/wm_${Date.now()}_${file.name}`;
          const wmStorageRef = ref(storage, wmStoragePath);
          uploadTasks.push(
            uploadBytesResumable(wmStorageRef, wmBlob).then(async (snap) => {
              const wmUrl = await getDownloadURL(snap.ref);
              return { wmUrl, wmPath: wmStoragePath };
            })
          );
        }

        setJobs(prev => {
          const job = prev[jobKey];
          if (!job) return prev;
          return {
            ...prev,
            [jobKey]: {
              ...job,
              progressMap: {
                ...job.progressMap,
                [file.name]: { ...job.progressMap[file.name], progress: 20, status: 'Încărcare...' }
              }
            }
          };
        });

        try {
          const results = await Promise.all(uploadTasks);
          const cleanResult = results[0] as { cleanUrl: string; cleanPath: string };
          const wmResult = results[1] as { wmUrl: string; wmPath: string } | undefined;

          const finalUrl = wmResult ? wmResult.wmUrl : cleanResult.cleanUrl;
          const finalPath = wmResult ? wmResult.wmPath : cleanResult.cleanPath;

          const newItem: PhotoItem = {
            name: file.name,
            url: finalUrl,
            path: finalPath,
            cleanUrl: cleanResult.cleanUrl,
            cleanPath: cleanResult.cleanPath,
            width: imgDims.width,
            height: imgDims.height
          };

          // Update Firestore immediately
          await updateFirestoreGalleryPhotos(targetGalleryId, targetSubId, [newItem]);

          // Trigger listener
          if (listenersRef.current[targetGalleryId]) {
            listenersRef.current[targetGalleryId].forEach(cb => cb(newItem));
          }

          setJobs(prev => {
            const job = prev[jobKey];
            if (!job) return prev;
            const newUploaded = job.filesUploaded + 1;
            const isFinished = newUploaded >= job.filesTotal;
            return {
              ...prev,
              [jobKey]: {
                ...job,
                filesUploaded: newUploaded,
                isFinished,
                progressMap: {
                  ...job.progressMap,
                  [file.name]: { ...job.progressMap[file.name], progress: 100, status: 'Finalizat' }
                }
              }
            };
          });

        } catch (uploadErr) {
          console.error('Upload task failed:', uploadErr);
          throw new Error('Eroare la încărcarea fișierelor.');
        }
      } catch (err: any) {
        console.error('Error uploading photo:', file.name, err);
        setJobs(prev => {
          const job = prev[jobKey];
          if (!job) return prev;
          return {
            ...prev,
            [jobKey]: {
              ...job,
              progressMap: {
                ...job.progressMap,
                [file.name]: { ...job.progressMap[file.name], status: `Eroare: ${err.message || 'Necunoscută'}` }
              }
            }
          };
        });
      }
    };

    for (let i = 0; i < filesArray.length; i += BATCH_SIZE) {
      const batch = filesArray.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(processOne));
      await yieldToMain();
    }

    // Mark job as finished (in case filesUploaded count hasn't caught up due to errors)
    setJobs(prev => {
      const job = prev[jobKey];
      if (!job) return prev;
      return {
        ...prev,
        [jobKey]: { ...job, isFinished: true }
      };
    });

  }, []);

  // ---- Legacy single-job derived values (used by PhotoGalleryCreator) ----
  // We expose the most-recent active job's values for backward compat.
  const jobsArr = Object.values(jobs);
  const activeJobs = jobsArr.filter(j => !j.isFinished);
  const lastActiveJob = activeJobs[activeJobs.length - 1] ?? jobsArr[jobsArr.length - 1] ?? null;

  const legacyGalleryId = lastActiveJob?.galleryId ?? null;
  const legacyActiveSubId = lastActiveJob?.subId ?? null;
  const legacyFilesTotal = lastActiveJob?.filesTotal ?? 0;
  const legacyFilesUploaded = lastActiveJob?.filesUploaded ?? 0;
  const legacyIsUploading = activeJobs.length > 0;
  const legacyProgressMap = lastActiveJob?.progressMap ?? {};

  return (
    <UploadContext.Provider value={{
      galleryId: legacyGalleryId,
      activeSubId: legacyActiveSubId,
      filesTotal: legacyFilesTotal,
      filesUploaded: legacyFilesUploaded,
      isUploading: legacyIsUploading,
      progressMap: legacyProgressMap,
      jobs: jobsArr,
      startUpload,
      onPhotoUploaded,
      resetUploadState,
      dismissJob,
    }}>
      {children}
    </UploadContext.Provider>
  );
};

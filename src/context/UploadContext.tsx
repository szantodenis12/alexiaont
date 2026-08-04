import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { collection, addDoc, writeBatch, getDocs, doc } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '../firebase/config';
import { applyWatermark } from '../utils/watermarkProcessor';

export interface PhotoItem {
  firestoreId?: string;  // Firestore document ID in the subcollection
  name: string;
  url: string;
  path: string;
  width?: number;
  height?: number;
  cleanUrl?: string;
  cleanPath?: string;
  order?: number;        // explicit order when drag-reordered by admin
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
  isCancelling?: boolean;
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
  cancelUpload: (jobKey: string) => Promise<void>;
  onPhotoUploaded: (galleryId: string, callback: (photo: PhotoItem, subId: string) => void) => () => void;
  onPhotosDeleted: (galleryId: string, callback: (deletedIds: string[], subId: string) => void) => () => void;
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

  // Store listeners for real-time photo addition and deletion callbacks
  const listenersRef = useRef<Record<string, ((photo: PhotoItem, subId: string) => void)[]>>({});
  const deleteListenersRef = useRef<Record<string, ((deletedIds: string[], subId: string) => void)[]>>({});

  // Tracking cancelled job keys and uploaded items per job
  const cancelledJobKeysRef = useRef<Set<string>>(new Set());
  const uploadedPhotosMapRef = useRef<Record<string, { photo: PhotoItem; galleryId: string; subId: string }[]>>({});

  const onPhotoUploaded = useCallback((targetGalleryId: string, callback: (photo: PhotoItem, subId: string) => void) => {
    const current = listenersRef.current[targetGalleryId] || [];
    listenersRef.current[targetGalleryId] = [...current, callback];

    return () => {
      const current = listenersRef.current[targetGalleryId] || [];
      listenersRef.current[targetGalleryId] = current.filter(cb => cb !== callback);
    };
  }, []);

  const onPhotosDeleted = useCallback((targetGalleryId: string, callback: (deletedIds: string[], subId: string) => void) => {
    const current = deleteListenersRef.current[targetGalleryId] || [];
    deleteListenersRef.current[targetGalleryId] = [...current, callback];

    return () => {
      const current = deleteListenersRef.current[targetGalleryId] || [];
      deleteListenersRef.current[targetGalleryId] = current.filter(cb => cb !== callback);
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

  const updateFirestoreGalleryPhotos = async (
    targetGalleryId: string,
    targetSubId: string,
    newPhotos: PhotoItem[]
  ): Promise<string[]> => {
    // Each photo gets its own small document in a subcollection.
    // This completely bypasses the 1MB Firestore document size limit.
    const firestoreIds: string[] = [];
    try {
      const photosCol = collection(
        db,
        'photo_galleries', targetGalleryId,
        'subcollections', targetSubId,
        'photos'
      );
      for (const photo of newPhotos) {
        const docRef = await addDoc(photosCol, {
          name: photo.name,
          url: photo.url,
          path: photo.path,
          cleanUrl: photo.cleanUrl || null,
          cleanPath: photo.cleanPath || null,
          width: photo.width || null,
          height: photo.height || null,
          order: null,  // null = sort by name; set to integer when drag-reordered
        });
        firestoreIds.push(docRef.id);

        // After adding, update photoCount on the subcollection metadata (stored in main doc)
        // This is done via a separate lightweight batch — see reorderPhotosInSubcollection
      }
    } catch (e) {
      console.error('Failed to add photo to Firestore subcollection:', e);
    }
    return firestoreIds;
  };

  // Re-sort all photos in a subcollection by name and write order 0,1,2... in a batch.
  // Called after a file batch completes to maintain name-sorted order.
  const reorderPhotosByName = async (targetGalleryId: string, targetSubId: string) => {
    try {
      const photosCol = collection(
        db,
        'photo_galleries', targetGalleryId,
        'subcollections', targetSubId,
        'photos'
      );
      const snap = await getDocs(photosCol);
      if (snap.empty) return;

      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() as any }));
      // Only sort by name if none have been manually reordered (order === null)
      const hasManualOrder = docs.some(d => d.order !== null && d.order !== undefined);
      if (hasManualOrder) return; // Admin has custom order, don't override

      const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
      docs.sort((a, b) => collator.compare(a.name, b.name));

      // Write in batches of 499 (Firestore batch limit is 500)
      const BATCH_LIMIT = 499;
      for (let i = 0; i < docs.length; i += BATCH_LIMIT) {
        const batch = writeBatch(db);
        const chunk = docs.slice(i, i + BATCH_LIMIT);
        chunk.forEach((d, idx) => {
          const photoRef = snap.docs.find(sd => sd.id === d.id)!.ref;
          batch.update(photoRef, { order: i + idx });
        });
        await batch.commit();
      }
    } catch (e) {
      console.error('Failed to reorder photos by name:', e);
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
    cancelledJobKeysRef.current.delete(jobKey);
    if (!uploadedPhotosMapRef.current[jobKey]) {
      uploadedPhotosMapRef.current[jobKey] = [];
    }

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

        const uploadWithRetry = async (taskFn: () => Promise<any>, maxRetries = 3) => {
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
              return await taskFn();
            } catch (err) {
              if (cancelledJobKeysRef.current.has(jobKey)) throw err;
              if (attempt === maxRetries) throw err;
              console.warn(`[Upload Retry] Attempt ${attempt} failed for ${file.name}. Retrying in ${attempt * 1000}ms...`);
              await new Promise(r => setTimeout(r, attempt * 1000));
            }
          }
        };

        try {
          if (cancelledJobKeysRef.current.has(jobKey)) {
            return;
          }

          const results = await Promise.all([
            uploadWithRetry(() => uploadTasks[0]),
            uploadTasks.length > 1 ? uploadWithRetry(() => uploadTasks[1]) : Promise.resolve(undefined)
          ]);
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

          // If cancelled right before database write, delete storage files and abort
          if (cancelledJobKeysRef.current.has(jobKey)) {
            if (cleanResult.cleanPath) await deleteObject(ref(storage, cleanResult.cleanPath)).catch(() => {});
            if (wmResult?.wmPath) await deleteObject(ref(storage, wmResult.wmPath)).catch(() => {});
            return;
          }

          // Update Firestore immediately — writes to subcollection
          const [firestoreId] = await updateFirestoreGalleryPhotos(targetGalleryId, targetSubId, [newItem]);
          const newItemWithId: PhotoItem = { ...newItem, firestoreId };

          // Record for potential batch cancellation
          if (!uploadedPhotosMapRef.current[jobKey]) {
            uploadedPhotosMapRef.current[jobKey] = [];
          }
          uploadedPhotosMapRef.current[jobKey].push({ photo: newItemWithId, galleryId: targetGalleryId, subId: targetSubId });

          // Trigger listener (includes firestoreId and targetSubId so UI updates correct folder)
          if (listenersRef.current[targetGalleryId] && !cancelledJobKeysRef.current.has(jobKey)) {
            listenersRef.current[targetGalleryId].forEach(cb => cb(newItemWithId, targetSubId));
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
      if (cancelledJobKeysRef.current.has(jobKey)) {
        console.log(`[Upload] Job ${jobKey} was cancelled. Aborting loop.`);
        break;
      }
      const batch = filesArray.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(processOne));
      await yieldToMain();
    }

    // After all uploads for this batch complete, re-sort photos by name in Firestore
    // (only if admin hasn't applied a custom drag-reorder)
    await reorderPhotosByName(targetGalleryId, targetSubId);

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

  // Cancel an active upload job and clean up all files/docs uploaded so far
  const cancelUpload = useCallback(async (jobKeyToCancel: string) => {
    cancelledJobKeysRef.current.add(jobKeyToCancel);

    // Mark job status as cancelling
    setJobs(prev => {
      const job = prev[jobKeyToCancel];
      if (!job) return prev;
      return {
        ...prev,
        [jobKeyToCancel]: { ...job, isCancelling: true }
      };
    });

    const uploadedList = uploadedPhotosMapRef.current[jobKeyToCancel] || [];
    if (uploadedList.length > 0) {
      const targetGalleryId = uploadedList[0].galleryId;
      const targetSubId = uploadedList[0].subId;
      const deletedIds: string[] = [];

      // Delete Firestore documents
      try {
        const batch = writeBatch(db);
        for (const item of uploadedList) {
          const p = item.photo;
          const idToDelete = p.firestoreId || p.path;
          deletedIds.push(idToDelete);

          if (p.firestoreId) {
            const pRef = doc(db, 'photo_galleries', targetGalleryId, 'subcollections', targetSubId, 'photos', p.firestoreId);
            batch.delete(pRef);
          }
        }
        await batch.commit();
      } catch (fsErr) {
        console.error('Error deleting cancelled photo documents from Firestore:', fsErr);
      }

      // Delete Storage files
      await Promise.all(
        uploadedList.flatMap(item => {
          const p = item.photo;
          const promises: Promise<any>[] = [];
          if (p.cleanPath) {
            promises.push(deleteObject(ref(storage, p.cleanPath)).catch(() => {}));
          }
          if (p.path && p.path !== p.cleanPath) {
            promises.push(deleteObject(ref(storage, p.path)).catch(() => {}));
          }
          return promises;
        })
      );

      // Notify UI listeners to purge deleted photo IDs
      if (deleteListenersRef.current[targetGalleryId]) {
        deleteListenersRef.current[targetGalleryId].forEach(cb => cb(deletedIds, targetSubId));
      }
    }

    // Purge job state
    delete uploadedPhotosMapRef.current[jobKeyToCancel];
    setJobs(prev => {
      const copy = { ...prev };
      delete copy[jobKeyToCancel];
      return copy;
    });
  }, []);

  // Legacy single-job derived values (used by PhotoGalleryCreator)
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
      cancelUpload,
      onPhotoUploaded,
      onPhotosDeleted,
      resetUploadState,
      dismissJob,
    }}>
      {children}
    </UploadContext.Provider>
  );
};

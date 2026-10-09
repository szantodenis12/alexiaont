import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { collection, addDoc, writeBatch, getDocs, doc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '../firebase/config';
import { applyWatermark } from '../utils/watermarkProcessor';
import { addClassPhoto, ensureClassMigrated, classPhotosCol, computeUploadFolders } from '../utils/classPhotos';
import type { ClassPhoto } from '../utils/classPhotos';
import { IMMUTABLE_FILE_METADATA } from '../utils/storageCache';

export interface PhotoItem {
  firestoreId?: string;  // Firestore document ID in the subcollection
  name: string;
  url: string;           // full-res (watermarked if enabled, else clean) — for download & lightbox
  path: string;
  width?: number;
  height?: number;
  cleanUrl?: string;     // full-res clean (no watermark) — for download & admin
  cleanPath?: string;
  previewUrl?: string;       // compressed ~1200px (watermarked if enabled) — for web grid display
  previewPath?: string;
  previewCleanUrl?: string;  // compressed ~1200px clean — for web grid (admin/clean mode)
  previewCleanPath?: string;
  thumbUrl?: string;         // ~600px copy — what phones load in the grid
  thumbPath?: string;
  order?: number;        // explicit order when drag-reordered by admin
  isVideo?: boolean;     // true for video items
  videoUrl?: string;     // Firebase Storage URL of the video file
  videoPath?: string;    // Firebase Storage path of the video (for deletion)
}

export interface ProgressItem {
  name: string;
  progress: number;
  status: string;
}

export interface UploadJob {
  jobKey: string;        // gallery: galleryId + ':' + subId — class: 'class:' + classId
  kind: 'gallery' | 'class';
  label?: string;        // shown in the upload bar so several concurrent jobs are tellable apart
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
    watermarkOffsetY: number,
    // Optional: file name -> existing photo doc ids in the target folder that the
    // new file should REPLACE (the "Suprascrie" choice in the duplicate dialog).
    overwriteTargets?: Record<string, string[]>
  ) => Promise<void>;
  startClassUpload: (
    filesArray: File[],
    classId: string,
    className: string,
    watermarkEnabled: boolean,
    watermarkUrl: string | null,
    watermarkPosition: 'center' | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'bottom-center' | 'tile' | null,
    watermarkOffsetX: number,
    watermarkOffsetY: number,
    // Optional photo session ("ședință") the files go into; omitted = main.
    sessionId?: string
  ) => Promise<void>;
  cancelUpload: (jobKey: string) => Promise<void>;
  onClassPhotoUploaded: (classId: string, callback: (photo: ClassPhoto) => void) => () => void;
  onPhotoUploaded: (galleryId: string, callback: (photo: PhotoItem, subId: string) => void) => () => void;
  onPhotosDeleted: (galleryId: string, callback: (deletedIds: string[], subId: string) => void) => () => void;
  resetUploadState: () => void;
  dismissJob: (jobKey: string) => void;
  forceReorderByName: (targetGalleryId: string, targetSubId: string) => Promise<void>;
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
  // Separate registry for class albums — lets the dashboard append photos live
  // while the background job runs.
  const classListenersRef = useRef<Record<string, ((photo: ClassPhoto) => void)[]>>({});

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

  const onClassPhotoUploaded = useCallback((classId: string, callback: (photo: ClassPhoto) => void) => {
    const current = classListenersRef.current[classId] || [];
    classListenersRef.current[classId] = [...current, callback];

    return () => {
      const list = classListenersRef.current[classId] || [];
      classListenersRef.current[classId] = list.filter(cb => cb !== callback);
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
          previewUrl: photo.previewUrl || null,
          previewPath: photo.previewPath || null,
          previewCleanUrl: photo.previewCleanUrl || null,
          previewCleanPath: photo.previewCleanPath || null,
          thumbUrl: photo.thumbUrl || null,
          thumbPath: photo.thumbPath || null,
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

  /**
   * "Suprascrie": point an existing photo document at the freshly uploaded
   * files instead of adding a new one.
   *
   * - Runs only AFTER the new files are fully in Storage, so a failed upload
   *   leaves the old photo untouched.
   * - Keeps the document id and its `order`, so the photo stays in the same
   *   place in manually ordered folders.
   * - Does NOT delete the old Storage files: client selections and the gallery
   *   cover keep their own copies of the old URLs, and deleting them would break
   *   those. The old files simply stop being shown in the gallery.
   * - If the folder held several photos with this name (an earlier "upload all"),
   *   the extra documents are removed so exactly one remains.
   *
   * Returns the id of the document now holding the photo, or undefined if the
   * replacement failed (the caller then falls back to adding it).
   */
  const overwriteGalleryPhoto = async (
    targetGalleryId: string,
    targetSubId: string,
    targetIds: string[],
    photo: PhotoItem
  ): Promise<string | undefined> => {
    const [keepId, ...extraIds] = targetIds;
    const photoRef = (id: string) => doc(db, 'photo_galleries', targetGalleryId, 'subcollections', targetSubId, 'photos', id);
    try {
      await updateDoc(photoRef(keepId), {
        name: photo.name,
        url: photo.url,
        path: photo.path,
        cleanUrl: photo.cleanUrl || null,
        cleanPath: photo.cleanPath || null,
        previewUrl: photo.previewUrl || null,
        previewPath: photo.previewPath || null,
        previewCleanUrl: photo.previewCleanUrl || null,
        previewCleanPath: photo.previewCleanPath || null,
        thumbUrl: photo.thumbUrl || null,
        thumbPath: photo.thumbPath || null,
        width: photo.width || null,
        height: photo.height || null,
        // `order` deliberately untouched — the photo keeps its position.
      });
    } catch (e) {
      console.warn('[Overwrite] Could not update existing photo, will add instead:', photo.name, e);
      return undefined;
    }

    if (extraIds.length > 0) {
      await Promise.all(extraIds.map(id => deleteDoc(photoRef(id)).catch(() => {})));
      (deleteListenersRef.current[targetGalleryId] || []).forEach(cb => cb(extraIds, targetSubId));
    }
    return keepId;
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
      const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

      // Check if admin has set a manual drag order (any photo has a non-null order)
      const hasManualOrder = docs.some(d => d.order !== null && d.order !== undefined);

      if (hasManualOrder) {
        // Gallery has a custom order — only handle NEW uploads that still have order:null.
        // Assign them order values starting from maxExistingOrder+1 so they appear
        // neatly at the END of the gallery rather than floating randomly.
        const nullOrderDocs = docs.filter(d => d.order === null || d.order === undefined);
        if (nullOrderDocs.length === 0) return; // nothing to do

        const maxOrder = docs.reduce((max, d) => {
          const v = (d.order !== null && d.order !== undefined) ? d.order as number : -1;
          return Math.max(max, v);
        }, -1);

        // Sort new photos by name so their appended order is deterministic
        nullOrderDocs.sort((a, b) => collator.compare(a.name, b.name));

        const BATCH_LIMIT = 499;
        for (let i = 0; i < nullOrderDocs.length; i += BATCH_LIMIT) {
          const batch = writeBatch(db);
          nullOrderDocs.slice(i, i + BATCH_LIMIT).forEach((d, idx) => {
            const photoRef = snap.docs.find(sd => sd.id === d.id)!.ref;
            batch.update(photoRef, { order: maxOrder + 1 + i + idx });
          });
          await batch.commit();
        }
      } else {
        // No manual ordering yet — sort everything by name and write 0,1,2,...
        docs.sort((a, b) => collator.compare(a.name, b.name));

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
      }
    } catch (e) {
      console.error('Failed to reorder photos by name:', e);
    }
  };

  // Explicitly force A-Z sort by name for all photos in a subcollection, writing order: 0, 1, 2...
  const forceReorderByName = async (targetGalleryId: string, targetSubId: string) => {
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
      const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
      docs.sort((a, b) => collator.compare(a.name, b.name));

      const BATCH_LIMIT = 499;
      for (let i = 0; i < docs.length; i += BATCH_LIMIT) {
        const batch = writeBatch(db);
        const chunk = docs.slice(i, i + BATCH_LIMIT);
        chunk.forEach((d, idx) => {
          const photoRef = snap.docs.find(sd => sd.id === d.id)!.ref;
          batch.set(photoRef, { order: i + idx }, { merge: true });
        });
        await batch.commit();
      }
    } catch (e) {
      console.error('Failed to force reorder photos by name:', e);
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
    watermarkOffsetY: number,
    overwriteTargets?: Record<string, string[]>
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
        kind: 'gallery',
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
        let previewCleanBlob: Blob | null = null;
        let previewWmBlob: Blob | null = null;
        let thumbBlob: Blob | null = null;

        // Archive copy: the original file, byte-for-byte. No canvas, so no
        // re-encode and no downscale — EXIF and colour profile survive, which
        // is what the photographer needs for editing and print.
        cleanBlob = file;

        // Display copy — always produced, watermarked when enabled and simply
        // size-capped when not. Kept separate from the archive copy so what
        // clients load never depends on how large the original happens to be.
        try {
          wmBlob = await applyWatermark(
            file,
            watermarkEnabled && globalWatermark ? globalWatermark.url : null,
            watermarkPosition,
            watermarkOffsetX,
            watermarkOffsetY,
            4096,
            0.92
          );
          await yieldToMain();
        } catch (wmErr) {
          console.error('Failed to optimize and compress file:', file.name, wmErr);
          throw new Error('Eroare la optimizarea imaginii.');
        }

        // Compressed preview versions (~1200px) — used only for web grid display.
        // Keeps the gallery loading fast even on mobile / slow connections.
        // Non-fatal: if preview generation fails, full-res is used as fallback.
        try {
          previewCleanBlob = await applyWatermark(
            file,
            null,
            watermarkPosition,
            watermarkOffsetX,
            watermarkOffsetY,
            1200,
            0.78
          );
          await yieldToMain();

          if (watermarkEnabled && globalWatermark) {
            previewWmBlob = await applyWatermark(
              file,
              globalWatermark.url,
              watermarkPosition,
              watermarkOffsetX,
              watermarkOffsetY,
              1200,
              0.78
            );
            await yieldToMain();
          }
          // ~600px copy: what a phone actually needs in the grid. Desktops keep
          // the 1200px one through srcset. Cuts grid traffic by about two thirds.
          thumbBlob = await applyWatermark(
            file,
            watermarkEnabled && globalWatermark ? globalWatermark.url : null,
            watermarkPosition, watermarkOffsetX, watermarkOffsetY, 600, 0.75
          );
          await yieldToMain();
        } catch (previewErr) {
          console.warn('[Preview] Preview generation failed, will use full-res for display:', previewErr);
          previewCleanBlob = null;
          previewWmBlob = null;
          thumbBlob = null;
        }

        // Use timestamp + random suffix to guarantee unique Storage paths.
        // Critical: BATCH_SIZE=2 means two files run in parallel. If both have the
        // same filename (e.g. XIA03247.jpg from two different shoots), Date.now()
        // alone can return the same millisecond, causing Storage paths to collide and
        // one photo's content to overwrite another's. The random suffix prevents this.
        const ts = `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

        // High-res clean (for download)
        const cleanStoragePath = `galleries/${targetGalleryId}/${targetSubId}/clean_${ts}_${file.name}`;
        const cleanStorageRef = ref(storage, cleanStoragePath);
        // All four paths carry the unique `ts`, so they are never rewritten and
        // can be cached by browsers for a year (see IMMUTABLE_FILE_METADATA).
        const cleanUploadTask = uploadBytesResumable(cleanStorageRef, cleanBlob, IMMUTABLE_FILE_METADATA).then(async (snap) => {
          const cleanUrl = await getDownloadURL(snap.ref);
          return { cleanUrl, cleanPath: cleanStoragePath };
        });

        // High-res watermarked (for download, if watermark enabled)
        let wmUploadTask: Promise<{ wmUrl: string; wmPath: string } | undefined> = Promise.resolve(undefined);
        if (wmBlob) {
          const wmStoragePath = `galleries/${targetGalleryId}/${targetSubId}/wm_${ts}_${file.name}`;
          const wmStorageRef = ref(storage, wmStoragePath);
          wmUploadTask = uploadBytesResumable(wmStorageRef, wmBlob, IMMUTABLE_FILE_METADATA).then(async (snap) => {
            const wmUrl = await getDownloadURL(snap.ref);
            return { wmUrl, wmPath: wmStoragePath };
          }) as Promise<{ wmUrl: string; wmPath: string } | undefined>;
        }

        // Compressed preview clean (~1200px — web grid display only)
        let previewCleanUploadTask: Promise<{ previewCleanUrl: string; previewCleanPath: string } | undefined> = Promise.resolve(undefined);
        if (previewCleanBlob) {
          const previewCleanStoragePath = `galleries/${targetGalleryId}/${targetSubId}/prev_${ts}_${file.name}`;
          const previewCleanRef = ref(storage, previewCleanStoragePath);
          previewCleanUploadTask = uploadBytesResumable(previewCleanRef, previewCleanBlob, IMMUTABLE_FILE_METADATA).then(async (snap) => {
            const previewCleanUrl = await getDownloadURL(snap.ref);
            return { previewCleanUrl, previewCleanPath: previewCleanStoragePath };
          }) as Promise<{ previewCleanUrl: string; previewCleanPath: string } | undefined>;
        }

        // ~600px thumbnail, uploaded next to the previews.
        let thumbUploadTask: Promise<{ thumbUrl: string; thumbPath: string } | undefined> = Promise.resolve(undefined);
        if (thumbBlob) {
          const thumbStoragePath = `galleries/${targetGalleryId}/${targetSubId}/thumb_${ts}_${file.name}`;
          const thumbRef = ref(storage, thumbStoragePath);
          thumbUploadTask = uploadBytesResumable(thumbRef, thumbBlob, IMMUTABLE_FILE_METADATA).then(async (snap) => {
            const thumbUrl = await getDownloadURL(snap.ref);
            return { thumbUrl, thumbPath: thumbStoragePath };
          }) as Promise<{ thumbUrl: string; thumbPath: string } | undefined>;
        }

        // Compressed preview watermarked (~1200px — web grid display only)
        let previewWmUploadTask: Promise<{ previewWmUrl: string; previewWmPath: string } | undefined> = Promise.resolve(undefined);
        if (previewWmBlob) {
          const previewWmStoragePath = `galleries/${targetGalleryId}/${targetSubId}/prevwm_${ts}_${file.name}`;
          const previewWmRef = ref(storage, previewWmStoragePath);
          previewWmUploadTask = uploadBytesResumable(previewWmRef, previewWmBlob, IMMUTABLE_FILE_METADATA).then(async (snap) => {
            const previewWmUrl = await getDownloadURL(snap.ref);
            return { previewWmUrl, previewWmPath: previewWmStoragePath };
          }) as Promise<{ previewWmUrl: string; previewWmPath: string } | undefined>;
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

          const [cleanResult, wmResult, previewCleanResult, previewWmResult, thumbResult] = await Promise.all([
            uploadWithRetry(() => cleanUploadTask),
            uploadWithRetry(() => wmUploadTask),
            previewCleanUploadTask.catch(() => undefined as any),
            previewWmUploadTask.catch(() => undefined as any),
            thumbUploadTask.catch(() => undefined as any),
          ]) as [
            { cleanUrl: string; cleanPath: string },
            { wmUrl: string; wmPath: string } | undefined,
            { previewCleanUrl: string; previewCleanPath: string } | undefined,
            { previewWmUrl: string; previewWmPath: string } | undefined,
            { thumbUrl: string; thumbPath: string } | undefined
          ];

          const finalUrl = wmResult ? wmResult.wmUrl : cleanResult.cleanUrl;
          const finalPath = wmResult ? wmResult.wmPath : cleanResult.cleanPath;

          // Preview URL mirrors the same watermark logic as full-res
          const previewFinalUrl = previewWmResult?.previewWmUrl ?? previewCleanResult?.previewCleanUrl;
          const previewFinalPath = previewWmResult?.previewWmPath ?? previewCleanResult?.previewCleanPath;

          const newItem: PhotoItem = {
            name: file.name,
            url: finalUrl,
            path: finalPath,
            cleanUrl: cleanResult.cleanUrl,
            cleanPath: cleanResult.cleanPath,
            previewUrl: previewFinalUrl,
            previewPath: previewFinalPath,
            previewCleanUrl: previewCleanResult?.previewCleanUrl,
            previewCleanPath: previewCleanResult?.previewCleanPath,
            thumbUrl: thumbResult?.thumbUrl,
            thumbPath: thumbResult?.thumbPath,
            width: imgDims.width,
            height: imgDims.height
          };

          // If cancelled right before database write, delete storage files and abort
          if (cancelledJobKeysRef.current.has(jobKey)) {
            if (cleanResult.cleanPath) await deleteObject(ref(storage, cleanResult.cleanPath)).catch(() => {});
            if (wmResult?.wmPath) await deleteObject(ref(storage, wmResult.wmPath)).catch(() => {});
            if (previewCleanResult?.previewCleanPath) await deleteObject(ref(storage, previewCleanResult.previewCleanPath)).catch(() => {});
            if (previewWmResult?.previewWmPath) await deleteObject(ref(storage, previewWmResult.previewWmPath)).catch(() => {});
            return;
          }

          // Update Firestore immediately — writes to subcollection. With
          // "Suprascrie", an existing photo of the same name is replaced in place;
          // if that fails for any reason, the photo is added as usual instead.
          let firestoreId: string | undefined;
          const replaceIds = overwriteTargets?.[file.name];
          if (replaceIds && replaceIds.length > 0) {
            firestoreId = await overwriteGalleryPhoto(targetGalleryId, targetSubId, replaceIds, newItem);
          }
          if (!firestoreId) {
            [firestoreId] = await updateFirestoreGalleryPhotos(targetGalleryId, targetSubId, [newItem]);
          }
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

  /**
   * Background upload for a class album.
   *
   * Runs in the provider rather than in a screen component, so it survives
   * navigation: the photographer can queue three classes, walk away, and the
   * progress bar keeps reporting from anywhere in the app.
   *
   * Each photo is written to Firestore the moment its upload finishes. An
   * overnight run of 20k files that dies at hour six therefore keeps everything
   * uploaded up to that point, instead of losing the session like the old
   * save-everything-at-the-end path did.
   */
  const startClassUpload = useCallback(async (
    filesArray: File[],
    classId: string,
    className: string,
    watermarkEnabled: boolean,
    watermarkUrl: string | null,
    watermarkPosition: 'center' | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'bottom-center' | 'tile' | null,
    watermarkOffsetX: number,
    watermarkOffsetY: number,
    sessionId?: string
  ) => {
    const jobKey = `class:${classId}`;
    cancelledJobKeysRef.current.delete(jobKey);

    const initialProgressMap: Record<string, ProgressItem> = {};
    filesArray.forEach(file => {
      initialProgressMap[file.name] = { name: file.name, progress: 0, status: 'Așteptare...' };
    });

    setJobs(prev => ({
      ...prev,
      [jobKey]: {
        jobKey,
        kind: 'class',
        label: className,
        galleryId: classId,
        subId: '',
        filesTotal: (prev[jobKey]?.isFinished === false ? prev[jobKey].filesTotal : 0) + filesArray.length,
        filesUploaded: prev[jobKey]?.isFinished === false ? prev[jobKey].filesUploaded : 0,
        isFinished: false,
        progressMap: {
          ...(prev[jobKey]?.isFinished === false ? prev[jobKey].progressMap : {}),
          ...initialProgressMap
        }
      }
    }));

    const setFileStatus = (fileName: string, patch: Partial<ProgressItem>) => {
      setJobs(prev => {
        const job = prev[jobKey];
        if (!job) return prev;
        return {
          ...prev,
          [jobKey]: {
            ...job,
            progressMap: {
              ...job.progressMap,
              [fileName]: { ...job.progressMap[fileName], ...patch }
            }
          }
        };
      });
    };

    // Move the class off the legacy 1MB-capped array before writing anything.
    try {
      const classSnap = await getDoc(doc(db, 'classes', classId));
      await ensureClassMigrated(classId, classSnap.exists() ? classSnap.data() : null);
    } catch (e) {
      console.error('[Upload] Could not migrate class to subcollection:', e);
      setJobs(prev => {
        const job = prev[jobKey];
        if (!job) return prev;
        return { ...prev, [jobKey]: { ...job, isFinished: true } };
      });
      return;
    }

    const yieldToMain = () => new Promise(resolve => setTimeout(resolve, 60));
    const BATCH_SIZE = 2;

    // Folder per file, decided on the whole batch (single dropped root is stripped, etc.)
    const folderByFile = new Map<File, string>();
    {
      const names = computeUploadFolders(filesArray.map(f => (f as any).webkitRelativePath || ''));
      filesArray.forEach((f, i) => folderByFile.set(f, names[i]));
    }

    const processOne = async (file: File) => {
      if (cancelledJobKeysRef.current.has(jobKey)) return;

      try {
        await yieldToMain();
        setFileStatus(file.name, { status: watermarkEnabled ? 'Aplicare watermark...' : 'Se procesează...' });

        // Unique suffix matters: BATCH_SIZE=2 means two files upload at once, and
        // two shoots can easily contain the same filename. Date.now() alone can
        // collide inside one millisecond and silently overwrite a photo.
        const baseFileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${file.name}`;

        // Archive copy is the original, byte for byte — EXIF and colour profile
        // survive for print. Only the displayed copy is ever re-encoded.
        const cleanBlob: Blob = file;
        let uploadBlob: Blob = file;
        let storagePath = `classes/${classId}/gallery/clean_${baseFileName}`;
        let cleanStoragePath = storagePath;

        if (watermarkEnabled && watermarkUrl) {
          try {
            uploadBlob = await applyWatermark(file, watermarkUrl, watermarkPosition, watermarkOffsetX, watermarkOffsetY);
            storagePath = `classes/${classId}/gallery/wm_${baseFileName}`;
            cleanStoragePath = `classes/${classId}/gallery/clean_${baseFileName}`;
            await yieldToMain();
          } catch (wmErr) {
            console.error('[Upload] Watermark failed, falling back to original:', file.name, wmErr);
            uploadBlob = file;
            storagePath = `classes/${classId}/gallery/clean_${baseFileName}`;
            cleanStoragePath = storagePath;
          }
        }

        if (cancelledJobKeysRef.current.has(jobKey)) return;

        setFileStatus(file.name, { progress: 5, status: 'Se încarcă...' });

        const uploadOne = (path: string, blob: Blob, trackProgress: boolean) =>
          new Promise<string>((resolve, reject) => {
            // Class paths embed Date.now() + a random suffix — never rewritten.
            const task = uploadBytesResumable(ref(storage, path), blob, IMMUTABLE_FILE_METADATA);
            task.on(
              'state_changed',
              (snapshot) => {
                if (!trackProgress) return;
                const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
                setFileStatus(file.name, { progress, status: 'Se încarcă...' });
              },
              reject,
              async () => {
                try {
                  resolve(await getDownloadURL(task.snapshot.ref));
                } catch (err) {
                  reject(err);
                }
              }
            );
          });

        const withRetry = async (fn: () => Promise<string>, maxRetries = 3): Promise<string> => {
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
              return await fn();
            } catch (err) {
              if (cancelledJobKeysRef.current.has(jobKey)) throw err;
              if (attempt === maxRetries) throw err;
              console.warn(`[Upload Retry] Attempt ${attempt} failed for ${file.name}. Retrying...`);
              await new Promise(r => setTimeout(r, attempt * 1000));
            }
          }
          throw new Error('unreachable');
        };

        // ~1200px previews for the grids. Without them every thumbnail loaded a
        // multi-megabyte file, which is what made Storage egress the biggest line
        // on the bill. Non-fatal: a class still works if a preview fails.
        const baseTs = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        let previewCleanBlob: Blob | null = null;
        let previewWmBlob: Blob | null = null;
        let thumbBlobCls: Blob | null = null;
        try {
          previewCleanBlob = await applyWatermark(file, null, watermarkPosition, watermarkOffsetX, watermarkOffsetY, 1200, 0.78);
          await yieldToMain();
          if (watermarkEnabled && watermarkUrl) {
            previewWmBlob = await applyWatermark(file, watermarkUrl, watermarkPosition, watermarkOffsetX, watermarkOffsetY, 1200, 0.78);
            await yieldToMain();
          }
          thumbBlobCls = await applyWatermark(file, watermarkEnabled && watermarkUrl ? watermarkUrl : null, watermarkPosition, watermarkOffsetX, watermarkOffsetY, 600, 0.75);
          await yieldToMain();
        } catch (prevErr) {
          console.warn('[Upload] Preview generation failed, grid will use the full file:', file.name, prevErr);
        }

        const previewCleanPath = previewCleanBlob ? `classes/${classId}/gallery/prev_${baseTs}_${file.name}` : '';
        const previewWmPath = previewWmBlob ? `classes/${classId}/gallery/prevwm_${baseTs}_${file.name}` : '';
        const thumbPathCls = thumbBlobCls ? `classes/${classId}/gallery/thumb_${baseTs}_${file.name}` : '';

        const needsSeparateClean = cleanStoragePath !== storagePath;
        const [displayUrl, cleanUrl, previewCleanUrl, previewWmUrl, thumbUrlCls] = await Promise.all([
          withRetry(() => uploadOne(storagePath, uploadBlob, true)),
          needsSeparateClean
            ? withRetry(() => uploadOne(cleanStoragePath, cleanBlob, false))
            : Promise.resolve(''),
          previewCleanBlob ? uploadOne(previewCleanPath, previewCleanBlob, false).catch(() => '') : Promise.resolve(''),
          previewWmBlob ? uploadOne(previewWmPath, previewWmBlob, false).catch(() => '') : Promise.resolve(''),
          thumbBlobCls ? uploadOne(thumbPathCls, thumbBlobCls, false).catch(() => '') : Promise.resolve(''),
        ]);

        if (cancelledJobKeysRef.current.has(jobKey)) {
          // Cancelled between Storage write and Firestore write — remove the
          // orphaned blobs so they do not sit in the bucket unreferenced.
          await deleteObject(ref(storage, storagePath)).catch(() => {});
          if (needsSeparateClean) await deleteObject(ref(storage, cleanStoragePath)).catch(() => {});
          return;
        }

        const folderName = folderByFile.get(file) || '';

        const newPhoto: ClassPhoto = {
          name: file.name,
          url: displayUrl,
          path: storagePath,
          cleanUrl: needsSeparateClean ? cleanUrl : displayUrl,
          cleanPath: cleanStoragePath,
          // Grid copy mirrors the display copy: watermarked when the class uses one.
          previewUrl: (previewWmUrl || previewCleanUrl) || undefined,
          previewPath: (previewWmUrl ? previewWmPath : previewCleanUrl ? previewCleanPath : undefined),
          previewCleanUrl: previewCleanUrl || undefined,
          previewCleanPath: previewCleanUrl ? previewCleanPath : undefined,
          thumbUrl: thumbUrlCls || undefined,
          thumbPath: thumbUrlCls ? thumbPathCls : undefined,
          ...(folderName ? { folder: folderName } : {}),
          ...(sessionId && sessionId !== 'main' ? { sessionId } : {}),
        };

        // Written now, not at the end — this is what makes an interrupted
        // overnight run recoverable.
        const firestoreId = await addClassPhoto(classId, newPhoto);
        const stored: ClassPhoto = { ...newPhoto, firestoreId };

        if (classListenersRef.current[classId] && !cancelledJobKeysRef.current.has(jobKey)) {
          classListenersRef.current[classId].forEach(cb => cb(stored));
        }

        setJobs(prev => {
          const job = prev[jobKey];
          if (!job) return prev;
          const newUploaded = job.filesUploaded + 1;
          return {
            ...prev,
            [jobKey]: {
              ...job,
              filesUploaded: newUploaded,
              isFinished: newUploaded >= job.filesTotal,
              progressMap: {
                ...job.progressMap,
                [file.name]: { ...job.progressMap[file.name], progress: 100, status: 'Finalizat' }
              }
            }
          };
        });
      } catch (err: any) {
        console.error('[Upload] Error uploading class photo:', file.name, err);
        // One bad file must not stop a 20k-file night, so the loop continues.
        setFileStatus(file.name, { status: `Eroare: ${err?.message || 'Necunoscută'}` });
      }
    };

    for (let i = 0; i < filesArray.length; i += BATCH_SIZE) {
      if (cancelledJobKeysRef.current.has(jobKey)) {
        console.log(`[Upload] Class job ${jobKey} cancelled. Aborting loop.`);
        break;
      }
      await Promise.all(filesArray.slice(i, i + BATCH_SIZE).map(processOne));
      await yieldToMain();
    }

    // Keep a cheap count on the class document so the dashboard can show
    // "N poze" without reading the whole subcollection.
    try {
      const countSnap = await getDocs(classPhotosCol(classId));
      await updateDoc(doc(db, 'classes', classId), { photoCount: countSnap.size });
    } catch (e) {
      console.warn('[Upload] Could not refresh photoCount:', e);
    }

    setJobs(prev => {
      const job = prev[jobKey];
      if (!job) return prev;
      return { ...prev, [jobKey]: { ...job, isFinished: true } };
    });
  }, []);

  // Cancel an active upload job — stops processing new files but keeps all photos
  // that have already been successfully uploaded and written to Firestore.
  const cancelUpload = useCallback(async (jobKeyToCancel: string) => {
    // Signal the upload loop to stop processing new files
    cancelledJobKeysRef.current.add(jobKeyToCancel);

    // Photos already uploaded to Firestore are intentionally kept in the gallery.
    // Any photo currently mid-upload (Storage written, Firestore not yet) will be
    // cleaned up automatically by processOne when it detects the cancelled flag.

    // Clear the tracking list — nothing to roll back
    delete uploadedPhotosMapRef.current[jobKeyToCancel];

    // Dismiss the job tile from the UI immediately
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
      startClassUpload,
      cancelUpload,
      onClassPhotoUploaded,
      onPhotoUploaded,
      onPhotosDeleted,
      resetUploadState,
      dismissJob,
      forceReorderByName,
    }}>
      {children}
    </UploadContext.Provider>
  );
};

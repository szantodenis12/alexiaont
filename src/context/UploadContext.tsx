import React, { createContext, useContext, useState } from 'react';
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

interface UploadContextType {
  galleryId: string | null;
  activeSubId: string | null;
  filesTotal: number;
  filesUploaded: number;
  isUploading: boolean;
  progressMap: Record<string, ProgressItem>;
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
  const [galleryId, setGalleryId] = useState<string | null>(null);
  const [activeSubId, setActiveSubId] = useState<string | null>(null);
  const [filesTotal, setFilesTotal] = useState<number>(0);
  const [filesUploaded, setFilesUploaded] = useState<number>(0);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [progressMap, setProgressMap] = useState<Record<string, ProgressItem>>({});
  
  // Store listeners for real-time photo addition callbacks
  const [listeners, setListeners] = useState<Record<string, ((photo: PhotoItem) => void)[]>>({});

  const onPhotoUploaded = (targetGalleryId: string, callback: (photo: PhotoItem) => void) => {
    setListeners(prev => {
      const current = prev[targetGalleryId] || [];
      return {
        ...prev,
        [targetGalleryId]: [...current, callback]
      };
    });

    return () => {
      setListeners(prev => {
        const current = prev[targetGalleryId] || [];
        return {
          ...prev,
          [targetGalleryId]: current.filter(cb => cb !== callback)
        };
      });
    };
  };

  const resetUploadState = () => {
    if (isUploading) return;
    setGalleryId(null);
    setActiveSubId(null);
    setFilesTotal(0);
    setFilesUploaded(0);
    setProgressMap({});
  };

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

  const startUpload = async (
    filesArray: File[],
    targetGalleryId: string,
    targetSubId: string,
    watermarkEnabled: boolean,
    globalWatermark: any | null,
    watermarkPosition: 'center' | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'bottom-center' | 'tile' | null,
    watermarkOffsetX: number,
    watermarkOffsetY: number
  ) => {
    if (isUploading) {
      alert("O altă încărcare este deja în curs de desfășurare.");
      return;
    }

    setGalleryId(targetGalleryId);
    setActiveSubId(targetSubId);
    setFilesTotal(filesArray.length);
    setFilesUploaded(0);
    setIsUploading(true);

    const initialMap: Record<string, ProgressItem> = {};
    filesArray.forEach(file => {
      initialMap[file.name] = {
        name: file.name,
        progress: 0,
        status: 'Pregătire...'
      };
    });
    setProgressMap(initialMap);

    const BATCH_SIZE = 5;
    const uploadedItems: PhotoItem[] = [];

    const processOne = async (file: File) => {
      try {
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

        setProgressMap(prev => ({
          ...prev,
          [file.name]: { ...prev[file.name], status: watermarkEnabled ? 'Aplicare watermark...' : 'Optimizare...' }
        }));

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

          if (watermarkEnabled && globalWatermark) {
            wmBlob = await applyWatermark(
              file,
              globalWatermark.url,
              watermarkPosition,
              watermarkOffsetX,
              watermarkOffsetY
            );
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

        setProgressMap(prev => ({
          ...prev,
          [file.name]: { ...prev[file.name], progress: 20, status: 'Încărcare...' }
        }));

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

          uploadedItems.push(newItem);

          // Update Firestore immediately
          await updateFirestoreGalleryPhotos(targetGalleryId, targetSubId, [newItem]);

          // Trigger listener
          if (listeners[targetGalleryId]) {
            listeners[targetGalleryId].forEach(cb => cb(newItem));
          }

          setProgressMap(prev => ({
            ...prev,
            [file.name]: { ...prev[file.name], progress: 100, status: 'Finalizat' }
          }));

          setFilesUploaded(prev => prev + 1);
        } catch (uploadErr) {
          console.error('Upload task failed:', uploadErr);
          throw new Error('Eroare la încărcarea fișierelor.');
        }
      } catch (err: any) {
        console.error('Error uploading photo:', file.name, err);
        setProgressMap(prev => ({
          ...prev,
          [file.name]: { ...prev[file.name], status: `Eroare: ${err.message || 'Necunoscută'}` }
        }));
      }
    };

    for (let i = 0; i < filesArray.length; i += BATCH_SIZE) {
      const batch = filesArray.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(processOne));
    }

    setIsUploading(false);
  };

  return (
    <UploadContext.Provider value={{
      galleryId,
      activeSubId,
      filesTotal,
      filesUploaded,
      isUploading,
      progressMap,
      startUpload,
      onPhotoUploaded,
      resetUploadState
    }}>
      {children}
    </UploadContext.Provider>
  );
};

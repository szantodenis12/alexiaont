import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import JSZip from 'jszip';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc, collection, addDoc, getDocs, query, where, onSnapshot, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { auth, db, storage } from '../../firebase/config';
import { applyWatermark } from '../../utils/watermarkProcessor';
import { useUpload } from '../../context/UploadContext';
import { 
  ArrowLeft, Upload, Trash2, Plus, X, Monitor, Smartphone, 
  Type, Image as ImageIcon, Folder, RefreshCw, Check, Settings,
  Eye, Grid, Edit2, FileText, Download, AlertCircle, ArrowDownAZ
} from 'lucide-react';

interface PhotoItem {
  firestoreId?: string;  // Firestore document ID in the subcollection
  name: string;
  url: string;
  path: string;
  width?: number;
  height?: number;
  cleanUrl?: string;
  cleanPath?: string;
  previewUrl?: string;       // compressed ~1200px (watermarked) — for web grid display
  previewPath?: string;
  previewCleanUrl?: string;  // compressed ~1200px clean — for web grid (admin/clean mode)
  previewCleanPath?: string;
  order?: number | null;
}

interface SubCollection {
  id: string;
  name: string;
  photos: PhotoItem[];
  photoCount?: number;
  hasManualOrder?: boolean;  // true when admin has drag-reordered photos
}

interface TitleStyle {
  fontFamily: string;
  fontSize: string;
  color: string;
  position: 'bottom-left' | 'center' | 'bottom-center' | 'top-center';
}

interface GalleryData {
  title: string;
  subtitle: string;
  date: string;
  coverPhoto: {
    url: string;
    path: string;
    focalPoint: { x: number; y: number };
  } | null;
  titleStyle: TitleStyle;
  watermarkEnabled: boolean;
  watermarkPosition: 'center' | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'bottom-center' | 'tile';
  subCollections: SubCollection[];
}

export const PhotoGalleryCreator: React.FC = () => {
  const { galleryId } = useParams<{ galleryId: string }>();
  const isEdit = !!galleryId;
  const navigate = useNavigate();

  // Settings loaded from DB
  const [globalWatermark, setGlobalWatermark] = useState<any | null>(null);

  // Gallery main states
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  
  // Cover states
  const [coverPhoto, setCoverPhoto] = useState<GalleryData['coverPhoto']>(null);
  const [isUploadingCover, setIsUploadingCover] = useState(false);
  const [focalPoint, setFocalPoint] = useState({ x: 50, y: 50 });
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop');

  // Title styles
  const [fontFamily, setFontFamily] = useState('Outfit');
  const [fontSize, setFontSize] = useState('42px');
  const [textColor, setTextColor] = useState('#FAF9F6');
  const [titlePosition, setTitlePosition] = useState<TitleStyle['position']>('bottom-left');

  // Watermark
  const [watermarkEnabled, setWatermarkEnabled] = useState(false);
  const [watermarkPosition, setWatermarkPosition] = useState<GalleryData['watermarkPosition']>('bottom-right');
  const [watermarkOffsetX, setWatermarkOffsetX] = useState(0);
  const [watermarkOffsetY, setWatermarkOffsetY] = useState(0);

  // Sub-collections
  const [subCollections, setSubCollections] = useState<SubCollection[]>([
    { id: 'all', name: 'General', photos: [] }
  ]);
  const [activeSubId, setActiveSubId] = useState('all');
  const [newSubName, setNewSubName] = useState('');
  const [isAddingSet, setIsAddingSet] = useState(false);

  // Bulk selection state
  const [selectedPhotoPaths, setSelectedPhotoPaths] = useState<string[]>([]);
  const [lastSelectedPhotoPath, setLastSelectedPhotoPath] = useState<string | null>(null);
  const [draggedPhotoIndex, setDraggedPhotoIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Clear selection on active folder change
  useEffect(() => {
    setSelectedPhotoPaths([]);
    setLastSelectedPhotoPath(null);
  }, [activeSubId]);

  // Upload progress tracking from global UploadContext (multi-job)
  const { 
    jobs: uploadJobs,
    startUpload,
    onPhotoUploaded,
    onPhotosDeleted,
    forceReorderByName
  } = useUpload();
  const [isReorderingAZ, setIsReorderingAZ] = useState(false);

  // Find the job for the current gallery+folder combination
  const currentJobKey = galleryId && activeSubId ? `${galleryId}:${activeSubId}` : null;
  const currentJob = currentJobKey ? uploadJobs.find(j => j.jobKey === currentJobKey) : null;
  const isUploadingPhotos = !!(currentJob && !currentJob.isFinished);
  const uploadProgress = currentJob?.progressMap ?? {};
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  
  // Lightbox preview states
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);
  const [previewPhotoIndex, setPreviewPhotoIndex] = useState<number>(-1);
  const [isPreviewWatermarkLarge, setIsPreviewWatermarkLarge] = useState(false);
  
  // Watermark retroactive processing states
  const [isProcessingWatermark, setIsProcessingWatermark] = useState(false);
  const [processingProgress, setProcessingProgress] = useState({ current: 0, total: 0 });

  // Preview generation states (for existing photos)
  const [isGeneratingPreviews, setIsGeneratingPreviews] = useState(false);
  const [previewGenProgress, setPreviewGenProgress] = useState({ current: 0, total: 0 });

  // Original photos restoration states
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState({ current: 0, total: 0, matched: 0 });
  const [restoreMessage, setRestoreMessage] = useState('');

  // Save states
  const [_isSaving, setIsSaving] = useState(false);
  const [loadingError, setLoadingError] = useState('');
  const [isLoaded, setIsLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');

  // Duplicate detection modal state
  const [duplicateModal, setDuplicateModal] = useState<{
    visible: boolean;
    duplicateNames: string[];
    newFiles: File[];
    uniqueFiles: File[];
    pendingGalleryId: string;
    pendingSubId: string;
  } | null>(null);

  const saveSubCollectionsToFirestore = async (updatedSubs: SubCollection[]) => {
    if (!galleryId) return;
    try {
      // Save metadata with accurate photoCount per subcollection
      const subsMeta = updatedSubs.map(({ photos, ...meta }) => ({
        ...meta,
        photoCount: (photos || []).length
      }));
      await updateDoc(doc(db, 'photo_galleries', galleryId), {
        subCollections: subsMeta
      });
    } catch (err) {
      console.error('Failed to save subCollections to Firestore:', err);
    }
  };

  // ── Migration helper ──────────────────────────────────────────────────────
  // Moves legacy photos embedded in the main gallery document into the new
  // Firestore subcollection structure. Runs once, silently, on first admin open.
  // Returns true if successful, false if batch writes failed.
  const migratePhotosToSubcollections = async (
    gId: string,
    subsWithPhotos: SubCollection[],
    galleryData: any   // full document data to reconstruct a clean version
  ): Promise<boolean> => {
    const BATCH_LIMIT = 499;
    let batch = writeBatch(db);
    let opCount = 0;

    try {
      // Step 1 — write each photo as its own small doc in the subcollection
      for (const sub of subsWithPhotos) {
        for (const photo of (sub.photos || [])) {
          const photoRef = doc(collection(db, 'photo_galleries', gId, 'subcollections', sub.id, 'photos'));
          batch.set(photoRef, {
            name: photo.name,
            url: photo.url,
            path: photo.path,
            cleanUrl: photo.cleanUrl || null,
            cleanPath: photo.cleanPath || null,
            width: photo.width || null,
            height: photo.height || null,
            order: null,
          });
          opCount++;
          if (opCount >= BATCH_LIMIT) {
            await batch.commit();
            batch = writeBatch(db);
            opCount = 0;
          }
        }
      }
      if (opCount > 0) await batch.commit();
      console.log('[Migration] All photos written to subcollections.');
    } catch (writeErr) {
      console.error('[Migration] FAILED to write photo docs:', writeErr);
      return false;
    }

    // Step 2 — replace the main document with a clean version (no photos[] embedded).
    // We use setDoc (full replace) because updateDoc can fail if the current doc is >1MB.
    try {
      const subsMeta = subsWithPhotos.map(({ photos, ...meta }) => ({
        ...meta,
        photoCount: (photos || []).length
      }));
      // Build a clean payload from existing data — preserving all metadata fields
      const cleanPayload: any = {
        title: galleryData.title || '',
        subtitle: galleryData.subtitle || '',
        date: galleryData.date || '',
        coverPhoto: galleryData.coverPhoto || null,
        titleStyle: galleryData.titleStyle || { fontFamily: 'Outfit', fontSize: '42px', color: '#FAF9F6', position: 'bottom-left' },
        watermarkEnabled: galleryData.watermarkEnabled || false,
        watermarkPosition: galleryData.watermarkPosition || 'bottom-right',
        watermarkOffsetX: galleryData.watermarkOffsetX ?? 0,
        watermarkOffsetY: galleryData.watermarkOffsetY ?? 0,
        selectionEnabled: galleryData.selectionEnabled || false,
        selectionMinPhotos: galleryData.selectionMinPhotos ?? 10,
        selectionMaxPhotos: galleryData.selectionMaxPhotos ?? 30,
        createdAt: galleryData.createdAt || null,
        subCollections: subsMeta,  // metadata only, no embedded photo objects
      };
      await setDoc(doc(db, 'photo_galleries', gId), cleanPayload);
      console.log('[Migration] Main document cleaned up (photos removed from embedded array).');
    } catch (cleanupErr) {
      // Non-fatal: photos are safely in subcollections. Cleanup can be retried on next open.
      console.warn('[Migration] Could not clean up main doc (will retry on next open):', cleanupErr);
    }

    return true;
  };

  // Active settings sidebar tab
  const [activeSettingsTab, setActiveSettingsTab] = useState<'photos' | 'cover' | 'watermark' | 'selection'>('photos');
  const [selectionEnabled, setSelectionEnabled] = useState(false);
  const [selectionMinPhotos, setSelectionMinPhotos] = useState(10);
  const [selectionMaxPhotos, setSelectionMaxPhotos] = useState(30);

  // Custom Selection Links States
  interface SelectionLinkItem {
    id: string;
    galleryId: string;
    name: string;
    enabled: boolean;
    minPhotos?: number;
    maxPhotos?: number;
    createdAt?: any;
  }
  const [selectionLinks, setSelectionLinks] = useState<SelectionLinkItem[]>([]);
  const [newLinkName, setNewLinkName] = useState('');
  const [newLinkMinPhotos, setNewLinkMinPhotos] = useState<number>(1);
  const [newLinkMaxPhotos, setNewLinkMaxPhotos] = useState<number>(30);
  const [isCreatingLink, setIsCreatingLink] = useState(false);
  const [selectedFilterLinkId, setSelectedFilterLinkId] = useState<string>('all');

  // Main UI Tabs
  const [activeMainTab, setActiveMainTab] = useState<'editor' | 'selections' | 'logs'>('editor');
  const [selectionsList, setSelectionsList] = useState<any[]>([]);
  const [logsList, setLogsList] = useState<any[]>([]);
  const [expandedSelectionId, setExpandedSelectionId] = useState<string | null>(null);
  const [zipProgress, setZipProgress] = useState<number | null>(null);

  // Drag and drop states for subcollections
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // Folder renaming states
  const [renamingSubId, setRenamingSubId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const handleNudge = (direction: 'up' | 'down' | 'left' | 'right') => {
    const pos = watermarkPosition || 'bottom-right';
    let currentX = watermarkOffsetX;
    let currentY = watermarkOffsetY;
    const step = 1;

    if (direction === 'up') {
      if (pos.startsWith('bottom')) {
        currentY = Math.min(45, currentY + step);
      } else if (pos.startsWith('top')) {
        currentY = Math.max(-35, currentY - step);
      } else if (pos === 'center') {
        currentY = Math.max(-45, currentY - step);
      }
    } else if (direction === 'down') {
      if (pos.startsWith('bottom')) {
        currentY = Math.max(-35, currentY - step);
      } else if (pos.startsWith('top')) {
        currentY = Math.min(45, currentY + step);
      } else if (pos === 'center') {
        currentY = Math.min(45, currentY + step);
      }
    } else if (direction === 'left') {
      if (pos.endsWith('right')) {
        currentX = Math.min(45, currentX + step);
      } else if (pos.endsWith('left')) {
        currentX = Math.max(-35, currentX - step);
      } else if (pos === 'bottom-center' || pos === 'center') {
        currentX = Math.max(-45, currentX - step);
      }
    } else if (direction === 'right') {
      if (pos.endsWith('right')) {
        currentX = Math.max(-35, currentX - step);
      } else if (pos.endsWith('left')) {
        currentX = Math.min(45, currentX + step);
      } else if (pos === 'bottom-center' || pos === 'center') {
        currentX = Math.min(45, currentX + step);
      }
    }

    setWatermarkOffsetX(currentX);
    setWatermarkOffsetY(currentY);
  };



  const coverInputRef = useRef<HTMLInputElement>(null);
  const photosInputRef = useRef<HTMLInputElement>(null);

  // Load global settings (watermark) & existing gallery if edit
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        navigate('/admin/login');
        return;
      }

      let defaultWM: any = null;
      try {
        const settingsDoc = await getDoc(doc(db, 'settings', 'global'));
        if (settingsDoc.exists() && settingsDoc.data().defaultWatermark) {
          defaultWM = settingsDoc.data().defaultWatermark;
          setGlobalWatermark(defaultWM);
        }
      } catch (err) {
        console.error('Error loading watermark settings:', err);
      }

      if (!galleryId) {
        if (defaultWM) {
          setWatermarkPosition(defaultWM.position || 'bottom-right');
          setWatermarkOffsetX(defaultWM.offsetX || 0);
          setWatermarkOffsetY(defaultWM.offsetY || 0);
        }
        setIsLoaded(true);
        return;
      }

      try {
        const docSnap = await getDoc(doc(db, 'photo_galleries', galleryId));
        if (docSnap.exists()) {
          const data = docSnap.data() as any;
          setTitle(data.title || '');
          setSubtitle(data.subtitle || '');
          setDate(data.date || '');
          setCoverPhoto(data.coverPhoto || null);
          if (data.coverPhoto?.focalPoint) {
            setFocalPoint(data.coverPhoto.focalPoint);
          }
          if (data.titleStyle) {
            setFontFamily(data.titleStyle.fontFamily || 'Outfit');
            setFontSize(data.titleStyle.fontSize || '42px');
            setTextColor(data.titleStyle.color || '#FAF9F6');
            setTitlePosition(data.titleStyle.position || 'bottom-left');
          }
          setWatermarkEnabled(data.watermarkEnabled || false);
          setWatermarkPosition(data.watermarkPosition || 'bottom-right');
          setWatermarkOffsetX(data.watermarkOffsetX !== undefined ? data.watermarkOffsetX : (defaultWM?.offsetX || 0));
          setWatermarkOffsetY(data.watermarkOffsetY !== undefined ? data.watermarkOffsetY : (defaultWM?.offsetY || 0));
          setSelectionEnabled(data.selectionEnabled || false);
          setSelectionMinPhotos(data.selectionMinPhotos !== undefined ? data.selectionMinPhotos : 10);
          setSelectionMaxPhotos(data.selectionMaxPhotos !== undefined ? data.selectionMaxPhotos : 30);

          const rawSubs: SubCollection[] = data.subCollections || [{ id: 'all', name: 'General', photos: [] }];

          // ── Auto-migration: if photos[] are still embedded in the main doc, move them ──
          const needsMigration = rawSubs.some(s => s.photos && s.photos.length > 0);
          if (needsMigration) {
            console.log('[Migration] Detected embedded photos — starting migration...');
            try {
              await migratePhotosToSubcollections(galleryId, rawSubs, data);
            } catch (migErr) {
              console.warn('[Migration] Migration had an error, continuing anyway:', migErr);
            }
            console.log('[Migration] Migration step complete.');
          }

          // ── Load photos for all subcollections concurrently on initial load ──
          const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
          const subsWithPhotos: SubCollection[] = await Promise.all(
            rawSubs.map(async (sub) => {
              const embeddedPhotos: PhotoItem[] = (sub.photos || []);
              try {
                const photosSnap = await getDocs(
                  collection(db, 'photo_galleries', galleryId, 'subcollections', sub.id, 'photos')
                );
                if (!photosSnap.empty) {
                  const photos: PhotoItem[] = photosSnap.docs.map(d => ({
                    firestoreId: d.id,
                    ...(d.data() as Omit<PhotoItem, 'firestoreId'>)
                  }));
                  if (sub.hasManualOrder) {
                    // Photos with no explicit order (null/undefined) are treated as Infinity
                    // so they appear at the END of a manually-ordered gallery,
                    // not at position 0 (which was the old bug).
                    photos.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
                  } else {
                    photos.sort((a, b) => collator.compare(a.name, b.name));
                  }
                  return { ...sub, photos, photoCount: photos.length };
                } else {
                  const photos = [...embeddedPhotos];
                  photos.sort((a, b) => collator.compare(a.name, b.name));
                  return { ...sub, photos, photoCount: photos.length };
                }
              } catch {
                return { ...sub, photos: embeddedPhotos, photoCount: embeddedPhotos.length };
              }
            })
          );

          setSubCollections(subsWithPhotos);
          if (subsWithPhotos.length > 0) {
            setActiveSubId(subsWithPhotos[0].id);
          }
          setIsLoaded(true);
        } else {
          setLoadingError('Galeria nu a fost găsită.');
        }
      } catch (err) {
        console.error('Error loading gallery:', err);
        setLoadingError('Eroare la încărcarea galeriei.');
      }
    });

    return () => unsubscribeAuth();
  }, [galleryId, navigate]);

  // Listen to background uploads completing for this gallery while editing.
  // UploadContext passes the photo and its specific uploadedSubId target folder.
  useEffect(() => {
    if (!galleryId) return;
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    const unsubscribe = onPhotoUploaded(galleryId, (newPhoto, uploadedSubId) => {
      setSubCollections(prev => prev.map(sub => {
        if (sub.id === uploadedSubId) {
          const existingPhotos = sub.photos || [];
          const combined = [...existingPhotos];
          if (!combined.some(p => p.path === newPhoto.path)) {
            combined.push(newPhoto);  // newPhoto now includes firestoreId
          }
          if (!sub.hasManualOrder) {
            combined.sort((a, b) => collator.compare(a.name, b.name));
          }
          return { ...sub, photos: combined, photoCount: combined.length };
        }
        return sub;
      }));
    });
    return () => unsubscribe();
  }, [galleryId, onPhotoUploaded]);

  // Listen to upload cancellations for this gallery — purge cancelled photo IDs immediately
  useEffect(() => {
    if (!galleryId) return;
    const unsubscribe = onPhotosDeleted(galleryId, (deletedIds, targetSubId) => {
      setSubCollections(prev => prev.map(sub => {
        if (sub.id === targetSubId) {
          const filtered = (sub.photos || []).filter(p => 
            !deletedIds.includes(p.firestoreId || '') && !deletedIds.includes(p.path)
          );
          return { ...sub, photos: filtered, photoCount: filtered.length };
        }
        return sub;
      }));
    });
    return () => unsubscribe();
  }, [galleryId, onPhotosDeleted]);

  // Debounced auto-save hook — saves ALWAYS, even without a title (uses default)
  useEffect(() => {
    if (!isLoaded) return;

    const delayDebounceFn = setTimeout(async () => {
      // Use a default title if user hasn't typed one yet
      const cleanTitle = title.trim() || 'Galerie fără titlu';

      setSaveStatus('saving');
      
      const payload: any = {
        title: cleanTitle,
        subtitle: subtitle.trim(),
        date,
        coverPhoto: coverPhoto ? {
          ...coverPhoto,
          focalPoint
        } : null,
        titleStyle: {
          fontFamily,
          fontSize,
          color: textColor,
          position: titlePosition
        },
        watermarkEnabled,
        watermarkPosition,
        watermarkOffsetX,
        watermarkOffsetY,
        selectionEnabled,
        selectionMinPhotos,
        selectionMaxPhotos
      };

      try {
        if (galleryId) {
          await setDoc(doc(db, 'photo_galleries', galleryId), payload, { merge: true });
          setSaveStatus('saved');
        } else {
          payload.createdAt = new Date();
          // Include default subcollections payload when creating a new gallery
          payload.subCollections = subCollections;
          const docRef = await addDoc(collection(db, 'photo_galleries'), payload);
          setSaveStatus('saved');
          // Navigate to edit route so we continue autosaving to the new document
          navigate(`/admin/edit-photo-gallery/${docRef.id}`, { replace: true });
        }
      } catch (err) {
        console.error('Autosave error:', err);
        setSaveStatus('error');
      }
    }, 1000); // 1 second debounce

    return () => clearTimeout(delayDebounceFn);
  }, [
    isLoaded,
    galleryId,
    title,
    subtitle,
    date,
    coverPhoto,
    focalPoint,
    fontFamily,
    fontSize,
    textColor,
    titlePosition,
    watermarkEnabled,
    watermarkPosition,
    watermarkOffsetX,
    watermarkOffsetY,
    selectionEnabled,
    selectionMinPhotos,
    selectionMaxPhotos,
    navigate
  ]);

  // Listen to Client Selections
  useEffect(() => {
    if (!galleryId) return;
    const q = query(collection(db, 'gallery_selections'), where('galleryId', '==', galleryId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const selections = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Sort by submitted date descending
      selections.sort((a: any, b: any) => {
        const t1 = a.submittedAt?.toMillis ? a.submittedAt.toMillis() : 0;
        const t2 = b.submittedAt?.toMillis ? b.submittedAt.toMillis() : 0;
        return t2 - t1;
      });
      setSelectionsList(selections);
      if (selections.length > 0 && !expandedSelectionId) {
        setExpandedSelectionId(selections[0].id);
      }
    }, (err) => {
      console.error('Error listening to selections:', err);
    });
    return () => unsubscribe();
  }, [galleryId, expandedSelectionId]);

  // Listen to Custom Selection Links
  useEffect(() => {
    if (!galleryId) return;
    const q = query(collection(db, 'gallery_selection_links'), where('galleryId', '==', galleryId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const links = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SelectionLinkItem));
      links.sort((a, b) => {
        const t1 = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
        const t2 = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
        return t1 - t2;
      });
      setSelectionLinks(links);
    }, (err) => {
      console.error('Error listening to selection links:', err);
    });
    return () => unsubscribe();
  }, [galleryId]);

  const handleCreateSelectionLink = async () => {
    if (!galleryId || !newLinkName.trim()) return;
    setIsCreatingLink(true);
    const minP = Math.max(1, newLinkMinPhotos || 1);
    const maxP = Math.max(minP, newLinkMaxPhotos || minP);
    try {
      await addDoc(collection(db, 'gallery_selection_links'), {
        galleryId,
        name: newLinkName.trim(),
        enabled: true,
        minPhotos: minP,
        maxPhotos: maxP,
        createdAt: new Date()
      });
      setNewLinkName('');
    } catch (err: any) {
      console.error('Error creating selection link:', err);
      alert(`Eroare la crearea link-ului: ${err?.message || err}`);
    } finally {
      setIsCreatingLink(false);
    }
  };

  const handleUpdateSelectionLinkLimits = async (linkId: string, minP: number, maxP: number) => {
    const safeMin = Math.max(1, minP || 1);
    const safeMax = Math.max(safeMin, maxP || safeMin);
    try {
      await updateDoc(doc(db, 'gallery_selection_links', linkId), {
        minPhotos: safeMin,
        maxPhotos: safeMax
      });
    } catch (err: any) {
      console.error('Error updating link limits:', err);
    }
  };

  const handleToggleSelectionLink = async (linkId: string, currentEnabled: boolean) => {
    try {
      await updateDoc(doc(db, 'gallery_selection_links', linkId), {
        enabled: !currentEnabled
      });
    } catch (err: any) {
      console.error('Error toggling link:', err);
      alert(`Eroare la schimbarea stării: ${err?.message || err}`);
    }
  };

  const handleDeleteSelectionLink = async (linkId: string) => {
    if (!window.confirm('Sigur dorești să ștergi acest link de selecție?')) return;
    try {
      await deleteDoc(doc(db, 'gallery_selection_links', linkId));
    } catch (err: any) {
      console.error('Error deleting link:', err);
      alert(`Eroare la ștergerea link-ului: ${err?.message || err}`);
    }
  };

  // Listen to Download Logs
  useEffect(() => {
    if (!galleryId) return;
    const q = query(collection(db, 'download_logs'), where('galleryId', '==', galleryId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Sort by downloaded date descending
      logs.sort((a: any, b: any) => {
        const t1 = a.downloadedAt?.toMillis ? a.downloadedAt.toMillis() : 0;
        const t2 = b.downloadedAt?.toMillis ? b.downloadedAt.toMillis() : 0;
        return t2 - t1;
      });
      setLogsList(logs);
    }, (err) => {
      console.error('Error listening to download logs:', err);
    });
    return () => unsubscribe();
  }, [galleryId]);

  // Handle Cover Photo Upload
  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    
    setIsUploadingCover(true);
    const tempId = galleryId || 'new_temp';
    const storagePath = `galleries/${tempId}/cover_${Date.now()}_${file.name}`;
    const storageRef = ref(storage, storagePath);
    
    try {
      const uploadTask = uploadBytesResumable(storageRef, file);
      
      await new Promise<void>((resolve, reject) => {
        uploadTask.on(
          'state_changed',
          null,
          (err) => reject(err),
          async () => {
            try {
              const url = await getDownloadURL(uploadTask.snapshot.ref);
              setCoverPhoto({
                url,
                path: storagePath,
                focalPoint: { x: 50, y: 50 }
              });
              setFocalPoint({ x: 50, y: 50 });
              resolve();
            } catch (urlErr) {
              reject(urlErr);
            }
          }
        );
      });
    } catch (err) {
      console.error('Cover upload error:', err);
      alert('Încărcarea imaginii de copertă a eșuat.');
    } finally {
      setIsUploadingCover(false);
    }
  };

  // Focal Point Picker
  const handleCoverClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!coverPhoto) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 100);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 100);
    setFocalPoint({ x, y });
  };

  // Add new Sub-Collection (Folder)
  const handleAddSubCollection = () => {
    const name = newSubName.trim();
    if (!name) return;
    
    const id = name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now();
    
    if (subCollections.some(sub => sub.name.toLowerCase() === name.toLowerCase())) {
      alert('O colecție cu acest nume există deja.');
      return;
    }
    
    const newSub: SubCollection = {
      id,
      name,
      photos: []
    };
    
    const updatedSubs = [...subCollections, newSub];
    setSubCollections(updatedSubs);
    saveSubCollectionsToFirestore(updatedSubs);
    setActiveSubId(id);
    setNewSubName('');
    setIsAddingSet(false);
  };

  // Remove Sub-Collection
  const handleRemoveSubCollection = async (id: string) => {
    if (subCollections.length <= 1) {
      alert('Trebuie să existe cel puțin o colecție.');
      return;
    }
    
    const sub = subCollections.find(s => s.id === id);
    if (sub && (sub.photos || []).length > 0) {
      if (!window.confirm(`Colecția "${sub.name}" conține ${(sub.photos || []).length} poze. Ești sigur că vrei să o ștergi cu tot cu fotografii?`)) {
        return;
      }

      // Delete each photo from Storage
      sub.photos.forEach(async (photo) => {
        try { await deleteObject(ref(storage, photo.path)); } catch {}
        if (photo.cleanPath && photo.cleanPath !== photo.path) {
          try { await deleteObject(ref(storage, photo.cleanPath)); } catch {}
        }
      });

      // Delete all photo documents from Firestore subcollection
      if (galleryId) {
        try {
          const photosSnap = await getDocs(
            collection(db, 'photo_galleries', galleryId, 'subcollections', id, 'photos')
          );
          const delBatch = writeBatch(db);
          photosSnap.docs.forEach(d => delBatch.delete(d.ref));
          await delBatch.commit();
        } catch (err) {
          console.warn('Could not delete photo subcollection docs:', err);
        }
      }
    }

    const updated = subCollections.filter(s => s.id !== id);
    setSubCollections(updated);
    saveSubCollectionsToFirestore(updated);
    if (activeSubId === id) {
      setActiveSubId(updated[0].id);
    }
  };

  // Drag and drop event handlers
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    
    const items = [...subCollections];
    const draggedItem = items[draggedIndex];
    items.splice(draggedIndex, 1);
    items.splice(index, 0, draggedItem);
    
    setDraggedIndex(index);
    setSubCollections(items);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    saveSubCollectionsToFirestore(subCollections);
  };

  // Start folder renaming
  const handleStartRename = (id: string, currentName: string) => {
    setRenamingSubId(id);
    setRenameValue(currentName);
  };

  // Save folder renaming
  const handleSaveRename = (id: string) => {
    const valClean = renameValue.trim();
    if (!valClean) {
      alert('Numele folderului nu poate fi gol.');
      return;
    }
    
    // Check if another collection has the same name
    if (subCollections.some(s => s.id !== id && s.name.toLowerCase() === valClean.toLowerCase())) {
      alert('Un folder cu acest nume există deja.');
      return;
    }

    setSubCollections(prev => {
      const next = prev.map(s => {
        if (s.id === id) {
          return {
            ...s,
            name: valClean
          };
        }
        return s;
      });
      saveSubCollectionsToFirestore(next);
      return next;
    });
    
    setRenamingSubId(null);
  };

  // Core Upload Logic supporting both file selector and drag-and-drop
  const processAndUploadFiles = async (filesArray: File[], targetSubIdOverride?: string) => {
    if (!filesArray || filesArray.length === 0) return;

    // Lock in targetSubId at the moment upload/drag starts
    const targetSubId = targetSubIdOverride || activeSubId;

    if (watermarkEnabled && !globalWatermark) {
      alert('Watermark-ul este activat, dar nu a fost încărcat niciun watermark implicit în setările globale de admin. Te rugăm să încarci mai întâi un watermark din pagina principală de admin sau să dezactivezi opțiunea.');
      return;
    }

    let currentGalleryId = galleryId;
    if (!currentGalleryId) {
      try {
        const docRef = await addDoc(collection(db, 'photo_galleries'), {
          title: title.trim() || 'Galerie fără titlu',
          subtitle: subtitle.trim(),
          date,
          coverPhoto: null,
          titleStyle: {
            fontFamily,
            fontSize,
            color: textColor,
            position: titlePosition
          },
          watermarkEnabled,
          watermarkPosition,
          watermarkOffsetX,
          watermarkOffsetY,
          subCollections,
          selectionEnabled,
          selectionMinPhotos,
          selectionMaxPhotos,
          createdAt: new Date()
        });
        currentGalleryId = docRef.id;
        navigate(`/admin/edit-photo-gallery/${docRef.id}`, { replace: true });
      } catch (err) {
        console.error("Failed to create gallery for upload:", err);
        alert("Eroare la crearea galeriei.");
        return;
      }
    }

    // --- Duplicate detection for the locked target folder ---
    const targetSub = subCollections.find(s => s.id === targetSubId);
    const existingNames = new Set((targetSub?.photos || []).map(p => p.name));
    const duplicateFiles = filesArray.filter(f => existingNames.has(f.name));
    const uniqueFiles = filesArray.filter(f => !existingNames.has(f.name));

    if (duplicateFiles.length > 0) {
      // Show modal and wait for user decision
      setDuplicateModal({
        visible: true,
        duplicateNames: duplicateFiles.map(f => f.name),
        newFiles: filesArray,
        uniqueFiles,
        pendingGalleryId: currentGalleryId,
        pendingSubId: targetSubId
      });
      return; // upload will be triggered by modal action
    }

    // No duplicates — proceed immediately with bound targetSubId
    startUpload(
      filesArray,
      currentGalleryId,
      targetSubId,
      watermarkEnabled,
      globalWatermark,
      watermarkPosition,
      watermarkOffsetX,
      watermarkOffsetY
    );
  };

  // Called when user resolves the duplicate modal
  const resolveDuplicateModal = (action: 'upload-all' | 'skip-duplicates' | 'cancel') => {
    if (!duplicateModal) return;
    const { newFiles, uniqueFiles, pendingGalleryId, pendingSubId } = duplicateModal;
    setDuplicateModal(null);
    if (action === 'cancel') return;
    const filesToUpload = action === 'skip-duplicates' ? uniqueFiles : newFiles;
    if (filesToUpload.length === 0) return;
    startUpload(
      filesToUpload,
      pendingGalleryId,
      pendingSubId,
      watermarkEnabled,
      globalWatermark,
      watermarkPosition,
      watermarkOffsetX,
      watermarkOffsetY
    );
  };

  const handlePhotosUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const filesArray = Array.from(e.target.files);
    await processAndUploadFiles(filesArray);
    if (photosInputRef.current) photosInputRef.current.value = '';
  };

  // Drag and drop events for file uploading
  const handleFileUploadDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const typesArray = Array.from(e.dataTransfer.types || []);
    const isFileDrag = typesArray.includes('Files');

    if (isFileDrag && !isDraggingFiles) {
      setIsDraggingFiles(true);
    }
  };

  const handleFileUploadDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDraggingFiles(false);
  };

  const handleFileUploadDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFiles(false);

    const items = e.dataTransfer.items;
    if (!items) {
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const droppedFiles = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
        if (droppedFiles.length > 0) {
          await processAndUploadFiles(droppedFiles);
        }
      }
      return;
    }

    const filesArray: File[] = [];

    const traverseFileTree = (item: any): Promise<void> => {
      return new Promise((resolve) => {
        if (item.isFile) {
          item.file((file: File) => {
            if (file.type.startsWith('image/')) {
              filesArray.push(file);
            }
            resolve();
          }, () => resolve());
        } else if (item.isDirectory) {
          const dirReader = item.createReader();
          const readEntries = () => {
            dirReader.readEntries((entries: any[]) => {
              if (entries.length === 0) {
                resolve();
              } else {
                const promises = entries.map(entry => traverseFileTree(entry));
                Promise.all(promises).then(() => {
                  readEntries();
                });
              }
            }, () => resolve());
          };
          readEntries();
        } else {
          resolve();
        }
      });
    };

    const traversePromises: Promise<void>[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i].webkitGetAsEntry();
      if (item) {
        traversePromises.push(traverseFileTree(item));
      }
    }

    await Promise.all(traversePromises);
    if (filesArray.length > 0) {
      await processAndUploadFiles(filesArray);
    }
  };

  // Delete individual photo
  const handleDeletePhoto = async (subId: string, photoPath: string) => {
    if (!window.confirm('Ești sigur că vrei să ștergi această fotografie din colecție?')) return;

    try {
      // 1. Delete from Firebase Storage
      try { await deleteObject(ref(storage, photoPath)); } catch {}

      // Also delete the clean version if it differs
      const sub = subCollections.find(s => s.id === subId);
      const photo = sub?.photos.find(p => p.path === photoPath);
      if (photo?.cleanPath && photo.cleanPath !== photoPath) {
        try { await deleteObject(ref(storage, photo.cleanPath)); } catch {}
      }

      // 2. Delete from Firestore subcollection
      if (galleryId && photo?.firestoreId) {
        await deleteDoc(doc(db, 'photo_galleries', galleryId, 'subcollections', subId, 'photos', photo.firestoreId));
      }

      // 3. Update local state (no Firestore write needed — photos live in subcollection now)
      setSubCollections(prev =>
        prev.map(s =>
          s.id === subId
            ? { ...s, photos: s.photos.filter(p => p.path !== photoPath) }
            : s
        )
      );
    } catch (err) {
      console.error('Error deleting photo:', err);
      alert('Ștergerea fotografiei a eșuat.');
    }
  };

  // Toggle selection of photo (supports Shift+Click for ranges)
  const handleToggleSelectPhoto = (photoPath: string, isShiftPressed = false) => {
    const activeSub = subCollections.find(s => s.id === activeSubId);
    if (!activeSub) return;

    if (isShiftPressed && lastSelectedPhotoPath) {
      const idx1 = activeSub.photos.findIndex(p => p.path === lastSelectedPhotoPath);
      const idx2 = activeSub.photos.findIndex(p => p.path === photoPath);

      if (idx1 !== -1 && idx2 !== -1) {
        const start = Math.min(idx1, idx2);
        const end = Math.max(idx1, idx2);
        const rangePaths = activeSub.photos.slice(start, end + 1).map(p => p.path);

        setSelectedPhotoPaths(prev => {
          const newSelection = [...prev];
          rangePaths.forEach(path => {
            if (!newSelection.includes(path)) {
              newSelection.push(path);
            }
          });
          return newSelection;
        });
        setLastSelectedPhotoPath(photoPath);
        return;
      }
    }

    // Normal click toggle
    setSelectedPhotoPaths(prev => {
      const isSelected = prev.includes(photoPath);
      if (isSelected) {
        setLastSelectedPhotoPath(null);
        return prev.filter(p => p !== photoPath);
      } else {
        setLastSelectedPhotoPath(photoPath);
        return [...prev, photoPath];
      }
    });
  };

  // Drag and Drop reordering handlers
  const handlePhotoDragStart = (e: React.DragEvent, index: number) => {
    setDraggedPhotoIndex(index);
    e.dataTransfer.setData('text/plain', index.toString());
    e.dataTransfer.effectAllowed = 'move';

    const activeSub = subCollections.find(s => s.id === activeSubId);
    if (!activeSub) return;

    const draggedPhoto = activeSub.photos[index];
    const isDraggedPhotoSelected = selectedPhotoPaths.includes(draggedPhoto.path);

    // If multiple photos are selected and we drag one of them, create a custom stacked ghost element
    if (isDraggedPhotoSelected && selectedPhotoPaths.length > 1) {
      const count = selectedPhotoPaths.length;
      
      const ghost = document.createElement('div');
      ghost.style.position = 'absolute';
      ghost.style.top = '-1000px';
      ghost.style.left = '-1000px';
      ghost.style.display = 'flex';
      ghost.style.alignItems = 'center';
      ghost.style.justifyContent = 'center';
      ghost.style.width = '120px';
      ghost.style.height = '120px';
      ghost.style.pointerEvents = 'none';

      // Create a visual stack of cards (3 cards offset)
      const maxStacked = Math.min(3, count);
      for (let i = 0; i < maxStacked; i++) {
        const card = document.createElement('div');
        card.style.position = 'absolute';
        card.style.width = '90px';
        card.style.height = '90px';
        card.style.borderRadius = '6px';
        card.style.border = '2px solid #D4AF37';
        card.style.backgroundColor = '#1C1A19';
        
        // Find selected photo URLs
        const selectedPhotos = activeSub.photos.filter(p => selectedPhotoPaths.includes(p.path));
        if (selectedPhotos[i]) {
          card.style.backgroundImage = `url(${selectedPhotos[i].url})`;
        } else if (selectedPhotos[0]) {
          card.style.backgroundImage = `url(${selectedPhotos[0].url})`;
        }
        
        card.style.backgroundSize = 'cover';
        card.style.backgroundPosition = 'center';
        
        card.style.transform = `translate(${i * 6}px, ${i * 6}px) rotate(${i * 4 - 4}deg)`;
        card.style.zIndex = (10 - i).toString();
        card.style.opacity = (1 - i * 0.15).toString();
        ghost.appendChild(card);
      }

      // Add a count badge
      const badge = document.createElement('div');
      badge.innerText = `${count} imagini`;
      badge.style.position = 'absolute';
      badge.style.bottom = '10px';
      badge.style.right = '10px';
      badge.style.backgroundColor = '#5f0b02';
      badge.style.color = '#FAF9F6';
      badge.style.padding = '4px 8px';
      badge.style.borderRadius = '20px';
      badge.style.fontSize = '10px';
      badge.style.fontWeight = 'bold';
      badge.style.border = '1px solid #D4AF37';
      badge.style.zIndex = '20';
      badge.style.boxShadow = '0 2px 6px rgba(0,0,0,0.5)';
      ghost.appendChild(badge);

      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 60, 60);

      setTimeout(() => {
        ghost.remove();
      }, 0);
    }
  };

  const handlePhotoDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handlePhotoDragLeave = (index: number) => {
    setDragOverIndex(prev => prev === index ? null : prev);
  };

  const handlePhotoDragEnd = () => {
    setDraggedPhotoIndex(null);
    setDragOverIndex(null);
  };

  const handlePhotoDrop = async (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    const sourceIndex = draggedPhotoIndex !== null ? draggedPhotoIndex : parseInt(e.dataTransfer.getData('text/plain'));
    
    setDraggedPhotoIndex(null);
    setDragOverIndex(null);

    if (sourceIndex === null || isNaN(sourceIndex) || sourceIndex === targetIndex) {
      return;
    }

    const activeSub = subCollections.find(s => s.id === activeSubId);
    if (!activeSub) {
      return;
    }

    const draggedPhoto = activeSub.photos[sourceIndex];
    const isDraggedPhotoSelected = selectedPhotoPaths.includes(draggedPhoto.path);

    let reorderedPhotos = [...activeSub.photos];

    if (isDraggedPhotoSelected && selectedPhotoPaths.length > 1) {
      const targetPhoto = reorderedPhotos[targetIndex];
      const selectedPhotos = reorderedPhotos.filter(p => selectedPhotoPaths.includes(p.path));
      reorderedPhotos = reorderedPhotos.filter(p => !selectedPhotoPaths.includes(p.path));

      let newTargetIndex = reorderedPhotos.indexOf(targetPhoto);
      if (newTargetIndex === -1) {
        newTargetIndex = targetIndex;
      }

      reorderedPhotos.splice(newTargetIndex, 0, ...selectedPhotos);
    } else {
      const [removedPhoto] = reorderedPhotos.splice(sourceIndex, 1);
      reorderedPhotos.splice(targetIndex, 0, removedPhoto);
    }

    // Update local state immediately for snappy UX
    setSubCollections(prev =>
      prev.map(sub =>
        sub.id === activeSubId
          ? { ...sub, photos: reorderedPhotos, hasManualOrder: true }
          : sub
      )
    );

    // Persist new order to Firestore subcollection (batch update order field)
    if (galleryId) {
      try {
        const BATCH_LIMIT = 499;
        let savedCount = 0;
        for (let i = 0; i < reorderedPhotos.length; i += BATCH_LIMIT) {
          const orderBatch = writeBatch(db);
          reorderedPhotos.slice(i, i + BATCH_LIMIT).forEach((photo, idx) => {
            if (photo.firestoreId) {
              const photoRef = doc(
                db, 'photo_galleries', galleryId,
                'subcollections', activeSubId,
                'photos', photo.firestoreId
              );
              // Use set+merge instead of update: update throws NOT_FOUND if doc doesn't exist,
              // while set+merge safely creates or patches the document.
              orderBatch.set(photoRef, { order: i + idx }, { merge: true });
              savedCount++;
            }
          });
          await orderBatch.commit();
        }
        // Mark this subfolder as having a custom order in the main doc metadata.
        // IMPORTANT: Firestore rejects `undefined` values (throws invalid-argument).
        // We must strip undefined from the spread and use ?? defaults.
        const subsMeta = subCollections.map(({ photos, ...meta }) => {
          const cleaned: Record<string, any> = {};
          for (const [k, v] of Object.entries(meta)) {
            if (v !== undefined) cleaned[k] = v;  // strip undefined values
          }
          return {
            ...cleaned,
            photoCount: (photos || []).length,
            hasManualOrder: meta.id === activeSubId ? true : (meta.hasManualOrder ?? false),
          };
        });
        await updateDoc(doc(db, 'photo_galleries', galleryId), { subCollections: subsMeta });

        if (savedCount === 0 && reorderedPhotos.length > 0) {
          // All photos lack firestoreId — they are in the old embedded format.
          // Order was not persisted. Instruct admin to re-upload or migrate.
          alert('Atenție: Ordinea nu a putut fi salvată deoarece aceste poze sunt în formatul vechi (fără ID Firestore). Re-uploadează pozele în această galerie pentru a activa reordonarea.');
        }
      } catch (err: any) {
        const code = err?.code || err?.message || String(err);
        console.error('Error saving photo order:', err);
        alert(`Eroare la salvarea ordinii (${code}). Încearcă din nou sau reîncarcă pagina.`);
      }
    }
  };

  const handlePrevPhoto = () => {
    const activeSub = subCollections.find(s => s.id === activeSubId);
    if (!activeSub || !activeSub.photos || activeSub.photos.length === 0) return;
    const newIdx = (previewPhotoIndex - 1 + activeSub.photos.length) % activeSub.photos.length;
    setPreviewPhotoIndex(newIdx);
    setPreviewPhotoUrl(activeSub.photos[newIdx].url);
  };

  const handleNextPhoto = () => {
    const activeSub = subCollections.find(s => s.id === activeSubId);
    if (!activeSub || !activeSub.photos || activeSub.photos.length === 0) return;
    const newIdx = (previewPhotoIndex + 1) % activeSub.photos.length;
    setPreviewPhotoIndex(newIdx);
    setPreviewPhotoUrl(activeSub.photos[newIdx].url);
  };



  // Reorder all photos in current folder A-Z by name
  const handleReorderAZ = async () => {
    const activeSub = subCollections.find(s => s.id === activeSubId);
    if (!galleryId || !activeSubId || !activeSub || !activeSub.photos || activeSub.photos.length === 0) return;
    setIsReorderingAZ(true);
    try {
      const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
      const sortedPhotos = [...activeSub.photos].sort((a, b) => collator.compare(a.name, b.name));

      // Update local state immediately for snappy UX
      setSubCollections(prev =>
        prev.map(sub =>
          sub.id === activeSubId
            ? { ...sub, photos: sortedPhotos, hasManualOrder: true }
            : sub
        )
      );

      // Persist new order in Firestore subcollection
      await forceReorderByName(galleryId, activeSubId);

      // Update main gallery document metadata
      const subsMeta = subCollections.map(({ photos, ...meta }) => {
        const cleaned: Record<string, any> = {};
        for (const [k, v] of Object.entries(meta)) {
          if (v !== undefined) cleaned[k] = v;
        }
        return {
          ...cleaned,
          photoCount: (photos || []).length,
          hasManualOrder: meta.id === activeSubId ? true : (meta.hasManualOrder ?? false),
        };
      });
      await updateDoc(doc(db, 'photo_galleries', galleryId), { subCollections: subsMeta });
    } catch (err) {
      console.error('Error sorting photos A-Z:', err);
      alert('A apărut o eroare la ordonarea fotografiilor A-Z.');
    } finally {
      setIsReorderingAZ(false);
    }
  };

  // Select all or deselect all photos in current folder
  const handleSelectAll = () => {
    const activeSub = subCollections.find(s => s.id === activeSubId);
    if (!activeSub) return;
    const allPaths = activeSub.photos.map(p => p.path);
    const isAllSelected = allPaths.length > 0 && allPaths.every(path => selectedPhotoPaths.includes(path));
    
    if (isAllSelected) {
      setSelectedPhotoPaths([]);
    } else {
      setSelectedPhotoPaths(allPaths);
    }
  };

  // Bulk delete selected photos
  const handleBulkDelete = async () => {
    if (selectedPhotoPaths.length === 0) return;
    
    if (!window.confirm(`Ești sigur că dorești să ștergi cele ${selectedPhotoPaths.length} fotografii selectate? Această acțiune este ireversibilă.`)) {
      return;
    }
    
    setIsSaving(true);

    try {
      const activeSub = subCollections.find(s => s.id === activeSubId);
      const photosToDelete = activeSub?.photos.filter(p => selectedPhotoPaths.includes(p.path)) || [];

      // 1. Delete from Firebase Storage
      for (const photo of photosToDelete) {
        try { await deleteObject(ref(storage, photo.path)); } catch {}
        if (photo.cleanPath && photo.cleanPath !== photo.path) {
          try { await deleteObject(ref(storage, photo.cleanPath)); } catch {}
        }
      }

      // 2. Delete from Firestore subcollection (batch)
      if (galleryId) {
        const BATCH_LIMIT = 499;
        const photosWithId = photosToDelete.filter(p => p.firestoreId);
        for (let i = 0; i < photosWithId.length; i += BATCH_LIMIT) {
          const delBatch = writeBatch(db);
          photosWithId.slice(i, i + BATCH_LIMIT).forEach(photo => {
            delBatch.delete(doc(
              db, 'photo_galleries', galleryId,
              'subcollections', activeSubId,
              'photos', photo.firestoreId!
            ));
          });
          await delBatch.commit();
        }
      }

      // 3. Update local state
      setSubCollections(prev =>
        prev.map(sub =>
          sub.id === activeSubId
            ? { ...sub, photos: sub.photos.filter(p => !selectedPhotoPaths.includes(p.path)) }
            : sub
        )
      );

      setSelectedPhotoPaths([]);
    } catch (err) {
      console.error('Error during bulk deletion:', err);
      alert('A apărut o eroare la ștergerea fotografiilor.');
    } finally {
      setIsSaving(false);
    }
  };

  // Keyboard Shortcuts: Ctrl+A / Cmd+A (Select All), Delete/Backspace (Bulk Delete), Esc (Deselect/Close), Arrow Keys (Lightbox)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInputActive = activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.getAttribute('contenteditable') === 'true'
      );

      if (previewPhotoIndex !== -1) {
        if (e.key === 'ArrowLeft') {
          handlePrevPhoto();
        } else if (e.key === 'ArrowRight') {
          handleNextPhoto();
        } else if (e.key === 'Escape') {
          setPreviewPhotoUrl(null);
          setPreviewPhotoIndex(-1);
        }
        return;
      }

      if (isPreviewWatermarkLarge) {
        if (e.key === 'Escape') {
          setIsPreviewWatermarkLarge(false);
        }
        return;
      }

      if (!isInputActive) {
        // Ctrl + A or Cmd + A => Select all photos in current active folder
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
          e.preventDefault();
          const activeSub = subCollections.find(s => s.id === activeSubId);
          if (activeSub && activeSub.photos.length > 0) {
            setSelectedPhotoPaths(activeSub.photos.map(p => p.path));
          }
        }
        // Escape => Deselect all photos if selected
        else if (e.key === 'Escape' && selectedPhotoPaths.length > 0) {
          e.preventDefault();
          setSelectedPhotoPaths([]);
        }
        // Delete or Backspace => Trigger bulk delete for selected photos
        else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedPhotoPaths.length > 0) {
          e.preventDefault();
          handleBulkDelete();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewPhotoIndex, isPreviewWatermarkLarge, subCollections, activeSubId, selectedPhotoPaths]);

  // Retroactive watermark processing
  const handleApplyWatermarkToExisting = async () => {
    if (!globalWatermark) {
      alert('Te rugăm să încarci un watermark implicit în setările de admin mai întâi.');
      return;
    }
    
    const totalPhotos = subCollections.reduce((acc, sub) => acc + (sub.photoCount || (sub.photos || []).length), 0);
    if (totalPhotos === 0) {
      alert('Nu există nicio fotografie în galerie pe care să o procesăm.');
      return;
    }
    
    if (!window.confirm(`Această acțiune va descărca, aplica watermark-ul și re-încărca toate cele ${totalPhotos} poze din galerie conform poziției "${watermarkPosition}". Durează câteva secunde. Dorești să continui?`)) {
      return;
    }
    
    setIsProcessingWatermark(true);
    setProcessingProgress({ current: 0, total: totalPhotos });
    
    let processedCount = 0;
    
    try {
      const updatedSubCollections = [...subCollections];
      
      for (let i = 0; i < updatedSubCollections.length; i++) {
        const sub = updatedSubCollections[i];
        const updatedPhotos = [...sub.photos];
        
        for (let j = 0; j < updatedPhotos.length; j++) {
          const photo = updatedPhotos[j];
          
          try {
            const sourceUrl = photo.cleanUrl || photo.url;
            const res = await fetch(sourceUrl);
            const blob = await res.blob();
            
            const fileObj = new File([blob], photo.name, { type: 'image/jpeg' });
            const watermarkedBlob = await applyWatermark(
              fileObj, 
              globalWatermark.url, 
              watermarkPosition, 
              watermarkOffsetX, 
              watermarkOffsetY
            );
            
            let targetPath = photo.path;
            // If they share the same path, generate a new path for the watermarked file to protect the clean original
            if (photo.cleanPath && targetPath === photo.cleanPath) {
              const lastSlashIdx = photo.cleanPath.lastIndexOf('/');
              if (lastSlashIdx !== -1) {
                const dir = photo.cleanPath.substring(0, lastSlashIdx + 1);
                const file = photo.cleanPath.substring(lastSlashIdx + 1);
                targetPath = `${dir}wm_${file}`;
              } else {
                targetPath = `wm_${photo.cleanPath}`;
              }
            }

            const storageRef = ref(storage, targetPath);
            await uploadBytesResumable(storageRef, watermarkedBlob);
            
            const newUrl = await getDownloadURL(storageRef);
            
            updatedPhotos[j] = {
              ...photo,
              url: newUrl,
              path: targetPath
            };
          } catch (itemErr) {
            console.error(`Error watermarking existing photo ${photo.name}:`, itemErr);
          }
          
          processedCount++;
          setProcessingProgress({ current: processedCount, total: totalPhotos });
        }
        
        updatedSubCollections[i] = {
          ...sub,
          photos: updatedPhotos
        };
      }
      
      setSubCollections(updatedSubCollections);

      // Save updated photo urls/paths to each photo document in the subcollection
      if (galleryId) {
        const BATCH_LIMIT = 499;
        for (const sub of updatedSubCollections) {
          for (let i = 0; i < sub.photos.length; i += BATCH_LIMIT) {
            const wmBatch = writeBatch(db);
            sub.photos.slice(i, i + BATCH_LIMIT).forEach(photo => {
              if (photo.firestoreId) {
                const photoRef = doc(
                  db, 'photo_galleries', galleryId,
                  'subcollections', sub.id,
                  'photos', photo.firestoreId
                );
                wmBatch.update(photoRef, {
                  url: photo.url,
                  path: photo.path,
                  cleanUrl: photo.cleanUrl || null,
                  cleanPath: photo.cleanPath || null,
                });
              }
            });
            await wmBatch.commit();
          }
        }

        // Save gallery metadata (without photos)
        const cleanTitle = title.trim();
        const payload: any = {
          title: cleanTitle || 'Galerie Fără Titlu',
          subtitle: subtitle.trim(),
          date,
          coverPhoto: coverPhoto ? { ...coverPhoto, focalPoint } : null,
          titleStyle: { fontFamily, fontSize, color: textColor, position: titlePosition },
          watermarkEnabled: true,
          watermarkPosition,
          watermarkOffsetX,
          watermarkOffsetY,
        };
        await setDoc(doc(db, 'photo_galleries', galleryId), payload, { merge: true });
      }
      
      alert('Watermark-ul a fost aplicat cu succes pe toate fotografiile existente și galeria a fost salvată!');
    } catch (err) {
      console.error('Error applying watermark to existing:', err);
      alert('A apărut o eroare la procesarea fotografiilor.');
    } finally {
      setIsProcessingWatermark(false);
    }
  };

  // Generates compressed preview versions (~1200px) for ALL existing photos that don't have them yet.
  // Non-destructive: only adds previewUrl / previewCleanUrl fields to Firestore docs.
  // Full-res originals are never touched.
  const handleGeneratePreviews = async () => {
    if (isGeneratingPreviews || !galleryId) return;

    // Collect photos that don't yet have preview URLs
    const toProcess: Array<{ subId: string; photoDocId: string; sourceUrl: string; name: string }> = [];

    for (const sub of subCollections) {
      try {
        const photosSnap = await getDocs(
          collection(db, 'photo_galleries', galleryId, 'subcollections', sub.id, 'photos')
        );
        for (const pDoc of photosSnap.docs) {
          const d = pDoc.data();
          if (!d.previewUrl) {
            toProcess.push({
              subId: sub.id,
              photoDocId: pDoc.id,
              sourceUrl: d.cleanUrl || d.url,  // prefer clean as source
              name: d.name || pDoc.id,
            });
          }
        }
      } catch (e) {
        console.error('Error reading photos for preview gen:', e);
      }
    }

    if (toProcess.length === 0) {
      alert('Toate pozele au deja preview-uri generate! Noile poze încărcate primesc automat preview-uri.');
      return;
    }

    const confirmed = window.confirm(
      `Vor fi generate versiuni comprimate (~1200px) pentru ${toProcess.length} poze.\n\n` +
      `Pozele originale NU vor fi modificate sau șterse.\n\nContinuați?`
    );
    if (!confirmed) return;

    setIsGeneratingPreviews(true);
    setPreviewGenProgress({ current: 0, total: toProcess.length });
    let processed = 0;

    for (const item of toProcess) {
      try {
        const response = await fetch(item.sourceUrl);
        const blob = await response.blob();
        const file = new File([blob], item.name, { type: blob.type || 'image/jpeg' });

        const ts = Date.now();

        // Preview clean (no watermark, ~1200px)
        const previewCleanBlob = await applyWatermark(
          file, null, watermarkPosition, watermarkOffsetX, watermarkOffsetY, 1200, 0.78
        );
        const previewCleanPath = `galleries/${galleryId}/${item.subId}/prev_${ts}_${item.name}`;
        const previewCleanRef = ref(storage, previewCleanPath);
        await uploadBytesResumable(previewCleanRef, previewCleanBlob);
        const previewCleanUrl = await getDownloadURL(previewCleanRef);

        let previewUrl = previewCleanUrl;
        let previewPath = previewCleanPath;

        // Preview watermarked if gallery has watermark enabled
        if (watermarkEnabled && globalWatermark) {
          const previewWmBlob = await applyWatermark(
            file, globalWatermark.url, watermarkPosition, watermarkOffsetX, watermarkOffsetY, 1200, 0.78
          );
          const previewWmPath = `galleries/${galleryId}/${item.subId}/prevwm_${ts}_${item.name}`;
          const previewWmRef = ref(storage, previewWmPath);
          await uploadBytesResumable(previewWmRef, previewWmBlob);
          previewUrl = await getDownloadURL(previewWmRef);
          previewPath = previewWmPath;
        }

        // Update Firestore — add preview fields without touching anything else
        await updateDoc(
          doc(db, 'photo_galleries', galleryId, 'subcollections', item.subId, 'photos', item.photoDocId),
          { previewUrl, previewPath, previewCleanUrl, previewCleanPath }
        );
      } catch (err) {
        console.error(`[Preview Gen] Failed for ${item.name}:`, err);
      }

      processed++;
      setPreviewGenProgress({ current: processed, total: toProcess.length });
      await new Promise(r => setTimeout(r, 30)); // small breathing room for the browser
    }

    setIsGeneratingPreviews(false);
    alert(`Preview-uri generate: ${processed}/${toProcess.length} poze procesate cu succes.`);
  };

  // Original photos restoration handler
  const handleRestoreOriginals = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (!galleryId) {
      alert('Te rugăm să introduci un titlu și să aștepți crearea galeriei înainte de a restaura originale.');
      return;
    }

    const filesArray = Array.from(files);
    setIsRestoring(true);
    setRestoreMessage('Scanare fișiere locale...');
    setRestoreProgress({ current: 0, total: filesArray.length, matched: 0 });

    // Build a map of filenames to subcollection and photo index for quick lookup
    const photoMap = new Map<string, Array<{ subId: string; subName: string; photoIndex: number; photo: PhotoItem }>>();

    subCollections.forEach((sub) => {
      sub.photos.forEach((photo, photoIndex) => {
        const nameKey = photo.name.toLowerCase();
        if (!photoMap.has(nameKey)) {
          photoMap.set(nameKey, []);
        }
        photoMap.get(nameKey)!.push({ subId: sub.id, subName: sub.name, photoIndex, photo });
      });
    });

    // Find matches
    const matches: Array<{ file: File; targets: Array<{ subId: string; subName: string; photoIndex: number; photo: PhotoItem }> }> = [];
    filesArray.forEach((file) => {
      const nameKey = file.name.toLowerCase();
      if (photoMap.has(nameKey)) {
        matches.push({ file, targets: photoMap.get(nameKey)! });
      }
    });

    const totalMatched = matches.length;
    setRestoreProgress(prev => ({ ...prev, matched: totalMatched }));

    if (totalMatched === 0) {
      alert('Niciun fișier selectat nu s-a potrivit cu numele pozelor din baza de date a acestei galerii. Te rugăm să te asiguri că fișierele selectate au exact aceleași denumiri (ex: XIA06429-2.jpg).');
      setIsRestoring(false);
      return;
    }

    setRestoreMessage(`Am găsit ${totalMatched} poze potrivite. Se începe încărcarea...`);

    let updatedSubCollections = [...subCollections];
    let uploadCount = 0;

    const batchSize = 4;
    for (let i = 0; i < matches.length; i += batchSize) {
      const batch = matches.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async ({ file, targets }) => {
        try {
          const cleanBlob = await applyWatermark(
            file,
            null, // No watermark for clean version
            'bottom-right',
            0,
            0,
            4096, // High resolution for print/social
            0.92  // High quality details
          );

          const firstTarget = targets[0];
          const cleanStoragePath = `galleries/${galleryId}/${firstTarget.subId}/clean_${Date.now()}_${file.name}`;
          const cleanStorageRef = ref(storage, cleanStoragePath);

          await uploadBytesResumable(cleanStorageRef, cleanBlob);
          const cleanUrl = await getDownloadURL(cleanStorageRef);

          targets.forEach((t) => {
            const subColIdx = updatedSubCollections.findIndex(s => s.id === t.subId);
            if (subColIdx !== -1) {
              const subPhotos = [...updatedSubCollections[subColIdx].photos];
              if (subPhotos[t.photoIndex]) {
                subPhotos[t.photoIndex] = {
                  ...subPhotos[t.photoIndex],
                  cleanUrl,
                  cleanPath: cleanStoragePath
                };
                updatedSubCollections[subColIdx] = {
                  ...updatedSubCollections[subColIdx],
                  photos: subPhotos
                };
              }
            }
          });
        } catch (uploadErr) {
          console.error(`Error uploading clean original for ${file.name}:`, uploadErr);
        } finally {
          uploadCount++;
          setRestoreProgress(prev => ({ ...prev, current: uploadCount }));
        }
      });

      await Promise.all(batchPromises);
    }

    setSubCollections(updatedSubCollections);

    setRestoreMessage('Salvare date în baza de date...');
    try {
      // Update only the changed photo documents in subcollections
      const BATCH_LIMIT = 499;
      for (const sub of updatedSubCollections) {
        for (let i = 0; i < sub.photos.length; i += BATCH_LIMIT) {
          const restoreBatch = writeBatch(db);
          sub.photos.slice(i, i + BATCH_LIMIT).forEach(photo => {
            if (photo.firestoreId) {
              const photoRef = doc(
                db, 'photo_galleries', galleryId!,
                'subcollections', sub.id,
                'photos', photo.firestoreId
              );
              restoreBatch.update(photoRef, {
                cleanUrl: photo.cleanUrl || null,
                cleanPath: photo.cleanPath || null,
              });
            }
          });
          await restoreBatch.commit();
        }
      }

      setRestoreMessage(`Finalizat! S-au restaurat cu succes ${totalMatched} fotografii fără watermark.`);
      alert(`Restaurare finalizată! S-au re-încărcat versiunile fără watermark pentru ${totalMatched} fotografii.`);
    } catch (saveErr) {
      console.error('Error saving restored subcollections to firestore:', saveErr);
      setRestoreMessage('Eroare la salvare.');
    } finally {
      setTimeout(() => {
        setIsRestoring(false);
        setRestoreMessage('');
      }, 5000);
    }
  };



  // Toggle selection reviewed/pending status
  const toggleSelectionStatus = async (selectionId: string, currentStatus: string) => {
    try {
      const nextStatus = currentStatus === 'reviewed' ? 'pending' : 'reviewed';
      await updateDoc(doc(db, 'gallery_selections', selectionId), { status: nextStatus });
    } catch (err) {
      console.error('Error updating selection status:', err);
      alert('Actualizarea stării a eșuat.');
    }
  };

  // Helper: Convert a colored image blob to grayscale using HTML5 canvas
  const convertBlobToGrayscale = (blob: Blob): Promise<Blob> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(blob);
          return;
        }
        ctx.filter = 'grayscale(100%)';
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((b) => {
          if (b) resolve(b);
          else resolve(blob);
        }, blob.type);
      };
      img.onerror = () => resolve(blob);
      img.src = URL.createObjectURL(blob);
    });
  };

  // Download all selections as a ZIP archive
  const downloadSelectionZip = async (selection: any, index: number) => {
    if (!selection.albumPhotos || selection.albumPhotos.length === 0) {
      alert('Această selecție nu are poze de album.');
      return;
    }

    setZipProgress(0);
    try {
      const zip = new JSZip();
      const folderName = `Selectie_${selectionsList.length - index}`;
      const folder = zip.folder(folderName);

      // Add cover photo if exists
      if (selection.coverPhoto?.url) {
        setZipProgress(5);
        try {
          const coverUrl = selection.coverPhoto.cleanUrl || selection.coverPhoto.url;
          const res = await fetch(coverUrl);
          let blob = await res.blob();
          if (selection.coverPhoto.bw) {
            blob = await convertBlobToGrayscale(blob);
          }
          const coverExt = selection.coverPhoto.name.split('.').pop() || 'jpg';
          folder?.file(`COPERTA_album.${coverExt}`, blob);
        } catch (coverErr) {
          console.error('Error fetching cover photo for zip:', coverErr);
        }
      }

      // Add album photos
      const total = selection.albumPhotos.length;
      for (let i = 0; i < total; i++) {
        const photo = selection.albumPhotos[i];
        try {
          const photoUrl = photo.cleanUrl || photo.url;
          const res = await fetch(photoUrl);
          let blob = await res.blob();
          if (photo.bw) {
            blob = await convertBlobToGrayscale(blob);
          }
          const paddedIdx = String(i + 1).padStart(3, '0');
          folder?.file(`${paddedIdx}_${photo.name}`, blob);
        } catch (photoErr) {
          console.error(`Error downloading photo ${photo.name} for zip:`, photoErr);
        }
        setZipProgress(Math.round(10 + (i / total) * 80));
      }

      setZipProgress(95);
      const content = await zip.generateAsync({ type: 'blob' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = `${title.replace(/\s+/g, '_')}_${folderName}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setZipProgress(100);
      
      setTimeout(() => setZipProgress(null), 1000);
    } catch (err) {
      console.error('Error generating zip:', err);
      alert('Generarea arhivei ZIP a eșuat.');
      setZipProgress(null);
    }
  };

  if (loadingError) {
    return (
      <div className="admin-wrapper" data-theme="dark" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '24px' }}>
        <div style={{ padding: '32px', backgroundColor: '#1C1A19', borderRadius: '8px', border: '1px solid #262423', textAlign: 'center', maxWidth: '400px' }}>
          <X size={48} style={{ color: '#E06C75', marginBottom: '16px' }} />
          <h3>A apărut o eroare</h3>
          <p style={{ color: '#706E6A', margin: '8px 0 24px' }}>{loadingError}</p>
          <Link to="/admin/dashboard" className="btn btn-primary" style={{ padding: '8px 24px', fontSize: '13px' }}>Înapoi la Panou</Link>
        </div>
      </div>
    );
  }

  const activeSub = subCollections.find(s => s.id === activeSubId) || subCollections[0];

  const getAlignmentStyle = (pos: TitleStyle['position']): React.CSSProperties => {
    switch (pos) {
      case 'bottom-left':
        return { bottom: '20px', left: '20px', textAlign: 'left' };
      case 'bottom-center':
        return { bottom: '20px', left: '50%', transform: 'translateX(-50%)', textAlign: 'center' };
      case 'center':
        return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' };
      case 'top-center':
        return { top: '20px', left: '50%', transform: 'translateX(-50%)', textAlign: 'center' };
      default:
        return { bottom: '20px', left: '20px', textAlign: 'left' };
    }
  };

  return (
    <div className="admin-wrapper" data-theme="dark" style={{ height: '100vh', maxHeight: '100vh', overflow: 'hidden', backgroundColor: '#121110', color: '#F3EDE7', display: 'flex', flexDirection: 'column' }}>
      
      {/* 1. TOP STICKY BAR */}
      <header style={{ height: '64px', borderBottom: '1px solid #262423', backgroundColor: '#161514', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button 
            onClick={() => navigate('/admin/dashboard')} 
            style={{ background: 'none', border: 'none', color: '#FAF9F6', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px' }}
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '14px', fontWeight: 600, color: '#FAF9F6' }}>
                {title || 'Galerie Fără Titlu'}
              </span>
            </div>
            <div style={{ fontSize: '11px', color: '#706E6A', marginTop: '2px' }}>
              Creată la: {date}
            </div>
          </div>
        </div>

        {isEdit && (
          <div style={{ display: 'flex', gap: '4px', backgroundColor: '#0E0D0C', padding: '4px', borderRadius: '8px', border: '1px solid #262423' }}>
            <button
              onClick={() => setActiveMainTab('editor')}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 600,
                backgroundColor: activeMainTab === 'editor' ? '#5f0b02' : 'transparent',
                color: '#FAF9F6',
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              Editor Galerie
            </button>
            <button
              onClick={() => setActiveMainTab('selections')}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 600,
                backgroundColor: activeMainTab === 'selections' ? '#5f0b02' : 'transparent',
                color: '#FAF9F6',
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              Selecții Clienți ({selectionsList.length})
            </button>
            <button
              onClick={() => setActiveMainTab('logs')}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 600,
                backgroundColor: activeMainTab === 'logs' ? '#5f0b02' : 'transparent',
                color: '#FAF9F6',
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              Loguri Descărcare ({logsList.length})
            </button>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {isEdit && (
            <a 
              href={`/p-gallery/${galleryId}`} 
              target="_blank" 
              rel="noreferrer" 
              className="btn btn-secondary btn-sm"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '36px', textDecoration: 'none' }}
            >
              <Eye size={14} /> Previzualizare Live
            </a>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: '4px', fontSize: '12px' }}>
            {saveStatus === 'saving' && (
              <>
                <RefreshCw size={12} className="spinner" style={{ color: '#D4AF37' }} />
                <span style={{ color: '#A09A94' }}>Se salvează...</span>
              </>
            )}
            {saveStatus === 'saved' && title.trim() && (
              <>
                <Check size={12} style={{ color: '#2ECC71' }} />
                <span style={{ color: '#2ECC71', fontWeight: 500 }}>Modificări salvate</span>
              </>
            )}
            {saveStatus === 'error' && (
              <>
                <AlertCircle size={12} style={{ color: '#E74C3C' }} />
                <span style={{ color: '#E74C3C', fontWeight: 500 }}>Eroare la salvare</span>
              </>
            )}
            {!title.trim() && (
              <span style={{ color: '#706E6A' }}>Așteptare titlu...</span>
            )}
          </div>
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1, height: 'calc(100vh - 64px)', overflow: 'hidden' }}>
        
        {activeMainTab === 'editor' && (
          <>
            {/* SIDEBAR TABS PANEL (Left, Width: 280px - STICKY) */}
        <aside style={{ width: '280px', height: '100%', borderRight: '1px solid #262423', backgroundColor: '#161514', display: 'flex', flexDirection: 'column', flexShrink: 0, position: 'sticky', top: 0, zIndex: 10 }}>
          
          {/* Mini Cover Preview Box */}
          <div 
            onClick={() => setActiveSettingsTab('cover')}
            style={{ 
              height: '140px', 
              position: 'relative', 
              overflow: 'hidden', 
              cursor: 'pointer', 
              borderBottom: '1px solid #262423',
              backgroundColor: '#0E0D0C'
            }}
            title="Design Copertă"
          >
            {coverPhoto ? (
              <>
                <img 
                  src={coverPhoto.url} 
                  alt="Mini Cover" 
                  style={{ 
                    width: '100%', 
                    height: '100%', 
                    objectFit: 'cover', 
                    objectPosition: `${focalPoint.x}% ${focalPoint.y}%`,
                    opacity: activeSettingsTab === 'cover' ? 0.9 : 0.6,
                    transition: 'opacity 0.2s'
                  }} 
                />
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.2) 60%)' }} />
                <div style={{ position: 'absolute', bottom: '12px', left: '12px', right: '12px', color: '#FAF9F6' }}>
                  <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--gold-accent)', fontWeight: 700 }}>
                    Copertă Galerie
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '2px' }}>
                    {title || 'DENIS x DOMINIKA'}
                  </div>
                </div>
              </>
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', color: '#706E6A', fontSize: '12px' }}>
                <ImageIcon size={28} />
                <span>Setează Imagine Copertă</span>
              </div>
            )}
          </div>

          {/* Quick tab icon bar */}
          <div style={{ display: 'flex', borderBottom: '1px solid #262423', backgroundColor: '#0E0D0C' }}>
            <button 
              onClick={() => setActiveSettingsTab('photos')} 
              style={{ 
                flex: 1, 
                padding: '12px', 
                border: 'none', 
                background: 'none', 
                color: activeSettingsTab === 'photos' ? 'var(--gold-accent)' : '#706E6A', 
                borderBottom: activeSettingsTab === 'photos' ? '2px solid var(--gold-accent)' : '2px solid transparent',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'center'
              }}
              title="Fișiere & Foldere"
            >
              <Grid size={18} />
            </button>
            <button 
              onClick={() => setActiveSettingsTab('cover')} 
              style={{ 
                flex: 1, 
                padding: '12px', 
                border: 'none', 
                background: 'none', 
                color: activeSettingsTab === 'cover' ? 'var(--gold-accent)' : '#706E6A', 
                borderBottom: activeSettingsTab === 'cover' ? '2px solid var(--gold-accent)' : '2px solid transparent',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'center'
              }}
              title="Design Copertă"
            >
              <Type size={18} />
            </button>
            <button 
              onClick={() => setActiveSettingsTab('watermark')} 
              style={{ 
                flex: 1, 
                padding: '12px', 
                border: 'none', 
                background: 'none', 
                color: activeSettingsTab === 'watermark' ? 'var(--gold-accent)' : '#706E6A', 
                borderBottom: activeSettingsTab === 'watermark' ? '2px solid var(--gold-accent)' : '2px solid transparent',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'center'
              }}
              title="Setări Watermark"
            >
              <Settings size={18} />
            </button>
            <button 
              onClick={() => setActiveSettingsTab('selection')} 
              style={{ 
                flex: 1, 
                padding: '12px', 
                border: 'none', 
                background: 'none', 
                color: activeSettingsTab === 'selection' ? 'var(--gold-accent)' : '#706E6A', 
                borderBottom: activeSettingsTab === 'selection' ? '2px solid var(--gold-accent)' : '2px solid transparent',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'center',
                position: 'relative'
              }}
              title="Link Selecție Client"
            >
              <Eye size={18} />
              {selectionEnabled && (
                <span style={{ position: 'absolute', top: '8px', right: '8px', width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#2ECC71' }} />
              )}
            </button>
          </div>

          {/* Tab contents (conditionally renders list of sets, cover designs, or watermark options) */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }} className="hide-scrollbar">
            
            {activeSettingsTab === 'photos' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#706E6A', fontWeight: 600 }}>
                    FOLDERE / COLECTII
                  </span>
                  {!isAddingSet ? (
                    <button 
                      onClick={() => setIsAddingSet(true)}
                      style={{ background: 'none', border: 'none', color: 'var(--gold-accent)', fontSize: '11px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      <Plus size={12} /> Adaugă Set
                    </button>
                  ) : (
                    <button 
                      onClick={() => setIsAddingSet(false)}
                      style={{ background: 'none', border: 'none', color: '#706E6A', fontSize: '11px', cursor: 'pointer' }}
                    >
                      Anulează
                    </button>
                  )}
                </div>

                {isAddingSet && (
                  <div style={{ display: 'flex', gap: '6px', backgroundColor: '#0E0D0C', padding: '6px', borderRadius: '4px', border: '1px solid #2D2A28' }}>
                    <input 
                      type="text" 
                      value={newSubName} 
                      onChange={(e) => setNewSubName(e.target.value)} 
                      placeholder="Nume folder..."
                      style={{ flex: 1, background: 'none', border: 'none', color: '#FAF9F6', fontSize: '12px', outline: 'none' }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddSubCollection();
                      }}
                    />
                    <button 
                      onClick={handleAddSubCollection} 
                      style={{ background: 'var(--gold-accent)', border: 'none', color: '#FAF9F6', width: '22px', height: '22px', borderRadius: '3px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                    >
                      <Check size={12} />
                    </button>
                  </div>
                )}

                {/* Subcollection Folders Menu List */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {subCollections.map((sub, idx) => {
                    const isRenaming = renamingSubId === sub.id;
                    const isActive = activeSubId === sub.id;
                    
                    return (
                      <div 
                        key={sub.id}
                        onClick={() => !isRenaming && setActiveSubId(sub.id)}
                        draggable={!isRenaming}
                        onDragStart={(e) => handleDragStart(e, idx)}
                        onDragOver={(e) => handleDragOver(e, idx)}
                        onDragEnd={handleDragEnd}
                        style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'space-between', 
                          padding: '10px 12px', 
                          borderRadius: '4px', 
                          backgroundColor: isActive ? 'var(--card-bg)' : 'transparent',
                          border: '1px solid',
                          borderColor: isActive ? '#2D2A28' : 'transparent',
                          cursor: isRenaming ? 'default' : 'grab',
                          transition: 'all 0.15s ease',
                          opacity: draggedIndex === idx ? 0.4 : 1,
                          boxSizing: 'border-box'
                        }}
                        className="folder-list-item"
                      >
                        {isRenaming ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%' }} onClick={(e) => e.stopPropagation()}>
                            <input 
                              type="text" 
                              value={renameValue} 
                              onChange={(e) => setRenameValue(e.target.value)} 
                              style={{ flex: 1, padding: '4px 6px', backgroundColor: '#0E0D0C', border: '1px solid var(--gold-accent)', color: '#FAF9F6', borderRadius: '4px', fontSize: '12px', outline: 'none' }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveRename(sub.id);
                                if (e.key === 'Escape') setRenamingSubId(null);
                              }}
                              autoFocus
                            />
                            <button 
                              onClick={() => handleSaveRename(sub.id)}
                              style={{ background: 'var(--gold-accent)', border: 'none', color: '#FAF9F6', width: '22px', height: '22px', borderRadius: '3px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                            >
                              <Check size={11} />
                            </button>
                            <button 
                              onClick={() => setRenamingSubId(null)}
                              style={{ background: 'none', border: '1px solid #2D2A28', color: '#706E6A', width: '22px', height: '22px', borderRadius: '3px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                            >
                              <X size={11} />
                            </button>
                          </div>
                        ) : (
                          <>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', overflow: 'hidden' }}>
                              <span style={{ cursor: 'grab', color: '#5C5A57', fontSize: '14px', marginRight: '-2px' }}>☰</span>
                              <Folder size={14} style={{ color: isActive ? 'var(--gold-accent)' : '#706E6A', flexShrink: 0 }} />
                              <span style={{ fontSize: '13px', fontWeight: isActive ? 600 : 500, color: isActive ? '#FAF9F6' : '#A3A09B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {sub.name}
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontSize: '11px', color: '#5C5A57' }}>
                                {(sub.photos && sub.photos.length > 0) ? sub.photos.length : (sub.photoCount || 0)}
                              </span>
                              
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleStartRename(sub.id, sub.name);
                                }}
                                style={{ background: 'none', border: 'none', color: '#706E6A', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0 }}
                                className="folder-action-btn"
                                title="Redenumește"
                              >
                                <Edit2 size={12} />
                              </button>

                              {sub.id !== 'all' && (
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRemoveSubCollection(sub.id);
                                  }}
                                  style={{ background: 'none', border: 'none', color: '#706E6A', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0 }}
                                  className="folder-action-btn folder-delete-btn"
                                  title="Șterge"
                                >
                                  <X size={12} />
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {activeSettingsTab === 'cover' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#706E6A', fontWeight: 600 }}>
                  DESIGN COPERTĂ
                </span>

                <div>
                  <label className="field-label-text" style={{ fontSize: '11px' }}>Titlu Galerie</label>
                  <input 
                    type="text" 
                    value={title} 
                    onChange={(e) => setTitle(e.target.value)} 
                    placeholder="Ex: DENIS x DOMINIKA"
                    style={{ width: '100%', padding: '8px 10px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '4px', fontSize: '13px', outline: 'none' }}
                  />
                </div>

                <div>
                  <label className="field-label-text" style={{ fontSize: '11px' }}>Subtitlu Copertă</label>
                  <input 
                    type="text" 
                    value={subtitle} 
                    onChange={(e) => setSubtitle(e.target.value)} 
                    placeholder="Ex: ALEXIA VISUAL ARTIST"
                    style={{ width: '100%', padding: '8px 10px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '4px', fontSize: '13px', outline: 'none' }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div>
                    <label className="field-label-text" style={{ fontSize: '11px' }}>Data Galeriei</label>
                    <input 
                      type="date" 
                      value={date} 
                      onChange={(e) => setDate(e.target.value)}
                      style={{ width: '100%', padding: '8px 10px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '4px', fontSize: '12px', outline: 'none' }}
                    />
                  </div>
                  <div>
                    <label className="field-label-text" style={{ fontSize: '11px' }}>Upload Copertă</label>
                    <input type="file" ref={coverInputRef} onChange={handleCoverUpload} accept="image/*" style={{ display: 'none' }} />
                    <button 
                      onClick={() => coverInputRef.current?.click()} 
                      className="btn btn-secondary" 
                      style={{ width: '100%', height: '38px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '12px' }}
                      disabled={isUploadingCover}
                    >
                      {isUploadingCover ? <RefreshCw className="spinner" size={14} /> : <Upload size={14} />}
                      Încarcă
                    </button>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid #262423', paddingTop: '14px', marginTop: '4px' }}>
                  <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#706E6A', fontWeight: 600, display: 'block', marginBottom: '12px' }}>
                    Tipografie Text
                  </span>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <div>
                        <label className="field-label-text" style={{ fontSize: '10px' }}>Font Family</label>
                        <select value={fontFamily} onChange={(e) => setFontFamily(e.target.value)} style={{ width: '100%', padding: '6px 8px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '4px', fontSize: '12px' }}>
                          <option value="Outfit">Outfit (Sans)</option>
                          <option value="Playfair Display">Playfair (Serif)</option>
                          <option value="Inter">Inter (Sans)</option>
                        </select>
                      </div>
                      <div>
                        <label className="field-label-text" style={{ fontSize: '10px' }}>Dimensiune</label>
                        <select value={fontSize} onChange={(e) => setFontSize(e.target.value)} style={{ width: '100%', padding: '6px 8px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '4px', fontSize: '12px' }}>
                          <option value="28px">28px</option>
                          <option value="36px">36px</option>
                          <option value="42px">42px</option>
                          <option value="48px">48px</option>
                          <option value="56px">56px</option>
                        </select>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <div>
                        <label className="field-label-text" style={{ fontSize: '10px' }}>Aliniere Text</label>
                        <select value={titlePosition} onChange={(e) => setTitlePosition(e.target.value as any)} style={{ width: '100%', padding: '6px 8px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '4px', fontSize: '12px' }}>
                          <option value="bottom-left">Stânga-Jos</option>
                          <option value="bottom-center">Centru-Jos</option>
                          <option value="center">Centrat</option>
                          <option value="top-center">Centru-Sus</option>
                        </select>
                      </div>
                      <div>
                        <label className="field-label-text" style={{ fontSize: '10px' }}>Culoare Text</label>
                        <input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)} style={{ width: '100%', height: '30px', padding: '0', backgroundColor: 'transparent', border: 'none', cursor: 'pointer' }} />
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            )}

            {activeSettingsTab === 'watermark' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#706E6A', fontWeight: 600 }}>
                  SETĂRI WATERMARK
                </span>

                <div>
                  <label className="field-label-text" style={{ fontSize: '11px' }}>Aplică Watermark pe Poze?</label>
                  <select 
                    value={watermarkEnabled ? 'yes' : 'no'}
                    onChange={(e) => setWatermarkEnabled(e.target.value === 'yes')}
                    style={{ width: '100%', padding: '8px 10px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '4px', fontSize: '13px', outline: 'none' }}
                  >
                    <option value="no">Nu aplica</option>
                    <option value="yes">Da, aplică watermark</option>
                  </select>
                </div>

                <div>
                  <label className="field-label-text" style={{ fontSize: '11px' }}>Poziție Watermark</label>
                  <select 
                    value={watermarkPosition}
                    onChange={(e) => setWatermarkPosition(e.target.value as any)}
                    disabled={!watermarkEnabled}
                    style={{ width: '100%', padding: '8px 10px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '4px', fontSize: '13px', outline: 'none' }}
                  >
                    <option value="bottom-right">Dreapta-jos</option>
                    <option value="bottom-left">Stânga-jos</option>
                    <option value="bottom-center">Centru-jos</option>
                    <option value="top-right">Dreapta-sus</option>
                    <option value="top-left">Stânga-sus</option>
                    <option value="center">Centrat</option>
                  </select>
                </div>

                {watermarkEnabled && globalWatermark && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '4px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label className="field-label-text" style={{ fontSize: '10px', textTransform: 'uppercase', color: '#706E6A' }}>Prevualizare Poziționare</label>
                      <div 
                        onClick={() => setIsPreviewWatermarkLarge(true)}
                        style={{ position: 'relative', width: '100%', aspectRatio: '16/10', borderRadius: '4px', overflow: 'hidden', border: '1px solid #2D2A28', backgroundColor: '#1A1A1A', cursor: 'zoom-in' }}
                        title="Click pentru a mări prevualizarea"
                      >
                        <img 
                          src="https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=400&q=80" 
                          alt="Sample preview" 
                          style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.6 }} 
                        />
                        <div style={{ position: 'absolute', bottom: '4px', right: '6px', fontSize: '9px', color: '#FAF9F6', backgroundColor: 'rgba(0,0,0,0.6)', padding: '2px 6px', borderRadius: '3px', pointerEvents: 'none', fontWeight: 600, letterSpacing: '0.03em', textTransform: 'uppercase' }}>
                          Mărește 🔍
                        </div>
                        {watermarkPosition !== 'tile' ? (
                          <img 
                            src={globalWatermark.url} 
                            alt="Watermark Overlay" 
                            style={{ 
                              position: 'absolute', 
                              objectFit: 'contain',
                              zIndex: 5,
                              opacity: 0.45,
                              filter: 'drop-shadow(0px 2px 4px rgba(0,0,0,0.5))',
                              ...((): React.CSSProperties => {
                                const basePadding = 3;
                                const pos = watermarkPosition || 'bottom-right';
                                switch (pos) {
                                  case 'bottom-right': 
                                    return { 
                                      bottom: `${basePadding}%`, 
                                      right: `${basePadding}%`, 
                                      maxWidth: '16%', 
                                      maxHeight: '16%',
                                      transform: `translate(${-watermarkOffsetX * 5}%, ${-watermarkOffsetY * 5}%)`
                                    };
                                  case 'bottom-left': 
                                    return { 
                                      bottom: `${basePadding}%`, 
                                      left: `${basePadding}%`, 
                                      maxWidth: '16%', 
                                      maxHeight: '16%',
                                      transform: `translate(${watermarkOffsetX * 5}%, ${-watermarkOffsetY * 5}%)`
                                    };
                                  case 'bottom-center': 
                                    return { 
                                      bottom: `${basePadding}%`, 
                                      left: '50%', 
                                      maxWidth: '16%', 
                                      maxHeight: '16%',
                                      transform: `translate(calc(-50% + ${watermarkOffsetX * 5}%), ${-watermarkOffsetY * 5}%)`
                                    };
                                  case 'top-right': 
                                    return { 
                                      top: `${basePadding}%`, 
                                      right: `${basePadding}%`, 
                                      maxWidth: '16%', 
                                      maxHeight: '16%',
                                      transform: `translate(${-watermarkOffsetX * 5}%, ${watermarkOffsetY * 5}%)`
                                    };
                                  case 'top-left': 
                                    return { 
                                      top: `${basePadding}%`, 
                                      left: `${basePadding}%`, 
                                      maxWidth: '16%', 
                                      maxHeight: '16%',
                                      transform: `translate(${watermarkOffsetX * 5}%, ${watermarkOffsetY * 5}%)`
                                    };
                                  case 'center': 
                                    return { 
                                      top: '50%', 
                                      left: '50%', 
                                      maxWidth: '16%', 
                                      maxHeight: '16%',
                                      transform: `translate(calc(-50% + ${watermarkOffsetX * 5}%), calc(-50% + ${watermarkOffsetY * 5}%))`
                                    };
                                  default: 
                                    return { 
                                      bottom: `${basePadding}%`, 
                                      right: `${basePadding}%`, 
                                      maxWidth: '16%', 
                                      maxHeight: '16%' 
                                    };
                                }
                              })()
                            }} 
                          />
                        ) : (
                          <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gridTemplateRows: 'repeat(4, 1fr)', opacity: 0.2, pointerEvents: 'none', zIndex: 5 }}>
                            {Array.from({ length: 16 }).map((_, idx) => (
                              <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <img src={globalWatermark.url} style={{ maxWidth: '40%', maxHeight: '40%', objectFit: 'contain' }} />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {watermarkPosition !== 'tile' && (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '10px', backgroundColor: '#0A0908', border: '1px solid #262423', borderRadius: '4px' }}>
                        <span style={{ fontSize: '10px', color: '#A3A09B', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Ajustare Poziție (Nudge)</span>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 34px)', gridTemplateRows: 'repeat(3, 34px)', gap: '4px', margin: '4px 0' }}>
                          <div />
                          <button 
                            type="button" 
                            onClick={() => handleNudge('up')}
                            style={{ backgroundColor: '#1C1A19', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}
                          >
                            ▲
                          </button>
                          <div />

                          <button 
                            type="button" 
                            onClick={() => handleNudge('left')}
                            style={{ backgroundColor: '#1C1A19', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}
                          >
                            ◀
                          </button>
                          <button 
                            type="button" 
                            onClick={() => { setWatermarkOffsetX(0); setWatermarkOffsetY(0); }}
                            style={{ backgroundColor: '#5f0b02', border: 'none', color: '#FAF9F6', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '9px', fontWeight: 700 }}
                          >
                            RST
                          </button>
                          <button 
                            type="button" 
                            onClick={() => handleNudge('right')}
                            style={{ backgroundColor: '#1C1A19', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}
                          >
                            ▶
                          </button>

                          <div />
                          <button 
                            type="button" 
                            onClick={() => handleNudge('down')}
                            style={{ backgroundColor: '#1C1A19', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}
                          >
                            ▼
                          </button>
                          <div />
                        </div>
                        <div style={{ display: 'flex', gap: '12px', fontSize: '10px', color: '#706E6A', fontWeight: 600 }}>
                          <span>H: <span style={{ color: 'var(--gold-accent)' }}>{watermarkOffsetX}</span></span>
                          <span>V: <span style={{ color: 'var(--gold-accent)' }}>{watermarkOffsetY}</span></span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {watermarkEnabled && globalWatermark && subCollections.some(s => (s.photoCount || (s.photos || []).length) > 0) && (
                  <div style={{ borderTop: '1px solid #262423', paddingTop: '16px', marginTop: '4px' }}>
                    <button
                      type="button"
                      onClick={handleApplyWatermarkToExisting}
                      disabled={isProcessingWatermark}
                      className="btn btn-secondary"
                      style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', border: '1px dashed var(--gold-accent)', color: 'var(--gold-accent)', fontSize: '11px', padding: '10px' }}
                    >
                      {isProcessingWatermark ? (
                        <>
                          <RefreshCw className="spinner" size={14} />
                          {processingProgress.current} / {processingProgress.total} poze...
                        </>
                      ) : (
                        <>
                          <RefreshCw size={14} />
                          Aplică pe pozele existente
                        </>
                      )}
                    </button>
                    <p style={{ color: '#5C5A57', fontSize: '10px', margin: '8px 0 0 0', lineHeight: 1.3 }}>
                      Apasă pentru a aplica automat watermark-ul pe toate fotografiile pe care le-ai încărcat deja.
                    </p>
                  </div>
                )}

                <div style={{ borderTop: '1px solid #262423', paddingTop: '16px', marginTop: '8px' }}>
                  <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#706E6A', fontWeight: 600, display: 'block', marginBottom: '8px' }}>
                    Restaurare originale (Fără Watermark)
                  </span>
                  <p style={{ color: '#A09A94', fontSize: '11px', margin: '0 0 10px 0', lineHeight: 1.4 }}>
                    Încarcă folderele/fișierele originale de pe calculator. Aplicația le va mapa automat după nume și va încărca versiunea curată fără watermark pentru link-ul clean.
                  </p>
                  
                  {isRestoring ? (
                    <div style={{ padding: '12px', backgroundColor: '#0D0C0B', border: '1px solid #2D2A28', borderRadius: '6px', fontSize: '12px' }}>
                      <div style={{ color: 'var(--gold-accent)', fontWeight: 600, marginBottom: '6px', fontSize: '11px' }}>
                        {restoreMessage}
                      </div>
                      {restoreProgress.total > 0 && (
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#FAF9F6', fontSize: '10px', marginBottom: '4px' }}>
                            <span>Progres: {restoreProgress.current} / {restoreProgress.matched} potrivite</span>
                            <span>Total scanat: {restoreProgress.total}</span>
                          </div>
                          <div style={{ width: '100%', height: '4px', backgroundColor: '#262423', borderRadius: '2px', overflow: 'hidden' }}>
                            <div style={{ 
                              width: `${restoreProgress.matched > 0 ? (restoreProgress.current / restoreProgress.matched) * 100 : 0}%`, 
                              height: '100%', 
                              backgroundColor: 'var(--gold-accent)', 
                              transition: 'width 0.2s ease' 
                            }} />
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <label 
                      className="btn btn-secondary" 
                      style={{ 
                        width: '100%', 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        gap: '8px', 
                        fontSize: '11px', 
                        padding: '10px',
                        cursor: 'pointer',
                        textAlign: 'center'
                      }}
                    >
                      <Upload size={14} /> Reîncarcă Originale Fără WM
                      <input 
                        type="file" 
                        multiple 
                        onChange={handleRestoreOriginals} 
                        style={{ display: 'none' }} 
                      />
                    </label>
                  )}
                </div>

                {/* Preview generation section — for all galleries with photos */}
                {subCollections.some(s => (s.photoCount || (s.photos || []).length) > 0) && (
                  <div style={{ borderTop: '1px solid #262423', paddingTop: '16px', marginTop: '8px' }}>
                    <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#706E6A', fontWeight: 600, display: 'block', marginBottom: '8px' }}>
                      Optimizare Web — Preview-uri
                    </span>
                    <p style={{ color: '#A09A94', fontSize: '11px', margin: '0 0 10px 0', lineHeight: 1.4 }}>
                      Generează versiuni comprimate (~1200px) pentru pozele fără preview, afișate rapid în galeria publică. Pozele originale rămân neatinse.
                    </p>
                    <button
                      type="button"
                      onClick={handleGeneratePreviews}
                      disabled={isGeneratingPreviews}
                      className="btn btn-secondary"
                      style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', border: '1px dashed #4a8c4a', color: '#6db86d', fontSize: '11px', padding: '10px' }}
                    >
                      {isGeneratingPreviews ? (
                        <>
                          <RefreshCw className="spinner" size={14} />
                          {previewGenProgress.current} / {previewGenProgress.total} poze...
                        </>
                      ) : (
                        <>
                          <RefreshCw size={14} />
                          Generează Preview-uri Web
                        </>
                      )}
                    </button>
                    {isGeneratingPreviews && (
                      <div style={{ marginTop: '8px' }}>
                        <div style={{ width: '100%', height: '3px', backgroundColor: '#262423', borderRadius: '2px', overflow: 'hidden' }}>
                          <div style={{
                            width: `${previewGenProgress.total > 0 ? (previewGenProgress.current / previewGenProgress.total) * 100 : 0}%`,
                            height: '100%',
                            backgroundColor: '#4a8c4a',
                            transition: 'width 0.3s ease'
                          }} />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {activeSettingsTab === 'selection' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#706E6A', fontWeight: 600 }}>
                  LINK SELECȚIE CLIENT
                </span>

                <div style={{ padding: '12px', backgroundColor: 'rgba(95, 11, 2, 0.05)', border: '1px solid rgba(95, 11, 2, 0.2)', borderRadius: '6px', fontSize: '12px', color: '#A09A94', lineHeight: 1.6 }}>
                  Generează un link pe care clientul îl poate deschide pentru a selecta <strong style={{ color: '#FAF9F6' }}>coperta</strong> și <strong style={{ color: '#FAF9F6' }}>pozele de album</strong>. Selecțiile apar în panoul admin.
                </div>

                <div>
                  <label className="field-label-text" style={{ fontSize: '11px' }}>Activează Link Selecție?</label>
                  <select
                    value={selectionEnabled ? 'yes' : 'no'}
                    onChange={(e) => setSelectionEnabled(e.target.value === 'yes')}
                    style={{ width: '100%', padding: '8px 10px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '4px', fontSize: '13px', outline: 'none' }}
                  >
                    <option value="no">Nu, dezactivat</option>
                    <option value="yes">Da, activat</option>
                  </select>
                </div>

                {selectionEnabled && (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <div>
                        <label className="field-label-text" style={{ fontSize: '11px' }}>Min. poze album</label>
                        <input
                          type="number"
                          min={1}
                          max={selectionMaxPhotos}
                          value={selectionMinPhotos}
                          onChange={(e) => setSelectionMinPhotos(Math.max(1, parseInt(e.target.value) || 1))}
                          style={{ width: '100%', padding: '8px 10px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '4px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}
                        />
                      </div>
                      <div>
                        <label className="field-label-text" style={{ fontSize: '11px' }}>Max. poze album</label>
                        <input
                          type="number"
                          min={selectionMinPhotos}
                          value={selectionMaxPhotos}
                          onChange={(e) => setSelectionMaxPhotos(Math.max(selectionMinPhotos, parseInt(e.target.value) || selectionMinPhotos))}
                          style={{ width: '100%', padding: '8px 10px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '4px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}
                        />
                      </div>
                    </div>

                    {isEdit && galleryId && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        <div>
                          <label className="field-label-text" style={{ fontSize: '11px' }}>Link Editare / Vizualizare Fără Watermark</label>
                          <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                            <input
                              type="text"
                              readOnly
                              value={`${window.location.origin}/p-gallery/${galleryId}/clean`}
                              style={{ flex: 1, padding: '8px 10px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', color: '#A09A94', borderRadius: '4px', fontSize: '11px', outline: 'none' }}
                            />
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(`${window.location.origin}/p-gallery/${galleryId}/clean`);
                                alert('Link fără watermark copiat!');
                              }}
                              style={{ padding: '8px 10px', backgroundColor: '#1C1A19', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                              title="Copiază"
                            >
                              Copiază
                            </button>
                          </div>
                          <p style={{ color: '#5C5A57', fontSize: '10px', margin: '6px 0 0 0', lineHeight: 1.4 }}>
                            Vizualizează pozele din galerie la rezoluție maximă, fără watermark. Ideal pentru editare proprie.
                          </p>
                        </div>

                        <div>
                          <label className="field-label-text" style={{ fontSize: '11px' }}>Link Selecție Client (Implicit)</label>
                        <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                          <input
                            type="text"
                            readOnly
                            value={`${window.location.origin}/p-gallery/${galleryId}/select`}
                            style={{ flex: 1, padding: '8px 10px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', color: '#A09A94', borderRadius: '4px', fontSize: '11px', outline: 'none' }}
                          />
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(`${window.location.origin}/p-gallery/${galleryId}/select`);
                              alert('Link selecție copiat!');
                            }}
                            style={{ padding: '8px 10px', backgroundColor: '#1C1A19', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                            title="Copiază"
                          >
                            Copiază
                          </button>
                        </div>
                      </div>

                      {/* Custom selection links list & creation form */}
                      <div style={{ borderTop: '1px solid #262423', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#706E6A', fontWeight: 600, display: 'block' }}>
                          LINK-URI SELECȚIE DEDICATE (PERSONALIZATE)
                        </span>
                        
                        {/* Form to create a new link */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', backgroundColor: '#0E0D0C', padding: '12px', borderRadius: '6px', border: '1px solid #262423' }}>
                          <input
                            type="text"
                            placeholder="Nume link (ex: Mirela, Elev A, Clasa 12B...)"
                            value={newLinkName}
                            onChange={(e) => setNewLinkName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleCreateSelectionLink(); }}
                            style={{ width: '100%', padding: '8px 10px', backgroundColor: '#131211', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '4px', fontSize: '12px', outline: 'none', boxSizing: 'border-box' }}
                          />
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                            <div>
                              <label className="field-label-text" style={{ fontSize: '10px' }}>Min. poze (min. 1)</label>
                              <input
                                type="number"
                                min={1}
                                value={newLinkMinPhotos}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value);
                                  setNewLinkMinPhotos(isNaN(val) || val < 1 ? 1 : val);
                                }}
                                style={{ width: '100%', padding: '6px 8px', backgroundColor: '#131211', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '4px', fontSize: '12px', outline: 'none', boxSizing: 'border-box' }}
                              />
                            </div>
                            <div>
                              <label className="field-label-text" style={{ fontSize: '10px' }}>Max. poze</label>
                              <input
                                type="number"
                                min={newLinkMinPhotos}
                                value={newLinkMaxPhotos}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value);
                                  setNewLinkMaxPhotos(isNaN(val) ? newLinkMinPhotos : val);
                                }}
                                style={{ width: '100%', padding: '6px 8px', backgroundColor: '#131211', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '4px', fontSize: '12px', outline: 'none', boxSizing: 'border-box' }}
                              />
                            </div>
                          </div>
                          <button
                            onClick={handleCreateSelectionLink}
                            disabled={isCreatingLink || !newLinkName.trim()}
                            style={{ padding: '8px 12px', backgroundColor: '#5f0b02', border: 'none', color: '#FAF9F6', borderRadius: '4px', cursor: newLinkName.trim() ? 'pointer' : 'not-allowed', fontSize: '12px', opacity: newLinkName.trim() ? 1 : 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', marginTop: '2px' }}
                          >
                            <Plus size={14} /> Adaugă Link
                          </button>
                        </div>

                        {/* List of custom selection links */}
                        {selectionLinks.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {selectionLinks.map((link) => {
                              const linkUrl = `${window.location.origin}/p-gallery/${galleryId}/select/${link.id}`;
                              const linkMin = Math.max(1, link.minPhotos ?? 1);
                              const linkMax = Math.max(linkMin, link.maxPhotos ?? selectionMaxPhotos);
                              return (
                                <div key={link.id} style={{ padding: '10px 12px', backgroundColor: '#0E0D0C', border: '1px solid #262423', borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#FAF9F6' }}>
                                      {link.name}
                                    </span>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                      <button
                                        onClick={() => handleToggleSelectionLink(link.id, link.enabled)}
                                        style={{ padding: '2px 8px', borderRadius: '3px', border: 'none', fontSize: '10px', fontWeight: 600, cursor: 'pointer', backgroundColor: link.enabled ? 'rgba(46,204,113,0.15)' : 'rgba(224,108,117,0.15)', color: link.enabled ? '#98C379' : '#E06C75' }}
                                      >
                                        {link.enabled ? 'Activ' : 'Inactiv'}
                                      </button>
                                      <button
                                        onClick={() => handleDeleteSelectionLink(link.id)}
                                        style={{ backgroundColor: 'transparent', border: 'none', color: '#E06C75', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}
                                        title="Șterge link"
                                      >
                                        <Trash2 size={13} />
                                      </button>
                                    </div>
                                  </div>

                                  {/* Min / Max photo limits per link */}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11px', color: '#A09A94', backgroundColor: '#131211', padding: '6px 8px', borderRadius: '4px' }}>
                                    <span>Limite:</span>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                      <span>Min:</span>
                                      <input
                                        type="number"
                                        min={1}
                                        value={linkMin}
                                        onChange={(e) => {
                                          const val = parseInt(e.target.value);
                                          const safeMin = isNaN(val) || val < 1 ? 1 : val;
                                          handleUpdateSelectionLinkLimits(link.id, safeMin, linkMax);
                                        }}
                                        style={{ width: '42px', padding: '2px 4px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '3px', fontSize: '11px', textAlign: 'center', outline: 'none' }}
                                      />
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                      <span>Max:</span>
                                      <input
                                        type="number"
                                        min={linkMin}
                                        value={linkMax}
                                        onChange={(e) => {
                                          const val = parseInt(e.target.value);
                                          const safeMax = isNaN(val) ? linkMin : val;
                                          handleUpdateSelectionLinkLimits(link.id, linkMin, safeMax);
                                        }}
                                        style={{ width: '42px', padding: '2px 4px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '3px', fontSize: '11px', textAlign: 'center', outline: 'none' }}
                                      />
                                    </label>
                                  </div>

                                  <div style={{ display: 'flex', gap: '6px' }}>
                                    <input
                                      type="text"
                                      readOnly
                                      value={linkUrl}
                                      style={{ flex: 1, padding: '6px 8px', backgroundColor: '#131211', border: '1px solid #262423', color: '#A09A94', borderRadius: '4px', fontSize: '10px', outline: 'none' }}
                                    />
                                    <button
                                      onClick={() => {
                                        navigator.clipboard.writeText(linkUrl);
                                        alert(`Link-ul pentru "${link.name}" a fost copiat!`);
                                      }}
                                      style={{ padding: '6px 8px', backgroundColor: '#1C1A19', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', whiteSpace: 'nowrap' }}
                                    >
                                      Copiază
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p style={{ color: '#5C5A57', fontSize: '11px', fontStyle: 'italic', margin: 0 }}>
                            Niciun link personalizat creat încă. Creează unul mai sus pentru a identifica selecțiile individual.
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                    {!isEdit && (
                      <p style={{ color: '#5C5A57', fontSize: '11px', margin: 0, lineHeight: 1.5, padding: '10px', backgroundColor: '#0E0D0C', borderRadius: '4px', border: '1px solid #1C1A19' }}>
                        Salvează galeria pentru a genera link-ul de selecție.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

          </div>
        </aside>

        <main 
          onDragOver={handleFileUploadDragOver}
          onDragLeave={handleFileUploadDragLeave}
          onDrop={handleFileUploadDrop}
          style={{ flex: 1, backgroundColor: '#0C0B0A', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}
        >
          {/* Visual Drag and Drop Overlay */}
          {isDraggingFiles && (
            <div 
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(212, 175, 55, 0.08)',
                border: '3px dashed var(--gold-accent)',
                backdropFilter: 'blur(4px)',
                zIndex: 50,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '12px',
                pointerEvents: 'none',
                margin: '12px',
                borderRadius: '8px'
              }}
            >
              <Upload size={48} style={{ color: 'var(--gold-accent)' }} />
              <h3 style={{ fontSize: '18px', fontWeight: 600, color: '#FAF9F6', margin: 0 }}>
                Eliberează pozele pentru a le încărca
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--gold-accent)', margin: 0 }}>
                Vor fi adăugate automat în folderul „{activeSub?.name || 'General'}”
              </p>
            </div>
          )}
          
          {/* Active section settings preview / interactive cover designer */}
          {activeSettingsTab === 'cover' ? (
            <div style={{ backgroundColor: '#121110', borderBottom: '1px solid #262423', padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', maxWidth: '800px', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ fontSize: '12px', color: '#A3A09B', fontWeight: 600 }}>Previzualizare și Punct Focal Copertă</span>
                <div style={{ display: 'flex', gap: '4px', backgroundColor: '#0E0D0C', padding: '2px', borderRadius: '4px', border: '1px solid #2D2A28' }}>
                  <button onClick={() => setPreviewMode('desktop')} style={{ background: previewMode === 'desktop' ? '#262423' : 'none', border: 'none', color: '#FAF9F6', padding: '4px 10px', borderRadius: '3px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}><Monitor size={12} /> Desktop</button>
                  <button onClick={() => setPreviewMode('mobile')} style={{ background: previewMode === 'mobile' ? '#262423' : 'none', border: 'none', color: '#FAF9F6', padding: '4px 10px', borderRadius: '3px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}><Smartphone size={12} /> Mobil</button>
                </div>
              </div>

              <div 
                style={{ 
                  width: previewMode === 'mobile' ? '320px' : '100%', 
                  maxWidth: previewMode === 'mobile' ? '320px' : '800px',
                  height: previewMode === 'mobile' ? '420px' : '260px', 
                  position: 'relative', 
                  borderRadius: '6px', 
                  overflow: 'hidden', 
                  border: '1px solid #2D2A28',
                  backgroundColor: '#161514',
                  cursor: coverPhoto ? 'crosshair' : 'default',
                  transition: 'width 0.3s ease'
                }}
                onClick={handleCoverClick}
              >
                {coverPhoto ? (
                  <>
                    <img 
                      src={coverPhoto.url} 
                      alt="Cover Preview" 
                      style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${focalPoint.x}% ${focalPoint.y}%` }} 
                    />
                    <div style={{ position: 'absolute', left: `${focalPoint.x}%`, top: `${focalPoint.y}%`, width: '16px', height: '16px', borderRadius: '50%', border: '2px solid #FAF9F6', backgroundColor: 'var(--gold-accent)', transform: 'translate(-50%, -50%)', pointerEvents: 'none', zIndex: 10 }} />
                    
                    {/* Header text layout preview */}
                    <div 
                      style={{ 
                        position: 'absolute', 
                        padding: '12px',
                        color: textColor,
                        zIndex: 8,
                        width: '80%',
                        pointerEvents: 'none',
                        textShadow: '0 2px 10px rgba(0,0,0,0.9)',
                        ...getAlignmentStyle(titlePosition)
                      }}
                    >
                      <h1 style={{ fontFamily: fontFamily, fontSize: `calc(${fontSize} * 0.7)`, margin: '0 0 2px 0', lineHeight: 1.1, fontWeight: 700 }}>
                        {title || 'ALESIA X LAURENTIU'}
                      </h1>
                      {subtitle && (
                        <p style={{ margin: 0, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', opacity: 0.8 }}>
                          {subtitle}
                        </p>
                      )}
                    </div>
                  </>
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', color: '#706E6A', fontSize: '13px' }}>
                    <ImageIcon size={32} />
                    <span>Încarcă o imagine de copertă în panoul din stânga</span>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {/* Active Folder Header Area or Bulk Selection Toolbar */}
          {selectedPhotoPaths.length > 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid #2D2A28', backgroundColor: '#1C1A19', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <button 
                  onClick={() => setSelectedPhotoPaths([])} 
                  style={{ background: 'none', border: 'none', color: '#706E6A', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px' }}
                  title="Deselectează toate"
                >
                  <X size={18} />
                </button>
                <div>
                  <span style={{ fontSize: '15px', fontWeight: 600, color: '#FAF9F6' }}>
                    {selectedPhotoPaths.length} {selectedPhotoPaths.length === 1 ? 'poză selectată' : 'poze selectate'}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button 
                  onClick={handleSelectAll} 
                  className="btn btn-secondary btn-sm"
                  style={{ height: '38px', padding: '8px 16px', fontSize: '12px' }}
                >
                  {activeSub && activeSub.photos.length > 0 && activeSub.photos.every(p => selectedPhotoPaths.includes(p.path)) 
                    ? 'Deselectează Toate' 
                    : 'Selectează Toate'}
                </button>
                <button 
                  onClick={handleBulkDelete} 
                  className="btn btn-secondary btn-sm"
                  style={{ height: '38px', padding: '8px 16px', fontSize: '12px', color: '#E06C75', borderColor: '#E06C75', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <Trash2 size={14} /> Șterge Selectate
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid #262423', backgroundColor: '#121110', flexShrink: 0 }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#FAF9F6', margin: 0 }}>
                  {activeSub?.name}
                </h2>
                <p style={{ fontSize: '12px', color: '#706E6A', margin: '4px 0 0 0' }}>
                  {activeSub?.photos.length} fotografii în această colecție
                </p>
              </div>

              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                {activeSub && activeSub.photos.length > 0 && (
                  <>
                    <button 
                      onClick={handleReorderAZ}
                      disabled={isReorderingAZ}
                      className="btn btn-secondary btn-sm"
                      title="Sortează crescător toate fotografiile A-Z după nume"
                      style={{ height: '38px', padding: '8px 14px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      {isReorderingAZ ? (
                        <RefreshCw className="spinner" size={14} />
                      ) : (
                        <ArrowDownAZ size={14} />
                      )}
                      Ordonează A-Z
                    </button>
                    <button 
                      onClick={handleSelectAll} 
                      className="btn btn-secondary btn-sm"
                      style={{ height: '38px', padding: '8px 16px', fontSize: '12px' }}
                    >
                      Selectează Poze
                    </button>
                  </>
                )}
                <input 
                  type="file" 
                  ref={photosInputRef} 
                  onChange={handlePhotosUpload} 
                  multiple 
                  accept="image/*" 
                  style={{ display: 'none' }} 
                />
                <button 
                  onClick={() => photosInputRef.current?.click()} 
                  className="btn btn-gold btn-sm"
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', height: '38px' }}
                  disabled={isUploadingPhotos}
                >
                  <Plus size={16} /> Adaugă Poze
                </button>
              </div>
            </div>
          )}

          {/* Upload progress indicator */}
          {isUploadingPhotos && (
            <div style={{ backgroundColor: '#1C1A19', borderBottom: '1px solid #262423', padding: '12px 24px', maxHeight: '120px', overflowY: 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--gold-accent)', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                <RefreshCw className="spinner" size={12} />
                <span>Se încarcă fotografii ({Object.keys(uploadProgress).length})...</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {Object.values(uploadProgress).map(p => (
                  <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#0E0D0C', padding: '4px 10px', borderRadius: '4px', fontSize: '11px', border: '1px solid #2D2A28' }}>
                    <span style={{ color: '#FAF9F6', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                    <span style={{ color: 'var(--gold-accent)', fontWeight: 600 }}>{p.progress}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Photos Grid Scrollable Area */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }} className="hide-scrollbar">
            {!activeSub || !activeSub.photos || activeSub.photos.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '300px', color: '#706E6A', gap: '12px' }}>
                <Upload size={40} style={{ opacity: 0.5 }} />
                <h3 style={{ fontSize: '15px', color: '#FAF9F6', margin: 0 }}>Acest folder este gol</h3>
                <p style={{ fontSize: '12px', color: '#706E6A', margin: 0, textAlign: 'center', maxWidth: '300px' }}>
                  Trage fișiere sau dă click pe butonul „Adaugă Poze” din colțul dreapta-sus pentru a încărca.
                </p>
              </div>
            ) : (
              <div key={activeSubId} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '20px' }}>
                {activeSub.photos.map((photo, idx) => {
                  const isSelected = selectedPhotoPaths.includes(photo.path);

                  // Determine opacity (dim all dragged photos)
                  const isDraggingActive = draggedPhotoIndex !== null;
                  const isDraggedPhotoSelected = isDraggingActive && selectedPhotoPaths.includes(activeSub.photos[draggedPhotoIndex].path);
                  const isCurrentlyDragged = isDraggingActive && (
                    isDraggedPhotoSelected 
                      ? selectedPhotoPaths.includes(photo.path)
                      : draggedPhotoIndex === idx
                  );
                  const opacity = isCurrentlyDragged ? 0.3 : 1;
                  
                  return (
                    <div 
                      key={photo.firestoreId || `${photo.path}_${idx}`} 
                      draggable={true}
                      onDragStart={(e) => handlePhotoDragStart(e, idx)}
                      onDragOver={(e) => handlePhotoDragOver(e, idx)}
                      onDragLeave={() => handlePhotoDragLeave(idx)}
                      onDragEnd={handlePhotoDragEnd}
                      onDrop={(e) => handlePhotoDrop(e, idx)}
                      onClick={(e) => {
                        if (selectedPhotoPaths.length > 0 || e.shiftKey) {
                          handleToggleSelectPhoto(photo.path, e.shiftKey);
                        } else {
                          const findIdx = activeSub.photos.findIndex(p => p.path === photo.path);
                          setPreviewPhotoIndex(findIdx);
                          setPreviewPhotoUrl(photo.url);
                        }
                      }}
                      style={{ 
                        position: 'relative', 
                        aspectRatio: '1', 
                        borderRadius: '6px', 
                        overflow: 'visible', 
                        border: isSelected 
                          ? '2px solid var(--gold-accent)' 
                          : dragOverIndex === idx && draggedPhotoIndex !== idx
                            ? '1px solid var(--gold-accent)'
                            : '1px solid #2D2A28', 
                        backgroundColor: '#000',
                        cursor: 'pointer',
                        opacity: opacity,
                        transition: 'opacity 0.2s, border 0.2s',
                        transform: 'none',
                        zIndex: dragOverIndex === idx && draggedPhotoIndex !== idx ? 10 : 1
                      }}
                      className="photo-card-item"
                    >
                      {/* Insertion Position Visual Indicator (Golden Bar in the gap) */}
                      {dragOverIndex === idx && draggedPhotoIndex !== idx && draggedPhotoIndex !== null && (
                        <div style={{
                          position: 'absolute',
                          left: draggedPhotoIndex > idx ? '-12px' : 'auto',
                          right: draggedPhotoIndex < idx ? '-12px' : 'auto',
                          top: '-4%',
                          bottom: '-4%',
                          width: '4px',
                          backgroundColor: 'var(--gold-accent)',
                          zIndex: 15,
                          boxShadow: '0 0 10px var(--gold-accent)',
                          borderRadius: '2px',
                          pointerEvents: 'none'
                        }} />
                      )}
                      <img src={photo.url} alt={photo.name} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '5px', userSelect: 'none', pointerEvents: 'none' }} />
                      
                      {/* Checkbox Circle */}
                      <div 
                        className="photo-select-checkbox"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleSelectPhoto(photo.path, e.shiftKey);
                        }}
                        style={{
                          position: 'absolute',
                          top: '8px',
                          left: '8px',
                          width: '20px',
                          height: '20px',
                          borderRadius: '50%',
                          border: isSelected ? '2px solid var(--gold-accent)' : '2px solid #FAF9F6',
                          backgroundColor: isSelected ? 'var(--gold-accent)' : 'rgba(0, 0, 0, 0.4)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          zIndex: 12,
                          opacity: isSelected ? 1 : 0,
                          transition: 'all 0.2s ease',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.5)'
                        }}
                      >
                        {isSelected && <Check size={12} style={{ color: '#FAF9F6' }} />}
                      </div>

                      {/* Delete individual hover button */}
                      <button 
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation(); // Avoid triggering selection toggle
                          handleDeletePhoto(activeSub.id, photo.path);
                        }}
                        style={{ 
                          position: 'absolute', 
                          top: '8px', 
                          right: '8px', 
                          width: '26px', 
                          height: '26px', 
                          borderRadius: '50%', 
                          backgroundColor: 'rgba(217, 83, 79, 0.9)', 
                          border: 'none', 
                          color: '#FFF', 
                          display: 'none', // Hidden by default, visible on hover!
                          alignItems: 'center', 
                          justifyContent: 'center', 
                          cursor: 'pointer',
                          boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
                          zIndex: 10
                        }}
                        className="photo-delete-btn"
                        title="Șterge poza"
                      >
                        <Trash2 size={13} />
                      </button>

                      {/* Image details tag */}
                      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(18, 17, 16, 0.75)', color: '#FAF9F6', padding: '4px 8px', fontSize: '9px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                        {photo.name}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </main>
          </>
        )}

        {/* ── SELECTIONS MAIN TAB ──────────────────────────────── */}
        {activeMainTab === 'selections' && (
          <div style={{ display: 'flex', flex: 1, height: '100%', overflow: 'hidden', width: '100%' }}>
            {/* Left selections list */}
            <div style={{ width: '340px', borderRight: '1px solid #262423', backgroundColor: '#161514', display: 'flex', flexDirection: 'column', overflowY: 'auto', flexShrink: 0 }}>
              <div style={{ padding: '16px', borderBottom: '1px solid #262423', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#706E6A', fontWeight: 600 }}>
                  SELECȚII PRIMITE ({selectionsList.length})
                </span>

                {/* Filter pill buttons per selection link */}
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => setSelectedFilterLinkId('all')}
                    style={{
                      padding: '4px 8px',
                      fontSize: '11px',
                      borderRadius: '4px',
                      border: '1px solid',
                      borderColor: selectedFilterLinkId === 'all' ? '#5f0b02' : '#262423',
                      backgroundColor: selectedFilterLinkId === 'all' ? '#5f0b02' : '#0E0D0C',
                      color: selectedFilterLinkId === 'all' ? '#FAF9F6' : '#706E6A',
                      cursor: 'pointer'
                    }}
                  >
                    Toate ({selectionsList.length})
                  </button>

                  {selectionLinks.map(link => {
                    const count = selectionsList.filter(s => s.selectionLinkId === link.id).length;
                    const isSelected = selectedFilterLinkId === link.id;
                    return (
                      <button
                        key={link.id}
                        onClick={() => setSelectedFilterLinkId(link.id)}
                        style={{
                          padding: '4px 8px',
                          fontSize: '11px',
                          borderRadius: '4px',
                          border: '1px solid',
                          borderColor: isSelected ? '#5f0b02' : '#262423',
                          backgroundColor: isSelected ? '#5f0b02' : '#0E0D0C',
                          color: isSelected ? '#FAF9F6' : '#706E6A',
                          cursor: 'pointer'
                        }}
                      >
                        {link.name} ({count})
                      </button>
                    );
                  })}

                  {selectionsList.some(s => !s.selectionLinkId) && (
                    <button
                      onClick={() => setSelectedFilterLinkId('legacy')}
                      style={{
                        padding: '4px 8px',
                        fontSize: '11px',
                        borderRadius: '4px',
                        border: '1px solid',
                        borderColor: selectedFilterLinkId === 'legacy' ? '#5f0b02' : '#262423',
                        backgroundColor: selectedFilterLinkId === 'legacy' ? '#5f0b02' : '#0E0D0C',
                        color: selectedFilterLinkId === 'legacy' ? '#FAF9F6' : '#706E6A',
                        cursor: 'pointer'
                      }}
                    >
                      Implicit ({selectionsList.filter(s => !s.selectionLinkId).length})
                    </button>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {(() => {
                  const filtered = selectionsList.filter(s => {
                    if (selectedFilterLinkId === 'all') return true;
                    if (selectedFilterLinkId === 'legacy') return !s.selectionLinkId;
                    return s.selectionLinkId === selectedFilterLinkId;
                  });

                  if (filtered.length === 0) {
                    return (
                      <div style={{ padding: '32px 16px', textAlign: 'center', color: '#706E6A', fontSize: '13px' }}>
                        Nicio selecție găsită pentru filtrul curent.
                      </div>
                    );
                  }

                  return filtered.map((sel, idx) => {
                    const isActive = expandedSelectionId === sel.id;
                    const submittedDate = sel.submittedAt?.toDate ? sel.submittedAt.toDate().toLocaleString('ro-RO') : '—';
                    const displayName = sel.selectionLinkName || `Selecție #${selectionsList.length - idx}`;
                    
                    return (
                      <div
                        key={sel.id}
                        onClick={() => setExpandedSelectionId(sel.id)}
                        style={{
                          padding: '14px 16px',
                          borderBottom: '1px solid #262423',
                          cursor: 'pointer',
                          backgroundColor: isActive ? '#262423' : 'transparent',
                          transition: 'background-color 0.2s',
                          display: 'flex',
                          gap: '12px',
                          alignItems: 'center'
                        }}
                      >
                        {sel.coverPhoto?.url ? (
                          <img src={sel.coverPhoto.cleanUrl || sel.coverPhoto.url} alt="cover" className={sel.coverPhoto.bw ? 'grayscale' : ''} style={{ width: '48px', height: '48px', borderRadius: '4px', objectFit: 'cover', border: '1px solid #2D2A28', flexShrink: 0 }} />
                        ) : (
                          <div style={{ width: '48px', height: '48px', borderRadius: '4px', backgroundColor: '#0C0B0A', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <ImageIcon size={16} style={{ color: '#5C5A57' }} />
                          </div>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: '#FAF9F6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {displayName}
                          </p>
                          <p style={{ margin: '3px 0 0', fontSize: '11px', color: '#706E6A' }}>
                            {sel.albumPhotos?.length || 0} poze • {submittedDate}
                          </p>
                        </div>
                        <span style={{ fontSize: '9px', padding: '2px 6px', borderRadius: '3px', backgroundColor: sel.status === 'reviewed' ? 'rgba(46,204,113,0.12)' : 'rgba(95,11,2,0.15)', color: sel.status === 'reviewed' ? '#98C379' : '#FAF9F6', fontWeight: 600, border: `1px solid ${sel.status === 'reviewed' ? 'rgba(46,204,113,0.25)' : 'rgba(95,11,2,0.3)'}`, flexShrink: 0 }}>
                          {sel.status === 'reviewed' ? 'Revizuit' : 'Nou'}
                        </span>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>

            {/* Right expanded selection view */}
            <div style={{ flex: 1, backgroundColor: '#0C0B0A', display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: '24px' }}>
              {(() => {
                const activeSel = selectionsList.find(s => s.id === expandedSelectionId);
                if (!activeSel) {
                  return (
                    <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: '#706E6A', height: '100%' }}>
                      <FileText size={48} style={{ marginBottom: '16px', opacity: 0.3 }} />
                      <p style={{ fontSize: '14px' }}>Selectează o selecție din panoul stâng pentru a vedea pozele.</p>
                    </div>
                  );
                }

                const selIdx = selectionsList.length - selectionsList.indexOf(activeSel);
                const submittedDate = activeSel.submittedAt?.toDate ? activeSel.submittedAt.toDate().toLocaleString('ro-RO') : '—';
                const displayName = activeSel.selectionLinkName ? `Selecție: ${activeSel.selectionLinkName}` : `Selecție #${selIdx}`;

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    {/* Header card info */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '16px', borderBottom: '1px solid #262423' }}>
                      <div>
                        <h2 style={{ fontSize: '20px', fontWeight: 500, color: '#FAF9F6', margin: 0 }}>{displayName}</h2>
                        <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#706E6A' }}>
                          {activeSel.selectionLinkName ? `Link: ${activeSel.selectionLinkName} • ` : ''}Trimisă la data de: {submittedDate}
                        </p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <button
                          onClick={() => toggleSelectionStatus(activeSel.id, activeSel.status)}
                          className="btn btn-secondary btn-sm"
                          style={{ height: '36px', borderColor: activeSel.status === 'reviewed' ? 'rgba(46,204,113,0.3)' : 'rgba(95,11,2,0.4)', color: activeSel.status === 'reviewed' ? '#98C379' : '#FAF9F6' }}
                        >
                          {activeSel.status === 'reviewed' ? 'Marchează ca Nou' : 'Marchează ca Revizuit'}
                        </button>
                        <button
                          onClick={() => downloadSelectionZip(activeSel, selectionsList.indexOf(activeSel))}
                          className="btn btn-gold btn-sm"
                          style={{ height: '36px', backgroundColor: '#5f0b02', color: '#FAF9F6', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                          disabled={zipProgress !== null}
                        >
                          {zipProgress !== null ? `Generare ZIP (${zipProgress}%)` : <><Download size={14} /> Descarcă ZIP</>}
                        </button>
                      </div>
                    </div>

                    {/* Cover Section */}
                    {activeSel.coverPhoto && (
                      <div>
                        <h4 style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#706E6A', marginBottom: '12px', fontWeight: 600 }}>COPERTĂ SELECTATĂ</h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-start' }}>
                          <div style={{ position: 'relative', width: '180px', borderRadius: '6px', overflow: 'hidden', border: '3px solid #5f0b02' }}>
                            <img src={activeSel.coverPhoto.cleanUrl || activeSel.coverPhoto.url} alt="cover selection" className={activeSel.coverPhoto.bw ? 'grayscale' : ''} style={{ width: '100%', display: 'block' }} />
                          </div>
                          <span className={`badge-bw-inline ${activeSel.coverPhoto.bw ? 'bw' : 'color'}`}>
                            {activeSel.coverPhoto.bw ? 'Alb-Negru' : 'Color'}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Album photos grid */}
                    <div>
                      <h4 style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#706E6A', marginBottom: '12px', fontWeight: 600 }}>
                        FOTOGRAFII ALBUM ({activeSel.albumPhotos?.length || 0})
                      </h4>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '8px' }}>
                        {(activeSel.albumPhotos || []).map((p: any, idx: number) => (
                          <div key={p.path || idx} style={{ position: 'relative', borderRadius: '4px', overflow: 'hidden', aspectRatio: '1', border: '1px solid #262423' }}>
                            <img src={p.cleanUrl || p.url} alt={p.name} className={p.bw ? 'grayscale' : ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            <div style={{ position: 'absolute', bottom: '6px', left: '6px', backgroundColor: 'rgba(18,17,16,0.85)', borderRadius: '3px', padding: '2px 6px', fontSize: '10px', color: '#FAF9F6', fontWeight: 700 }}>
                              #{idx + 1}
                            </div>
                            {p.bw && (
                              <div style={{ position: 'absolute', top: '6px', left: '6px', backgroundColor: '#000', border: '1px solid #3E3B39', borderRadius: '3px', padding: '2px 4px', fontSize: '8px', color: '#FFF', fontWeight: 600 }}>
                                B/W
                              </div>
                            )}
                            <div style={{ position: 'absolute', top: '6px', right: '6px', width: '18px', height: '18px', borderRadius: '50%', backgroundColor: '#5f0b02', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <Check size={10} style={{ color: '#FAF9F6' }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* ── LOGS MAIN TAB ─────────────────────────────────── */}
        {activeMainTab === 'logs' && (
          <div style={{ flex: 1, backgroundColor: '#0C0B0A', overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '16px', borderBottom: '1px solid #262423', marginBottom: '20px' }}>
              <div>
                <h2 style={{ fontSize: '20px', fontWeight: 500, color: '#FAF9F6', margin: 0 }}>Loguri de Descărcare</h2>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#706E6A' }}>Lista adreselor de email introduse pentru descărcarea fotografiilor</p>
              </div>
            </div>

            <div style={{ backgroundColor: '#161514', border: '1px solid #262423', borderRadius: '8px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #262423', backgroundColor: '#0E0D0C' }}>
                    <th style={{ padding: '12px 16px', color: '#FAF9F6', fontWeight: 600 }}>Email Client</th>
                    <th style={{ padding: '12px 16px', color: '#FAF9F6', fontWeight: 600 }}>Data Descărcării</th>
                    <th style={{ padding: '12px 16px', color: '#FAF9F6', fontWeight: 600 }}>Fișiere Descărcate</th>
                  </tr>
                </thead>
                <tbody>
                  {logsList.map((log) => {
                    const dlDate = log.downloadedAt?.toDate ? log.downloadedAt.toDate().toLocaleString('ro-RO') : '—';
                    return (
                      <tr key={log.id} style={{ borderBottom: '1px solid #262423', transition: 'background-color 0.2s' }}>
                        <td style={{ padding: '12px 16px', color: '#FAF9F6', fontWeight: 500 }}>{log.email}</td>
                        <td style={{ padding: '12px 16px', color: '#706E6A' }}>{dlDate}</td>
                        <td style={{ padding: '12px 16px', color: '#FAF9F6' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <strong style={{ color: '#D4AF37' }}>{log.filesList?.length || 0} fișiere</strong>
                            {log.filesList && log.filesList.length > 0 && (
                              <div style={{ fontSize: '11px', color: '#706E6A', maxWidth: '350px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={log.filesList.join(', ')}>
                                {log.filesList.join(', ')}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {logsList.length === 0 && (
                    <tr>
                      <td colSpan={3} style={{ padding: '32px', textAlign: 'center', color: '#706E6A' }}>
                        Niciun log de descărcare disponibil pentru această galerie.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>

      {/* Duplicate Files Detection Modal */}
      {duplicateModal?.visible && (
        <div
          onClick={() => resolveDuplicateModal('cancel')}
          style={{
            position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
            backgroundColor: 'rgba(9,8,8,0.88)', zIndex: 10000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'fadeIn 0.18s ease'
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              backgroundColor: '#1C1A19', border: '1px solid #2D2A28', borderRadius: '12px',
              padding: '32px', width: '480px', maxWidth: '92vw',
              boxShadow: '0 24px 60px rgba(0,0,0,0.7)', color: '#FAF9F6',
              fontFamily: 'Outfit, sans-serif'
            }}
          >
            {/* Icon + Title */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
              <div style={{
                width: '40px', height: '40px', borderRadius: '50%',
                backgroundColor: 'rgba(212,175,55,0.15)', border: '1px solid rgba(212,175,55,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
              }}>
                <AlertCircle size={20} style={{ color: '#D4AF37' }} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>Fotografii duplicate detectate</h3>
                <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#A3A09B' }}>
                  {duplicateModal.duplicateNames.length} din {duplicateModal.newFiles.length} fișiere există deja în acest folder
                </p>
              </div>
            </div>

            {/* Duplicate list (scrollable — all items shown) */}
            <div style={{
              backgroundColor: '#121110', border: '1px solid #262423', borderRadius: '8px',
              padding: '12px 14px', margin: '20px 0', maxHeight: '280px', overflowY: 'auto'
            }} className="hide-scrollbar">
              {duplicateModal.duplicateNames.map(name => (
                <div key={name} style={{
                  fontSize: '12px', color: '#D8D0C8', padding: '4px 0',
                  borderBottom: '1px solid #1E1D1C', display: 'flex', alignItems: 'center', gap: '8px'
                }}>
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#D4AF37', flexShrink: 0 }} />
                  <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{name}</span>
                </div>
              ))}
            </div>

            <p style={{ fontSize: '13px', color: '#A3A09B', margin: '0 0 24px 0', lineHeight: 1.6 }}>
              Ce dorești să faci cu fotografiile duplicate?
            </p>

            {/* Action buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {duplicateModal.uniqueFiles.length > 0 && (
                <button
                  onClick={() => resolveDuplicateModal('skip-duplicates')}
                  style={{
                    padding: '12px 20px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                    backgroundColor: '#5f0b02', color: '#FAF9F6', fontSize: '13px', fontWeight: 600,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    transition: 'background 0.15s'
                  }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#7a0c00')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#5f0b02')}
                >
                  <span>Sari peste duplicate, încarcă restul</span>
                  <span style={{ fontSize: '11px', opacity: 0.8, fontWeight: 400 }}>
                    {duplicateModal.uniqueFiles.length} fișiere noi
                  </span>
                </button>
              )}
              <button
                onClick={() => resolveDuplicateModal('upload-all')}
                style={{
                  padding: '12px 20px', borderRadius: '8px', border: '1px solid #363433', cursor: 'pointer',
                  backgroundColor: '#262423', color: '#FAF9F6', fontSize: '13px', fontWeight: 600,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  transition: 'background 0.15s'
                }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#2E2B29')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#262423')}
              >
                <span>Încarcă toate (inclusiv duplicate)</span>
                <span style={{ fontSize: '11px', opacity: 0.8, fontWeight: 400 }}>
                  {duplicateModal.newFiles.length} fișiere
                </span>
              </button>
              <button
                onClick={() => resolveDuplicateModal('cancel')}
                style={{
                  padding: '10px 20px', borderRadius: '8px', border: '1px solid transparent', cursor: 'pointer',
                  backgroundColor: 'transparent', color: '#706E6A', fontSize: '13px',
                  transition: 'color 0.15s'
                }}
                onMouseEnter={e => (e.currentTarget.style.color = '#FAF9F6')}
                onMouseLeave={e => (e.currentTarget.style.color = '#706E6A')}
              >
                Anulează
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox Fullscreen Preview Overlay */}

      {previewPhotoUrl && (
        <div 
          onClick={() => { setPreviewPhotoUrl(null); setPreviewPhotoIndex(-1); }}
          style={{ 
            position: 'fixed', 
            top: 0, 
            left: 0, 
            width: '100vw', 
            height: '100vh', 
            backgroundColor: 'rgba(9, 8, 8, 0.96)', 
            zIndex: 9999, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            cursor: 'zoom-out',
            animation: 'fadeIn 0.22s ease'
          }}
        >
          <button 
            onClick={(e) => { e.stopPropagation(); setPreviewPhotoUrl(null); setPreviewPhotoIndex(-1); }}
            style={{ 
              position: 'absolute', 
              top: '24px', 
              right: '24px', 
              background: 'rgba(28, 26, 25, 0.6)', 
              border: '1px solid #2D2A28', 
              color: '#FAF9F6', 
              borderRadius: '50%', 
              width: '44px', 
              height: '44px', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              cursor: 'pointer',
              zIndex: 10005,
              transition: 'all 0.15s ease'
            }}
            className="lightbox-ctrl-btn"
            title="Închide prevualizare (Esc)"
          >
            <X size={20} />
          </button>

          {activeSub && activeSub.photos.length > 1 && (
            <button 
              onClick={(e) => { e.stopPropagation(); handlePrevPhoto(); }}
              style={{ 
                position: 'absolute', 
                left: '24px', 
                background: 'rgba(28, 26, 25, 0.6)', 
                border: '1px solid #2D2A28', 
                color: '#FAF9F6', 
                borderRadius: '50%', 
                width: '48px', 
                height: '48px', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                cursor: 'pointer',
                zIndex: 10005,
                transition: 'all 0.15s ease'
              }}
              className="lightbox-ctrl-btn"
              title="Poza anterioară (Săgeată stânga)"
            >
              ◀
            </button>
          )}

          <div 
            onClick={(e) => e.stopPropagation()}
            style={{ 
              position: 'relative', 
              maxWidth: '85vw', 
              maxHeight: '85vh',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              cursor: 'default'
            }}
          >
            <img 
              src={previewPhotoUrl} 
              alt="Preview full size" 
              style={{ 
                maxWidth: '100%', 
                maxHeight: '80vh', 
                objectFit: 'contain',
                borderRadius: '4px',
                boxShadow: '0 8px 30px rgba(0,0,0,0.8)',
                border: '1px solid #1C1A19',
                userSelect: 'none'
              }} 
            />
            {activeSub && previewPhotoIndex !== -1 && (
              <span style={{ color: '#A3A09B', fontSize: '12px', marginTop: '14px', fontWeight: 500, letterSpacing: '0.05em' }}>
                {activeSub.photos[previewPhotoIndex]?.name} ({previewPhotoIndex + 1} din {activeSub.photos.length})
              </span>
            )}
          </div>

          {activeSub && activeSub.photos.length > 1 && (
            <button 
              onClick={(e) => { e.stopPropagation(); handleNextPhoto(); }}
              style={{ 
                position: 'absolute', 
                right: '24px', 
                background: 'rgba(28, 26, 25, 0.6)', 
                border: '1px solid #2D2A28', 
                color: '#FAF9F6', 
                borderRadius: '50%', 
                width: '48px', 
                height: '48px', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                cursor: 'pointer',
                zIndex: 10005,
                transition: 'all 0.15s ease'
              }}
              className="lightbox-ctrl-btn"
              title="Poza următoare (Săgeată dreapta)"
            >
              ▶
            </button>
          )}
        </div>
      )}
      {/* Fullscreen Watermark Placement Preview Modal */}
      {isPreviewWatermarkLarge && globalWatermark && (
        <div 
          onClick={() => setIsPreviewWatermarkLarge(false)}
          style={{ 
            position: 'fixed', 
            top: 0, 
            left: 0, 
            width: '100vw', 
            height: '100vh', 
            backgroundColor: 'rgba(9, 8, 8, 0.96)', 
            zIndex: 9999, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            cursor: 'zoom-out',
            animation: 'fadeIn 0.22s ease'
          }}
        >
          <button 
            onClick={(e) => { e.stopPropagation(); setIsPreviewWatermarkLarge(false); }}
            style={{ 
              position: 'absolute', 
              top: '24px', 
              right: '24px', 
              background: 'rgba(28, 26, 25, 0.6)', 
              border: '1px solid #2D2A28', 
              color: '#FAF9F6', 
              borderRadius: '50%', 
              width: '44px', 
              height: '44px', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              cursor: 'pointer',
              zIndex: 10005,
              transition: 'all 0.15s ease'
            }}
            className="lightbox-ctrl-btn"
            title="Închide (Esc)"
          >
            <X size={20} />
          </button>

          <div 
            onClick={(e) => e.stopPropagation()}
            style={{ 
              position: 'relative', 
              width: '80vw', 
              maxHeight: '80vh',
              aspectRatio: '16/10',
              backgroundColor: '#1A1A1A',
              borderRadius: '6px',
              overflow: 'hidden',
              boxShadow: '0 8px 30px rgba(0,0,0,0.8)',
              border: '1px solid #1C1A19',
              cursor: 'default'
            }}
          >
            <img 
              src="https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=1200&q=90" 
              alt="Sample preview" 
              style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.7, userSelect: 'none' }} 
            />
            {watermarkPosition !== 'tile' ? (
              <img 
                src={globalWatermark.url} 
                alt="Watermark Overlay" 
                style={{ 
                  position: 'absolute', 
                  objectFit: 'contain',
                  zIndex: 5,
                  opacity: 0.45,
                  filter: 'drop-shadow(0px 2px 4px rgba(0,0,0,0.5))',
                  ...((): React.CSSProperties => {
                    const basePadding = 3;
                    const pos = watermarkPosition || 'bottom-right';
                    switch (pos) {
                      case 'bottom-right': 
                        return { 
                          bottom: `${basePadding}%`, 
                          right: `${basePadding}%`, 
                          maxWidth: '16%', 
                          maxHeight: '16%',
                          transform: `translate(${-watermarkOffsetX * 5}%, ${-watermarkOffsetY * 5}%)`
                        };
                      case 'bottom-left': 
                        return { 
                          bottom: `${basePadding}%`, 
                          left: `${basePadding}%`, 
                          maxWidth: '16%', 
                          maxHeight: '16%',
                          transform: `translate(${watermarkOffsetX * 5}%, ${-watermarkOffsetY * 5}%)`
                        };
                      case 'bottom-center': 
                        return { 
                          bottom: `${basePadding}%`, 
                          left: '50%', 
                          maxWidth: '16%', 
                          maxHeight: '16%',
                          transform: `translate(calc(-50% + ${watermarkOffsetX * 5}%), ${-watermarkOffsetY * 5}%)`
                        };
                      case 'top-right': 
                        return { 
                          top: `${basePadding}%`, 
                          right: `${basePadding}%`, 
                          maxWidth: '16%', 
                          maxHeight: '16%',
                          transform: `translate(${-watermarkOffsetX * 5}%, ${watermarkOffsetY * 5}%)`
                        };
                      case 'top-left': 
                        return { 
                          top: `${basePadding}%`, 
                          left: `${basePadding}%`, 
                          maxWidth: '16%', 
                          maxHeight: '16%',
                          transform: `translate(${watermarkOffsetX * 5}%, ${watermarkOffsetY * 5}%)`
                        };
                      case 'center': 
                        return { 
                          top: '50%', 
                          left: '50%', 
                          maxWidth: '16%', 
                          maxHeight: '16%',
                          transform: `translate(calc(-50% + ${watermarkOffsetX * 5}%), calc(-50% + ${watermarkOffsetY * 5}%))`
                        };
                      default: 
                        return { 
                          bottom: `${basePadding}%`, 
                          right: `${basePadding}%`, 
                          maxWidth: '16%', 
                          maxHeight: '16%' 
                        };
                    }
                  })()
                }} 
              />
            ) : (
              <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gridTemplateRows: 'repeat(4, 1fr)', opacity: 0.2, pointerEvents: 'none', zIndex: 5 }}>
                {Array.from({ length: 16 }).map((_, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img src={globalWatermark.url} style={{ maxWidth: '40%', maxHeight: '40%', objectFit: 'contain' }} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        .photo-card-item:hover img {
          transform: scale(1.03);
          transition: transform 0.2s ease;
        }
        .photo-card-item:hover .photo-select-checkbox {
          opacity: 1 !important;
        }
        .photo-card-item:hover .photo-delete-btn {
          display: flex !important;
        }
        
        .folder-action-btn {
          opacity: 0;
          transition: opacity 0.2s ease, color 0.15s ease;
        }
        .folder-list-item:hover .folder-action-btn {
          opacity: 0.6;
        }
        .folder-action-btn:hover {
          opacity: 1 !important;
          color: var(--gold-accent) !important;
        }
        .folder-delete-btn:hover {
          color: #E06C75 !important;
        }

        .lightbox-ctrl-btn:hover {
          background-color: var(--gold-accent) !important;
          border-color: var(--gold-accent) !important;
          color: #FAF9F6 !important;
          transform: scale(1.05);
        }

        .grayscale {
          filter: grayscale(100%);
        }
        .badge-bw-inline {
          font-size: 9px;
          padding: 1px 6px;
          border-radius: 3px;
          font-weight: 600;
          display: inline-block;
          margin-top: 4px;
        }
        .badge-bw-inline.bw {
          background-color: #000000;
          color: #FFFFFF;
          border: 1px solid #3E3B39;
        }
        .badge-bw-inline.color {
          background-color: rgba(95, 11, 2, 0.25);
          color: #D8D0C8;
        }
      `}</style>

    </div>
  );
};

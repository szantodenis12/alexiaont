import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { doc, getDoc, collection, getDocs, addDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { 
  Download, Share2, Play, Pause, ChevronLeft, ChevronRight, X, 
  Image as ImageIcon, ArrowDown, RefreshCw, Check, MoreVertical, Mail
} from 'lucide-react';
import JSZip from 'jszip';

interface PhotoItem {
  firestoreId?: string;
  name: string;
  url: string;
  cleanUrl?: string;
  path: string;
  cleanPath?: string;
  width?: number;
  height?: number;
  previewUrl?: string;       // compressed ~1200px (watermarked) — for web grid
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
  hasManualOrder?: boolean;
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
  titleStyle: {
    fontFamily: string;
    fontSize: string;
    color: string;
    position: 'bottom-left' | 'center' | 'bottom-center' | 'top-center';
  };
  subCollections: SubCollection[];
  watermarkEnabled?: boolean;
  watermarkPosition?: 'center' | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'bottom-center' | 'tile';
  watermarkOffsetX?: number;
  watermarkOffsetY?: number;
}

interface PhotoGalleryViewProps {
  cleanMode?: boolean;
}

export const PhotoGalleryView: React.FC<PhotoGalleryViewProps> = ({ cleanMode = false }) => {
  const { galleryId } = useParams<{ galleryId: string }>();
  
  const [gallery, setGallery] = useState<GalleryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Navigation / filter
  const [activeSubId, setActiveSubId] = useState('all');
  const [photosToRender, setPhotosToRender] = useState<PhotoItem[]>([]);

  // Cache: photos already fetched per subcollection (outside React state — no re-render overhead)
  const loadedPhotosCache = useRef<Map<string, PhotoItem[]>>(new Map());
  // Tracks the currently active folder fetch — prevents stale results from overwriting UI
  const activeSubFetchRef = useRef<string | null>(null);
  
  // Lightbox / Slideshow
  const [activePhotoIdx, setActivePhotoIdx] = useState<number | null>(null);
  const [isSlideshowPlaying, setIsSlideshowPlaying] = useState(false);
  const [slideshowTimer, setSlideshowTimer] = useState<any | null>(null);
  
  // Touch event states for swipe on mobile
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [touchEndX, setTouchEndX] = useState<number | null>(null);
  
  // Actions
  const [isDownloading, setIsDownloading] = useState(false);
  const [zipProgress, setZipProgress] = useState<number | null>(null);
  const [showShareToast, setShowShareToast] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  
  // Email Gate & Download tracking
  const [clientEmail, setClientEmail] = useState<string>(() => {
    // Email is cached for 10 days; after that the user is asked again so
    // downloads remain linked to a valid, fresh email address.
    const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;
    const saved = localStorage.getItem('xia_client_email');
    const savedTs = localStorage.getItem('xia_client_email_ts');
    if (saved && savedTs && Date.now() - parseInt(savedTs, 10) < TEN_DAYS_MS) {
      return saved;
    }
    // Expired or never set — clear and force re-entry
    localStorage.removeItem('xia_client_email');
    localStorage.removeItem('xia_client_email_ts');
    return '';
  });
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [modalEmailInput, setModalEmailInput] = useState('');
  const [pendingDownloadAction, setPendingDownloadAction] = useState<{ type: 'single' | 'zip'; photoUrl?: string; photoName?: string; isGrayscale?: boolean } | null>(null);
  const [isGrayscaleActive, setIsGrayscaleActive] = useState(false);
  const [photographerProfile, setPhotographerProfile] = useState<{ avatarUrl: string; link: string } | null>(null);
  const [globalWatermarkUrl, setGlobalWatermarkUrl] = useState<string | null>(null);
  const [aspectRatios, setAspectRatios] = useState<Record<string, number>>({});
  const [columnsCount, setColumnsCount] = useState(5);

  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth;
      if (w > 1200) setColumnsCount(5);
      else if (w > 900) setColumnsCount(4);
      else if (w > 600) setColumnsCount(3);
      else setColumnsCount(2); // 2 columns on mobile
    };
    
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);



  const fetchPhotosForSub = async (sub: SubCollection, gId: string): Promise<PhotoItem[]> => {
    try {
      const photosSnap = await getDocs(
        collection(db, 'photo_galleries', gId, 'subcollections', sub.id, 'photos')
      );
      const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
      if (!photosSnap.empty) {
        const photos: PhotoItem[] = photosSnap.docs.map(d => ({
          firestoreId: d.id,
          ...(d.data() as Omit<PhotoItem, 'firestoreId'>)
        }));
        if (sub.hasManualOrder) {
          // null-order photos (uploaded after manual ordering was set) sort to the END
          photos.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
        } else {
          photos.sort((a, b) => collator.compare(a.name, b.name));
        }
        return photos;
      } else {
        const embedded = sub.photos || [];
        const photos = [...embedded];
        photos.sort((a, b) => collator.compare(a.name, b.name));
        return photos;
      }
    } catch (e) {
      console.warn('Error fetching photos for subcollection:', sub.id, e);
      return sub.photos || [];
    }
  };

  useEffect(() => {
    // Reset cache when gallery changes
    loadedPhotosCache.current = new Map();
    activeSubFetchRef.current = null;

    const fetchGallery = async () => {
      if (!galleryId) {
        setError('ID-ul galeriei lipseste.');
        setLoading(false);
        return;
      }
      try {
        const docRef = doc(db, 'photo_galleries', galleryId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data() as GalleryData;
          const subs: SubCollection[] = data.subCollections || [];
          // Set gallery metadata once — never patched again
          setGallery(data);

          if (subs.length > 0) {
            const firstSub = subs[0];
            setActiveSubId(firstSub.id);
            activeSubFetchRef.current = firstSub.id;

            const firstPhotos = await fetchPhotosForSub(firstSub, galleryId);
            // Store in cache
            loadedPhotosCache.current.set(firstSub.id, firstPhotos);
            // Only update UI if first folder is still the active one
            if (activeSubFetchRef.current === firstSub.id) {
              setPhotosToRender(firstPhotos);
            }
          }

          // Fetch photographer profile settings
          try {
            const settingsSnap = await getDoc(doc(db, 'settings', 'global'));
            if (settingsSnap.exists()) {
              const sData = settingsSnap.data();
              if (sData.photographerProfile) {
                setPhotographerProfile(sData.photographerProfile);
              }
              if (sData.defaultWatermark && sData.defaultWatermark.url) {
                setGlobalWatermarkUrl(sData.defaultWatermark.url);
              }
            }
          } catch (e) {
            console.warn('Could not load global photographer profile:', e);
          }
        } else {
          setError('Galeria foto nu a fost gasita.');
        }
      } catch (err) {
        console.error('Error fetching gallery:', err);
        setError('Eroare la incarcarea galeriei foto.');
      } finally {
        setLoading(false);
      }
    };

    fetchGallery();
  }, [galleryId]);

  // Dynamically set browser tab title based on gallery info
  useEffect(() => {
    if (gallery) {
      const originalTitle = document.title;
      document.title = gallery.subtitle 
        ? `${gallery.title} by ${gallery.subtitle}` 
        : gallery.title;
        
      return () => {
        document.title = originalTitle;
      };
    }
  }, [gallery]);

  // Handle active subcollection changes
  // Cache-first: instant if already fetched; race-condition-safe if fetching for first time
  const handleSubSelect = async (subId: string) => {
    setActiveSubId(subId);
    // Mark this folder as the active fetch target
    activeSubFetchRef.current = subId;

    // Instant from cache — no Firestore request needed
    if (loadedPhotosCache.current.has(subId)) {
      setPhotosToRender(loadedPhotosCache.current.get(subId)!);
      return;
    }

    // First time opening this folder — fetch from Firestore
    const sub = gallery?.subCollections.find(s => s.id === subId);
    if (!sub || !galleryId) return;

    const photos = await fetchPhotosForSub(sub, galleryId);
    // Store in cache for future instant access
    loadedPhotosCache.current.set(subId, photos);

    // Only update UI if user hasn't clicked another folder while this was loading
    if (activeSubFetchRef.current === subId) {
      setPhotosToRender(photos);
    }
  };

  // Slideshow play/pause effect
  useEffect(() => {
    if (isSlideshowPlaying && activePhotoIdx !== null) {
      const timer = setInterval(() => {
        setActivePhotoIdx(prevIdx => {
          if (prevIdx === null) return null;
          const next = prevIdx + 1;
          return next >= photosToRender.length ? 0 : next;
        });
      }, 3500); // 3.5 seconds per slide
      setSlideshowTimer(timer);
    } else {
      if (slideshowTimer) {
        clearInterval(slideshowTimer);
        setSlideshowTimer(null);
      }
    }

    return () => {
      if (slideshowTimer) clearInterval(slideshowTimer);
    };
  }, [isSlideshowPlaying, activePhotoIdx, photosToRender]);

  const handleStartSlideshow = () => {
    if (photosToRender.length === 0) return;
    setActivePhotoIdx(0);
    setIsSlideshowPlaying(true);
    setShowMobileMenu(false);
  };

  const handleNextPhoto = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (activePhotoIdx === null || photosToRender.length === 0) return;
    const next = activePhotoIdx + 1;
    setActivePhotoIdx(next >= photosToRender.length ? 0 : next);
  };

  const handlePrevPhoto = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (activePhotoIdx === null || photosToRender.length === 0) return;
    const prev = activePhotoIdx - 1;
    setActivePhotoIdx(prev < 0 ? photosToRender.length - 1 : prev);
  };

  const handleCloseLightbox = () => {
    setActivePhotoIdx(null);
    setIsSlideshowPlaying(false);
    setIsGrayscaleActive(false);
  };

  // Swipe gesture detection
  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchEndX(null);
    setTouchStartX(e.targetTouches[0].clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    setTouchEndX(e.targetTouches[0].clientX);
  };

  const handleTouchEnd = () => {
    if (touchStartX === null || touchEndX === null) return;
    const distance = touchStartX - touchEndX;
    const minSwipeDistance = 50;
    
    if (distance > minSwipeDistance) {
      handleNextPhoto();
    } else if (distance < -minSwipeDistance) {
      handlePrevPhoto();
    }
  };

  // Helper: Log download in Firestore
  const logGalleryDownload = async (email: string, files: string[]) => {
    if (!gallery || !galleryId) return;
    try {
      await addDoc(collection(db, 'downloads'), {
        galleryId,
        galleryTitle: gallery.title,
        email: email.trim().toLowerCase(),
        filesList: files,
        downloadedAt: new Date()
      });
    } catch (err) {
      console.error('Error logging download:', err);
    }
  };

  // Helper: Convert a colored image blob to grayscale using HTML5 canvas
  const convertBlobToGrayscale = (blob: Blob): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = URL.createObjectURL(blob);
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }
        ctx.filter = 'grayscale(100%)';
        ctx.drawImage(img, 0, 0);
        
        canvas.toBlob((b) => {
          URL.revokeObjectURL(img.src);
          if (b) {
            resolve(b);
          } else {
            reject(new Error('Canvas conversion to Blob failed'));
          }
        }, 'image/jpeg', 0.95);
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(img.src);
        reject(e);
      };
    });
  };

  // Helper: Apply watermark to a clean high-resolution image blob dynamically using HTML5 canvas
  const applyWatermarkToBlob = (
    imageBlob: Blob,
    watermarkUrl: string,
    position: 'center' | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'bottom-center' | 'tile' | null,
    offsetX: number = 0,
    offsetY: number = 0
  ): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = URL.createObjectURL(imageBlob);
      img.onload = async () => {
        try {
          const width = img.naturalWidth;
          const height = img.naturalHeight;
          
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            throw new Error('Could not get 2D canvas context');
          }
          
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, width, height);
          
          // Load watermark image
          const watermarkImg = new Image();
          watermarkImg.crossOrigin = 'anonymous';
          watermarkImg.src = watermarkUrl;
          
          await new Promise<void>((wResolve, wReject) => {
            watermarkImg.onload = () => wResolve();
            watermarkImg.onerror = (e) => wReject(new Error('Failed to load watermark image: ' + e));
          });
          
          const padding = Math.max(width, height) * 0.02;
          
          if (position === 'tile') {
            ctx.save();
            ctx.globalAlpha = 0.25;
            const tileWidth = width * 0.12;
            const scale = tileWidth / watermarkImg.naturalWidth;
            const tileHeight = watermarkImg.naturalHeight * scale;
            const cols = 4;
            const rows = 4;
            const xSpacing = width / cols;
            const ySpacing = height / rows;
            for (let c = 0; c < cols; c++) {
              for (let r = 0; r < rows; r++) {
                const x = c * xSpacing + (xSpacing - tileWidth) / 2;
                const y = r * ySpacing + (ySpacing - tileHeight) / 2;
                ctx.drawImage(watermarkImg, x, y, tileWidth, tileHeight);
              }
            }
            ctx.restore();
          } else {
            let wWidth = width * 0.16;
            if (wWidth < 80) wWidth = Math.min(80, width);
            if (wWidth > 500) wWidth = 500;
            const scale = wWidth / watermarkImg.naturalWidth;
            const wHeight = watermarkImg.naturalHeight * scale;
            
            const shiftX = (offsetX || 0) * 0.05 * wWidth;
            const shiftY = (offsetY || 0) * 0.05 * wHeight;
            
            let x = padding;
            let y = padding;
            const activePos = position || 'bottom-right';
            
            switch (activePos) {
              case 'bottom-right':
                x = width - wWidth - padding - shiftX;
                y = height - wHeight - padding - shiftY;
                break;
              case 'bottom-left':
                x = padding + shiftX;
                y = height - wHeight - padding - shiftY;
                break;
              case 'bottom-center':
                x = (width - wWidth) / 2 + shiftX;
                y = height - wHeight - padding - shiftY;
                break;
              case 'top-right':
                x = width - wWidth - padding - shiftX;
                y = padding + shiftY;
                break;
              case 'top-left':
                x = padding + shiftX;
                y = padding + shiftY;
                break;
              case 'center':
                x = (width - wWidth) / 2 + shiftX;
                y = (height - wHeight) / 2 + shiftY;
                break;
            }
            
            ctx.save();
            ctx.globalAlpha = 0.45;
            ctx.drawImage(watermarkImg, x, y, wWidth, wHeight);
            ctx.restore();
          }
          
          canvas.toBlob((b) => {
            if (b) {
              resolve(b);
            } else {
              reject(new Error('Canvas toBlob failed'));
            }
          }, 'image/jpeg', 0.95);
        } catch (grayErr) {
          reject(grayErr);
        } finally {
          URL.revokeObjectURL(img.src);
        }
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(img.src);
        reject(e);
      };
    });
  };

  // Trigger single photo download
  const handleInitiateSingleDownload = (photo: PhotoItem, forceGrayscale?: boolean) => {
    const downloadUrl = photo.cleanUrl || photo.url;
    if (!clientEmail && !cleanMode) {
      setPendingDownloadAction({ type: 'single', photoUrl: downloadUrl, photoName: photo.name, isGrayscale: forceGrayscale });
      setShowEmailModal(true);
      return;
    }
    executeSingleDownload(downloadUrl, photo.name, clientEmail || 'admin-clean-mode', forceGrayscale);
  };

  const executeSingleDownload = async (url: string, fileName: string, email: string, isGrayscale?: boolean) => {
    try {
      const res = await fetch(url);
      let blob = await res.blob();

      // Apply watermark dynamically if downloading from normal mode and a global watermark exists
      if (!cleanMode && globalWatermarkUrl) {
        try {
          blob = await applyWatermarkToBlob(
            blob,
            globalWatermarkUrl,
            gallery?.watermarkPosition || 'bottom-right',
            gallery?.watermarkOffsetX || 0,
            gallery?.watermarkOffsetY || 0
          );
        } catch (wmErr) {
          console.error('Dynamic watermark drawing failed during download:', wmErr);
        }
      }

      if (isGrayscale) {
        try {
          blob = await convertBlobToGrayscale(blob);
        } catch (grayErr) {
          console.error('Grayscale canvas conversion failed, falling back to original:', grayErr);
        }
      }

      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = fileName || 'fotografie.jpg';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);

      logGalleryDownload(email, [fileName || 'fotografie.jpg']);
    } catch (err) {
      console.error('Error fetching single photo for download:', err);
      window.open(url, '_blank');
      logGalleryDownload(email, [fileName || 'fotografie.jpg']);
    }
  };

  // ZIP Download of active collection
  const handleInitiateZipDownload = () => {
    if (photosToRender.length === 0) return;
    if (!clientEmail && !cleanMode) {
      setPendingDownloadAction({ type: 'zip' });
      setShowEmailModal(true);
      return;
    }
    executeZipDownload(clientEmail || 'admin-clean-mode');
  };

  const executeZipDownload = async (email: string) => {
    if (photosToRender.length === 0) return;
    setIsDownloading(true);
    setZipProgress(0);
    setShowMobileMenu(false);
    
    try {
      const zip = new JSZip();
      const folderName = gallery?.title.replace(/[^a-z0-9]/gi, '_') || 'galerie_foto';
      const subName = gallery?.subCollections.find(s => s.id === activeSubId)?.name.replace(/[^a-z0-9]/gi, '_') || 'selectie';
      
      const zipFolder = zip.folder(`${folderName}_${subName}`);
      if (!zipFolder) throw new Error('Nu s-a putut genera folderul ZIP.');
      
      const downloadedNames: string[] = [];

      for (let i = 0; i < photosToRender.length; i++) {
        const photo = photosToRender[i];
        const fetchUrl = photo.cleanUrl || photo.url;
        const res = await fetch(fetchUrl);
        let blob = await res.blob();

        // Apply watermark dynamically on ZIP download if in normal mode and a global watermark exists
        if (!cleanMode && globalWatermarkUrl) {
          try {
            blob = await applyWatermarkToBlob(
              blob,
              globalWatermarkUrl,
              gallery?.watermarkPosition || 'bottom-right',
              gallery?.watermarkOffsetX || 0,
              gallery?.watermarkOffsetY || 0
            );
          } catch (wmErr) {
            console.error('Error applying dynamic watermark in zip:', wmErr);
          }
        }

        const fName = photo.name || `photo_${i + 1}.jpg`;
        zipFolder.file(fName, blob);
        downloadedNames.push(fName);
        
        setZipProgress(Math.round(((i + 1) / photosToRender.length) * 100));
      }
      
      const content = await zip.generateAsync({ type: 'blob' });
      const blobUrl = window.URL.createObjectURL(content);
      
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `${folderName}_${subName}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);

      logGalleryDownload(email, [`Arhivă ZIP (${downloadedNames.length} fotografii)`]);
    } catch (err) {
      console.error('ZIP download error:', err);
      alert('Descărcarea arhivei ZIP a eșuat.');
    } finally {
      setIsDownloading(false);
      setZipProgress(null);
    }
  };

  const handleConfirmEmailModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalEmailInput || !modalEmailInput.includes('@')) {
      alert('Te rugăm să introduci o adresă de email validă.');
      return;
    }
    const cleanEmail = modalEmailInput.trim().toLowerCase();
    setClientEmail(cleanEmail);
    localStorage.setItem('xia_client_email', cleanEmail);
    localStorage.setItem('xia_client_email_ts', String(Date.now())); // save timestamp for 10-day TTL
    setShowEmailModal(false);

    if (pendingDownloadAction?.type === 'single' && pendingDownloadAction.photoUrl && pendingDownloadAction.photoName) {
      executeSingleDownload(pendingDownloadAction.photoUrl, pendingDownloadAction.photoName, cleanEmail, pendingDownloadAction.isGrayscale);
    } else if (pendingDownloadAction?.type === 'zip') {
      executeZipDownload(cleanEmail);
    }
    setPendingDownloadAction(null);
  };

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setShowShareToast(true);
      setShowMobileMenu(false);
      setTimeout(() => setShowShareToast(false), 2500);
    });
  };

  const scrollToGallery = () => {
    const element = document.getElementById('gallery-nav-anchor');
    element?.scrollIntoView({ behavior: 'smooth' });
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#121110', color: '#FAF9F6', gap: '16px' }}>
        <RefreshCw className="spinner" size={32} style={{ color: 'var(--gold-accent)' }} />
        <p style={{ fontSize: '14px', letterSpacing: '0.05em', color: '#A3A09B' }}>Se încarcă galeria foto...</p>
      </div>
    );
  }

  if (error || !gallery) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#121110', color: '#FAF9F6', padding: '24px', textAlign: 'center' }}>
        <ImageIcon size={48} style={{ color: '#E06C75', marginBottom: '16px' }} />
        <h2>Ne pare rău</h2>
        <p style={{ color: '#A3A09B', margin: '8px 0 24px' }}>{error || 'A apărut o eroare la încărcarea datelor.'}</p>
        <Link to="/" className="btn btn-gold" style={{ padding: '8px 24px', fontSize: '13px' }}>Acasă</Link>
      </div>
    );
  }

  // Cover typography alignment style generator
  const getAlignmentStyle = (pos: GalleryData['titleStyle']['position']): React.CSSProperties => {
    switch (pos) {
      case 'bottom-left':
        return { bottom: '8%', left: '8%', textAlign: 'left' };
      case 'bottom-center':
        return { bottom: '8%', left: '50%', transform: 'translateX(-50%)', textAlign: 'center' };
      case 'center':
        return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' };
      case 'top-center':
        return { top: '8%', left: '50%', transform: 'translateX(-50%)', textAlign: 'center' };
      default:
        return { bottom: '8%', left: '8%', textAlign: 'left' };
    }
  };

  const coverFocal = gallery.coverPhoto?.focalPoint || { x: 50, y: 50 };

  // Distribute photos into columns using a height-balanced shortest-column approach.
  // Each photo goes to the column with the least total estimated height,
  // ensuring all columns end at roughly the same height regardless of photo orientations.
  // (Round-robin caused severely uneven columns when photos had mixed landscape/portrait ratios.)
  const distributePhotos = (photos: PhotoItem[], numCols: number) => {
    const cols: PhotoItem[][] = Array.from({ length: numCols }, () => []);
    const colHeights: number[] = new Array(numCols).fill(0);

    photos.forEach((photo) => {
      // Find the column with the least accumulated height
      let shortestCol = 0;
      for (let c = 1; c < numCols; c++) {
        if (colHeights[c] < colHeights[shortestCol]) shortestCol = c;
      }
      cols[shortestCol].push(photo);

      // Estimate this photo's height contribution (column width = 1 unit)
      const aspect = (photo.width && photo.height)
        ? photo.width / photo.height
        : (aspectRatios[photo.path] || 4 / 3);
      colHeights[shortestCol] += 1 / aspect;
    });

    return cols;
  };

  const photoColumns = distributePhotos(photosToRender, columnsCount);

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0C0B0A', color: '#F3EDE7', fontFamily: 'Outfit, sans-serif' }}>
      
      {/* Clean Mode Admin Banner */}
      {cleanMode && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          zIndex: 99999,
          backgroundColor: '#D4AF37',
          color: '#121110',
          padding: '10px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '10px',
          fontSize: '13px',
          fontWeight: 700,
          letterSpacing: '0.05em',
          boxShadow: '0 2px 10px rgba(0,0,0,0.3)'
        }}>
          🔓 LINK EDITARE — Pozele în această galerie sunt FĂRĂ watermark. Nu distribui acest link clienților!
        </div>
      )}

      {/* 1. HERO HEADER COVER PAGE */}
      <section className="hero-section" style={{ width: '100%', position: 'relative', overflow: 'hidden', marginTop: cleanMode ? '40px' : 0 }}>
        {gallery.coverPhoto ? (
          <img 
            src={gallery.coverPhoto.url} 
            alt={gallery.title} 
            className="cover-photo-img"
            style={{ 
              width: '100%', 
              height: '100%', 
              objectFit: 'cover', 
              objectPosition: `${coverFocal.x}% ${coverFocal.y}%`
            }} 
          />
        ) : (
          <div style={{ width: '100%', height: '100%', backgroundColor: '#1A1A1A' }} />
        )}

        {/* Photographer Badge Overlay (Top Left) */}
        {gallery.subtitle && (
          <div 
            style={{ 
              position: 'absolute', 
              top: '40px', 
              left: '40px', 
              zIndex: 30,
              display: 'flex',
              alignItems: 'center'
            }}
            className="photographer-header-badge"
          >
            {photographerProfile?.link ? (
              <a 
                href={photographerProfile.link.startsWith('http') ? photographerProfile.link : `https://${photographerProfile.link}`} 
                target="_blank" 
                rel="noopener noreferrer" 
                style={{ display: 'flex', alignItems: 'center', gap: '12px', textDecoration: 'none' }}
              >
                {photographerProfile?.avatarUrl && (
                  <img 
                    src={photographerProfile.avatarUrl} 
                    alt={gallery.subtitle} 
                    style={{ width: '52px', height: '52px', borderRadius: '6px', objectFit: 'cover', border: 'none', boxShadow: 'none' }} 
                  />
                )}
                <span 
                  style={{ 
                    color: '#FAF9F6', 
                    fontSize: '11px', 
                    fontWeight: 600, 
                    letterSpacing: '0.12em', 
                    textTransform: 'uppercase',
                    textShadow: '0 2px 8px rgba(0,0,0,0.8)',
                    fontFamily: 'Outfit, sans-serif'
                  }}
                >
                  {gallery.subtitle}
                </span>
              </a>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {photographerProfile?.avatarUrl && (
                  <img 
                    src={photographerProfile.avatarUrl} 
                    alt={gallery.subtitle} 
                    style={{ width: '52px', height: '52px', borderRadius: '6px', objectFit: 'cover', border: 'none', boxShadow: 'none' }} 
                  />
                )}
                <span 
                  style={{ 
                    color: '#FAF9F6', 
                    fontSize: '11px', 
                    fontWeight: 600, 
                    letterSpacing: '0.12em', 
                    textTransform: 'uppercase',
                    textShadow: '0 2px 8px rgba(0,0,0,0.8)',
                    fontFamily: 'Outfit, sans-serif'
                  }}
                >
                  {gallery.subtitle}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Cover Info Text */}
        <div 
          style={{ 
            position: 'absolute', 
            zIndex: 10,
            textShadow: '0 4px 15px rgba(0,0,0,0.85)',
            width: '84%',
            ...getAlignmentStyle(gallery.titleStyle?.position || 'bottom-left')
          }}
        >
          <h1 
            className="cover-title-text"
            style={{ 
              fontFamily: gallery.titleStyle?.fontFamily || 'Outfit', 
              fontSize: gallery.titleStyle?.fontSize || '48px', 
              color: gallery.titleStyle?.color || '#FAF9F6',
              margin: '0 0 8px 0', 
              fontWeight: 700, 
              lineHeight: 1.1,
              letterSpacing: '-0.02em',
              textTransform: 'uppercase'
            }}
          >
            {gallery.title}
          </h1>

          {/* Mobile-Only Stacked View Gallery Button */}
          <button 
            onClick={scrollToGallery}
            className="view-gallery-btn-mobile-only"
            style={{ 
              backgroundColor: 'transparent',
              border: '1.5px solid #FAF9F6',
              color: '#FAF9F6',
              borderRadius: '0',
              cursor: 'pointer',
              transition: 'all 0.3s ease'
            }}
          >
            VIEW GALLERY <ArrowDown size={13} className="bounce-arrow" />
          </button>
        </div>

        {/* Desktop-Only Positioned View Gallery Button */}
        <button 
          onClick={scrollToGallery}
          className="view-gallery-btn-cover"
        >
          VIEW GALLERY <ArrowDown size={14} className="bounce-arrow" />
        </button>
      </section>
 
      <div id="gallery-nav-anchor" />

      {/* 2. MOBILE EXCLUSIVE BRAND HEADER (Visible only on Mobile) */}
      <div className="mobile-gallery-brand-header">
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#FAF9F6', margin: 0, textTransform: 'uppercase', letterSpacing: '0.02em' }}>
            {gallery.title}
          </h2>
          {gallery.subtitle && (
            <p style={{ fontSize: '11px', color: '#706E6A', margin: '4px 0 0 0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {gallery.subtitle}
            </p>
          )}
        </div>
        <button 
          onClick={() => setShowMobileMenu(true)}
          style={{ background: 'none', border: 'none', color: '#FAF9F6', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '6px' }}
        >
          <MoreVertical size={20} />
        </button>
      </div>
 
      {/* 3. STICKY SUB-COLLECTIONS NAVIGATION BAR */}
      <nav className="nav-bar-container">
        {/* Left: Brand Identity (Desktop Only) */}
        <div className="desktop-only-flex" style={{ flexDirection: 'column' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, letterSpacing: '0.05em', color: '#FAF9F6', textTransform: 'uppercase' }}>
            {gallery.title}
          </span>
          {gallery.subtitle && (
            <span style={{ fontSize: '9px', color: '#706E6A', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '2px' }}>
              {gallery.subtitle}
            </span>
          )}
        </div>
 
        {/* Center: Folders (Subcollection Buttons) */}
        <div className="folders-nav-wrapper hide-scrollbar">
          {gallery.subCollections.map(sub => (
            <button 
              key={sub.id} 
              onClick={(e) => {
                handleSubSelect(sub.id);
                e.currentTarget.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
              }}
              style={{ 
                background: 'none', 
                border: 'none', 
                color: activeSubId === sub.id ? '#FAF9F6' : '#706E6A', 
                fontSize: '12px',
                fontWeight: 600,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                padding: '8px 0',
                cursor: 'pointer',
                borderBottom: activeSubId === sub.id ? '2px solid var(--gold-accent)' : '2px solid transparent',
                transition: 'all 0.2s ease',
                whiteSpace: 'nowrap',
                flexShrink: 0
              }}
            >
              {sub.name}
            </button>
          ))}
        </div>
 
        {/* Right: Actions (Desktop Only) */}
        <div className="desktop-only-flex" style={{ alignItems: 'center', gap: '16px' }}>
          <button 
            onClick={handleStartSlideshow} 
            title="Prezentare Slideshow"
            style={{ background: 'none', border: 'none', color: '#D8D0C8', cursor: 'pointer', display: 'flex', alignItems: 'center', transition: 'color 0.15s' }}
            onMouseOver={(e) => e.currentTarget.style.color = '#FAF9F6'}
            onMouseOut={(e) => e.currentTarget.style.color = '#D8D0C8'}
          >
            <Play size={18} />
          </button>
          <button 
            onClick={handleShare} 
            title="Copiază link partajare"
            style={{ background: 'none', border: 'none', color: '#D8D0C8', cursor: 'pointer', display: 'flex', alignItems: 'center', transition: 'color 0.15s' }}
            onMouseOver={(e) => e.currentTarget.style.color = '#FAF9F6'}
            onMouseOut={(e) => e.currentTarget.style.color = '#D8D0C8'}
          >
            <Share2 size={18} />
          </button>
          <button 
            onClick={handleInitiateZipDownload} 
            title="Descarcă această colecție (.zip)"
            disabled={isDownloading}
            style={{ background: 'none', border: 'none', color: '#D8D0C8', cursor: 'pointer', display: 'flex', alignItems: 'center', transition: 'color 0.15s' }}
            onMouseOver={(e) => e.currentTarget.style.color = '#FAF9F6'}
            onMouseOut={(e) => e.currentTarget.style.color = '#D8D0C8'}
          >
            {isDownloading ? <RefreshCw className="spinner" size={18} /> : <Download size={18} />}
          </button>
        </div>
      </nav>
 
      {/* Share toast overlay */}
      {showShareToast && (
        <div style={{ position: 'fixed', bottom: '30px', left: '50%', transform: 'translateX(-50%)', backgroundColor: '#262423', border: '1px solid var(--border-color)', color: '#FAF9F6', padding: '12px 24px', borderRadius: '4px', fontSize: '13px', zIndex: 900, boxShadow: '0 4px 15px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Check size={16} style={{ color: '#2ECC71' }} />
          <span>Link-ul galeriei a fost copiat!</span>
        </div>
      )}
 
      {/* ZIP download progress toast */}
      {isDownloading && zipProgress !== null && (
        <div style={{ position: 'fixed', bottom: '30px', left: '50%', transform: 'translateX(-50%)', backgroundColor: '#1C1A19', border: '1px solid var(--border-color)', color: '#FAF9F6', padding: '16px 24px', borderRadius: '4px', fontSize: '13px', zIndex: 900, boxShadow: '0 4px 15px rgba(0,0,0,0.3)', width: '300px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
            <span>Se descarcă pozele...</span>
            <span>{zipProgress}%</span>
          </div>
          <div style={{ width: '100%', height: '4px', backgroundColor: '#2D2A28', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{ width: `${zipProgress}%`, height: '100%', backgroundColor: 'var(--gold-accent)', transition: 'width 0.2s' }} />
          </div>
        </div>
      )}
 
      {/* 4. MOBILE DROPDOWN BOTTOM SHEET MENU */}
      {showMobileMenu && (
        <div 
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)', zIndex: 1000, display: 'flex', alignItems: 'flex-end' }}
          onClick={() => setShowMobileMenu(false)}
        >
          <div 
            style={{ width: '100%', backgroundColor: '#161514', borderTopLeftRadius: '12px', borderTopRightRadius: '12px', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: '8px', boxShadow: '0 -4px 20px rgba(0,0,0,0.5)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <span style={{ fontSize: '11px', color: '#706E6A', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Meniu Galerie</span>
              <button onClick={() => setShowMobileMenu(false)} style={{ background: 'none', border: 'none', color: '#FAF9F6', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            
            <button 
              onClick={handleStartSlideshow} 
              style={{ width: '100%', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', borderRadius: '6px', color: '#FAF9F6', fontSize: '14px', fontWeight: 500, cursor: 'pointer', textAlign: 'left' }}
            >
              <Play size={16} style={{ color: 'var(--gold-accent)' }} /> Prezentare Slideshow
            </button>

            <button 
              onClick={handleShare} 
              style={{ width: '100%', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', borderRadius: '6px', color: '#FAF9F6', fontSize: '14px', fontWeight: 500, cursor: 'pointer', textAlign: 'left' }}
            >
              <Share2 size={16} style={{ color: 'var(--gold-accent)' }} /> Copiază Link Partajare
            </button>

            <button 
              onClick={handleInitiateZipDownload} 
              disabled={isDownloading}
              style={{ width: '100%', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', borderRadius: '6px', color: '#FAF9F6', fontSize: '14px', fontWeight: 500, cursor: 'pointer', textAlign: 'left' }}
            >
              {isDownloading ? <RefreshCw className="spinner" size={16} /> : <Download size={16} style={{ color: 'var(--gold-accent)' }} />}
              Descarcă Folder (.zip)
            </button>
          </div>
        </div>
      )}

      {/* 5. WATERFALL MASONRY PHOTO GRID */}
      <main className="gallery-main-container">
        {photosToRender.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 0', color: '#706E6A', fontSize: '14px' }}>
            Nicio fotografie încărcată în această colecție.
          </div>
        ) : (
          <div 
            key={activeSubId}
            style={{ 
              display: 'flex', 
              gap: columnsCount > 2 ? '4px' : '3px', 
              width: '100%', 
              boxSizing: 'border-box' 
            }}
          >
            {photoColumns.map((col, colIdx) => (
              <div 
                key={`${activeSubId}_col_${colIdx}`} 
                style={{ 
                  flex: 1, 
                  display: 'flex', 
                  flexDirection: 'column', 
                  gap: columnsCount > 2 ? '4px' : '3px' 
                }}
              >
                {col.map((photo, photoIdx) => {
                  // Pre-compute aspect ratio from stored dimensions (width/height saved at upload time).
                  // This reserves the correct container height BEFORE the image loads,
                  // eliminating layout shift (CLS) and making the page feel instant.
                  const storedAspect = photo.width && photo.height
                    ? photo.width / photo.height
                    : (aspectRatios[photo.path] || null);

                  // First photo in each column is above the fold → load eagerly.
                  // All others are below the fold → lazy-load to save bandwidth.
                  const isAboveFold = photoIdx === 0;

                  return (
                    <div 
                      key={photo.firestoreId || `${photo.path}_${photoIdx}`} 
                      className="waterfall-item-pixie"
                      onClick={() => {
                        const origIdx = photosToRender.findIndex(p => p.path === photo.path);
                        setActivePhotoIdx(origIdx);
                      }}
                      style={{
                        position: 'relative',
                        cursor: 'pointer',
                        overflow: 'hidden',
                        width: '100%',
                        animationDelay: `${(photoIdx % 8) * 0.08}s`,
                        // Reserve the correct height before the image loads
                        aspectRatio: storedAspect ? String(storedAspect) : undefined,
                        // Dark placeholder visible until the image arrives
                        backgroundColor: '#1a1918',
                      }}
                    >
                      <img 
                        src={
                          // Grid thumbnails use compressed preview (~1200px) for fast loading.
                          // Full-res is loaded only in the lightbox (see below).
                          cleanMode
                            ? (photo.previewCleanUrl || photo.cleanUrl || photo.url)
                            : (photo.previewUrl || photo.url)
                        }
                        alt={photo.name} 
                        loading={isAboveFold ? 'eager' : 'lazy'}
                        decoding="async"
                        style={{ 
                          width: '100%', 
                          display: 'block', 
                          transition: 'transform 0.4s ease' 
                        }} 
                        onError={(e) => {
                          // Prevent broken-image icon; keep the dark placeholder visible.
                          // Also ensure the container doesn't collapse to 0px when
                          // no stored aspect ratio exists (e.g. old photos or corrupt URLs).
                          const img = e.currentTarget;
                          img.style.display = 'none';
                          const parent = img.parentElement;
                          if (parent && !parent.style.aspectRatio) {
                            parent.style.aspectRatio = '4/3';
                          }
                        }}
                        onLoad={(e) => {
                          if (!photo.width || !photo.height) {
                            const storedRatio = aspectRatios[photo.path];
                            if (!storedRatio) {
                              const img = e.currentTarget;
                              const r = img.naturalWidth / img.naturalHeight;
                              setAspectRatios(prev => ({ ...prev, [photo.path]: r }));
                            }
                          }
                        }}
                      />
                      <div className="waterfall-overlay-pixie">
                        <div style={{ position: 'absolute', bottom: '16px', left: '16px', color: '#FAF9F6', fontSize: '12px', fontWeight: 500, letterSpacing: '0.05em', textShadow: '0 1px 4px rgba(0,0,0,0.8)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '80%' }}>
                          {photo.name || 'Vizualizează'}
                        </div>
                        {/* Quick single download */}
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleInitiateSingleDownload(photo);
                          }}
                          style={{ position: 'absolute', top: '16px', right: '16px', width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'rgba(18, 17, 16, 0.7)', border: 'none', color: '#FAF9F6', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s', cursor: 'pointer' }}
                          className="quick-download-btn"
                          title="Descarcă această fotografie"
                        >
                          <Download size={16} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </main>

      {/* 6. NEXT FOLDER BUTTON — mobile only, shown when there's another subcollection */}
      {(() => {
        const subs = gallery.subCollections || [];
        const currentIdx = subs.findIndex(s => s.id === activeSubId);
        const nextSub = currentIdx >= 0 && currentIdx < subs.length - 1 ? subs[currentIdx + 1] : null;
        if (!nextSub) return null;
        return (
          <div className="next-folder-banner">
            <button
              className="next-folder-btn"
              onClick={() => {
                handleSubSelect(nextSub.id);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            >
              <span style={{ fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', opacity: 0.6, display: 'block', marginBottom: '4px' }}>
                Urmează
              </span>
              <span style={{ fontSize: '15px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                {nextSub.name} →
              </span>
            </button>
          </div>
        );
      })()}

      {/* 6. FULLSCREEN LIGHTBOX & SLIDESHOW OVERLAY */}
      {activePhotoIdx !== null && photosToRender.length > 0 && (
        <div 
          style={{ 
            position: 'fixed', 
            top: 0, 
            left: 0, 
            width: '100vw', 
            height: '100vh', 
            backgroundColor: 'rgba(10, 9, 8, 0.98)', 
            zIndex: 1000, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center' 
          }}
          onClick={handleCloseLightbox}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Close & Slideshow controls top bar */}
          <div 
            style={{ 
              position: 'absolute', 
              top: 0, 
              left: 0, 
              width: '100%', 
              height: '60px', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between', 
              padding: '0 20px', 
              zIndex: 1020, 
              background: 'linear-gradient(to bottom, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0) 100%)' 
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ color: '#D8D0C8', fontSize: '12px', letterSpacing: '0.05em', maxWidth: '40%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activePhotoIdx + 1} / {photosToRender.length} • {photosToRender[activePhotoIdx].name}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <button 
                onClick={() => setIsSlideshowPlaying(!isSlideshowPlaying)} 
                style={{ background: 'none', border: 'none', color: '#D8D0C8', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}
              >
                {isSlideshowPlaying ? (
                  <>
                    <Pause size={15} /> Pauză
                  </>
                ) : (
                  <>
                    <Play size={15} /> Redă
                  </>
                )}
              </button>
              <button 
                onClick={() => setIsGrayscaleActive(!isGrayscaleActive)} 
                style={{ 
                  background: 'none', 
                  border: isGrayscaleActive ? '1px solid var(--gold-accent)' : '1px solid transparent', 
                  color: isGrayscaleActive ? 'var(--gold-accent)' : '#D8D0C8', 
                  cursor: 'pointer', 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '5px', 
                  fontSize: '12px',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  transition: 'all 0.15s ease'
                }}
              >
                <div style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  background: 'linear-gradient(to right, #FAF9F6 50%, #706E6A 50%)',
                  border: '1px solid #FAF9F6'
                }} />
                alb-negru
              </button>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  handleInitiateSingleDownload(photosToRender[activePhotoIdx], isGrayscaleActive);
                }}
                style={{ background: 'none', border: 'none', color: '#D8D0C8', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                title="Descarcă această fotografie"
              >
                <Download size={18} />
              </button>
              <button 
                onClick={handleCloseLightbox} 
                style={{ background: 'none', border: 'none', color: '#D8D0C8', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              >
                <X size={20} />
              </button>
            </div>
          </div>
 
          {/* Left Arrow */}
          <button 
            onClick={handlePrevPhoto} 
            className="lightbox-nav-arrow"
            style={{ position: 'absolute', left: '20px', top: '50%', transform: 'translateY(-50%)', background: 'rgba(18, 17, 16, 0.4)', border: 'none', color: '#FAF9F6', width: '48px', height: '48px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1010 }}
          >
            <ChevronLeft size={24} />
          </button>
 
          {/* Large Image Container */}
          <div 
            style={{ maxWidth: '95%', maxHeight: '80%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={(e) => e.stopPropagation()}
          >
            <img 
              src={cleanMode ? (photosToRender[activePhotoIdx].cleanUrl || photosToRender[activePhotoIdx].url) : photosToRender[activePhotoIdx].url} 
              alt={photosToRender[activePhotoIdx].name} 
              style={{ 
                maxWidth: '100%', 
                maxHeight: '80vh', 
                objectFit: 'contain', 
                boxShadow: '0 10px 40px rgba(0,0,0,0.8)',
                filter: isGrayscaleActive ? 'grayscale(100%)' : 'none',
                transition: 'filter 0.3s ease'
              }} 
            />
          </div>
 
          {/* Right Arrow */}
          <button 
            onClick={handleNextPhoto} 
            className="lightbox-nav-arrow"
            style={{ position: 'absolute', right: '20px', top: '50%', transform: 'translateY(-50%)', background: 'rgba(18, 17, 16, 0.4)', border: 'none', color: '#FAF9F6', width: '48px', height: '48px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1010 }}
          >
            <ChevronRight size={24} />
          </button>
        </div>
      )}
 
      {/* Email Gate Modal Overlay */}
      {showEmailModal && (
        <div 
          style={{ 
            position: 'fixed', 
            top: 0, 
            left: 0, 
            width: '100vw', 
            height: '100vh', 
            backgroundColor: 'rgba(9, 8, 8, 0.95)', 
            zIndex: 9999, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            fontFamily: "'Outfit', sans-serif"
          }}
        >
          <div 
            style={{ 
              backgroundColor: '#161514', 
              border: '1px solid #2D2A28', 
              borderRadius: '8px', 
              width: '90%', 
              maxWidth: '440px', 
              padding: '32px', 
              boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
              position: 'relative'
            }}
          >
            <button 
              onClick={() => { setShowEmailModal(false); setPendingDownloadAction(null); }}
              style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 'none', color: '#706E6A', cursor: 'pointer' }}
            >
              <X size={20} />
            </button>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: '24px' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: 'rgba(212, 175, 55, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gold-accent)', marginBottom: '16px' }}>
                <Mail size={22} />
              </div>
              <h3 style={{ fontSize: '20px', fontWeight: 600, color: '#FAF9F6', margin: '0 0 8px 0' }}>Introduceți adresa de email</h3>
              <p style={{ fontSize: '13px', color: '#A3A09B', margin: 0, lineHeight: 1.4 }}>
                Pentru a putea descărca fotografiile, vă rugăm să introduceți adresa dvs. de email. Aceasta va fi înregistrată în jurnalul de descărcare al galeriei.
              </p>
            </div>

            <form onSubmit={handleConfirmEmailModal} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <input 
                  type="email" 
                  required
                  placeholder="nume@exemplu.com" 
                  value={modalEmailInput}
                  onChange={(e) => setModalEmailInput(e.target.value)}
                  style={{ width: '100%', padding: '12px 14px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '6px', fontSize: '14px', outline: 'none' }}
                />
              </div>
              <button 
                type="submit" 
                style={{ width: '100%', padding: '12px', backgroundColor: 'var(--gold-accent)', border: 'none', color: '#121110', fontWeight: 600, borderRadius: '6px', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
              >
                Continuă descărcarea
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Global CSS classes for premium fluid masonry grid */}
      <style>{`
        .spinner {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        /* Entrance Animations */
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes coverReveal {
          from {
            transform: scale(1.05);
            filter: brightness(0.2);
          }
          to {
            transform: scale(1);
            filter: brightness(0.75);
          }
        }

        @keyframes photoReveal {
          from {
            opacity: 0;
            transform: translateY(12px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        .cover-photo-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          animation: coverReveal 1.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        .photographer-header-badge {
          opacity: 0;
          animation: fadeIn 1s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          animation-delay: 0.2s;
        }

        .cover-title-text {
          opacity: 0;
          animation: fadeInUp 1.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          animation-delay: 0.4s;
        }

        .view-gallery-btn-cover {
          position: absolute;
          bottom: 8%;
          right: 8%;
          z-index: 20;
          background-color: transparent;
          border: 1.5px solid #FAF9F6;
          color: #FAF9F6;
          padding: 12px 28px;
          font-size: 11px;
          letter-spacing: 0.15em;
          font-weight: 600;
          text-transform: uppercase;
          border-radius: 0;
          cursor: pointer;
          transition: all 0.3s ease;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          opacity: 0;
          animation: fadeInUp 1.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          animation-delay: 0.6s;
        }
        
        .view-gallery-btn-cover:hover {
          background-color: #FAF9F6 !important;
          color: #121110 !important;
        }

        .view-gallery-btn-mobile-only {
          display: none !important;
          opacity: 0;
          animation: fadeInUp 1.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          animation-delay: 0.6s;
        }

        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .hide-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        
        /* Next-folder banner: mobile-only, animated fade+slide-up */
        .next-folder-banner {
          display: none;
        }
        @media (max-width: 768px) {
          .next-folder-banner {
            display: flex;
            justify-content: center;
            padding: 48px 24px 64px;
            animation: nextFolderFadeUp 0.6s ease both;
          }
          .next-folder-btn {
            background: transparent;
            border: 1px solid var(--gold-accent, #C9A84C);
            color: #FAF9F6;
            padding: 18px 36px;
            border-radius: 2px;
            cursor: pointer;
            text-align: center;
            transition: background 0.2s ease, transform 0.2s ease;
            line-height: 1.4;
          }
          .next-folder-btn:active {
            background: rgba(201,168,76,0.12);
            transform: scale(0.97);
          }
        }
        @keyframes nextFolderFadeUp {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }


        .bounce-arrow {
          animation: bounce 2s infinite;
        }
        @keyframes bounce {
          0%, 20%, 50%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-6px); }
          60% { transform: translateY(-3px); }
        }
 
        .gallery-main-container {
          padding: 4px;
          width: 100%;
          box-sizing: border-box;
        }

        /* Hero cover photo: full screen on all devices */
        .hero-section {
          height: 100vh;
        }

        .waterfall-item-pixie {
          position: relative;
          cursor: pointer;
          overflow: hidden;
          width: 100%;
          opacity: 0;
          animation: photoReveal 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        
        .waterfall-item-pixie:hover img {
          transform: scale(1.02);
        }
        
        .waterfall-overlay-pixie {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.1) 40%, rgba(0,0,0,0) 100%);
          opacity: 0;
          transition: opacity 0.3s ease;
        }
        .waterfall-item-pixie:hover .waterfall-overlay-pixie {
          opacity: 1;
        }
        
        .quick-download-btn:hover {
          background-color: var(--gold-accent) !important;
          transform: scale(1.05);
        }

        /* Hide grid download button on mobile — only accessible from lightbox */
        @media (max-width: 768px) {
          .quick-download-btn {
            display: none !important;
          }
        }

        .desktop-only-flex {
          display: flex;
        }

        .mobile-gallery-brand-header {
          display: none;
        }

        .nav-bar-container {
          position: sticky;
          top: 0;
          z-index: 80;
          background-color: rgba(18, 17, 16, 0.95);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          border-bottom: 1px solid #262423;
          height: 70px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 24px;
        }

        .folders-nav-wrapper {
          display: flex;
          gap: 24px;
          overflow-x: auto;
          padding: 0 12px;
        }

        @media (max-width: 768px) {
          .desktop-only-flex {
            display: none !important;
          }

          .mobile-gallery-brand-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 20px;
            background-color: #121110;
            border-bottom: 1px solid #262423;
          }

          .nav-bar-container {
            height: 52px !important;
            padding: 0 16px !important;
            justify-content: center !important;
          }

          .folders-nav-wrapper {
            width: 100% !important;
            justify-content: flex-start !important;
            gap: 18px !important;
            padding: 0 !important;
          }

          .cover-title-text {
            font-size: 32px !important;
          }

          .cover-subtitle-text {
            font-size: 11px !important;
            margin-bottom: 16px !important;
          }

          .lightbox-nav-arrow {
            display: none !important; /* Hide arrows on mobile lightbox, swipe/tap works */
          }

          .view-gallery-btn-cover {
            display: none !important;
          }

          .view-gallery-btn-mobile-only {
            display: inline-flex !important;
            margin-top: 20px;
            padding: 10px 24px;
            font-size: 10px;
            letter-spacing: 0.15em;
            font-weight: 600;
            text-transform: uppercase;
            align-items: center;
            gap: 6px;
          }

          .view-gallery-btn-mobile-only:hover {
            background-color: #FAF9F6 !important;
            color: #121110 !important;
          }

          .photographer-header-badge {
            top: 20px !important;
            left: 20px !important;
          }

          .photographer-header-badge img {
            width: 40px !important;
            height: 40px !important;
            border: none !important;
            box-shadow: none !important;
          }

          .photographer-header-badge span {
            font-size: 9px !important;
          }

          .gallery-main-container {
            padding: 3px !important;
          }
        }

        @media (max-width: 600px) {
          .gallery-main-container {
            padding: 2px !important;
          }
        }
      `}</style>
 
    </div>
  );
};

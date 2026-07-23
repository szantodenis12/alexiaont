import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { doc, getDoc, setDoc, collection, addDoc } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '../../firebase/config';
import { applyWatermark } from '../../utils/watermarkProcessor';
import { 
  ArrowLeft, Upload, Trash2, Plus, X, Monitor, Smartphone, 
  Type, Image as ImageIcon, Folder, RefreshCw, Check, Settings,
  Eye, Grid, Edit2
} from 'lucide-react';

interface PhotoItem {
  name: string;
  url: string;
  path: string;
}

interface SubCollection {
  id: string;
  name: string;
  photos: PhotoItem[];
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

  // Sub-collections
  const [subCollections, setSubCollections] = useState<SubCollection[]>([
    { id: 'all', name: 'General', photos: [] }
  ]);
  const [activeSubId, setActiveSubId] = useState('all');
  const [newSubName, setNewSubName] = useState('');
  const [isAddingSet, setIsAddingSet] = useState(false);

  // Bulk selection state
  const [selectedPhotoPaths, setSelectedPhotoPaths] = useState<string[]>([]);

  // Clear selection on active folder change
  useEffect(() => {
    setSelectedPhotoPaths([]);
  }, [activeSubId]);

  // Upload progress tracking
  const [uploadProgress, setUploadProgress] = useState<Record<string, { name: string; progress: number; status: string }>>({});
  const [isUploadingPhotos, setIsUploadingPhotos] = useState(false);
  
  // Watermark retroactive processing states
  const [isProcessingWatermark, setIsProcessingWatermark] = useState(false);
  const [processingProgress, setProcessingProgress] = useState({ current: 0, total: 0 });

  // Save states
  const [isSaving, setIsSaving] = useState(false);
  const [loadingError, setLoadingError] = useState('');

  // Active settings sidebar tab
  const [activeSettingsTab, setActiveSettingsTab] = useState<'photos' | 'cover' | 'watermark'>('photos');

  // Drag and drop states for subcollections
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // Folder renaming states
  const [renamingSubId, setRenamingSubId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const coverInputRef = useRef<HTMLInputElement>(null);
  const photosInputRef = useRef<HTMLInputElement>(null);

  // Load global settings (watermark) & existing gallery if edit
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settingsDoc = await getDoc(doc(db, 'settings', 'global'));
        if (settingsDoc.exists() && settingsDoc.data().defaultWatermark) {
          setGlobalWatermark(settingsDoc.data().defaultWatermark);
        }
      } catch (err) {
        console.error('Error loading watermark settings:', err);
      }
    };

    const loadGallery = async () => {
      if (!galleryId) return;
      try {
        const docSnap = await getDoc(doc(db, 'photo_galleries', galleryId));
        if (docSnap.exists()) {
          const data = docSnap.data() as GalleryData;
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
          setSubCollections(data.subCollections || [{ id: 'all', name: 'General', photos: [] }]);
          if (data.subCollections && data.subCollections.length > 0) {
            setActiveSubId(data.subCollections[0].id);
          }
        } else {
          setLoadingError('Galeria nu a fost găsită.');
        }
      } catch (err) {
        console.error('Error loading gallery:', err);
        setLoadingError('Eroare la încărcarea galeriei.');
      }
    };

    loadSettings();
    loadGallery();
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
    
    setSubCollections([...subCollections, newSub]);
    setActiveSubId(id);
    setNewSubName('');
    setIsAddingSet(false);
  };

  // Remove Sub-Collection
  const handleRemoveSubCollection = (id: string) => {
    if (subCollections.length <= 1) {
      alert('Trebuie să existe cel puțin o colecție.');
      return;
    }
    
    const sub = subCollections.find(s => s.id === id);
    if (sub && sub.photos.length > 0) {
      if (!window.confirm(`Colecția "${sub.name}" conține ${sub.photos.length} poze. Ești sigur că vrei să o ștergi cu tot cu fotografii?`)) {
        return;
      }
      
      sub.photos.forEach(async (photo) => {
        try {
          await deleteObject(ref(storage, photo.path));
        } catch (err) {
          console.warn('Could not delete photo from storage:', photo.path, err);
        }
      });
    }
    
    const updated = subCollections.filter(s => s.id !== id);
    setSubCollections(updated);
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

    setSubCollections(prev => prev.map(s => {
      if (s.id === id) {
        return {
          ...s,
          name: valClean
        };
      }
      return s;
    }));
    
    setRenamingSubId(null);
  };

  // Multiple Photos Upload with optional Client-Side Watermarking
  const handlePhotosUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const filesArray = Array.from(e.target.files);
    
    if (watermarkEnabled && !globalWatermark) {
      alert('Watermark-ul este activat, dar nu a fost încărcat niciun watermark implicit în setările globale de admin. Te rugăm să încarci mai întâi un watermark din pagina principală de admin sau să dezactivezi opțiunea.');
      return;
    }

    setIsUploadingPhotos(true);
    
    const progressMap: typeof uploadProgress = {};
    filesArray.forEach(file => {
      progressMap[file.name] = {
        name: file.name,
        progress: 0,
        status: 'Pregătire...'
      };
    });
    setUploadProgress(progressMap);

    const uploadedItems: PhotoItem[] = [];
    const tempId = galleryId || 'new_temp';

    for (const file of filesArray) {
      try {
        setUploadProgress(prev => ({
          ...prev,
          [file.name]: { ...prev[file.name], status: watermarkEnabled ? 'Aplicare watermark...' : 'Optimizare...' }
        }));

        let uploadBlob: Blob = file;

        try {
          // Always downscale and compress images for web delivery. Add watermark only if enabled.
          const wmUrl = watermarkEnabled && globalWatermark ? globalWatermark.url : null;
          uploadBlob = await applyWatermark(file, wmUrl, watermarkPosition);
        } catch (wmErr) {
          console.error('Failed to optimize and compress file:', file.name, wmErr);
          throw new Error('Eroare la optimizarea imaginii.');
        }

        const storagePath = `galleries/${tempId}/${activeSubId}/${Date.now()}_${file.name}`;
        const storageRef = ref(storage, storagePath);

        const uploadTask = uploadBytesResumable(storageRef, uploadBlob);

        await new Promise<void>((resolve, reject) => {
          uploadTask.on(
            'state_changed',
            (snapshot) => {
              const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
              setUploadProgress(prev => ({
                ...prev,
                [file.name]: { ...prev[file.name], progress, status: 'Încărcare...' }
              }));
            },
            (err) => reject(err),
            async () => {
              try {
                const url = await getDownloadURL(uploadTask.snapshot.ref);
                uploadedItems.push({
                  name: file.name,
                  url,
                  path: storagePath
                });
                setUploadProgress(prev => ({
                  ...prev,
                  [file.name]: { ...prev[file.name], progress: 100, status: 'Finalizat' }
                }));
                resolve();
              } catch (urlErr) {
                reject(urlErr);
              }
            }
          );
        });
      } catch (err: any) {
        console.error('Error uploading photo:', file.name, err);
        setUploadProgress(prev => ({
          ...prev,
          [file.name]: { ...prev[file.name], status: `Eroare: ${err.message || 'Necunoscută'}` }
        }));
      }
    }

    setSubCollections(prev => prev.map(sub => {
      if (sub.id === activeSubId) {
        return {
          ...sub,
          photos: [...sub.photos, ...uploadedItems]
        };
      }
      return sub;
    }));

    setIsUploadingPhotos(false);
    if (photosInputRef.current) photosInputRef.current.value = '';
  };

  // Delete individual photo
  const handleDeletePhoto = async (subId: string, photoPath: string) => {
    if (!window.confirm('Ești sigur că vrei să ștergi această fotografie din colecție?')) return;
    
    try {
      const storageRef = ref(storage, photoPath);
      try {
        await deleteObject(storageRef);
      } catch (storageErr) {
        console.warn('Storage deletion warning (might not exist):', storageErr);
      }
      
      setSubCollections(prev => prev.map(sub => {
        if (sub.id === subId) {
          return {
            ...sub,
            photos: sub.photos.filter(p => p.path !== photoPath)
          };
        }
        return sub;
      }));
    } catch (err) {
      console.error('Error deleting photo:', err);
      alert('Ștergerea fotografiei a eșuat.');
    }
  };

  // Toggle selection of photo
  const handleToggleSelectPhoto = (photoPath: string) => {
    setSelectedPhotoPaths(prev => 
      prev.includes(photoPath) 
        ? prev.filter(p => p !== photoPath) 
        : [...prev, photoPath]
    );
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
      // Delete files from storage
      for (const path of selectedPhotoPaths) {
        try {
          await deleteObject(ref(storage, path));
        } catch (storageErr) {
          console.warn('Storage deletion warning (might not exist):', path, storageErr);
        }
      }
      
      // Update state
      setSubCollections(prev => prev.map(sub => {
        if (sub.id === activeSubId) {
          return {
            ...sub,
            photos: sub.photos.filter(p => !selectedPhotoPaths.includes(p.path))
          };
        }
        return sub;
      }));
      
      setSelectedPhotoPaths([]);
    } catch (err) {
      console.error('Error during bulk deletion:', err);
      alert('A apărut o eroare la ștergerea fotografiilor.');
    } finally {
      setIsSaving(false);
    }
  };

  // Retroactive watermark processing
  const handleApplyWatermarkToExisting = async () => {
    if (!globalWatermark) {
      alert('Te rugăm să încarci un watermark implicit în setările de admin mai întâi.');
      return;
    }
    
    const totalPhotos = subCollections.reduce((acc, sub) => acc + sub.photos.length, 0);
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
            const res = await fetch(photo.url);
            const blob = await res.blob();
            
            const fileObj = new File([blob], photo.name, { type: 'image/jpeg' });
            const watermarkedBlob = await applyWatermark(fileObj, globalWatermark.url, watermarkPosition);
            
            const storageRef = ref(storage, photo.path);
            await uploadBytesResumable(storageRef, watermarkedBlob);
            
            const newUrl = await getDownloadURL(storageRef);
            
            updatedPhotos[j] = {
              ...photo,
              url: newUrl
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
      
      const cleanTitle = title.trim();
      const payload: Omit<GalleryData, 'id'> & { createdAt?: any } = {
        title: cleanTitle || 'Galerie Fără Titlu',
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
        watermarkEnabled: true,
        watermarkPosition,
        subCollections: updatedSubCollections
      };
      
      if (galleryId) {
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

  // Save the entire gallery to Firestore
  const handleSaveGallery = async () => {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      alert('Titlul galeriei este obligatoriu.');
      return;
    }
    
    setIsSaving(true);
    
    try {
      const payload: Omit<GalleryData, 'id'> & { createdAt?: any } = {
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
        subCollections
      };
      
      if (isEdit) {
        await setDoc(doc(db, 'photo_galleries', galleryId), payload, { merge: true });
        alert('Galeria a fost salvată cu succes!');
      } else {
        (payload as any).createdAt = new Date();
        await addDoc(collection(db, 'photo_galleries'), payload);
        alert('Galeria a fost creată cu succes!');
      }
      
      navigate('/admin/dashboard');
    } catch (err) {
      console.error('Error saving gallery:', err);
      alert('Salvarea galeriei a eșuat.');
    } finally {
      setIsSaving(false);
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
    <div className="admin-wrapper" data-theme="dark" style={{ minHeight: '100vh', backgroundColor: '#121110', color: '#F3EDE7', display: 'flex', flexDirection: 'column' }}>
      
      {/* 1. TOP STICKY BAR */}
      <header style={{ height: '64px', borderBottom: '1px solid #262423', backgroundColor: '#161514', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button onClick={() => navigate('/admin/dashboard')} style={{ background: 'none', border: 'none', color: '#FAF9F6', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px' }}>
            <ArrowLeft size={18} />
          </button>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '14px', fontWeight: 600, color: '#FAF9F6' }}>
                {title || 'Galerie Fără Titlu'}
              </span>
              <span style={{ fontSize: '10px', backgroundColor: '#2E7D32', color: '#E8F5E9', padding: '2px 8px', borderRadius: '4px', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>
                Publicată
              </span>
            </div>
            <div style={{ fontSize: '11px', color: '#706E6A', marginTop: '2px' }}>
              Creată la: {date}
            </div>
          </div>
        </div>

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
          <button onClick={() => navigate('/admin/dashboard')} className="btn btn-secondary btn-sm" style={{ height: '36px' }} disabled={isSaving}>
            Renunță
          </button>
          <button onClick={handleSaveGallery} className="btn btn-gold btn-sm" style={{ height: '36px' }} disabled={isSaving || isUploadingPhotos || isUploadingCover}>
            {isSaving ? <RefreshCw className="spinner" size={14} style={{ marginRight: '6px' }} /> : <Check size={14} style={{ marginRight: '6px' }} />}
            Salvează Modificări
          </button>
        </div>
      </header>

      {/* 2. MAIN LAYOUT CONTAINER */}
      <div style={{ display: 'flex', flex: 1, height: 'calc(100vh - 64px)', overflow: 'hidden' }}>
        
        {/* SIDEBAR TABS PANEL (Left, Width: 260px) */}
        <aside style={{ width: '280px', borderRight: '1px solid #262423', backgroundColor: '#161514', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          
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
                                {sub.photos.length}
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
                    <option value="tile">Mozaic / Tiled</option>
                  </select>
                </div>

                {watermarkEnabled && globalWatermark && subCollections.some(s => s.photos.length > 0) && (
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
              </div>
            )}

          </div>
        </aside>

        {/* 3. RIGHT MAIN CONTENT AREA (FLEX 1) */}
        <main style={{ flex: 1, backgroundColor: '#0C0B0A', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          
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
                  <button 
                    onClick={handleSelectAll} 
                    className="btn btn-secondary btn-sm"
                    style={{ height: '38px', padding: '8px 16px', fontSize: '12px' }}
                  >
                    Selectează Poze
                  </button>
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
            {!activeSub || activeSub.photos.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '300px', color: '#706E6A', gap: '12px' }}>
                <Upload size={40} style={{ opacity: 0.5 }} />
                <h3 style={{ fontSize: '15px', color: '#FAF9F6', margin: 0 }}>Acest folder este gol</h3>
                <p style={{ fontSize: '12px', color: '#706E6A', margin: 0, textAlign: 'center', maxWidth: '300px' }}>
                  Trage fișiere sau dă click pe butonul „Adaugă Poze” din colțul dreapta-sus pentru a încărca.
                </p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '16px' }}>
                {activeSub.photos.map((photo) => {
                  const isSelected = selectedPhotoPaths.includes(photo.path);
                  
                  return (
                    <div 
                      key={photo.path} 
                      onClick={() => handleToggleSelectPhoto(photo.path)}
                      style={{ 
                        position: 'relative', 
                        aspectRatio: '1', 
                        borderRadius: '6px', 
                        overflow: 'hidden', 
                        border: isSelected ? '2px solid var(--gold-accent)' : '1px solid #2D2A28', 
                        backgroundColor: '#000',
                        cursor: 'pointer'
                      }}
                      className="photo-card-item"
                    >
                      <img src={photo.url} alt={photo.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      
                      {/* Checkbox Circle */}
                      <div 
                        className="photo-select-checkbox"
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

      </div>

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
      `}</style>

    </div>
  );
};

import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, setDoc, getDoc } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { auth, db, storage } from '../../firebase/config';
import { ArrowLeft, Upload, Check, AlertCircle, Trash2, ShieldAlert, RefreshCw, X } from 'lucide-react';
import { applyWatermark } from '../../utils/watermarkProcessor';

interface FileUploadProgress {
  name: string;
  progress: number;
  status: string;
}

export const ClassCreator: React.FC = () => {
  const [schoolName, setSchoolName] = useState('');
  const [diriginteName, setDiriginteName] = useState('');
  const [extraPagesPrice, setExtraPagesPrice] = useState<number>(10);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<Record<string, FileUploadProgress>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deadline, setDeadline] = useState('');
  const [error, setError] = useState('');
  const [studentsRaw, setStudentsRaw] = useState('');
  const [galleryType, setGalleryType] = useState<'flat' | 'folder'>('flat');
  const [enableVoiceMessage, setEnableVoiceMessage] = useState(false);
  const [albumTypesEnabled, setAlbumTypesEnabled] = useState(true);
  const [priceAlbumMare, setPriceAlbumMare] = useState<number>(150);
  const [priceAlbumMic, setPriceAlbumMic] = useState<number>(100);
  const [minPhotosAlbumMare, setMinPhotosAlbumMare] = useState<number>(8);
  const [maxPhotosAlbumMare, setMaxPhotosAlbumMare] = useState<number>(20);
  const [minPhotosAlbumMic, setMinPhotosAlbumMic] = useState<number>(4);
  const [maxPhotosAlbumMic, setMaxPhotosAlbumMic] = useState<number>(10);
  const [enableObservatii, setEnableObservatii] = useState(true);
  const [enablePoster, setEnablePoster] = useState(true);
  const [enableSonete, setEnableSonete] = useState(true);
  const [enableSonetPhoto, setEnableSonetPhoto] = useState(true);
  const [enableSonetCitat, setEnableSonetCitat] = useState(true);
  const [priceSonet, setPriceSonet] = useState<number>(25);
  const [enableExtraItems, setEnableExtraItems] = useState(true);
  const [albumWatermark, setAlbumWatermark] = useState<any | null>(null);
  const [applyWatermarkToggle, setApplyWatermarkToggle] = useState(false);
  const [watermarkPosition, setWatermarkPosition] = useState<'bottom-right' | 'bottom-left' | 'bottom-center' | 'top-right' | 'top-left' | 'center' | 'tile'>('bottom-right');
  const [watermarkOffsetX, setWatermarkOffsetX] = useState<number>(0);
  const [watermarkOffsetY, setWatermarkOffsetY] = useState<number>(0);
  const [isPreviewWatermarkLarge, setIsPreviewWatermarkLarge] = useState(false);

  const navigate = useNavigate();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) {
        navigate('/admin/login');
      }
    });

    const fetchAlbumWatermark = async () => {
      try {
        const snap = await getDoc(doc(db, 'settings', 'global'));
        if (snap.exists()) {
          const data = snap.data();
          const wm = data.albumWatermark || data.defaultWatermark;
          if (wm) {
            setAlbumWatermark(wm);
            setWatermarkPosition(wm.position || 'bottom-right');
            setWatermarkOffsetX(wm.offsetX || 0);
            setWatermarkOffsetY(wm.offsetY || 0);
          }
        }
      } catch (e) {
        console.warn("Could not fetch global album watermark:", e);
      }
    };
    
    fetchAlbumWatermark();

    return () => unsubscribe();
  }, [navigate]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isPreviewWatermarkLarge && e.key === 'Escape') {
        setIsPreviewWatermarkLarge(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPreviewWatermarkLarge]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const filesArray = Array.from(e.target.files);
      setSelectedFiles(prev => [...prev, ...filesArray]);
    }
  };

  const handleDropzoneDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const items = e.dataTransfer.items;
    if (!items) {
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const droppedFiles = Array.from(e.dataTransfer.files);
        setSelectedFiles(prev => [...prev, ...droppedFiles]);
      }
      return;
    }

    const filesArray: File[] = [];

    const traverseFileTree = (item: any, path = ''): Promise<void> => {
      return new Promise((resolve) => {
        if (item.isFile) {
          item.file((file: File) => {
            const relPath = path ? `${path}/${file.name}` : file.name;
            Object.defineProperty(file, 'webkitRelativePath', {
              value: relPath,
              writable: true,
              configurable: true
            });
            filesArray.push(file);
            resolve();
          }, () => resolve());
        } else if (item.isDirectory) {
          const dirReader = item.createReader();
          const readEntries = () => {
            dirReader.readEntries((entries: any[]) => {
              if (entries.length === 0) {
                resolve();
              } else {
                const promises = entries.map(entry => 
                  traverseFileTree(entry, path ? `${path}/${item.name}` : item.name)
                );
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
      setSelectedFiles(prev => [...prev, ...filesArray]);
    }
  };

  const removeFile = (indexToRemove: number) => {
    setSelectedFiles(prev => prev.filter((_, index) => index !== indexToRemove));
  };

  const clearFiles = () => {
    setSelectedFiles([]);
  };
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
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validations
    if (!schoolName.trim()) {
      setError('Te rugăm să introduci numele școlii.');
      return;
    }
    if (!diriginteName.trim()) {
      setError('Te rugăm să introduci numele dirigintelui.');
      return;
    }


    const studentList = studentsRaw
      .split('\n')
      .map(name => name.trim())
      .filter(name => name.length > 0);

    if (studentList.length === 0) {
      setError('Te rugăm să introduci cel puțin un elev în listă.');
      return;
    }

    setIsSubmitting(true);

    // Initializing progress records
    const progressMap: Record<string, FileUploadProgress> = {};
    selectedFiles.forEach(file => {
      progressMap[file.name] = {
        name: file.name,
        progress: 0,
        status: 'pending'
      };
    });
    setUploadProgress(progressMap);

    try {
      // 1. Generate Firestore Doc ID for the new class
      const classesCollection = collection(db, 'classes');
      const newClassRef = doc(classesCollection);
      const classId = newClassRef.id;

      const galleryPhotos: { name: string; url: string; path: string; cleanUrl?: string; cleanPath?: string; folder?: string }[] = [];

      // 2. Upload each file to Cloud Storage in parallel
      const uploadPromises = selectedFiles.map(async (file) => {
        const timestamp = Date.now();
        const randomStr = Math.random().toString(36).substring(2, 6);
        const baseFileName = `${timestamp}_${randomStr}_${file.name}`;

        setUploadProgress(prev => ({
          ...prev,
          [file.name]: { ...prev[file.name], status: applyWatermarkToggle ? 'Aplicare watermark...' : 'Optimizare...' }
        }));

        let uploadBlob: Blob = file;
        let cleanBlob: Blob = file;
        let storagePath = '';
        let cleanStoragePath = '';

        try {
          // Always create clean version
          cleanBlob = await applyWatermark(file, null, watermarkPosition, watermarkOffsetX, watermarkOffsetY);

          if (applyWatermarkToggle && albumWatermark) {
            uploadBlob = await applyWatermark(file, albumWatermark.url, watermarkPosition, watermarkOffsetX, watermarkOffsetY);
            storagePath = `classes/${classId}/gallery/wm_${baseFileName}`;
            cleanStoragePath = `classes/${classId}/gallery/clean_${baseFileName}`;
          } else {
            uploadBlob = cleanBlob;
            storagePath = `classes/${classId}/gallery/clean_${baseFileName}`;
            cleanStoragePath = storagePath;
          }
        } catch (wmErr) {
          console.error('Failed to optimize and watermark file:', file.name, wmErr);
          storagePath = `classes/${classId}/gallery/clean_${baseFileName}`;
          cleanStoragePath = storagePath;
        }

        const storageRef = ref(storage, storagePath);

        // Upload clean version in parallel if different
        let cleanUploadPromise: Promise<string> = Promise.resolve('');
        if (cleanStoragePath !== storagePath) {
          const cleanStorRef = ref(storage, cleanStoragePath);
          cleanUploadPromise = uploadBytesResumable(cleanStorRef, cleanBlob).then(snap => getDownloadURL(snap.ref)) as Promise<string>;
        }

        const uploadTask = uploadBytesResumable(storageRef, uploadBlob);

        return new Promise<any>((resolve, reject) => {
          uploadTask.on(
            'state_changed',
            (snapshot) => {
              const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
              setUploadProgress(prev => ({
                ...prev,
                [file.name]: { ...prev[file.name], progress }
              }));
            },
            (error) => {
              console.error('Upload error for file:', file.name, error);
              setUploadProgress(prev => ({
                ...prev,
                [file.name]: { ...prev[file.name], status: 'error' }
              }));
              reject(error);
            },
            async () => {
              try {
                const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
                const cleanUrl = cleanStoragePath !== storagePath ? await cleanUploadPromise : downloadUrl;
                const relativePath = (file as any).webkitRelativePath || '';
                const pathParts = relativePath.split('/');
                const folderName = pathParts.length > 1 ? pathParts[pathParts.length - 2] : '';

                setUploadProgress(prev => ({
                  ...prev,
                  [file.name]: { ...prev[file.name], progress: 100, status: 'completed' }
                }));

                resolve({
                  name: file.name,
                  url: downloadUrl,
                  path: storagePath,
                  cleanUrl,
                  cleanPath: cleanStoragePath,
                  ...(folderName ? { folder: folderName } : {})
                });
              } catch (urlErr) {
                reject(urlErr);
              }
            }
          );
        });
      });

      if (selectedFiles.length > 0) {
        const uploadedPhotos = await Promise.all(uploadPromises);
        galleryPhotos.push(...uploadedPhotos.filter(p => p !== null));

        const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
        galleryPhotos.sort((a, b) => collator.compare(a.name, b.name));
      }

      // 3. Save class configuration to Firestore
      await setDoc(newClassRef, {
        schoolName: schoolName.trim(),
        diriginteName: diriginteName.trim(),
        studentList,
        status: 'active',
        requireEmailDownload: false,
        extraPagesPrice,
        enableVoiceMessage,
        albumTypesEnabled,
        priceAlbumMare,
        priceAlbumMic,
        minPhotosAlbumMare,
        maxPhotosAlbumMare,
        minPhotosAlbumMic,
        maxPhotosAlbumMic,
        enableObservatii,
        enablePoster,
        enableSonete,
        enableSonetPhoto,
        enableSonetCitat,
        priceSonet,
        enableExtraItems,
        galleryPhotos,
        galleryType,
        watermarkEnabled: applyWatermarkToggle,
        watermarkPosition,
        watermarkOffsetX,
        watermarkOffsetY,
        deadline: deadline ? new Date(deadline) : null,
        createdAt: new Date()
      });

      // Redirect back to admin dashboard
      navigate('/admin/dashboard');

    } catch (err: any) {
      console.error('Error creating class:', err);
      setError(`Eroare la crearea clasei: ${err.message || err.toString()}. Asigură-te că serviciile Firestore și Storage sunt active.`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="admin-wrapper" data-theme="dark">
      {/* Header */}
      <header className="admin-header">
        <div className="header-logo" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <img src="/LOGO ALBUME.svg" alt="Alexia Graduation Albums Logo" style={{ height: '36px', width: 'auto' }} />
          <span className="admin-badge" style={{ margin: 0 }}>Admin</span>
        </div>
        <Link to="/admin/dashboard" className="back-link">
          <ArrowLeft size={16} /> Înapoi la Dashboard
        </Link>
      </header>

      {/* Form Content */}
      <main className="admin-main">
        <div className="form-card">
          <div className="form-card-header">
            <h2>Creează Clasă Nouă</h2>
            <p className="subtitle">Configurează datele albumului și încarcă galeria foto a clasei</p>
          </div>

          {error && (
            <div className="form-error">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              {/* Left Side: Text Inputs */}
              <div className="form-column">
                <div className="form-group">
                  <label className="form-label">Nume Școală / Liceu</label>
                  <input
                    type="text"
                    placeholder="Ex: Colegiul Național 'Mihai Eminescu'"
                    value={schoolName}
                    onChange={(e) => setSchoolName(e.target.value)}
                    disabled={isSubmitting}
                    className="form-input"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Diriginte (Nume Complet)</label>
                  <input
                    type="text"
                    placeholder="Ex: Prof. Ion Popescu"
                    value={diriginteName}
                    onChange={(e) => setDiriginteName(e.target.value)}
                    disabled={isSubmitting}
                    className="form-input"
                  />
                </div>

                <div className="form-group" style={{ marginBottom: '16px' }}>
                  <label htmlFor="extraPagesPrice" className="form-label">Preț pagină suplimentară (RON)</label>
                  <input
                    type="number"
                    id="extraPagesPrice"
                    value={extraPagesPrice}
                    onChange={(e) => setExtraPagesPrice(Math.max(0, parseInt(e.target.value) || 0))}
                    placeholder="10"
                    min="0"
                    disabled={isSubmitting}
                    className="form-input"
                  />
                </div>

                {/* Opțiuni Tipuri de Album (Mare vs Mic) */}
                <div style={{ backgroundColor: '#161514', border: '1px solid #2D2A28', borderRadius: '8px', padding: '16px', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                    <input
                      type="checkbox"
                      id="album-types-enabled-toggle"
                      checked={albumTypesEnabled}
                      onChange={(e) => setAlbumTypesEnabled(e.target.checked)}
                      style={{ cursor: 'pointer', width: '18px', height: '18px', accentColor: 'var(--gold-accent)' }}
                    />
                    <label htmlFor="album-types-enabled-toggle" style={{ margin: 0, fontSize: '14px', color: '#FAF9F6', cursor: 'pointer', fontWeight: 600 }}>
                      Permite alegerea între Album Mare și Album Mic
                    </label>
                  </div>

                  {albumTypesEnabled && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '8px', paddingTop: '12px', borderTop: '1px solid #262423' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div>
                          <label className="form-label" style={{ fontSize: '11px' }}>Preț Album Mare (RON)</label>
                          <input
                            type="number"
                            value={priceAlbumMare}
                            onChange={(e) => setPriceAlbumMare(Math.max(0, parseInt(e.target.value) || 0))}
                            className="form-input"
                            min="0"
                          />
                        </div>
                        <div>
                          <label className="form-label" style={{ fontSize: '11px' }}>Preț Album Mic (RON)</label>
                          <input
                            type="number"
                            value={priceAlbumMic}
                            onChange={(e) => setPriceAlbumMic(Math.max(0, parseInt(e.target.value) || 0))}
                            className="form-input"
                            min="0"
                          />
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '8px' }}>
                        <div>
                          <label className="form-label" style={{ fontSize: '10px' }}>Min Mare</label>
                          <input
                            type="number"
                            value={minPhotosAlbumMare}
                            onChange={(e) => setMinPhotosAlbumMare(Math.max(1, parseInt(e.target.value) || 1))}
                            className="form-input"
                            min="1"
                          />
                        </div>
                        <div>
                          <label className="form-label" style={{ fontSize: '10px' }}>Max Mare</label>
                          <input
                            type="number"
                            value={maxPhotosAlbumMare}
                            onChange={(e) => setMaxPhotosAlbumMare(Math.max(minPhotosAlbumMare, parseInt(e.target.value) || minPhotosAlbumMare))}
                            className="form-input"
                            min={minPhotosAlbumMare}
                          />
                        </div>
                        <div>
                          <label className="form-label" style={{ fontSize: '10px' }}>Min Mic</label>
                          <input
                            type="number"
                            value={minPhotosAlbumMic}
                            onChange={(e) => setMinPhotosAlbumMic(Math.max(1, parseInt(e.target.value) || 1))}
                            className="form-input"
                            min="1"
                          />
                        </div>
                        <div>
                          <label className="form-label" style={{ fontSize: '10px' }}>Max Mic</label>
                          <input
                            type="number"
                            value={maxPhotosAlbumMic}
                            onChange={(e) => setMaxPhotosAlbumMic(Math.max(minPhotosAlbumMic, parseInt(e.target.value) || minPhotosAlbumMic))}
                            className="form-input"
                            min={minPhotosAlbumMic}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Opțiuni Suplimentare Elevi (Toggles ON/OFF) */}
                <div style={{ backgroundColor: '#161514', border: '1px solid #2D2A28', borderRadius: '8px', padding: '16px', marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <h4 style={{ margin: 0, fontSize: '13px', color: 'var(--gold-accent)', fontWeight: 600 }}>Câmpuri & Opțiuni Elevi (Activare/Dezactivare)</h4>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#FAF9F6', cursor: 'pointer' }}>
                      <input type="checkbox" checked={enableObservatii} onChange={(e) => setEnableObservatii(e.target.checked)} style={{ accentColor: 'var(--gold-accent)' }} />
                      Observații pentru Designer
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#FAF9F6', cursor: 'pointer' }}>
                      <input type="checkbox" checked={enablePoster} onChange={(e) => setEnablePoster(e.target.checked)} style={{ accentColor: 'var(--gold-accent)' }} />
                      Poză pentru Poster
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#FAF9F6', cursor: 'pointer' }}>
                      <input type="checkbox" checked={enableExtraItems} onChange={(e) => setEnableExtraItems(e.target.checked)} style={{ accentColor: 'var(--gold-accent)' }} />
                      Cumpărături / Produse Extra (Canvas etc.)
                    </label>
                  </div>
                </div>

                {/* Opțiuni Sonete Școlare */}
                <div style={{ backgroundColor: '#161514', border: '1px solid #2D2A28', borderRadius: '8px', padding: '16px', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: enableSonete ? '12px' : '0' }}>
                    <input
                      type="checkbox"
                      id="enable-sonete-toggle"
                      checked={enableSonete}
                      onChange={(e) => setEnableSonete(e.target.checked)}
                      style={{ cursor: 'pointer', width: '18px', height: '18px', accentColor: 'var(--gold-accent)' }}
                    />
                    <label htmlFor="enable-sonete-toggle" style={{ margin: 0, fontSize: '14px', color: '#FAF9F6', cursor: 'pointer', fontWeight: 600 }}>
                      Opțiune Sonete Școlare pentru Elevi
                    </label>
                  </div>

                  {enableSonete && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingTop: '12px', borderTop: '1px solid #262423' }}>
                      <div>
                        <label className="form-label" style={{ fontSize: '11px' }}>Preț Sonete (RON)</label>
                        <input
                          type="number"
                          value={priceSonet}
                          onChange={(e) => setPriceSonet(Math.max(0, parseInt(e.target.value) || 0))}
                          className="form-input"
                          min="0"
                        />
                      </div>
                      <div style={{ display: 'flex', gap: '16px', marginTop: '4px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#A3A09B', cursor: 'pointer' }}>
                          <input type="checkbox" checked={enableSonetPhoto} onChange={(e) => setEnableSonetPhoto(e.target.checked)} style={{ accentColor: 'var(--gold-accent)' }} />
                          Poză pt Sonet
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#A3A09B', cursor: 'pointer' }}>
                          <input type="checkbox" checked={enableSonetCitat} onChange={(e) => setEnableSonetCitat(e.target.checked)} style={{ accentColor: 'var(--gold-accent)' }} />
                          Citat pt Sonet
                        </label>
                      </div>
                    </div>
                  )}
                </div>

                <div className="form-group" style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px', backgroundColor: '#1C1A19', padding: '12px 16px', borderRadius: '6px', border: '1px solid #2D2A28' }}>
                  <input
                    type="checkbox"
                    id="enable-voice-message-toggle"
                    checked={enableVoiceMessage}
                    onChange={(e) => setEnableVoiceMessage(e.target.checked)}
                    style={{ cursor: 'pointer', width: '18px', height: '18px', accentColor: 'var(--gold-accent)' }}
                  />
                  <div>
                    <label htmlFor="enable-voice-message-toggle" style={{ margin: 0, fontSize: '14px', color: '#FAF9F6', cursor: 'pointer', fontWeight: 600 }}>
                      Permite Mesaj Vocal de la elevi (max. 1 minut)
                    </label>
                    <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#706E6A' }}>
                      Elevii vor putea înregistra un mesaj vocal pe site, iar la trimitere se va genera un cod QR scanabil pentru album.
                    </p>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Termen Limită Trimitere (Opțional)</label>
                  <input
                    type="date"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                    disabled={isSubmitting}
                    className="form-input"
                    style={{ colorScheme: 'dark' }}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Listă Elevi (câte unul pe rând)</label>
                  <textarea
                    placeholder="Ex:&#10;Popescu Andrei&#10;Ionescu Maria&#10;Dumitrescu Elena"
                    value={studentsRaw}
                    onChange={(e) => setStudentsRaw(e.target.value)}
                    disabled={isSubmitting}
                    className="form-input"
                    style={{ minHeight: '120px', resize: 'vertical', fontFamily: 'inherit', padding: '12px', backgroundColor: '#22201F', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '6px', outline: 'none' }}
                  />
                  <p className="guideline-text" style={{ fontSize: '11px', marginTop: '4px', color: '#A3A09B' }}>
                    Adăugați numele fiecărui elev din clasă, câte unul pe fiecare rând.
                  </p>
                </div>

              </div>

              {/* Right Side: Photo Uploads */}
              <div className="form-column">
                <div className="form-group">
                  <label className="form-label">Mod Organizare Galerie</label>
                  <div style={{ display: 'flex', gap: '12px', marginTop: '8px', marginBottom: '8px' }}>
                    <button
                      type="button"
                      className={`nav-link ${galleryType === 'flat' ? 'active' : ''}`}
                      style={{ padding: '8px 16px', borderRadius: '4px', fontSize: '13px', border: '1px solid #2D2A28', cursor: 'pointer', flex: 1, backgroundColor: galleryType === 'flat' ? 'var(--gold-accent)' : 'transparent', color: galleryType === 'flat' ? '#D8D0C8' : '#FAF9F6' }}
                      onClick={() => { setGalleryType('flat'); clearFiles(); }}
                      disabled={isSubmitting}
                    >
                      Galerie Simplă
                    </button>
                    <button
                      type="button"
                      className={`nav-link ${galleryType === 'folder' ? 'active' : ''}`}
                      style={{ padding: '8px 16px', borderRadius: '4px', fontSize: '13px', border: '1px solid #2D2A28', cursor: 'pointer', flex: 1, backgroundColor: galleryType === 'folder' ? 'var(--gold-accent)' : 'transparent', color: galleryType === 'folder' ? '#D8D0C8' : '#FAF9F6' }}
                      onClick={() => { setGalleryType('folder'); clearFiles(); }}
                      disabled={isSubmitting}
                    >
                      Structură pe Foldere
                    </button>
                  </div>
                  <p style={{ fontSize: '11px', color: '#A3A09B', marginTop: '4px' }}>
                    {galleryType === 'flat' 
                      ? "Alegeți această opțiune pentru a încărca poze individuale (se vor afișa într-o grilă simplă)."
                      : "Alegeți această opțiune pentru a selecta un folder întreg cu subfoldere (se vor afișa pe categorii/foldere în site)."}
                  </p>
                </div>

                {albumWatermark && (
                  <>
                    <div className="form-group" style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#1C1A19', padding: '12px', borderRadius: '4px', border: '1px solid #2D2A28' }}>
                      <input 
                        type="checkbox" 
                        id="apply-watermark-toggle"
                        checked={applyWatermarkToggle} 
                        onChange={(e) => setApplyWatermarkToggle(e.target.checked)} 
                        style={{ cursor: 'pointer', width: '16px', height: '16px', accentColor: 'var(--gold-accent)' }}
                      />
                      <label htmlFor="apply-watermark-toggle" style={{ margin: 0, fontSize: '13px', color: '#FAF9F6', cursor: 'pointer', fontWeight: 500 }}>
                        Aplică Watermark Album pe pozele încărcate
                      </label>
                    </div>

                    {applyWatermarkToggle && (
                      <div style={{ backgroundColor: '#161514', padding: '16px', borderRadius: '6px', border: '1px solid #262423', marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#706E6A', fontWeight: 600 }}>
                          Personalizare Poziționare Watermark Album
                        </span>

                        <div>
                          <label style={{ fontSize: '11px', color: '#A3A09B', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Poziție Watermark</label>
                          <select 
                            value={watermarkPosition}
                            onChange={(e) => setWatermarkPosition(e.target.value as any)}
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

                        {/* Visual Live Preview Container */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label style={{ fontSize: '11px', color: '#A3A09B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Prevualizare Poziționare</label>
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
                                src={albumWatermark.url} 
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
                                    <img src={albumWatermark.url} style={{ maxWidth: '40%', maxHeight: '40%', objectFit: 'contain' }} />
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* D-Pad Controls */}
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
                  </>
                )}

                <div className="form-group">
                  <label className="form-label">
                    {galleryType === 'flat' ? 'Încărcare Galerie Foto (Class Gallery)' : 'Încărcare Directoare/Foldere Poze'}
                  </label>
                  
                  {!isSubmitting && (
                    <div 
                      className="upload-dropzone" 
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }} 
                      onDrop={handleDropzoneDrop}
                    >
                      {galleryType === 'flat' ? (
                        <>
                          <input
                            type="file"
                            multiple
                            accept="image/*"
                            onChange={handleFileChange}
                            id="gallery-photos-input"
                            className="file-hidden-input"
                          />
                          <label htmlFor="gallery-photos-input" className="dropzone-label">
                            <Upload size={32} className="upload-icon" />
                            <span className="upload-main-text">Apasă pentru a alege poze</span>
                            <span className="upload-sub-text">Sunt acceptate imagini JPG, PNG</span>
                          </label>
                        </>
                      ) : (
                        <>
                          <input
                            type="file"
                            multiple
                            {...({ webkitdirectory: '', directory: '' } as any)}
                            onChange={handleFileChange}
                            id="gallery-photos-input"
                            className="file-hidden-input"
                          />
                          <input
                            type="file"
                            multiple
                            accept="image/*"
                            onChange={handleFileChange}
                            id="gallery-individual-photos-input"
                            className="file-hidden-input"
                          />
                          <div className="dropzone-label" style={{ pointerEvents: 'none' }}>
                            <Upload size={32} className="upload-icon" />
                            <span className="upload-main-text" style={{ marginBottom: '8px' }}>Încarcă Folder sau Fișiere</span>
                            <span className="upload-sub-text" style={{ marginBottom: '16px' }}>Trage folderele aici sau folosește butoanele de mai jos:</span>
                            <div style={{ display: 'flex', gap: '12px', pointerEvents: 'auto' }}>
                              <label htmlFor="gallery-photos-input" style={{ padding: '8px 16px', backgroundColor: '#5f0b02', color: '#FAF9F6', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 600, display: 'inline-block' }}>
                                📁 Alege Folder
                              </label>
                              <label htmlFor="gallery-individual-photos-input" style={{ padding: '8px 16px', backgroundColor: '#1C1A19', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 600, display: 'inline-block' }}>
                                🖼 Alege Poze
                              </label>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* Selected files count and actions */}
                  {selectedFiles.length > 0 && !isSubmitting && (
                    <div className="files-status-bar">
                      <span>{selectedFiles.length} imagini selectate</span>
                      <button type="button" onClick={clearFiles} className="text-danger-btn">
                        <Trash2 size={14} /> Șterge tot
                      </button>
                    </div>
                  )}

                  {/* Upload List / Progress display */}
                  {isSubmitting ? (
                    <div className="progress-list">
                      <div className="upload-banner">
                        <RefreshCw className="spinner inline-icon" size={16} />
                        <span>Se încarcă pozele. Te rugăm să nu închizi această pagină.</span>
                      </div>
                      <div className="progress-scroll-area">
                        {Object.values(uploadProgress).map((fileProg) => (
                          <div key={fileProg.name} className="progress-item">
                            <div className="progress-info">
                              <span className="file-name-truncated" title={fileProg.name}>{fileProg.name}</span>
                              <span className="progress-percent">
                                {fileProg.status === 'completed' && <Check size={14} className="text-success" />}
                                {fileProg.status === 'error' && <ShieldAlert size={14} className="text-danger" />}
                                {fileProg.status === 'uploading' && `${fileProg.progress}%`}
                                {fileProg.status === 'pending' && 'În coadă'}
                              </span>
                            </div>
                            <div className="progress-bar-bg">
                              <div 
                                className={`progress-bar-fill ${fileProg.status}`}
                                style={{ width: `${fileProg.progress}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    /* Preview chosen files list (pre-upload) */
                    selectedFiles.length > 0 && (
                      <div className="selected-files-list">
                        {selectedFiles.map((file, idx) => (
                          <div key={`${file.name}-${idx}`} className="selected-file-item">
                            <span className="file-name-truncated" title={file.name}>{file.name}</span>
                            <button 
                              type="button" 
                              onClick={() => removeFile(idx)} 
                              className="remove-file-btn"
                              title="Elimină fișier"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )
                  )}
                </div>
              </div>
            </div>

            <div className="form-footer-actions">
              <Link to="/admin/dashboard" className="btn btn-secondary" style={{ pointerEvents: isSubmitting ? 'none' : 'auto', opacity: isSubmitting ? 0.5 : 1 }}>
                Anulează
              </Link>
              <button type="submit" disabled={isSubmitting} className="btn btn-gold">
                {isSubmitting ? 'Se salvează clasa...' : 'Creează Clasă'}
              </button>
            </div>
          </form>
        </div>
      </main>

      {/* Fullscreen Watermark Placement Preview Modal */}
      {isPreviewWatermarkLarge && albumWatermark && (
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
                src={albumWatermark.url} 
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
                    <img src={albumWatermark.url} style={{ maxWidth: '40%', maxHeight: '40%', objectFit: 'contain' }} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        .admin-wrapper {
          min-height: 100vh;
          background-color: #0E0D0C;
          color: #F5F4F0;
          font-family: 'Outfit', sans-serif;
          display: flex;
          flex-direction: column;
        }

        .admin-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 40px;
          background-color: #161514;
          border-bottom: 1px solid #262423;
          height: 70px;
        }

        .header-logo {
          display: flex;
          align-items: center;
          gap: 10px;
          font-family: var(--font-sans);
          font-size: 20px;
          font-weight: 600;
          letter-spacing: 0.05em;
        }

        .logo-accent {
          color: var(--gold-accent);
        }

        .admin-badge {
          font-family: 'Outfit', sans-serif;
          font-size: 10px;
          background-color: #2D2A28;
          color: #D8D0C8;
          padding: 2px 6px;
          border-radius: 4px;
          vertical-align: middle;
          margin-left: 6px;
          font-weight: 600;
          text-transform: uppercase;
        }

        .back-link {
          font-size: 13px;
          color: #A3A09B;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: color 0.2s;
        }

        .back-link:hover {
          color: var(--gold-accent);
        }

        .admin-main {
          flex: 1;
          padding: 40px;
          max-width: 1200px;
          width: 100%;
          margin: 0 auto;
        }

        .form-card {
          background-color: #161514;
          border: 1px solid #262423;
          border-radius: 8px;
          padding: 40px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.15);
        }

        .form-card-header {
          margin-bottom: 32px;
          border-bottom: 1px solid #262423;
          padding-bottom: 20px;
        }

        .form-card-header h2 {
          font-size: 24px;
          font-weight: 400;
          margin-bottom: 4px;
          color: #FAF9F6;
        }

        .subtitle {
          font-size: 13px;
          color: #A3A09B;
        }

        .form-error {
          display: flex;
          align-items: center;
          gap: 10px;
          background-color: rgba(224, 108, 117, 0.15);
          border: 1px solid rgba(224, 108, 117, 0.3);
          color: #E06C75;
          padding: 14px;
          border-radius: 6px;
          font-size: 14px;
          margin-bottom: 24px;
        }

        .form-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 40px;
        }

        @media (max-width: 768px) {
          .form-grid {
            grid-template-columns: 1fr;
            gap: 24px;
          }
        }

        .form-column {
          display: flex;
          flex-direction: column;
        }

        .label-with-desc {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }

        .label-with-desc .form-label {
          margin-bottom: 0;
        }

        .label-desc {
          font-size: 11px;
          color: #706E6A;
        }

        /* Upload styling */
        .upload-dropzone {
          border: 2px dashed #2D2A28;
          background-color: #0E0D0C;
          border-radius: 6px;
          padding: 40px 20px;
          text-align: center;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .upload-dropzone:hover {
          border-color: var(--gold-accent);
          background-color: #121110;
        }

        .file-hidden-input {
          display: none;
        }

        .dropzone-label {
          display: flex;
          flex-direction: column;
          align-items: center;
          cursor: pointer;
        }

        .upload-icon {
          color: #706E6A;
          margin-bottom: 12px;
        }

        .upload-main-text {
          font-size: 14px;
          font-weight: 500;
          color: #FAF9F6;
          margin-bottom: 4px;
        }

        .upload-sub-text {
          font-size: 12px;
          color: #706E6A;
        }

        .files-status-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 12px;
          font-size: 13px;
          color: #A3A09B;
        }

        .text-danger-btn {
          background: none;
          border: none;
          color: #E06C75;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
        }

        .text-danger-btn:hover {
          text-decoration: underline;
        }

        /* Selected Files List styling */
        .selected-files-list {
          margin-top: 16px;
          border: 1px solid #262423;
          border-radius: 6px;
          background-color: #0E0D0C;
          max-height: 250px;
          overflow-y: auto;
          padding: 8px;
        }

        .selected-file-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 12px;
          border-bottom: 1px solid #22201F;
          font-size: 13px;
        }

        .selected-file-item:last-child {
          border-bottom: none;
        }

        .file-name-truncated {
          max-width: 85%;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .remove-file-btn {
          background: none;
          border: none;
          color: #706E6A;
          cursor: pointer;
          transition: color 0.2s;
        }

        .remove-file-btn:hover {
          color: #E06C75;
        }

        /* Progress list styling */
        .progress-list {
          margin-top: 16px;
          background-color: #0E0D0C;
          border: 1px solid #262423;
          border-radius: 6px;
          padding: 16px;
        }

        .upload-banner {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          color: var(--gold-accent);
          margin-bottom: 16px;
          font-weight: 500;
        }

        .progress-scroll-area {
          max-height: 200px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .progress-item {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .progress-info {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          color: #A3A09B;
        }

        .progress-percent {
          font-weight: 600;
        }

        .progress-bar-bg {
          height: 6px;
          background-color: #262423;
          border-radius: 3px;
          overflow: hidden;
        }

        .progress-bar-fill {
          height: 100%;
          border-radius: 3px;
          transition: width 0.1s ease;
          background-color: var(--gold-accent);
        }

        .progress-bar-fill.completed {
          background-color: #98C379;
        }

        .progress-bar-fill.error {
          background-color: #E06C75;
        }

        .text-success {
          color: #98C379;
        }

        .text-danger {
          color: #E06C75;
        }

        .form-footer-actions {
          margin-top: 40px;
          display: flex;
          justify-content: flex-end;
          gap: 16px;
          border-top: 1px solid #262423;
          padding-top: 24px;
        }

        /* Generic details */
        .spinner {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        .lightbox-ctrl-btn:hover {
          background-color: var(--gold-accent) !important;
          border-color: var(--gold-accent) !important;
          color: #FAF9F6 !important;
          transform: scale(1.05);
        }
      `}</style>
    </div>
  );
};

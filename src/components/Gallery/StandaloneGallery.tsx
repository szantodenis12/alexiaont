import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { doc, getDoc, collection, addDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import JSZip from 'jszip';
import { 
  Download, Check, X, Mail, RefreshCw, 
  AlertCircle, Eye, ChevronLeft, ChevronRight 
} from 'lucide-react';

interface Photo {
  name: string;
  url: string;
  path: string;
  folder?: string;
}

interface ClassData {
  id: string;
  schoolName: string;
  diriginteName: string;
  status: 'active' | 'locked';
  requireEmailDownload: boolean;
  galleryPhotos: Photo[];
  galleryType?: 'flat' | 'folder';
}

export const StandaloneGallery: React.FC = () => {
  const { classId } = useParams<{ classId: string }>();
  const [classData, setClassData] = useState<ClassData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Gallery view states
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedUrls, setSelectedUrls] = useState<string[]>([]);
  
  // Email Gate states
  const [showEmailGate, setShowEmailGate] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [emailError, setEmailError] = useState('');
  const [savedEmail, setSavedEmail] = useState<string>(localStorage.getItem('viewer_email') || '');
  const [pendingDownloadAction, setPendingDownloadAction] = useState<{
    type: 'single' | 'multi';
    urls: string[];
  } | null>(null);

  // ZIP compiling states
  const [zipLoading, setZipLoading] = useState(false);
  const [zipProgress, setZipProgress] = useState(0);

  // Folder navigation states
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);

  const hasFolders = React.useMemo(() => {
    if (!classData) return false;
    return classData.galleryPhotos.some(p => p.folder);
  }, [classData]);

  const folderGroups = React.useMemo(() => {
    if (!classData) return {};
    const groups: Record<string, Photo[]> = {};
    classData.galleryPhotos.forEach(photo => {
      const f = photo.folder || 'Fără folder';
      if (!groups[f]) groups[f] = [];
      groups[f].push(photo);
    });
    return groups;
  }, [classData]);

  // Scroll position preservation
  const scrollPositionRef = useRef<number>(0);

  useEffect(() => {
    const fetchClassData = async () => {
      if (!classId) {
        setError('ID-ul clasei lipsește.');
        setLoading(false);
        return;
      }

      try {
        const classDoc = await getDoc(doc(db, 'classes', classId));
        if (classDoc.exists()) {
          setClassData({ id: classDoc.id, ...classDoc.data() } as ClassData);
        } else {
          setError('Galeria foto nu a fost găsită. Contactează fotograful.');
        }
      } catch (err) {
        console.error('Error fetching gallery class:', err);
        setError('Eroare la încărcarea galeriei foto.');
      } finally {
        setLoading(false);
      }
    };

    fetchClassData();
  }, [classId]);

  // Lock scroll when preview is open
  useEffect(() => {
    if (previewIndex !== null) {
      scrollPositionRef.current = window.scrollY;
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollPositionRef.current}px`;
      document.body.style.width = '100%';
    } else {
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      window.scrollTo(0, scrollPositionRef.current);
    }
    return () => {
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
    };
  }, [previewIndex]);

  const handlePhotoClick = (index: number) => {
    if (isMultiSelectMode) {
      const url = classData!.galleryPhotos[index].url;
      toggleSelectUrl(url);
    } else {
      setPreviewIndex(index);
    }
  };

  const toggleSelectUrl = (url: string) => {
    setSelectedUrls(prev => 
      prev.includes(url) 
        ? prev.filter(item => item !== url) 
        : [...prev, url]
    );
  };

  const selectAll = () => {
    if (!classData) return;
    setSelectedUrls(classData.galleryPhotos.map(p => p.url));
  };

  const deselectAll = () => {
    setSelectedUrls([]);
  };

  const getPhotoNameFromUrl = (url: string): string => {
    if (!classData) return 'photo.jpg';
    const found = classData.galleryPhotos.find(p => p.url === url);
    return found ? found.name : 'photo.jpg';
  };

  // Log downloads in Firestore
  const logDownload = async (email: string, urls: string[]) => {
    if (!classId) return;
    try {
      const filenames = urls.map(url => getPhotoNameFromUrl(url));
      await addDoc(collection(db, 'downloads'), {
        classId,
        email,
        filesList: filenames,
        downloadedAt: new Date()
      });
    } catch (err) {
      console.error('Error logging download:', err);
    }
  };

  const handleSingleDownload = async (url: string) => {
    if (classData?.requireEmailDownload && !savedEmail) {
      setPendingDownloadAction({ type: 'single', urls: [url] });
      setShowEmailGate(true);
      return;
    }

    const email = savedEmail || 'anonymous@xia.com';
    await triggerSingleDownload(url);
    logDownload(email, [url]);
  };

  const handleMultiDownload = async () => {
    if (selectedUrls.length === 0) return;

    if (classData?.requireEmailDownload && !savedEmail) {
      setPendingDownloadAction({ type: 'multi', urls: selectedUrls });
      setShowEmailGate(true);
      return;
    }

    const email = savedEmail || 'anonymous@xia.com';
    await triggerMultiDownload(selectedUrls);
    logDownload(email, selectedUrls);
  };

  const triggerSingleDownload = async (url: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = getPhotoNameFromUrl(url);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('Download error:', err);
      alert('Descărcarea a eșuat. Te rugăm să verifici dacă blocurile CORS sunt dezactivate.');
    }
  };

  const triggerMultiDownload = async (urls: string[]) => {
    setZipLoading(true);
    setZipProgress(0);
    const zip = new JSZip();

    try {
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const filename = getPhotoNameFromUrl(url);
        
        const response = await fetch(url);
        const blob = await response.blob();
        zip.file(filename, blob);

        setZipProgress(Math.round(((i + 1) / urls.length) * 100));
      }

      setZipProgress(100);
      const content = await zip.generateAsync({ type: 'blob' });
      const blobUrl = window.URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `Galere_Foto_${classData?.schoolName.replace(/[^a-z0-9]/gi, '_')}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
      
      // Cleanup selections
      setIsMultiSelectMode(false);
      setSelectedUrls([]);

    } catch (err) {
      console.error('ZIP compilation error:', err);
      alert('Generarea arhivei ZIP a eșuat. Unele imagini ar putea fi blocate de CORS.');
    } finally {
      setZipLoading(false);
    }
  };

  const handleEmailGateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError('');

    if (!emailInput.trim()) {
      setEmailError('Te rugăm să introduci o adresă de email.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailInput)) {
      setEmailError('Te rugăm să introduci o adresă de email validă.');
      return;
    }

    // Save email
    localStorage.setItem('viewer_email', emailInput.trim());
    setSavedEmail(emailInput.trim());
    setShowEmailGate(false);

    // Proceed with pending action
    if (pendingDownloadAction) {
      const email = emailInput.trim();
      const urls = pendingDownloadAction.urls;

      if (pendingDownloadAction.type === 'single') {
        await triggerSingleDownload(urls[0]);
      } else {
        await triggerMultiDownload(urls);
      }
      logDownload(email, urls);
      setPendingDownloadAction(null);
    }
  };

  const navigatePrev = () => {
    if (previewIndex === null || !classData) return;
    setPreviewIndex(previewIndex === 0 ? classData.galleryPhotos.length - 1 : previewIndex - 1);
  };

  const navigateNext = () => {
    if (previewIndex === null || !classData) return;
    setPreviewIndex(previewIndex === classData.galleryPhotos.length - 1 ? 0 : previewIndex + 1);
  };

  if (loading) {
    return (
      <div className="gallery-loading-wrapper">
        <RefreshCw className="spinner" size={32} />
        <p>Se încarcă galeria foto...</p>
        <style>{`
          .gallery-loading-wrapper {
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background-color: #FAF9F6;
            color: #1F1E1C;
            gap: 16px;
          }
          .spinner {
            animation: spin 1s linear infinite;
            color: #8C765C;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  if (error || !classData) {
    return (
      <div className="gallery-error-wrapper">
        <AlertCircle size={48} className="error-icon" />
        <h2>Eroare Galerie</h2>
        <p>{error || 'Eroare necunoscută.'}</p>
        <style>{`
          .gallery-error-wrapper {
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background-color: #FAF9F6;
            color: #1F1E1C;
            padding: 24px;
            text-align: center;
          }
          .error-icon {
            color: #A94442;
            margin-bottom: 16px;
          }
          .gallery-error-wrapper h2 {
            font-size: 24px;
            margin-bottom: 8px;
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="gallery-layout-wrapper">
      {/* Navbar header */}
      <header className="gallery-header">
        <div className="header-left" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <img src="/LOGO ALBUME.svg" alt="Alexia Graduation Albums Logo" style={{ height: '36px', width: 'auto' }} />
          <div style={{ height: '24px', width: '1px', backgroundColor: '#363433' }}></div>
          <div>
            <h1 style={{ fontSize: '16px', fontWeight: 600, color: '#F3EDE7', margin: 0 }}>{classData.schoolName}</h1>
            <p className="teacher-subtitle" style={{ margin: 0, fontSize: '11px', color: '#D8D0C8' }}>Diriginte: {classData.diriginteName} | Galerie Foto</p>
          </div>
        </div>

        <div className="header-actions">
          {isMultiSelectMode ? (
            <div className="multi-actions">
              <button onClick={selectAll} className="btn-action-text">Selectează Tot</button>
              <button onClick={deselectAll} className="btn-action-text">Deselectează Tot</button>
              <button onClick={() => setIsMultiSelectMode(false)} className="btn btn-secondary btn-sm">Anulează</button>
            </div>
          ) : (
            <button 
              onClick={() => setIsMultiSelectMode(true)} 
              className="btn btn-secondary btn-sm"
              disabled={classData.galleryPhotos.length === 0}
            >
              Selectare Multiplă
            </button>
          )}
        </div>
      </header>

      {/* Main Grid Area */}
      <main className="gallery-container container">
        {classData.galleryPhotos.length === 0 ? (
          <div className="gallery-empty-state">
            <AlertCircle size={48} />
            <p>Nu există fotografii încărcate în această galerie.</p>
          </div>
        ) : hasFolders && currentFolder === null ? (
          <div className="folders-grid">
            {Object.keys(folderGroups).map(folderName => (
              <div 
                key={folderName} 
                className="folder-card"
                onClick={() => setCurrentFolder(folderName)}
              >
                <div className="folder-icon-wrapper">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="folder-svg">
                    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"></path>
                  </svg>
                </div>
                <span className="folder-card-name">{folderName}</span>
                <span className="folder-card-count">{folderGroups[folderName].length} poze</span>
              </div>
            ))}
          </div>
        ) : (
          <>
            {hasFolders && currentFolder !== null && (
              <div className="folder-navigation-row" style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px', paddingBottom: '16px', borderBottom: '1px solid var(--border-color)' }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setCurrentFolder(null)}>
                  &larr; Înapoi la foldere
                </button>
                <span className="folder-name-title" style={{ fontSize: '14px', color: '#FAF9F6' }}>Dosar curent: <strong>{currentFolder}</strong></span>
              </div>
            )}
            <div className="masonry-grid-gallery">
              {(hasFolders && currentFolder !== null ? folderGroups[currentFolder] : classData.galleryPhotos).map((photo) => {
                const isSelected = selectedUrls.includes(photo.url);
                const originalIndex = classData.galleryPhotos.findIndex(p => p.url === photo.url);
                return (
                  <div 
                    key={photo.path} 
                    className={`gallery-card-item ${isMultiSelectMode && isSelected ? 'selected' : ''}`}
                    onClick={() => handlePhotoClick(originalIndex)}
                  >
                    <img 
                      src={photo.url} 
                      alt={photo.name} 
                      className="gallery-photo-img" 
                      loading="lazy"
                    />
                    
                    {isMultiSelectMode ? (
                      <div className="multi-select-indicator">
                        {isSelected ? <Check size={12} className="check-mark-indicator" /> : null}
                      </div>
                    ) : (
                      <div className="hover-view-overlay">
                        <Eye size={20} className="eye-icon" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </main>

      {/* Floating Multi-select action bar */}
      {isMultiSelectMode && selectedUrls.length > 0 && (
        <div className="floating-action-bar">
          <span>{selectedUrls.length} poze selectate</span>
          <button onClick={handleMultiDownload} className="btn btn-gold btn-download-float">
            <Download size={15} /> Descarcă ZIP
          </button>
        </div>
      )}

      {/* 1. Lightbox / Zoom Overlay */}
      {previewIndex !== null && (
        <div className="lightbox-overlay">
          <button className="lightbox-close" onClick={() => setPreviewIndex(null)}>
            <X size={28} />
          </button>
          
          <button className="lightbox-nav prev" onClick={navigatePrev}>
            <ChevronLeft size={36} />
          </button>

          <div className="lightbox-content-box">
            <img 
              src={classData.galleryPhotos[previewIndex].url} 
              alt={classData.galleryPhotos[previewIndex].name} 
              className="lightbox-img" 
            />
            <div className="lightbox-footer">
              <span className="photo-label-name">{classData.galleryPhotos[previewIndex].name}</span>
              <button 
                onClick={() => handleSingleDownload(classData.galleryPhotos[previewIndex].url)}
                className="btn btn-gold btn-lightbox-download"
              >
                <Download size={14} /> Descarcă Imaginea
              </button>
            </div>
          </div>

          <button className="lightbox-nav next" onClick={navigateNext}>
            <ChevronRight size={36} />
          </button>
        </div>
      )}

      {/* 2. Email Gate Modal */}
      {showEmailGate && (
        <div className="picker-modal-overlay">
          <div className="email-modal-card">
            <div className="email-modal-header">
              <Mail size={32} className="email-icon-card" />
              <h3>Introdu adresa de email</h3>
              <p>Fotograful solicită o adresă de email validă înainte de a descărca pozele din galerie.</p>
            </div>
            <form onSubmit={handleEmailGateSubmit}>
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <input 
                  type="email" 
                  placeholder="nume@email.com"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  className="form-input"
                  style={{ backgroundColor: '#22201F', color: '#FAF9F6', border: '1px solid #2D2A28' }}
                />
                {emailError && <span className="email-error-msg">{emailError}</span>}
              </div>
              <div className="email-modal-footer">
                <button 
                  type="button" 
                  onClick={() => { setShowEmailGate(false); setPendingDownloadAction(null); }} 
                  className="btn btn-secondary"
                >
                  Anulează
                </button>
                <button type="submit" className="btn btn-primary">
                  Descarcă
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. ZIP downloading progress overlay */}
      {zipLoading && (
        <div className="submitting-overlay">
          <div className="submitting-card">
            <RefreshCw className="spinner zip-spinner" size={40} />
            <h3>Se generează arhiva ZIP...</h3>
            <p>Se descarcă și se împachetează fișierele. Te rugăm să nu închizi fereastra.</p>
            <div className="zip-progress-bg">
              <div className="zip-progress-fill" style={{ width: `${zipProgress}%` }}></div>
            </div>
            <span className="zip-progress-percentage">{zipProgress}%</span>
          </div>
        </div>
      )}

      <style>{`
        .gallery-layout-wrapper {
          min-height: 100vh;
          background-color: #0E0D0C;
          color: #FAF9F6;
          font-family: var(--font-sans);
          display: flex;
          flex-direction: column;
        }

        .gallery-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 20px 40px;
          border-bottom: 1px solid #262423;
          background-color: #161514;
          position: sticky;
          top: 0;
          z-index: 90;
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .brand-camera {
          color: var(--gold-accent);
        }

        .gallery-header h1 {
          font-size: 18px;
          font-weight: 600;
          line-height: 1.2;
          color: #FAF9F6;
        }

        .teacher-subtitle {
          font-size: 12px;
          color: #A3A09B;
        }

        .btn-action-text {
          background: none;
          border: none;
          color: #A3A09B;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
          transition: color 0.15s;
        }

        .btn-action-text:hover {
          color: #FAF9F6;
          text-decoration: underline;
        }

        .multi-actions {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .gallery-container {
          flex: 1;
          padding-top: 32px;
          padding-bottom: 80px;
        }

        .gallery-empty-state {
          text-align: center;
          color: var(--text-muted);
          padding: 80px 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }

        /* Masonry Grid (Pixieset Style) */
        .masonry-grid-gallery {
          column-count: 3;
          column-gap: 24px;
          width: 100%;
        }

        @media (max-width: 900px) {
          .masonry-grid-gallery {
            column-count: 2;
            column-gap: 16px;
          }
        }
        @media (max-width: 600px) {
          .masonry-grid-gallery {
            column-count: 1;
            column-gap: 0;
          }
        }

        .gallery-card-item {
          break-inside: avoid;
          margin-bottom: 24px;
          position: relative;
          border-radius: var(--radius-sm);
          overflow: hidden;
          cursor: pointer;
          transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1), box-shadow 0.3s;
          border: 2px solid transparent;
          background-color: #161514;
        }

        @media (max-width: 600px) {
          .gallery-card-item {
            margin-bottom: 16px;
          }
        }

        .gallery-card-item:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-md);
        }

        .gallery-card-item.selected {
          border-color: var(--gold-accent);
        }

        .gallery-photo-img {
          width: 100%;
          display: block;
          height: auto;
        }

        .hover-view-overlay {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.15);
          opacity: 0;
          transition: opacity 0.25s ease;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .gallery-card-item:hover .hover-view-overlay {
          opacity: 1;
        }

        .eye-icon {
          color: #FFFFFF;
        }

        /* Multi select styling indicators */
        .multi-select-indicator {
          position: absolute;
          top: 12px;
          right: 12px;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          border: 1.5px solid #FFFFFF;
          background-color: rgba(0, 0, 0, 0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }

        .gallery-card-item.selected .multi-select-indicator {
          background-color: var(--gold-accent);
          border-color: var(--gold-accent);
        }

        .check-mark-indicator {
          color: #FFFFFF;
        }

        /* Floating action bar */
        .floating-action-bar {
          position: fixed;
          bottom: 24px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(26, 26, 26, 0.95);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          color: #FFFFFF;
          padding: 12px 24px;
          border-radius: 30px;
          display: flex;
          align-items: center;
          gap: 20px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.3);
          z-index: 95;
          animation: slideUpFloat 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
          font-size: 13px;
          font-weight: 500;
        }

        .btn-download-float {
          border-radius: 20px;
          padding: 8px 20px;
          height: 36px;
          font-size: 12px;
        }

        /* Lightbox / Zoom overlay styles */
        .lightbox-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background-color: rgba(14, 13, 12, 0.98);
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 40px;
          animation: fadeIn 0.25s ease-out;
        }

        @media (max-width: 600px) {
          .lightbox-overlay {
            padding: 0 10px;
          }
        }

        .lightbox-close {
          position: absolute;
          top: 24px;
          right: 24px;
          background: none;
          border: none;
          color: rgba(255,255,255,0.7);
          cursor: pointer;
          transition: color 0.15s;
          z-index: 1002;
        }

        .lightbox-close:hover {
          color: #FFFFFF;
        }

        .lightbox-nav {
          background: none;
          border: none;
          color: rgba(255,255,255,0.5);
          cursor: pointer;
          padding: 20px;
          transition: color 0.15s, transform 0.15s;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1001;
        }

        .lightbox-nav:hover {
          color: #FFFFFF;
          transform: scale(1.1);
        }

        @media (max-width: 600px) {
          .lightbox-nav {
            display: none; // hide side nav on small screen, users swipe or we can add small buttons
          }
        }

        .lightbox-content-box {
          display: flex;
          flex-direction: column;
          align-items: center;
          max-width: 80vw;
          max-height: 80vh;
          gap: 16px;
        }

        @media (max-width: 600px) {
          .lightbox-content-box {
            max-width: 95vw;
          }
        }

        .lightbox-img {
          max-width: 100%;
          max-height: 70vh;
          object-fit: contain;
          border-radius: 2px;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
        }

        .lightbox-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          width: 100%;
          color: #FFFFFF;
          border-top: 1px solid rgba(255,255,255,0.1);
          padding-top: 16px;
        }

        .photo-label-name {
          font-size: 13px;
          color: rgba(255,255,255,0.7);
          font-family: monospace;
        }

        .btn-lightbox-download {
          height: 38px;
          font-size: 12px;
          padding: 8px 16px;
          border-radius: 4px;
        }

        /* Email Gate Modal styling */
        .email-modal-card {
          background-color: #161514;
          border-radius: var(--radius-md);
          padding: 36px;
          max-width: 420px;
          width: 100%;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
          border: 1px solid #262423;
          color: #FAF9F6;
        }

        .email-modal-header {
          text-align: center;
          margin-bottom: 24px;
        }

        .email-icon-card {
          color: var(--gold-accent);
          margin-bottom: 12px;
        }

        .email-modal-header h3 {
          font-size: 20px;
          font-weight: 500;
          margin-bottom: 8px;
          color: #FAF9F6;
        }

        .email-modal-header p {
          font-size: 13px;
          color: #A3A09B;
          line-height: 1.5;
        }

        .email-error-msg {
          display: block;
          font-size: 11px;
          color: var(--error-color);
          margin-top: 6px;
        }

        .email-modal-footer {
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          margin-top: 24px;
          border-top: 1px solid #262423;
          padding-top: 16px;
        }

        /* Zip generating bar progress */
        .zip-progress-bg {
          width: 100%;
          height: 8px;
          background-color: #2D2A28;
          border-radius: 4px;
          overflow: hidden;
          margin-top: 16px;
        }

        .zip-progress-fill {
          height: 100%;
          background-color: var(--gold-accent);
          width: 0;
          transition: width 0.1s ease;
        }

        .zip-progress-percentage {
          display: block;
          margin-top: 8px;
          font-size: 14px;
          font-weight: 600;
          color: var(--gold-accent);
        }

        .zip-spinner {
          color: var(--gold-accent);
          margin-bottom: 20px;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        @keyframes slideUpFloat {
          from { transform: translate(-50%, 20px); opacity: 0; }
          to { transform: translate(-50%, 0); opacity: 1; }
        }

        /* Folder styles */
        .folders-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          gap: 24px;
          padding: 24px 0;
        }

        .folder-card {
          background-color: #161514;
          border: 1px solid #262423;
          border-radius: var(--radius-sm);
          padding: 32px 20px;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .folder-card:hover {
          transform: translateY(-2px);
          border-color: var(--gold-accent);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        }

        .folder-icon-wrapper {
          color: var(--gold-accent);
          margin-bottom: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .folder-svg {
          width: 52px;
          height: 52px;
        }

        .folder-card-name {
          font-size: 14px;
          font-weight: 600;
          color: #FAF9F6;
          margin-bottom: 8px;
          word-break: break-all;
          line-height: 1.4;
        }

        .folder-card-count {
          font-size: 12px;
          color: #A3A09B;
        }
      `}</style>
    </div>
  );
};

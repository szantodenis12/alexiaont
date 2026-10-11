import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { doc, getDoc, collection, addDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { loadClassPhotos, getClassSessions, photoSessionId, MAIN_SESSION_ID, groupPhotosByFolder, shouldShowFolders } from '../../utils/classPhotos';
import type { ClassSession } from '../../utils/classPhotos';
import { useBodyScrollLock } from '../../utils/useBodyScrollLock';
import { useSwipe } from '../../utils/useSwipe';
import { EmailPrivacyNote } from '../Common/EmailPrivacyNote';
import { useVisitTracking } from '../../utils/visitTracker';
import { distributePhotos, useResponsiveColumns, gapForColumns } from '../../utils/galleryGrid';
import { convertBlobToGrayscale } from '../../utils/imageProcessor';
import {
  Download, Check, X, Mail, RefreshCw, 
  AlertCircle, Eye, ChevronLeft, ChevronRight 
} from 'lucide-react';

interface Photo {
  name: string;
  url: string;
  cleanUrl?: string;
  path: string;
  cleanPath?: string;
  /** ~1200px copies used by the grid; absent on photos uploaded before previews. */
  previewUrl?: string;
  previewCleanUrl?: string;
  thumbUrl?: string;
  folder?: string;
  sessionId?: string;
  /** Original pixel size stored at upload; absent on older photos. */
  width?: number;
  height?: number;
}

interface ClassData {
  id: string;
  schoolName: string;
  diriginteName: string;
  status: 'active' | 'locked';
  requireEmailDownload: boolean;
  galleryPhotos: Photo[];
  galleryType?: 'flat' | 'folder';
  sessions?: ClassSession[];
}

interface StandaloneGalleryProps {
  cleanMode?: boolean;
}

export const StandaloneGallery: React.FC<StandaloneGalleryProps> = ({ cleanMode = false }) => {
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
    fileName?: string;
    grayscale?: boolean;
  } | null>(null);

  // Black & white ("alb-negru"): CSS filter for viewing in the lightbox, real
  // grayscale conversion for the downloaded file.
  const [isGrayscaleActive, setIsGrayscaleActive] = useState(false);
  const [zipGrayscale, setZipGrayscale] = useState(false);

  // ZIP compiling states
  const [zipLoading, setZipLoading] = useState(false);
  const [zipProgress, setZipProgress] = useState(0);

  // Grid layout. Ratios measured on image load, for photos without stored size.
  const [aspectRatios, setAspectRatios] = useState<Record<string, number>>({});
  const columnsCount = useResponsiveColumns('regular');
  const gridGap = gapForColumns(columnsCount);

  // Folder navigation states
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);

  // Photo sessions ("ședințe"). A class without extra sessions has exactly one,
  // and then everything below behaves exactly as before (no tab bar).
  const [activeSessionId, setActiveSessionId] = useState<string>(MAIN_SESSION_ID);
  const sessions = React.useMemo(() => getClassSessions(classData), [classData]);
  const hasMultipleSessions = sessions.length > 1;

  const sessionPhotos = React.useMemo<Photo[]>(() => {
    if (!classData) return [];
    if (!hasMultipleSessions) return classData.galleryPhotos;
    return classData.galleryPhotos.filter(p => photoSessionId(p, sessions) === activeSessionId);
  }, [classData, sessions, hasMultipleSessions, activeSessionId]);

  const folderList = React.useMemo(() => groupPhotosByFolder(sessionPhotos), [sessionPhotos]);
  const hasFolders = React.useMemo(() => shouldShowFolders(folderList), [folderList]);
  const folderGroups = React.useMemo(() => {
    const groups: Record<string, Photo[]> = {};
    folderList.forEach(g => { groups[g.key] = g.photos; });
    return groups;
  }, [folderList]);
  const currentFolderName = currentFolder !== null
    ? (folderList.find(g => g.key === currentFolder)?.name ?? currentFolder)
    : '';

  // Exactly the photos on screen. The lightbox indexes into this list, so
  // prev/next never wander into another session or folder.
  const visiblePhotos = React.useMemo<Photo[]>(() => {
    if (hasFolders) return currentFolder !== null ? (folderGroups[currentFolder] || []) : [];
    return sessionPhotos;
  }, [hasFolders, currentFolder, folderGroups, sessionPhotos]);

  // Grid columns (order preserved) and each photo's index in the visible list.
  const gridColumns = React.useMemo(() => distributePhotos(visiblePhotos, columnsCount), [visiblePhotos, columnsCount]);
  const visibleIndexOf = React.useMemo(() => {
    const m = new Map<Photo, number>();
    visiblePhotos.forEach((p, i) => m.set(p, i));
    return m;
  }, [visiblePhotos]);

  const sessionPhotoCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    if (!classData || !hasMultipleSessions) return counts;
    classData.galleryPhotos.forEach(p => {
      const id = photoSessionId(p, sessions);
      counts[id] = (counts[id] || 0) + 1;
    });
    return counts;
  }, [classData, sessions, hasMultipleSessions]);

  const handleSessionSelect = (sessionId: string) => {
    if (sessionId === activeSessionId) return;
    setActiveSessionId(sessionId);
    setCurrentFolder(null);
    setPreviewIndex(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };


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
          const data = classDoc.data();
          // Photos may sit in the `photos` subcollection or, for older classes,
          // still inside the class document. loadClassPhotos hides the difference.
          const photos = await loadClassPhotos(classId, data);
          setClassData({ id: classDoc.id, ...data, galleryPhotos: photos } as ClassData);
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

  // Freeze the page behind the lightbox. Keyed on "open", not on the index —
  // the previous version re-ran on every next/prev and could lose the scroll
  // position on close.
  useBodyScrollLock(previewIndex !== null);
  // The B&W toggle belongs to one viewing session: closing the lightbox resets it.
  useEffect(() => {
    if (previewIndex === null) setIsGrayscaleActive(false);
  }, [previewIndex]);
  useVisitTracking('class_gallery', cleanMode ? null : classId);

  const handlePhotoClick = (index: number) => {
    if (isMultiSelectMode) {
      const photo = visiblePhotos[index];
      if (!photo) return;
      const urlToToggle = cleanMode ? (photo.cleanUrl || photo.url) : photo.url;
      toggleSelectUrl(urlToToggle);
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

  // Keys for the photos currently on screen (same key the grid click handler uses).
  const visibleSelectKeys = visiblePhotos.map(p => cleanMode ? (p.cleanUrl || p.url) : p.url);

  // Selects only the visible photos; selections in other folders are kept.
  const selectAll = () => {
    setSelectedUrls(prev => [...prev, ...visibleSelectKeys.filter(k => !prev.includes(k))]);
  };

  // Removes only the visible photos; selections in other folders are kept.
  const deselectAll = () => {
    setSelectedUrls(prev => prev.filter(url => !visibleSelectKeys.includes(url)));
  };

  const getPhotoNameFromUrl = (url: string): string => {
    if (!classData) return 'photo.jpg';
    // Clean-mode downloads carry the original's URL, so match that one too.
    const found = classData.galleryPhotos.find(p => p.url === url || p.cleanUrl === url);
    return found ? found.name : 'photo.jpg';
  };

  /** "IMG_1.png" -> "IMG_1_alb-negru.jpg" (the grayscale file is always a JPEG). */
  const grayscaleFileName = (name: string): string =>
    `${name.replace(/\.[^./\\]+$/, '')}_alb-negru.jpg`;

  // Log downloads in Firestore (file names exactly as delivered)
  const logDownload = async (email: string, filenames: string[]) => {
    if (!classId) return;
    try {
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

  const handleSingleDownload = async (photo: Photo) => {
    const downloadUrl = cleanMode ? (photo.cleanUrl || photo.url) : photo.url;
    const grayscale = isGrayscaleActive;
    if (classData?.requireEmailDownload && !savedEmail && !cleanMode) {
      setPendingDownloadAction({ type: 'single', urls: [downloadUrl], fileName: photo.name, grayscale });
      setShowEmailGate(true);
      return;
    }
    const email = savedEmail || (cleanMode ? 'admin-clean-mode' : 'anonymous@xia.com');
    const delivered = await triggerSingleDownload(downloadUrl, photo.name, grayscale);
    logDownload(email, [delivered]);
  };

  const handleMultiDownload = async () => {
    if (selectedUrls.length === 0) return;
    const grayscale = zipGrayscale;
    if (classData?.requireEmailDownload && !savedEmail && !cleanMode) {
      setPendingDownloadAction({ type: 'multi', urls: selectedUrls, grayscale });
      setShowEmailGate(true);
      return;
    }
    const email = savedEmail || (cleanMode ? 'admin-clean-mode' : 'anonymous@xia.com');
    const delivered = await triggerMultiDownload(selectedUrls, grayscale);
    logDownload(email, delivered);
  };

  /** Returns the file name that was (or was meant to be) delivered. */
  const triggerSingleDownload = async (url: string, fileName?: string, grayscale = false): Promise<string> => {
    const baseName = fileName || getPhotoNameFromUrl(url);
    const deliveredName = grayscale ? grayscaleFileName(baseName) : baseName;
    try {
      const response = await fetch(url);
      let blob = await response.blob();
      if (grayscale) blob = await convertBlobToGrayscale(blob);
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = deliveredName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('Download error:', err);
      alert('Descărcarea a eșuat. Te rugăm să verifici dacă blocurile CORS sunt dezactivate.');
    }
    return deliveredName;
  };

  /** Returns the file names put in the archive. */
  const triggerMultiDownload = async (urls: string[], grayscale = false): Promise<string[]> => {
    setZipLoading(true);
    setZipProgress(0);
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    const deliveredNames: string[] = [];

    try {
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const baseName = getPhotoNameFromUrl(url);
        const filename = grayscale ? grayscaleFileName(baseName) : baseName;
        deliveredNames.push(filename);

        const response = await fetch(url);
        let blob = await response.blob();
        if (grayscale) blob = await convertBlobToGrayscale(blob);
        zip.file(filename, blob);

        setZipProgress(Math.round(((i + 1) / urls.length) * 100));
      }

      setZipProgress(100);
      const content = await zip.generateAsync({ type: 'blob' });
      const blobUrl = window.URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `Galere_Foto_${classData?.schoolName.replace(/[^a-z0-9]/gi, '_')}${grayscale ? '_alb-negru' : ''}.zip`;
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
    return deliveredNames;
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

      let delivered: string[];
      if (pendingDownloadAction.type === 'single') {
        delivered = [await triggerSingleDownload(urls[0], pendingDownloadAction.fileName, pendingDownloadAction.grayscale)];
      } else {
        delivered = await triggerMultiDownload(urls, pendingDownloadAction.grayscale);
      }
      logDownload(email, delivered);
      setPendingDownloadAction(null);
    }
  };

  const navigatePrev = () => {
    if (previewIndex === null || visiblePhotos.length === 0) return;
    setPreviewIndex(previewIndex === 0 ? visiblePhotos.length - 1 : previewIndex - 1);
  };

  const navigateNext = () => {
    if (previewIndex === null || visiblePhotos.length === 0) return;
    setPreviewIndex(previewIndex >= visiblePhotos.length - 1 ? 0 : previewIndex + 1);
  };

  // Swipe left = next, right = previous. Only navigation on phones (side arrows
  // are hidden there); the whole overlay is the swipe target.
  const lightboxSwipe = useSwipe(navigateNext, navigatePrev);

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

  const previewPhoto = previewIndex !== null ? visiblePhotos[previewIndex] : undefined;

  return (
    <div className="gallery-layout-wrapper">
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
          🔓 LINK EDITARE — Pozele sunt FĂRĂ watermark. Nu distribui acest link clienților!
        </div>
      )}

      {/* Navbar header */}
      <header className="gallery-header" style={{ marginTop: cleanMode ? '40px' : 0 }}>
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
              <button onClick={selectAll} className="btn-action-text" disabled={visiblePhotos.length === 0}>Selectează Tot</button>
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

      {/* Session tabs, only when the class has more than one photo session */}
      {hasMultipleSessions && (
        <nav className="session-nav-bar" aria-label="Ședințe foto">
          <div className="session-tabs-wrapper">
            {sessions.map(session => {
              const isActive = session.id === activeSessionId;
              return (
                <button
                  key={session.id}
                  type="button"
                  className={`session-tab-btn${isActive ? ' active' : ''}`}
                  aria-current={isActive ? 'true' : undefined}
                  onClick={(e) => {
                    handleSessionSelect(session.id);
                    e.currentTarget.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
                  }}
                >
                  {session.name}
                  <span className="session-tab-count">{sessionPhotoCounts[session.id] || 0}</span>
                </button>
              );
            })}
          </div>
        </nav>
      )}

      {/* Main Grid Area */}
      <main className={(!hasFolders || currentFolder !== null) ? "gallery-container-fluid" : "gallery-container container"}>
        {sessionPhotos.length === 0 ? (
          <div className="gallery-empty-state">
            <AlertCircle size={48} />
            <p>{hasMultipleSessions && classData.galleryPhotos.length > 0
              ? 'Nu există fotografii încărcate în această ședință.'
              : 'Nu există fotografii încărcate în această galerie.'}</p>
          </div>
        ) : hasFolders && currentFolder === null ? (
          <div className="folders-grid">
            {folderList.map(g => (
              <div
                key={g.key}
                className="folder-card"
                onClick={() => setCurrentFolder(g.key)}
              >
                {g.cover ? (
                  <div className="folder-cover">
                    <img src={g.cover} alt="" loading="lazy" decoding="async" />
                  </div>
                ) : (
                  <div className="folder-icon-wrapper">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="folder-svg">
                      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"></path>
                    </svg>
                  </div>
                )}
                <span className="folder-card-name">{g.name}</span>
                <span className="folder-card-count">{g.photos.length} poze</span>
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
                <span className="folder-name-title" style={{ fontSize: '14px', color: '#FAF9F6' }}>Dosar curent: <strong>{currentFolderName}</strong></span>
              </div>
            )}
            {/* Photos are dealt out over the columns in order (shared galleryGrid
                module), and every tile reserves its height from the photo's aspect
                ratio, so nothing moves while images load. Column assignment uses
                stored sizes only (no measured ratios) so it never reshuffles. */}
            <div className="masonry-grid-gallery" style={{ gap: gridGap }}>
              {gridColumns.map((col, colIdx) => (
                <div key={colIdx} className="masonry-column-gallery" style={{ gap: gridGap }}>
                  {col.map((photo) => {
                    const visibleIndex = visibleIndexOf.get(photo) ?? 0;
                    // Thumbnails use the ~1200px copy when one exists; the lightbox and
                    // downloads still use the full-size file.
                    const displayUrl = cleanMode
                      ? (photo.previewCleanUrl || photo.cleanUrl || photo.url)
                      : (photo.thumbUrl || photo.previewUrl || photo.url);
                    // Same key handlePhotoClick stores when toggling selection.
                    const selectKey = cleanMode ? (photo.cleanUrl || photo.url) : photo.url;
                    const isSelected = selectedUrls.includes(selectKey);
                    const tileAspect = photo.width && photo.height
                      ? photo.width / photo.height
                      : (aspectRatios[photo.path] || 4 / 3);
                    return (
                      <div
                        key={photo.path}
                        className={`gallery-card-item ${isMultiSelectMode && isSelected ? 'selected' : ''}`}
                        style={{ aspectRatio: String(tileAspect) }}
                        onClick={() => handlePhotoClick(visibleIndex)}
                      >
                        <img
                          src={displayUrl}
                          alt={photo.name}
                          className="gallery-photo-img"
                          loading="lazy"
                          decoding="async"
                          onLoad={(e) => {
                            if (photo.width && photo.height) return;
                            const img = e.currentTarget;
                            if (!img.naturalWidth || !img.naturalHeight) return;
                            const r = img.naturalWidth / img.naturalHeight;
                            setAspectRatios(prev => (
                              Math.abs((prev[photo.path] || 0) - r) < 0.001 ? prev : { ...prev, [photo.path]: r }
                            ));
                          }}
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
              ))}
            </div>
          </>
        )}
      </main>

      {/* Floating Multi-select action bar */}
      {isMultiSelectMode && selectedUrls.length > 0 && (
        <div className="floating-action-bar">
          <span>{selectedUrls.length} poze selectate</span>
          <label className="zip-bw-option">
            <input
              type="checkbox"
              checked={zipGrayscale}
              onChange={(e) => setZipGrayscale(e.target.checked)}
            />
            Descarcă alb-negru
          </label>
          <button onClick={handleMultiDownload} className="btn btn-gold btn-download-float">
            <Download size={15} /> Descarcă ZIP
          </button>
        </div>
      )}

      {/* 1. Lightbox / Zoom Overlay */}
      {previewIndex !== null && previewPhoto && (
        <div className="lightbox-overlay" {...lightboxSwipe}>
          <button className="lightbox-close" onClick={() => setPreviewIndex(null)}>
            <X size={28} />
          </button>
          
          <button className="lightbox-nav prev" onClick={navigatePrev}>
            <ChevronLeft size={36} />
          </button>

          <div className="lightbox-content-box">
            <img 
              src={cleanMode
                ? (previewPhoto.previewCleanUrl || previewPhoto.cleanUrl || previewPhoto.url)
                : (previewPhoto.previewUrl || previewPhoto.url)} 
              alt={previewPhoto.name} 
              className="lightbox-img"
              style={{ filter: isGrayscaleActive ? 'grayscale(100%)' : 'none' }}
            />
            <div className="lightbox-footer">
              <span className="photo-label-name">{previewPhoto.name}</span>
              <div className="lightbox-footer-actions">
                <button
                  type="button"
                  onClick={() => setIsGrayscaleActive(v => !v)}
                  aria-pressed={isGrayscaleActive}
                  className={`lightbox-bw-toggle${isGrayscaleActive ? ' active' : ''}`}
                >
                  <span className="lightbox-bw-dot" />
                  Alb-negru
                </button>
                <button
                  onClick={() => handleSingleDownload(previewPhoto)}
                  className="btn btn-gold btn-lightbox-download"
                >
                  <Download size={14} /> Descarcă Imaginea
                </button>
              </div>
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
            <EmailPrivacyNote />
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

        /* Session tabs: same look as the folder tabs on photo galleries */
        .session-nav-bar {
          background-color: rgba(18, 17, 16, 0.95);
          border-bottom: 1px solid #262423;
          padding: 0 24px;
          display: flex;
          justify-content: center;
        }
        .session-tabs-wrapper {
          display: flex;
          gap: 24px;
          overflow-x: auto;
          max-width: 100%;
          padding: 0 12px;
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .session-tabs-wrapper::-webkit-scrollbar {
          display: none;
        }
        .session-tab-btn {
          background: none;
          border: none;
          border-bottom: 2px solid transparent;
          color: #706E6A;
          font-family: inherit;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          padding: 16px 0 14px;
          cursor: pointer;
          transition: all 0.2s ease;
          white-space: nowrap;
          flex-shrink: 0;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .session-tab-btn.active {
          color: #FAF9F6;
          border-bottom-color: var(--gold-accent);
        }
        @media (hover: hover) {
          .session-tab-btn:not(.active):hover {
            color: #D8D0C8;
          }
        }
        .session-tab-count {
          font-size: 10px;
          font-weight: 500;
          letter-spacing: 0.02em;
          opacity: 0.7;
        }
        @media (max-width: 768px) {
          .session-nav-bar {
            padding: 0 16px;
            justify-content: flex-start;
          }
          .session-tabs-wrapper {
            gap: 18px;
            padding: 0;
          }
          .session-tab-btn {
            padding: 13px 0 11px;
          }
        }

        .gallery-container {
          flex: 1;
          padding-top: 32px;
          padding-bottom: 80px;
        }

        .gallery-container-fluid {
          flex: 1;
          width: 100%;
          padding: 4px;
          box-sizing: border-box;
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
        /* Column count and gaps come from galleryGrid.ts (inline gap). Flex columns
           fill left-to-right in photo order, unlike CSS columns. */
        .masonry-grid-gallery {
          display: flex;
          align-items: flex-start;
          width: 100%;
        }

        .masonry-column-gallery {
          flex: 1 1 0;
          min-width: 0;
          display: flex;
          flex-direction: column;
        }

        .gallery-card-item {
          width: 100%;
          box-sizing: border-box;
          flex-shrink: 0;
          position: relative;
          border-radius: var(--radius-sm);
          overflow: hidden;
          cursor: pointer;
          transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1), box-shadow 0.3s;
          border: 2px solid transparent;
          background-color: #161514;
        }

        .gallery-card-item:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-md);
        }

        .gallery-card-item.selected {
          border-color: var(--gold-accent);
        }

        /* The tile owns the height (aspect-ratio); the image just fills it. */
        .gallery-photo-img {
          width: 100%;
          height: 100%;
          display: block;
          object-fit: cover;
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

        .zip-bw-option {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: #D8D0C8;
          cursor: pointer;
          white-space: nowrap;
        }
        @media (max-width: 600px) {
          .floating-action-bar {
            gap: 10px;
            padding: 10px 14px;
            font-size: 12px;
            max-width: calc(100vw - 16px);
            box-sizing: border-box;
          }
          .floating-action-bar .btn-download-float {
            padding: 8px 14px;
          }
        }
        .zip-bw-option input {
          accent-color: var(--gold-accent);
          cursor: pointer;
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
            display: none; /* hide side nav on small screen, users swipe or we can add small buttons */
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

        .lightbox-footer {
          gap: 12px;
          flex-wrap: wrap;
        }

        .lightbox-footer-actions {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .lightbox-bw-toggle {
          background: none;
          border: 1px solid transparent;
          color: #D8D0C8;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 12px;
          font-family: inherit;
          padding: 4px 8px;
          border-radius: 4px;
          transition: all 0.15s ease;
        }
        .lightbox-bw-toggle.active {
          border-color: var(--gold-accent);
          color: var(--gold-accent);
        }
        .lightbox-bw-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: linear-gradient(to right, #FAF9F6 50%, #706E6A 50%);
          border: 1px solid #FAF9F6;
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
          padding: 20px;
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

        .folder-cover {
          width: 100%;
          aspect-ratio: 4 / 3;
          border-radius: var(--radius-sm);
          overflow: hidden;
          background-color: #0F0E0D;
          margin-bottom: 12px;
        }
        .folder-cover img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
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

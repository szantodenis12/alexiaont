import React, { useEffect, useRef, useState } from 'react';
import { X, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { useBodyScrollLock } from '../../utils/useBodyScrollLock';
import { photoSessionId, groupPhotosByFolder, shouldShowFolders } from '../../utils/classPhotos';
import type { ClassSession } from '../../utils/classPhotos';

interface Photo {
  name: string;
  url: string;
  path: string;
  folder?: string;
  sessionId?: string;
}

interface SelectedPhoto {
  url: string;
  bw: boolean;
}

interface PhotoPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  photos: Photo[];
  selectedPhotos: SelectedPhoto[];
  onConfirm: (selectedUrls: string[], bwStates: Record<string, boolean>) => void;
  multiple?: boolean;
  minRequired?: number;
  fieldKey: string;
  /** Photo sessions of the class. Tabs appear only when there is more than one. */
  sessions?: ClassSession[];
}

// Global scroll memory store
const scrollMemory: Record<string, number> = {};
// Last session viewed per field, so the restored scroll lands in the same list.
const sessionMemory: Record<string, string> = {};

export const PhotoPickerModal: React.FC<PhotoPickerModalProps> = ({
  isOpen,
  onClose,
  photos,
  selectedPhotos,
  onConfirm,
  multiple = false,
  minRequired = 1,
  fieldKey,
  sessions
}) => {
  const [localSelection, setLocalSelection] = useState<string[]>([]);
  const [localBwStates, setLocalBwStates] = useState<Record<string, boolean>>({});
  const [previewPhoto, setPreviewPhoto] = useState<Photo | null>(null);
  const [previewBw, setPreviewBw] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);

  // Photo sessions ("ședințe"). With a single session everything below works on
  // the full list, exactly as before, and no tab bar is shown.
  const sessionList = sessions && sessions.length > 0 ? sessions : null;
  const hasMultipleSessions = !!sessionList && sessionList.length > 1;
  const [activeSessionId, setActiveSessionId] = useState<string>(
    () => sessionMemory[fieldKey] || (sessionList ? sessionList[0].id : '')
  );
  const effectiveSessionId = hasMultipleSessions && sessionList!.some(s => s.id === activeSessionId)
    ? activeSessionId
    : (sessionList ? sessionList[0].id : '');

  const sessionPhotos = React.useMemo(() => {
    if (!hasMultipleSessions) return photos;
    return photos.filter(p => photoSessionId(p, sessionList!) === effectiveSessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos, hasMultipleSessions, effectiveSessionId, sessions]);

  // Freeze the configurator page behind the picker (and its zoom view) so mobile
  // swipes scroll only the picker's own grid. Called before any early return.
  useBodyScrollLock(isOpen);

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

  // The list the student is currently browsing in the grid: the current folder's
  // photos when inside a folder, otherwise the selected session's full list.
  // Preview navigation walks this.
  const currentPreviewList = React.useMemo(() => {
    return hasFolders && currentFolder !== null ? (folderGroups[currentFolder] || []) : sessionPhotos;
  }, [hasFolders, currentFolder, folderGroups, sessionPhotos]);

  const previewIndex = previewPhoto
    ? currentPreviewList.findIndex(p => p.url === previewPhoto.url)
    : -1;

  const getPreviewSrc = (photo: Photo) => (photo as any).previewUrl || photo.url;

  const navigatePreview = (offset: number) => {
    if (previewIndex === -1 || currentPreviewList.length === 0) return;
    const nextIndex = (previewIndex + offset + currentPreviewList.length) % currentPreviewList.length;
    const nextPhoto = currentPreviewList[nextIndex];
    setPreviewPhoto(nextPhoto);
    setPreviewBw(localBwStates[nextPhoto.url] || false);
  };

  // Keep a ref to the latest navigate function so the keydown listener (attached
  // once per preview open) always calls with up-to-date state.
  const navigatePreviewRef = useRef(navigatePreview);
  navigatePreviewRef.current = navigatePreview;

  // Preload the previous/next image so navigating feels instant.
  useEffect(() => {
    if (previewIndex === -1 || currentPreviewList.length < 2) return;
    const prevPhoto = currentPreviewList[(previewIndex - 1 + currentPreviewList.length) % currentPreviewList.length];
    const nextPhoto = currentPreviewList[(previewIndex + 1) % currentPreviewList.length];
    [prevPhoto, nextPhoto].forEach(p => {
      if (p) {
        const img = new Image();
        img.src = getPreviewSrc(p);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewIndex, currentPreviewList]);

  // Keyboard navigation (←/→) and Esc-to-close, active only while the preview is open.
  useEffect(() => {
    if (!previewPhoto) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navigatePreviewRef.current(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        navigatePreviewRef.current(1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setPreviewPhoto(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewPhoto]);

  // Swipe-to-navigate on touch devices. Thresholds distinguish a horizontal swipe
  // from a vertical gesture (scroll) and from a tap (tiny movement).
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const SWIPE_MIN_DISTANCE = 50;
  const SWIPE_DIRECTION_RATIO = 1.5;

  const handlePreviewTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handlePreviewTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    if (absDx < SWIPE_MIN_DISTANCE || absDx < absDy * SWIPE_DIRECTION_RATIO) return;
    navigatePreview(dx < 0 ? 1 : -1);
  };

  // Initialize local selection
  useEffect(() => {
    if (isOpen) {
      setLocalSelection(selectedPhotos.map(p => p.url));
      const bws: Record<string, boolean> = {};
      selectedPhotos.forEach(p => {
        bws[p.url] = p.bw;
      });
      setLocalBwStates(bws);
      setCurrentFolder(null);
    }
  }, [isOpen, selectedPhotos]);

  const handleSessionSelect = (sessionId: string) => {
    if (sessionId === effectiveSessionId) return;
    setActiveSessionId(sessionId);
    sessionMemory[fieldKey] = sessionId;
    setCurrentFolder(null);
    setPreviewPhoto(null);
    scrollMemory[fieldKey] = 0;
    if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
  };

  // Restore scroll position
  useEffect(() => {
    if (isOpen && scrollContainerRef.current) {
      const savedScroll = scrollMemory[fieldKey] || 0;
      // We need a tiny timeout to ensure the DOM layout is completed and images started rendering
      const timeout = setTimeout(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = savedScroll;
        }
      }, 30);
      return () => clearTimeout(timeout);
    }
  }, [isOpen, fieldKey]);

  // Save scroll position when user scrolls
  const handleScroll = () => {
    if (scrollContainerRef.current) {
      scrollMemory[fieldKey] = scrollContainerRef.current.scrollTop;
    }
  };

  if (!isOpen) return null;

  const toggleSelect = (url: string) => {
    if (multiple) {
      if (localSelection.includes(url)) {
        setLocalSelection(prev => prev.filter(item => item !== url));
      } else {
        setLocalSelection(prev => [...prev, url]);
      }
    } else {
      setLocalSelection([url]);
    }
  };

  const handleConfirm = () => {
    onConfirm(localSelection, localBwStates);
    onClose();
  };

  return (
    <div className="picker-modal-overlay">
      <div className="picker-modal-content">
        <div className="picker-modal-header">
          <div>
            <h3>Selectează Poze</h3>
            <p className="picker-modal-subtitle">
              {multiple 
                ? `Alege poze (minim ${minRequired} recomandate)` 
                : 'Alege o singură poză'
              }
            </p>
          </div>
          <button onClick={onClose} className="picker-close-btn">
            <X size={20} />
          </button>
        </div>

        {/* Session tabs, only when the class has more than one photo session */}
        {hasMultipleSessions && (
          <nav className="picker-session-bar" aria-label="Ședințe foto">
            {sessionList!.map(session => {
              const isActive = session.id === effectiveSessionId;
              const selectedHere = photos.reduce((n, p) =>
                photoSessionId(p, sessionList!) === session.id && localSelection.includes(p.url) ? n + 1 : n, 0);
              return (
                <button
                  key={session.id}
                  type="button"
                  className={`picker-session-tab${isActive ? ' active' : ''}`}
                  aria-current={isActive ? 'true' : undefined}
                  onClick={(e) => {
                    handleSessionSelect(session.id);
                    e.currentTarget.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
                  }}
                >
                  {session.name}
                  {selectedHere > 0 && (
                    <span className="picker-session-badge" title={`${selectedHere} poze selectate din această ședință`}>{selectedHere}</span>
                  )}
                </button>
              );
            })}
          </nav>
        )}

        {/* Scrollable grid area */}
        <div 
          className="picker-grid-container" 
          ref={scrollContainerRef}
          onScroll={handleScroll}
        >
          {sessionPhotos.length === 0 ? (
            <div className="picker-empty">{hasMultipleSessions && photos.length > 0
              ? 'Nu există poze încărcate în această ședință.'
              : 'Nu există poze încărcate în galeria clasei.'}</div>
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
                <div className="folder-navigation-row">
                  <button className="btn btn-secondary" onClick={() => setCurrentFolder(null)} style={{ padding: '6px 12px', fontSize: '12px' }}>
                    &larr; Înapoi la foldere
                  </button>
                  <span className="folder-name-title">Dosar curent: <strong>{currentFolderName}</strong></span>
                </div>
              )}
              <div className="picker-masonry">
                {currentPreviewList.map((photo) => {
                  const isSelected = localSelection.includes(photo.url);
                  return (
                    <div 
                      key={photo.path} 
                      className={`picker-photo-item ${isSelected ? 'selected' : ''}`}
                      onClick={() => {
                        setPreviewPhoto(photo);
                        setPreviewBw(localBwStates[photo.url] || false);
                      }}
                    >
                      <img 
                        src={(photo as any).thumbUrl || (photo as any).previewUrl || photo.url} 
                        alt={photo.name} 
                        className="picker-img"
                        loading="lazy"
                      />
                      <div className="picker-photo-overlay">
                        <div 
                          className="select-indicator"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelect(photo.url);
                          }}
                          title={isSelected ? "Elimină" : "Alege"}
                        >
                          {isSelected && <Check size={14} className="check-icon" />}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="picker-modal-footer">
          <span className="selection-count-text">
            {localSelection.length} poze selectate
          </span>
          <div className="footer-actions">
            <button onClick={onClose} className="btn btn-secondary">
              Anulează
            </button>
            <button 
              onClick={handleConfirm} 
              className="btn btn-primary"
              disabled={multiple && localSelection.length < minRequired}
            >
              Confirmă
            </button>
          </div>
        </div>
      </div>

      {previewPhoto && (
        <div className="zoom-lightbox-overlay" onClick={() => setPreviewPhoto(null)}>
          <div className="zoom-lightbox-card" onClick={(e) => e.stopPropagation()}>
            <button className="zoom-lightbox-close" onClick={() => setPreviewPhoto(null)}>
              <X size={24} />
            </button>

            {currentPreviewList.length > 1 && previewIndex !== -1 && (
              <div className="zoom-lightbox-counter">
                {previewIndex + 1} / {currentPreviewList.length}
              </div>
            )}

            <div
              className="zoom-lightbox-img-wrapper"
              onTouchStart={handlePreviewTouchStart}
              onTouchEnd={handlePreviewTouchEnd}
            >
              {currentPreviewList.length > 1 && (
                <button
                  className="zoom-lightbox-nav-btn zoom-lightbox-nav-prev"
                  onClick={() => navigatePreview(-1)}
                  aria-label="Poza anterioară"
                >
                  <ChevronLeft size={26} />
                </button>
              )}

              <img
                src={(previewPhoto as any).previewUrl || previewPhoto.url}
                alt={previewPhoto.name}
                className={`zoom-lightbox-img ${previewBw ? 'grayscale' : ''}`}
              />

              {currentPreviewList.length > 1 && (
                <button
                  className="zoom-lightbox-nav-btn zoom-lightbox-nav-next"
                  onClick={() => navigatePreview(1)}
                  aria-label="Poza următoare"
                >
                  <ChevronRight size={26} />
                </button>
              )}
            </div>
            <div className="zoom-lightbox-name">
              {previewPhoto.name}
            </div>
            <div className="zoom-lightbox-controls">
              <label className="bw-toggle-container-preview">
                <input
                  type="checkbox"
                  checked={previewBw}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setPreviewBw(checked);
                    setLocalBwStates(prev => ({ ...prev, [previewPhoto.url]: checked }));
                  }}
                />
                <span className="bw-checkbox-custom-preview"></span>
                <span className="bw-label-text-preview">Vizualizează Alb-Negru (B/W)</span>
              </label>

              <button
                className={`btn ${localSelection.includes(previewPhoto.url) ? 'btn-secondary' : 'btn-primary'}`}
                onClick={() => {
                  toggleSelect(previewPhoto.url);
                  // Single-selection fields behave as before (pick → close).
                  // For multi-selection, keep the preview open so the student
                  // can keep navigating and selecting without reopening it.
                  if (!multiple) {
                    setPreviewPhoto(null);
                  }
                }}
                style={{ padding: '10px 20px', fontSize: '13px', fontWeight: 600 }}
              >
                {localSelection.includes(previewPhoto.url) ? 'Elimină selecția' : 'Selectează această poză'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .picker-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(14, 13, 12, 0.85);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          animation: fadeInModal 0.25s ease-out;
        }

        .picker-modal-content {
          background-color: var(--card-bg);
          border: none;
          width: 100vw;
          max-width: 100vw;
          height: 100vh;
          border-radius: 0;
          display: flex;
          flex-direction: column;
          box-shadow: none;
          overflow: hidden;
        }

        .picker-modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 20px 24px;
          border-bottom: 1px solid var(--border-color);
        }

        .picker-modal-header h3 {
          font-size: 18px;
          font-family: var(--font-sans);
          font-weight: 600;
          color: var(--text-primary);
        }

        .picker-modal-subtitle {
          font-size: 12px;
          color: var(--text-secondary);
        }

        .picker-close-btn {
          background: none;
          border: none;
          color: var(--text-secondary);
          cursor: pointer;
          transition: color 0.15s;
        }

        @media (hover: hover) {
          .picker-close-btn:hover {
            color: var(--text-primary);
          }
        }

        /* Scroll Area with Masonry grid */
        .picker-grid-container {
          flex: 1;
          overflow-y: auto;
          padding: 24px;
          background-color: var(--bg-color);
        }

        .picker-masonry {
          column-count: 4;
          column-gap: 16px;
        }

        @media (max-width: 900px) {
          .picker-masonry {
            column-count: 3;
          }
        }
        @media (max-width: 600px) {
          .picker-masonry {
            column-count: 2;
          }
        }

        .picker-photo-item {
          break-inside: avoid;
          margin-bottom: 16px;
          position: relative;
          border-radius: var(--radius-sm);
          overflow: hidden;
          cursor: pointer;
          border: 2px solid transparent;
          transition: border-color 0.25s ease, transform 0.25s ease;
          background-color: var(--accent-light);
        }

        /* Hover-only styling is scoped to real hover-capable pointers (mouse/trackpad).
           On touch devices (iOS Safari in particular), a :hover rule that changes a
           tapped element's appearance makes the first tap only trigger the :hover
           state instead of the click — the tap then seems to silently do nothing and
           a second tap is needed. Gating these rules behind (hover: hover) keeps the
           desktop hover effect while removing that two-tap quirk on phones/tablets. */
        @media (hover: hover) {
          .picker-photo-item:hover {
            transform: scale(1.02);
          }
        }

        .picker-photo-item.selected {
          border-color: var(--gold-accent);
        }

        .picker-img {
          width: 100%;
          display: block;
          height: auto;
        }

        .picker-photo-overlay {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: transparent;
          opacity: 1;
          transition: background 0.2s ease;
          display: flex;
          align-items: flex-start;
          justify-content: flex-end;
          padding: 8px;
        }

        .picker-photo-item.selected .picker-photo-overlay {
          background: rgba(0, 0, 0, 0.1);
        }

        /* This is the overlay that actually sits on top of the photo and receives the
           tap on touch devices. It used to also restyle on ".picker-photo-item:hover",
           which is exactly the pattern that triggers iOS Safari's "first tap = hover"
           behaviour (see note above) — gated behind (hover: hover) so it only affects
           real hover pointers. */
        @media (hover: hover) {
          .picker-photo-item:hover .picker-photo-overlay {
            background: rgba(0, 0, 0, 0.1);
          }
        }

        .select-indicator {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          border: 1.5px solid #FFFFFF;
          background-color: rgba(0, 0, 0, 0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
          cursor: pointer;
        }

        .picker-photo-item.selected .select-indicator {
          background-color: var(--gold-accent);
          border-color: var(--gold-accent);
        }

        .check-icon {
          color: #FFFFFF;
        }

        .picker-empty {
          text-align: center;
          color: var(--text-secondary);
          padding: 60px 0;
        }

        /* Footer styling */
        .picker-modal-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 24px;
          border-top: 1px solid var(--border-color);
        }

        .selection-count-text {
          font-size: 13px;
          color: var(--text-secondary);
          font-weight: 500;
        }

        .footer-actions {
          display: flex;
          gap: 12px;
        }

        @keyframes fadeInModal {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        /* Zoom Lightbox style */
        .zoom-lightbox-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          height: 100dvh;
          background: rgba(14, 13, 12, 0.95);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          z-index: 1200;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          animation: fadeInModal 0.2s ease-out;
        }

        .zoom-lightbox-card {
          position: relative;
          background-color: #121110;
          border: none;
          border-radius: 0;
          max-width: 100vw;
          width: 100vw;
          height: 100vh;
          height: 100dvh;
          max-height: 100vh;
          max-height: 100dvh;
          display: flex;
          flex-direction: column;
          box-shadow: none;
          overflow: hidden;
          animation: fadeInModal 0.25s ease-out;
        }

        .zoom-lightbox-close {
          position: absolute;
          top: 16px;
          right: 16px;
          background: rgba(14, 13, 12, 0.6);
          border: none;
          color: #FFFFFF;
          width: 36px;
          height: 36px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          z-index: 100;
          transition: background-color 0.15s;
        }

        @media (hover: hover) {
          .zoom-lightbox-close:hover {
            background-color: rgba(14, 13, 12, 0.9);
          }
        }

        .zoom-lightbox-counter {
          position: absolute;
          top: 16px;
          left: 16px;
          background: rgba(14, 13, 12, 0.6);
          color: #FAF9F6;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.03em;
          padding: 7px 14px;
          border-radius: 999px;
          z-index: 100;
          pointer-events: none;
        }

        .zoom-lightbox-img-wrapper {
          position: relative;
          background-color: #0E0D0C;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 40px 24px;
          flex: 1;
          min-height: 0;
          overflow: hidden;
          touch-action: pan-y;
        }

        .zoom-lightbox-name {
          flex-shrink: 0;
          padding: 10px 24px 0;
          background-color: #121110;
          color: #FAF9F6;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.03em;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .zoom-lightbox-nav-btn {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          background: rgba(14, 13, 12, 0.6);
          border: none;
          color: #FFFFFF;
          width: 44px;
          height: 44px;
          min-width: 44px;
          min-height: 44px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          z-index: 90;
          transition: background-color 0.15s, transform 0.15s;
        }

        .zoom-lightbox-nav-btn:active {
          transform: translateY(-50%) scale(0.92);
          background-color: rgba(14, 13, 12, 0.85);
        }

        @media (hover: hover) {
          .zoom-lightbox-nav-btn:hover {
            background-color: var(--gold-accent);
          }
        }

        .zoom-lightbox-nav-prev {
          left: 12px;
        }

        .zoom-lightbox-nav-next {
          right: 12px;
        }

        @media (max-width: 600px) {
          .zoom-lightbox-nav-btn {
            width: 40px;
            height: 40px;
            min-width: 40px;
            min-height: 40px;
          }
        }

        .zoom-lightbox-img {
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
          border-radius: var(--radius-sm);
          transition: filter 0.3s ease;
        }

        .zoom-lightbox-img.grayscale {
          filter: grayscale(100%);
        }

        .zoom-lightbox-controls {
          padding: 20px 24px;
          border-top: 1px solid #262423;
          display: flex;
          justify-content: space-between;
          align-items: center;
          background-color: #121110;
          gap: 16px;
          flex-shrink: 0;
        }

        @media (max-width: 600px) {
          .zoom-lightbox-controls {
            flex-direction: column;
            align-items: stretch;
            gap: 10px;
            padding: 12px 16px;
            padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
          }
          .zoom-lightbox-controls .btn {
            width: 100%;
            min-height: 48px;
            justify-content: center;
          }
          .zoom-lightbox-img-wrapper {
            padding: 56px 12px 12px;
          }
          .zoom-lightbox-name {
            padding: 8px 16px 0;
          }
        }

        @media (max-height: 480px) and (orientation: landscape) {
          .zoom-lightbox-img-wrapper {
            padding: 8px 56px;
          }
          .zoom-lightbox-controls {
            flex-direction: row;
            align-items: center;
            padding: 8px 16px;
            padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px));
            gap: 12px;
          }
          .zoom-lightbox-controls .btn {
            width: auto;
            min-height: 44px;
          }
          .zoom-lightbox-name {
            padding-top: 4px;
          }
        }

        .zoom-preview-btn {
          position: absolute;
          bottom: 8px;
          left: 8px;
          background: rgba(14, 13, 12, 0.75);
          border: none;
          color: #FFFFFF;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: background-color 0.15s, transform 0.15s;
          opacity: 0.8;
        }

        .zoom-preview-btn:hover {
          background-color: var(--gold-accent);
          transform: scale(1.1);
          opacity: 1;
        }

        /* Checkbox preview toggler styling */
        .bw-toggle-container-preview {
          display: inline-flex;
          align-items: center;
          cursor: pointer;
          user-select: none;
          font-size: 13px;
          font-weight: 500;
          color: var(--text-secondary);
          gap: 10px;
        }

        .bw-toggle-container-preview input {
          position: absolute;
          opacity: 0;
          cursor: pointer;
          height: 0;
          width: 0;
        }

        .bw-checkbox-custom-preview {
          position: relative;
          height: 20px;
          width: 20px;
          background-color: transparent;
          border: 2px solid #363433;
          border-radius: var(--radius-xs);
          transition: all 0.2s;
        }

        .bw-toggle-container-preview input:checked ~ .bw-checkbox-custom-preview {
          background-color: var(--gold-accent);
          border-color: var(--gold-accent);
        }

        .bw-checkbox-custom-preview::after {
          content: "";
          position: absolute;
          display: none;
          left: 6px;
          top: 2px;
          width: 5px;
          height: 10px;
          border: solid white;
          border-width: 0 2px 2px 0;
          transform: rotate(45deg);
        }

        .bw-toggle-container-preview input:checked ~ .bw-checkbox-custom-preview::after {
          display: block;
        }

        .bw-label-text-preview {
          font-size: 13px;
          color: #FAF9F6;
        }

        /* Folder styles */
        .folders-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
          gap: 20px;
          padding: 24px;
        }

        .folder-card {
          background-color: #22201F;
          border: 1px solid #2D2A28;
          border-radius: var(--radius-sm);
          padding: 16px;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        @media (hover: hover) {
          .folder-card:hover {
            transform: translateY(-2px);
            border-color: var(--gold-accent);
            box-shadow: var(--shadow-md);
          }
        }

        .folder-cover {
          width: 100%;
          aspect-ratio: 4 / 3;
          border-radius: var(--radius-sm);
          overflow: hidden;
          background-color: #0F0E0D;
          margin-bottom: 10px;
        }
        .folder-cover img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .folder-icon-wrapper {
          color: var(--gold-accent);
          margin-bottom: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .folder-svg {
          width: 44px;
          height: 44px;
        }

        .folder-card-name {
          font-size: 13px;
          font-weight: 600;
          color: #FAF9F6;
          margin-bottom: 6px;
          word-break: break-all;
          line-height: 1.4;
        }

        .folder-card-count {
          font-size: 11px;
          color: #A3A09B;
        }

        .folder-navigation-row {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 16px 24px;
          background-color: #1A1A1A;
          border-bottom: 1px solid #2D2A28;
        }

        .folder-name-title {
          font-size: 14px;
          color: #FAF9F6;
        }

        /* Session tabs: same look as the folder tabs on photo galleries */
        .picker-session-bar {
          display: flex;
          gap: 24px;
          overflow-x: auto;
          padding: 0 24px;
          background-color: rgba(18, 17, 16, 0.95);
          border-bottom: 1px solid #262423;
          flex-shrink: 0;
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .picker-session-bar::-webkit-scrollbar {
          display: none;
        }
        .picker-session-tab {
          background: none;
          border: none;
          border-bottom: 2px solid transparent;
          color: #706E6A;
          font-family: inherit;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          padding: 14px 0 12px;
          cursor: pointer;
          transition: all 0.2s ease;
          white-space: nowrap;
          flex-shrink: 0;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .picker-session-tab.active {
          color: #FAF9F6;
          border-bottom-color: var(--gold-accent);
        }
        @media (hover: hover) {
          .picker-session-tab:not(.active):hover {
            color: #D8D0C8;
          }
        }
        .picker-session-badge {
          min-width: 18px;
          height: 18px;
          padding: 0 5px;
          border-radius: 9px;
          background-color: var(--gold-accent);
          color: #FFFFFF;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        @media (max-width: 600px) {
          .picker-session-bar {
            gap: 18px;
            padding: 0 16px;
          }
        }
      `}</style>
    </div>
  );
};

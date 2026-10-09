import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight, Trash2, RefreshCw, Folder, Image as ImageIcon, Upload, FolderUp, ArrowLeft } from 'lucide-react';
import type { ClassPhoto, ClassSession } from '../../utils/classPhotos';
import { photoSessionId, groupPhotosByFolder, shouldShowFolders } from '../../utils/classPhotos';
import { useBodyScrollLock } from '../../utils/useBodyScrollLock';

/**
 * Full-screen preview for a class's photo gallery. Opened from the narrow
 * side panel in AdminDashboard (the "Vezi toate" overflow tile) instead of
 * expanding that panel in place — a class can hold thousands of photos, and
 * dumping all of them into the side column made the page unusable.
 *
 * Reads the exact same state the side panel reads (`photos`, `sessions`,
 * `activeSessionId`) so uploads arriving through the live listener show up
 * here too, with no state of its own to keep in sync.
 */

interface ClassPhotosModalProps {
  className: string;
  galleryType?: 'flat' | 'folder';
  sessions: ClassSession[];
  activeSessionId: string;
  onChangeSession: (id: string) => void;
  photos: ClassPhoto[];
  isDeletingPhoto: string | null;
  onDeletePhoto: (photo: any) => void;
  onUploadFiles: (files: File[]) => void;
  onClose: () => void;
  /** Folder key (see groupPhotosByFolder) to open straight into. */
  initialFolder?: string;
}

const PAGE_SIZE = 60;

const photoKey = (p: any) => p.path || p.url || p.name;

export const ClassPhotosModal: React.FC<ClassPhotosModalProps> = ({
  className, galleryType, sessions, activeSessionId, onChangeSession,
  photos, isDeletingPhoto, onDeletePhoto, onUploadFiles, onClose, initialFolder,
}) => {
  const current = sessions.find(s => s.id === activeSessionId) || sessions[0];

  // Upload button in the header — opens the native file picker for the
  // session currently shown, then hands the files to the same upload
  // pipeline the side-panel form uses (AdminDashboard's uploadFilesToClass).
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const uploadFolderInputRef = useRef<HTMLInputElement | null>(null);
  const handleUploadInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) onUploadFiles(Array.from(files));
    // Reset so picking the exact same files again still fires onChange.
    e.target.value = '';
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    photos.forEach(p => { const id = photoSessionId(p, sessions); c[id] = (c[id] || 0) + 1; });
    return c;
  }, [photos, sessions]);

  // Photos of the active session, grouped by folder. When the session has
  // folders worth navigating, the root view shows folder cards and `flat` is
  // the photos of the opened folder only (so the viewer never leaves it).
  const [currentFolder, setCurrentFolder] = useState<string | null>(initialFolder ?? null);
  const firstSessionRun = useRef(true);
  useEffect(() => {
    if (firstSessionRun.current) { firstSessionRun.current = false; return; }
    setCurrentFolder(null);
  }, [current.id]);

  const { sessionPhotos, groups, showFolders } = useMemo(() => {
    const sp = sessions.length > 1
      ? photos.filter(p => photoSessionId(p, sessions) === current.id)
      : photos;
    const g = groupPhotosByFolder(sp);
    return { sessionPhotos: sp, groups: g, showFolders: shouldShowFolders(g) };
  }, [photos, sessions, current.id]);

  const openGroup = showFolders && currentFolder !== null
    ? groups.find(g => g.key === currentFolder) || null
    : null;
  // A folder that no longer exists (its last photo was deleted) falls back to the root view.
  useEffect(() => {
    if (showFolders && currentFolder !== null && !openGroup) setCurrentFolder(null);
  }, [showFolders, currentFolder, openGroup]);

  const flat = useMemo(
    () => (showFolders ? (openGroup ? openGroup.photos : []) : sessionPhotos),
    [showFolders, openGroup, sessionPhotos]
  );
  const inRoot = showFolders && !openGroup;

  // Incremental rendering: a class can carry up to ~20k photos, so the grid
  // starts small and grows as the admin scrolls near the bottom.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [current.id, currentFolder]);

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = bodyRef.current;
    if (!sentinel || !root) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        setVisibleCount(c => Math.min(flat.length, c + PAGE_SIZE));
      }
    }, { root, rootMargin: '600px 0px' });
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [flat.length, visibleCount]);

  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  // The grid overlay stays locked the whole time it's mounted; the viewer
  // adds a second, independent lock on top of it while it's open (the hook
  // counts locks, so closing one never unfreezes the page too early).
  useBodyScrollLock(true);
  useBodyScrollLock(viewerIndex !== null);

  // Esc closes the viewer first, then the modal. Arrow keys step through
  // the current session's photos while the viewer is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (viewerIndex !== null) {
        if (e.key === 'Escape') { e.preventDefault(); setViewerIndex(null); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); setViewerIndex(i => (i === null || flat.length === 0) ? i : (i - 1 + flat.length) % flat.length); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); setViewerIndex(i => (i === null || flat.length === 0) ? i : (i + 1) % flat.length); }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewerIndex, flat.length, onClose]);

  // Swipe left/right in the viewer — single finger only, ignores small or
  // mostly-vertical drags so a scroll gesture never gets read as a swipe.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const handleViewerTouchStart = (e: React.TouchEvent) => {
    touchStart.current = e.touches.length === 1
      ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
      : null;
  };
  const handleViewerTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || flat.length === 0) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) setViewerIndex(i => (i === null) ? i : (i + 1) % flat.length);
    else setViewerIndex(i => (i === null) ? i : (i - 1 + flat.length) % flat.length);
  };

  const renderTile = (photo: ClassPhoto, idx: number) => {
    const key = photoKey(photo);
    const isDeleting = isDeletingPhoto === key;
    return (
      <div key={key} className="cpm-tile" title={(photo as any).folder ? `${(photo as any).folder} / ${photo.name}` : photo.name}>
        <button type="button" className="cpm-tile-open" onClick={() => setViewerIndex(idx)} aria-label={`Deschide ${photo.name}`}>
          <img
            src={photo.thumbUrl || photo.previewUrl || photo.url || ''}
            alt={photo.name}
            loading="lazy"
            decoding="async"
            onError={(e) => { (e.target as HTMLElement).style.visibility = 'hidden'; }}
          />
        </button>
        <button
          type="button"
          className="cpm-tile-del"
          onClick={(e) => { e.stopPropagation(); onDeletePhoto(photo); }}
          disabled={isDeleting}
          title={`Șterge ${photo.name}`}
          aria-label={`Șterge ${photo.name}`}
        >
          {isDeleting
            ? <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} />
            : <X size={12} strokeWidth={2.2} />}
        </button>
      </div>
    );
  };

  let body: React.ReactNode;
  if (sessionPhotos.length === 0) {
    body = (
      <div className="ad-gallery-empty">
        <ImageIcon size={17} strokeWidth={1.4} />
        <span>Nicio poză în această ședință</span>
      </div>
    );
  } else if (inRoot) {
    body = (
      <div className="cpm-folders">
        {groups.map(g => (
          <button key={g.key} type="button" className="cpm-folder-card" onClick={() => setCurrentFolder(g.key)} title={g.name}>
            <span className="cpm-folder-cover">
              {g.cover
                ? <img src={g.cover} alt="" loading="lazy" decoding="async" onError={(e) => { (e.target as HTMLElement).style.visibility = 'hidden'; }} />
                : <Folder size={28} strokeWidth={1.2} />}
            </span>
            <span className="cpm-folder-name">{g.name}</span>
            <span className="cpm-folder-count">{g.photos.length} {g.photos.length === 1 ? 'poză' : 'poze'}</span>
          </button>
        ))}
      </div>
    );
  } else {
    body = (
      <div className="cpm-grid">
        {flat.slice(0, visibleCount).map((p, i) => renderTile(p, i))}
      </div>
    );
  }

  const viewerPhoto = viewerIndex !== null ? flat[viewerIndex] : null;

  return (
    <>
      <div className="cpm-overlay" onClick={onClose}>
        <div className="cpm-card" onClick={(e) => e.stopPropagation()}>
          <div className="cpm-header">
            <div className="cpm-header-main">
              <h3>{className}</h3>
              <span className="cpm-subtitle">
                {current.name}{openGroup ? ` • ${openGroup.name}` : ''} • {(inRoot ? sessionPhotos : flat).length} {(inRoot ? sessionPhotos : flat).length === 1 ? 'poză' : 'poze'}
              </span>
            </div>
            {sessions.length > 1 && (
              <div className="ad-session-bar cpm-tabs" role="tablist" aria-label="Ședințe foto">
                {sessions.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={s.id === current.id}
                    className={`ad-session-chip${s.id === current.id ? ' is-active' : ''}`}
                    onClick={() => onChangeSession(s.id)}
                    title={s.name}
                  >
                    <span className="ad-session-name">{s.name}</span>
                    <span className="ad-num ad-session-count">{counts[s.id] || 0}</span>
                  </button>
                ))}
              </div>
            )}
            {(() => {
              const folderBtn = (
                <button key="f" type="button" className="cpm-upload-btn" onClick={() => uploadFolderInputRef.current?.click()} title="Alege folder">
                  <FolderUp size={14} strokeWidth={1.6} />
                  <span className="cpm-upload-label">Alege folder</span>
                </button>
              );
              const photosBtn = (
                <button key="p" type="button" className="cpm-upload-btn" onClick={() => uploadInputRef.current?.click()} title="Alege poze">
                  <Upload size={14} strokeWidth={1.6} />
                  <span className="cpm-upload-label">Alege poze</span>
                </button>
              );
              return galleryType === 'folder' ? [folderBtn, photosBtn] : [photosBtn, folderBtn];
            })()}
            <input
              ref={uploadFolderInputRef}
              type="file"
              multiple
              {...({ webkitdirectory: '', directory: '' } as any)}
              onChange={handleUploadInputChange}
              style={{ display: 'none' }}
            />
            <input
              ref={uploadInputRef}
              type="file"
              multiple
              accept="image/*"
              onChange={handleUploadInputChange}
              style={{ display: 'none' }}
            />
            <button type="button" className="cpm-close" onClick={onClose} title="Închide" aria-label="Închide">
              <X size={20} strokeWidth={1.6} />
            </button>
          </div>

          <div className="cpm-body" ref={bodyRef}>
            {openGroup && (
              <button type="button" className="cpm-back" onClick={() => setCurrentFolder(null)}>
                <ArrowLeft size={14} strokeWidth={1.8} />
                <span>Toate folderele</span>
              </button>
            )}
            {body}
            {!inRoot && flat.length > 0 && visibleCount < flat.length && <div ref={sentinelRef} className="cpm-sentinel" />}
          </div>
        </div>
      </div>

      {viewerPhoto && viewerIndex !== null && (
        <div
          className="cpm-viewer"
          onClick={() => setViewerIndex(null)}
          onTouchStart={handleViewerTouchStart}
          onTouchEnd={handleViewerTouchEnd}
        >
          <button type="button" className="cpm-viewer-close" onClick={(e) => { e.stopPropagation(); setViewerIndex(null); }} title="Închide (Esc)" aria-label="Închide">
            <X size={22} strokeWidth={1.6} />
          </button>
          {flat.length > 1 && (
            <button
              type="button"
              className="cpm-viewer-arrow cpm-viewer-arrow-prev"
              onClick={(e) => { e.stopPropagation(); setViewerIndex(i => (i === null) ? i : (i - 1 + flat.length) % flat.length); }}
              title="Poza anterioară"
              aria-label="Poza anterioară"
            >
              <ChevronLeft size={26} strokeWidth={1.8} />
            </button>
          )}
          <div className="cpm-viewer-stage" onClick={(e) => e.stopPropagation()}>
            <img src={viewerPhoto.previewUrl || viewerPhoto.url || ''} alt={viewerPhoto.name} />
            <div className="cpm-viewer-meta">
              <span className="cpm-viewer-name" title={viewerPhoto.name}>{viewerPhoto.name}</span>
              <span className="cpm-viewer-counter">{viewerIndex + 1} / {flat.length}</span>
              <button
                type="button"
                className="cpm-viewer-del"
                onClick={(e) => { e.stopPropagation(); onDeletePhoto(viewerPhoto); }}
                disabled={isDeletingPhoto === photoKey(viewerPhoto)}
                title={`Șterge ${viewerPhoto.name}`}
                aria-label={`Șterge ${viewerPhoto.name}`}
              >
                {isDeletingPhoto === photoKey(viewerPhoto)
                  ? <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} />
                  : <Trash2 size={13} strokeWidth={1.6} />}
              </button>
            </div>
          </div>
          {flat.length > 1 && (
            <button
              type="button"
              className="cpm-viewer-arrow cpm-viewer-arrow-next"
              onClick={(e) => { e.stopPropagation(); setViewerIndex(i => (i === null) ? i : (i + 1) % flat.length); }}
              title="Poza următoare"
              aria-label="Poza următoare"
            >
              <ChevronRight size={26} strokeWidth={1.8} />
            </button>
          )}
        </div>
      )}

      <style>{`
        .cpm-overlay {
          position: fixed;
          inset: 0;
          background-color: rgba(14, 13, 12, 0.85);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          z-index: 1200;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 28px;
        }
        .cpm-card {
          background: var(--s-raised);
          border: 1px solid var(--s-line);
          border-radius: 10px;
          width: 100%;
          max-width: 1320px;
          height: 100%;
          max-height: 92vh;
          display: flex;
          flex-direction: column;
          box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
          overflow: hidden;
        }
        .cpm-header {
          display: flex;
          align-items: flex-start;
          gap: 16px;
          padding: 16px 20px;
          background: var(--s-overlay);
          border-bottom: 1px solid var(--s-line);
          flex-wrap: wrap;
        }
        .cpm-header-main { min-width: 0; margin-right: auto; }
        .cpm-header-main h3 {
          margin: 0;
          font-size: 16px;
          font-weight: 500;
          color: var(--t-hi);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .cpm-subtitle { display: block; margin-top: 3px; font-size: 12px; color: var(--t-muted); }
        .cpm-tabs { flex: 1 1 100%; order: 3; margin: 0; }
        .cpm-upload-btn {
          display: flex;
          align-items: center;
          gap: 7px;
          height: 30px;
          padding: 0 12px;
          background: var(--a-data-soft);
          border: 1px solid var(--a-data-line);
          border-radius: 8px;
          color: var(--t-hi);
          font-family: inherit;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          flex-shrink: 0;
          white-space: nowrap;
          transition: background-color 0.15s, border-color 0.15s;
        }
        .cpm-upload-btn:hover { background: var(--s-line); border-color: var(--s-line-strong); }
        .cpm-upload-btn:focus-visible { outline: 2px solid var(--a-data); outline-offset: 2px; }
        .cpm-close {
          background: none;
          border: 1px solid var(--s-line);
          color: var(--t-lo);
          width: 30px;
          height: 30px;
          border-radius: 8px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: color 0.15s, border-color 0.15s, background-color 0.15s;
        }
        .cpm-close:hover { color: var(--t-hi); border-color: var(--s-line-strong); background: var(--s-line); }
        .cpm-close:focus-visible { outline: 2px solid var(--a-data); outline-offset: 2px; }

        .cpm-body {
          flex: 1;
          overflow-y: auto;
          padding: 20px;
          background: var(--s-canvas);
        }
        .cpm-back {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          height: 30px;
          padding: 0 12px;
          margin-bottom: 14px;
          background: var(--s-overlay);
          border: 1px solid var(--s-line);
          border-radius: 8px;
          color: var(--t-hi);
          font-family: inherit;
          font-size: 12px;
          cursor: pointer;
          transition: background-color 0.15s, border-color 0.15s;
        }
        .cpm-back:hover { background: var(--s-line); border-color: var(--s-line-strong); }
        .cpm-back:focus-visible { outline: 2px solid var(--a-data); outline-offset: 2px; }
        .cpm-folders {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          gap: 12px;
        }
        .cpm-folder-card {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 0 0 10px;
          text-align: left;
          background: var(--s-raised);
          border: 1px solid var(--s-line);
          border-radius: 9px;
          overflow: hidden;
          cursor: pointer;
          font-family: inherit;
          color: var(--t-hi);
          transition: border-color 0.15s, background-color 0.15s;
        }
        .cpm-folder-card:hover { border-color: var(--s-line-strong); background: var(--s-overlay); }
        .cpm-folder-card:focus-visible { outline: 2px solid var(--a-data); outline-offset: 2px; }
        .cpm-folder-cover {
          display: flex;
          align-items: center;
          justify-content: center;
          aspect-ratio: 3 / 4;
          background: var(--s-sunken);
          color: var(--t-muted);
          margin-bottom: 6px;
        }
        .cpm-folder-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .cpm-folder-name {
          padding: 0 12px;
          font-size: 13px;
          font-weight: 500;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .cpm-folder-count { padding: 0 12px; font-size: 11.5px; color: var(--t-muted); }

        .cpm-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          gap: 10px;
        }
        .cpm-tile {
          position: relative;
          aspect-ratio: 3 / 4;
          border-radius: 9px;
          overflow: hidden;
          background: var(--s-sunken);
          box-shadow: inset 0 1px 0 rgba(243, 237, 231, 0.05);
        }
        .cpm-tile-open {
          display: block;
          width: 100%;
          height: 100%;
          padding: 0;
          border: none;
          background: none;
          cursor: pointer;
        }
        .cpm-tile-open img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .cpm-tile-del {
          position: absolute;
          top: 6px;
          right: 6px;
          width: 24px;
          height: 24px;
          border-radius: 7px;
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(14, 13, 12, 0.72);
          backdrop-filter: blur(6px);
          color: var(--t-mid);
          opacity: 0;
          transform: scale(0.9);
          transition: opacity 0.15s ease, transform 0.15s ease, background-color 0.15s, color 0.15s;
        }
        .cpm-tile:hover .cpm-tile-del,
        .cpm-tile-del:focus-visible { opacity: 1; transform: scale(1); }
        .cpm-tile-del:hover { background: var(--st-bad); color: #131211; }
        .cpm-tile-del:focus-visible { outline: 2px solid var(--a-data); outline-offset: 1px; }
        .cpm-tile-del:disabled { opacity: 1; cursor: default; }
        .cpm-sentinel { height: 1px; }

        /* Touch devices have no hover — the delete button stays visible. */
        @media (hover: none) {
          .cpm-tile-del { opacity: 1; transform: none; }
        }
        @media (max-width: 640px) {
          .cpm-overlay { padding: 0; }
          .cpm-card { max-width: none; max-height: none; height: 100%; border-radius: 0; }
          .cpm-grid { grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 6px; }
          .cpm-folders { grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; }
          .cpm-body { padding: 14px; }
          .cpm-upload-btn { width: 30px; padding: 0; justify-content: center; }
          .cpm-upload-label { display: none; }
        }

        /* Single-photo viewer, stacked on top of the grid modal */
        .cpm-viewer {
          position: fixed;
          inset: 0;
          background-color: rgba(8, 7, 7, 0.94);
          z-index: 1300;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
        }
        .cpm-viewer-stage {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 14px;
          max-width: calc(100vw - 140px);
          max-height: 100%;
        }
        .cpm-viewer-stage img {
          max-width: 100%;
          max-height: calc(100vh - 140px);
          object-fit: contain;
          border-radius: 6px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
        }
        .cpm-viewer-meta {
          display: flex;
          align-items: center;
          gap: 14px;
          max-width: 100%;
          color: var(--t-lo);
          font-size: 12.5px;
        }
        .cpm-viewer-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 50vw;
          color: var(--t-hi);
        }
        .cpm-viewer-counter { flex-shrink: 0; font-variant-numeric: tabular-nums; color: var(--t-muted); }
        .cpm-viewer-del {
          flex-shrink: 0;
          width: 28px;
          height: 28px;
          border-radius: 7px;
          border: 1px solid var(--s-line);
          background: var(--s-overlay);
          color: var(--t-lo);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: color 0.15s, border-color 0.15s, background-color 0.15s;
        }
        .cpm-viewer-del:hover { color: #131211; background: var(--st-bad); border-color: var(--st-bad); }
        .cpm-viewer-del:disabled { opacity: 0.7; cursor: default; }
        .cpm-viewer-close {
          position: absolute;
          top: 18px;
          right: 18px;
          width: 38px;
          height: 38px;
          border-radius: 50%;
          border: 1px solid var(--s-line);
          background: rgba(22, 21, 20, 0.8);
          color: var(--t-hi);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .cpm-viewer-close:hover { background: var(--s-line); }
        .cpm-viewer-arrow {
          flex-shrink: 0;
          width: 48px;
          height: 48px;
          border-radius: 50%;
          border: 1px solid var(--s-line);
          background: rgba(22, 21, 20, 0.8);
          color: var(--t-hi);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background-color 0.15s, border-color 0.15s;
        }
        .cpm-viewer-arrow:hover { background: var(--s-line); border-color: var(--s-line-strong); }
        @media (max-width: 640px) {
          .cpm-viewer { padding: 10px; }
          .cpm-viewer-stage { max-width: 100vw; gap: 10px; }
          .cpm-viewer-stage img { max-height: calc(100vh - 110px); }
          .cpm-viewer-arrow { display: none; }
          .cpm-viewer-name { max-width: 60vw; }
        }
      `}</style>
    </>
  );
};

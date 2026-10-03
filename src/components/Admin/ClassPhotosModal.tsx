import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight, Trash2, RefreshCw, Folder, Image as ImageIcon } from 'lucide-react';
import type { ClassPhoto, ClassSession } from '../../utils/classPhotos';
import { photoSessionId } from '../../utils/classPhotos';
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
  onClose: () => void;
}

const PAGE_SIZE = 60;

const photoKey = (p: any) => p.path || p.url || p.name;

export const ClassPhotosModal: React.FC<ClassPhotosModalProps> = ({
  className, galleryType, sessions, activeSessionId, onChangeSession,
  photos, isDeletingPhoto, onDeletePhoto, onClose,
}) => {
  const current = sessions.find(s => s.id === activeSessionId) || sessions[0];

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    photos.forEach(p => { const id = photoSessionId(p, sessions); c[id] = (c[id] || 0) + 1; });
    return c;
  }, [photos, sessions]);

  // Photos of the active session, in the exact order the grid shows them —
  // grouped by folder (in folder order) when the class uses folders, so the
  // single-photo viewer can navigate over that same order.
  const { flat, groups } = useMemo(() => {
    const sessionPhotos = sessions.length > 1
      ? photos.filter(p => photoSessionId(p, sessions) === current.id)
      : photos;
    if (galleryType !== 'folder') {
      return { flat: sessionPhotos, groups: null as null | { name: string; photos: ClassPhoto[] }[] };
    }
    const order: string[] = [];
    const map: Record<string, ClassPhoto[]> = {};
    sessionPhotos.forEach(p => {
      const f = (p as any).folder || 'Fără folder';
      if (!map[f]) { map[f] = []; order.push(f); }
      map[f].push(p);
    });
    const groupsArr = order.map(name => ({ name, photos: map[name] }));
    return { flat: groupsArr.flatMap(g => g.photos), groups: groupsArr };
  }, [photos, sessions, current.id, galleryType]);

  // Incremental rendering: a class can carry up to ~20k photos, so the grid
  // starts small and grows as the admin scrolls near the bottom.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [current.id]);

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

  // Slice the groups (or the flat list) down to `visibleCount`, keeping
  // folder order intact so growing the count never reshuffles tiles already shown.
  let body: React.ReactNode;
  if (flat.length === 0) {
    body = (
      <div className="ad-gallery-empty">
        <ImageIcon size={17} strokeWidth={1.4} />
        <span>Nicio poză în această ședință</span>
      </div>
    );
  } else if (groups) {
    let budget = visibleCount;
    let runningIdx = 0;
    body = groups.map(g => {
      const startIdx = runningIdx;
      runningIdx += g.photos.length;
      if (budget <= 0) return null;
      const take = g.photos.slice(0, budget);
      budget -= take.length;
      return (
        <div key={g.name} className="cpm-folder-group">
          <div className="ad-photo-folder-head">
            <Folder size={12} strokeWidth={1.4} />
            <span>{g.name}</span>
            <span className="ad-num">{g.photos.length}</span>
          </div>
          <div className="cpm-grid">
            {take.map((p, i) => renderTile(p, startIdx + i))}
          </div>
        </div>
      );
    });
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
              <span className="cpm-subtitle">{current.name} • {flat.length} {flat.length === 1 ? 'poză' : 'poze'}</span>
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
            <button type="button" className="cpm-close" onClick={onClose} title="Închide" aria-label="Închide">
              <X size={20} strokeWidth={1.6} />
            </button>
          </div>

          <div className="cpm-body" ref={bodyRef}>
            {body}
            {flat.length > 0 && visibleCount < flat.length && <div ref={sentinelRef} className="cpm-sentinel" />}
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
        .cpm-folder-group { margin-bottom: 18px; }
        .cpm-folder-group:last-child { margin-bottom: 0; }

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
          .cpm-body { padding: 14px; }
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

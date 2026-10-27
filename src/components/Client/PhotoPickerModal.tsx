import React, { useEffect, useRef, useState } from 'react';
import { X, Check, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Square, LayoutGrid, Search } from 'lucide-react';
import { useBodyScrollLock } from '../../utils/useBodyScrollLock';
import { getPhotoDisplayName } from '../../utils/photoName';
import { useSwipe } from '../../utils/useSwipe';
import { normalizeSearch, matchesSearch, compareNames } from '../../utils/photoSearch';
import { photoSessionId, groupPhotosByFolder, shouldShowFolders, LOOSE_FOLDER_KEY } from '../../utils/classPhotos';
import type { ClassSession } from '../../utils/classPhotos';
import { distributePhotos, useResponsiveColumns } from '../../utils/galleryGrid';

interface Photo {
  name: string;
  url: string;
  path: string;
  folder?: string;
  sessionId?: string;
  /** Original pixel size stored at upload; absent on older photos. */
  width?: number;
  height?: number;
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
  /** Upper limit the form already enforces on submit; shown here and blocks Confirm above it. */
  maxAllowed?: number;
  fieldKey: string;
  /** Photo sessions of the class. Tabs appear only when there is more than one. */
  sessions?: ClassSession[];
  /** Header title (defaults to "Selectează Poze"); e.g. "Pagina extra 2". */
  title?: string;
}

// Global scroll memory store
const scrollMemory: Record<string, number> = {};
// Last session viewed per field, so the restored scroll lands in the same list.
const sessionMemory: Record<string, string> = {};

// Phone view-size choice: 'large' = one near full-width column, 'grid' = two columns.
type ViewMode = 'large' | 'grid';
const VIEW_MODE_KEY = 'pickerViewMode';
const readViewMode = (): ViewMode => {
  try {
    return localStorage.getItem(VIEW_MODE_KEY) === 'large' ? 'large' : 'grid';
  } catch {
    return 'grid';
  }
};

// View-only ordering: 'default' keeps the order the photographer set.
type SortMode = 'default' | 'az' | 'za';

/** Name students see and quote ("IMG_1234"): the file name without its extension. */
const photoLabel = (photo: { name?: string; url?: string } | string): string =>
  getPhotoDisplayName(photo).replace(/\.[A-Za-z0-9]{2,5}$/, '');

export const PhotoPickerModal: React.FC<PhotoPickerModalProps> = ({
  isOpen,
  onClose,
  photos,
  selectedPhotos,
  onConfirm,
  multiple = false,
  minRequired = 1,
  maxAllowed,
  fieldKey,
  sessions,
  title
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

  // View-only search and sort (local to the picker; the admin's order stays the
  // default). Search at the folder-cards level looks through the whole session and
  // shows a flat result grid; inside a folder it filters that folder.
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('default');
  const nq = React.useMemo(() => normalizeSearch(query), [query]);
  const searching = nq.length > 0;
  const atFolderCards = hasFolders && currentFolder === null;

  const sortPhotos = React.useCallback((list: Photo[]): Photo[] => {
    if (sortMode === 'default') return list;
    const sorted = [...list].sort((a, b) => compareNames(getPhotoDisplayName(a), getPhotoDisplayName(b)));
    return sortMode === 'za' ? sorted.reverse() : sorted;
  }, [sortMode]);

  // Folder cards in the chosen order; "Poze generale" always stays last.
  const shownFolders = React.useMemo(() => {
    if (sortMode === 'default') return folderList;
    const named = folderList.filter(g => g.key !== LOOSE_FOLDER_KEY).sort((a, b) => compareNames(a.name, b.name));
    if (sortMode === 'za') named.reverse();
    return [...named, ...folderList.filter(g => g.key === LOOSE_FOLDER_KEY)];
  }, [folderList, sortMode]);

  const folderNameByPath = React.useMemo(() => {
    const m = new Map<string, string>();
    folderList.forEach(g => g.photos.forEach(p => m.set(p.path, g.name)));
    return m;
  }, [folderList]);

  // The list the student is currently browsing in the grid: the current folder's
  // photos when inside a folder, otherwise the selected session's full list; then
  // filtered by the search and sorted. Preview navigation walks this.
  const currentPreviewList = React.useMemo(() => {
    const base = hasFolders && currentFolder !== null
      ? (folderGroups[currentFolder] || [])
      : (atFolderCards && searching ? shownFolders.flatMap(g => g.photos) : sessionPhotos);
    const filtered = searching ? base.filter(p => matchesSearch(photoLabel(p), nq)) : base;
    // Folder-grouped search results keep folder order unless the student sorted by name.
    return sortPhotos(filtered);
  }, [hasFolders, currentFolder, folderGroups, sessionPhotos, atFolderCards, searching, shownFolders, nq, sortPhotos]);
  const showFolderOnTiles = atFolderCards && searching;

  // Grid layout: photos dealt out over the columns in order, each tile reserving
  // its height from the aspect ratio. Same ladder as before (4 / 3 / 2 columns).
  // Column assignment ignores measured ratios so it never reshuffles on load.
  const [aspectRatios, setAspectRatios] = useState<Record<string, number>>({});
  // On phones (<= 600px, i.e. the 2-column rung) the student picks "Mare" (1 column)
  // or "Grilă" (2 columns). Wider screens keep the 3 / 4 column ladder.
  const baseColumns = useResponsiveColumns('regular');
  const isPhone = baseColumns <= 2;
  const [viewMode, setViewMode] = useState<ViewMode>(readViewMode);
  const changeViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    try { localStorage.setItem(VIEW_MODE_KEY, mode); } catch { /* storage unavailable */ }
  };
  const largeView = isPhone && viewMode === 'large';
  const columnsCount = isPhone ? (largeView ? 1 : 2) : Math.min(4, baseColumns);
  const [showSelected, setShowSelected] = useState(false);
  const gridColumns = React.useMemo(
    () => distributePhotos(currentPreviewList, columnsCount),
    [currentPreviewList, columnsCount]
  );

  const previewIndex = previewPhoto
    ? currentPreviewList.findIndex(p => p.url === previewPhoto.url)
    : -1;

  const getPreviewSrc = (photo: Photo) => (photo as any).previewUrl || photo.url;

  // Selected photos (any session / folder) in selection order, for the "Selectate" tray.
  const selectedItems = React.useMemo(() => {
    const byUrl = new Map<string, Photo>();
    photos.forEach(p => byUrl.set(p.url, p));
    return localSelection.map(url => byUrl.get(url) || ({ name: '', url, path: url } as Photo));
  }, [photos, localSelection]);

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

  // Swipe-to-navigate on touch devices, on the whole zoom overlay.
  const previewSwipe = useSwipe(() => navigatePreview(1), () => navigatePreview(-1));

  // Initialize local selection once per opening. selectedPhotos is a fresh array on
  // every parent render, so depending on it would wipe the student's in-progress
  // picks (and bounce them out of the folder) whenever the parent re-rendered.
  useEffect(() => {
    if (isOpen) {
      setLocalSelection(selectedPhotos.map(p => p.url));
      const bws: Record<string, boolean> = {};
      selectedPhotos.forEach(p => {
        bws[p.url] = p.bw;
      });
      setLocalBwStates(bws);
      setCurrentFolder(null);
      setShowSelected(false);
      setQuery('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleSessionSelect = (sessionId: string) => {
    if (sessionId === effectiveSessionId) return;
    setActiveSessionId(sessionId);
    sessionMemory[fieldKey] = sessionId;
    setCurrentFolder(null);
    setPreviewPhoto(null);
    setQuery('');
    scrollMemory[fieldKey] = 0;
    if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
  };

  // Entering / leaving a folder starts at the top of the scroll area (and a fresh search).
  const goToFolder = (key: string | null) => {
    setCurrentFolder(key);
    setQuery('');
    scrollMemory[fieldKey] = 0;
    if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
  };

  // A new search or sort order starts from the top of the results.
  const resetScrollTop = () => {
    scrollMemory[fieldKey] = 0;
    if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
  };
  const changeQuery = (value: string) => { setQuery(value); resetScrollTop(); };
  const changeSort = (mode: SortMode) => { setSortMode(mode); resetScrollTop(); };

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

  const overMax = multiple && !!maxAllowed && localSelection.length > maxAllowed;

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
          <div className="picker-header-text">
            <h3>{title || 'Selectează Poze'}</h3>
            <p className="picker-modal-subtitle">
              {multiple
                ? (minRequired <= 0
                    ? `Alege poze (opțional${maxAllowed ? `, maxim ${maxAllowed}` : ''})`
                    : `Alege poze (minim ${minRequired}${maxAllowed ? `, maxim ${maxAllowed}` : ''})`)
                : 'Alege o singură poză'
              }
            </p>
          </div>
          {isPhone && sessionPhotos.length > 0 && (
            <div className="picker-view-toggle" role="group" aria-label="Mărime poze">
              <button
                type="button"
                className={largeView ? 'active' : ''}
                aria-pressed={largeView}
                onClick={() => changeViewMode('large')}
              >
                <Square size={14} /> Mare
              </button>
              <button
                type="button"
                className={!largeView ? 'active' : ''}
                aria-pressed={!largeView}
                onClick={() => changeViewMode('grid')}
              >
                <LayoutGrid size={14} /> Grilă
              </button>
            </div>
          )}
          <button onClick={onClose} className="picker-close-btn" aria-label="Închide">
            <X size={22} />
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

        {/* Slim search + sort row (view-only). Fixed like the header: outside the scroller. */}
        {sessionPhotos.length > 0 && (
          <div className="picker-tools">
            <div className="picker-search">
              <Search size={16} className="picker-search-icon" aria-hidden="true" />
              <input
                type="text"
                className="picker-search-input"
                value={query}
                onChange={(e) => changeQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  else if (e.key === 'Escape' && query) { e.preventDefault(); changeQuery(''); }
                }}
                placeholder="Caută după numele pozei…"
                aria-label="Caută după numele pozei"
                enterKeyHint="search"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
              />
              {query && (
                <button type="button" className="picker-search-clear" onClick={() => changeQuery('')} aria-label="Șterge căutarea">
                  <X size={16} />
                </button>
              )}
            </div>
            <select
              className="picker-sort-select"
              value={sortMode}
              onChange={(e) => changeSort(e.target.value as SortMode)}
              aria-label="Ordine poze"
            >
              <option value="default">Implicit</option>
              <option value="az">A–Z</option>
              <option value="za">Z–A</option>
            </select>
          </div>
        )}

        {/* Scrollable middle area: the ONLY scroller (header above and action bar below stay put) */}
        <div
          className="picker-grid-container"
          ref={scrollContainerRef}
          onScroll={handleScroll}
        >
          {sessionPhotos.length === 0 ? (
            <div className="picker-empty">{hasMultipleSessions && photos.length > 0
              ? 'Nu există poze încărcate în această ședință.'
              : 'Nu există poze încărcate în galeria clasei.'}</div>
          ) : atFolderCards && !searching ? (
            <div className="picker-body">
              <div className="folders-grid">
                {shownFolders.map(g => (
                  <div
                    key={g.key}
                    className="folder-card"
                    onClick={() => goToFolder(g.key)}
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
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              {hasFolders && currentFolder !== null && (
                <div className="folder-navigation-row">
                  <button type="button" className="folder-back-btn" onClick={() => goToFolder(null)}>
                    <ChevronLeft size={18} /> Înapoi la foldere
                  </button>
                  <span className="folder-name-title" title={currentFolderName}>{currentFolderName}</span>
                </div>
              )}
              {searching && currentPreviewList.length === 0 ? (
                <div className="picker-empty">Niciun rezultat</div>
              ) : (
              <div className={`picker-body${largeView ? ' picker-body-large' : ''}`}>
                <div className="picker-masonry">
                  {gridColumns.map((col, colIdx) => (
                    <div key={colIdx} className="picker-masonry-col">
                      {col.map((photo) => {
                        const isSelected = localSelection.includes(photo.url);
                        const isBw = isSelected && !!localBwStates[photo.url];
                        const label = photoLabel(photo);
                        const tileAspect = photo.width && photo.height
                          ? photo.width / photo.height
                          : (aspectRatios[photo.path] || 4 / 3);
                        const p = photo as any;
                        const tileSrc = largeView
                          ? (p.previewUrl || p.thumbUrl || photo.url)
                          : (p.thumbUrl || p.previewUrl || photo.url);
                        return (
                          <div
                            key={photo.path}
                            className={`picker-photo-item${isSelected ? ' selected' : ''}${isBw ? ' bw' : ''}`}
                            style={{ aspectRatio: String(tileAspect) }}
                            onClick={() => {
                              setPreviewPhoto(photo);
                              setPreviewBw(localBwStates[photo.url] || false);
                            }}
                          >
                            <img
                              src={tileSrc}
                              alt={label}
                              className="picker-img"
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
                            {isBw && <span className="picker-bw-chip">B/W</span>}
                            {label && (
                              <div className="picker-photo-name" title={label}>
                                {label}
                                {showFolderOnTiles && folderNameByPath.get(photo.path) && (
                                  <small className="picker-photo-folder">{folderNameByPath.get(photo.path)}</small>
                                )}
                              </div>
                            )}
                            <button
                              type="button"
                              className="select-hit"
                              aria-pressed={isSelected}
                              aria-label={isSelected ? `Elimină ${label}` : `Alege ${label}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleSelect(photo.url);
                              }}
                            >
                              <span className="select-indicator">
                                {isSelected && <Check size={16} strokeWidth={3} className="check-icon" />}
                              </span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
              )}
            </>
          )}
        </div>

        {/* "Selectate" tray: the student's own picks with their file names */}
        {multiple && showSelected && selectedItems.length > 0 && (
          <div className="picker-selected-tray">
            <ul>
              {selectedItems.map(item => {
                const label = photoLabel(item) || 'poză';
                const p = item as any;
                return (
                  <li key={item.url}>
                    <img src={p.thumbUrl || p.previewUrl || item.url} alt="" loading="lazy" decoding="async" />
                    <span className="picker-selected-name" title={label}>{label}</span>
                    {localBwStates[item.url] && <span className="picker-selected-bw">B/W</span>}
                    <button
                      type="button"
                      className="picker-selected-remove"
                      aria-label={`Elimină ${label}`}
                      onClick={() => toggleSelect(item.url)}
                    >
                      <X size={18} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Fixed action bar: always visible, safe-area aware */}
        <div className="picker-modal-footer">
          <div className="picker-footer-status">
            <span className={`selection-count-text${multiple && (localSelection.length < minRequired || overMax) ? ' warn' : ''}`}>
              {multiple
                ? (localSelection.length < minRequired
                    ? `${localSelection.length} / min. ${minRequired} selectate`
                    : overMax
                      ? `${localSelection.length} selectate - maxim ${maxAllowed}`
                      : (minRequired <= 0
                          ? `${localSelection.length} selectate${maxAllowed ? ` (max. ${maxAllowed})` : ''}`
                          : `${localSelection.length} selectate (min. ${minRequired}${maxAllowed ? `, max. ${maxAllowed}` : ''})`))
                : (selectedItems.length > 0
                    ? `Selectată: ${photoLabel(selectedItems[0]) || 'poza aleasă'}`
                    : 'Nicio poză selectată')}
            </span>
            {multiple && selectedItems.length > 0 && (
              <button
                type="button"
                className="picker-selected-toggle"
                aria-expanded={showSelected}
                onClick={() => setShowSelected(v => !v)}
              >
                Selectate {showSelected ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
              </button>
            )}
          </div>
          <div className="footer-actions">
            <button onClick={onClose} className="btn btn-secondary">
              Anulează
            </button>
            <button
              onClick={handleConfirm}
              className="btn btn-primary"
              disabled={multiple && (localSelection.length < minRequired || overMax)}
            >
              Confirmă
            </button>
          </div>
        </div>
      </div>

      {previewPhoto && (
        <div className="zoom-lightbox-overlay" onClick={() => setPreviewPhoto(null)} {...previewSwipe}>
          <div className="zoom-lightbox-card" onClick={(e) => e.stopPropagation()}>
            <button className="zoom-lightbox-close" onClick={() => setPreviewPhoto(null)}>
              <X size={24} />
            </button>

            <div className="zoom-lightbox-img-wrapper">
              {previewIndex !== -1 && currentPreviewList.length > 1 && (
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
                alt={photoLabel(previewPhoto)}
                className={`zoom-lightbox-img ${previewBw ? 'grayscale' : ''}`}
              />

              {previewIndex !== -1 && currentPreviewList.length > 1 && (
                <button
                  className="zoom-lightbox-nav-btn zoom-lightbox-nav-next"
                  onClick={() => navigatePreview(1)}
                  aria-label="Poza următoare"
                >
                  <ChevronRight size={26} />
                </button>
              )}
            </div>
            <div className="zoom-lightbox-name" title={photoLabel(previewPhoto)}>
              <span className="zoom-lightbox-name-text">{photoLabel(previewPhoto)}</span>
              {localSelection.includes(previewPhoto.url) && <span className="zoom-lightbox-name-tag">selectată</span>}
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
        /* Full-screen layout: overlay pinned to the visual viewport (inset: 0 follows
           iOS Safari's dynamic toolbar), content is a flex column — fixed header,
           ONE scrolling middle area, fixed action bar. The page never scrolls. */
        .picker-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          width: 100%;
          height: 100vh;   /* fallback */
          height: 100dvh;
          background: rgba(14, 13, 12, 0.85);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          z-index: 1000;
          display: flex;
          align-items: stretch;
          justify-content: center;
          padding: 0;
          overscroll-behavior: none;
          animation: fadeInModal 0.25s ease-out;
        }

        .picker-modal-content {
          background-color: var(--card-bg);
          border: none;
          width: 100%;
          max-width: 100vw;
          height: 100%;
          min-height: 0;
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
          gap: 12px;
          flex-shrink: 0;
          padding: 16px 24px;
          border-bottom: 1px solid var(--border-color);
        }

        .picker-header-text {
          flex: 1 1 auto;
          min-width: 0;
        }

        .picker-modal-header h3 {
          font-size: 18px;
          font-family: var(--font-sans);
          font-weight: 600;
          color: var(--text-primary);
          margin: 0;
        }

        .picker-modal-subtitle {
          font-size: 13px;
          color: var(--text-secondary);
          margin: 2px 0 0;
        }

        .picker-close-btn {
          background: none;
          border: none;
          color: var(--text-secondary);
          cursor: pointer;
          transition: color 0.15s;
          width: 44px;
          height: 44px;
          margin: -8px -10px -8px 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        @media (hover: hover) {
          .picker-close-btn:hover {
            color: var(--text-primary);
          }
        }

        /* "Mare" / "Grilă" view-size toggle (phones only) */
        .picker-view-toggle {
          display: inline-flex;
          flex-shrink: 0;
          border: 1px solid var(--border-color);
          border-radius: 999px;
          overflow: hidden;
        }
        .picker-view-toggle button {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          min-height: 36px;
          padding: 0 14px;
          background: transparent;
          border: none;
          color: var(--text-secondary);
          font-family: inherit;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }
        .picker-view-toggle button.active {
          background: var(--text-primary);
          color: var(--bg-color);
        }

        /* Scroll area: the only scroller. min-height: 0 lets the flex child shrink
           so the action bar below can never be pushed off screen. */
        .picker-grid-container {
          flex: 1 1 0;
          min-height: 0;
          overflow-y: auto;
          overflow-x: hidden;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
          background-color: var(--bg-color);
        }

        .picker-body {
          padding: 24px;
        }

        /* Flex columns filled in photo order (galleryGrid.ts), so numbering reads
           left-to-right; tiles reserve their height via aspect-ratio. */
        .picker-masonry {
          display: flex;
          align-items: flex-start;
          gap: 16px;
        }

        .picker-masonry-col {
          flex: 1 1 0;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .picker-photo-item {
          width: 100%;
          box-sizing: border-box;
          flex-shrink: 0;
          position: relative;
          border-radius: var(--radius-sm);
          overflow: hidden;
          cursor: pointer;
          transition: transform 0.25s ease;
          background-color: var(--accent-light);
          -webkit-tap-highlight-color: transparent;
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

        /* Selected: clear cream ring + slight tint (drawn above the image, no layout change) */
        .picker-photo-item.selected::after {
          content: "";
          position: absolute;
          inset: 0;
          border: 3px solid #F3EDE7;
          border-radius: inherit;
          box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.35);
          background: rgba(0, 0, 0, 0.12);
          pointer-events: none;
        }

        .picker-img {
          width: 100%;
          height: 100%;
          display: block;
          object-fit: cover;
        }

        .picker-photo-item.bw .picker-img {
          filter: grayscale(100%);
        }

        /* File name, small and unobtrusive, over a bottom gradient */
        .picker-photo-name {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          padding: 14px 8px 5px;
          background: linear-gradient(to top, rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0));
          color: #FFFFFF;
          font-size: 11px;
          font-weight: 500;
          letter-spacing: 0.02em;
          line-height: 1.2;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          pointer-events: none;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
        }

        .picker-photo-folder {
          display: block;
          margin-top: 1px;
          font-size: 10px;
          font-weight: 400;
          opacity: 0.8;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* Search + sort row: fixed between header/tabs and the scroller, one slim line */
        .picker-tools {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 24px;
          background-color: var(--card-bg);
          border-bottom: 1px solid var(--border-color);
        }
        .picker-search {
          position: relative;
          flex: 1 1 auto;
          min-width: 0;
          max-width: 420px;
        }
        .picker-search-icon {
          position: absolute;
          left: 11px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--text-secondary);
          pointer-events: none;
        }
        .picker-search-input {
          width: 100%;
          min-width: 0;
          box-sizing: border-box;
          height: 40px;
          padding: 0 38px 0 34px;
          background-color: var(--bg-color);
          border: 1px solid var(--border-color);
          border-radius: 999px;
          color: var(--text-primary);
          font-family: inherit;
          font-size: 16px; /* >= 16px keeps iOS from zooming the page on focus */
        }
        .picker-search-input::placeholder {
          color: var(--text-secondary);
          opacity: 0.8;
        }
        .picker-search-input:focus {
          outline: none;
          border-color: var(--gold-accent);
        }
        .picker-search-clear {
          position: absolute;
          right: 0;
          top: 0;
          width: 40px;
          height: 40px;
          padding: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: none;
          border: none;
          color: var(--text-secondary);
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }
        .picker-sort-select {
          flex-shrink: 0;
          height: 40px;
          padding: 0 8px;
          background-color: var(--bg-color);
          border: 1px solid var(--border-color);
          border-radius: 999px;
          color: var(--text-primary);
          font-family: inherit;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
        }
        .picker-sort-select:focus {
          outline: none;
          border-color: var(--gold-accent);
        }

        .picker-bw-chip {
          position: absolute;
          top: 8px;
          left: 8px;
          z-index: 2;
          padding: 2px 7px;
          border-radius: 999px;
          background: rgba(0, 0, 0, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.6);
          color: #FFFFFF;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.05em;
          pointer-events: none;
        }

        /* Selection circle: 44px hit area around a 26px visual circle */
        .select-hit {
          position: absolute;
          top: 0;
          right: 0;
          z-index: 3;
          width: 44px;
          height: 44px;
          padding: 0;
          background: transparent;
          border: none;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }

        .select-indicator {
          width: 26px;
          height: 26px;
          border-radius: 50%;
          border: 2px solid #FFFFFF;
          background-color: rgba(0, 0, 0, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background-color 0.2s, border-color 0.2s;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
        }

        .picker-photo-item.selected .select-indicator {
          background-color: var(--gold-accent);
          border-color: #FFFFFF;
        }

        .check-icon {
          color: #FFFFFF;
        }

        .picker-empty {
          text-align: center;
          color: var(--text-secondary);
          padding: 60px 16px;
        }

        /* "Selectate" tray (above the action bar) */
        .picker-selected-tray {
          flex-shrink: 0;
          max-height: 38vh;
          max-height: 38dvh;
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
          background-color: var(--card-bg);
          border-top: 1px solid var(--border-color);
        }
        .picker-selected-tray ul {
          list-style: none;
          margin: 0;
          padding: 4px 24px;
        }
        .picker-selected-tray li {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 6px 0;
          border-bottom: 1px solid var(--border-color);
        }
        .picker-selected-tray li:last-child {
          border-bottom: none;
        }
        .picker-selected-tray img {
          width: 44px;
          height: 44px;
          object-fit: cover;
          border-radius: var(--radius-sm);
          flex-shrink: 0;
          background-color: var(--accent-light);
        }
        .picker-selected-name {
          flex: 1 1 auto;
          min-width: 0;
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .picker-selected-bw {
          flex-shrink: 0;
          padding: 2px 7px;
          border-radius: 999px;
          border: 1px solid var(--border-color);
          color: var(--text-secondary);
          font-size: 11px;
          font-weight: 700;
        }
        .picker-selected-remove {
          flex-shrink: 0;
          width: 44px;
          height: 44px;
          margin-right: -10px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: none;
          border: none;
          color: var(--text-secondary);
          cursor: pointer;
        }

        /* Action bar: never scrolls away, honours the iOS home-indicator inset */
        .picker-modal-footer {
          flex-shrink: 0;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          padding: 12px 24px;
          padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
          background-color: var(--card-bg);
          border-top: 1px solid var(--border-color);
          box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.25);
          position: relative;
          z-index: 5;
        }

        .picker-footer-status {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
          flex: 1 1 auto;
        }

        .selection-count-text {
          font-size: 14px;
          color: var(--text-primary);
          font-weight: 600;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .selection-count-text.warn {
          color: #E0B15C;
        }

        .picker-selected-toggle {
          flex-shrink: 0;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          min-height: 40px;
          padding: 0 12px;
          background: transparent;
          border: 1px solid var(--border-color);
          border-radius: 999px;
          color: var(--text-secondary);
          font-family: inherit;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }

        .footer-actions {
          display: flex;
          gap: 12px;
          flex-shrink: 0;
        }

        @media (max-width: 600px) {
          .picker-modal-header {
            flex-wrap: wrap;
            padding: 10px 12px 10px 16px;
            gap: 8px 8px;
          }
          .picker-header-text {
            order: 1;
          }
          .picker-close-btn {
            order: 2;
            margin: -4px 0;
          }
          .picker-view-toggle {
            order: 3;
            width: 100%;
          }
          .picker-view-toggle button {
            flex: 1 1 0;
            justify-content: center;
          }
          .picker-modal-header h3 {
            font-size: 16px;
          }
          .picker-body {
            padding: 12px;
          }
          .picker-tools {
            padding: 6px 12px;
          }
          .picker-search {
            max-width: none;
          }
          .picker-masonry,
          .picker-masonry-col {
            gap: 8px;
          }
          .picker-body-large .picker-masonry-col {
            gap: 12px;
          }
          .picker-body-large .picker-photo-name {
            font-size: 13px;
            padding: 18px 12px 8px;
          }
          .picker-selected-tray ul {
            padding: 4px 16px;
          }
          .picker-modal-footer {
            flex-direction: column;
            align-items: stretch;
            gap: 8px;
            padding: 10px 16px;
            padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px));
          }
          .footer-actions {
            gap: 10px;
          }
          .footer-actions .btn {
            min-height: 46px;
            padding: 0 16px;
            flex: 1 1 0;
          }
          .footer-actions .btn-primary {
            flex: 2 1 0;
          }
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
          font-size: 16px;
          font-weight: 700;
          letter-spacing: 0.03em;
          text-align: center;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          overflow: hidden;
        }
        .zoom-lightbox-name-text {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .zoom-lightbox-name-tag {
          display: inline-block;
          flex-shrink: 0;
          padding: 1px 8px;
          border-radius: 999px;
          background: var(--gold-accent);
          border: 1px solid rgba(255, 255, 255, 0.5);
          color: #FFFFFF;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          vertical-align: middle;
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
          padding: 0;
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

        /* Sticky inside the scroll area: always shows where you are and how to go back */
        .folder-navigation-row {
          position: sticky;
          top: 0;
          z-index: 4;
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 8px 24px;
          background-color: #1A1A1A;
          border-bottom: 1px solid #2D2A28;
        }

        .folder-back-btn {
          flex-shrink: 0;
          display: inline-flex;
          align-items: center;
          gap: 2px;
          min-height: 40px;
          padding: 0 14px 0 8px;
          background: transparent;
          border: 1px solid var(--border-color);
          border-radius: var(--radius-sm);
          color: var(--text-primary);
          font-family: inherit;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }

        .folder-name-title {
          flex: 1 1 auto;
          min-width: 0;
          font-size: 14px;
          font-weight: 700;
          color: #FAF9F6;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
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
            -webkit-overflow-scrolling: touch;
          }
          .picker-session-tab {
            font-size: 12px;
            letter-spacing: 0.06em;
            padding: 12px 0 10px;
            min-height: 40px;
          }
          .folder-navigation-row {
            padding: 6px 12px;
          }
          .folders-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
          }
          .folder-card {
            padding: 10px;
            min-width: 0;
          }
          .folder-card-name {
            word-break: break-word;
            overflow-wrap: anywhere;
          }
        }
      `}</style>
    </div>
  );
};

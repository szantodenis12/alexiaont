import React, { useEffect, useRef, useState } from 'react';
import { X, Check } from 'lucide-react';

interface Photo {
  name: string;
  url: string;
  path: string;
  folder?: string;
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
}

// Global scroll memory store
const scrollMemory: Record<string, number> = {};

export const PhotoPickerModal: React.FC<PhotoPickerModalProps> = ({
  isOpen,
  onClose,
  photos,
  selectedPhotos,
  onConfirm,
  multiple = false,
  minRequired = 1,
  fieldKey
}) => {
  const [localSelection, setLocalSelection] = useState<string[]>([]);
  const [localBwStates, setLocalBwStates] = useState<Record<string, boolean>>({});
  const [previewPhoto, setPreviewPhoto] = useState<Photo | null>(null);
  const [previewBw, setPreviewBw] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);

  const hasFolders = React.useMemo(() => {
    return photos.some(p => p.folder);
  }, [photos]);

  const folderGroups = React.useMemo(() => {
    const groups: Record<string, Photo[]> = {};
    photos.forEach(photo => {
      const f = photo.folder || 'Fără folder';
      if (!groups[f]) groups[f] = [];
      groups[f].push(photo);
    });
    return groups;
  }, [photos]);

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

        {/* Scrollable grid area */}
        <div 
          className="picker-grid-container" 
          ref={scrollContainerRef}
          onScroll={handleScroll}
        >
          {photos.length === 0 ? (
            <div className="picker-empty">Nu există poze încărcate în galeria clasei.</div>
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
                <div className="folder-navigation-row">
                  <button className="btn btn-secondary" onClick={() => setCurrentFolder(null)} style={{ padding: '6px 12px', fontSize: '12px' }}>
                    &larr; Înapoi la foldere
                  </button>
                  <span className="folder-name-title">Dosar curent: <strong>{currentFolder}</strong></span>
                </div>
              )}
              <div className="picker-masonry">
                {(hasFolders && currentFolder !== null ? folderGroups[currentFolder] : photos).map((photo) => {
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
                        src={photo.url} 
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
            <div className="zoom-lightbox-img-wrapper">
              <img 
                src={previewPhoto.url} 
                alt={previewPhoto.name} 
                className={`zoom-lightbox-img ${previewBw ? 'grayscale' : ''}`} 
              />
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
                  setPreviewPhoto(null);
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

        .picker-close-btn:hover {
          color: var(--text-primary);
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

        .picker-photo-item:hover {
          transform: scale(1.02);
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
          background: rgba(0, 0, 0, 0.1);
          opacity: 0;
          transition: opacity 0.2s ease;
          display: flex;
          align-items: flex-start;
          justify-content: flex-end;
          padding: 8px;
        }

        .picker-photo-item:hover .picker-photo-overlay,
        .picker-photo-item.selected .picker-photo-overlay {
          opacity: 1;
        }

        .select-indicator {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          border: 1px solid #FFFFFF;
          background-color: rgba(0,0,0,0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
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

        .zoom-lightbox-close:hover {
          background-color: rgba(14, 13, 12, 0.9);
        }

        .zoom-lightbox-img-wrapper {
          background-color: #0E0D0C;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 40px 24px;
          flex: 1;
          overflow: hidden;
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
        }

        @media (max-width: 600px) {
          .zoom-lightbox-controls {
            flex-direction: column;
            align-items: stretch;
            gap: 16px;
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
          padding: 24px 16px;
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
          box-shadow: var(--shadow-md);
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
      `}</style>
    </div>
  );
};

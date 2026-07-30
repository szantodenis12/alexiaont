import React, { useState } from 'react';
import { useUpload } from '../../context/UploadContext';
import { X, ChevronUp, ChevronDown, Check, RefreshCw } from 'lucide-react';

export const BackgroundUploadBar: React.FC = () => {
  const { 
    filesTotal, 
    filesUploaded, 
    isUploading, 
    progressMap, 
    resetUploadState
  } = useUpload();
  
  const [isExpanded, setIsExpanded] = useState(false);

  // If there's no upload active and no history, don't render
  if (filesTotal === 0) return null;

  const percent = Math.round((filesUploaded / filesTotal) * 100) || 0;
  const isCompleted = filesUploaded === filesTotal && !isUploading;

  // Group progress map statuses
  const items = Object.values(progressMap);

  return (
    <div 
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        width: '360px',
        backgroundColor: '#161514',
        border: '1px solid #2D2A28',
        borderRadius: '8px',
        boxShadow: '0 8px 30px rgba(0,0,0,0.6)',
        color: '#FAF9F6',
        zIndex: 99999,
        fontFamily: 'Outfit, sans-serif',
        overflow: 'hidden',
        transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        maxHeight: isExpanded ? '400px' : '76px',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {/* Header bar (always visible) */}
      <div 
        style={{
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: isExpanded ? '1px solid #2D2A28' : '1px solid transparent',
          cursor: 'pointer',
          userSelect: 'none'
        }}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
          {isCompleted ? (
            <div style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: '#2ECC71', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Check size={14} style={{ color: '#121110' }} />
            </div>
          ) : (
            <div style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: '#D4AF37', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <RefreshCw size={14} className="spinner" style={{ color: '#121110' }} />
            </div>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 600, letterSpacing: '0.02em', textTransform: 'uppercase', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
              {isCompleted ? 'Încărcare finalizată' : 'Se încarcă fotografii'}
            </h4>
            <p style={{ margin: '2px 0 0 0', fontSize: '11px', color: '#A3A09B' }}>
              {filesUploaded} din {filesTotal} fișiere ({percent}%)
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }} onClick={(e) => e.stopPropagation()}>
          <button 
            onClick={() => setIsExpanded(!isExpanded)}
            style={{ background: 'none', border: 'none', color: '#706E6A', cursor: 'pointer', padding: '4px' }}
          >
            {isExpanded ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
          </button>
          {isCompleted && (
            <button 
              onClick={resetUploadState}
              style={{ background: 'none', border: 'none', color: '#706E6A', cursor: 'pointer', padding: '4px' }}
              title="Închide"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Progress Bar under header if collapsed */}
      {!isExpanded && !isCompleted && (
        <div style={{ width: '100%', height: '3px', backgroundColor: '#2D2A28' }}>
          <div 
            style={{ 
              width: `${percent}%`, 
              height: '100%', 
              backgroundColor: '#D4AF37', 
              transition: 'width 0.3s ease' 
            }} 
          />
        </div>
      )}

      {/* Detailed files list (visible when expanded) */}
      <div 
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 20px',
          display: isExpanded ? 'flex' : 'none',
          flexDirection: 'column',
          gap: '10px'
        }}
        className="hide-scrollbar"
      >
        {items.map((item) => (
          <div key={item.name} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
              <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '70%', color: '#E5DFD9' }}>
                {item.name}
              </span>
              <span style={{ fontSize: '11px', color: item.status === 'Finalizat' ? '#2ECC71' : item.status.startsWith('Eroare') ? '#E06C75' : '#D4AF37' }}>
                {item.status}
              </span>
            </div>
            {item.status !== 'Finalizat' && !item.status.startsWith('Eroare') && (
              <div style={{ width: '100%', height: '2px', backgroundColor: '#2D2A28', borderRadius: '1px', overflow: 'hidden' }}>
                <div 
                  style={{ 
                    width: `${item.progress}%`, 
                    height: '100%', 
                    backgroundColor: '#D4AF37',
                    transition: 'width 0.2s' 
                  }} 
                />
              </div>
            )}
          </div>
        ))}
      </div>
      
      {/* CSS Spinner animation (fallback in case CSS block is unmounted) */}
      <style>{`
        .spinner {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

import React, { useState } from 'react';
import { useUpload } from '../../context/UploadContext';
import { X, ChevronUp, ChevronDown, Check, RefreshCw } from 'lucide-react';

export const BackgroundUploadBar: React.FC = () => {
  const { jobs, dismissJob } = useUpload();
  const [expandedJob, setExpandedJob] = useState<string | null>(null);

  const visibleJobs = jobs.filter(j => j.filesTotal > 0);
  if (visibleJobs.length === 0) return null;

  const anyActive = visibleJobs.some(j => !j.isFinished);

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        width: '360px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        zIndex: 99999,
        fontFamily: 'Outfit, sans-serif',
        maxHeight: '80vh',
        overflowY: 'auto',
        paddingRight: '2px',
      }}
      className="hide-scrollbar"
    >
      {/* Global summary bar when multiple jobs exist */}
      {visibleJobs.length > 1 && (
        <div
          style={{
            backgroundColor: '#161514',
            border: '1px solid #2D2A28',
            borderRadius: '8px',
            padding: '10px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            color: '#FAF9F6',
          }}
        >
          {anyActive ? (
            <RefreshCw size={14} className="spinner" style={{ color: '#D4AF37', flexShrink: 0 }} />
          ) : (
            <Check size={14} style={{ color: '#2ECC71', flexShrink: 0 }} />
          )}
          <span style={{ fontSize: '12px', fontWeight: 600 }}>
            {visibleJobs.length} {anyActive ? 'încărcări în desfășurare' : 'încărcări finalizate'}
          </span>
        </div>
      )}

      {/* One card per job */}
      {visibleJobs.map(job => {
        const percent = job.filesTotal > 0 ? Math.round((job.filesUploaded / job.filesTotal) * 100) : 0;
        const isExpanded = expandedJob === job.jobKey;
        const items = Object.values(job.progressMap);

        return (
          <div
            key={job.jobKey}
            style={{
              backgroundColor: '#161514',
              border: '1px solid #2D2A28',
              borderRadius: '8px',
              boxShadow: '0 8px 30px rgba(0,0,0,0.6)',
              color: '#FAF9F6',
              overflow: 'hidden',
              transition: 'max-height 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
              maxHeight: isExpanded ? '340px' : '76px',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: '14px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: isExpanded ? '1px solid #2D2A28' : '1px solid transparent',
                cursor: 'pointer',
                userSelect: 'none',
              }}
              onClick={() => setExpandedJob(isExpanded ? null : job.jobKey)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
                {job.isFinished ? (
                  <div style={{ width: '26px', height: '26px', borderRadius: '50%', backgroundColor: '#2ECC71', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Check size={13} style={{ color: '#121110' }} />
                  </div>
                ) : (
                  <div style={{ width: '26px', height: '26px', borderRadius: '50%', backgroundColor: '#D4AF37', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <RefreshCw size={13} className="spinner" style={{ color: '#121110' }} />
                  </div>
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <h4 style={{ margin: 0, fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {job.isFinished ? 'Finalizat' : 'Se încarcă'}
                  </h4>
                  <p style={{ margin: '2px 0 0 0', fontSize: '11px', color: '#A3A09B' }}>
                    {job.filesUploaded}/{job.filesTotal} fișiere ({percent}%)
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => setExpandedJob(isExpanded ? null : job.jobKey)}
                  style={{ background: 'none', border: 'none', color: '#706E6A', cursor: 'pointer', padding: '4px' }}
                >
                  {isExpanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                </button>
                {job.isFinished && (
                  <button
                    onClick={() => dismissJob(job.jobKey)}
                    style={{ background: 'none', border: 'none', color: '#706E6A', cursor: 'pointer', padding: '4px' }}
                    title="Închide"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            </div>

            {/* Thin progress bar when collapsed */}
            {!isExpanded && !job.isFinished && (
              <div style={{ width: '100%', height: '3px', backgroundColor: '#2D2A28' }}>
                <div
                  style={{
                    width: `${percent}%`,
                    height: '100%',
                    backgroundColor: '#D4AF37',
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
            )}

            {/* Expanded file list */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: isExpanded ? '10px 16px' : '0',
                display: isExpanded ? 'flex' : 'none',
                flexDirection: 'column',
                gap: '8px',
              }}
              className="hide-scrollbar"
            >
              {items.map(item => (
                <div key={item.name} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                    <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '68%', color: '#E5DFD9' }}>
                      {item.name}
                    </span>
                    <span style={{ fontSize: '10px', color: item.status === 'Finalizat' ? '#2ECC71' : item.status.startsWith('Eroare') ? '#E06C75' : '#D4AF37' }}>
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
                          transition: 'width 0.2s',
                        }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}

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

import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useUpload } from '../../context/UploadContext';
import type { UploadJob } from '../../context/UploadContext';
import { X, ChevronUp, ChevronDown, Check, RefreshCw, WifiOff, Trash2, AlertTriangle, RotateCcw, History } from 'lucide-react';

/** Max file rows rendered in an expanded tile (a class can queue ~20k files). */
const MAX_ROWS = 200;

const pozeWord = (n: number) => (n === 1 ? 'poză' : 'poze');
const fisiereWord = (n: number) => (n === 1 ? 'fișier' : 'fișiere');

const statusRank = (status: string) =>
  status.startsWith('Eroare') ? 0 : status === 'Finalizat' ? 3 : status.startsWith('Așteptare') ? 2 : 1;

export const BackgroundUploadBar: React.FC = () => {
  const { jobs, dismissJob, cancelUpload, retryFailed, isOnline, interruptedUploads, dismissInterrupted } = useUpload();
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const location = useLocation();
  const onAdmin = location.pathname.startsWith('/admin');

  const visibleJobs = jobs.filter(j => j.filesTotal > 0 || j.filesSkipped > 0);
  const shownInterrupted = onAdmin ? interruptedUploads : [];
  if (visibleJobs.length === 0 && shownInterrupted.length === 0) return null;

  const anyActive = visibleJobs.some(j => !j.isFinished);
  const cardStyle: React.CSSProperties = {
    backgroundColor: '#161514',
    border: '1px solid #2D2A28',
    borderRadius: '8px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
    color: '#FAF9F6',
  };
  const smallBtn = (danger = false): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    backgroundColor: danger ? '#2C1515' : '#2A2416',
    border: `1px solid ${danger ? '#7E2222' : '#6B5A1E'}`,
    color: danger ? '#FF6B6B' : '#D4AF37',
    borderRadius: '4px',
    padding: '4px 8px',
    fontSize: '11px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s',
    whiteSpace: 'nowrap',
  });

  const subtitle = (job: UploadJob) => {
    if (job.kind === 'delete') {
      const processed = job.filesUploaded + job.filesFailed;
      if (!job.isFinished) return `Se șterg ${job.filesTotal} ${pozeWord(job.filesTotal)}… (${processed}/${job.filesTotal})`;
      return `${job.filesUploaded} ${pozeWord(job.filesUploaded)} ${job.filesUploaded === 1 ? 'ștearsă' : 'șterse'}`;
    }
    if (job.filesTotal === 0) return 'Toate fișierele erau deja încărcate';
    const percent = Math.round((job.filesUploaded / job.filesTotal) * 100);
    const state = job.isFinished
      ? (job.filesFailed > 0 ? 'Finalizat cu erori' : 'Finalizat')
      : (!isOnline ? 'Așteaptă conexiunea' : 'Se încarcă');
    return `${job.filesUploaded}/${job.filesTotal} fișiere (${percent}%)${job.label ? ` · ${state}` : ''}`;
  };

  const notes = (job: UploadJob): { text: string; tone: 'muted' | 'bad' }[] => {
    const out: { text: string; tone: 'muted' | 'bad' }[] = [];
    if (job.kind === 'delete') {
      const f = job.filesFailed;
      if (f > 0) {
        out.push({
          text: f === 1
            ? `1 poză nu a putut fi ștearsă și a fost restaurată${job.errorMessage ? ` (${job.errorMessage})` : ''}.`
            : `${f} poze nu au putut fi șterse și au fost restaurate${job.errorMessage ? ` (${job.errorMessage})` : ''}.`,
          tone: 'bad',
        });
      } else if (job.errorMessage) {
        out.push({ text: `Eroare: ${job.errorMessage}`, tone: 'bad' });
      }
      if (job.storageFailures) {
        out.push({ text: `${job.storageFailures} ${fisiereWord(job.storageFailures)} din Storage nu au putut fi eliminate (pozele sunt șterse).`, tone: 'bad' });
      }
      return out;
    }
    if (job.filesSkipped > 0) out.push({ text: `${job.filesSkipped} ${fisiereWord(job.filesSkipped)} sărite (deja încărcate)`, tone: 'muted' });
    if (job.filesFailed > 0) out.push({ text: `${job.filesFailed} ${fisiereWord(job.filesFailed)} ${job.filesFailed === 1 ? 'eșuat' : 'eșuate'}`, tone: 'bad' });
    return out;
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        width: '360px',
        maxWidth: 'calc(100vw - 32px)',
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
      {/* Network lost: nothing fails, the queue resumes by itself */}
      {!isOnline && anyActive && (
        <div role="status" aria-live="polite" style={{ ...cardStyle, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '10px', borderColor: '#6B5A1E' }}>
          <WifiOff size={14} style={{ color: '#D4AF37', flexShrink: 0 }} />
          <span style={{ fontSize: '12px', fontWeight: 600 }}>Conexiune pierdută — se reia automat</span>
        </div>
      )}

      {/* Uploads cut off by a reload / closed browser (local journal) */}
      {shownInterrupted.map(entry => (
        <div key={`int-${entry.jobKey}`} role="status" style={{ ...cardStyle, padding: '12px 14px', display: 'flex', gap: '10px', alignItems: 'flex-start', borderColor: '#6B5A1E' }}>
          <History size={15} style={{ color: '#D4AF37', flexShrink: 0, marginTop: '2px' }} />
          <p style={{ margin: 0, fontSize: '12px', lineHeight: 1.45, color: '#E5DFD9', flex: 1 }}>
            <strong style={{ color: '#FAF9F6' }}>Încărcare întreruptă în {entry.label}</strong> — {entry.done} din {entry.total} încărcate.
            {' '}Selectează din nou folderul ca să continui (pozele deja încărcate vor fi sărite).
          </p>
          <button
            onClick={() => dismissInterrupted(entry.jobKey)}
            style={{ background: 'none', border: 'none', color: '#706E6A', cursor: 'pointer', padding: '2px', flexShrink: 0 }}
            title="Închide"
            aria-label="Închide"
          >
            <X size={15} />
          </button>
        </div>
      ))}

      {/* Global summary bar when multiple jobs exist */}
      {visibleJobs.length > 1 && (
        <div style={{ ...cardStyle, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          {anyActive ? (
            <RefreshCw size={14} className="spinner" style={{ color: '#D4AF37', flexShrink: 0 }} />
          ) : (
            <Check size={14} style={{ color: '#2ECC71', flexShrink: 0 }} />
          )}
          <span style={{ fontSize: '12px', fontWeight: 600 }}>
            {visibleJobs.length} {anyActive ? 'operațiuni în desfășurare' : 'operațiuni finalizate'}
          </span>
        </div>
      )}

      {/* One card per job */}
      {visibleJobs.map(job => {
        const isDelete = job.kind === 'delete';
        const processed = isDelete ? job.filesUploaded + job.filesFailed : job.filesUploaded;
        const percent = job.filesTotal > 0 ? Math.round((processed / job.filesTotal) * 100) : 100;
        const isExpanded = !isDelete && expandedJob === job.jobKey;
        const allItems = isExpanded
          ? Object.entries(job.progressMap).sort((a, b) => statusRank(a[1].status) - statusRank(b[1].status))
          : [];
        const items = allItems.slice(0, MAX_ROWS);
        const jobNotes = notes(job);
        const hasProblem = isDelete
          ? (job.filesFailed > 0 || !!job.storageFailures || !!job.errorMessage)
          : job.filesFailed > 0;
        const title = isDelete
          ? (job.isFinished ? 'Ștergere finalizată' : 'Ștergere poze')
          : (job.label || (job.isFinished ? 'Finalizat' : 'Se încarcă'));

        return (
          <div
            key={job.jobKey}
            style={{
              ...cardStyle,
              boxShadow: '0 8px 30px rgba(0,0,0,0.6)',
              overflow: 'hidden',
              transition: 'max-height 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
              maxHeight: isExpanded ? '420px' : '170px',
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
                cursor: isDelete ? 'default' : 'pointer',
                userSelect: 'none',
              }}
              onClick={() => { if (!isDelete) setExpandedJob(isExpanded ? null : job.jobKey); }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
                {job.isFinished ? (
                  <div style={{ width: '26px', height: '26px', borderRadius: '50%', backgroundColor: hasProblem ? '#E06C75' : '#2ECC71', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {hasProblem ? <AlertTriangle size={13} style={{ color: '#121110' }} /> : <Check size={13} style={{ color: '#121110' }} />}
                  </div>
                ) : (
                  <div style={{ width: '26px', height: '26px', borderRadius: '50%', backgroundColor: !isOnline ? '#6B5A1E' : '#D4AF37', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {!isOnline
                      ? <WifiOff size={13} style={{ color: '#121110' }} />
                      : isDelete
                        ? <Trash2 size={13} style={{ color: '#121110' }} />
                        : <RefreshCw size={13} className="spinner" style={{ color: '#121110' }} />}
                  </div>
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <h4
                    style={{ margin: 0, fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={job.label || undefined}
                  >
                    {title}
                  </h4>
                  <p style={{ margin: '2px 0 0 0', fontSize: '11px', color: '#A3A09B' }}>
                    {subtitle(job)}
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={e => e.stopPropagation()}>
                {!isDelete && job.filesFailed > 0 && (
                  <button
                    onClick={() => retryFailed(job.jobKey)}
                    style={smallBtn()}
                    title="Încarcă din nou doar fișierele eșuate"
                  >
                    <RotateCcw size={12} />
                    <span>Reîncearcă eșuatele</span>
                  </button>
                )}
                {!isDelete && !job.isFinished && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm('Oprești încărcarea? Fotografiile deja urcate rămân salvate; se opresc doar fișierele rămase.')) {
                        cancelUpload(job.jobKey);
                      }
                    }}
                    disabled={job.isCancelling}
                    style={{ ...smallBtn(true), cursor: job.isCancelling ? 'not-allowed' : 'pointer', opacity: job.isCancelling ? 0.6 : 1 }}
                    title="Oprește încărcarea fișierelor rămase"
                  >
                    <X size={12} />
                    <span>{job.isCancelling ? 'Se anulează...' : 'Anulează'}</span>
                  </button>
                )}
                {!isDelete && (
                  <button
                    onClick={() => setExpandedJob(isExpanded ? null : job.jobKey)}
                    style={{ background: 'none', border: 'none', color: '#706E6A', cursor: 'pointer', padding: '4px' }}
                  >
                    {isExpanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                  </button>
                )}
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

            {/* Skipped / failed / delete problems */}
            {jobNotes.length > 0 && (
              <div style={{ padding: '0 16px 10px 52px', display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '-6px' }}>
                {jobNotes.map((n, i) => (
                  <span key={i} style={{ fontSize: '11px', lineHeight: 1.4, color: n.tone === 'bad' ? '#E06C75' : '#A3A09B' }}>{n.text}</span>
                ))}
              </div>
            )}

            {/* Thin progress bar when collapsed */}
            {!isExpanded && !job.isFinished && (
              <div style={{ width: '100%', height: '3px', backgroundColor: '#2D2A28', flexShrink: 0 }}>
                <div
                  style={{
                    width: `${percent}%`,
                    height: '100%',
                    backgroundColor: isDelete ? '#E06C75' : '#D4AF37',
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
              {items.map(([key, item]) => (
                <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '11px' }}>
                    <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '62%', color: '#E5DFD9' }} title={item.name}>
                      {item.name}
                    </span>
                    <span style={{ fontSize: '10px', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: item.status === 'Finalizat' ? '#2ECC71' : item.status.startsWith('Eroare') ? '#E06C75' : '#D4AF37' }} title={item.status}>
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
              {allItems.length > MAX_ROWS && (
                <span style={{ fontSize: '11px', color: '#706E6A' }}>…și încă {allItems.length - MAX_ROWS} {fisiereWord(allItems.length - MAX_ROWS)}</span>
              )}
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

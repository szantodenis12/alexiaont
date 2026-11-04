import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import type { ConflictAction, UploadConflict } from '../../utils/uploadConflicts';

/**
 * "These files already exist" — asked before an upload batch starts, when some
 * selected files have the same name as photos already in the destination (or as
 * another file of the same selection). Windows-style: skip all, replace all,
 * decide per file, or cancel the whole upload.
 *
 * Rendered by UploadProvider, so every admin upload entry point gets it.
 */

interface Props {
  /** Where the files go ("Galerie · Folder", class name...). */
  label?: string;
  /** Files selected in total. */
  totalFiles: number;
  /** Files skipped without asking (already uploaded / already queued). */
  autoSkipped: number;
  conflicts: UploadConflict[];
  /** One action per conflict (same order), or null = cancel the whole upload. */
  onResolve: (choices: ConflictAction[] | null) => void;
}

const ROW_STEP = 200;

const fotografiiWord = (n: number) => (n === 1 ? 'fotografie' : 'fotografii');
const fisiereWord = (n: number) => (n === 1 ? 'fișier' : 'fișiere');

const ACTION_LABEL: Record<ConflictAction, string> = {
  skip: 'Sari peste',
  replace: 'Înlocuiește',
  keepBoth: 'Păstrează ambele',
};

const ACTIONS: ConflictAction[] = ['skip', 'replace', 'keepBoth'];

/** What "Înlocuiește toate" means for one conflict: a file of the same selection cannot replace a photo, so both are kept. */
const replaceAllAction = (c: UploadConflict): ConflictAction => (c.replaceable ? 'replace' : 'keepBoth');

export const UploadConflictDialog: React.FC<Props> = ({ label, totalFiles, autoSkipped, conflicts, onResolve }) => {
  const [mode, setMode] = useState<'summary' | 'each'>('summary');
  const [choices, setChoices] = useState<ConflictAction[]>(() =>
    conflicts.map(c => (c.kind === 'batch' ? 'keepBoth' : 'skip'))
  );
  const [rowLimit, setRowLimit] = useState(ROW_STEP);

  const existingCount = useMemo(() => conflicts.filter(c => c.kind === 'existing').length, [conflicts]);
  const batchCount = conflicts.length - existingCount;
  const replaceableCount = useMemo(() => conflicts.filter(c => c.replaceable).length, [conflicts]);
  const freeCount = Math.max(0, totalFiles - autoSkipped - conflicts.length);

  const counts = useMemo(() => {
    const out: Record<ConflictAction, number> = { skip: 0, replace: 0, keepBoth: 0 };
    choices.forEach(a => { out[a]++; });
    return out;
  }, [choices]);

  // Escape: cancel from the summary (nothing is uploaded, same as "Anulează");
  // from the per-file list it only goes back, so the choices are not lost.
  useEffect(() => {
    // Capture phase + stopPropagation: a modal underneath (e.g. the class photos
    // modal) must not close on the same key press.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (mode === 'each') setMode('summary'); else onResolve(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onResolve, mode]);

  const title = existingCount > 0
    ? (existingCount === 1 ? 'O fotografie există deja' : `${existingCount} fotografii există deja`)
    : (batchCount === 1 ? 'Un fișier are același nume cu altul din selecție' : `${batchCount} fișiere au același nume cu altele din selecție`);

  const setAll = (fn: (c: UploadConflict) => ConflictAction) => setChoices(conflicts.map(fn));
  const setOne = (i: number, a: ConflictAction) => setChoices(prev => {
    const next = [...prev];
    next[i] = a;
    return next;
  });

  const bigBtn = (variant: 'primary' | 'gold' | 'plain'): React.CSSProperties => ({
    padding: '12px 18px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', textAlign: 'left',
    color: '#FAF9F6', transition: 'background 0.15s', width: '100%', fontFamily: 'inherit',
    ...(variant === 'primary'
      ? { border: 'none', backgroundColor: '#5f0b02' }
      : variant === 'gold'
        ? { border: '1px solid rgba(212, 175, 55, 0.45)', backgroundColor: 'rgba(212, 175, 55, 0.10)' }
        : { border: '1px solid #363433', backgroundColor: '#262423' }),
  });
  const hint: React.CSSProperties = { display: 'block', fontSize: '11px', fontWeight: 400, color: '#A3A09B', marginTop: '2px' };
  const sideNote: React.CSSProperties = { fontSize: '11px', opacity: 0.8, fontWeight: 400, whiteSpace: 'nowrap' };

  const segBtn = (active: boolean, disabled = false): React.CSSProperties => ({
    padding: '5px 9px', fontSize: '11px', fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
    border: `1px solid ${active ? '#D4AF37' : '#363433'}`,
    backgroundColor: active ? 'rgba(212, 175, 55, 0.18)' : 'transparent',
    color: disabled ? '#4A4846' : active ? '#F3E3A6' : '#A3A09B',
    borderRadius: '6px', whiteSpace: 'nowrap', fontFamily: 'inherit',
  });

  const shown = conflicts.slice(0, mode === 'summary' ? Math.min(rowLimit, 300) : rowLimit);
  const hiddenRows = conflicts.length - shown.length;

  return (
    <div
      style={{
        // Above every admin modal and the upload bar (99999): the upload waits for this answer.
        position: 'fixed', inset: 0, backgroundColor: 'rgba(9,8,8,0.88)', zIndex: 100000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
        animation: 'fadeIn 0.18s ease',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-conflict-title"
        onClick={e => e.stopPropagation()}
        style={{
          backgroundColor: '#1C1A19', border: '1px solid #2D2A28', borderRadius: '12px',
          padding: '28px', width: mode === 'each' ? '640px' : '500px', maxWidth: '100%', maxHeight: '92vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 24px 60px rgba(0,0,0,0.7)', color: '#FAF9F6', fontFamily: 'Outfit, sans-serif',
        }}
      >
        {/* Icon + title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
          <div style={{
            width: '40px', height: '40px', borderRadius: '50%', flexShrink: 0,
            backgroundColor: 'rgba(212,175,55,0.15)', border: '1px solid rgba(212,175,55,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <AlertCircle size={20} style={{ color: '#D4AF37' }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <h3 id="upload-conflict-title" style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>{title}</h3>
            <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#A3A09B', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {existingCount > 0 && <>Au același nume ca pozele din {label ? <strong style={{ color: '#D8D0C8' }}>{label}</strong> : 'destinație'}. </>}
              {freeCount > 0 && <>{freeCount} {fisiereWord(freeCount)} {freeCount === 1 ? 'nou se încarcă' : 'noi se încarcă'} oricum.</>}
              {autoSkipped > 0 && <> {autoSkipped} {fisiereWord(autoSkipped)} deja {autoSkipped === 1 ? 'încărcat este sărit' : 'încărcate sunt sărite'} automat.</>}
            </p>
          </div>
        </div>

        {batchCount > 0 && existingCount > 0 && (
          <p style={{ margin: '10px 0 0 0', fontSize: '12px', color: '#A3A09B' }}>
            {batchCount} {batchCount === 1 ? 'fișier apare' : 'fișiere apar'} de mai multe ori în selecție (marcate „în selecție”).
          </p>
        )}

        {mode === 'summary' ? (
          <>
            {/* Conflicting names (scrollable) */}
            <div style={{
              backgroundColor: '#121110', border: '1px solid #262423', borderRadius: '8px',
              padding: '10px 14px', margin: '16px 0', maxHeight: '240px', overflowY: 'auto', flexShrink: 1, minHeight: '60px',
            }}>
              {shown.map(c => (
                <div key={c.index} style={{
                  fontSize: '12px', color: '#D8D0C8', padding: '4px 0', borderBottom: '1px solid #1E1D1C',
                  display: 'flex', alignItems: 'center', gap: '8px',
                }}>
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: c.kind === 'batch' ? '#706E6A' : '#D4AF37', flexShrink: 0 }} />
                  <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', flex: 1 }}>{c.displayName}</span>
                  {c.kind === 'batch' && <span style={{ fontSize: '10px', color: '#706E6A', whiteSpace: 'nowrap' }}>în selecție</span>}
                </div>
              ))}
              {hiddenRows > 0 && (
                <div style={{ fontSize: '12px', color: '#706E6A', padding: '6px 0 2px' }}>… și încă {hiddenRows}</div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                type="button"
                onClick={() => onResolve(conflicts.map(() => 'skip'))}
                style={bigBtn('primary')}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#7a0c00')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#5f0b02')}
              >
                <span>
                  Sari peste toate
                  <span style={{ ...hint, color: '#E8D9D6' }}>Pozele existente rămân neschimbate</span>
                </span>
                <span style={sideNote}>{freeCount > 0 ? `se încarcă ${freeCount} ${freeCount === 1 ? 'nou' : 'noi'}` : 'nu se încarcă nimic nou'}</span>
              </button>
              {replaceableCount > 0 ? (
                <button
                  type="button"
                  onClick={() => onResolve(conflicts.map(replaceAllAction))}
                  style={bigBtn('gold')}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(212, 175, 55, 0.18)')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'rgba(212, 175, 55, 0.10)')}
                  title="Pozele noi le înlocuiesc pe cele vechi cu același nume, în aceeași poziție și în același folder. Selecțiile deja trimise rămân valabile; la descărcare se livrează originalul nou."
                >
                  <span>
                    Înlocuiește toate
                    <span style={hint}>
                      Pozele noi le înlocuiesc pe cele vechi, în aceeași poziție
                      {batchCount > 0 ? '; numele repetate din selecție sunt păstrate ambele' : ''}
                      {existingCount - replaceableCount > 0 ? '; pozele fără identificator propriu se păstrează ambele' : ''}
                    </span>
                  </span>
                  <span style={sideNote}>{replaceableCount} {replaceableCount === 1 ? 'înlocuită' : 'înlocuite'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onResolve(conflicts.map(() => 'keepBoth'))}
                  style={bigBtn('gold')}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(212, 175, 55, 0.18)')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'rgba(212, 175, 55, 0.10)')}
                >
                  <span>
                    Păstrează toate
                    <span style={hint}>Se încarcă toate, cele repetate cu nume nou (ex. „Nume (2).jpg”)</span>
                  </span>
                  <span style={sideNote}>{batchCount} {batchCount === 1 ? 'redenumit' : 'redenumite'}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => { setMode('each'); setRowLimit(ROW_STEP); }}
                style={bigBtn('plain')}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#2E2B29')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#262423')}
              >
                <span>
                  Decid pentru fiecare
                  <span style={hint}>Sari peste, înlocuiește sau păstrează ambele, pe rând</span>
                </span>
                <span style={sideNote}>{conflicts.length} {fisiereWord(conflicts.length)}</span>
              </button>
              <button
                type="button"
                onClick={() => onResolve(null)}
                style={{
                  padding: '10px 20px', borderRadius: '8px', border: '1px solid transparent', cursor: 'pointer',
                  backgroundColor: 'transparent', color: '#8A8784', fontSize: '13px', fontFamily: 'inherit',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = '#FAF9F6')}
                onMouseLeave={e => (e.currentTarget.style.color = '#8A8784')}
                title="Nu se încarcă nimic din această selecție"
              >
                Anulează
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Bulk helpers */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', margin: '16px 0 8px' }}>
              <span style={{ fontSize: '12px', color: '#A3A09B', marginRight: '4px' }}>Pentru toate:</span>
              <button type="button" style={segBtn(false)} onClick={() => setAll(() => 'skip')}>Sari peste</button>
              <button type="button" style={segBtn(false)} onClick={() => setAll(replaceAllAction)}>Înlocuiește</button>
              <button type="button" style={segBtn(false)} onClick={() => setAll(() => 'keepBoth')}>Păstrează ambele</button>
            </div>

            <div style={{
              backgroundColor: '#121110', border: '1px solid #262423', borderRadius: '8px',
              padding: '4px 12px', overflowY: 'auto', flex: '1 1 auto', minHeight: '120px', maxHeight: '48vh',
            }}>
              {shown.map((c, i) => (
                <div key={c.index} style={{
                  display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 0',
                  borderBottom: '1px solid #1E1D1C', flexWrap: 'wrap',
                }}>
                  <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                    <div style={{ fontSize: '12px', color: '#D8D0C8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.displayName}>
                      {c.displayName}
                    </div>
                    {c.kind === 'batch' && (
                      <div style={{ fontSize: '10px', color: '#706E6A' }}>apare de mai multe ori în selecție</div>
                    )}
                    {c.kind === 'existing' && !c.replaceable && (
                      <div style={{ fontSize: '10px', color: '#706E6A' }}>nu poate fi înlocuită pe loc</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }} role="radiogroup" aria-label={c.displayName}>
                    {ACTIONS.map(a => {
                      const disabled = a === 'replace' && !c.replaceable;
                      return (
                        <button
                          key={a}
                          type="button"
                          role="radio"
                          aria-checked={choices[i] === a}
                          disabled={disabled}
                          title={disabled ? (c.kind === 'batch' ? 'Un fișier din aceeași selecție nu poate înlocui o poză; alege „Păstrează ambele” sau „Sari peste”.' : 'Această poză nu poate fi înlocuită pe loc; alege „Păstrează ambele” sau „Sari peste”.') : undefined}
                          style={segBtn(choices[i] === a, disabled)}
                          onClick={() => setOne(i, a)}
                        >
                          {ACTION_LABEL[a]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {hiddenRows > 0 && (
                <div style={{ padding: '10px 0', textAlign: 'center' }}>
                  <button type="button" style={segBtn(false)} onClick={() => setRowLimit(l => l + ROW_STEP)}>
                    Arată încă {Math.min(ROW_STEP, hiddenRows)} (din {hiddenRows} rămase)
                  </button>
                  <div style={{ fontSize: '10px', color: '#706E6A', marginTop: '4px' }}>
                    Cele neafișate încă primesc alegerea făcută cu „Pentru toate”
                    {batchCount > 0 ? ' (implicit: Sari peste; numele repetate din selecție: Păstrează ambele).' : ' (implicit: Sari peste).'}
                  </div>
                </div>
              )}
            </div>

            <p style={{ fontSize: '12px', color: '#A3A09B', margin: '10px 0 0 0' }}>
              {counts.skip} {counts.skip === 1 ? 'sărită' : 'sărite'} · {counts.replace} {counts.replace === 1 ? 'înlocuită' : 'înlocuite'} · {counts.keepBoth} {fotografiiWord(counts.keepBoth)} {counts.keepBoth === 1 ? 'nouă' : 'noi'} cu nume diferit (ex. „Nume (2).jpg”)
            </p>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '16px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => onResolve(null)}
                style={{ padding: '10px 16px', borderRadius: '8px', border: '1px solid transparent', backgroundColor: 'transparent', color: '#8A8784', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Anulează
              </button>
              <button
                type="button"
                onClick={() => setMode('summary')}
                style={{ padding: '10px 16px', borderRadius: '8px', border: '1px solid #363433', backgroundColor: '#262423', color: '#FAF9F6', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Înapoi
              </button>
              <button
                type="button"
                onClick={() => onResolve(choices)}
                style={{ padding: '10px 20px', borderRadius: '8px', border: 'none', backgroundColor: '#5f0b02', color: '#FAF9F6', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Continuă
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

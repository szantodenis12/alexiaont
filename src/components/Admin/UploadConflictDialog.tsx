import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, ImageOff } from 'lucide-react';
import type { ConflictAction, ReplaceBlock, UploadConflict } from '../../utils/uploadConflicts';
import { cdnUrl } from '../../utils/cdn';

/**
 * "These files already exist" — asked before an upload batch starts, when some
 * selected files have the same name as photos already in the destination (or as
 * another file of the same selection). Files that look already uploaded are in
 * the list too, marked "identică" and pre-set to "Sari peste", so nothing is
 * skipped or overwritten without the photographer seeing it.
 *
 * A checkbox list: quick buttons for everything, then select rows (shift-click
 * for a range, filter identical / different) and apply an action to the
 * selection, or change one row with its own control. Large selections render
 * in steps, and the new files' previews are decoded only for rows on screen.
 *
 * Rendered by UploadProvider, so every admin upload entry point gets it.
 */

interface Props {
  /** Where the files go ("Galerie · Folder", class name...). */
  label?: string;
  /** Files selected in total. */
  totalFiles: number;
  /** Files skipped without asking (already queued / in flight). */
  autoSkipped: number;
  conflicts: UploadConflict[];
  /** The selected files, by position (UploadConflict.index). */
  files: File[];
  /** One action per conflict (same order), or null = cancel the whole upload. */
  onResolve: (choices: ConflictAction[] | null) => void;
}

type Filter = 'all' | 'identical' | 'different';

const ROW_STEP = 150;

const fisiereWord = (n: number) => (n === 1 ? 'fișier' : 'fișiere');

const ACTION_LABEL: Record<ConflictAction, string> = {
  skip: 'Sari peste',
  replace: 'Înlocuiește',
  keepBoth: 'Păstrează ambele',
};
const ACTIONS: ConflictAction[] = ['skip', 'replace', 'keepBoth'];

/** Nothing is overwritten or duplicated without an explicit choice; a repeated name of the selection is kept (as before). */
const defaultAction = (c: UploadConflict): ConflictAction => (c.kind === 'batch' && !c.identical ? 'keepBoth' : 'skip');

/**
 * "Înlocuiește toate" for one row: replace where possible; a file that cannot
 * replace is kept as a copy (as before), unless it is identical (then skipped —
 * a copy of the same picture is never what "replace" meant).
 */
const replaceAllAction = (c: UploadConflict): ConflictAction =>
  c.replaceable ? 'replace' : c.identical ? 'skip' : 'keepBoth';

const BLOCK_TITLE: Record<ReplaceBlock, string> = {
  batch: 'Un fișier care apare de mai multe ori în selecție nu poate înlocui o poză; alege „Păstrează ambele” sau „Sari peste”.',
  legacy: 'Poza existentă e veche (fără identificator propriu) și nu poate fi înlocuită pe loc; alege „Păstrează ambele” sau „Sari peste”.',
  taken: 'Alt fișier din selecție înlocuiește deja această poză.',
};

/** "3 apar de mai multe ori în selecție; 2 sunt poze vechi…" for the rows that cannot be replaced. */
const blockedSummary = (list: UploadConflict[]): string => {
  const n: Record<ReplaceBlock, number> = { batch: 0, legacy: 0, taken: 0 };
  list.forEach(c => { if (!c.replaceable) n[c.replaceBlock ?? 'legacy']++; });
  const parts: string[] = [];
  if (n.batch) parts.push(`${n.batch} ${n.batch === 1 ? 'apare' : 'apar'} de mai multe ori în selecție`);
  if (n.legacy) parts.push(`${n.legacy} ${n.legacy === 1 ? 'e o poză veche' : 'sunt poze vechi'}, fără identificator propriu`);
  if (n.taken) parts.push(`${n.taken} ${n.taken === 1 ? 'are' : 'au'} poza înlocuită deja de alt fișier din selecție`);
  return parts.join('; ');
};

const fmtBytes = (n: number, exact = false): string => {
  if (exact) return `${n.toLocaleString('ro-RO')} B`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
};

const sizeText = (oldSize: number | null | undefined, newSize: number): string => {
  if (!(typeof oldSize === 'number' && oldSize > 0)) return fmtBytes(newSize);
  if (oldSize === newSize) return `${fmtBytes(newSize)} (aceeași mărime)`;
  const a = fmtBytes(oldSize);
  const b = fmtBytes(newSize);
  return a === b ? `${fmtBytes(oldSize, true)} → ${fmtBytes(newSize, true)}` : `${a} → ${b}`;
};

/** Browsers cannot show these (HEIC, RAW...): no preview is attempted. */
const previewable = (f: File | undefined): f is File =>
  !!f && (!f.type || (f.type.startsWith('image/') && !/hei[cf]|tiff/i.test(f.type)));

// ── Visibility (one IntersectionObserver for every row) ────────────────────

type Observe = (el: Element, cb: (visible: boolean) => void) => () => void;

function useRowObserver(rootRef: React.RefObject<HTMLDivElement | null>): Observe {
  const callbacks = useRef(new Map<Element, (visible: boolean) => void>());
  const observerRef = useRef<IntersectionObserver | null>(null);
  useEffect(() => () => { observerRef.current?.disconnect(); observerRef.current = null; }, []);
  return useCallback<Observe>((el, cb) => {
    if (typeof IntersectionObserver === 'undefined') { cb(true); return () => {}; }
    if (!observerRef.current) {
      observerRef.current = new IntersectionObserver(entries => {
        entries.forEach(en => callbacks.current.get(en.target)?.(en.isIntersecting));
      }, { root: rootRef.current, rootMargin: '160px 0px' });
    }
    const obs = observerRef.current;
    callbacks.current.set(el, cb);
    obs.observe(el);
    return () => { callbacks.current.delete(el); obs.unobserve(el); };
  }, [rootRef]);
}

// ── Thumbnails ─────────────────────────────────────────────────────────────

const thumbBox: React.CSSProperties = {
  width: '44px', height: '44px', borderRadius: '5px', flexShrink: 0, overflow: 'hidden',
  backgroundColor: '#262423', border: '1px solid #2D2A28',
  display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4A4846',
};
const thumbImg: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' };

const ExistingThumb: React.FC<{ url?: string; show: boolean }> = ({ url, show }) => {
  const [failed, setFailed] = useState(false);
  return (
    <div style={thumbBox} title="Poza existentă">
      {url && show && !failed
        ? <img src={cdnUrl(url)} alt="" loading="lazy" decoding="async" style={thumbImg} onError={() => setFailed(true)} />
        : url && !failed ? null : <ImageOff size={16} />}
    </div>
  );
};

/** Object URL made only while the row is on screen (after a short pause, so fast scrolling decodes nothing), revoked as it leaves. */
const NewFileThumb: React.FC<{ file?: File; visible: boolean }> = ({ file, visible }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const canShow = previewable(file);
  useEffect(() => {
    if (!visible || !canShow || failed) return;
    let made: string | null = null;
    const t = setTimeout(() => {
      made = URL.createObjectURL(file!);
      setUrl(made);
    }, 120);
    return () => {
      clearTimeout(t);
      if (made) { URL.revokeObjectURL(made); setUrl(null); }
    };
  }, [visible, canShow, failed, file]);
  return (
    <div style={{ ...thumbBox, borderColor: 'rgba(212,175,55,0.35)' }} title="Fișierul nou">
      {url && !failed
        ? <img src={url} alt="" decoding="async" style={thumbImg} onError={() => setFailed(true)} />
        : (!canShow || failed) ? <ImageOff size={16} /> : null}
    </div>
  );
};

// ── One row ────────────────────────────────────────────────────────────────

const badge = (tone: 'gold' | 'muted' | 'warn'): React.CSSProperties => ({
  fontSize: '10px', fontWeight: 600, padding: '1px 6px', borderRadius: '999px', whiteSpace: 'nowrap',
  ...(tone === 'gold'
    ? { color: '#F3E3A6', backgroundColor: 'rgba(212,175,55,0.14)', border: '1px solid rgba(212,175,55,0.35)' }
    : tone === 'warn'
      ? { color: '#E3B4A8', backgroundColor: 'rgba(160,60,40,0.14)', border: '1px solid rgba(160,60,40,0.35)' }
      : { color: '#A3A09B', backgroundColor: '#262423', border: '1px solid #363433' }),
});

const segBtn = (active: boolean, disabled = false): React.CSSProperties => ({
  padding: '5px 9px', fontSize: '11px', fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
  border: `1px solid ${active ? '#D4AF37' : '#363433'}`,
  backgroundColor: active ? 'rgba(212, 175, 55, 0.18)' : 'transparent',
  color: disabled ? '#4A4846' : active ? '#F3E3A6' : '#A3A09B',
  borderRadius: '6px', whiteSpace: 'nowrap', fontFamily: 'inherit',
});

interface RowProps {
  pos: number;
  c: UploadConflict;
  file?: File;
  choice: ConflictAction;
  selected: boolean;
  observe: Observe;
  onToggle: (pos: number, shift: boolean) => void;
  onChoose: (pos: number, a: ConflictAction) => void;
}

const ConflictRow = memo(({ pos, c, file, choice, selected, observe, onToggle, onChoose }: RowProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return observe(el, v => { setVisible(v); if (v) setSeen(true); });
  }, [observe]);

  return (
    <div
      ref={ref}
      className={`ucd-row${selected ? ' is-selected' : ''}`}
      onClick={e => {
        // The action buttons have their own job; anywhere else toggles the row.
        if ((e.target as HTMLElement).closest('button, .ucd-seg')) return;
        onToggle(pos, e.shiftKey);
      }}
    >
      <input
        type="checkbox"
        className="ucd-check"
        checked={selected}
        onChange={() => { /* handled by the row click (shift = range) */ }}
        aria-label={`Selectează ${c.displayName}`}
      />
      <div className="ucd-thumbs">
        <ExistingThumb url={c.existingThumb} show={seen} />
        <ArrowRight size={12} style={{ color: '#4A4846', flexShrink: 0 }} />
        <NewFileThumb file={file} visible={visible} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '12px', color: '#D8D0C8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.displayName}>
          {c.displayName}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap', marginTop: '3px' }}>
          {c.identical === 'same' && (
            <span style={badge('gold')} title={c.existingName ? `Același fișier e deja încărcat ca „${c.existingName}”` : 'Același nume și aceeași mărime: e deja încărcată'}>
              {c.existingName ? `identică cu „${c.existingName}”` : 'identică'}
            </span>
          )}
          {c.identical === 'probable' && (
            <span style={badge('gold')} title="Același nume; poza existentă e mai veche și nu are mărimea salvată">probabil identică</span>
          )}
          {c.kind === 'batch' && <span style={badge('muted')} title="Un alt fișier din selecție are același nume">în selecție</span>}
          {c.kind === 'existing' && !c.replaceable && (
            <span style={badge('warn')} title={BLOCK_TITLE[c.replaceBlock ?? 'legacy']}>nu poate fi înlocuită</span>
          )}
          <span style={{ fontSize: '10px', color: '#706E6A', whiteSpace: 'nowrap' }}>{sizeText(c.existingSize, c.size)}</span>
        </div>
      </div>
      <div className="ucd-seg" role="radiogroup" aria-label={c.displayName}>
        {ACTIONS.map(a => {
          const disabled = a === 'replace' && !c.replaceable;
          return (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={choice === a}
              disabled={disabled}
              title={disabled ? BLOCK_TITLE[c.replaceBlock ?? 'legacy'] : undefined}
              style={segBtn(choice === a, disabled)}
              onClick={() => onChoose(pos, a)}
            >
              {ACTION_LABEL[a]}
            </button>
          );
        })}
      </div>
    </div>
  );
});
ConflictRow.displayName = 'ConflictRow';

// ── Dialog ─────────────────────────────────────────────────────────────────

export const UploadConflictDialog: React.FC<Props> = ({ label, totalFiles, autoSkipped, conflicts, files, onResolve }) => {
  const [choices, setChoices] = useState<ConflictAction[]>(() => conflicts.map(defaultAction));
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [filter, setFilter] = useState<Filter>('all');
  const [rowLimit, setRowLimit] = useState(ROW_STEP);
  const [notice, setNotice] = useState<string | null>(null);
  const anchorRef = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const observe = useRowObserver(listRef);

  const identicalCount = useMemo(() => conflicts.filter(c => c.identical).length, [conflicts]);
  const differentCount = conflicts.length - identicalCount;
  const existingCount = useMemo(() => conflicts.filter(c => c.kind === 'existing').length, [conflicts]);
  const batchCount = conflicts.length - existingCount;
  const freeCount = Math.max(0, totalFiles - autoSkipped - conflicts.length);

  // Positions (in `conflicts`) of the rows the current filter shows.
  const filtered = useMemo(() => {
    const out: number[] = [];
    conflicts.forEach((c, i) => {
      if (filter === 'all' || (filter === 'identical') === !!c.identical) out.push(i);
    });
    return out;
  }, [conflicts, filter]);
  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;

  const counts = useMemo(() => {
    const out: Record<ConflictAction, number> = { skip: 0, replace: 0, keepBoth: 0 };
    choices.forEach(a => { out[a]++; });
    return out;
  }, [choices]);

  const selectedCount = selected.size;
  const allSelected = filtered.length > 0 && selectedCount === filtered.length;
  const someSelected = selectedCount > 0 && !allSelected;

  // Escape cancels the whole upload (same as "Anulează"); a click on the
  // backdrop does not. Capture phase + stopPropagation: a modal underneath
  // (e.g. the class photos modal) must not close on the same key press.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onResolve(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onResolve]);

  const changeFilter = (f: Filter) => {
    setFilter(f);
    // The selection is what the filter shows: a bulk action never hits hidden rows.
    setSelected(new Set());
    anchorRef.current = null;
    setRowLimit(ROW_STEP);
    setNotice(null);
    if (listRef.current) listRef.current.scrollTop = 0;
  };

  const onToggle = useCallback((pos: number, shift: boolean) => {
    const anchor = anchorRef.current;
    const list = filteredRef.current;
    setSelected(prev => {
      const next = new Set(prev);
      const on = !prev.has(pos);
      const a = shift && anchor !== null ? list.indexOf(anchor) : -1;
      const b = a >= 0 ? list.indexOf(pos) : -1;
      if (a >= 0 && b >= 0) {
        for (let k = Math.min(a, b); k <= Math.max(a, b); k++) {
          if (on) next.add(list[k]); else next.delete(list[k]);
        }
      } else if (on) next.add(pos); else next.delete(pos);
      return next;
    });
    anchorRef.current = pos;
  }, []);

  const onChoose = useCallback((pos: number, a: ConflictAction) => {
    setChoices(prev => {
      if (prev[pos] === a) return prev;
      const next = [...prev];
      next[pos] = a;
      return next;
    });
  }, []);

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(filtered));
    anchorRef.current = null;
  };

  // ── Bulk: every row ──
  const setAll = (fn: (c: UploadConflict) => ConflictAction, message: string | null) => {
    setChoices(conflicts.map(fn));
    setNotice(message);
  };
  const skipAll = () => setAll(() => 'skip', null);
  const replaceAll = () => {
    const blocked = conflicts.filter(c => !c.replaceable);
    if (blocked.length === 0) { setAll(() => 'replace', null); return; }
    const kept = blocked.filter(c => !c.identical).length;
    const skipped = blocked.length - kept;
    setAll(replaceAllAction,
      `${blocked.length} nu pot fi înlocuite (${blockedSummary(blocked)})` +
      (kept ? ` — ${kept} se ${kept === 1 ? 'păstrează ca copie' : 'păstrează ca copii'}` : '') +
      (skipped ? `${kept ? ',' : ' —'} ${skipped} ${skipped === 1 ? 'identică e sărită' : 'identice sunt sărite'}` : '') + '.');
  };
  const keepAll = () => setAll(
    c => (c.identical ? 'skip' : 'keepBoth'),
    identicalCount > 0
      ? `Fișierele identice rămân pe „Sari peste” (${identicalCount}); pentru o copie a lor, selectează-le și alege „Păstrează ambele selectate”.`
      : null
  );

  // ── Bulk: selected rows ──
  const applySelected = (a: ConflictAction) => {
    if (selectedCount === 0) return;
    const sel = Array.from(selected);
    const blocked = a === 'replace' ? sel.map(i => conflicts[i]).filter(c => !c.replaceable) : [];
    setChoices(prev => {
      const next = [...prev];
      sel.forEach(i => { if (a !== 'replace' || conflicts[i].replaceable) next[i] = a; });
      return next;
    });
    setNotice(blocked.length > 0
      ? `${blocked.length} din cele selectate nu pot fi înlocuite și au rămas neschimbate: ${blockedSummary(blocked)}.`
      : null);
  };

  // ── Incremental rendering ──
  const shown = filtered.slice(0, rowLimit);
  const hiddenRows = filtered.length - shown.length;
  const onListScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (hiddenRows <= 0) return;
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 600) setRowLimit(l => l + ROW_STEP);
  };

  const title = identicalCount === conflicts.length
    ? (identicalCount === 1 ? 'O fotografie e deja încărcată' : `${identicalCount} fotografii sunt deja încărcate`)
    : existingCount > 0
      ? (existingCount === 1 ? 'O fotografie există deja' : `${existingCount} fotografii există deja`)
      : (batchCount === 1 ? 'Un fișier are același nume cu altul din selecție' : `${batchCount} fișiere au același nume cu altele din selecție`);

  const chip = (f: Filter, text: string, n: number) => (
    <button
      type="button"
      onClick={() => changeFilter(f)}
      aria-pressed={filter === f}
      style={{
        ...segBtn(filter === f),
        borderRadius: '999px', padding: '4px 10px',
      }}
    >
      {text} <span style={{ opacity: 0.7, fontWeight: 400 }}>{n}</span>
    </button>
  );

  const bulkBtn = (text: string, onClick: () => void, hintText: string, variant: 'primary' | 'gold' | 'plain', disabled = false) => (
    <button
      type="button"
      onClick={onClick}
      title={hintText}
      disabled={disabled}
      className={`ucd-bulk ucd-bulk-${variant}`}
    >
      {text}
    </button>
  );

  const anyReplaceable = useMemo(() => conflicts.some(c => c.replaceable), [conflicts]);

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
        className="ucd-dialog"
        onClick={e => e.stopPropagation()}
        style={{
          backgroundColor: '#1C1A19', border: '1px solid #2D2A28', borderRadius: '12px',
          padding: '24px', width: '780px', maxWidth: '100%', maxHeight: '92vh',
          display: 'flex', flexDirection: 'column', minHeight: 0,
          boxShadow: '0 24px 60px rgba(0,0,0,0.7)', color: '#FAF9F6', fontFamily: 'Outfit, sans-serif',
        }}
      >
        {/* Icon + title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' }}>
          <div style={{
            width: '40px', height: '40px', borderRadius: '50%', flexShrink: 0,
            backgroundColor: 'rgba(212,175,55,0.15)', border: '1px solid rgba(212,175,55,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <AlertCircle size={20} style={{ color: '#D4AF37' }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <h3 id="upload-conflict-title" style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>{title}</h3>
            <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#A3A09B' }}>
              {existingCount > 0 && <>Au același nume ca pozele din {label ? <strong style={{ color: '#D8D0C8' }}>{label}</strong> : 'destinație'}. </>}
              {identicalCount > 0 && <>{identicalCount === 1 ? 'Una pare identică' : `${identicalCount} par identice`} (marcate „identică”, implicit „Sari peste”). </>}
              {freeCount > 0 && <>{freeCount} {fisiereWord(freeCount)} {freeCount === 1 ? 'nou se încarcă' : 'noi se încarcă'} oricum.</>}
              {autoSkipped > 0 && <> {autoSkipped} {fisiereWord(autoSkipped)} deja în coadă {autoSkipped === 1 ? 'este sărit' : 'sunt sărite'}.</>}
            </p>
          </div>
        </div>

        {/* Quick: every row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', margin: '14px 0 10px' }}>
          {bulkBtn('Sari peste toate', skipAll, 'Pozele existente rămân neschimbate; se încarcă doar fișierele noi', 'primary')}
          {bulkBtn(
            'Înlocuiește toate',
            replaceAll,
            anyReplaceable
              ? 'Pozele noi le înlocuiesc pe cele vechi, în aceeași poziție și în același folder. Selecțiile deja trimise rămân valabile; la descărcare se livrează originalul nou.'
              : `Niciuna nu poate fi înlocuită: ${blockedSummary(conflicts)}.`,
            'gold',
            !anyReplaceable
          )}
          {bulkBtn('Păstrează toate', keepAll, 'Se încarcă și fișierele cu nume repetat, cu nume nou (ex. „Nume (2).jpg”); cele identice rămân sărite', 'plain')}
        </div>

        {/* Selection toolbar */}
        <div className="ucd-toolbar">
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px', color: '#D8D0C8', userSelect: 'none' }}>
            <input
              type="checkbox"
              className="ucd-check"
              checked={allSelected}
              ref={el => { if (el) el.indeterminate = someSelected; }}
              onChange={toggleAll}
              disabled={filtered.length === 0}
            />
            {selectedCount > 0 ? `${selectedCount} ${selectedCount === 1 ? 'selectată' : 'selectate'}` : 'Selectează toate'}
          </label>
          {identicalCount > 0 && differentCount > 0 && (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {chip('all', 'Toate', conflicts.length)}
              {chip('identical', 'Identice', identicalCount)}
              {chip('different', 'Diferite', differentCount)}
            </div>
          )}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginLeft: 'auto' }}>
            <button type="button" disabled={selectedCount === 0} style={segBtn(false, selectedCount === 0)} onClick={() => applySelected('replace')}>Înlocuiește selectate</button>
            <button type="button" disabled={selectedCount === 0} style={segBtn(false, selectedCount === 0)} onClick={() => applySelected('skip')}>Sari peste selectate</button>
            <button type="button" disabled={selectedCount === 0} style={segBtn(false, selectedCount === 0)} onClick={() => applySelected('keepBoth')}>Păstrează ambele selectate</button>
          </div>
        </div>

        {notice && (
          <p role="status" aria-live="polite" style={{ margin: '0 0 8px', fontSize: '11px', color: '#E3B4A8', lineHeight: 1.45 }}>{notice}</p>
        )}

        {/* Rows */}
        <div
          ref={listRef}
          onScroll={onListScroll}
          style={{
            backgroundColor: '#121110', border: '1px solid #262423', borderRadius: '8px',
            overflowY: 'auto', flex: '1 1 auto', minHeight: '140px', maxHeight: '52vh',
          }}
        >
          {shown.map(pos => {
            const c = conflicts[pos];
            return (
              <ConflictRow
                key={c.index}
                pos={pos}
                c={c}
                file={files[c.index]}
                choice={choices[pos]}
                selected={selected.has(pos)}
                observe={observe}
                onToggle={onToggle}
                onChoose={onChoose}
              />
            );
          })}
          {hiddenRows > 0 && (
            <div style={{ padding: '10px 0', textAlign: 'center' }}>
              <button type="button" style={segBtn(false)} onClick={() => setRowLimit(l => l + ROW_STEP)}>
                Arată încă {Math.min(ROW_STEP, hiddenRows)} (din {hiddenRows} rămase)
              </button>
              <div style={{ fontSize: '10px', color: '#706E6A', marginTop: '4px' }}>
                Cele neafișate încă păstrează alegerea curentă (implicit „Sari peste”{batchCount > 0 ? '; numele repetate din selecție: „Păstrează ambele”' : ''}) și sunt incluse în „Selectează toate”.
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '14px', flexWrap: 'wrap' }}>
          <p style={{ fontSize: '12px', color: '#A3A09B', margin: 0, flex: '1 1 260px' }} aria-live="polite">
            <strong style={{ color: '#D8D0C8', fontWeight: 600 }}>{counts.replace}</strong> {counts.replace === 1 ? 'înlocuită' : 'înlocuite'}
            {' · '}<strong style={{ color: '#D8D0C8', fontWeight: 600 }}>{counts.skip}</strong> {counts.skip === 1 ? 'sărită' : 'sărite'}
            {' · '}<strong style={{ color: '#D8D0C8', fontWeight: 600 }}>{counts.keepBoth}</strong> păstrate ambele
            {' · '}<strong style={{ color: '#D8D0C8', fontWeight: 600 }}>{freeCount}</strong> {freeCount === 1 ? 'nou' : 'noi'}
          </p>
          <div style={{ display: 'flex', gap: '10px', marginLeft: 'auto' }}>
            <button
              type="button"
              onClick={() => onResolve(null)}
              title="Nu se încarcă nimic din această selecție"
              style={{ padding: '10px 16px', borderRadius: '8px', border: '1px solid transparent', backgroundColor: 'transparent', color: '#8A8784', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#FAF9F6')}
              onMouseLeave={e => (e.currentTarget.style.color = '#8A8784')}
            >
              Anulează
            </button>
            <button
              type="button"
              onClick={() => onResolve(choices)}
              style={{ padding: '10px 22px', borderRadius: '8px', border: 'none', backgroundColor: '#5f0b02', color: '#FAF9F6', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#7a0c00')}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#5f0b02')}
            >
              Continuă
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GripVertical, ChevronUp, ChevronDown, RefreshCw, Check } from 'lucide-react';
import { saveClassOrder, type SortableClass } from '../../utils/classOrder';

interface ReorderableClass extends SortableClass {
  schoolName: string;
}

interface ClassReorderListProps<T extends ReorderableClass> {
  /** Every class (never a search result), already in the current custom order. */
  classes: T[];
  /** Secondary line under the name (e.g. all diriginti). */
  subtitleOf: (cls: T) => string;
  onDone: () => void;
}

/**
 * Drag-and-drop editor for the custom class order. Dragging uses pointer
 * events on the grip handle, so it works the same with mouse, touch and pen
 * (native HTML5 drag does not work with touch on most phones). The up/down
 * buttons are the keyboard / precise alternative. Nothing is written until
 * "Salvează ordinea"; then only class docs whose position changed are updated.
 */
export function ClassReorderList<T extends ReorderableClass>({ classes, subtitleOf, onDone }: ClassReorderListProps<T>) {
  // Snapshot of the order when editing started (for "unsaved changes" detection).
  const [initialIds] = useState<string[]>(() => classes.map(c => c.id));
  const [order, setOrder] = useState<string[]>(initialIds);
  const [dragId, setDragId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // The list stays live while editing: a class deleted elsewhere drops out, a
  // class created elsewhere is appended at the end.
  const byId = useMemo(() => new Map(classes.map(c => [c.id, c])), [classes]);
  const ids = useMemo(() => {
    const present = order.filter(id => byId.has(id));
    const known = new Set(present);
    return [...present, ...classes.filter(c => !known.has(c.id)).map(c => c.id)];
  }, [order, byId, classes]);

  // Pointer moves can arrive faster than re-renders; always move against the latest list.
  const idsRef = useRef(ids);
  idsRef.current = ids;

  const dirty = ids.length !== initialIds.length || ids.some((id, i) => id !== initialIds[i]);

  const move = (from: number, to: number) => {
    const cur = idsRef.current;
    if (from === to || from < 0 || to < 0 || from >= cur.length || to >= cur.length) return;
    const next = [...cur];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    idsRef.current = next;
    setOrder(next);
  };

  const onHandlePointerDown = (e: React.PointerEvent<HTMLElement>, id: string) => {
    if (saving) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault(); // no text selection / native image drag
    setDragId(id);
  };

  // While dragging, follow the pointer at window level. Deliberately no
  // setPointerCapture on the handle: React moves row DOM nodes when the order
  // changes, and a moved node loses its capture, which would end the drag
  // after the first step.
  useEffect(() => {
    if (!dragId) return;
    const onMove = (e: PointerEvent) => {
      // Keep the dragged row reachable in long lists: scroll near the viewport edges.
      const edge = 72;
      if (e.clientY < edge) window.scrollBy(0, -14);
      else if (e.clientY > window.innerHeight - edge) window.scrollBy(0, 14);

      const el = document.elementFromPoint(e.clientX, e.clientY);
      const row = el instanceof Element ? el.closest<HTMLElement>('[data-reorder-id]') : null;
      const overId = row?.dataset.reorderId;
      if (!overId || overId === dragId) return;
      const cur = idsRef.current;
      const from = cur.indexOf(dragId);
      const to = cur.indexOf(overId);
      if (from < 0 || to < 0) return;
      const next = [...cur];
      next.splice(from, 1);
      next.splice(to, 0, dragId);
      idsRef.current = next;
      setOrder(next);
    };
    const onEnd = () => setDragId(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    window.addEventListener('blur', onEnd);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      window.removeEventListener('blur', onEnd);
    };
  }, [dragId]);

  const cancel = () => {
    if (saving) return;
    if (dirty && !window.confirm('Renunți la modificările făcute în ordinea claselor?')) return;
    onDone();
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const ordered = idsRef.current.map(id => byId.get(id)).filter((c): c is T => !!c);
      await saveClassOrder(ordered);
      onDone();
    } catch (err: any) {
      console.error('Save class order failed:', err);
      setError(`Ordinea nu a putut fi salvată: ${err?.message || err}. Încearcă din nou.`);
      setSaving(false);
    }
  };

  return (
    <div className="ad-frame">
      <div className="ad-core crl-core">
        <div className="crl-head">
          <div style={{ minWidth: 0 }}>
            <div className="crl-title">Ordine personalizată</div>
            <div className="crl-hint">
              Trage de <GripVertical size={12} strokeWidth={1.6} style={{ verticalAlign: '-2px' }} /> (sau folosește săgețile) ca să muți clasele. Ordinea se salvează pentru toate dispozitivele.
            </div>
          </div>
          <div className="crl-actions">
            <button type="button" className="ad-btn ad-btn-quiet" onClick={cancel} disabled={saving}>Anulează</button>
            <button type="button" className="ad-btn ad-btn-quiet crl-save" onClick={save} disabled={saving}>
              {saving ? <RefreshCw size={13} className="spinner" /> : <Check size={13} strokeWidth={1.8} />}
              {saving ? 'Se salvează...' : 'Salvează ordinea'}
            </button>
          </div>
        </div>
        {error && <p className="roster-modal-msg is-error" role="alert" style={{ margin: '0 20px 12px' }}>{error}</p>}

        <div className="crl-list" role="list">
          {ids.map((id, idx) => {
            const cls = byId.get(id);
            if (!cls) return null;
            return (
              <div
                key={id}
                role="listitem"
                data-reorder-id={id}
                className={`crl-row${dragId === id ? ' is-dragging' : ''}`}
              >
                <span
                  className="crl-grip"
                  role="button"
                  tabIndex={-1}
                  aria-label={`Trage pentru a muta ${cls.schoolName}`}
                  title="Trage pentru a muta"
                  onPointerDown={(e) => onHandlePointerDown(e, id)}
                >
                  <GripVertical size={16} strokeWidth={1.5} />
                </span>
                <span className="crl-pos ad-num">{idx + 1}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="ad-row-name crl-name" title={cls.schoolName}>{cls.schoolName}</div>
                  <div className="ad-row-sub crl-name">{subtitleOf(cls)}</div>
                </div>
                <div className="crl-move">
                  <button
                    type="button"
                    className="ad-icon-btn"
                    onClick={() => move(idx, idx - 1)}
                    disabled={idx === 0 || saving}
                    aria-label={`Mută mai sus: ${cls.schoolName}`}
                    title="Mută mai sus"
                  >
                    <ChevronUp size={14} strokeWidth={1.6} />
                  </button>
                  <button
                    type="button"
                    className="ad-icon-btn"
                    onClick={() => move(idx, idx + 1)}
                    disabled={idx === ids.length - 1 || saving}
                    aria-label={`Mută mai jos: ${cls.schoolName}`}
                    title="Mută mai jos"
                  >
                    <ChevronDown size={14} strokeWidth={1.6} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <style>{`
        .crl-core { padding: 0; }
        .crl-head {
          display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;
          padding: 14px 20px; border-bottom: 1px solid var(--s-hairline);
        }
        .crl-title { font-size: 13.5px; font-weight: 600; color: var(--t-hi); }
        .crl-hint { font-size: 11.5px; color: var(--t-muted); margin-top: 3px; line-height: 1.5; }
        .crl-actions { display: flex; gap: 8px; flex-shrink: 0; }
        .crl-actions .ad-btn:disabled { opacity: 0.6; cursor: default; }
        .crl-save { color: var(--a-data); border-color: var(--a-data-line); }
        .crl-list { display: flex; flex-direction: column; }
        .crl-row {
          display: flex; align-items: center; gap: 12px;
          padding: 9px 16px 9px 8px;
          border-bottom: 1px solid #1B1918;
          background: transparent;
          transition: background-color 0.15s;
          user-select: none; -webkit-user-select: none;
        }
        .crl-row:last-child { border-bottom: none; }
        .crl-row.is-dragging { background: #221F1D; box-shadow: inset 2px 0 0 var(--a-data); }
        .crl-grip {
          width: 40px; height: 40px; flex-shrink: 0;
          display: inline-flex; align-items: center; justify-content: center;
          border-radius: 8px; color: var(--t-muted);
          cursor: grab; touch-action: none;
        }
        .crl-grip:hover { color: var(--t-hi); background: var(--s-overlay); }
        .crl-row.is-dragging .crl-grip { cursor: grabbing; color: var(--a-data); }
        .crl-pos { width: 26px; flex-shrink: 0; text-align: right; font-size: 12px; color: var(--t-faint); }
        .crl-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .crl-move { display: flex; gap: 6px; flex-shrink: 0; }
        .crl-move .ad-icon-btn { width: 32px; height: 32px; }
        .crl-move .ad-icon-btn:disabled { opacity: 0.3; cursor: default; }
      `}</style>
    </div>
  );
}

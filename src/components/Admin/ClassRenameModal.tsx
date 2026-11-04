import React, { useState } from 'react';
import { X, RefreshCw } from 'lucide-react';
import {
  renameClass, validateClassName, findClassesWithSameName, normalizeClassName,
  ClassRenameError, CLASS_NAME_MAX_LENGTH,
} from '../../utils/classRename';

interface RenameableClass {
  id: string;
  schoolName: string;
  diriginteName?: string;
}

interface ClassRenameModalProps {
  cls: RenameableClass;
  /** All classes, for the (non-blocking) duplicate-name warning. */
  classes: RenameableClass[];
  onClose: () => void;
}

/**
 * Renames a class at any time (active, locked, past deadline — no restriction).
 * Only the displayed name changes; links, QR codes, photos and selections are
 * all keyed by the class id. Styling reuses the roster modal classes defined in
 * AdminDashboard's style block (this modal is only rendered inside it).
 */
export const ClassRenameModal: React.FC<ClassRenameModalProps> = ({ cls, classes, onClose }) => {
  const [value, setValue] = useState(cls.schoolName || '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const liveError = validateClassName(value, cls.schoolName);
  const duplicates = liveError ? [] : findClassesWithSameName(value, classes, cls.id);
  const canSave = !saving && !liveError;

  const close = () => { if (!saving) onClose(); };

  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    setSaveError('');
    try {
      await renameClass(cls.id, value);
      onClose();
    } catch (err: any) {
      console.error('Rename class failed:', err);
      setSaveError(err instanceof ClassRenameError
        ? err.message
        : `Numele nu a putut fi salvat: ${err?.message || err}. Verifică conexiunea și încearcă din nou.`);
      setSaving(false);
    }
  };

  return (
    <div className="admin-modal-overlay" style={{ zIndex: 1100 }} onClick={close}>
      <div className="admin-modal-card" style={{ maxWidth: '480px' }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="class-rename-title">
        <div className="admin-modal-header" style={{ padding: '16px 20px' }}>
          <h3 id="class-rename-title" style={{ margin: 0, fontSize: '16px' }}>Redenumește clasa</h3>
          <button type="button" className="admin-modal-close" onClick={close} disabled={saving} aria-label="Închide">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); submit(); }} style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <p className="roster-modal-note">
              Nume actual: <strong style={{ color: 'var(--t-hi)' }}>{cls.schoolName}</strong>
              {cls.diriginteName ? <> · {cls.diriginteName}</> : null}
            </p>
            <label htmlFor="class-rename-input" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--t-muted)' }}>
              Numele clasei
            </label>
            <input
              id="class-rename-input"
              type="text"
              className={`roster-name-input${liveError && normalizeClassName(value) !== (cls.schoolName || '').trim() ? ' has-error' : ''}`}
              value={value}
              onChange={(e) => { setValue(e.target.value); if (saveError) setSaveError(''); }}
              onFocus={(e) => e.currentTarget.select()}
              disabled={saving}
              placeholder="Ex: Colegiul Național Mihai Eminescu — XII A"
              maxLength={CLASS_NAME_MAX_LENGTH + 20}
              autoFocus
            />
            {liveError && normalizeClassName(value) !== (cls.schoolName || '').trim() && (
              <p className="roster-modal-msg is-error" role="alert">{liveError}</p>
            )}
            {duplicates.length > 0 && (
              <p className="roster-modal-msg is-warn" role="status">
                Atenție: mai există {duplicates.length === 1 ? 'o clasă' : `${duplicates.length} clase`} cu acest nume
                {' ('}{duplicates.slice(0, 3).map(d => d.diriginteName ? `${d.schoolName} — ${d.diriginteName}` : d.schoolName).join('; ')}{duplicates.length > 3 ? '; …' : ''}{')'}.
                {' '}Poți salva oricum, dar le vei deosebi mai greu în listă.
              </p>
            )}
            {!saving && !saveError && (
              <p className="roster-modal-note">
                Se schimbă doar numele afișat. Linkurile și codurile QR trimise elevilor, pozele și selecțiile rămân neschimbate,
                indiferent dacă clasa este activă, blocată sau cu termenul depășit. Exporturile (ZIP, Excel) vor folosi noul nume.
              </p>
            )}
            {saving && (
              <p className="roster-modal-note" role="status" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <RefreshCw size={14} className="spinner" /> Se salvează...
              </p>
            )}
            {saveError && <p className="roster-modal-msg is-error" role="alert">{saveError}</p>}
          </div>

          <div className="admin-modal-footer" style={{ padding: '14px 20px', gap: '8px' }}>
            <button type="button" className="btn btn-secondary" onClick={close} disabled={saving} style={{ padding: '8px 16px', fontSize: '12px' }}>
              Anulează
            </button>
            <button
              type="submit"
              className="btn btn-gold"
              disabled={!canSave}
              style={{ padding: '8px 18px', fontSize: '12px', opacity: canSave ? 1 : 0.6 }}
            >
              {saving ? 'Se salvează...' : 'Salvează'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

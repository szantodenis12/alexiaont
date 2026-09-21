import React, { useEffect, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import { checkFolderPin } from '../../utils/folderLock';

interface Props {
  galleryId: string;
  subId: string;
  folderName: string;
  pinHash: string;
  onUnlock: () => void;
}

const MAX_TRIES = 5;
const COOLDOWN_S = 30;

/**
 * Shown in place of a PIN-locked folder's photos on the public gallery and the
 * selection page. Wrong attempts are throttled: after five, the form pauses for
 * 30 seconds, so the 10,000 possible PINs can't simply be run through.
 */
export const FolderLockPanel: React.FC<Props> = ({ galleryId, subId, folderName, pinHash, onUnlock }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [tries, setTries] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fresh state when the viewer switches to a different locked folder.
  useEffect(() => {
    setPin('');
    setError('');
  }, [subId]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (cooldown > 0 || checking) return;
    if (pin.length !== 4) {
      setError('Codul are 4 cifre.');
      return;
    }
    setChecking(true);
    const ok = await checkFolderPin(galleryId, subId, pin, pinHash);
    setChecking(false);
    if (ok) {
      setError('');
      onUnlock();
      return;
    }
    const next = tries + 1;
    setPin('');
    if (next >= MAX_TRIES) {
      setTries(0);
      setCooldown(COOLDOWN_S);
      setError(`Prea multe încercări greșite. Mai încearcă peste ${COOLDOWN_S} de secunde.`);
    } else {
      setTries(next);
      setError('Cod greșit. Încearcă din nou.');
    }
    inputRef.current?.focus();
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '64px 20px' }}>
      <form
        onSubmit={submit}
        style={{
          width: '100%', maxWidth: '360px', textAlign: 'center',
          backgroundColor: '#161514', border: '1px solid #2D2A28', borderRadius: '10px',
          padding: '32px 24px', boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
        }}
      >
        <div style={{
          width: '52px', height: '52px', borderRadius: '50%', margin: '0 auto 16px',
          backgroundColor: 'rgba(212, 175, 55, 0.1)', color: 'var(--gold-accent, #D4AF37)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Lock size={22} />
        </div>
        <h3 style={{ margin: '0 0 6px', fontSize: '18px', fontWeight: 600, color: '#FAF9F6' }}>
          Acest folder este blocat
        </h3>
        <p style={{ margin: '0 0 20px', fontSize: '13px', color: '#A3A09B', lineHeight: 1.5 }}>
          „{folderName}” este protejat. Introdu codul PIN primit de la fotograf pentru deblocare.
        </p>

        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          pattern="[0-9]*"
          maxLength={4}
          value={pin}
          disabled={cooldown > 0}
          onChange={e => { setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setError(''); }}
          placeholder="••••"
          aria-label="Cod PIN din 4 cifre"
          style={{
            width: '160px', padding: '12px', textAlign: 'center', letterSpacing: '0.6em',
            fontSize: '22px', fontWeight: 600, color: '#FAF9F6',
            backgroundColor: '#0E0D0C', border: `1px solid ${error ? '#E06C75' : '#2D2A28'}`,
            borderRadius: '8px', outline: 'none', boxSizing: 'border-box',
          }}
        />

        {error && <p style={{ margin: '10px 0 0', fontSize: '12px', color: '#E06C75' }}>{error}</p>}

        <button
          type="submit"
          disabled={cooldown > 0 || checking || pin.length !== 4}
          style={{
            display: 'block', width: '100%', marginTop: '18px', padding: '12px',
            backgroundColor: 'var(--gold-accent, #D4AF37)', color: '#121110', border: 'none',
            borderRadius: '6px', fontSize: '14px', fontWeight: 600,
            cursor: cooldown > 0 || pin.length !== 4 ? 'not-allowed' : 'pointer',
            opacity: cooldown > 0 || pin.length !== 4 ? 0.5 : 1,
          }}
        >
          {cooldown > 0 ? `Așteaptă ${cooldown}s` : checking ? 'Se verifică...' : 'Deblochează'}
        </button>
      </form>
    </div>
  );
};

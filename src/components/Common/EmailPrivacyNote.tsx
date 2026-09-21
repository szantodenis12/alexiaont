import React from 'react';
import { ShieldCheck } from 'lucide-react';

/**
 * Reassurance shown under every "enter your email to download" prompt.
 *
 * Clients were worried the prompt was a phishing attempt on their email
 * account. Keep the wording truthful: the address IS stored (it appears in the
 * photographer's download log), so never claim it is not saved.
 */
export const EmailPrivacyNote: React.FC = () => (
  <div
    style={{
      display: 'flex',
      gap: '10px',
      alignItems: 'flex-start',
      marginTop: '16px',
      padding: '12px 14px',
      backgroundColor: 'rgba(46, 204, 113, 0.06)',
      border: '1px solid rgba(46, 204, 113, 0.18)',
      borderRadius: '6px',
      textAlign: 'left',
    }}
  >
    <ShieldCheck size={18} style={{ color: '#2ECC71', flexShrink: 0, marginTop: '1px' }} />
    <p style={{ margin: 0, fontSize: '12px', lineHeight: 1.5, color: '#A3A09B' }}>
      Îți cerem emailul doar ca să protejăm galeria de descărcări abuzive.{' '}
      <strong style={{ color: '#E5DFD9' }}>Nu îți cerem parola și nu avem acces la contul tău.</strong>{' '}
      Adresa o vede doar fotograful, nu o folosim în alte scopuri și nu o dăm nimănui.
    </p>
  </div>
);

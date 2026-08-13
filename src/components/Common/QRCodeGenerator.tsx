import React, { useState, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Download, Palette, Check } from 'lucide-react';

interface QRCodeGeneratorProps {
  value: string; // Target URL e.g. https://.../v/submissionId
  studentName?: string;
  size?: number;
  showDownloadButton?: boolean;
}

const PRESET_FG_COLORS = [
  { name: 'Auriu Gold', hex: '#D4AF37' },
  { name: 'Negru', hex: '#000000' },
  { name: 'Alb', hex: '#FFFFFF' },
  { name: 'Bordo', hex: '#5F0B02' },
  { name: 'Albastru', hex: '#1E3A8A' },
  { name: 'Smarald', hex: '#059669' },
];

const PRESET_BG_COLORS = [
  { name: 'Dark', hex: '#0C0B0A' },
  { name: 'Alb', hex: '#FFFFFF' },
  { name: 'Crem', hex: '#FAF9F6' },
];

export const QRCodeGenerator: React.FC<QRCodeGeneratorProps> = ({
  value,
  studentName,
  size = 180,
  showDownloadButton = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const [fgColor, setFgColor] = useState<string>('#D4AF37');
  const [bgColor, setBgColor] = useState<string>('#0C0B0A');
  const [transparentBg, setTransparentBg] = useState<boolean>(false);
  const [showColorPicker, setShowColorPicker] = useState<boolean>(false);

  const handleDownloadPNG = () => {
    if (!containerRef.current) return;
    const svgElement = containerRef.current.querySelector('svg');
    if (!svgElement) return;

    const svgData = new XMLSerializer().serializeToString(svgElement);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    const scale = 3; // High resolution 3x scale for crisp print
    canvas.width = size * scale;
    canvas.height = size * scale;

    img.onload = () => {
      if (ctx) {
        if (!transparentBg) {
          ctx.fillStyle = bgColor;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        } else {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const pngUrl = canvas.toDataURL('image/png');
        const downloadLink = document.createElement('a');
        const safeName = (studentName || 'mesaj_vocal').replace(/[^a-z0-9]/gi, '_');
        downloadLink.download = `cod_qr_${safeName}.png`;
        downloadLink.href = pngUrl;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
      }
    };

    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  };

  const encodedIconColor = encodeURIComponent(fgColor);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '14px',
        backgroundColor: '#161514',
        border: '1px solid #262423',
        borderRadius: '12px',
        padding: '16px',
        width: 'fit-content',
        boxSizing: 'border-box',
      }}
    >
      {/* QR Code Container */}
      <div
        ref={containerRef}
        style={{
          padding: '14px',
          backgroundColor: transparentBg ? 'transparent' : bgColor,
          backgroundImage: transparentBg
            ? 'linear-gradient(45deg, #1f1d1b 25%, transparent 25%), linear-gradient(-45deg, #1f1d1b 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1f1d1b 75%), linear-gradient(-45deg, transparent 75%, #1f1d1b 75%)'
            : 'none',
          backgroundSize: '16px 16px',
          backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
          borderRadius: '8px',
          border: '1px solid #2A2826',
          boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          transition: 'background-color 0.2s ease',
        }}
      >
        <QRCodeSVG
          value={value}
          size={size}
          bgColor={transparentBg ? 'transparent' : bgColor}
          fgColor={fgColor}
          level="H"
          includeMargin={false}
          imageSettings={{
            src: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${encodedIconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M6 6v12M18 6v12M3 10v4M21 10v4"/></svg>`,
            x: undefined,
            y: undefined,
            height: 24,
            width: 24,
            excavate: true,
          }}
        />
        <span
          style={{
            fontSize: '9px',
            color: fgColor,
            opacity: 0.8,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            marginTop: '8px',
            fontWeight: 600,
          }}
        >
          SCAN TO PLAY AUDIO
        </span>
      </div>

      {/* Toggle Color Customizer Button */}
      <button
        type="button"
        onClick={() => setShowColorPicker(!showColorPicker)}
        style={{
          padding: '4px 10px',
          backgroundColor: '#201E1C',
          color: '#A3A09B',
          border: '1px solid #2D2A28',
          borderRadius: '6px',
          fontSize: '11px',
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}
      >
        <Palette size={12} style={{ color: fgColor }} />
        {showColorPicker ? 'Ascunde Personalizare' : 'Personalizează Culori QR'}
      </button>

      {/* Color Customizer Drawer */}
      {showColorPicker && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            backgroundColor: '#0E0D0C',
            border: '1px solid #262423',
            borderRadius: '8px',
            padding: '12px',
            width: '100%',
            maxWidth: '240px',
            boxSizing: 'border-box',
          }}
        >
          {/* Foreground Color Selection */}
          <div>
            <label style={{ fontSize: '10px', textTransform: 'uppercase', color: '#706E6A', fontWeight: 700, display: 'block', marginBottom: '6px' }}>
              Culoare Cod QR
            </label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
              {PRESET_FG_COLORS.map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  onClick={() => setFgColor(c.hex)}
                  title={c.name}
                  style={{
                    width: '22px',
                    height: '22px',
                    borderRadius: '50%',
                    backgroundColor: c.hex,
                    border: fgColor === c.hex ? '2px solid #FAF9F6' : '1px solid #3A3835',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {fgColor === c.hex && <Check size={10} style={{ color: c.hex === '#FFFFFF' || c.hex === '#FAF9F6' || c.hex === '#D4AF37' ? '#000' : '#FFF' }} />}
                </button>
              ))}
              <input
                type="color"
                value={fgColor}
                onChange={(e) => setFgColor(e.target.value)}
                style={{ width: '24px', height: '24px', padding: 0, border: 'none', borderRadius: '4px', cursor: 'pointer', backgroundColor: 'transparent' }}
                title="Alege culoare personalizată"
              />
            </div>
          </div>

          {/* Background Color Selection */}
          <div>
            <label style={{ fontSize: '10px', textTransform: 'uppercase', color: '#706E6A', fontWeight: 700, display: 'block', marginBottom: '6px' }}>
              Culoare Fundal
            </label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
              {PRESET_BG_COLORS.map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  onClick={() => {
                    setTransparentBg(false);
                    setBgColor(c.hex);
                  }}
                  title={c.name}
                  style={{
                    width: '22px',
                    height: '22px',
                    borderRadius: '50%',
                    backgroundColor: c.hex,
                    border: !transparentBg && bgColor === c.hex ? '2px solid #D4AF37' : '1px solid #3A3835',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {!transparentBg && bgColor === c.hex && <Check size={10} style={{ color: c.hex === '#FFFFFF' || c.hex === '#FAF9F6' ? '#000' : '#FFF' }} />}
                </button>
              ))}
              <input
                type="color"
                value={bgColor}
                onChange={(e) => {
                  setTransparentBg(false);
                  setBgColor(e.target.value);
                }}
                style={{ width: '24px', height: '24px', padding: 0, border: 'none', borderRadius: '4px', cursor: 'pointer', backgroundColor: 'transparent' }}
                title="Alege culoare fundal personalizată"
              />
            </div>
          </div>

          {/* Transparent Checkbox */}
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: '#FAF9F6', cursor: 'pointer', marginTop: '2px' }}>
            <input
              type="checkbox"
              checked={transparentBg}
              onChange={(e) => setTransparentBg(e.target.checked)}
              style={{ accentColor: '#D4AF37', cursor: 'pointer' }}
            />
            <span>Fundal Transparent (PNG)</span>
          </label>
        </div>
      )}

      {/* Download PNG Button */}
      {showDownloadButton && (
        <button
          type="button"
          onClick={handleDownloadPNG}
          style={{
            padding: '8px 14px',
            backgroundColor: '#5f0b02',
            color: '#FAF9F6',
            border: 'none',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            transition: 'background-color 0.15s ease',
            width: '100%',
            justifyContent: 'center',
          }}
        >
          <Download size={14} /> Descarcă Cod QR (PNG)
        </button>
      )}
    </div>
  );
};

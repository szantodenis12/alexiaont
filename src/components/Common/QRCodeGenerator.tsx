import React, { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Download, Palette, Check, LayoutGrid, Image as ImageIcon } from 'lucide-react';

interface QRCodeGeneratorProps {
  value: string; // Target URL e.g. https://.../v/submissionId
  studentName?: string;
  citat?: string;
  audioUrl?: string; // Voice recording URL to decode PCM waveform
  size?: number;
  showDownloadButton?: boolean;
}

const PRESET_FG_COLORS = [
  { name: 'Negru', hex: '#000000' },
  { name: 'Auriu Gold', hex: '#D4AF37' },
  { name: 'Alb', hex: '#FFFFFF' },
  { name: 'Bordo', hex: '#5F0B02' },
  { name: 'Albastru', hex: '#1E3A8A' },
  { name: 'Smarald', hex: '#059669' },
];

const PRESET_BG_COLORS = [
  { name: 'Alb', hex: '#FFFFFF' },
  { name: 'Dark', hex: '#0C0B0A' },
  { name: 'Crem', hex: '#FAF9F6' },
];

export const QRCodeGenerator: React.FC<QRCodeGeneratorProps> = ({
  value,
  studentName = '',
  citat = '',
  audioUrl,
  size = 160,
  showDownloadButton = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Customizer state
  const [layoutMode, setLayoutMode] = useState<'plaque' | 'classic'>('plaque');
  const [fgColor, setFgColor] = useState<string>('#000000');
  const [bgColor, setBgColor] = useState<string>('#FFFFFF');
  const [transparentBg, setTransparentBg] = useState<boolean>(false);
  const [showColorPicker, setShowColorPicker] = useState<boolean>(false);
  const [customText, setCustomText] = useState<string>(citat || studentName || 'Mesaj Vocal Absolvent');
  const [fontFamily, setFontFamily] = useState<'serif' | 'sans'>('serif');

  // Real Waveform state extracted via AudioContext (Ultra-Dense 600 micro-spikes)
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([]);

  const NUM_BARS = 600;

  // Update customText if citat/studentName changes
  useEffect(() => {
    if (citat) setCustomText(citat);
    else if (studentName) setCustomText(studentName);
  }, [citat, studentName]);

  const generateVoiceWaveformPattern = (count: number, seedString: string): number[] => {
    const peaks: number[] = [];
    let seed = 42;
    for (let i = 0; i < seedString.length; i++) {
      seed = (seed << 5) - seed + seedString.charCodeAt(i);
      seed |= 0;
    }
    const pseudoRand = (offset: number) => {
      const x = Math.sin(seed + offset) * 10000;
      return x - Math.floor(x);
    };

    for (let i = 0; i < count; i++) {
      const wordCadence = Math.sin((i / count) * Math.PI * 14 + pseudoRand(1) * 4) * 0.5 + 0.5;
      const isSilenceGap = pseudoRand(i * 4 + 19) > 0.84 || wordCadence < 0.12;

      if (isSilenceGap) {
        peaks.push(pseudoRand(i * 3) * 0.03);
      } else {
        const syllableSpike = Math.pow(pseudoRand(i * 9 + 3), 1.8);
        const envelope = Math.sin((i / count) * Math.PI) * 0.3 + 0.7;
        peaks.push(Math.max(0.04, Math.min(1.0, syllableSpike * wordCadence * envelope * 1.4)));
      }
    }
    return peaks;
  };

  // Decode real audio PCM data from audioUrl
  useEffect(() => {
    let isMounted = true;

    const extractAudioWaveform = async () => {
      if (!audioUrl) {
        setWaveformPeaks(generateVoiceWaveformPattern(NUM_BARS, studentName || 'voice'));
        return;
      }

      try {
        const response = await fetch(audioUrl, { mode: 'cors' });
        const arrayBuffer = await response.arrayBuffer();
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        const channelData = audioBuffer.getChannelData(0);

        const blockSize = Math.floor(channelData.length / NUM_BARS);
        const peaks: number[] = [];

        for (let i = 0; i < NUM_BARS; i++) {
          const start = blockSize * i;
          let sum = 0;
          let maxVal = 0;
          const step = Math.max(1, Math.floor(blockSize / 30));
          for (let j = 0; j < blockSize; j += step) {
            const val = Math.abs(channelData[start + j] || 0);
            sum += val * val;
            if (val > maxVal) maxVal = val;
          }
          const rms = Math.sqrt(sum / Math.max(1, Math.floor(blockSize / step)));
          const combined = rms * 0.75 + maxVal * 0.25;
          peaks.push(combined);
        }

        // Normalize
        const max = Math.max(...peaks) || 1;
        const normalized = peaks.map(val => Math.max(0.02, val / max));

        if (isMounted) {
          setWaveformPeaks(normalized);
        }
      } catch (err) {
        console.warn('AudioContext decode or CORS fallback used for ultra-dense waveform:', err);
        if (isMounted) {
          setWaveformPeaks(generateVoiceWaveformPattern(NUM_BARS, audioUrl || studentName || 'voice'));
        }
      }
    };

    extractAudioWaveform();

    return () => {
      isMounted = false;
    };
  }, [audioUrl, studentName]);

  // High-Resolution 300 DPI Export to Canvas (3000 x 1200 px for plaque, 1200 x 1200 px for classic)
  const handleDownloadPNG = () => {
    if (!containerRef.current) return;
    const svgElement = containerRef.current.querySelector('svg.qr-code-svg');
    if (!svgElement) return;

    const svgData = new XMLSerializer().serializeToString(svgElement);
    const qrImg = new Image();

    qrImg.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      if (layoutMode === 'plaque') {
        // Ultra High Res Plaque: 3000px x 1200px (300 DPI Print-Ready)
        canvas.width = 3000;
        canvas.height = 1200;

        // Background
        if (!transparentBg) {
          ctx.fillStyle = bgColor;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        } else {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }

        // Draw Ultra-Dense Waveform (600 Micro-Spikes)
        const peaks = waveformPeaks.length > 0 ? waveformPeaks : generateVoiceWaveformPattern(NUM_BARS, studentName);
        const waveMarginX = 100;
        const waveTopY = 80;
        const waveHeight = 560;
        const waveCenterY = waveTopY + waveHeight / 2;
        const availableWidth = canvas.width - waveMarginX * 2;
        const barSpacing = availableWidth / peaks.length;
        const barWidth = Math.max(2, barSpacing * 0.75);

        ctx.fillStyle = fgColor;
        ctx.strokeStyle = fgColor;
        ctx.lineWidth = 3;

        // Baseline
        ctx.beginPath();
        ctx.moveTo(waveMarginX, waveCenterY);
        ctx.lineTo(canvas.width - waveMarginX, waveCenterY);
        ctx.stroke();

        // 600 micro-spikes (mirrored top & bottom)
        peaks.forEach((peak, i) => {
          const x = waveMarginX + i * barSpacing;
          const h = (waveHeight / 2 - 15) * peak;
          if (h > 0.5) {
            ctx.fillRect(x, waveCenterY - h, barWidth, h * 2);
          }
        });

        // Bottom Left Text (Student Name / Quote)
        ctx.fillStyle = fgColor;
        const fontStyleStr = fontFamily === 'serif' ? 'italic 52px "Georgia", "Times New Roman", serif' : '500 44px "Outfit", "Segoe UI", sans-serif';
        ctx.font = fontStyleStr;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        const maxTextWidth = canvas.width - 700 - waveMarginX;
        let textToDraw = customText || studentName || 'Mesaj Vocal';
        if (textToDraw.length > 65) {
          textToDraw = textToDraw.substring(0, 62) + '...';
        }
        ctx.fillText(textToDraw, waveMarginX, 930, maxTextWidth);

        // Bottom Right QR Code (Size 340 x 340 px)
        const qrSize = 340;
        const qrX = canvas.width - waveMarginX - qrSize;
        const qrY = 740;
        ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);

      } else {
        // Classic Standalone QR (1200 x 1200 px)
        canvas.width = 1200;
        canvas.height = 1200;

        if (!transparentBg) {
          ctx.fillStyle = bgColor;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        } else {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(qrImg, 0, 0, canvas.width, canvas.height);
      }

      // Download High-Res PNG
      const pngUrl = canvas.toDataURL('image/png');
      const downloadLink = document.createElement('a');
      const safeName = (studentName || 'mesaj_vocal').replace(/[^a-z0-9]/gi, '_');
      downloadLink.download = `macheta_vocal_${safeName}.png`;
      downloadLink.href = pngUrl;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
    };

    qrImg.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  };

  const encodedIconColor = encodeURIComponent(fgColor);
  const activePeaks = waveformPeaks.length > 0 ? waveformPeaks : generateVoiceWaveformPattern(NUM_BARS, studentName);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '14px',
        backgroundColor: '#161514',
        border: '1px solid #262423',
        borderRadius: '14px',
        padding: '18px',
        width: '100%',
        maxWidth: '580px',
        boxSizing: 'border-box',
      }}
    >
      {/* Mode Switcher Tabs */}
      <div style={{ display: 'flex', gap: '8px', backgroundColor: '#0E0D0C', padding: '4px', borderRadius: '8px', width: '100%' }}>
        <button
          type="button"
          onClick={() => setLayoutMode('plaque')}
          style={{
            flex: 1,
            padding: '8px 12px',
            backgroundColor: layoutMode === 'plaque' ? '#262423' : 'transparent',
            color: layoutMode === 'plaque' ? 'var(--gold-accent, #D4AF37)' : '#706E6A',
            border: 'none',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            transition: 'all 0.15s ease',
          }}
        >
          <ImageIcon size={14} /> Placă Machetă Waveform + QR
        </button>
        <button
          type="button"
          onClick={() => setLayoutMode('classic')}
          style={{
            flex: 1,
            padding: '8px 12px',
            backgroundColor: layoutMode === 'classic' ? '#262423' : 'transparent',
            color: layoutMode === 'classic' ? 'var(--gold-accent, #D4AF37)' : '#706E6A',
            border: 'none',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            transition: 'all 0.15s ease',
          }}
        >
          <LayoutGrid size={14} /> Cod QR Clasic
        </button>
      </div>

      {/* Preview Card */}
      <div
        ref={containerRef}
        style={{
          width: '100%',
          backgroundColor: transparentBg ? 'transparent' : bgColor,
          backgroundImage: transparentBg
            ? 'linear-gradient(45deg, #1f1d1b 25%, transparent 25%), linear-gradient(-45deg, #1f1d1b 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1f1d1b 75%), linear-gradient(-45deg, transparent 75%, #1f1d1b 75%)'
            : 'none',
          backgroundSize: '16px 16px',
          backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
          borderRadius: '10px',
          border: '1px solid #2A2826',
          boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
          padding: layoutMode === 'plaque' ? '20px' : '16px',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '16px',
          color: fgColor,
          transition: 'all 0.2s ease',
        }}
      >
        {layoutMode === 'plaque' ? (
          <>
            {/* Real Ultra-Dense High-Res Audio Waveform SVG (Top 600 Micro-Spikes) */}
            <div style={{ width: '100%', height: '84px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="100%" height="84" viewBox={`0 0 ${NUM_BARS * 2} 84`} preserveAspectRatio="none" style={{ display: 'block', width: '100%', height: '100%' }}>
                {/* Center Baseline */}
                <line x1="0" y1="42" x2={NUM_BARS * 2} y2="42" stroke={fgColor} strokeWidth="1" opacity="0.75" />
                
                {/* 600 Mirrored Ultra-Dense Micro-Spikes */}
                {activePeaks.map((peak, idx) => {
                  const h = Math.max(0.5, peak * 38);
                  const x = idx * 2 + 1;
                  return (
                    <line
                      key={idx}
                      x1={x}
                      y1={42 - h}
                      x2={x}
                      y2={42 + h}
                      stroke={fgColor}
                      strokeWidth="1.2"
                    />
                  );
                })}
              </svg>
            </div>

            {/* Bottom Row: Text Left + QR Right */}
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', width: '100%', marginTop: '4px' }}>
              <div style={{ flex: 1, paddingRight: '16px', textAlign: 'left' }}>
                <p
                  style={{
                    margin: 0,
                    fontSize: fontFamily === 'serif' ? '17px' : '14px',
                    fontFamily: fontFamily === 'serif' ? '"Georgia", serif' : '"Outfit", sans-serif',
                    fontStyle: fontFamily === 'serif' ? 'italic' : 'normal',
                    color: fgColor,
                    lineHeight: 1.3,
                    wordBreak: 'break-word',
                  }}
                >
                  "{customText || studentName || 'Mesaj Vocal Absolvent'}"
                </p>
              </div>

              {/* QR Code SVG */}
              <QRCodeSVG
                className="qr-code-svg"
                value={value}
                size={90}
                bgColor={transparentBg ? 'transparent' : bgColor}
                fgColor={fgColor}
                level="H"
                includeMargin={false}
                imageSettings={{
                  src: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${encodedIconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M6 6v12M18 6v12M3 10v4M21 10v4"/></svg>`,
                  x: undefined,
                  y: undefined,
                  height: 16,
                  width: 16,
                  excavate: true,
                }}
              />
            </div>
          </>
        ) : (
          /* Classic Standalone QR */
          <QRCodeSVG
            className="qr-code-svg"
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
        )}
      </div>

      {/* Customization Controls Button */}
      <button
        type="button"
        onClick={() => setShowColorPicker(!showColorPicker)}
        style={{
          padding: '6px 12px',
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
        <Palette size={13} style={{ color: fgColor }} />
        {showColorPicker ? 'Ascunde Personalizare' : 'Personalizează Culori & Text Machetă'}
      </button>

      {/* Drawer for Color & Text Customization */}
      {showColorPicker && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            backgroundColor: '#0E0D0C',
            border: '1px solid #262423',
            borderRadius: '10px',
            padding: '14px',
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
          {/* Custom Text Input */}
          {layoutMode === 'plaque' && (
            <div>
              <label style={{ fontSize: '10px', textTransform: 'uppercase', color: '#706E6A', fontWeight: 700, display: 'block', marginBottom: '6px' }}>
                Text Machetă (Citat / Nume Elev)
              </label>
              <input
                type="text"
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder="Ex: Talk to ya soon... / Nume Elev"
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  backgroundColor: '#161514',
                  border: '1px solid #262423',
                  borderRadius: '6px',
                  color: '#FAF9F6',
                  fontSize: '12px',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                <label style={{ fontSize: '11px', color: '#FAF9F6', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <input
                    type="radio"
                    name="fontType"
                    checked={fontFamily === 'serif'}
                    onChange={() => setFontFamily('serif')}
                    style={{ accentColor: 'var(--gold-accent)' }}
                  />
                  <span>Font Script / Serif (Georgia)</span>
                </label>
                <label style={{ fontSize: '11px', color: '#FAF9F6', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <input
                    type="radio"
                    name="fontType"
                    checked={fontFamily === 'sans'}
                    onChange={() => setFontFamily('sans')}
                    style={{ accentColor: 'var(--gold-accent)' }}
                  />
                  <span>Font Sans-serif</span>
                </label>
              </div>
            </div>
          )}

          {/* Foreground Color */}
          <div>
            <label style={{ fontSize: '10px', textTransform: 'uppercase', color: '#706E6A', fontWeight: 700, display: 'block', marginBottom: '6px' }}>
              Culoare Elemente (Undă, Text, Cod QR)
            </label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              {PRESET_FG_COLORS.map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  onClick={() => setFgColor(c.hex)}
                  title={c.name}
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    backgroundColor: c.hex,
                    border: fgColor === c.hex ? '2px solid #D4AF37' : '1px solid #3A3835',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {fgColor === c.hex && <Check size={12} style={{ color: c.hex === '#FFFFFF' || c.hex === '#FAF9F6' ? '#000' : '#FFF' }} />}
                </button>
              ))}
              <input
                type="color"
                value={fgColor}
                onChange={(e) => setFgColor(e.target.value)}
                style={{ width: '26px', height: '26px', padding: 0, border: 'none', borderRadius: '4px', cursor: 'pointer', backgroundColor: 'transparent' }}
                title="Alege culoare personalizată"
              />
            </div>
          </div>

          {/* Background Color */}
          <div>
            <label style={{ fontSize: '10px', textTransform: 'uppercase', color: '#706E6A', fontWeight: 700, display: 'block', marginBottom: '6px' }}>
              Culoare Fundal
            </label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
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
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    backgroundColor: c.hex,
                    border: !transparentBg && bgColor === c.hex ? '2px solid #D4AF37' : '1px solid #3A3835',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {!transparentBg && bgColor === c.hex && <Check size={12} style={{ color: c.hex === '#FFFFFF' || c.hex === '#FAF9F6' ? '#000' : '#FFF' }} />}
                </button>
              ))}
              <input
                type="color"
                value={bgColor}
                onChange={(e) => {
                  setTransparentBg(false);
                  setBgColor(e.target.value);
                }}
                style={{ width: '26px', height: '26px', padding: 0, border: 'none', borderRadius: '4px', cursor: 'pointer', backgroundColor: 'transparent' }}
                title="Alege culoare fundal personalizată"
              />
            </div>
          </div>

          {/* Transparent Checkbox */}
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#FAF9F6', cursor: 'pointer', marginTop: '2px' }}>
            <input
              type="checkbox"
              checked={transparentBg}
              onChange={(e) => setTransparentBg(e.target.checked)}
              style={{ accentColor: '#D4AF37', cursor: 'pointer', width: '16px', height: '16px' }}
            />
            <span>Fundal Transparent (PNG Fără Fundal)</span>
          </label>
        </div>
      )}

      {/* Download PNG High-Res Button */}
      {showDownloadButton && (
        <button
          type="button"
          onClick={handleDownloadPNG}
          style={{
            padding: '10px 16px',
            backgroundColor: '#5f0b02',
            color: '#FAF9F6',
            border: 'none',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            transition: 'all 0.15s ease',
            width: '100%',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(95, 11, 2, 0.4)',
          }}
        >
          <Download size={16} /> Descarcă Machetă PNG (300 DPI Tipografie)
        </button>
      )}
    </div>
  );
};

import React, { useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Download } from 'lucide-react';

interface QRCodeGeneratorProps {
  value: string; // Target URL e.g. https://.../v/submissionId
  studentName?: string;
  size?: number;
  showDownloadButton?: boolean;
}

export const QRCodeGenerator: React.FC<QRCodeGeneratorProps> = ({
  value,
  studentName,
  size = 180,
  showDownloadButton = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleDownloadPNG = () => {
    if (!containerRef.current) return;
    const svgElement = containerRef.current.querySelector('svg');
    if (!svgElement) return;

    const svgData = new XMLSerializer().serializeToString(svgElement);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    const scale = 3; // High resolution 3x scale for crisp printing
    canvas.width = size * scale;
    canvas.height = size * scale;

    img.onload = () => {
      if (ctx) {
        // Fill dark background
        ctx.fillStyle = '#0C0B0A';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // Draw SVG image
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

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '12px',
        backgroundColor: '#161514',
        border: '1px solid #262423',
        borderRadius: '12px',
        padding: '16px',
        width: 'fit-content',
      }}
    >
      <div
        ref={containerRef}
        style={{
          padding: '12px',
          backgroundColor: '#0C0B0A',
          borderRadius: '8px',
          border: '1px solid #2A2826',
          boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <QRCodeSVG
          value={value}
          size={size}
          bgColor="#0C0B0A"
          fgColor="#D4AF37" // Gold accent
          level="H"
          includeMargin={false}
          imageSettings={{
            src: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="%23D4AF37" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M6 6v12M18 6v12M3 10v4M21 10v4"/></svg>',
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
            color: '#706E6A',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            marginTop: '8px',
            fontWeight: 600,
          }}
        >
          SCAN TO PLAY AUDIO
        </span>
      </div>

      {showDownloadButton && (
        <button
          type="button"
          onClick={handleDownloadPNG}
          style={{
            padding: '6px 12px',
            backgroundColor: '#262423',
            color: '#FAF9F6',
            border: '1px solid #363432',
            borderRadius: '6px',
            fontSize: '11px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            transition: 'all 0.15s ease',
          }}
        >
          <Download size={12} /> Descarcă Cod QR (PNG)
        </button>
      )}
    </div>
  );
};

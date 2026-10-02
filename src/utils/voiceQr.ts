/**
 * Shared renderer for the "voice message QR" PNG.
 *
 * This is the exact drawing logic that used to live only inside
 * QRCodeGenerator.tsx's `handleDownloadPNG`. It is extracted here so the
 * admin's manual "Download PNG" button and the ZIP archive builders in
 * AdminDashboard.tsx always produce byte-for-byte the same image — there is
 * only one place that knows how to draw the plaque/classic layouts.
 *
 * It works without the <QRCodeGenerator> component being mounted by
 * rendering the QR code (via the same `qrcode.react` library) into a
 * detached, off-screen React root, then drawing it onto an offscreen
 * <canvas> exactly like the component does.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';

export type VoiceQrLayoutMode = 'plaque' | 'classic';
export type VoiceQrFontFamily = 'serif' | 'sans';

export interface VoiceQrOptions {
  /** Target URL encoded by the QR code, e.g. https://.../v/submissionId */
  value: string;
  studentName?: string;
  /** Voice recording URL, used to decode a real PCM waveform when `waveformData` isn't supplied. */
  audioUrl?: string;
  /** Pre-computed waveform peaks (0..1). When present, no audio decoding happens. */
  waveformData?: number[];
  layoutMode?: VoiceQrLayoutMode;
  fgColor?: string;
  bgColor?: string;
  transparentBg?: boolean;
  customText?: string;
  fontFamily?: VoiceQrFontFamily;
  /** QR size (px) used in 'classic' layout only — mirrors QRCodeGenerator's `size` prop. */
  size?: number;
}

const NUM_BARS = 600;

/** Deterministic pseudo-waveform fallback, shared with QRCodeGenerator's live preview. */
export function generateVoiceWaveformPattern(count: number, seedString: string): number[] {
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
}

/** Resolves waveform peaks the same way QRCodeGenerator's effect does. */
async function resolveWaveformPeaks(opts: {
  waveformData?: number[];
  audioUrl?: string;
  studentName?: string;
}): Promise<number[]> {
  if (opts.waveformData && opts.waveformData.length > 0) {
    return opts.waveformData;
  }

  if (!opts.audioUrl) {
    return generateVoiceWaveformPattern(NUM_BARS, opts.studentName || 'voice');
  }

  try {
    const response = await fetch(opts.audioUrl, { mode: 'cors' });
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

    const max = Math.max(...peaks) || 1;
    return peaks.map(val => Math.max(0.02, val / max));
  } catch (err) {
    console.warn('AudioContext decode or CORS fallback used for ultra-dense waveform:', err);
    return generateVoiceWaveformPattern(NUM_BARS, opts.audioUrl || opts.studentName || 'voice');
  }
}

/** Renders a <QRCodeSVG> off-screen (via qrcode.react) and returns its serialized markup. */
function renderQrSvgString(value: string, size: number, bgColor: string, fgColor: string): string {
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-99999px';
  container.style.top = '-99999px';
  document.body.appendChild(container);

  const root = createRoot(container);
  try {
    flushSync(() => {
      root.render(
        React.createElement(QRCodeSVG, {
          value,
          size,
          bgColor,
          fgColor,
          level: 'H' as const,
          includeMargin: false,
        })
      );
    });

    const svgElement = container.querySelector('svg');
    if (!svgElement) {
      throw new Error('QR code SVG failed to render.');
    }
    return new XMLSerializer().serializeToString(svgElement);
  } finally {
    root.unmount();
    document.body.removeChild(container);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load QR code image.'));
    img.src = src;
  });
}

/**
 * Renders the voice-message QR PNG exactly as QRCodeGenerator's "Download PNG"
 * button does (same 300-DPI plaque layout at 3000x1200, or the classic
 * standalone QR at 1200x1200), and resolves it as a PNG Blob.
 */
export async function renderVoiceQrPng(opts: VoiceQrOptions): Promise<Blob> {
  const {
    value,
    studentName = '',
    audioUrl,
    waveformData,
    layoutMode = 'plaque',
    fgColor = '#FFFFFF',
    bgColor = '#000000',
    transparentBg = true,
    customText = '',
    fontFamily = 'serif',
    size = 160,
  } = opts;

  const peaks = await resolveWaveformPeaks({ waveformData, audioUrl, studentName });

  // Mirrors the DOM: the plaque layout's visible QR is rendered at size=90,
  // the classic layout's at the `size` prop — see QRCodeGenerator.tsx.
  const qrSvgSize = layoutMode === 'plaque' ? 90 : size;
  const svgData = renderQrSvgString(value, qrSvgSize, transparentBg ? 'transparent' : bgColor, fgColor);
  const qrImg = await loadImage('data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData))));

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable.');
  }

  if (layoutMode === 'plaque') {
    // Plaque Mode: 3000px x 1200px (300 DPI Print-Ready)
    canvas.width = 3000;
    canvas.height = 1200;

    if (!transparentBg) {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    const waveMarginX = 100;
    const waveTopY = 80;
    const waveHeight = 560;
    const waveCenterY = waveTopY + waveHeight / 2;
    const availableWidth = canvas.width - waveMarginX * 2;
    const barSpacing = availableWidth / peaks.length;
    const barWidth = Math.max(2, barSpacing * 0.75);

    ctx.fillStyle = fgColor;

    peaks.forEach((peak, i) => {
      const x = waveMarginX + i * barSpacing;
      if (peak > 0.04) {
        const h = (waveHeight / 2 - 15) * peak;
        ctx.fillRect(x, waveCenterY - h, barWidth, h * 2);
      } else {
        ctx.fillRect(x, waveCenterY - 1, Math.max(1, barSpacing + 0.5), 2);
      }
    });

    if (customText.trim()) {
      ctx.fillStyle = fgColor;
      const fontStyleStr = fontFamily === 'serif' ? 'italic 52px "Georgia", "Times New Roman", serif' : '500 44px "Outfit", "Segoe UI", sans-serif';
      ctx.font = fontStyleStr;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';

      const maxTextWidth = canvas.width - 700 - waveMarginX;
      let textToDraw = customText.trim();
      if (textToDraw.length > 65) {
        textToDraw = textToDraw.substring(0, 62) + '...';
      }
      ctx.fillText(`"${textToDraw}"`, waveMarginX, 930, maxTextWidth);
    }

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

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Canvas toBlob() returned null.'));
      }
    }, 'image/png');
  });
}

/** File name used by QRCodeGenerator's manual "Download PNG" button. */
export function getVoiceQrDownloadName(studentName?: string): string {
  const safeName = (studentName || 'mesaj_vocal').replace(/[^a-z0-9]/gi, '_');
  return `macheta_vocal_${safeName}.png`;
}

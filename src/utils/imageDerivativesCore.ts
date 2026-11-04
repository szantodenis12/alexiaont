/**
 * Upload derivatives (display copy, ~1200px previews, ~600px thumb) from ONE
 * decode of the photo.
 *
 * The previous pipeline called applyWatermark once per copy, and every call
 * decoded the full-size JPEG again (4 decodes + 4 full-size resamples per
 * photo, all on the main thread). Here the photo is decoded once, scaled down
 * step by step (each copy is drawn from the next larger clean copy, never from
 * the 20-30 MP source again), and the watermark is drawn on each copy with the
 * exact same geometry as applyWatermark (shared `drawWatermark`).
 *
 * No DOM access: runs unchanged in the upload Web Worker (OffscreenCanvas) and,
 * as a fallback, on the main thread.
 */
import { fitWithin, drawWatermark } from './watermarkProcessor';
import type { WatermarkPlacement } from './watermarkProcessor';

export interface DerivativeSpec {
  /** Key of the produced blob, e.g. 'display' | 'previewClean' | 'previewWm' | 'thumb'. */
  key: string;
  maxDim: number;
  quality: number;
  watermark: boolean;
}

export interface DerivativeRequest {
  outputs: DerivativeSpec[];
  /** Required when any output has watermark: true. */
  watermark: { url: string; position: WatermarkPlacement; offsetX: number; offsetY: number } | null;
}

export interface DerivativeResult {
  /** Decoded size (EXIF orientation applied). */
  width: number;
  height: number;
  blobs: Record<string, Blob>;
}

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface CanvasBackend {
  create(width: number, height: number): AnyCanvas;
  encode(canvas: AnyCanvas, quality: number): Promise<Blob>;
}

const ctxOf = (canvas: AnyCanvas): AnyCtx => {
  const ctx = canvas.getContext('2d') as AnyCtx | null;
  if (!ctx) throw new Error('Could not get 2D canvas context');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
};

/**
 * @param source  decoded photo (ImageBitmap / <img>), already EXIF-oriented
 * @param watermark decoded watermark, or null when no output needs one
 */
export async function renderDerivatives(
  source: CanvasImageSource,
  srcWidth: number,
  srcHeight: number,
  req: DerivativeRequest,
  watermark: { image: CanvasImageSource; width: number; height: number } | null,
  backend: CanvasBackend
): Promise<DerivativeResult> {
  if (req.outputs.some(o => o.watermark) && (!watermark || !req.watermark)) {
    throw new Error('Watermark requested but not loaded');
  }

  // One clean canvas per distinct output size, largest first. Sizes come from
  // the ORIGINAL dimensions with applyWatermark's rounding, so every copy has
  // exactly the pixel size it had before.
  const groups = new Map<string, { width: number; height: number; outputs: DerivativeSpec[]; canvas?: AnyCanvas }>();
  for (const o of req.outputs) {
    const { width, height } = fitWithin(srcWidth, srcHeight, o.maxDim);
    const k = `${width}x${height}`;
    const g = groups.get(k);
    if (g) g.outputs.push(o); else groups.set(k, { width, height, outputs: [o] });
  }
  const sizes = [...groups.values()].sort((a, b) => b.width * b.height - a.width * a.height);

  try {
    let prev: { image: CanvasImageSource; width: number; height: number } = { image: source, width: srcWidth, height: srcHeight };
    for (const g of sizes) {
      const canvas = backend.create(g.width, g.height);
      ctxOf(canvas).drawImage(prev.image, 0, 0, prev.width, prev.height, 0, 0, g.width, g.height);
      g.canvas = canvas;
      prev = { image: canvas, width: g.width, height: g.height };
    }

    // All clean copies exist now, so the watermark can be drawn on each canvas
    // in place: clean variants are encoded first, watermarked ones after.
    const blobs: Record<string, Blob> = {};
    await Promise.all(sizes.map(async (g) => {
      const canvas = g.canvas!;
      for (const o of g.outputs.filter(x => !x.watermark)) blobs[o.key] = await backend.encode(canvas, o.quality);
      const wmOutputs = g.outputs.filter(x => x.watermark);
      if (wmOutputs.length === 0) return;
      const w = req.watermark!;
      drawWatermark(ctxOf(canvas), watermark!.image, watermark!.width, watermark!.height, g.width, g.height, w.position, w.offsetX, w.offsetY);
      for (const o of wmOutputs) blobs[o.key] = await backend.encode(canvas, o.quality);
    }));
    return { width: srcWidth, height: srcHeight, blobs };
  } finally {
    // Free the pixel buffers right away (a 4096px canvas is ~45 MB).
    for (const g of sizes) if (g.canvas) { g.canvas.width = 0; g.canvas.height = 0; }
  }
}

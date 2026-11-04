/**
 * Upload Web Worker: decode a photo once and produce its display copy,
 * previews and thumb off the main thread (OffscreenCanvas). The admin UI stays
 * responsive, and several photos are processed at once on multi-core laptops.
 */
import { renderDerivatives } from './imageDerivativesCore';
import type { CanvasBackend, DerivativeRequest } from './imageDerivativesCore';

interface Msg { id: number; file: Blob; req: DerivativeRequest }

const scope = self as unknown as {
  onmessage: ((ev: MessageEvent<Msg>) => void) | null;
  postMessage: (msg: unknown) => void;
};

const backend: CanvasBackend = {
  create: (w, h) => new OffscreenCanvas(w, h),
  encode: (canvas, quality) => (canvas as OffscreenCanvas).convertToBlob({ type: 'image/jpeg', quality }),
};

// The watermark is the same small PNG for a whole run — decode it once.
const watermarkCache = new Map<string, Promise<ImageBitmap>>();
const loadWatermark = (url: string): Promise<ImageBitmap> => {
  let p = watermarkCache.get(url);
  if (!p) {
    p = (async () => {
      const r = await fetch(url, { mode: 'cors' });
      if (!r.ok) throw new Error(`Watermark HTTP ${r.status}`);
      return createImageBitmap(await r.blob());
    })();
    p.catch(() => watermarkCache.delete(url));
    watermarkCache.set(url, p);
  }
  return p;
};

scope.onmessage = async (ev) => {
  const { id, file, req } = ev.data;
  let bitmap: ImageBitmap | null = null;
  try {
    if (typeof OffscreenCanvas === 'undefined' || !new OffscreenCanvas(1, 1).getContext('2d')) {
      scope.postMessage({ id, ok: false, unsupported: true, error: 'OffscreenCanvas 2D unsupported' });
      return;
    }
    const needsWm = req.outputs.some(o => o.watermark) && !!req.watermark;
    const [bmp, wm] = await Promise.all([
      createImageBitmap(file, { imageOrientation: 'from-image' }),
      needsWm ? loadWatermark(req.watermark!.url) : Promise.resolve(null),
    ]);
    bitmap = bmp;
    const result = await renderDerivatives(
      bmp, bmp.width, bmp.height, req,
      wm ? { image: wm, width: wm.width, height: wm.height } : null,
      backend
    );
    scope.postMessage({ id, ok: true, result });
  } catch (err) {
    scope.postMessage({ id, ok: false, error: (err as Error)?.message || String(err) });
  } finally {
    bitmap?.close();
  }
};

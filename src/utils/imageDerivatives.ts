/**
 * Generates a photo's upload derivatives (see imageDerivativesCore) in a small
 * pool of Web Workers, falling back to the main thread where OffscreenCanvas /
 * module workers are unavailable.
 *
 * Callers still keep their own last-resort fallback (the per-copy
 * applyWatermark path): any failure here simply rejects.
 */
import { renderDerivatives } from './imageDerivativesCore';
import type { CanvasBackend, DerivativeRequest, DerivativeResult } from './imageDerivativesCore';
import { loadImage } from './imageProcessor';

export type { DerivativeRequest, DerivativeResult, DerivativeSpec } from './imageDerivativesCore';

const nav: (Navigator & { deviceMemory?: number }) | undefined = typeof navigator !== 'undefined' ? navigator : undefined;
const cores = Math.max(1, nav?.hardwareConcurrency || 2);
const memoryGb = nav?.deviceMemory; // Chromium only, capped at 8

/**
 * Photos decoded at once. A decoded 24 MP photo is ~100 MB plus a ~45 MB
 * 4096px canvas, so low-memory devices get fewer slots.
 */
export const PROCESS_SLOTS = (() => {
  let n = Math.min(4, Math.max(1, cores - 1));
  if (memoryGb !== undefined && memoryGb <= 2) n = 1;
  else if (memoryGb !== undefined && memoryGb <= 4) n = Math.min(n, 2);
  return n;
})();

const WORKER_TIMEOUT_MS = 120_000;
const IDLE_TERMINATE_MS = 60_000;

const workersSupported = () =>
  typeof Worker !== 'undefined' &&
  typeof OffscreenCanvas !== 'undefined' &&
  typeof (OffscreenCanvas.prototype as any).convertToBlob === 'function' &&
  typeof createImageBitmap === 'function';

let workerDisabled = !workersSupported();
const idleWorkers: Worker[] = [];
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let seq = 0;
/** Workers that have answered at least once (a crash later is not a startup failure). */
const provenWorkers = new WeakSet<Worker>();

const scheduleIdleCleanup = () => {
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (active > 0) return;
    idleWorkers.splice(0).forEach(w => w.terminate());
  }, IDLE_TERMINATE_MS);
};

function runInWorker(file: Blob, req: DerivativeRequest): Promise<DerivativeResult> {
  const worker = idleWorkers.pop() ?? new Worker(new URL('./imageDerivatives.worker.ts', import.meta.url), { type: 'module' });
  return new Promise<DerivativeResult>((resolve, reject) => {
    const id = ++seq;
    const done = () => {
      clearTimeout(timer);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
    };
    const onMessage = (ev: MessageEvent) => {
      const data = ev.data;
      if (!data || data.id !== id) return;
      done();
      provenWorkers.add(worker);
      idleWorkers.push(worker);
      if (data.ok) { resolve(data.result as DerivativeResult); return; }
      if (data.unsupported) workerDisabled = true;
      reject(new Error(data.error || 'Worker failed'));
    };
    const onError = (ev: ErrorEvent) => {
      done();
      worker.terminate();
      // A worker that cannot even start (module workers unsupported, blocked
      // script) would fail every photo — use the main thread from now on.
      if (!provenWorkers.has(worker)) workerDisabled = true;
      reject(new Error('Worker error: ' + (ev.message || 'unknown')));
    };
    const timer = setTimeout(() => {
      done();
      worker.terminate();
      reject(new Error('Worker timeout'));
    }, WORKER_TIMEOUT_MS);
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage({ id, file, req });
  });
}

const mainBackend: CanvasBackend = {
  create: (w, h) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  },
  encode: (canvas, quality) => new Promise<Blob>((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      b => (b ? resolve(b) : reject(new Error('Canvas toBlob returned null'))),
      'image/jpeg',
      quality
    );
  }),
};

/**
 * Main-thread decodes at once. PROCESS_SLOTS (up to 4) is sized for workers;
 * on the main thread 4 full-size decodes would freeze the admin UI and double
 * the memory of the old pipeline (which decoded at most 2 photos at once).
 */
const MAIN_SLOTS = Math.min(2, PROCESS_SLOTS);
let mainActive = 0;
const mainWaiting: (() => void)[] = [];

/** Same single-decode pipeline on the main thread (no worker support). */
async function runOnMain(file: Blob, req: DerivativeRequest): Promise<DerivativeResult> {
  if (mainActive < MAIN_SLOTS) mainActive++;
  else await new Promise<void>(resolve => mainWaiting.push(resolve)); // slot handed over by the finisher
  try {
    return await runOnMainNow(file, req);
  } finally {
    const next = mainWaiting.shift();
    if (next) next(); else mainActive--;
  }
}

async function runOnMainNow(file: Blob, req: DerivativeRequest): Promise<DerivativeResult> {
  const needsWm = req.outputs.some(o => o.watermark) && !!req.watermark;
  const wmPromise = needsWm ? loadImage(req.watermark!.url) : Promise.resolve(null);
  wmPromise.catch(() => {}); // awaited below; avoids an "unhandled rejection" if the photo decode throws first
  let bitmap: ImageBitmap | null = null;
  let source: CanvasImageSource;
  let width: number;
  let height: number;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    source = bitmap; width = bitmap.width; height = bitmap.height;
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      await img.decode().catch(() => {});
      source = img; width = img.naturalWidth; height = img.naturalHeight;
    } finally {
      // The decoded <img> stays usable for drawImage after revoking.
      URL.revokeObjectURL(url);
    }
  }
  try {
    const wm = await wmPromise;
    return await renderDerivatives(
      source, width, height, req,
      wm ? { image: wm, width: wm.naturalWidth, height: wm.naturalHeight } : null,
      mainBackend
    );
  } finally {
    bitmap?.close();
  }
}

// ── Slot limiter (FIFO) ────────────────────────────────────────────────────
let active = 0;
const waiting: (() => void)[] = [];
const acquire = () => new Promise<void>(resolve => {
  if (active < PROCESS_SLOTS) { active++; resolve(); return; }
  waiting.push(() => { active++; resolve(); });
});
const release = () => {
  active--;
  const next = waiting.shift();
  if (next) next(); else scheduleIdleCleanup();
};

export class DerivativesCancelled extends Error {
  constructor() { super('Anulat'); this.name = 'DerivativesCancelled'; }
}

/**
 * Decode `file` once and produce every requested copy.
 *
 * @param expected the size the browser's <img> reports for the file. If the
 *   decoded size differs (e.g. a browser that ignores EXIF orientation in
 *   createImageBitmap) the result is rejected, so the caller falls back to the
 *   original per-copy path instead of storing a rotated photo.
 * @param isCancelled checked before the photo gets a slot — queued photos of a
 *   cancelled upload never burn CPU.
 */
export async function generateDerivatives(
  file: Blob,
  req: DerivativeRequest,
  opts?: { expected?: { width: number; height: number } | null; isCancelled?: () => boolean }
): Promise<DerivativeResult> {
  await acquire();
  try {
    if (opts?.isCancelled?.()) throw new DerivativesCancelled();
    let result: DerivativeResult;
    if (!workerDisabled) {
      try {
        result = await runInWorker(file, req);
      } catch (err) {
        if (!workerDisabled) throw err;
        console.warn('[Derivatives] Web Worker unavailable, processing on the main thread:', err);
        result = await runOnMain(file, req);
      }
    } else {
      result = await runOnMain(file, req);
    }
    const exp = opts?.expected;
    if (exp && (exp.width !== result.width || exp.height !== result.height)) {
      throw new Error(`Decoded size ${result.width}x${result.height} differs from ${exp.width}x${exp.height}`);
    }
    for (const o of req.outputs) {
      if (!result.blobs[o.key] || result.blobs[o.key].size === 0) throw new Error(`Missing derivative ${o.key}`);
    }
    return result;
  } finally {
    release();
  }
}

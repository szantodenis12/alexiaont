import React, { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { collection, addDoc, writeBatch, getDocs, doc, getDoc, updateDoc, getCountFromServer, runTransaction } from 'firebase/firestore';
import type { CollectionReference, DocumentReference } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import type { UploadTask } from 'firebase/storage';
// Background transfers use the Storage instance with the 6-hour retry window,
// so uploads and deletes survive a sleeping laptop / dropped Wi-Fi.
import { db, transferStorage as storage } from '../firebase/config';
import { applyWatermark } from '../utils/watermarkProcessor';
import { generateDerivatives, DerivativesCancelled, PROCESS_SLOTS } from '../utils/imageDerivatives';
import type { DerivativeRequest, DerivativeResult } from '../utils/imageDerivatives';
import { addClassPhoto, ensureClassMigrated, classPhotosCol, computeUploadFolders, classPhotoFileFields, MAIN_SESSION_ID } from '../utils/classPhotos';
import type { ClassPhoto } from '../utils/classPhotos';
import { IMMUTABLE_FILE_METADATA } from '../utils/storageCache';
import {
  buildExistingUploadIndex, partitionForUpload, uploadIdentityKey, parseUploadIdentityKey,
  readUploadJournal, writeUploadJournalEntry, removeUploadJournalEntry,
} from '../utils/uploadResume';
import type { UploadJournalEntry, ExistingUploadIndex } from '../utils/uploadResume';
import {
  scanUploadConflicts, keepBothName, conflictNameKey, conflictTargetKey, conflictGroupKey,
} from '../utils/uploadConflicts';
import type { ConflictAction, ConflictCandidate, ConflictExisting, UploadConflict } from '../utils/uploadConflicts';
import { getPhotoDisplayName } from '../utils/photoName';
import { UploadConflictDialog } from '../components/Admin/UploadConflictDialog';

export interface PhotoItem {
  firestoreId?: string;  // Firestore document ID in the subcollection
  name: string;
  url: string;           // full-res (watermarked if enabled, else clean) — for download & lightbox
  path: string;
  width?: number;
  height?: number;
  cleanUrl?: string;     // full-res clean (no watermark) — for download & admin
  cleanPath?: string;
  previewUrl?: string;       // compressed ~1200px (watermarked if enabled) — for web grid display
  previewPath?: string;
  previewCleanUrl?: string;  // compressed ~1200px clean — for web grid (admin/clean mode)
  previewCleanPath?: string;
  thumbUrl?: string;         // ~600px copy — what phones load in the grid
  thumbPath?: string;
  order?: number;        // explicit order when drag-reordered by admin
  isVideo?: boolean;     // true for video items
  videoUrl?: string;     // Firebase Storage URL of the video file
  videoPath?: string;    // Firebase Storage path of the video (for deletion)
  size?: number;         // original file size in bytes (skip-already-uploaded on re-upload)
  lastModified?: number; // original file's lastModified (ms)
  replacedPaths?: string[]; // Storage paths of earlier versions ("Înlocuiește" on upload); files kept
}

export interface ProgressItem {
  name: string;
  progress: number;
  status: string;
}

export interface UploadJob {
  jobKey: string;        // gallery: galleryId + ':' + subId — class: 'class:' + classId — deletes: 'delete'
  kind: 'gallery' | 'class' | 'delete';
  label?: string;        // shown in the upload bar so several concurrent jobs are tellable apart
  galleryId: string;
  subId: string;
  filesTotal: number;    // files to upload (skipped ones not counted) / photos queued for deletion
  filesUploaded: number; // files uploaded / photos deleted
  filesFailed: number;   // failed and not retried yet / photos that could not be deleted (restored)
  filesSkipped: number;  // skipped: "Sari peste" in the conflict dialog, already queued, or skipped by the caller
  isFinished: boolean;
  isCancelling?: boolean;
  progressMap: Record<string, ProgressItem>;
  storageFailures?: number; // delete job: Storage files that could not be removed
  errorMessage?: string;    // delete job: last error
}

/** A photo already stored in the destination (a doc the admin screen already holds in memory). */
export interface ExistingPhotoRef {
  name: string;
  folder?: string | null;
  size?: number | null;
  sessionId?: string | null;
  /** Document id — needed to replace the photo in place ("Înlocuiește"). */
  firestoreId?: string;
  lastModified?: number | null;
  /** Name fallback for docs without `name` (see utils/photoName). */
  url?: string;
  cleanUrl?: string;
  /** Small copies, shown next to the new file in the conflict dialog. */
  thumbUrl?: string | null;
  previewUrl?: string | null;
  previewCleanUrl?: string | null;
  isVideo?: boolean;
}

/** The in-memory list, or a getter for it (read again after the conflict dialog). */
export type ExistingPhotosSource = ExistingPhotoRef[] | (() => ExistingPhotoRef[]);

/** One photo in a background delete: every Storage copy + its Firestore doc (if any). */
export interface DeleteItem {
  key: string;
  paths: string[];
  /** null/undefined = no document of its own (legacy array entry), removed by `finalize`. */
  docRef?: DocumentReference | null;
}

export interface DeleteTaskSpec {
  label: string;
  items: DeleteItem[];
  /**
   * Runs after the documents are gone, with the keys deleted so far (items
   * without a doc included): parent counters, legacy arrays... If it throws,
   * the items without a doc count as not deleted.
   */
  finalize?: (deletedKeys: string[]) => Promise<void>;
}

export interface DeleteTaskResult {
  deletedKeys: string[];
  failedKeys: string[];
  /** Storage files that could not be removed (the photos are gone anyway). */
  failedFiles: number;
  error?: unknown;
}

type WatermarkPosition = 'center' | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'bottom-center' | 'tile' | null;

interface UploadContextType {
  // Legacy single-job fields kept for backward compatibility with PhotoGalleryCreator
  galleryId: string | null;
  activeSubId: string | null;
  filesTotal: number;
  filesUploaded: number;
  isUploading: boolean;
  progressMap: Record<string, ProgressItem>;
  // All active jobs (for BackgroundUploadBar)
  jobs: UploadJob[];
  /** Browser network state; while false the queue waits and resumes on its own. */
  isOnline: boolean;
  /** Uploads that were cut off by a reload / closed browser (from the local journal). */
  interruptedUploads: UploadJournalEntry[];
  dismissInterrupted: (jobKey: string) => void;
  startUpload: (
    filesArray: File[],
    targetGalleryId: string,
    targetSubId: string,
    watermarkEnabled: boolean,
    globalWatermark: any | null,
    watermarkPosition: WatermarkPosition,
    watermarkOffsetX: number,
    watermarkOffsetY: number,
    // label: shown in the upload bar; skippedCount: files the caller already
    // skipped (shown as "X fișiere sărite"); existingPhotos: the target folder's
    // photos in memory — files with the name of a stored photo (identical ones
    // included, pre-set to skip) are asked about (skip / replace / keep both).
    opts?: { label?: string; skippedCount?: number; existingPhotos?: ExistingPhotosSource }
  ) => Promise<void>;
  startClassUpload: (
    filesArray: File[],
    classId: string,
    className: string,
    watermarkEnabled: boolean,
    watermarkUrl: string | null,
    watermarkPosition: WatermarkPosition,
    watermarkOffsetX: number,
    watermarkOffsetY: number,
    // Optional photo session ("ședință") the files go into; omitted = main.
    sessionId?: string,
    // Photos already in the class (in memory). Files with the name of a stored
    // photo in the same session + folder are asked about (skip / replace / keep
    // both); identical ones (same name and size) are pre-set to skip.
    existingPhotos?: ExistingPhotosSource
  ) => Promise<void>;
  cancelUpload: (jobKey: string) => Promise<void>;
  /** Re-run only the files that failed in this job. */
  retryFailed: (jobKey: string) => void;
  /** Queue a delete in the background; resolves when it ran (never rejects). */
  enqueueDelete: (spec: DeleteTaskSpec) => Promise<DeleteTaskResult>;
  onClassPhotoUploaded: (classId: string, callback: (photo: ClassPhoto) => void) => () => void;
  onPhotoUploaded: (galleryId: string, callback: (photo: PhotoItem, subId: string) => void) => () => void;
  onPhotosDeleted: (galleryId: string, callback: (deletedIds: string[], subId: string) => void) => () => void;
  resetUploadState: () => void;
  dismissJob: (jobKey: string) => void;
  forceReorderByName: (targetGalleryId: string, targetSubId: string) => Promise<void>;
}

const UploadContext = createContext<UploadContextType | undefined>(undefined);

export const useUpload = () => {
  const context = useContext(UploadContext);
  if (!context) {
    throw new Error('useUpload must be used within an UploadProvider');
  }
  return context;
};

// ── Transfer helpers (no React state) ──────────────────────────────────────

/**
 * Photos uploading at once. Resizing/watermarking runs in Web Workers
 * (imageDerivatives, PROCESS_SLOTS at a time) and ahead of the uploads, so an
 * upload slot only holds a few MB of finished blobs plus a File handle (read
 * from disk as it is sent). Several photos in flight hide the per-request
 * latency of Storage's resumable protocol (start + growing chunks + download
 * URL, each a round trip). Low-memory devices get fewer.
 */
const UPLOAD_CONCURRENCY = (() => {
  const mem = typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory : undefined;
  if (mem !== undefined && mem <= 2) return 2;
  if (mem !== undefined && mem <= 4) return 3;
  return 6;
})();
/** Photos prepared (decoded + resized) beyond the ones uploading. */
const PREPARE_AHEAD = Math.max(2, PROCESS_SLOTS);
/** Parallel Storage deletes in the delete queue. */
const DELETE_CONCURRENCY = 6;
/** Firestore caps a batch at 500 writes. */
const BATCH_LIMIT = 499;
const DELETE_JOB_KEY = 'delete';

/** Breathing room for the UI between main-thread canvas steps (fallback path only). */
const yieldToMain = () => new Promise<void>(resolve => setTimeout(resolve, 60));
const nextTick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/**
 * The per-copy fallback decodes the full-size photo on the main thread for
 * every copy. Before the worker pipeline at most 2 files did that at once
 * (UPLOAD_CONCURRENCY was 2); with 6 upload slots a run where the fast path
 * fails for every photo would otherwise hold 6 full-size decodes at once and
 * can crash the tab on an 8 GB laptop. Keep the old ceiling of 2.
 */
const FALLBACK_SLOTS = 2;
let fallbackActive = 0;
const fallbackWaiting: (() => void)[] = [];
const withFallbackSlot = async <T,>(fn: () => Promise<T>): Promise<T> => {
  if (fallbackActive < FALLBACK_SLOTS) fallbackActive++;
  else await new Promise<void>(resolve => fallbackWaiting.push(resolve)); // slot handed over by release
  try {
    return await fn();
  } finally {
    const next = fallbackWaiting.shift();
    if (next) next(); else fallbackActive--;
  }
};
const applyWatermarkLimited = (...args: Parameters<typeof applyWatermark>): Promise<Blob> =>
  withFallbackSlot(() => applyWatermark(...args));

/** Resolves as soon as the browser reports a network connection. */
const waitForOnline = (): Promise<void> => {
  if (typeof navigator === 'undefined' || navigator.onLine !== false) return Promise.resolve();
  return new Promise(resolve => window.addEventListener('online', () => resolve(), { once: true }));
};

class CancelledError extends Error {
  constructor() { super('Anulat'); this.name = 'CancelledError'; }
}

interface RunToken { cancelled: boolean; tasks: Set<UploadTask> }

const NON_RETRYABLE = new Set(['storage/unauthorized', 'storage/unauthenticated', 'storage/canceled', 'storage/quota-exceeded', 'storage/invalid-argument']);

const errorText = (err: any): string => {
  const code: string = err?.code || '';
  if (code === 'storage/retry-limit-exceeded') return 'Conexiunea nu a revenit la timp';
  if (code === 'storage/unauthorized' || code === 'storage/unauthenticated' || code === 'permission-denied') return 'Fără permisiune (reautentifică-te)';
  if (code === 'storage/quota-exceeded') return 'Spațiul de stocare este plin';
  return err?.message || 'Necunoscută';
};

/**
 * Several attempts on top of the SDK's own retrying. The task is recreated on
 * every attempt (retrying an already-rejected promise does nothing), and a retry
 * waits for the network first.
 */
const withRetry = async <T,>(fn: () => Promise<T>, token: RunToken, label: string, maxAttempts = 3): Promise<T> => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (token.cancelled) throw new CancelledError();
      if (attempt >= maxAttempts || NON_RETRYABLE.has(err?.code)) throw err;
      console.warn(`[Upload Retry] Attempt ${attempt} failed for ${label}. Retrying...`, err);
      await new Promise(r => setTimeout(r, attempt * 2000));
      await waitForOnline();
    }
  }
};

/** One resumable Storage upload with byte progress; registered on the token so cancel can abort it. */
const uploadResumable = (path: string, blob: Blob, token: RunToken, onBytes?: (transferred: number) => void) =>
  new Promise<string>((resolve, reject) => {
    if (token.cancelled) { reject(new CancelledError()); return; }
    // Every upload path embeds a timestamp + random suffix — never rewritten,
    // so it can be cached by browsers for a year (see IMMUTABLE_FILE_METADATA).
    const task = uploadBytesResumable(ref(storage, path), blob, IMMUTABLE_FILE_METADATA);
    token.tasks.add(task);
    task.on(
      'state_changed',
      (snap) => onBytes?.(snap.bytesTransferred),
      (err) => { token.tasks.delete(task); reject(err); },
      async () => {
        token.tasks.delete(task);
        try { resolve(await getDownloadURL(task.snapshot.ref)); } catch (e) { reject(e); }
      }
    );
  });

/** Best-effort removal of Storage files no document points to. Not awaited by callers. */
const removeOrphans = (paths: string[]) => {
  paths.filter(Boolean).forEach(p => { deleteObject(ref(storage, p)).catch(() => {}); });
};

interface UploadPart { path: string; blob: Blob }

/**
 * Upload every copy of one photo. All of them are required: the photo document
 * is written only after this resolves, so a document never points at a missing
 * file. If any copy fails, the copies that did land are removed (their paths are
 * unique to this attempt and referenced by nothing) and the error is rethrown.
 */
const uploadParts = async (parts: UploadPart[], token: RunToken, label: string, onProgress: (pct: number) => void): Promise<string[]> => {
  const totalBytes = parts.reduce((s, p) => s + (p.blob.size || 0), 0) || 1;
  const sent = parts.map(() => 0);
  let lastPct = -1;
  const report = () => {
    const pct = Math.min(99, Math.round((sent.reduce((a, b) => a + b, 0) / totalBytes) * 100));
    // 10% steps: every report copies the job's progress map (thousands of
    // entries on a big run), and several photos now upload at once.
    if (Math.floor(pct / 10) !== Math.floor(lastPct / 10)) { lastPct = pct; onProgress(pct); }
  };
  const results = await Promise.allSettled(parts.map((p, i) =>
    withRetry(() => {
      sent[i] = 0;
      return uploadResumable(p.path, p.blob, token, (b) => { sent[i] = b; report(); });
    }, token, label)
  ));
  const failed = results.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined;
  if (failed || token.cancelled) {
    removeOrphans(results.map((r, i) => (r.status === 'fulfilled' ? parts[i].path : '')));
    throw token.cancelled ? new CancelledError() : failed!.reason;
  }
  return results.map(r => (r as PromiseFulfilledResult<string>).value);
};

const measureImage = (file: File) => new Promise<{ width: number; height: number } | null>((resolve) => {
  const objUrl = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const w = img.naturalWidth, h = img.naturalHeight;
    URL.revokeObjectURL(objUrl);
    resolve(w > 0 && h > 0 ? { width: w, height: h } : null);
  };
  img.onerror = () => { URL.revokeObjectURL(objUrl); resolve(null); };
  img.src = objUrl;
});

/** Firestore fields of a gallery photo doc. Never undefined. */
const galleryPhotoFields = (photo: PhotoItem) => ({
  name: photo.name,
  url: photo.url,
  path: photo.path,
  cleanUrl: photo.cleanUrl || null,
  cleanPath: photo.cleanPath || null,
  previewUrl: photo.previewUrl || null,
  previewPath: photo.previewPath || null,
  previewCleanUrl: photo.previewCleanUrl || null,
  previewCleanPath: photo.previewCleanPath || null,
  thumbUrl: photo.thumbUrl || null,
  thumbPath: photo.thumbPath || null,
  width: photo.width || null,
  height: photo.height || null,
  ...(typeof photo.size === 'number' && photo.size > 0 ? { size: photo.size } : {}),
  ...(typeof photo.lastModified === 'number' && photo.lastModified > 0 ? { lastModified: photo.lastModified } : {}),
});

/** Every Storage path a photo document points to, earlier (replaced) versions included. */
const docStoragePaths = (d: any): string[] => [
  d?.path, d?.cleanPath, d?.previewPath, d?.previewCleanPath, d?.thumbPath,
  ...(Array.isArray(d?.replacedPaths) ? d.replacedPaths : []),
].filter((x: unknown): x is string => typeof x === 'string' && !!x);

/**
 * "Înlocuiește": point an EXISTING photo document at freshly uploaded files.
 *
 * - Runs only after every new copy is in Storage, so a failed upload leaves the
 *   old photo untouched.
 * - Same document id, and `order` / `folder` / `sessionId` untouched: the photo
 *   keeps its place in custom orders, folders and sessions, and anything keyed
 *   by its id keeps pointing at it.
 * - The old Storage files are NOT deleted. Student submissions, gallery client
 *   selections and covers keep their own copy of the old URLs (deleting the
 *   files would break those thumbnails/links, and proving that nothing refers
 *   to them would cost reads of every submission/selection). Their paths are
 *   recorded in `replacedPaths`, so the admin downloads can map a selection
 *   made on the old version to this photo and deliver the NEW original.
 * - Storage is never overwritten in place: every upload path is unique and
 *   served with a one-year immutable cache, so an overwrite would keep showing
 *   the old picture (and change the download token of the old URL).
 *
 * Transaction: 1 read (the document) + 1 write. Returns null when the document
 * no longer exists (the caller then adds the photo as a new one).
 */
const replacePhotoInPlace = (
  col: CollectionReference,
  id: string,
  fields: Record<string, unknown>,
  newPaths: string[]
): Promise<{ replacedPaths: string[] } | null> =>
  runTransaction(db, async (tx) => {
    const ref = doc(col, id);
    const snap = await tx.get(ref);
    if (!snap.exists() || snap.data()?.isVideo) return null;
    const fresh = new Set(newPaths);
    const replacedPaths = Array.from(new Set(docStoragePaths(snap.data()))).filter(x => !fresh.has(x));
    tx.update(ref, { ...fields, replacedPaths });
    return { replacedPaths };
  });

/** Result of the CPU stage of one photo (never rejects; set=null means "use the per-copy fallback"). */
interface PreparedPhoto {
  dims: { width: number; height: number } | null;
  set: DerivativeResult | null;
}

/**
 * CPU stage: measure + decode once + every resized/watermarked copy, in a Web
 * Worker. Started ahead of the upload slot by runUploadJob, so photo N+1 is
 * being resized while photo N uploads.
 */
const preparePhoto = async (file: File, req: DerivativeRequest, token: RunToken): Promise<PreparedPhoto> => {
  const dims = await measureImage(file);
  // Undecodable in <img> (e.g. HEIC): let the per-copy path handle it exactly as before.
  if (!dims || token.cancelled) return { dims, set: null };
  try {
    const set = await generateDerivatives(file, req, { expected: dims, isCancelled: () => token.cancelled });
    return { dims, set };
  } catch (err) {
    if (!(err instanceof DerivativesCancelled)) {
      console.warn('[Upload] Fast image processing failed, using the per-copy path:', file.name, err);
    }
    return { dims, set: null };
  }
};

type WatermarkReq = { url: string; position: WatermarkPosition; offsetX: number; offsetY: number } | null;

/** Gallery copies — sizes/qualities identical to the per-copy path in processGalleryFile. */
const galleryDerivativeRequest = (wm: WatermarkReq): DerivativeRequest => ({
  outputs: [
    { key: 'display', maxDim: 4096, quality: 0.85, watermark: !!wm },
    { key: 'previewClean', maxDim: 1200, quality: 0.78, watermark: false },
    ...(wm ? [{ key: 'previewWm', maxDim: 1200, quality: 0.78, watermark: true }] : []),
    { key: 'thumb', maxDim: 600, quality: 0.75, watermark: !!wm },
  ],
  watermark: wm,
});

/** Class copies — the display copy exists only when watermarked (else the original is shown). */
const classDerivativeRequest = (wm: WatermarkReq): DerivativeRequest => ({
  outputs: [
    ...(wm ? [{ key: 'display', maxDim: 2048, quality: 0.82, watermark: true }] : []),
    { key: 'previewClean', maxDim: 1200, quality: 0.78, watermark: false },
    ...(wm ? [{ key: 'previewWm', maxDim: 1200, quality: 0.78, watermark: true }] : []),
    { key: 'thumb', maxDim: 600, quality: 0.75, watermark: !!wm },
  ],
  watermark: wm,
});

interface FileEntry {
  file: File;
  folder: string;
  /** Name the photo is stored under: the file's own, or "X (2).jpg" for "Păstrează ambele". */
  name: string;
  progressKey: string;   // unique per job (folders may repeat file names)
  displayName: string;
  ident: string;         // uploadIdentityKey of the selected file — in-flight de-duplication
  /** Identity under the new name ("Păstrează ambele"), reserved in the in-flight set too. */
  aliasIdent?: string;
  /** "Înlocuiește": document id of the existing photo this file replaces in place. */
  replaceId?: string;
}

/** One question for the conflict dialog (queued: one dialog at a time). */
interface ConflictRequest {
  id: number;
  label: string;
  totalFiles: number;
  autoSkipped: number;
  conflicts: UploadConflict[];
  /** The selected files, by position (UploadConflict.index): previews in the dialog. */
  files: File[];
  resolve: (choices: ConflictAction[] | null) => void;
}

/** Nothing counts as already uploaded (after the dialog: the photographer decided). */
const EMPTY_UPLOAD_INDEX: ExistingUploadIndex = { exact: new Set(), nameOnly: new Set() };

/** Smallest image of a stored photo for the conflict dialog (CDN-rewritten there). */
const existingThumbOf = (p: ExistingPhotoRef): string | null =>
  p.thumbUrl || p.previewCleanUrl || p.previewUrl || p.url || p.cleanUrl || null;

const readExisting = (src?: ExistingPhotosSource): ExistingPhotoRef[] => {
  try {
    const list = typeof src === 'function' ? src() : src;
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

interface RunConfig {
  jobKey: string;
  kind: 'gallery' | 'class';
  label?: string;
  galleryId: string;
  subId: string;
  /** Before the first file (e.g. class migration). Throwing fails the run's files (retryable). */
  prepare?: () => Promise<void>;
  /** CPU stage of one file; started ahead of its upload slot (see PREPARE_AHEAD). Must not reject. */
  prepareFile?: (entry: FileEntry, token: RunToken) => Promise<PreparedPhoto>;
  processOne: (entry: FileEntry, token: RunToken, setStatus: (patch: Partial<ProgressItem>) => void, prepared?: Promise<PreparedPhoto>) => Promise<void>;
  /** After a run that stored at least one photo (ordering, counters). */
  afterRun?: () => Promise<void>;
}

export const UploadProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Jobs live in a ref (source of truth, read synchronously by the workers) and
  // are mirrored into state at most every 150ms, so thousands of progress
  // events don't each re-render the app.
  const jobsRef = useRef<Record<string, UploadJob>>({});
  const [jobs, setJobs] = useState<Record<string, UploadJob>>({});
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isOnline, setIsOnline] = useState<boolean>(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  const [interruptedUploads, setInterruptedUploads] = useState<UploadJournalEntry[]>(() => readUploadJournal());

  // Store listeners for real-time photo addition and deletion callbacks
  const listenersRef = useRef<Record<string, ((photo: PhotoItem, subId: string) => void)[]>>({});
  const deleteListenersRef = useRef<Record<string, ((deletedIds: string[], subId: string) => void)[]>>({});
  // Separate registry for class albums — lets the dashboard append photos live
  // while the background job runs.
  const classListenersRef = useRef<Record<string, ((photo: ClassPhoto) => void)[]>>({});

  // Per job: cancellation tokens of its running runs, how many runs are active,
  // identity keys of files queued/in flight, and the files that failed.
  const tokensRef = useRef<Record<string, Set<RunToken>>>({});
  const runsRef = useRef<Record<string, number>>({});
  const pendingRef = useRef<Record<string, Set<string>>>({});
  const failedRef = useRef<Record<string, { cfg: RunConfig; entry: FileEntry }[]>>({});

  // Conflict dialog ("X fotografii există deja"): one question at a time.
  const conflictQueueRef = useRef<ConflictRequest[]>([]);
  const conflictSeqRef = useRef(0);
  const [activeConflict, setActiveConflict] = useState<ConflictRequest | null>(null);

  // Delete queue
  const deleteQueueRef = useRef<{ spec: DeleteTaskSpec; resolve: (r: DeleteTaskResult) => void }[]>([]);
  const deleteRunningRef = useRef(false);
  const deleteDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback((immediate = false) => {
    if (immediate) {
      if (flushTimerRef.current !== null) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
      setJobs({ ...jobsRef.current });
      return;
    }
    if (flushTimerRef.current !== null) return;
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      setJobs({ ...jobsRef.current });
    }, 150);
  }, []);

  const patchJob = useCallback((jobKey: string, patch: Partial<UploadJob> | ((job: UploadJob) => Partial<UploadJob>), immediate = false) => {
    const job = jobsRef.current[jobKey];
    if (!job) return;
    const p = typeof patch === 'function' ? patch(job) : patch;
    jobsRef.current = { ...jobsRef.current, [jobKey]: { ...job, ...p } };
    flush(immediate);
  }, [flush]);

  const removeJob = useCallback((jobKey: string) => {
    if (!jobsRef.current[jobKey]) return;
    const next = { ...jobsRef.current };
    delete next[jobKey];
    jobsRef.current = next;
    flush(true);
  }, [flush]);

  const setFileStatus = (jobKey: string, key: string, patch: Partial<ProgressItem>) => {
    patchJob(jobKey, j => ({
      progressMap: {
        ...j.progressMap,
        [key]: { ...(j.progressMap[key] || { name: key, progress: 0, status: '' }), ...patch },
      },
    }));
  };

  const writeJournal = (jobKey: string) => {
    const j = jobsRef.current[jobKey];
    if (!j || j.kind === 'delete') return;
    writeUploadJournalEntry({
      jobKey,
      kind: j.kind,
      label: j.label || (j.kind === 'class' ? 'clasă' : 'galerie'),
      total: j.filesTotal,
      done: j.filesUploaded,
      failed: j.filesFailed,
      updatedAt: Date.now(),
    });
  };

  // Network state: the queue keeps running and simply waits while offline.
  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // Closing / reloading the tab would drop the queue — ask first.
  const hasPendingTransfers = Object.values(jobs).some(j => !j.isFinished);
  useEffect(() => {
    if (!hasPendingTransfers) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasPendingTransfers]);

  useEffect(() => () => {
    if (flushTimerRef.current !== null) clearTimeout(flushTimerRef.current);
    if (deleteDismissTimerRef.current !== null) clearTimeout(deleteDismissTimerRef.current);
  }, []);

  const onPhotoUploaded = useCallback((targetGalleryId: string, callback: (photo: PhotoItem, subId: string) => void) => {
    const current = listenersRef.current[targetGalleryId] || [];
    listenersRef.current[targetGalleryId] = [...current, callback];

    return () => {
      const current = listenersRef.current[targetGalleryId] || [];
      listenersRef.current[targetGalleryId] = current.filter(cb => cb !== callback);
    };
  }, []);

  const onClassPhotoUploaded = useCallback((classId: string, callback: (photo: ClassPhoto) => void) => {
    const current = classListenersRef.current[classId] || [];
    classListenersRef.current[classId] = [...current, callback];

    return () => {
      const list = classListenersRef.current[classId] || [];
      classListenersRef.current[classId] = list.filter(cb => cb !== callback);
    };
  }, []);

  const onPhotosDeleted = useCallback((targetGalleryId: string, callback: (deletedIds: string[], subId: string) => void) => {
    const current = deleteListenersRef.current[targetGalleryId] || [];
    deleteListenersRef.current[targetGalleryId] = [...current, callback];

    return () => {
      const current = deleteListenersRef.current[targetGalleryId] || [];
      deleteListenersRef.current[targetGalleryId] = current.filter(cb => cb !== callback);
    };
  }, []);

  // Dismiss a finished job (close its tile in the bar)
  const dismissJob = useCallback((jobKey: string) => {
    const job = jobsRef.current[jobKey];
    if (job && job.kind !== 'delete') {
      delete failedRef.current[jobKey];
      removeUploadJournalEntry(jobKey);
    }
    removeJob(jobKey);
  }, [removeJob]);

  // Legacy resetUploadState — dismisses all finished jobs
  const resetUploadState = useCallback(() => {
    const next: Record<string, UploadJob> = {};
    Object.values(jobsRef.current).forEach(job => {
      if (!job.isFinished) next[job.jobKey] = job;
    });
    jobsRef.current = next;
    flush(true);
  }, [flush]);

  const dismissInterrupted = useCallback((jobKey: string) => {
    removeUploadJournalEntry(jobKey);
    setInterruptedUploads(list => list.filter(e => e.jobKey !== jobKey));
  }, []);

  /** Ask the conflict question; resolves with one action per conflict, or null = cancel the upload. */
  const askConflicts = (req: Omit<ConflictRequest, 'id' | 'resolve'>) =>
    new Promise<ConflictAction[] | null>(resolve => {
      conflictQueueRef.current.push({ ...req, id: ++conflictSeqRef.current, resolve });
      setActiveConflict(cur => cur ?? conflictQueueRef.current[0] ?? null);
    });

  // Keyed by request id: a double click / repeated Escape on a dialog that is
  // still mounted must not answer the NEXT queued question with those choices.
  const resolveActiveConflict = useCallback((id: number, choices: ConflictAction[] | null) => {
    if (conflictQueueRef.current[0]?.id !== id) return;
    const req = conflictQueueRef.current.shift();
    setActiveConflict(conflictQueueRef.current[0] ?? null);
    req?.resolve(choices);
  }, []);

  /**
   * Decide which files of a selection are uploaded, and how.
   *
   * 1. Files already queued / in flight for the same job are skipped without
   *    asking (de-duplication of the running queue).
   * 2. Every other file with the name of a photo already in the destination (or
   *    of an earlier file of the same selection) is asked about once, for the
   *    whole batch: skip / replace / keep both, or cancel everything. Files that
   *    look already uploaded (the resume match: same name + size, name only for
   *    older class photos, kept copies) are in that list too, marked identical
   *    and pre-set to "Sari peste" — re-selecting a folder after an interruption
   *    is "Continuă" on a dialog where everything already there is skipped.
   *
   * Uses only the lists already in memory — no Firestore reads. Returns null
   * when the photographer cancelled.
   */
  const planSelection = async (plan: {
    jobKey: string;
    label: string;
    scope: string;
    entries: FileEntry[];
    index: ExistingUploadIndex;
    existing: () => ConflictExisting[];
  }): Promise<{ upload: FileEntry[]; skipped: number } | null> => {
    const { jobKey, scope, entries, index } = plan;
    let inFlight = (pendingRef.current[jobKey] ||= new Set());
    const candidates: ConflictCandidate[] = entries.map(e => ({
      scope, folder: e.folder, name: e.file.name, size: e.file.size,
      lastModified: e.file.lastModified || undefined, displayName: e.displayName,
    }));
    const scan = scanUploadConflicts({ candidates, index, inFlight, existing: plan.existing() });

    let choices: ConflictAction[] = [];
    if (scan.conflicts.length > 0) {
      const answer = await askConflicts({
        label: plan.label,
        totalFiles: entries.length,
        autoSkipped: scan.autoSkip.length,
        conflicts: scan.conflicts,
        files: entries.map(e => e.file),
      });
      if (!answer) return null;
      choices = answer;
      // The job may have been cancelled while the dialog was open, which drops
      // its in-flight set; reserve this selection in the set the next run uses.
      inFlight = (pendingRef.current[jobKey] ||= new Set());
    }

    const skip = new Set<number>(scan.autoSkip);
    const keepBoth = new Set<number>();
    const replaceIds = new Map<number, string>();
    if (scan.conflicts.length > 0) {
      // The destination as it is NOW (photos may have arrived while the dialog
      // was open): which document a replace targets, which names are taken.
      const existingNow = plan.existing();
      const firstIdByKey = new Map<string, string>();
      const nameById = new Map<string, string>();
      const keyById = new Map<string, string>();
      const existingKeys = new Set<string>();
      const taken = new Map<string, Set<string>>();
      const take = (group: string, nameKey: string) => {
        let set = taken.get(group);
        if (!set) { set = new Set(); taken.set(group, set); }
        set.add(nameKey);
      };
      existingNow.forEach(ph => {
        if (!ph || !ph.name) return;
        take(conflictGroupKey(ph.scope, ph.folder), conflictNameKey(ph.name));
        const k = conflictTargetKey(ph.scope, ph.folder, ph.name);
        existingKeys.add(k);
        // Several photos with this name (e.g. two cameras): the first one shown
        // is replaced, the others are left exactly as they are.
        if (ph.id && !firstIdByKey.has(k)) firstIdByKey.set(k, ph.id);
        if (ph.id && !nameById.has(ph.id)) { nameById.set(ph.id, ph.name); keyById.set(ph.id, k); }
      });
      candidates.forEach(c => take(conflictGroupKey(c.scope, c.folder), conflictNameKey(c.name)));
      inFlight.forEach(id => {
        const t = parseUploadIdentityKey(id);
        if (t) take(conflictGroupKey(t.scope, t.folder), conflictNameKey(t.name));
      });

      scan.conflicts.forEach((c, i) => {
        const action = choices[i] ?? 'skip';
        if (action === 'skip') { skip.add(c.index); return; }
        if (action === 'replace' && c.kind === 'existing' && c.replaceable) {
          // The photo the file was matched with (identical files) if it is still
          // in the same place under the same name, else the first photo with this name.
          const id = (c.targetId && keyById.get(c.targetId) === c.key ? c.targetId : undefined) ?? firstIdByKey.get(c.key);
          // Gone meanwhile -> uploaded as a new photo. No document id (legacy
          // entry inside the parent document) -> cannot be replaced in place,
          // so it is kept as a copy rather than silently duplicating the name.
          if (id) { replaceIds.set(c.index, id); return; }
          const own = candidates[c.index];
          if (!existingKeys.has(c.key) && !existingKeys.has(conflictTargetKey(own.scope, own.folder, own.name))) return;
        }
        keepBoth.add(c.index);
      });

      // New names for "Păstrează ambele", unique against the destination, the
      // whole selection, files in flight and each other.
      keepBoth.forEach(i => {
        const c = candidates[i];
        const group = conflictGroupKey(c.scope, c.folder);
        const set = taken.get(group) || new Set<string>();
        const name = keepBothName(c.name, k => set.has(k));
        set.add(conflictNameKey(name));
        taken.set(group, set);
        const e = entries[i];
        entries[i] = {
          ...e,
          name,
          displayName: e.folder ? `${e.folder} / ${name}` : name,
          progressKey: `${e.progressKey} → ${name}`,
          aliasIdent: uploadIdentityKey({ scope, folder: e.folder, name, size: e.file.size }),
        };
      });
      replaceIds.forEach((id, i) => {
        const e = entries[i];
        // Replacing a kept copy ("X (2).jpg" identical to X.jpg): the document
        // keeps its stored name, so it stays a copy in place.
        const stored = nameById.get(id);
        if (stored && conflictNameKey(stored) !== conflictNameKey(e.name)) {
          entries[i] = {
            ...e,
            name: stored,
            displayName: e.folder ? `${e.folder} / ${stored}` : stored,
            progressKey: `${e.progressKey} → ${stored}`,
            aliasIdent: uploadIdentityKey({ scope, folder: e.folder, name: stored, size: e.file.size }),
            replaceId: id,
          };
        } else {
          entries[i] = { ...e, replaceId: id };
        }
      });
    }

    const remaining = entries.filter((_e, i) => !skip.has(i));
    // Queue de-duplication again (catches files queued while the dialog was
    // open). Not the "already uploaded" index: every file that matched it was in
    // the dialog, and one the photographer chose to replace / keep must go.
    const { upload, skipped } = partitionForUpload(
      remaining,
      e => ({ scope, folder: e.folder, name: e.file.name, size: e.file.size }),
      EMPTY_UPLOAD_INDEX,
      inFlight
    );
    upload.forEach(e => { if (e.aliasIdent) inFlight.add(e.aliasIdent); });
    return { upload, skipped: skip.size + skipped.length };
  };

  // Re-sort all photos in a subcollection by name and write order 0,1,2... in a batch.
  // Called after a file batch completes to maintain name-sorted order.
  const reorderPhotosByName = async (targetGalleryId: string, targetSubId: string) => {
    try {
      const photosCol = collection(
        db,
        'photo_galleries', targetGalleryId,
        'subcollections', targetSubId,
        'photos'
      );
      const snap = await getDocs(photosCol);
      if (snap.empty) return;

      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() as any }));
      const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

      // Check if admin has set a manual drag order (any photo has a non-null order)
      const hasManualOrder = docs.some(d => d.order !== null && d.order !== undefined);

      if (hasManualOrder) {
        // Gallery has a custom order — only handle NEW uploads that still have order:null.
        // Assign them order values starting from maxExistingOrder+1 so they appear
        // neatly at the END of the gallery rather than floating randomly.
        const nullOrderDocs = docs.filter(d => d.order === null || d.order === undefined);
        if (nullOrderDocs.length === 0) return; // nothing to do

        const maxOrder = docs.reduce((max, d) => {
          const v = (d.order !== null && d.order !== undefined) ? d.order as number : -1;
          return Math.max(max, v);
        }, -1);

        // Sort new photos by name so their appended order is deterministic
        nullOrderDocs.sort((a, b) => collator.compare(a.name, b.name));

        for (let i = 0; i < nullOrderDocs.length; i += BATCH_LIMIT) {
          const batch = writeBatch(db);
          nullOrderDocs.slice(i, i + BATCH_LIMIT).forEach((d, idx) => {
            const photoRef = snap.docs.find(sd => sd.id === d.id)!.ref;
            batch.update(photoRef, { order: maxOrder + 1 + i + idx });
          });
          await batch.commit();
        }
      } else {
        // No manual ordering yet — sort everything by name and write 0,1,2,...
        docs.sort((a, b) => collator.compare(a.name, b.name));

        for (let i = 0; i < docs.length; i += BATCH_LIMIT) {
          const batch = writeBatch(db);
          const chunk = docs.slice(i, i + BATCH_LIMIT);
          chunk.forEach((d, idx) => {
            const photoRef = snap.docs.find(sd => sd.id === d.id)!.ref;
            batch.update(photoRef, { order: i + idx });
          });
          await batch.commit();
        }
      }
    } catch (e) {
      console.error('Failed to reorder photos by name:', e);
    }
  };

  // Explicitly force A-Z sort by name for all photos in a subcollection, writing order: 0, 1, 2...
  const forceReorderByName = async (targetGalleryId: string, targetSubId: string) => {
    try {
      const photosCol = collection(
        db,
        'photo_galleries', targetGalleryId,
        'subcollections', targetSubId,
        'photos'
      );
      const snap = await getDocs(photosCol);
      if (snap.empty) return;

      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() as any }));
      const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
      docs.sort((a, b) => collator.compare(a.name, b.name));

      for (let i = 0; i < docs.length; i += BATCH_LIMIT) {
        const batch = writeBatch(db);
        const chunk = docs.slice(i, i + BATCH_LIMIT);
        chunk.forEach((d, idx) => {
          const photoRef = snap.docs.find(sd => sd.id === d.id)!.ref;
          batch.set(photoRef, { order: i + idx }, { merge: true });
        });
        await batch.commit();
      }
    } catch (e) {
      console.error('Failed to force reorder photos by name:', e);
    }
  };

  /**
   * Shared queue runner for gallery and class uploads.
   *
   * - Several runs may feed the same job (another selection for the same
   *   target, a retry); the job is finished when the last one ends.
   * - Files that fail are kept (in memory) for "Reîncearcă eșuatele"; files
   *   already uploaded are never redone.
   * - While the browser is offline no new file is started; files in flight are
   *   retried by the SDK for up to 6 hours, so a sleeping laptop resumes.
   */
  const runUploadJob = async (cfg: RunConfig, entries: FileEntry[], skipped: number, isRetry: boolean) => {
    const { jobKey } = cfg;
    const prev = jobsRef.current[jobKey];
    const keep = !!prev && prev.kind === cfg.kind && (!prev.isFinished || isRetry);

    const initialMap: Record<string, ProgressItem> = {};
    entries.forEach(e => { initialMap[e.progressKey] = { name: e.displayName, progress: 0, status: 'Așteptare...' }; });

    jobsRef.current = {
      ...jobsRef.current,
      [jobKey]: {
        jobKey,
        kind: cfg.kind,
        label: cfg.label || (keep ? prev!.label : undefined),
        galleryId: cfg.galleryId,
        subId: cfg.subId,
        filesTotal: (keep ? prev!.filesTotal : 0) + (isRetry ? 0 : entries.length),
        filesUploaded: keep ? prev!.filesUploaded : 0,
        filesFailed: keep ? Math.max(0, prev!.filesFailed - (isRetry ? entries.length : 0)) : 0,
        filesSkipped: (keep ? prev!.filesSkipped : 0) + skipped,
        isFinished: false,
        progressMap: { ...(keep ? prev!.progressMap : {}), ...initialMap },
      },
    };
    if (!keep) failedRef.current[jobKey] = [];
    flush(true);
    setInterruptedUploads(list => (list.some(e => e.jobKey === jobKey) ? list.filter(e => e.jobKey !== jobKey) : list));

    const token: RunToken = { cancelled: false, tasks: new Set() };
    (tokensRef.current[jobKey] ||= new Set()).add(token);
    runsRef.current[jobKey] = (runsRef.current[jobKey] || 0) + 1;
    const pending = (pendingRef.current[jobKey] ||= new Set());
    const release = (e: FileEntry) => {
      pending.delete(e.ident);
      if (e.aliasIdent) pending.delete(e.aliasIdent);
    };
    if (entries.length > 0) writeJournal(jobKey);

    const markFailed = (e: FileEntry, err: unknown) => {
      (failedRef.current[jobKey] ||= []).push({ cfg, entry: e });
      patchJob(jobKey, j => ({
        filesFailed: j.filesFailed + 1,
        progressMap: {
          ...j.progressMap,
          [e.progressKey]: { ...(j.progressMap[e.progressKey] || { name: e.displayName, progress: 0, status: '' }), status: `Eroare: ${errorText(err)}` },
        },
      }));
      writeJournal(jobKey);
    };

    try {
      if (entries.length === 0) return;
      await waitForOnline();

      let prepared = true;
      if (cfg.prepare) {
        try {
          await cfg.prepare();
        } catch (err) {
          console.error('[Upload] Could not prepare upload target:', jobKey, err);
          prepared = false;
          if (!token.cancelled) entries.forEach(e => markFailed(e, err));
        }
      }

      let uploadedInRun = 0;
      if (prepared) {
        let next = 0;
        // Pipeline: the CPU stage of the next PREPARE_AHEAD files runs while the
        // current ones upload. Results are dropped as soon as their file is done.
        const preparing = new Map<number, Promise<PreparedPhoto>>();
        const prepareAt = (i: number) => {
          if (!cfg.prepareFile || i >= entries.length || preparing.has(i) || token.cancelled) return;
          preparing.set(i, cfg.prepareFile(entries[i], token));
        };
        const worker = async () => {
          while (!token.cancelled && next < entries.length) {
            const idx = next++;
            const e = entries[idx];
            prepareAt(idx);
            for (let k = 0; k < PREPARE_AHEAD; k++) prepareAt(next + k);
            await waitForOnline();
            if (token.cancelled) break;
            try {
              await cfg.processOne(e, token, (patch) => setFileStatus(jobKey, e.progressKey, patch), preparing.get(idx));
              if (token.cancelled) break;
              uploadedInRun++;
              patchJob(jobKey, j => ({
                filesUploaded: j.filesUploaded + 1,
                progressMap: {
                  ...j.progressMap,
                  [e.progressKey]: { ...(j.progressMap[e.progressKey] || { name: e.displayName, progress: 0, status: '' }), progress: 100, status: 'Finalizat' },
                },
              }));
              writeJournal(jobKey);
            } catch (err) {
              if (token.cancelled || err instanceof CancelledError) break;
              // One bad file must not stop a 20k-file night, so the loop continues.
              console.error('[Upload] Error uploading photo:', e.displayName, err);
              markFailed(e, err);
            } finally {
              release(e);
              preparing.delete(idx);
            }
            await nextTick();
          }
        };
        await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, entries.length) }, () => worker()));
      }

      // Photos stored before a cancel still need ordering / counting.
      if (uploadedInRun > 0 && cfg.afterRun) {
        await waitForOnline();
        try { await cfg.afterRun(); } catch (e) { console.warn('[Upload] Post-upload step failed:', e); }
      }
    } finally {
      entries.forEach(release);
      tokensRef.current[jobKey]?.delete(token);
      // A cancelled run was already written off by cancelUpload.
      if (!token.cancelled) {
        runsRef.current[jobKey] = Math.max(0, (runsRef.current[jobKey] || 1) - 1);
        if (runsRef.current[jobKey] === 0 && jobsRef.current[jobKey]) {
          patchJob(jobKey, { isFinished: true }, true);
          const j = jobsRef.current[jobKey];
          if (j.filesFailed === 0) removeUploadJournalEntry(jobKey);
          else writeJournal(jobKey);
        }
      }
    }
  };

  /** Gallery photo: clean original + display copy + previews + thumb, then its doc. */
  const processGalleryFile = async (
    entry: FileEntry,
    targetGalleryId: string,
    targetSubId: string,
    watermarkEnabled: boolean,
    globalWatermark: any | null,
    watermarkPosition: WatermarkPosition,
    watermarkOffsetX: number,
    watermarkOffsetY: number,
    token: RunToken,
    setStatus: (patch: Partial<ProgressItem>) => void,
    prepared?: Promise<PreparedPhoto>
  ) => {
    const { file } = entry;
    // Stored name: the file's own, or "X (2).jpg" when kept next to an existing photo.
    const fileName = entry.name;
    setStatus({ status: watermarkEnabled ? 'Aplicare watermark...' : 'Optimizare...' });
    const wmReq: WatermarkReq = watermarkEnabled && globalWatermark
      ? { url: globalWatermark.url, position: watermarkPosition, offsetX: watermarkOffsetX, offsetY: watermarkOffsetY }
      : null;
    const prep = await (prepared ?? preparePhoto(file, galleryDerivativeRequest(wmReq), token));
    if (token.cancelled) throw new CancelledError();
    const imgDims = prep.dims || { width: 2000, height: 1333 };

    // Archive copy: the original file, byte-for-byte. No canvas, so no
    // re-encode and no downscale — EXIF and colour profile survive, which
    // is what the photographer needs for editing and print.
    const cleanBlob: Blob = file;
    let wmBlob: Blob;
    let previewCleanBlob: Blob | null = null;
    let previewWmBlob: Blob | null = null;
    let thumbBlob: Blob | null = null;

    if (prep.set) {
      // Fast path: every copy came from one decode in a Web Worker.
      const b = prep.set.blobs;
      wmBlob = b.display;
      previewCleanBlob = b.previewClean;
      previewWmBlob = b.previewWm ?? null;
      thumbBlob = b.thumb;
    } else {
      // Per-copy fallback: the original path, on the main thread.
      // Display copy — always produced, watermarked when enabled and simply
      // size-capped when not. Kept separate from the archive copy so what
      // clients load never depends on how large the original happens to be.
      try {
        wmBlob = await applyWatermarkLimited(
          file,
          watermarkEnabled && globalWatermark ? globalWatermark.url : null,
          watermarkPosition,
          watermarkOffsetX,
          watermarkOffsetY,
          4096,
          0.85
        );
        await yieldToMain();
      } catch (wmErr) {
        console.error('Failed to optimize and compress file:', file.name, wmErr);
        throw new Error('Eroare la optimizarea imaginii.');
      }

      // Compressed preview versions (~1200px) — used only for web grid display.
      // Non-fatal: if preview GENERATION fails (e.g. undecodable file), the
      // full-res copy is used as fallback. Once generated they are required.
      try {
        previewCleanBlob = await applyWatermarkLimited(file, null, watermarkPosition, watermarkOffsetX, watermarkOffsetY, 1200, 0.78);
        await yieldToMain();
        if (watermarkEnabled && globalWatermark) {
          previewWmBlob = await applyWatermarkLimited(file, globalWatermark.url, watermarkPosition, watermarkOffsetX, watermarkOffsetY, 1200, 0.78);
          await yieldToMain();
        }
        // ~600px copy: what a phone actually needs in the grid. Desktops keep
        // the 1200px one through srcset. Cuts grid traffic by about two thirds.
        thumbBlob = await applyWatermarkLimited(
          file,
          watermarkEnabled && globalWatermark ? globalWatermark.url : null,
          watermarkPosition, watermarkOffsetX, watermarkOffsetY, 600, 0.75
        );
        await yieldToMain();
      } catch (previewErr) {
        console.warn('[Preview] Preview generation failed, will use full-res for display:', previewErr);
        previewCleanBlob = null;
        previewWmBlob = null;
        thumbBlob = null;
      }
    }

    if (token.cancelled) throw new CancelledError();

    // Timestamp + random suffix guarantee unique Storage paths: files upload in
    // parallel and two shoots can easily contain the same filename.
    const ts = `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const base = `galleries/${targetGalleryId}/${targetSubId}`;
    const cleanPath = `${base}/clean_${ts}_${fileName}`;
    const wmPath = `${base}/wm_${ts}_${fileName}`;
    const prevPath = `${base}/prev_${ts}_${fileName}`;
    const prevWmPath = `${base}/prevwm_${ts}_${fileName}`;
    const thumbPath = `${base}/thumb_${ts}_${fileName}`;

    const parts: UploadPart[] = [
      { path: cleanPath, blob: cleanBlob },
      { path: wmPath, blob: wmBlob },
    ];
    if (previewCleanBlob) parts.push({ path: prevPath, blob: previewCleanBlob });
    if (previewWmBlob) parts.push({ path: prevWmPath, blob: previewWmBlob });
    if (thumbBlob) parts.push({ path: thumbPath, blob: thumbBlob });

    setStatus({ progress: 5, status: 'Încărcare...' });
    const urls = await uploadParts(parts, token, fileName, (pct) => setStatus({ progress: Math.max(5, pct), status: 'Încărcare...' }));
    const urlOf = (p: string) => { const i = parts.findIndex(x => x.path === p); return i >= 0 ? urls[i] : undefined; };

    if (token.cancelled) {
      removeOrphans(parts.map(p => p.path));
      throw new CancelledError();
    }

    const cleanUrl = urlOf(cleanPath)!;
    const wmUrl = urlOf(wmPath)!;
    const previewCleanUrl = urlOf(prevPath);
    const previewWmUrl = urlOf(prevWmPath);
    const thumbUrl = urlOf(thumbPath);

    const newItem: PhotoItem = {
      name: fileName,
      url: wmUrl,
      path: wmPath,
      cleanUrl,
      cleanPath,
      // Preview URL mirrors the same watermark logic as full-res
      previewUrl: previewWmUrl ?? previewCleanUrl,
      previewPath: previewWmUrl ? prevWmPath : previewCleanUrl ? prevPath : undefined,
      previewCleanUrl,
      previewCleanPath: previewCleanUrl ? prevPath : undefined,
      thumbUrl,
      thumbPath: thumbUrl ? thumbPath : undefined,
      width: imgDims.width,
      height: imgDims.height,
      size: file.size,
      ...(file.lastModified ? { lastModified: file.lastModified } : {}),
    };

    setStatus({ progress: 99, status: 'Salvare...' });

    // Written only now, after every copy is in Storage. With "Înlocuiește", the
    // existing photo of the same name is updated in place (same id, same
    // position); if it was deleted meanwhile, the photo is added as usual.
    // A failed replace fails the file (retryable) instead of adding a
    // duplicate next to the photo it was meant to replace.
    let firestoreId: string | undefined;
    let replacedPaths: string[] | undefined;
    if (entry.replaceId) {
      let res: { replacedPaths: string[] } | null;
      try {
        res = await replacePhotoInPlace(
          collection(db, 'photo_galleries', targetGalleryId, 'subcollections', targetSubId, 'photos'),
          entry.replaceId,
          {
            ...galleryPhotoFields(newItem),
            // Identity of the NEW file — never the old file's values left over.
            size: file.size > 0 ? file.size : null,
            lastModified: file.lastModified > 0 ? file.lastModified : null,
          },
          parts.map(x => x.path)
        );
      } catch (e: any) {
        // The new Storage copies stay (orphans, harmless); the old photo is untouched.
        console.error('Failed to replace gallery photo:', fileName, e);
        throw new Error(`Nu s-a putut înlocui poza (${errorText(e)})`);
      }
      if (res) {
        firestoreId = entry.replaceId;
        replacedPaths = res.replacedPaths;
      }
    }
    if (!firestoreId) {
      try {
        const docRef = await addDoc(
          collection(db, 'photo_galleries', targetGalleryId, 'subcollections', targetSubId, 'photos'),
          { ...galleryPhotoFields(newItem), order: null } // null = sort by name; set to integer when drag-reordered
        );
        firestoreId = docRef.id;
      } catch (e: any) {
        // The Storage copies stay (orphans, harmless); the file is retryable.
        console.error('Failed to add photo to Firestore subcollection:', e);
        throw new Error(`Nu s-a putut salva poza (${errorText(e)})`);
      }
    }
    const newItemWithId: PhotoItem = { ...newItem, firestoreId, ...(replacedPaths ? { replacedPaths } : {}) };

    // Trigger listener (includes firestoreId and targetSubId so UI updates correct folder)
    if (!token.cancelled) {
      (listenersRef.current[targetGalleryId] || []).forEach(cb => cb(newItemWithId, targetSubId));
    }
  };

  const startUpload = useCallback(async (
    filesArray: File[],
    targetGalleryId: string,
    targetSubId: string,
    watermarkEnabled: boolean,
    globalWatermark: any | null,
    watermarkPosition: WatermarkPosition,
    watermarkOffsetX: number,
    watermarkOffsetY: number,
    opts?: { label?: string; skippedCount?: number; existingPhotos?: ExistingPhotosSource }
  ) => {
    const jobKey = `${targetGalleryId}:${targetSubId}`;
    const all: FileEntry[] = filesArray.map(file => {
      const rel = (file as any).webkitRelativePath || '';
      return {
        file,
        folder: '',
        name: file.name,
        progressKey: rel || file.name,
        displayName: file.name,
        ident: uploadIdentityKey({ scope: targetSubId, folder: '', name: file.name, size: file.size }),
      };
    });
    // Photos of the target folder (videos are not something a photo replaces).
    const existing = () => readExisting(opts?.existingPhotos).filter(p => p && !p.isVideo);
    // Identical ("deja încărcată") = same name AND size (resume after an
    // interruption): in the dialog, pre-set to "Sari peste". Older photos
    // without a stored size are not assumed to be the same file (plain conflicts).
    const index = buildExistingUploadIndex(
      existing()
        .filter(p => typeof p.size === 'number' && p.size > 0)
        .map(p => ({ scope: targetSubId, folder: '', name: p.name, size: p.size }))
    );
    const plan = await planSelection({
      jobKey,
      label: opts?.label || 'galerie',
      scope: targetSubId,
      entries: all,
      index,
      existing: () => existing().map(p => ({
        scope: targetSubId,
        folder: '',
        name: getPhotoDisplayName(p),
        size: p.size,
        lastModified: p.lastModified,
        id: p.firestoreId,
        thumbUrl: existingThumbOf(p),
      })),
    });
    if (!plan) return; // cancelled in the conflict dialog: nothing is uploaded
    const { upload, skipped } = plan;

    const cfg: RunConfig = {
      jobKey,
      kind: 'gallery',
      label: opts?.label,
      galleryId: targetGalleryId,
      subId: targetSubId,
      prepareFile: (e, token) => preparePhoto(e.file, galleryDerivativeRequest(
        watermarkEnabled && globalWatermark
          ? { url: globalWatermark.url, position: watermarkPosition, offsetX: watermarkOffsetX, offsetY: watermarkOffsetY }
          : null
      ), token),
      processOne: (e, token, setStatus, prepared) => processGalleryFile(
        e, targetGalleryId, targetSubId, watermarkEnabled, globalWatermark,
        watermarkPosition, watermarkOffsetX, watermarkOffsetY, token, setStatus, prepared
      ),
      // Re-sort photos by name in Firestore (only if admin hasn't applied a custom drag-reorder)
      afterRun: () => reorderPhotosByName(targetGalleryId, targetSubId),
    };
    await runUploadJob(cfg, upload, skipped + Math.max(0, opts?.skippedCount || 0), false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Class photo: display copy (+ clean original when watermarked) + previews + thumb, then its doc. */
  const processClassFile = async (
    entry: FileEntry,
    classId: string,
    watermarkEnabled: boolean,
    watermarkUrl: string | null,
    watermarkPosition: WatermarkPosition,
    watermarkOffsetX: number,
    watermarkOffsetY: number,
    sessionId: string | undefined,
    token: RunToken,
    setStatus: (patch: Partial<ProgressItem>) => void,
    prepared?: Promise<PreparedPhoto>
  ): Promise<void> => {
    const { file } = entry;
    // Stored name: the file's own, or "X (2).jpg" when kept next to an existing photo.
    const fileName = entry.name;
    setStatus({ status: watermarkEnabled ? 'Aplicare watermark...' : 'Se procesează...' });

    // Natural size (measured in the CPU stage), so the public grids can reserve
    // each tile's height before the image loads. Stays null when the browser
    // cannot decode the file (e.g. HEIC); the grid then falls back to measuring on load.
    const wmReq: WatermarkReq = watermarkEnabled && watermarkUrl
      ? { url: watermarkUrl, position: watermarkPosition, offsetX: watermarkOffsetX, offsetY: watermarkOffsetY }
      : null;
    const prep = await (prepared ?? preparePhoto(file, classDerivativeRequest(wmReq), token));
    if (token.cancelled) throw new CancelledError();
    const imgDims = prep.dims;
    // Fast path: every copy from one decode in a Web Worker; null = per-copy fallback below.
    const fast = prep.set?.blobs;

    // Unique suffix matters: files upload in parallel, and two shoots can
    // easily contain the same filename. Date.now() alone can collide inside one
    // millisecond and silently overwrite a photo.
    const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const baseFileName = `${unique}_${fileName}`;

    // Archive copy is the original, byte for byte — EXIF and colour profile
    // survive for print. Only the displayed copy is ever re-encoded.
    const cleanBlob: Blob = file;
    let uploadBlob: Blob = file;
    let storagePath = `classes/${classId}/gallery/clean_${baseFileName}`;
    let cleanStoragePath = storagePath;

    if (watermarkEnabled && watermarkUrl && fast) {
      uploadBlob = fast.display;
      storagePath = `classes/${classId}/gallery/wm_${baseFileName}`;
      cleanStoragePath = `classes/${classId}/gallery/clean_${baseFileName}`;
    } else if (watermarkEnabled && watermarkUrl) {
      try {
        uploadBlob = await applyWatermarkLimited(file, watermarkUrl, watermarkPosition, watermarkOffsetX, watermarkOffsetY);
        storagePath = `classes/${classId}/gallery/wm_${baseFileName}`;
        cleanStoragePath = `classes/${classId}/gallery/clean_${baseFileName}`;
        await yieldToMain();
      } catch (wmErr) {
        console.error('[Upload] Watermark failed, falling back to original:', file.name, wmErr);
        uploadBlob = file;
        storagePath = `classes/${classId}/gallery/clean_${baseFileName}`;
        cleanStoragePath = storagePath;
      }
    }

    if (token.cancelled) throw new CancelledError();

    // ~1200px previews for the grids. Without them every thumbnail loaded a
    // multi-megabyte file, which is what made Storage egress the biggest line
    // on the bill. Generation is non-fatal; once generated they are required.
    let previewCleanBlob: Blob | null = null;
    let previewWmBlob: Blob | null = null;
    let thumbBlob: Blob | null = null;
    if (fast) {
      previewCleanBlob = fast.previewClean;
      previewWmBlob = fast.previewWm ?? null;
      thumbBlob = fast.thumb;
    } else try {
      previewCleanBlob = await applyWatermarkLimited(file, null, watermarkPosition, watermarkOffsetX, watermarkOffsetY, 1200, 0.78);
      await yieldToMain();
      if (watermarkEnabled && watermarkUrl) {
        previewWmBlob = await applyWatermarkLimited(file, watermarkUrl, watermarkPosition, watermarkOffsetX, watermarkOffsetY, 1200, 0.78);
        await yieldToMain();
      }
      thumbBlob = await applyWatermarkLimited(file, watermarkEnabled && watermarkUrl ? watermarkUrl : null, watermarkPosition, watermarkOffsetX, watermarkOffsetY, 600, 0.75);
      await yieldToMain();
    } catch (prevErr) {
      console.warn('[Upload] Preview generation failed, grid will use the full file:', file.name, prevErr);
      previewCleanBlob = null;
      previewWmBlob = null;
      thumbBlob = null;
    }

    if (token.cancelled) throw new CancelledError();

    const previewCleanPath = `classes/${classId}/gallery/prev_${unique}_${fileName}`;
    const previewWmPath = `classes/${classId}/gallery/prevwm_${unique}_${fileName}`;
    const thumbPath = `classes/${classId}/gallery/thumb_${unique}_${fileName}`;

    const needsSeparateClean = cleanStoragePath !== storagePath;
    const parts: UploadPart[] = [{ path: storagePath, blob: uploadBlob }];
    if (needsSeparateClean) parts.push({ path: cleanStoragePath, blob: cleanBlob });
    if (previewCleanBlob) parts.push({ path: previewCleanPath, blob: previewCleanBlob });
    if (previewWmBlob) parts.push({ path: previewWmPath, blob: previewWmBlob });
    if (thumbBlob) parts.push({ path: thumbPath, blob: thumbBlob });

    setStatus({ progress: 5, status: 'Se încarcă...' });
    const urls = await uploadParts(parts, token, fileName, (pct) => setStatus({ progress: Math.max(5, pct), status: 'Se încarcă...' }));
    const urlOf = (p: string) => { const i = parts.findIndex(x => x.path === p); return i >= 0 ? urls[i] : undefined; };

    if (token.cancelled) {
      // Cancelled between Storage write and Firestore write — remove the
      // orphaned blobs so they do not sit in the bucket unreferenced.
      removeOrphans(parts.map(p => p.path));
      throw new CancelledError();
    }

    const displayUrl = urlOf(storagePath)!;
    const cleanUrl = needsSeparateClean ? urlOf(cleanStoragePath)! : displayUrl;
    const previewCleanUrl = urlOf(previewCleanPath);
    const previewWmUrl = urlOf(previewWmPath);
    const thumbUrl = urlOf(thumbPath);
    const folderName = entry.folder;

    const newPhoto: ClassPhoto = {
      name: fileName,
      url: displayUrl,
      path: storagePath,
      cleanUrl,
      cleanPath: cleanStoragePath,
      // Grid copy mirrors the display copy: watermarked when the class uses one.
      previewUrl: (previewWmUrl || previewCleanUrl) || undefined,
      previewPath: (previewWmUrl ? previewWmPath : previewCleanUrl ? previewCleanPath : undefined),
      previewCleanUrl: previewCleanUrl || undefined,
      previewCleanPath: previewCleanUrl ? previewCleanPath : undefined,
      thumbUrl: thumbUrl || undefined,
      thumbPath: thumbUrl ? thumbPath : undefined,
      size: file.size,
      ...(file.lastModified ? { lastModified: file.lastModified } : {}),
      ...(folderName ? { folder: folderName } : {}),
      ...(sessionId && sessionId !== MAIN_SESSION_ID ? { sessionId } : {}),
      ...(imgDims ? { width: imgDims.width, height: imgDims.height } : {}),
    };

    setStatus({ progress: 99, status: 'Salvare...' });

    // "Înlocuiește": update the existing photo document in place (same id,
    // folder, session and position in a custom order). Gone meanwhile -> added
    // as a new photo below. A failed replace fails the file (retryable) rather
    // than adding a duplicate next to the photo it was meant to replace.
    if (entry.replaceId) {
      let res: { replacedPaths: string[] } | null;
      try {
        res = await replacePhotoInPlace(
          classPhotosCol(classId),
          entry.replaceId,
          classPhotoFileFields(newPhoto),
          parts.map(x => x.path)
        );
      } catch (e: any) {
        // The new Storage copies stay (orphans, harmless); the old photo is untouched.
        console.error('[Upload] Failed to replace class photo:', fileName, e);
        throw new Error(`Nu s-a putut înlocui poza (${errorText(e)})`);
      }
      if (res) {
        const replaced: ClassPhoto = {
          ...newPhoto,
          firestoreId: entry.replaceId,
          width: imgDims ? imgDims.width : null,
          height: imgDims ? imgDims.height : null,
          replacedPaths: res.replacedPaths,
        };
        if (!token.cancelled) {
          (classListenersRef.current[classId] || []).forEach(cb => cb(replaced));
        }
        return;
      }
    }

    // Written per file, and only after every copy is in Storage — this is what
    // makes an interrupted overnight run recoverable without broken photos.
    const firestoreId = await addClassPhoto(classId, newPhoto);
    if (!firestoreId) {
      // The Storage copies stay (orphans, harmless); the file is retryable.
      throw new Error('Nu s-a putut salva poza în baza de date');
    }
    const stored: ClassPhoto = { ...newPhoto, firestoreId };

    if (!token.cancelled) {
      (classListenersRef.current[classId] || []).forEach(cb => cb(stored));
    }
  };

  /**
   * Background upload for a class album.
   *
   * Runs in the provider rather than in a screen component, so it survives
   * navigation: the photographer can queue three classes, walk away, and the
   * progress bar keeps reporting from anywhere in the app.
   *
   * Each photo is written to Firestore the moment all its copies finish. An
   * overnight run of 20k files that dies at hour six therefore keeps everything
   * uploaded up to that point; selecting the same folder again skips those.
   */
  const startClassUpload = useCallback(async (
    filesArray: File[],
    classId: string,
    className: string,
    watermarkEnabled: boolean,
    watermarkUrl: string | null,
    watermarkPosition: WatermarkPosition,
    watermarkOffsetX: number,
    watermarkOffsetY: number,
    sessionId?: string,
    existingPhotos?: ExistingPhotosSource
  ) => {
    const jobKey = `class:${classId}`;
    const scope = sessionId && sessionId !== MAIN_SESSION_ID ? sessionId : MAIN_SESSION_ID;

    // Folder per file, decided on the whole batch (single dropped root is stripped, etc.)
    const folders = computeUploadFolders(filesArray.map(f => (f as any).webkitRelativePath || ''));
    const all: FileEntry[] = filesArray.map((file, i) => {
      const folder = folders[i] || '';
      return {
        file,
        folder,
        name: file.name,
        progressKey: `${scope}/${folder}/${file.name}`,
        displayName: folder ? `${folder} / ${file.name}` : file.name,
        ident: uploadIdentityKey({ scope, folder, name: file.name, size: file.size }),
      };
    });

    // What counts as already stored (same session + folder + name + size; name
    // only for older photos without size): shown in the dialog as identical,
    // pre-set to "Sari peste". Files already queued are skipped silently.
    const index = buildExistingUploadIndex(readExisting(existingPhotos).map(p => ({
      scope: p.sessionId || MAIN_SESSION_ID,
      folder: p.folder,
      name: p.name,
      size: p.size,
    })));
    // Then ask about every file with the name of a stored photo.
    const plan = await planSelection({
      jobKey,
      label: className,
      scope,
      entries: all,
      index,
      existing: () => readExisting(existingPhotos).map(p => ({
        scope: p.sessionId || MAIN_SESSION_ID,
        folder: p.folder,
        name: getPhotoDisplayName(p),
        size: p.size,
        lastModified: p.lastModified,
        id: p.firestoreId,
        thumbUrl: existingThumbOf(p),
      })),
    });
    if (!plan) return; // cancelled in the conflict dialog: nothing is uploaded
    const { upload, skipped } = plan;

    let migrated = false;
    const cfg: RunConfig = {
      jobKey,
      kind: 'class',
      label: className,
      galleryId: classId,
      subId: '',
      // Move the class off the legacy 1MB-capped array before writing anything.
      prepare: async () => {
        if (migrated) return;
        const classSnap = await getDoc(doc(db, 'classes', classId));
        await ensureClassMigrated(classId, classSnap.exists() ? classSnap.data() : null);
        migrated = true;
      },
      prepareFile: (e, token) => preparePhoto(e.file, classDerivativeRequest(
        watermarkEnabled && watermarkUrl
          ? { url: watermarkUrl, position: watermarkPosition, offsetX: watermarkOffsetX, offsetY: watermarkOffsetY }
          : null
      ), token),
      processOne: (e, token, setStatus, prepared) => processClassFile(
        e, classId, watermarkEnabled, watermarkUrl, watermarkPosition, watermarkOffsetX, watermarkOffsetY,
        sessionId, token, setStatus, prepared
      ),
      // Keep a cheap count on the class document so the dashboard can show
      // "N poze" without reading the whole subcollection. A count aggregation
      // costs 1 read per 1000 photos instead of 1 read per photo.
      afterRun: async () => {
        try {
          const countSnap = await getCountFromServer(classPhotosCol(classId));
          await updateDoc(doc(db, 'classes', classId), { photoCount: countSnap.data().count });
        } catch (e) {
          console.warn('[Upload] Could not refresh photoCount:', e);
        }
      },
    };
    await runUploadJob(cfg, upload, skipped, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retryFailed = useCallback((jobKey: string) => {
    const failed = failedRef.current[jobKey] || [];
    if (failed.length === 0) return;
    failedRef.current[jobKey] = [];
    const pending = (pendingRef.current[jobKey] ||= new Set());
    // Each selection keeps its own settings (watermark, session, overwrite...).
    const groups = new Map<RunConfig, FileEntry[]>();
    failed.forEach(({ cfg, entry }) => {
      pending.add(entry.ident);
      if (entry.aliasIdent) pending.add(entry.aliasIdent);
      const list = groups.get(cfg);
      if (list) list.push(entry); else groups.set(cfg, [entry]);
    });
    groups.forEach((list, cfg) => { void runUploadJob(cfg, list, 0, true); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cancel an active upload job — stops processing new files but keeps all photos
  // that have already been successfully uploaded and written to Firestore.
  const cancelUpload = useCallback(async (jobKeyToCancel: string) => {
    // Signal every run of this job to stop and abort the transfers in flight;
    // a photo mid-upload (Storage written, Firestore not yet) is cleaned up by
    // its processor when it sees the cancelled token.
    (tokensRef.current[jobKeyToCancel] || new Set()).forEach(token => {
      token.cancelled = true;
      token.tasks.forEach(task => { try { task.cancel(); } catch { /* already done */ } });
    });
    delete tokensRef.current[jobKeyToCancel];
    runsRef.current[jobKeyToCancel] = 0;
    delete pendingRef.current[jobKeyToCancel];
    delete failedRef.current[jobKeyToCancel];
    removeUploadJournalEntry(jobKeyToCancel);

    // Dismiss the job tile from the UI immediately
    removeJob(jobKeyToCancel);
  }, [removeJob]);

  // ── Background delete queue ──────────────────────────────────────────────

  /**
   * One delete task: documents first (batches of <=499), then the parent
   * update, then the Storage copies (DELETE_CONCURRENCY at a time).
   *
   * Documents go first so a failure can never leave a photo document pointing
   * at files that were already removed; the worst case is an orphan file.
   */
  const runDeleteTask = async (spec: DeleteTaskSpec): Promise<DeleteTaskResult> => {
    const result: DeleteTaskResult = { deletedKeys: [], failedKeys: [], failedFiles: 0 };
    const deleted: DeleteItem[] = [];
    const withDoc = spec.items.filter(i => !!i.docRef);
    const noDoc = spec.items.filter(i => !i.docRef);

    const countFailed = (items: DeleteItem[], err: unknown) => {
      result.error = result.error || err;
      result.failedKeys.push(...items.map(i => i.key));
      patchJob(DELETE_JOB_KEY, j => ({ filesFailed: j.filesFailed + items.length, errorMessage: errorText(err) }));
    };

    // 1. Firestore documents. A commit made while offline waits for the network.
    for (let i = 0; i < withDoc.length; i += BATCH_LIMIT) {
      const chunk = withDoc.slice(i, i + BATCH_LIMIT);
      try {
        const batch = writeBatch(db);
        chunk.forEach(it => batch.delete(it.docRef!));
        await batch.commit();
        deleted.push(...chunk);
      } catch (err) {
        console.error('[Delete] Firestore batch failed:', err);
        countFailed(chunk, err);
      }
    }

    // 2. Parent update (counters, legacy array entries).
    if (spec.finalize && (deleted.length > 0 || noDoc.length > 0)) {
      try {
        await spec.finalize([...deleted, ...noDoc].map(i => i.key));
        deleted.push(...noDoc);
      } catch (err) {
        console.error('[Delete] Finalize failed:', err);
        if (noDoc.length > 0) countFailed(noDoc, err);
        else result.error = result.error || err;
      }
    } else {
      deleted.push(...noDoc);
    }

    // 3. Storage: every copy of every deleted photo.
    const seen = new Set<string>();
    const work: { path: string; item: number }[] = [];
    const remaining = deleted.map(() => 0);
    deleted.forEach((it, idx) => {
      it.paths.forEach(p => {
        if (typeof p !== 'string' || !p || seen.has(p)) return;
        seen.add(p);
        work.push({ path: p, item: idx });
        remaining[idx]++;
      });
    });
    const finishedNow = remaining.filter(n => n === 0).length;
    if (finishedNow > 0) patchJob(DELETE_JOB_KEY, j => ({ filesUploaded: j.filesUploaded + finishedNow }));

    let next = 0;
    const worker = async () => {
      while (next < work.length) {
        const w = work[next++];
        try {
          await deleteObject(ref(storage, w.path));
        } catch (err: any) {
          if (err?.code !== 'storage/object-not-found') {
            result.failedFiles++;
            console.warn('Storage deletion warning:', w.path, err);
          }
        }
        remaining[w.item]--;
        if (remaining[w.item] === 0) patchJob(DELETE_JOB_KEY, j => ({ filesUploaded: j.filesUploaded + 1 }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(DELETE_CONCURRENCY, work.length) }, () => worker()));

    if (result.failedFiles > 0) {
      patchJob(DELETE_JOB_KEY, j => ({ storageFailures: (j.storageFailures || 0) + result.failedFiles }));
    }
    result.deletedKeys = deleted.map(i => i.key);
    return result;
  };

  const pumpDeletes = async () => {
    if (deleteRunningRef.current) return;
    deleteRunningRef.current = true;
    try {
      while (deleteQueueRef.current.length > 0) {
        const task = deleteQueueRef.current.shift()!;
        let result: DeleteTaskResult;
        try {
          result = await runDeleteTask(task.spec);
        } catch (err) {
          console.error('[Delete] Task failed:', err);
          result = { deletedKeys: [], failedKeys: task.spec.items.map(i => i.key), failedFiles: 0, error: err };
        }
        task.resolve(result);
      }
    } finally {
      deleteRunningRef.current = false;
      const job = jobsRef.current[DELETE_JOB_KEY];
      if (job) {
        patchJob(DELETE_JOB_KEY, { isFinished: true }, true);
        // A clean run closes its tile by itself; failures stay until dismissed.
        if (!job.filesFailed && !job.storageFailures && !job.errorMessage) {
          if (deleteDismissTimerRef.current !== null) clearTimeout(deleteDismissTimerRef.current);
          deleteDismissTimerRef.current = setTimeout(() => {
            deleteDismissTimerRef.current = null;
            const j = jobsRef.current[DELETE_JOB_KEY];
            if (j && j.isFinished) removeJob(DELETE_JOB_KEY);
          }, 6000);
        }
      }
    }
  };

  const enqueueDelete = useCallback((spec: DeleteTaskSpec): Promise<DeleteTaskResult> => {
    return new Promise<DeleteTaskResult>((resolve) => {
      if (deleteDismissTimerRef.current !== null) { clearTimeout(deleteDismissTimerRef.current); deleteDismissTimerRef.current = null; }
      const prev = jobsRef.current[DELETE_JOB_KEY];
      const keep = !!prev && !prev.isFinished;
      jobsRef.current = {
        ...jobsRef.current,
        [DELETE_JOB_KEY]: {
          jobKey: DELETE_JOB_KEY,
          kind: 'delete',
          label: spec.label,
          galleryId: '',
          subId: '',
          filesTotal: (keep ? prev!.filesTotal : 0) + spec.items.length,
          filesUploaded: keep ? prev!.filesUploaded : 0,
          filesFailed: keep ? prev!.filesFailed : 0,
          filesSkipped: 0,
          isFinished: false,
          progressMap: {},
          storageFailures: keep ? prev!.storageFailures : 0,
          errorMessage: keep ? prev!.errorMessage : undefined,
        },
      };
      flush(true);
      deleteQueueRef.current.push({ spec, resolve });
      void pumpDeletes();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flush]);

  // Legacy single-job derived values (used by PhotoGalleryCreator)
  // We expose the most-recent active upload job's values for backward compat.
  const jobsArr = Object.values(jobs);
  const uploadJobsArr = jobsArr.filter(j => j.kind !== 'delete');
  const activeJobs = uploadJobsArr.filter(j => !j.isFinished);
  const lastActiveJob = activeJobs[activeJobs.length - 1] ?? uploadJobsArr[uploadJobsArr.length - 1] ?? null;

  const legacyGalleryId = lastActiveJob?.galleryId ?? null;
  const legacyActiveSubId = lastActiveJob?.subId ?? null;
  const legacyFilesTotal = lastActiveJob?.filesTotal ?? 0;
  const legacyFilesUploaded = lastActiveJob?.filesUploaded ?? 0;
  const legacyIsUploading = activeJobs.length > 0;
  const legacyProgressMap = lastActiveJob?.progressMap ?? {};

  // Memoised: the provider re-renders every ~150ms while uploads run, and the
  // per-file list can hold thousands of rows.
  const conflictDialog = useMemo(() => activeConflict && (
    <UploadConflictDialog
      key={activeConflict.id}
      label={activeConflict.label}
      totalFiles={activeConflict.totalFiles}
      autoSkipped={activeConflict.autoSkipped}
      conflicts={activeConflict.conflicts}
      files={activeConflict.files}
      onResolve={(choices) => resolveActiveConflict(activeConflict.id, choices)}
    />
  ), [activeConflict, resolveActiveConflict]);

  return (
    <UploadContext.Provider value={{
      galleryId: legacyGalleryId,
      activeSubId: legacyActiveSubId,
      filesTotal: legacyFilesTotal,
      filesUploaded: legacyFilesUploaded,
      isUploading: legacyIsUploading,
      progressMap: legacyProgressMap,
      jobs: jobsArr,
      isOnline,
      interruptedUploads,
      dismissInterrupted,
      startUpload,
      startClassUpload,
      cancelUpload,
      retryFailed,
      enqueueDelete,
      onClassPhotoUploaded,
      onPhotoUploaded,
      onPhotosDeleted,
      resetUploadState,
      dismissJob,
      forceReorderByName,
    }}>
      {children}
      {conflictDialog}
    </UploadContext.Provider>
  );
};

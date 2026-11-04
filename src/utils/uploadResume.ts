/**
 * Resuming interrupted uploads.
 *
 * A browser cannot keep File objects across a reload, a closed lid that ends
 * the session, or a shutdown. So instead of trying to persist the queue, the
 * photographer simply selects the same folder again and every file that is
 * already stored is skipped:
 *
 * - a photo document is written only after ALL of its Storage copies landed,
 *   so an existing document means that file is fully uploaded;
 * - new documents carry the original file's `size` (bytes) and `lastModified`,
 *   so a file is matched on (target, folder, name, size);
 * - older documents have no size and are matched on (target, folder, name).
 *
 * The check runs against photo lists the admin screens already hold in memory,
 * so it costs no extra Firestore reads.
 *
 * The small journal in localStorage only remembers that an upload was running
 * (where, how many of how many), to show a "continue" hint after a reload.
 */

/** A photo that already exists in the target (from a doc already loaded in memory). */
export interface ExistingUploadRef {
  /** Upload target inside the album: class session id, gallery folder id... */
  scope?: string | null;
  /** Folder inside the target ('' / null = no folder). */
  folder?: string | null;
  name: string;
  /** Original file size in bytes; missing on documents written before this was stored. */
  size?: number | null;
}

/** A file about to be uploaded. */
export interface UploadCandidate {
  scope?: string | null;
  folder?: string | null;
  name: string;
  size: number;
}

export interface ExistingUploadIndex {
  /** target + size, for documents that know their size */
  exact: Set<string>;
  /** target only, for older documents without size */
  nameOnly: Set<string>;
}

const SEP = '\u0000';
const norm = (s?: string | null) => (typeof s === 'string' ? s.trim() : '');

export const uploadTargetKey = (scope: string | null | undefined, folder: string | null | undefined, name: string) =>
  [norm(scope), norm(folder), name].join(SEP);

/** Identity of one file in one target: what "the same file" means for the queue. */
export const uploadIdentityKey = (c: UploadCandidate) =>
  uploadTargetKey(c.scope, c.folder, c.name) + SEP + String(c.size);

export function buildExistingUploadIndex(existing: Iterable<ExistingUploadRef>): ExistingUploadIndex {
  const exact = new Set<string>();
  const nameOnly = new Set<string>();
  for (const p of existing) {
    if (!p || typeof p.name !== 'string' || !p.name) continue;
    const t = uploadTargetKey(p.scope, p.folder, p.name);
    if (typeof p.size === 'number' && p.size > 0) exact.add(t + SEP + String(p.size));
    else nameOnly.add(t);
  }
  return { exact, nameOnly };
}

export function isAlreadyUploaded(index: ExistingUploadIndex, c: UploadCandidate): boolean {
  const t = uploadTargetKey(c.scope, c.folder, c.name);
  return index.exact.has(t + SEP + String(c.size)) || index.nameOnly.has(t);
}

/**
 * Split a selection into files to upload and files to skip. `inFlight` holds the
 * identity keys of files already queued in a running job for the same target;
 * those are skipped too and the ones kept are added to it.
 */
export function partitionForUpload<T>(
  items: T[],
  toCandidate: (item: T) => UploadCandidate,
  index: ExistingUploadIndex,
  inFlight?: Set<string>
): { upload: T[]; skipped: T[] } {
  const upload: T[] = [];
  const skipped: T[] = [];
  for (const item of items) {
    const c = toCandidate(item);
    const id = uploadIdentityKey(c);
    if (isAlreadyUploaded(index, c) || (inFlight && inFlight.has(id))) {
      skipped.push(item);
      continue;
    }
    inFlight?.add(id);
    upload.push(item);
  }
  return { upload, skipped };
}

// ── Upload journal (localStorage) ──────────────────────────────────────────

export interface UploadJournalEntry {
  jobKey: string;
  kind: 'gallery' | 'class';
  label: string;
  /** files that had to be uploaded (skipped ones not counted) */
  total: number;
  done: number;
  failed: number;
  updatedAt: number;
}

const JOURNAL_KEY = 'xia.uploadJournal.v1';
const JOURNAL_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function readRaw(): Record<string, UploadJournalEntry> {
  try {
    const raw = localStorage.getItem(JOURNAL_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeRaw(map: Record<string, UploadJournalEntry>) {
  try {
    if (Object.keys(map).length === 0) localStorage.removeItem(JOURNAL_KEY);
    else localStorage.setItem(JOURNAL_KEY, JSON.stringify(map));
  } catch { /* storage unavailable or full — the journal is only a hint */ }
}

/** Entries of uploads that did not finish (still pending files or failures). */
export function readUploadJournal(now = Date.now()): UploadJournalEntry[] {
  const map = readRaw();
  return Object.values(map).filter(e =>
    e && typeof e.jobKey === 'string' &&
    (e.kind === 'gallery' || e.kind === 'class') &&
    typeof e.total === 'number' && typeof e.done === 'number' &&
    (e.done < e.total || (e.failed || 0) > 0) &&
    now - (e.updatedAt || 0) < JOURNAL_MAX_AGE_MS
  );
}

export function writeUploadJournalEntry(entry: UploadJournalEntry) {
  const map = readRaw();
  map[entry.jobKey] = entry;
  writeRaw(map);
}

export function removeUploadJournalEntry(jobKey: string) {
  const map = readRaw();
  if (!(jobKey in map)) return;
  delete map[jobKey];
  writeRaw(map);
}

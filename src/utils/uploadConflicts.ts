/**
 * Name conflicts when uploading into a destination that already holds photos
 * (the "these files already exist" question asked before an upload starts).
 *
 * Runs in two layers, in this order:
 *
 * 1. The resume logic (uploadResume.ts) decides first, exactly as before: a file
 *    already stored (same target + name + size, or name only for older docs
 *    where the queue treats that as stored) or already queued is skipped
 *    silently. Such a file is never a "conflict".
 * 2. Of the files left, one whose name (case-insensitive, Unicode-normalised)
 *    matches a photo already in the same destination is a conflict, and so is a
 *    second file of the same selection with the same name.
 *
 * Everything is Set/Map based (one pass over the existing photos, one over the
 * selection), so thousands of files cost a few milliseconds.
 */
import { isAlreadyUploaded, uploadIdentityKey, uploadTargetKey } from './uploadResume';
import type { ExistingUploadIndex, UploadCandidate } from './uploadResume';

export type ConflictAction = 'skip' | 'replace' | 'keepBoth';

/** How file names are compared: case-insensitive, NFC (macOS hands out NFD names). */
export const conflictNameKey = (name: string): string =>
  (typeof name === 'string' ? name : '').normalize('NFC').trim().toLowerCase();

/** Target (scope + folder) + compared name. */
export const conflictTargetKey = (scope: string | null | undefined, folder: string | null | undefined, name: string) =>
  uploadTargetKey(scope, folder, conflictNameKey(name));

/** Target (scope + folder) only — groups names per destination. */
export const conflictGroupKey = (scope: string | null | undefined, folder: string | null | undefined) =>
  uploadTargetKey(scope, folder, '');

/** A photo already in the destination (from the list the admin screen holds in memory). */
export interface ConflictExisting {
  scope?: string | null;
  folder?: string | null;
  name: string;
  size?: number | null;
  lastModified?: number | null;
  /** Firestore document id; photos without one (legacy array entries) cannot be replaced. */
  id?: string | null;
}

/** A file of the selection. */
export interface ConflictCandidate extends UploadCandidate {
  lastModified?: number;
  /** Shown in the dialog ("Folder / IMG_1.jpg"). */
  displayName: string;
}

export interface UploadConflict {
  /** Position of the file in the selection. */
  index: number;
  name: string;
  displayName: string;
  /** 'existing' = a photo with this name is already in the destination; 'batch' = an earlier file of this selection has it. */
  kind: 'existing' | 'batch';
  /** conflictTargetKey of the file, to look the existing photos up again when the choice is applied. */
  key: string;
  /** false = the existing photo has no document id of its own, so it cannot be replaced in place. */
  replaceable: boolean;
}

export interface ConflictScan {
  /** Files skipped without asking (already uploaded / already queued), by position. */
  autoSkip: number[];
  conflicts: UploadConflict[];
}

const SEP = '\u0000';
const KEPT_COPY_STEM = /^(.*) \((\d+)\)$/;

const splitExt = (name: string): [string, string] => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
};

/**
 * "IMG_1 (2).jpg" -> "IMG_1.jpg" (the name the kept copy was made from), or null.
 * Used so that a file kept earlier with "Păstrează ambele" counts as already
 * uploaded when the same folder is selected again (resume after an interruption).
 */
const keptCopySource = (name: string): string | null => {
  const [stem, ext] = splitExt(name);
  const m = KEPT_COPY_STEM.exec(stem);
  return m && m[1] ? `${m[1]}${ext}` : null;
};

export function scanUploadConflicts(params: {
  candidates: ConflictCandidate[];
  /** The resume index, built exactly as the upload queue builds it. */
  index: ExistingUploadIndex;
  /** Identity keys of files already queued / in flight for the same job. */
  inFlight?: ReadonlySet<string>;
  existing: ConflictExisting[];
}): ConflictScan {
  const { candidates, index, inFlight, existing } = params;

  const existingNames = new Set<string>();
  const replaceableNames = new Set<string>();
  // Copies kept earlier ("X (2).jpg"): source name + size -> lastModified values.
  const keptCopies = new Map<string, (number | null)[]>();
  for (const p of existing) {
    if (!p || typeof p.name !== 'string' || !p.name) continue;
    existingNames.add(conflictTargetKey(p.scope, p.folder, p.name));
    if (p.id) replaceableNames.add(conflictTargetKey(p.scope, p.folder, p.name));
    const source = keptCopySource(p.name);
    if (source && typeof p.size === 'number' && p.size > 0) {
      const k = conflictTargetKey(p.scope, p.folder, source) + SEP + String(p.size);
      const list = keptCopies.get(k);
      const lm = typeof p.lastModified === 'number' && p.lastModified > 0 ? p.lastModified : null;
      if (list) list.push(lm); else keptCopies.set(k, [lm]);
    }
  }

  const autoSkip: number[] = [];
  const conflicts: UploadConflict[] = [];
  const seenIdents = new Set<string>();
  const batchNames = new Set<string>();

  candidates.forEach((c, i) => {
    // 1. Resume logic, mirrored from partitionForUpload (identical files of the
    //    same selection collapse into one there too).
    const ident = uploadIdentityKey(c);
    if (isAlreadyUploaded(index, c) || (inFlight && inFlight.has(ident)) || seenIdents.has(ident)) {
      autoSkip.push(i);
      return;
    }
    seenIdents.add(ident);

    const key = conflictTargetKey(c.scope, c.folder, c.name);

    // Already stored as a kept copy ("X (2).jpg", same size and date).
    const kept = keptCopies.get(key + SEP + String(c.size));
    if (kept && kept.some(lm => lm === null || !c.lastModified || lm === c.lastModified)) {
      autoSkip.push(i);
      return;
    }

    // 2. Name conflicts. Only the first file of the selection with a given name
    //    can stand for the existing photo; later ones are "batch" conflicts.
    if (batchNames.has(key)) {
      conflicts.push({ index: i, name: c.name, displayName: c.displayName, kind: 'batch', key, replaceable: false });
    } else if (existingNames.has(key)) {
      conflicts.push({ index: i, name: c.name, displayName: c.displayName, kind: 'existing', key, replaceable: replaceableNames.has(key) });
    }
    batchNames.add(key);
  });

  return { autoSkip, conflicts };
}

/**
 * Non-conflicting name for "Păstrează ambele": "IMG_1.jpg" -> "IMG_1 (2).jpg",
 * then (3), (4)... A name that already ends in " (n)" is counted on from its
 * stem, Windows-style. `isTaken` gets conflictNameKey values.
 */
export function keepBothName(name: string, isTaken: (nameKey: string) => boolean): string {
  const [stem0, ext] = splitExt(name);
  const m = KEPT_COPY_STEM.exec(stem0);
  const stem = m && m[1] ? m[1] : stem0;
  for (let k = 2; ; k++) {
    const candidate = `${stem} (${k})${ext}`;
    if (!isTaken(conflictNameKey(candidate))) return candidate;
  }
}

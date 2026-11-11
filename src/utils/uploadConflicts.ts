/**
 * Name conflicts when uploading into a destination that already holds photos
 * (the "these files already exist" question asked before an upload starts).
 *
 * 1. Files already queued / in flight for the same job (and a second copy of
 *    the very same file inside one selection) are skipped silently: that is
 *    de-duplication of a running queue, not a question for the photographer.
 * 2. Every other file whose name (case-insensitive, Unicode-normalised) matches
 *    a photo already in the same destination is a conflict, and so is a second
 *    file of the same selection with the same name. Files that look already
 *    uploaded are conflicts too, flagged `identical` (and pre-set to "Sari
 *    peste" by the dialog), so the photographer decides instead of the system:
 *    - 'same': same target + name + size (the resume match), or a copy kept
 *      earlier with "Păstrează ambele" ("X (2).jpg", same size and date);
 *    - 'probable': same name, older photo stored without its size.
 *    Re-selecting a folder after an interruption therefore opens the dialog with
 *    everything already there set to "Sari peste" — one click on "Continuă".
 *
 * Everything is Set/Map based (one pass over the existing photos, one over the
 * selection), so thousands of files cost a few milliseconds.
 */
import { uploadIdentityKey, uploadTargetKey } from './uploadResume';
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
  /** Small image of the photo, shown in the dialog (thumb, else preview, else the photo itself). */
  thumbUrl?: string | null;
}

/** A file of the selection. */
export interface ConflictCandidate extends UploadCandidate {
  lastModified?: number;
  /** Shown in the dialog ("Folder / IMG_1.jpg"). */
  displayName: string;
}

/** Why a conflict cannot replace the existing photo. */
export type ReplaceBlock =
  /** An earlier file of the same selection has this name. */
  | 'batch'
  /** The existing photo has no document id of its own (legacy entry). */
  | 'legacy'
  /** Another file of the selection already stands for this photo. */
  | 'taken';

export interface UploadConflict {
  /** Position of the file in the selection. */
  index: number;
  name: string;
  displayName: string;
  /** 'existing' = a photo with this name is already in the destination; 'batch' = an earlier file of this selection has it. */
  kind: 'existing' | 'batch';
  /**
   * conflictTargetKey of the photo a replace targets: the file's own name, or
   * the kept copy ("X (2).jpg") it is identical to.
   */
  key: string;
  /** false = cannot be replaced in place (see `replaceBlock`). */
  replaceable: boolean;
  replaceBlock?: ReplaceBlock;
  /** The file looks already uploaded: 'same' = same name + size (or a kept copy), 'probable' = same name, older photo without size. */
  identical?: 'same' | 'probable';
  /** Document id of the photo the file matches (preferred over a lookup by name when replacing). */
  targetId?: string;
  /** Stored name of that photo when it differs from the file's (a kept copy "X (2).jpg"). */
  existingName?: string;
  /** Size of the existing photo's original (bytes), when known. */
  existingSize?: number | null;
  /** Small image of the existing photo. */
  existingThumb?: string;
  /** Size of the selected file (bytes). */
  size: number;
}

export interface ConflictScan {
  /** Files skipped without asking (already queued / in flight, or the same file twice), by position. */
  autoSkip: number[];
  /** In selection order. */
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
 * Used so that a file kept earlier with "Păstrează ambele" is recognised as
 * already uploaded when the same folder is selected again.
 */
const keptCopySource = (name: string): string | null => {
  const [stem, ext] = splitExt(name);
  const m = KEPT_COPY_STEM.exec(stem);
  return m && m[1] ? `${m[1]}${ext}` : null;
};

const validSize = (n: unknown): n is number => typeof n === 'number' && n > 0;

export function scanUploadConflicts(params: {
  candidates: ConflictCandidate[];
  /** The resume index, built exactly as the upload queue builds it: which files count as identical. */
  index: ExistingUploadIndex;
  /** Identity keys of files already queued / in flight for the same job. */
  inFlight?: ReadonlySet<string>;
  existing: ConflictExisting[];
}): ConflictScan {
  const { candidates, index, inFlight, existing } = params;

  // Per compared name: the photo a replace targets (first one with an id, as
  // the upload does), and per name + size the photo a file is identical to.
  const byKey = new Map<string, ConflictExisting>();
  const byKeySize = new Map<string, ConflictExisting>();
  const byKeyNoSize = new Map<string, ConflictExisting>();
  const replaceableNames = new Set<string>();
  // Copies kept earlier ("X (2).jpg"): source name + size -> those copies.
  const keptCopies = new Map<string, ConflictExisting[]>();
  const better = (cur: ConflictExisting | undefined, p: ConflictExisting) => !cur || (!cur.id && !!p.id);
  for (const p of existing) {
    if (!p || typeof p.name !== 'string' || !p.name) continue;
    const k = conflictTargetKey(p.scope, p.folder, p.name);
    if (better(byKey.get(k), p)) byKey.set(k, p);
    if (p.id) replaceableNames.add(k);
    if (validSize(p.size)) {
      const ks = k + SEP + String(p.size);
      if (better(byKeySize.get(ks), p)) byKeySize.set(ks, p);
    } else if (better(byKeyNoSize.get(k), p)) {
      byKeyNoSize.set(k, p);
    }
    const source = keptCopySource(p.name);
    if (source && validSize(p.size)) {
      const kk = conflictTargetKey(p.scope, p.folder, source) + SEP + String(p.size);
      const list = keptCopies.get(kk);
      if (list) list.push(p); else keptCopies.set(kk, [p]);
    }
  }

  const autoSkip: number[] = [];
  const conflicts: UploadConflict[] = [];
  const identicalLater: { i: number; c: ConflictCandidate; key: string; identical: 'same' | 'probable'; target: ConflictExisting | undefined; targetKey: string }[] = [];
  const seenIdents = new Set<string>();
  const batchNames = new Set<string>();
  // Photos some file of the selection already stands for (one replace per photo).
  const claimed = new Set<string>();

  const info = (p: ConflictExisting | undefined) => p ? {
    existingSize: validSize(p.size) ? p.size : null,
    ...(p.thumbUrl ? { existingThumb: p.thumbUrl } : {}),
  } : {};

  candidates.forEach((c, i) => {
    // 1. Queue de-duplication (identical files of one selection collapse into
    //    one, as they do in partitionForUpload).
    const ident = uploadIdentityKey(c);
    if ((inFlight && inFlight.has(ident)) || seenIdents.has(ident)) {
      autoSkip.push(i);
      return;
    }
    seenIdents.add(ident);

    const key = conflictTargetKey(c.scope, c.folder, c.name);

    // 2a. Looks already uploaded: decided after the others (below), so these
    //     files never take a photo away from a file that really is different.
    if (index.exact.has(ident) || index.nameOnly.has(uploadTargetKey(c.scope, c.folder, c.name))) {
      const same = index.exact.has(ident);
      const target = (same ? byKeySize.get(key + SEP + String(c.size)) : byKeyNoSize.get(key)) || byKey.get(key);
      identicalLater.push({ i, c, key, identical: same ? 'same' : 'probable', target, targetKey: key });
      return;
    }
    const kept = keptCopies.get(key + SEP + String(c.size))
      ?.find(p => !validSize(p.lastModified) || !c.lastModified || p.lastModified === c.lastModified);
    if (kept) {
      identicalLater.push({ i, c, key, identical: 'same', target: kept, targetKey: conflictTargetKey(kept.scope, kept.folder, kept.name) });
      return;
    }

    // 2b. Name conflicts. Only the first file of the selection with a given name
    //     can stand for the existing photo; later ones are "batch" conflicts.
    if (batchNames.has(key)) {
      conflicts.push({
        index: i, name: c.name, displayName: c.displayName, kind: 'batch', key,
        replaceable: false, replaceBlock: 'batch', size: c.size, ...info(byKey.get(key)),
      });
    } else if (byKey.has(key)) {
      const replaceable = replaceableNames.has(key);
      if (replaceable) claimed.add(key);
      conflicts.push({
        index: i, name: c.name, displayName: c.displayName, kind: 'existing', key,
        replaceable, ...(replaceable ? {} : { replaceBlock: 'legacy' as const }), size: c.size, ...info(byKey.get(key)),
      });
    }
    batchNames.add(key);
  });

  // Files that look already uploaded. Replaceable (e.g. to regenerate a broken
  // photo's copies) when the photo has a document id and no other file of the
  // selection stands for it.
  for (const { i, c, identical, target, targetKey } of identicalLater) {
    const hasId = !!target?.id;
    const taken = claimed.has(targetKey);
    const replaceable = hasId && !taken;
    if (replaceable) claimed.add(targetKey);
    const storedName = target && conflictNameKey(target.name) !== conflictNameKey(c.name) ? target.name : undefined;
    conflicts.push({
      index: i, name: c.name, displayName: c.displayName, kind: 'existing', key: targetKey,
      replaceable, ...(replaceable ? {} : { replaceBlock: taken ? 'taken' as const : 'legacy' as const }),
      identical,
      ...(target?.id ? { targetId: target.id } : {}),
      ...(storedName ? { existingName: storedName } : {}),
      size: c.size, ...info(target),
    });
  }
  if (identicalLater.length > 0) conflicts.sort((a, b) => a.index - b.index);

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

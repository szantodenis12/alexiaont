/**
 * Finding the clean (unwatermarked) original of a photo a student selected.
 *
 * Submissions only store the URL of the copy the student browsed — the
 * watermarked `wm_` display file when the class uses a watermark — plus, for
 * B/W, a render made from that same watermarked copy. The original lives on the
 * class gallery record (`cleanUrl`, the `clean_` file), so every admin download
 * has to map the selection back to its gallery photo.
 *
 * Matching is done on the Storage object path, never on the raw URL string, so
 * it does not care about:
 *  - host (Firebase Storage vs. the image CDN),
 *  - download token / query string,
 *  - URL encoding (`%2F` vs `/`, double-encoded names),
 *  - which variant was stored (`wm_` / `clean_` share one base name, and
 *    `prevwm_` / `prev_` / `thumb_` share another — both are indexed).
 * Only when no path matches does it fall back to the file name, and then only
 * when that name is unique within the class (sessions may repeat camera names).
 */
import type { ClassPhoto } from './classPhotos';

/** Decoded Storage object path ("classes/x/gallery/wm_1_a_IMG.jpg") of a download URL, or null. */
export const storageObjectPath = (url?: string | null): string | null => {
  if (!url || typeof url !== 'string') return null;
  const bare = url.split('#')[0].split('?')[0];
  const idx = bare.indexOf('/o/');
  if (idx === -1) return null;
  let path = bare.slice(idx + 3);
  // Decode until stable: tolerates both single- and double-encoded paths.
  for (let i = 0; i < 3; i++) {
    try {
      const decoded = decodeURIComponent(path);
      if (decoded === path) break;
      path = decoded;
    } catch {
      break;
    }
  }
  return path || null;
};

const VARIANT_PREFIX = /^(?:wm|clean|prevwm|prev|thumb)_/i;
/** Files that are watermarked and/or reduced: never acceptable as "the original". */
const NOT_ORIGINAL_PREFIX = /^(?:wm|prevwm|prev|thumb)_/i;

const fileNameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** Path with the variant prefix removed: wm_X and clean_X (and prev_Y / prevwm_Y / thumb_Y) collapse. */
export const storageBaseKey = (path: string): string => {
  const cut = path.lastIndexOf('/') + 1;
  return path.slice(0, cut) + path.slice(cut).replace(VARIANT_PREFIX, '');
};

/** True when the URL points at an untouched original (a `clean_` file, or one without variant prefix). */
export const isOriginalFileUrl = (url?: string | null): boolean => {
  const path = storageObjectPath(url);
  if (!path) return false;
  return !NOT_ORIGINAL_PREFIX.test(fileNameOf(path));
};

/** The clean original of a gallery photo, or null when it has none. */
export const originalUrlOf = (photo?: Partial<ClassPhoto> | null): string | null => {
  if (!photo) return null;
  // cleanUrl first; `url` only qualifies when it is itself the original
  // (classes without watermark store the same clean_ file in both).
  for (const u of [photo.cleanUrl, photo.url]) {
    if (u && isOriginalFileUrl(u)) return u;
  }
  return null;
};

export interface CleanIndex {
  byPath: Map<string, ClassPhoto>;
  /** null = ambiguous (several photos share it). */
  byBase: Map<string, ClassPhoto | null>;
  byName: Map<string, ClassPhoto | null>;
  size: number;
}

const putUnique = (map: Map<string, ClassPhoto | null>, key: string, photo: ClassPhoto) => {
  if (!map.has(key)) map.set(key, photo);
  else if (map.get(key) !== photo) map.set(key, null);
};

const nameKey = (name?: string | null) => (typeof name === 'string' ? name.trim().toLowerCase() : '');

/**
 * Index a class's gallery photos. `classId`, when given, drops photos whose
 * files live under another class — a stale list from the previously opened
 * class can then never answer for this one.
 */
export function buildCleanIndex(photos: ClassPhoto[], classId?: string): CleanIndex {
  const byPath = new Map<string, ClassPhoto>();
  const byBase = new Map<string, ClassPhoto | null>();
  const byName = new Map<string, ClassPhoto | null>();
  let size = 0;
  const foreign = (path: string) => !!classId && path.startsWith('classes/') && !path.startsWith(`classes/${classId}/`);
  const replaced: ClassPhoto[] = [];
  for (const p of photos || []) {
    if (!p) continue;
    const paths = new Set<string>();
    [p.url, p.cleanUrl, p.previewUrl, p.previewCleanUrl, p.thumbUrl].forEach(u => {
      const path = storageObjectPath(u);
      if (path) paths.add(path);
    });
    [p.path, p.cleanPath, p.previewPath, p.previewCleanPath, p.thumbPath].forEach(path => {
      if (typeof path === 'string' && path) paths.add(path);
    });
    if ([...paths].some(foreign)) continue;
    size++;
    paths.forEach(path => {
      if (!byPath.has(path)) byPath.set(path, p);
      putUnique(byBase, storageBaseKey(path), p);
    });
    if (Array.isArray(p.replacedPaths) && p.replacedPaths.length > 0) replaced.push(p);
    const n = nameKey(p.name);
    if (n) putUnique(byName, n, p);
  }
  // Files of earlier versions (the photo was replaced by an upload, old files
  // kept): a selection made on the old version resolves to this photo, i.e. to
  // its NEW clean original. Indexed after every current file, and only where
  // no photo answers already, so a photo still pointing at such a file wins.
  for (const p of replaced) {
    p.replacedPaths!.forEach(path => {
      if (typeof path !== 'string' || !path || foreign(path)) return;
      if (!byPath.has(path)) byPath.set(path, p);
      const base = storageBaseKey(path);
      if (!byBase.has(base)) byBase.set(base, p);
    });
  }
  return { byPath, byBase, byName, size };
}

export interface CleanResolution {
  /** URL of the clean original, or null when none could be found. */
  cleanUrl: string | null;
  /** How it was found (diagnostics). */
  via: 'path' | 'base' | 'name' | 'self' | 'none';
}

/**
 * Clean original for one selected photo (`{ url, processedUrl?, name?, bw? }`).
 * `self` = no gallery match, but the stored URL is itself an original file.
 */
export function resolveCleanOriginal(selection: any, index: CleanIndex): CleanResolution {
  if (!selection) return { cleanUrl: null, via: 'none' };
  const urls = [selection.url, selection.processedUrl].filter((u: unknown): u is string => typeof u === 'string' && !!u);
  for (const u of urls) {
    const path = storageObjectPath(u);
    if (!path) continue;
    const exact = index.byPath.get(path);
    if (exact) {
      const clean = originalUrlOf(exact);
      if (clean) return { cleanUrl: clean, via: 'path' };
    }
    const base = index.byBase.get(storageBaseKey(path));
    if (base) {
      const clean = originalUrlOf(base);
      if (clean) return { cleanUrl: clean, via: 'base' };
    }
  }
  const byName = index.byName.get(nameKey(selection.name));
  if (byName) {
    const clean = originalUrlOf(byName);
    if (clean) return { cleanUrl: clean, via: 'name' };
  }
  if (isOriginalFileUrl(selection.url)) return { cleanUrl: selection.url, via: 'self' };
  return { cleanUrl: null, via: 'none' };
}

/** "a/IMG_1.jpg" + "_WATERMARK" -> "a/IMG_1_WATERMARK.jpg" (suffix goes before the extension). */
export const withNameSuffix = (name: string, suffix: string): string => {
  const slash = name.lastIndexOf('/') + 1;
  const dot = name.lastIndexOf('.');
  return dot > slash ? `${name.slice(0, dot)}${suffix}${name.slice(dot)}` : `${name}${suffix}`;
};

/**
 * Human-readable file name for a gallery photo.
 *
 * Gallery photos carry their original file name in `name`; selections only keep
 * the storage URL, so this falls back to the last path segment of the URL
 * (Firebase Storage encodes the path as `.../o/galleries%2Fid%2Fsub%2Fwm_1712345678901_IMG_1.jpg?alt=media...`)
 * and strips the upload prefixes the admin adds (`wm_<timestamp>_`, `clean_<timestamp>_`, ...).
 */
type PhotoLike = { name?: string; fileName?: string; url?: string; cleanUrl?: string };

const UPLOAD_PREFIX = /^(?:(?:wm|clean|prevwm|prev|thumb|coverprev|cover)_)?\d{10,}_/i;

const nameFromUrl = (url: string): string => {
  let path = url.split('?')[0].split('#')[0];
  const objIdx = path.indexOf('/o/');
  if (objIdx !== -1) path = path.slice(objIdx + 3);
  try {
    path = decodeURIComponent(path);
  } catch {
    /* keep the raw path */
  }
  const last = path.split('/').filter(Boolean).pop() || '';
  return last.replace(UPLOAD_PREFIX, '');
};

export function getPhotoDisplayName(photo: PhotoLike | string): string {
  if (!photo) return '';
  if (typeof photo === 'string') return nameFromUrl(photo);
  const explicit = (photo.name || photo.fileName || '').trim();
  if (explicit) return explicit;
  const url = photo.url || photo.cleanUrl;
  return url ? nameFromUrl(url) : '';
}

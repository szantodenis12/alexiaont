/**
 * Optional image CDN in front of Firebase Storage.
 *
 * Storage egress is billed per GB and was ~90% of the monthly bill. Putting a
 * caching CDN in front means a file is paid for once and then served from the
 * edge — which matters most for the common pattern of several people
 * downloading the same gallery.
 *
 * Set VITE_IMAGE_CDN (e.g. "cdn.alexiaont.com") to switch every photo URL over.
 * Leave it unset and nothing changes: URLs stay exactly as Firebase issued them.
 */
const CDN_HOST = (import.meta.env.VITE_IMAGE_CDN as string | undefined)?.trim();
const FIREBASE_HOST = 'https://firebasestorage.googleapis.com';

export const cdnUrl = (url?: string | null): string | undefined => {
  if (!url) return url ?? undefined;
  if (!CDN_HOST) return url;
  return url.startsWith(FIREBASE_HOST) ? `https://${CDN_HOST}${url.slice(FIREBASE_HOST.length)}` : url;
};

/** Rewrites every image field on a photo record. Safe on partial objects. */
export function cdnPhoto<T extends Record<string, any>>(photo: T): T {
  if (!CDN_HOST || !photo) return photo;
  const out: Record<string, any> = { ...photo };
  for (const key of ['url', 'cleanUrl', 'previewUrl', 'previewCleanUrl', 'thumbUrl', 'videoUrl']) {
    if (typeof out[key] === 'string') out[key] = cdnUrl(out[key]);
  }
  return out as T;
}

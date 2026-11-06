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

/**
 * The same file straight from Firebase Storage (undoes `cdnUrl`). Used as a
 * second attempt when a CDN fetch fails, so a download never has to settle for
 * a lesser copy just because the edge hiccupped.
 */
export const originUrl = (url?: string | null): string | undefined => {
  if (!url) return url ?? undefined;
  if (!CDN_HOST) return url;
  const cdnPrefix = `https://${CDN_HOST}`;
  return url.startsWith(cdnPrefix + '/') ? `${FIREBASE_HOST}${url.slice(cdnPrefix.length)}` : url;
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

/**
 * fetch() through the CDN, retried once straight from Firebase Storage when the
 * CDN answers non-OK (e.g. a stale cached 404) or the request fails outright.
 * Identical to fetch() for non-CDN URLs or when VITE_IMAGE_CDN is unset.
 */
export const fetchWithOriginFallback = async (url: string, init?: RequestInit): Promise<Response> => {
  const direct = originUrl(url);
  if (!direct || direct === url) return fetch(url, init);
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    return fetch(direct, init);
  }
  if (res.ok) return res;
  try {
    const retry = await fetch(direct, init);
    return retry.ok ? retry : res;
  } catch {
    return res;
  }
};

/**
 * One global safety net for <img>/<video> elements whose CDN copy fails to load
 * (the CDN can hold a stale cached 404 for a file that exists at the origin):
 * the element is pointed at the same file on Firebase Storage instead.
 *
 * - Capture phase on `document`, because `error` does not bubble.
 * - The event is stopped only when a retry is started, so component onError
 *   handlers (which hide the image) run only if the origin copy fails too.
 * - No loop: the origin URL is never a CDN URL, and a URL is retried once per
 *   element. React only rewrites `src` when the prop value changes, so the swap
 *   sticks; a new CDN value gets its own retry.
 * - Does nothing when VITE_IMAGE_CDN is unset.
 */
export const installCdnImageFallback = (): void => {
  if (!CDN_HOST || typeof document === 'undefined') return;
  const prefix = `https://${CDN_HOST}/`;
  document.addEventListener('error', (e) => {
    const el = e.target;
    if (el instanceof HTMLImageElement) {
      const failed = el.currentSrc || el.src;
      if (!failed || !failed.startsWith(prefix) || el.dataset.cdnFallback === failed) return;
      el.dataset.cdnFallback = failed;
      e.stopPropagation();
      const srcset = el.getAttribute('srcset');
      if (srcset && srcset.includes(prefix)) el.setAttribute('srcset', srcset.split(prefix).join(`${FIREBASE_HOST}/`));
      const src = el.getAttribute('src');
      if (src && src.startsWith(prefix)) el.src = originUrl(src)!;
      else if (!srcset) el.src = originUrl(failed)!;
      return;
    }
    if (el instanceof HTMLVideoElement) {
      const failed = el.currentSrc || el.src;
      const code = el.error?.code;
      // Only "could not fetch / not found", not decode errors.
      if (code !== 2 && code !== 4) return;
      if (!failed || !failed.startsWith(prefix) || el.dataset.cdnFallback === failed) return;
      el.dataset.cdnFallback = failed;
      e.stopPropagation();
      el.src = originUrl(failed)!;
    }
  }, true);
};

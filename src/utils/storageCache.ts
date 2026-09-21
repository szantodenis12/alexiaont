import type { UploadMetadata } from 'firebase/storage';

/**
 * Storage metadata for files whose path is unique and never written to again.
 *
 * Without an explicit Cache-Control, Firebase Storage serves files with
 * `private, max-age=0`, so a client revisiting a gallery re-downloads every
 * thumbnail it has already seen. A year-long cache fixes that.
 *
 * ONLY use this where the storage path embeds a timestamp/random suffix and is
 * never overwritten. A path that gets rewritten in place (for example the
 * watermark re-apply in PhotoGalleryCreator, which writes `wm_<cleanfile>`)
 * must NOT get this — browsers would keep showing the old image for a year.
 */
export const IMMUTABLE_FILE_METADATA: UploadMetadata = {
  cacheControl: 'public, max-age=31536000, immutable',
};

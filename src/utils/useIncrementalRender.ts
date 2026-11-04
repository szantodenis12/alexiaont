import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Render a long photo grid in steps instead of all at once.
 *
 * A folder can hold 4,000+ photos; mounting every tile up front costs seconds
 * of main-thread work (and memory) on a phone before anything is interactive,
 * even with loading="lazy" on the images. The grid renders the first `step`
 * items and adds another `step` whenever the sentinel (placed after the grid)
 * comes within ~2 screens of the viewport.
 *
 * Masonry/justified layouts are prefix-stable, so appending never moves the
 * tiles already on screen. Indexes (lightbox, selection) keep using the full
 * list — only what is mounted changes.
 */
export function useIncrementalRender(total: number, resetKey: unknown, step = 120) {
  const [count, setCount] = useState(step);
  useEffect(() => { setCount(step); }, [resetKey, step]);

  const observerRef = useRef<IntersectionObserver | null>(null);
  // The ref callback changes with `count`, so the observer is re-created after
  // each step and fires again if the sentinel is still in range (short tiles).
  const sentinelRef = useCallback((node: HTMLElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) setCount(c => c + step);
    }, { rootMargin: '2000px 0px' });
    obs.observe(node);
    observerRef.current = obs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, count]);
  useEffect(() => () => observerRef.current?.disconnect(), []);

  /** Mount every item (e.g. right before restoring a deep scroll position). */
  const showAll = useCallback(() => setCount(Number.POSITIVE_INFINITY), []);

  // Without IntersectionObserver (very old browsers) everything renders, as before.
  const limit = typeof IntersectionObserver === 'undefined' ? total : Math.min(count, total);
  return { limit, hasMore: limit < total, sentinelRef, showAll };
}

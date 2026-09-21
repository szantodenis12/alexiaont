import { useEffect } from 'react';

/**
 * Freezes the page behind a full-screen overlay (photo lightbox, picker modal).
 *
 * On mobile, swiping or dragging inside an overlay scrolled the page underneath
 * it. `overflow: hidden` on <body> is not enough — iOS Safari ignores it for
 * touch scrolling — so the body is pinned with `position: fixed` at its current
 * offset, and the scroll position is put back exactly on release.
 *
 * Depend on "is the overlay open", never on which photo is shown: re-running
 * the lock on every next/previous swipe would unpin and re-pin the page and
 * could restore the wrong scroll position on close.
 *
 * Locks are counted, so two overlays open at once (a picker plus its zoom view)
 * release the page only when the last one closes.
 */
let lockCount = 0;
let savedScrollY = 0;
let savedStyles: Partial<Record<'position' | 'top' | 'left' | 'right' | 'width' | 'overflow', string>> = {};
let savedOverscroll = '';

export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;

    if (lockCount === 0) {
      const body = document.body;
      savedScrollY = window.scrollY;
      savedStyles = {
        position: body.style.position,
        top: body.style.top,
        left: body.style.left,
        right: body.style.right,
        width: body.style.width,
        overflow: body.style.overflow,
      };
      savedOverscroll = document.documentElement.style.overscrollBehavior;

      body.style.position = 'fixed';
      body.style.top = `-${savedScrollY}px`;
      body.style.left = '0';
      body.style.right = '0';
      body.style.width = '100%';
      body.style.overflow = 'hidden';
      // Stops pull-to-refresh / rubber-banding from chaining to the page.
      document.documentElement.style.overscrollBehavior = 'none';
    }
    lockCount++;

    return () => {
      lockCount--;
      if (lockCount > 0) return;

      const body = document.body;
      body.style.position = savedStyles.position ?? '';
      body.style.top = savedStyles.top ?? '';
      body.style.left = savedStyles.left ?? '';
      body.style.right = savedStyles.right ?? '';
      body.style.width = savedStyles.width ?? '';
      body.style.overflow = savedStyles.overflow ?? '';
      document.documentElement.style.overscrollBehavior = savedOverscroll;

      // Jump straight back to where the viewer was, with no visible animation
      // even if a stylesheet later sets `scroll-behavior: smooth`.
      const html = document.documentElement;
      const prevBehavior = html.style.scrollBehavior;
      html.style.scrollBehavior = 'auto';
      window.scrollTo(0, savedScrollY);
      html.style.scrollBehavior = prevBehavior;
    };
  }, [active]);
}

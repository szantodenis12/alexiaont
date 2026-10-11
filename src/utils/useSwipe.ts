import { useRef } from 'react';
import type React from 'react';

/**
 * Horizontal swipe detection for full-screen photo viewers.
 *
 * Spread the result on the viewer's outermost (full-screen) element so the
 * whole area is a swipe target, not just the image:
 *   <div {...useSwipe(next, prev)}>
 *
 * - single finger only: a second finger (pinch) cancels the gesture
 * - needs > 50px horizontally and clearly more horizontal than vertical
 * - gestures starting on buttons / links / inputs are ignored so taps on
 *   arrows, close, download, toggles keep working
 * - `touch-action: pan-y pinch-zoom` stops the browser from swallowing
 *   horizontal drags (it would otherwise fire touchcancel mid-swipe).
 *
 * `onLeft` runs for a swipe towards the left (= next photo), `onRight` for a
 * swipe towards the right (= previous photo). Latest callbacks are always used.
 */
const MIN_DISTANCE = 50;
const DIRECTION_RATIO = 1.2;

export function useSwipe(onLeft: () => void, onRight: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const handlers = useRef({ onLeft, onRight });
  handlers.current = { onLeft, onRight };

  return {
    style: { touchAction: 'pan-y pinch-zoom' } as React.CSSProperties,
    onTouchStart: (e: React.TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.touches.length !== 1 || target?.closest?.('button, a, input, select, textarea, label')) {
        start.current = null;
        return;
      }
      start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    },
    onTouchMove: (e: React.TouchEvent) => {
      if (e.touches.length > 1) start.current = null;
    },
    onTouchCancel: () => {
      start.current = null;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const s = start.current;
      start.current = null;
      if (!s || e.touches.length > 0) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Math.abs(dx) < MIN_DISTANCE || Math.abs(dx) < Math.abs(dy) * DIRECTION_RATIO) return;
      if (dx < 0) handlers.current.onLeft();
      else handlers.current.onRight();
    },
  };
}

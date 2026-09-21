import { useEffect } from 'react';
import { doc, setDoc, writeBatch, increment, serverTimestamp, Timestamp } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../firebase/config';

/**
 * First-party, privacy-light visit counter for the public pages.
 *
 * - No cookies, no localStorage, no personal data: a visit is "a public page was
 *   opened", and the live-presence id below lives only in memory for the tab.
 * - Never competes with the page: it waits a few seconds after mount, so photos
 *   load first, and every failure is swallowed — a counter must never break a
 *   gallery.
 * - Logged-in users are the photographer previewing their own work, so they are
 *   not counted.
 *
 * Writes:
 *   stats_daily/{YYYY-MM-DD}                 { count }            +1 per visit
 *   stats_daily/{YYYY-MM-DD}/items/{kind_id} { count, kind, refId }
 *   presence/{sessionId}                     { lastSeen, kind, refId, expireAt }
 *     refreshed about once a minute while the tab is visible; the admin view
 *     treats anything seen in the last ~2.5 minutes as "on the site now".
 */

export type VisitKind = 'gallery' | 'selection' | 'class_gallery' | 'class_form' | 'album';

const START_DELAY_MS = 3000;
const HEARTBEAT_MS = 60_000;

// One id per browser tab (module scope survives in-app navigation, dies with the tab).
const sessionId =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`;

// Group days by Romanian calendar date, whatever the visitor's timezone.
export const dayKey = (d = new Date()) =>
  d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Bucharest' }); // "2026-09-21"

let adminCheck: Promise<boolean> | null = null;
const isLoggedIn = () => {
  if (!adminCheck) {
    adminCheck = new Promise(resolve => {
      const unsub = onAuthStateChanged(auth, user => {
        unsub();
        resolve(!!user);
      });
    });
  }
  return adminCheck;
};

export function useVisitTracking(kind: VisitKind, refId: string | undefined | null) {
  useEffect(() => {
    if (!refId) return;
    let cancelled = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;

    const beat = () => {
      if (document.visibilityState !== 'visible') return;
      setDoc(doc(db, 'presence', sessionId), {
        lastSeen: serverTimestamp(),
        kind,
        refId,
        // Lets a Firestore TTL policy purge stale rows if one is ever enabled;
        // the admin view also cleans them up.
        expireAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000),
      }).catch(() => {});
    };

    const onVisibility = () => { if (document.visibilityState === 'visible') beat(); };

    const start = setTimeout(async () => {
      try {
        if (await isLoggedIn()) return;
        if (cancelled) return;

        const day = dayKey();
        const batch = writeBatch(db);
        batch.set(doc(db, 'stats_daily', day), { count: increment(1) }, { merge: true });
        batch.set(
          doc(db, 'stats_daily', day, 'items', `${kind}_${refId}`),
          { count: increment(1), kind, refId },
          { merge: true }
        );
        batch.commit().catch(() => {});

        beat();
        heartbeat = setInterval(beat, HEARTBEAT_MS);
        document.addEventListener('visibilitychange', onVisibility);
      } catch {
        // Counting is best-effort only.
      }
    }, START_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(start);
      if (heartbeat) clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [kind, refId]);
}

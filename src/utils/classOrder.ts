// Ordering of the admin class list ("Albume absolvenți").
//
// - The chosen mode (A–Z / Z–A / după termen / personalizată) is a per-device
//   view preference kept in localStorage.
// - The custom order is shared data: a numeric `sortOrder` field on each
//   `classes/{id}` doc, so it is the same on every device. Only the admin list
//   reads it; the student-facing pages ignore it.

import { doc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase/config';

export type ClassSortMode = 'az' | 'za' | 'deadline' | 'custom';

export const CLASS_SORT_MODES: { value: ClassSortMode; label: string; title: string }[] = [
  { value: 'az', label: 'A–Z', title: 'Alfabetic, de la A la Z' },
  { value: 'za', label: 'Z–A', title: 'Alfabetic, de la Z la A' },
  { value: 'deadline', label: 'După termen', title: 'Cel mai apropiat termen primul' },
  { value: 'custom', label: 'Ordine personalizată', title: 'Ordinea aleasă de tine (trage clasele în ordinea dorită)' },
];

export interface SortableClass {
  id: string;
  schoolName?: string;
  diriginteName?: string;
  sortOrder?: number;
  deadline?: any;
}

// Romanian alphabet order (Ă/Â after A, Ș after S, Ț after T), case-insensitive,
// digits compared numerically ("Clasa 9" < "Clasa 10").
const collator = new Intl.Collator('ro', { sensitivity: 'base', numeric: true });

export const compareClassNames = (a: SortableClass, b: SortableClass): number =>
  collator.compare((a.schoolName || '').trim(), (b.schoolName || '').trim())
  || collator.compare((a.diriginteName || '').trim(), (b.diriginteName || '').trim())
  || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const looseName = (s: string): string =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** True when two class names look the same to a human (case, diacritics and spacing ignored). */
export const sameClassName = (a: string, b: string): boolean => looseName(a) === looseName(b);

const deadlineMs = (c: SortableClass): number | null => {
  const d = c.deadline;
  if (!d) return null;
  const date: Date | null = typeof d.toDate === 'function' ? d.toDate() : d instanceof Date ? d : null;
  const ms = date ? date.getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
};

const hasSortOrder = (c: SortableClass): boolean =>
  typeof c.sortOrder === 'number' && Number.isFinite(c.sortOrder);

/** Returns a new, sorted array; never mutates the input. */
export function sortClasses<T extends SortableClass>(list: T[], mode: ClassSortMode): T[] {
  const out = [...list];
  switch (mode) {
    case 'za':
      return out.sort((a, b) => compareClassNames(b, a));
    case 'deadline':
      // Previous default: nearest deadline first, classes without one last.
      return out.sort((a, b) => {
        const da = deadlineMs(a);
        const db = deadlineMs(b);
        if (da !== null && db !== null && da !== db) return da - db;
        if (da !== null && db === null) return -1;
        if (da === null && db !== null) return 1;
        return compareClassNames(a, b);
      });
    case 'custom':
      // Classes placed by the admin first (by sortOrder); classes never placed
      // (e.g. created after the last reorder) follow, alphabetically.
      return out.sort((a, b) => {
        const ha = hasSortOrder(a);
        const hb = hasSortOrder(b);
        if (ha && hb && a.sortOrder !== b.sortOrder) return (a.sortOrder as number) - (b.sortOrder as number);
        if (ha && !hb) return -1;
        if (!ha && hb) return 1;
        return compareClassNames(a, b);
      });
    case 'az':
    default:
      return out.sort(compareClassNames);
  }
}

const MODE_KEY = 'admin.classSortMode';

export function loadClassSortMode(): ClassSortMode {
  try {
    const v = window.localStorage.getItem(MODE_KEY);
    if (v === 'az' || v === 'za' || v === 'deadline' || v === 'custom') return v;
  } catch { /* storage unavailable (private mode etc.) */ }
  return 'az';
}

export function saveClassSortMode(mode: ClassSortMode): void {
  try { window.localStorage.setItem(MODE_KEY, mode); } catch { /* ignore */ }
}

/** The sortOrder writes needed so `ordered` becomes the stored custom order (unchanged docs skipped). */
export function planClassOrder(ordered: SortableClass[]): { id: string; sortOrder: number }[] {
  return ordered
    .map((c, i) => ({ id: c.id, sortOrder: i, prev: c.sortOrder }))
    .filter(x => x.prev !== x.sortOrder)
    .map(({ id, sortOrder }) => ({ id, sortOrder }));
}

/**
 * Persists `ordered` as the custom order: writes `sortOrder` (0..n-1) only on
 * the class docs whose value changes. Batches are kept under Firestore's 500
 * writes limit. Returns how many docs were written.
 */
export async function saveClassOrder(ordered: SortableClass[]): Promise<number> {
  const changes = planClassOrder(ordered);
  const CHUNK = 400;
  for (let i = 0; i < changes.length; i += CHUNK) {
    const batch = writeBatch(db);
    changes.slice(i, i + CHUNK).forEach(ch => {
      batch.update(doc(db, 'classes', ch.id), { sortOrder: ch.sortOrder });
    });
    await batch.commit();
  }
  return changes.length;
}

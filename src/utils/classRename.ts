// Renaming a class (the `schoolName` field shown everywhere as the class name).
//
// Everything that identifies a class is its Firestore doc id, never its name:
// student links (/class/:id, /gallery/:id, /sheet/:id), QR codes, Storage
// paths (classes/{id}/..., submissions/{classId}/...), submissions
// ({classId}_{student}), the classStatus mirror and download logs. ZIP and
// Excel names are built from the current name at download time. So a rename
// only changes `classes/{id}.schoolName` — no file is moved.
//
// The one denormalized copy of the name is `flipbooks.sourceName` (the source
// label an interactive album keeps from when it was created). It is updated in
// the same transaction, but only where it still equals the old name.

import { collection, doc, getDocs, query, runTransaction, where, type DocumentReference } from 'firebase/firestore';
import { db } from '../firebase/config';
import { sameClassName, type SortableClass } from './classOrder';

export const CLASS_NAME_MAX_LENGTH = 150;

/** Error whose message is meant to be shown to the admin as is. */
export class ClassRenameError extends Error {}

/** Trims and collapses inner whitespace runs to a single space. */
export const normalizeClassName = (raw: string): string => raw.replace(/\s+/g, ' ').trim();

/** Blocking problems with a new name (null = can be saved). */
export function validateClassName(newName: string, currentName: string): string | null {
  const name = normalizeClassName(newName);
  if (!name) return 'Numele clasei nu poate fi gol.';
  if (name.length > CLASS_NAME_MAX_LENGTH) return `Numele este prea lung (maxim ${CLASS_NAME_MAX_LENGTH} de caractere).`;
  if (name === (currentName || '').trim()) return 'Numele nou este identic cu cel actual.';
  return null;
}

/** Other classes already using this name (non-blocking warning only). */
export function findClassesWithSameName<T extends SortableClass>(newName: string, classes: T[], selfId: string): T[] {
  const name = normalizeClassName(newName);
  if (!name) return [];
  return classes.filter(c => c.id !== selfId && sameClassName(c.schoolName || '', name));
}

export interface RenameClassResult {
  oldName: string;
  newName: string;
  flipbooksUpdated: number;
}

export async function renameClass(classId: string, rawNewName: string): Promise<RenameClassResult> {
  const newName = normalizeClassName(rawNewName);
  if (!newName) throw new ClassRenameError('Numele clasei nu poate fi gol.');
  if (newName.length > CLASS_NAME_MAX_LENGTH) throw new ClassRenameError(`Numele este prea lung (maxim ${CLASS_NAME_MAX_LENGTH} de caractere).`);

  // Queries cannot run inside a web transaction, so find the candidate albums
  // first; each one is re-read inside the transaction before it is touched.
  // A failure here must not block the rename itself.
  let flipbookRefs: DocumentReference[] = [];
  try {
    const snap = await getDocs(query(collection(db, 'flipbooks'), where('sourceId', '==', classId)));
    flipbookRefs = snap.docs.filter(d => d.get('sourceType') === 'class').map(d => d.ref);
  } catch (err) {
    console.warn('[renameClass] could not look up interactive albums of the class; only the class is renamed:', err);
  }

  const classRef = doc(db, 'classes', classId);
  return runTransaction(db, async (tx) => {
    const classSnap = await tx.get(classRef);
    if (!classSnap.exists()) throw new ClassRenameError('Clasa nu mai există (a fost ștearsă între timp).');
    const oldName = String(classSnap.get('schoolName') ?? '');

    // All reads before any write (transaction rule).
    const books = await Promise.all(flipbookRefs.map(ref => tx.get(ref)));
    if (oldName === newName) return { oldName, newName, flipbooksUpdated: 0 };

    tx.update(classRef, { schoolName: newName });

    let flipbooksUpdated = 0;
    books.forEach(b => {
      if (!b.exists()) return;
      if (b.get('sourceType') !== 'class' || b.get('sourceId') !== classId) return;
      const label = b.get('sourceName');
      if (typeof label !== 'string' || !oldName || label.trim() !== oldName.trim()) return;
      tx.update(b.ref, { sourceName: newName });
      flipbooksUpdated++;
    });
    return { oldName, newName, flipbooksUpdated };
  });
}

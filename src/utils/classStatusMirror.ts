import { doc, setDoc, deleteDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { defaultDb } from '../firebase/config';

/**
 * Storage rules can only read the (default) Firestore database, but classes live
 * in the named "xiacollection" database. This mirrors the two fields Storage
 * needs (status + deadline) into `classStatus/{classId}` of the (default) db.
 *
 * Failures are logged and swallowed: a mirror problem must never break the
 * admin action that triggered it.
 */
export async function syncClassStatusMirror(
  classId: string,
  data: { status?: string | null; deadline?: Date | Timestamp | null }
): Promise<void> {
  try {
    const d = data.deadline;
    const deadline = d == null ? null : d instanceof Date ? Timestamp.fromDate(d) : d;
    await setDoc(
      doc(defaultDb, 'classStatus', classId),
      { status: data.status ?? 'active', deadline, updatedAt: serverTimestamp() },
      { merge: true }
    );
  } catch (err) {
    console.error(`[classStatusMirror] FAILED to sync classStatus/${classId} - student uploads may be wrongly blocked/allowed until re-saved:`, err);
  }
}

export async function deleteClassStatusMirror(classId: string): Promise<void> {
  try {
    await deleteDoc(doc(defaultDb, 'classStatus', classId));
  } catch (err) {
    console.error(`[classStatusMirror] FAILED to delete classStatus/${classId}:`, err);
  }
}

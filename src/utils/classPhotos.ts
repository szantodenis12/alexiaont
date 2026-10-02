import { collection, doc, getDocs, addDoc, deleteDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase/config';
import { cdnPhoto } from './cdn';

/**
 * Class gallery photos used to live as a `galleryPhotos` array inside the class
 * document itself. Firestore caps a document at 1MB, and with two download URLs
 * plus two storage paths each photo costs ~600 bytes — so a class hit a hard
 * ceiling around 1.500-1.700 photos, after which the write simply failed and an
 * entire upload session was lost.
 *
 * Photos now live in a `photos` subcollection, one small document each, exactly
 * like `photo_galleries` already does. The class document carries
 * `photosInSubcollection: true` once it has been moved over.
 *
 * Everything in here keeps the old array shape at the boundary, so callers still
 * receive a plain `ClassPhoto[]` and did not have to change how they render.
 */

export interface ClassPhoto {
  firestoreId?: string;   // document id inside the subcollection
  name: string;
  url: string;            // displayed copy (watermarked when enabled)
  path: string;
  cleanUrl?: string;      // untouched original, for download/print
  cleanPath?: string;
  previewUrl?: string;       // ~1200px copy used by grids (watermarked when enabled)
  previewPath?: string;
  previewCleanUrl?: string;  // ~1200px copy without watermark, for the clean link
  previewCleanPath?: string;
  thumbUrl?: string;         // ~600px copy — what phones load in the grid
  thumbPath?: string;
  folder?: string;        // set when uploaded from a folder drop
  order?: number | null;  // null = sort by name
  sessionId?: string;     // photo session ("ședință"); missing = MAIN_SESSION_ID
}

/**
 * Photo sessions ("ședințe"). A class may be shot in several sessions that all
 * live on the same gallery link and in the same configurator. The class doc
 * carries `sessions?: ClassSession[]`; when absent there is one implicit main
 * session, so classes that never used the feature need no migration at all.
 */
export interface ClassSession {
  id: string;
  name: string;
}

export const MAIN_SESSION_ID = 'main';
export const DEFAULT_MAIN_SESSION_NAME = 'Galerie';
/** Main session + 5 additional ones. */
export const MAX_CLASS_SESSIONS = 6;

/** The class's sessions, always with the main one first. Never empty. */
export const getClassSessions = (classData?: Record<string, any> | null): ClassSession[] => {
  const raw = Array.isArray(classData?.sessions) ? (classData!.sessions as any[]) : [];
  const clean: ClassSession[] = raw
    .filter(s => s && typeof s.id === 'string' && s.id)
    .map(s => ({ id: s.id, name: typeof s.name === 'string' && s.name.trim() ? s.name : (s.id === MAIN_SESSION_ID ? DEFAULT_MAIN_SESSION_NAME : 'Ședință') }));
  if (!clean.some(s => s.id === MAIN_SESSION_ID)) {
    clean.unshift({ id: MAIN_SESSION_ID, name: DEFAULT_MAIN_SESSION_NAME });
  }
  return clean.slice(0, MAX_CLASS_SESSIONS);
};

/** Session a photo belongs to (missing/unknown id falls back to main). */
export const photoSessionId = (photo: { sessionId?: string | null }, sessions?: ClassSession[]): string => {
  const id = photo.sessionId || MAIN_SESSION_ID;
  if (sessions && !sessions.some(s => s.id === id)) return MAIN_SESSION_ID;
  return id;
};

export const newSessionId = () =>
  `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const classPhotosCol = (classId: string) =>
  collection(db, 'classes', classId, 'photos');

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Name-aware sort that honours an explicit drag order when one exists. */
export const sortClassPhotos = (photos: ClassPhoto[]): ClassPhoto[] =>
  [...photos].sort((a, b) => {
    const ao = a.order ?? null;
    const bo = b.order ?? null;
    if (ao !== null && bo !== null && ao !== bo) return ao - bo;
    if (ao !== null && bo === null) return -1;
    if (ao === null && bo !== null) return 1;
    return collator.compare(a.name, b.name);
  });

/**
 * Read a class's photos from wherever they currently are.
 *
 * `classData` is the already-fetched class document, so callers that have it do
 * not pay for a second read. Classes created before the migration keep working
 * untouched — they simply return their legacy array.
 */
export async function loadClassPhotos(
  classId: string,
  classData?: Record<string, any> | null
): Promise<ClassPhoto[]> {
  if (classData && !classData.photosInSubcollection) {
    return sortClassPhotos((classData.galleryPhotos || []) as ClassPhoto[]);
  }

  try {
    const snap = await getDocs(classPhotosCol(classId));
    if (snap.empty) {
      // Flag set but nothing stored yet (e.g. a class created seconds ago whose
      // background upload has not written its first photo). Fall back to the
      // legacy array so we never render an empty gallery over real data.
      return sortClassPhotos((classData?.galleryPhotos || []) as ClassPhoto[]);
    }
    const photos = snap.docs.map(d => cdnPhoto({ firestoreId: d.id, ...(d.data() as any) })) as ClassPhoto[];
    return sortClassPhotos(photos);
  } catch (e) {
    console.error('[classPhotos] Failed to read photo subcollection:', e);
    return sortClassPhotos((classData?.galleryPhotos || []) as ClassPhoto[]);
  }
}

/** Append one photo. Called per file during upload so progress survives a crash. */
export async function addClassPhoto(classId: string, photo: ClassPhoto): Promise<string | undefined> {
  try {
    const ref = await addDoc(classPhotosCol(classId), {
      name: photo.name,
      url: photo.url,
      path: photo.path,
      cleanUrl: photo.cleanUrl ?? null,
      cleanPath: photo.cleanPath ?? null,
      previewUrl: photo.previewUrl ?? null,
      previewPath: photo.previewPath ?? null,
      previewCleanUrl: photo.previewCleanUrl ?? null,
      previewCleanPath: photo.previewCleanPath ?? null,
      thumbUrl: photo.thumbUrl ?? null,
      thumbPath: photo.thumbPath ?? null,
      folder: photo.folder ?? null,
      order: photo.order ?? null,
      // Only written for non-main sessions: a missing field already means main.
      ...(photo.sessionId && photo.sessionId !== MAIN_SESSION_ID ? { sessionId: photo.sessionId } : {}),
    });
    return ref.id;
  } catch (e) {
    console.error('[classPhotos] Failed to add photo:', photo.name, e);
    return undefined;
  }
}

export async function deleteClassPhoto(classId: string, firestoreId: string): Promise<void> {
  await deleteDoc(doc(db, 'classes', classId, 'photos', firestoreId));
}

/**
 * Delete every photo document for a class, in batches of 499.
 *
 * Firestore does not cascade deletes: removing the class document on its own
 * would leave the whole subcollection stranded and still billed, with no path
 * left in the UI to reach it. Call this before deleting the parent.
 */
export async function deleteClassPhotosCollection(classId: string): Promise<void> {
  try {
    const snap = await getDocs(classPhotosCol(classId));
    if (snap.empty) return;

    const BATCH_LIMIT = 499;
    for (let i = 0; i < snap.docs.length; i += BATCH_LIMIT) {
      const batch = writeBatch(db);
      snap.docs.slice(i, i + BATCH_LIMIT).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
  } catch (e) {
    console.error('[classPhotos] Failed to delete photo subcollection:', e);
    throw e;
  }
}

/**
 * Move a legacy class onto the subcollection, in batches of 499 writes.
 *
 * Runs once, right before the first background upload touches a class that has
 * not been migrated. The legacy `galleryPhotos` array is deliberately left in
 * place: if anything goes wrong mid-migration the old data is still readable,
 * and `loadClassPhotos` falls back to it.
 */
export async function ensureClassMigrated(
  classId: string,
  classData?: Record<string, any> | null
): Promise<void> {
  if (classData?.photosInSubcollection) return;

  const legacy = (classData?.galleryPhotos || []) as ClassPhoto[];

  try {
    // Guard against a double migration: if the subcollection already holds
    // documents, just set the flag rather than duplicating every photo.
    const existing = await getDocs(classPhotosCol(classId));
    if (existing.empty && legacy.length > 0) {
      const sorted = sortClassPhotos(legacy);
      const BATCH_LIMIT = 499;
      for (let i = 0; i < sorted.length; i += BATCH_LIMIT) {
        const batch = writeBatch(db);
        sorted.slice(i, i + BATCH_LIMIT).forEach((p, idx) => {
          batch.set(doc(classPhotosCol(classId)), {
            name: p.name,
            url: p.url,
            path: p.path,
            cleanUrl: p.cleanUrl ?? null,
            cleanPath: p.cleanPath ?? null,
            previewUrl: p.previewUrl ?? null,
            previewPath: p.previewPath ?? null,
            previewCleanUrl: p.previewCleanUrl ?? null,
            previewCleanPath: p.previewCleanPath ?? null,
            thumbUrl: p.thumbUrl ?? null,
            thumbPath: p.thumbPath ?? null,
            folder: p.folder ?? null,
            order: i + idx,
          });
        });
        await batch.commit();
      }
    }

    await updateDoc(doc(db, 'classes', classId), {
      photosInSubcollection: true,
      photoCount: legacy.length,
    });
  } catch (e) {
    console.error('[classPhotos] Migration failed for class', classId, e);
    throw e;
  }
}

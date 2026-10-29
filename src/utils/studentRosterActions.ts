// Firestore side of roster editing (rename / add student, add / rename /
// remove diriginte). Every action is ONE transaction: the class doc (and the
// submission docs involved) are read fresh inside it, the pure planner in
// utils/studentRoster decides the writes, and Firestore commits them all or
// none — so a failure never leaves a half-renamed student behind.

import { doc, runTransaction, deleteField, FieldPath, type Transaction, type DocumentReference } from 'firebase/firestore';
import { db } from '../firebase/config';
import {
  planStudentRename, planAddStudent, validateDiriginteName, checkNameFormat,
  type ClassFieldOp, type RosterClassLike,
} from './studentRoster';
import {
  listDiriginti, getExtraDiriginti, extraDiriginteKey, extraDiriginteSheetKey,
  newExtraDiriginteId, DIRIGINTE_KEY,
} from './diriginte';

/** Error whose message is meant to be shown to the admin as is. */
export class RosterError extends Error {}

const applyOps = (tx: Transaction, ref: DocumentReference, ops: ClassFieldOp[]) => {
  if (ops.length === 0) return;
  const args: unknown[] = [];
  ops.forEach(op => {
    // FieldPath, never a dotted string: names contain dots ("1. ALEXIA").
    args.push(op.key === undefined ? new FieldPath(op.field) : new FieldPath(op.field, op.key));
    args.push(op.delete ? deleteField() : op.value);
  });
  const [first, firstValue, ...rest] = args;
  tx.update(ref, first as FieldPath, firstValue, ...rest);
};

export interface RenameStudentResult {
  newName: string;
  movedSubmission: boolean;
  warnings: string[];
}

/**
 * Renames a student everywhere their name is a key. Order inside the single
 * transaction: read class + old/new submission docs -> plan -> create the new
 * submission doc, delete the old one, update the class doc. Storage files are
 * not moved (the submission keeps their URLs).
 */
export async function renameStudent(params: {
  classId: string;
  oldName: string;
  newName: string;
  /** `studentName` on the submission the admin list matched (may differ in case from the roster). */
  submissionStudentName?: string | null;
}): Promise<RenameStudentResult> {
  const { classId, oldName } = params;
  const newName = params.newName.trim();
  const classRef = doc(db, 'classes', classId);
  // doc() throws on a "/" in the id. The new name is refused up front; a legacy
  // roster name containing "/" can never have had a submission (not a valid doc
  // id), so it is simply not read — renaming is how such a name gets fixed.
  const newNameError = checkNameFormat(newName);
  if (newNameError) throw new RosterError(newNameError);
  const exactRef = oldName.includes('/') ? null : doc(db, 'submissions', `${classId}_${oldName}`);
  const hinted = params.submissionStudentName && params.submissionStudentName !== oldName && !params.submissionStudentName.includes('/')
    ? doc(db, 'submissions', `${classId}_${params.submissionStudentName}`)
    : null;
  const newRef = doc(db, 'submissions', `${classId}_${newName}`);

  return runTransaction(db, async (tx) => {
    const classSnap = await tx.get(classRef);
    if (!classSnap.exists()) throw new RosterError('Clasa nu mai există.');
    const exactSnap = exactRef ? await tx.get(exactRef) : null;
    const hintedSnap = hinted ? await tx.get(hinted) : null;
    const newSnap = await tx.get(newRef);

    const subSnap = exactSnap && exactSnap.exists() ? exactSnap : (hintedSnap && hintedSnap.exists() ? hintedSnap : null);
    const result = planStudentRename({
      classId,
      classDoc: classSnap.data() as RosterClassLike,
      oldName,
      newName,
      submission: subSnap ? { id: subSnap.id, data: subSnap.data() as Record<string, unknown> } : null,
      newSubmissionExists: newSnap.exists(),
      now: new Date(),
    });
    if (!result.ok) throw new RosterError(result.error);
    const { plan } = result;

    if (plan.submission) {
      tx.set(doc(db, 'submissions', plan.submission.toId), plan.submission.data);
      tx.delete(doc(db, 'submissions', plan.submission.fromId));
    }
    applyOps(tx, classRef, plan.classOps);
    return { newName: plan.newName, movedSubmission: !!plan.submission, warnings: plan.warnings };
  });
}

export interface AddStudentResult {
  name: string;
  /** A submission already existed under this name (it now shows on the new row). */
  adoptedSubmission: boolean;
}

/** Appends a student to the end of the roster (validated against the fresh class doc). */
export async function addStudent(classId: string, rawName: string): Promise<AddStudentResult> {
  const classRef = doc(db, 'classes', classId);
  const name = rawName.trim();
  const nameError = checkNameFormat(name);
  if (nameError) throw new RosterError(nameError);
  const subRef = doc(db, 'submissions', `${classId}_${name}`);
  return runTransaction(db, async (tx) => {
    const classSnap = await tx.get(classRef);
    if (!classSnap.exists()) throw new RosterError('Clasa nu mai există.');
    const subSnap = await tx.get(subRef);
    const result = planAddStudent(classSnap.data() as RosterClassLike, name);
    if (!result.ok) throw new RosterError(result.error);
    applyOps(tx, classRef, result.plan.classOps);
    return { name: result.plan.name, adoptedSubmission: subSnap.exists() };
  });
}

/** Adds one more diriginte (stable random id; keys never depend on the name). */
export async function addExtraDiriginte(classId: string, rawName: string): Promise<{ id: string; name: string }> {
  const classRef = doc(db, 'classes', classId);
  const name = rawName.trim();
  return runTransaction(db, async (tx) => {
    const classSnap = await tx.get(classRef);
    if (!classSnap.exists()) throw new RosterError('Clasa nu mai există.');
    const data = classSnap.data();
    const err = validateDiriginteName(listDiriginti(data), name, null);
    if (err) throw new RosterError(err);
    const existing = Array.isArray(data.extraDiriginti) ? data.extraDiriginti : [];
    const taken = new Set(existing.map((d: any) => d?.id));
    let id = newExtraDiriginteId();
    while (taken.has(id)) id = newExtraDiriginteId();
    tx.update(classRef, { extraDiriginti: [...existing, { id, name }] });
    return { id, name };
  });
}

/**
 * Renames a diriginte. Their submission / sheet keys do not depend on the
 * name, so this only rewrites `diriginteName` (first diriginte) or that
 * entry's `name` in `extraDiriginti`.
 */
export async function renameDiriginte(classId: string, key: string, rawName: string): Promise<string> {
  const classRef = doc(db, 'classes', classId);
  const name = rawName.trim();
  return runTransaction(db, async (tx) => {
    const classSnap = await tx.get(classRef);
    if (!classSnap.exists()) throw new RosterError('Clasa nu mai există.');
    const data = classSnap.data();
    const formatErr = checkNameFormat(name);
    if (formatErr) throw new RosterError(formatErr);
    const err = validateDiriginteName(listDiriginti(data), name, key);
    if (err) throw new RosterError(err);
    if (key === DIRIGINTE_KEY) {
      tx.update(classRef, { diriginteName: name });
      return name;
    }
    const existing: any[] = Array.isArray(data.extraDiriginti) ? data.extraDiriginti : [];
    const idx = existing.findIndex(d => d && typeof d.id === 'string' && extraDiriginteKey(d.id) === key);
    if (idx === -1) throw new RosterError('Dirigintele nu mai există la această clasă. Reîncarcă pagina.');
    const next = existing.map((d, i) => (i === idx ? { ...d, name } : d));
    tx.update(classRef, { extraDiriginti: next });
    return name;
  });
}

/**
 * Removes an extra diriginte — only while they have NO submission (their
 * selection is never deleted from here). Their sheet cells go with them.
 */
export async function removeExtraDiriginte(classId: string, id: string): Promise<void> {
  const classRef = doc(db, 'classes', classId);
  const subRef = doc(db, 'submissions', `${classId}_${extraDiriginteKey(id)}`);
  await runTransaction(db, async (tx) => {
    const classSnap = await tx.get(classRef);
    if (!classSnap.exists()) throw new RosterError('Clasa nu mai există.');
    const subSnap = await tx.get(subRef);
    if (subSnap.exists()) {
      throw new RosterError('Acest diriginte a trimis deja selecția, așa că nu poate fi scos din listă (selecția lui nu se șterge de aici).');
    }
    const data = classSnap.data();
    const existing: any[] = Array.isArray(data.extraDiriginti) ? data.extraDiriginti : [];
    if (!getExtraDiriginti(data).some(d => d.id === id)) {
      throw new RosterError('Dirigintele nu mai există la această clasă. Reîncarcă pagina.');
    }
    const sheetKey = extraDiriginteSheetKey(id);
    const ops: ClassFieldOp[] = [{ field: 'extraDiriginti', value: existing.filter(d => d?.id !== id) }];
    if (data.studentOverrides && typeof data.studentOverrides === 'object' && sheetKey in data.studentOverrides) {
      ops.push({ field: 'studentOverrides', key: sheetKey, delete: true });
    }
    if (data.customColumnValues && typeof data.customColumnValues === 'object' && sheetKey in data.customColumnValues) {
      ops.push({ field: 'customColumnValues', key: sheetKey, delete: true });
    }
    applyOps(tx, classRef, ops);
  });
}

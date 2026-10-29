// Pure (Firebase-free) helpers for editing a class roster: validating names,
// planning a student rename and planning an "add student". The Firestore side
// (transactions) lives in utils/studentRosterActions.ts; keeping the decisions
// here makes them unit-testable and keeps every write explicit.
//
// Everything keyed by a student's roster name:
//  - classes/{id}.studentList            (array, order matters)
//  - classes/{id}.studentOverrides[name] (sheet cell overrides)
//  - classes/{id}.customColumnValues[name] (sheet custom columns)
//  - classes/{id}.studentPretExtraMap[name], studentGreseliMap[name] (legacy)
//  - submissions/{classId}_{name}        (doc id + `studentName` field)
//  - Storage submissions/{classId}/{name}/... (NOT moved, URLs stay valid)
//  - voice QR links /v/{classId}_{name}  (old id kept in previousSubmissionIds)
// Special persons share the studentOverrides / customColumnValues namespace
// (keyed by person.name), which is why their names are checked too.

import { DIRIGINTE_KEY, DIRIGINTE_SHEET_KEY } from './diriginte';

/** Class-doc maps keyed by the student's roster name. */
export const NAME_KEYED_CLASS_MAPS = ['studentOverrides', 'customColumnValues', 'studentPretExtraMap', 'studentGreseliMap'] as const;

export const MAX_ROSTER_NAME_LENGTH = 150;

/** Comparison form of a name: trimmed, no diacritics, lower case, single spaces. */
export const normalizeRosterName = (name: string): string =>
  String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Any class-shaped object (typed ClassData or raw Firestore data). */
export interface RosterClassLike {
  studentList?: unknown;
  specialPersons?: unknown;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const hasOwn = (obj: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(obj, key);

export const rosterOf = (cls: RosterClassLike | null | undefined): string[] =>
  Array.isArray(cls?.studentList) ? (cls!.studentList as unknown[]).filter((n): n is string => typeof n === 'string') : [];

const specialPersonNames = (cls: RosterClassLike | null | undefined): string[] =>
  Array.isArray(cls?.specialPersons)
    ? (cls!.specialPersons as any[]).map(p => (p && typeof p.name === 'string' ? p.name : '')).filter(Boolean)
    : [];

/**
 * Format-only checks for any name typed by the admin (students and diriginti).
 * Returns a Romanian error message, or null when the name is acceptable.
 */
export const checkNameFormat = (name: string): string | null => {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return 'Introdu numele.';
  if (trimmed.length > MAX_ROSTER_NAME_LENGTH) return `Numele este prea lung (maxim ${MAX_ROSTER_NAME_LENGTH} de caractere).`;
  // `/` would split the submission doc id and the Storage folder.
  if (trimmed.includes('/')) return 'Numele nu poate conține caracterul „/”.';
  const norm = normalizeRosterName(trimmed);
  if (norm.startsWith(DIRIGINTE_KEY) || norm.startsWith(normalizeRosterName(DIRIGINTE_SHEET_KEY))) {
    return 'Acest nume este rezervat de aplicație. Alege alt nume.';
  }
  return null;
};

/**
 * Validates a student name against the class: format, duplicates in the roster
 * and collisions with special persons (case-, diacritics- and space-insensitive).
 * `ignoreIndex` is the roster position being renamed (excluded from the check).
 */
export const validateStudentName = (
  cls: RosterClassLike | null | undefined,
  name: string,
  ignoreIndex: number = -1
): string | null => {
  const formatError = checkNameFormat(name);
  if (formatError) return formatError;
  const norm = normalizeRosterName(name);
  const roster = rosterOf(cls);
  const dupIndex = roster.findIndex((n, i) => i !== ignoreIndex && normalizeRosterName(n) === norm);
  if (dupIndex !== -1) {
    return `Există deja un elev cu numele „${roster[dupIndex]}” în această clasă (se ignoră diacriticele și literele mari/mici).`;
  }
  const sp = specialPersonNames(cls).find(n => normalizeRosterName(n) === norm);
  if (sp) return `Există deja o persoană specială în tabel cu numele „${sp}”. Alege alt nume.`;
  return null;
};

/** One write on the class doc: `field` (or `field.key` when key is set) is set or deleted. */
export type ClassFieldOp =
  | { field: string; key?: string; value: unknown; delete?: false }
  | { field: string; key?: string; delete: true };

export interface SubmissionMove {
  fromId: string;
  toId: string;
  /** Full content of the new doc (everything from the old one + updated name fields). */
  data: Record<string, unknown>;
}

export interface StudentRenamePlan {
  oldName: string;
  newName: string;
  index: number;
  classOps: ClassFieldOp[];
  submission: SubmissionMove | null;
  warnings: string[];
}

export type PlanResult<T> = { ok: true; plan: T } | { ok: false; error: string };

/**
 * For each name-keyed class map: carries `fromName`'s entry over to `toName`
 * (deleting the old key unless a special person still uses it) and drops a
 * stale entry already sitting under `toName` that no visible row owns.
 */
const planMapKeyMoves = (
  cls: RosterClassLike,
  fromName: string | null,
  toName: string,
  warnings: string[]
): ClassFieldOp[] => {
  const ops: ClassFieldOp[] = [];
  const fromSharedWithSpecialPerson = fromName !== null && specialPersonNames(cls).includes(fromName);
  NAME_KEYED_CLASS_MAPS.forEach(field => {
    const map = (cls as Record<string, unknown>)[field];
    if (!isPlainObject(map)) return;
    if (fromName !== null && hasOwn(map, fromName)) {
      let value = map[fromName];
      if (value === undefined) return;
      if (field === 'studentOverrides' && isPlainObject(value) && typeof value.name === 'string') {
        if (value.name.trim() === fromName.trim()) {
          // The manual sheet name just repeated the old name: drop it so the row shows the new one.
          const { name: _dropped, ...rest } = value;
          value = rest;
        } else if (value.name.trim() !== toName) {
          warnings.push(`În tabel, rândul elevului are numele scris manual „${value.name}”. L-am păstrat; îl poți schimba din tabel.`);
        }
      }
      ops.push({ field, key: toName, value });
      if (!fromSharedWithSpecialPerson) ops.push({ field, key: fromName, delete: true });
    } else if (hasOwn(map, toName)) {
      // Leftover from an old row with this name (nobody shows it today); left
      // in place it would silently attach to this student and change totals.
      ops.push({ field, key: toName, delete: true });
    }
  });
  return ops;
};

const uniqueStrings = (values: unknown[]): string[] => {
  const out: string[] = [];
  values.forEach(v => {
    if (typeof v === 'string' && v && !out.includes(v)) out.push(v);
  });
  return out;
};

export interface PlanStudentRenameInput {
  classId: string;
  classDoc: RosterClassLike;
  oldName: string;
  newName: string;
  /** The student's current submission doc (id + data), or null when they have not submitted. */
  submission: { id: string; data: Record<string, unknown> } | null;
  /** Whether `submissions/{classId}_{newName}` already exists. */
  newSubmissionExists: boolean;
  now: Date;
}

/**
 * Decides every write needed to rename a student. Pure: the caller performs
 * the returned writes inside one Firestore transaction (all or nothing).
 */
export const planStudentRename = (input: PlanStudentRenameInput): PlanResult<StudentRenamePlan> => {
  const { classId, classDoc, oldName, submission, newSubmissionExists, now } = input;
  const newName = String(input.newName ?? '').trim();
  const roster = rosterOf(classDoc);
  const index = roster.indexOf(oldName);
  if (index === -1) {
    return { ok: false, error: `„${oldName}” nu mai este în lista clasei (lista a fost modificată între timp). Reîncarcă pagina și încearcă din nou.` };
  }
  if (newName === oldName) return { ok: false, error: 'Numele nou este identic cu cel actual.' };
  const nameError = validateStudentName(classDoc, newName, index);
  if (nameError) return { ok: false, error: nameError };

  const toId = `${classId}_${newName}`;
  const sameDoc = !!submission && submission.id === toId;
  if (newSubmissionExists && !sameDoc) {
    return { ok: false, error: `Există deja o selecție trimisă pe numele „${newName}”. Redenumirea a fost oprită ca să nu se suprascrie nimic.` };
  }

  const warnings: string[] = [];
  const newList = [...roster];
  newList[index] = newName;
  const classOps: ClassFieldOp[] = [
    { field: 'studentList', value: newList },
    ...planMapKeyMoves(classDoc, oldName, newName, warnings),
  ];

  let move: SubmissionMove | null = null;
  if (submission && !sameDoc) {
    const old = submission.data || {};
    const oldStudentName = typeof old.studentName === 'string' && old.studentName ? old.studentName : oldName;
    const data: Record<string, unknown> = {};
    Object.keys(old).forEach(k => {
      if (old[k] !== undefined) data[k] = old[k];
    });
    data.studentName = newName;
    if (data.id === submission.id) data.id = toId;
    // Old Storage folder names, so deleting the student later also cleans files
    // uploaded before the rename (Storage files are never moved).
    data.previousStudentNames = uniqueStrings([...(Array.isArray(old.previousStudentNames) ? old.previousStudentNames : []), oldStudentName]);
    // Old doc ids, so voice QR codes already printed (/v/{oldId}) keep working.
    data.previousSubmissionIds = uniqueStrings([...(Array.isArray(old.previousSubmissionIds) ? old.previousSubmissionIds : []), submission.id]);
    data.renamedAt = now;
    move = { fromId: submission.id, toId, data };
  }

  return { ok: true, plan: { oldName, newName, index, classOps, submission: move, warnings } };
};

/**
 * Returns the current name of the class submission that used `name` before a
 * rename (its `previousStudentNames` / `previousSubmissionIds`), or null.
 * Reusing such a name for another student is refused: already-printed voice QR
 * codes (/v/{classId}_{name}) would open the new student's message, and both
 * students would share the Storage folder submissions/{classId}/{name}/.
 * `ignoreStudentName` is the `studentName` of the submission being renamed
 * (renaming a student back to their own former name is fine).
 */
export const formerNameOwner = (
  classSubmissions: unknown[],
  classId: string,
  name: string,
  ignoreStudentName: string | null
): string | null => {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return null;
  const oldId = `${classId}_${trimmed}`;
  for (const raw of classSubmissions) {
    if (!isPlainObject(raw) || raw.classId !== classId) continue;
    if (ignoreStudentName !== null && raw.studentName === ignoreStudentName) continue;
    const names = Array.isArray(raw.previousStudentNames) ? raw.previousStudentNames : [];
    const ids = Array.isArray(raw.previousSubmissionIds) ? raw.previousSubmissionIds : [];
    if (names.includes(trimmed) || ids.includes(oldId)) {
      return typeof raw.studentName === 'string' ? raw.studentName : '';
    }
  }
  return null;
};

export interface StudentAddPlan {
  name: string;
  classOps: ClassFieldOp[];
}

/** Decides the writes to append a new student at the end of the roster. */
export const planAddStudent = (classDoc: RosterClassLike, rawName: string): PlanResult<StudentAddPlan> => {
  const name = String(rawName ?? '').trim();
  const nameError = validateStudentName(classDoc, name);
  if (nameError) return { ok: false, error: nameError };
  const warnings: string[] = [];
  return {
    ok: true,
    plan: {
      name,
      classOps: [
        { field: 'studentList', value: [...rosterOf(classDoc), name] },
        ...planMapKeyMoves(classDoc, null, name, warnings),
      ],
    },
  };
};

/**
 * Roster numbering convention: when most names start with "N. " (e.g.
 * "1. POPESCU ANA"), returns the next prefix ("27. ") to pre-fill the input.
 */
export const suggestNextRosterPrefix = (roster: string[]): string => {
  if (roster.length === 0) return '';
  const nums = roster
    .map(n => /^\s*(\d+)\s*[.)]\s*/.exec(n))
    .filter((m): m is RegExpExecArray => !!m)
    .map(m => parseInt(m[1], 10));
  if (nums.length === 0 || nums.length < roster.length / 2) return '';
  return `${Math.max(...nums) + 1}. `;
};

/** Applies class ops to a plain copy of the doc (used by tests / previews; never touches Firestore). */
export const applyClassOps = (doc: Record<string, unknown>, ops: ClassFieldOp[]): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...doc };
  ops.forEach(op => {
    if (op.key === undefined) {
      if (op.delete) delete out[op.field];
      else out[op.field] = op.value;
      return;
    }
    const map = isPlainObject(out[op.field]) ? { ...(out[op.field] as Record<string, unknown>) } : {};
    if (op.delete) {
      if (!isPlainObject(out[op.field])) return;
      delete map[op.key];
    } else {
      map[op.key] = op.value;
    }
    out[op.field] = map;
  });
  return out;
};

/** Validates a diriginte name against the class's other diriginti. */
export const validateDiriginteName = (
  diriginteNames: { key: string; name: string }[],
  name: string,
  ignoreKey: string | null
): string | null => {
  const formatError = checkNameFormat(name);
  if (formatError) return formatError;
  const norm = normalizeRosterName(name);
  const dup = diriginteNames.find(d => d.key !== ignoreKey && normalizeRosterName(d.name) === norm);
  if (dup) return `Există deja un diriginte cu numele „${dup.name}” la această clasă.`;
  return null;
};

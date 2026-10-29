// The homeroom teacher (diriginte) can pick photos through the same class
// configurator as the students. Their submission is stored under a reserved,
// stable `studentName` so it:
//  - never collides with a student who happens to have the same name,
//  - survives renaming `diriginteName` on the class (no orphaned submission),
//  - needs no migration: it is derived from `diriginteName` at render time and
//    is never added to `studentList`.
// Submission doc id: `${classId}_${DIRIGINTE_KEY}`; Storage folder:
// `submissions/{classId}/${DIRIGINTE_KEY}/...` (same layout as a student).

export const DIRIGINTE_KEY = '__diriginte__';

export const isDiriginteKey = (studentName: unknown): boolean => studentName === DIRIGINTE_KEY;

export const getDiriginteSubmissionId = (classId: string): string => `${classId}_${DIRIGINTE_KEY}`;

/** Human label used wherever the reserved key would otherwise be shown. */
export const diriginteLabel = (diriginteName?: string): string =>
  diriginteName && diriginteName.trim() ? `Diriginte: ${diriginteName.trim()}` : 'Diriginte';

// ---------------------------------------------------------------------------
// Extra diriginti (a class can have more than one homeroom teacher).
//
// The first diriginte keeps its original representation untouched:
// `diriginteName` + submission key DIRIGINTE_KEY + sheet key '!DIRIGINTE'.
// Every additional one lives in `extraDiriginti: { id, name }[]` on the class
// doc. All their keys derive from the stable random `id`, never from the name,
// so renaming an extra diriginte is a plain `name` update with nothing to
// migrate (same property the first diriginte already has):
//  - submission studentName: `__diriginte__${id}` (doc `${classId}___diriginte__${id}`),
//    Storage folder `submissions/{classId}/__diriginte__${id}/...`,
//  - sheet override / custom column key: `!DIRIGINTE_${id}`.
// ---------------------------------------------------------------------------

export interface ExtraDiriginte {
  id: string;
  name: string;
}

/** Sheet override / custom-column key of the first diriginte (pre-existing). */
export const DIRIGINTE_SHEET_KEY = '!DIRIGINTE';

export const extraDiriginteKey = (id: string): string => `${DIRIGINTE_KEY}${id}`;
export const extraDiriginteSheetKey = (id: string): string => `${DIRIGINTE_SHEET_KEY}_${id}`;

/** True for the first diriginte's key AND every extra diriginte's key. */
export const isAnyDiriginteKey = (studentName: unknown): boolean =>
  typeof studentName === 'string' && studentName.startsWith(DIRIGINTE_KEY);

/** Stable id for a new extra diriginte (letters/digits only: safe in doc ids, paths, map keys). */
export const newExtraDiriginteId = (): string =>
  `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Valid extra diriginti of a class (tolerates a missing / malformed field). */
export const getExtraDiriginti = (cls: { extraDiriginti?: unknown } | null | undefined): ExtraDiriginte[] => {
  const raw = cls?.extraDiriginti;
  if (!Array.isArray(raw)) return [];
  return raw.filter((d: any): d is ExtraDiriginte =>
    !!d && typeof d.id === 'string' && /^[a-z0-9]+$/i.test(d.id) && typeof d.name === 'string' && d.name.trim().length > 0
  );
};

/** One diriginte of a class, whatever its representation. */
export interface DiriginteEntry {
  /** Submission `studentName` (reserved key). */
  key: string;
  /** Key in studentOverrides / customColumnValues. */
  sheetKey: string;
  name: string;
  isPrimary: boolean;
  /** Only for extra diriginti. */
  id?: string;
}

/**
 * Every diriginte of a class, the first one first. The first diriginte is
 * included only when `diriginteName` is set (same rule as before).
 */
export const listDiriginti = (
  cls: { diriginteName?: string; extraDiriginti?: unknown } | null | undefined
): DiriginteEntry[] => {
  const out: DiriginteEntry[] = [];
  const primary = cls?.diriginteName?.trim();
  if (primary) out.push({ key: DIRIGINTE_KEY, sheetKey: DIRIGINTE_SHEET_KEY, name: primary, isPrimary: true });
  getExtraDiriginti(cls).forEach(d => out.push({
    key: extraDiriginteKey(d.id),
    sheetKey: extraDiriginteSheetKey(d.id),
    name: d.name.trim(),
    isPrimary: false,
    id: d.id,
  }));
  return out;
};

/** The diriginte entry behind a reserved submission key, or null (unknown / removed). */
export const findDiriginteByKey = (
  cls: { diriginteName?: string; extraDiriginti?: unknown } | null | undefined,
  key: unknown
): DiriginteEntry | null => listDiriginti(cls).find(d => d.key === key) || null;

/** All diriginte names joined ("Pop Ion, Ionescu Maria"); just `diriginteName` when there are no extras. */
export const allDiriginteNames = (cls: { diriginteName?: string; extraDiriginti?: unknown } | null | undefined): string => {
  const extras = getExtraDiriginti(cls).map(d => d.name.trim());
  if (extras.length === 0) return cls?.diriginteName || '';
  return [cls?.diriginteName?.trim(), ...extras].filter(Boolean).join(', ');
};

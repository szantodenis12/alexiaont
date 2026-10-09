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

// Helpers for the "number of sonnets" and "dedication pages" features: class
// settings (defaults / validation), per-submission counts used by every total
// (form, class sheet, Excel) and the grouping used by the ZIPs / admin panel.

// ───────────────────────── Sonnets ─────────────────────────

/** Minimum number of sonnets when the class has none stored (client decision: 5). */
export const DEFAULT_SONET_MIN_COUNT = 5;

export interface SonetLimits {
  /** Always set (defaults to 5). */
  min: number;
  /** Undefined = no upper limit. */
  max?: number;
}

/** Reads the class's sonnet-count limits; missing/invalid min = 5, missing/invalid max = unlimited. */
export const resolveSonetLimits = (classData: any): SonetLimits => {
  const rawMin = Number(classData?.sonetMinCount);
  const min = classData?.sonetMinCount != null && Number.isFinite(rawMin) && rawMin >= 1
    ? Math.floor(rawMin) : DEFAULT_SONET_MIN_COUNT;
  const rawMax = Number(classData?.sonetMaxCount);
  const max = classData?.sonetMaxCount != null && Number.isFinite(rawMax) && Math.floor(rawMax) >= min
    ? Math.floor(rawMax) : undefined;
  return { min, max };
};

export interface ParsedSonetLimits {
  /** Undefined = left empty (the default 5 applies). */
  min?: number;
  /** Undefined = left empty (no upper limit). */
  max?: number;
  /** Romanian validation message, when the input is invalid. */
  error?: string;
}

const parseOptionalInt = (raw: string): number | null | 'invalid' => {
  const s = raw.trim();
  if (s === '') return null;
  if (!/^\d+$/.test(s)) return 'invalid';
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : 'invalid';
};

/**
 * Validates the admin's "Număr minim / maxim sonete" inputs. Empty = not set.
 * Both must be whole numbers >= 1 and max >= min (the default 5 counts as the
 * min when only max is given). Callers must only write defined fields (and
 * deleteField() the empty ones on edit) — never undefined/NaN.
 */
export const parseSonetLimits = (minRaw: string, maxRaw: string): ParsedSonetLimits => {
  const min = parseOptionalInt(minRaw);
  const max = parseOptionalInt(maxRaw);
  if (min === 'invalid' || (typeof min === 'number' && min < 1)) {
    return { error: 'Numărul minim de sonete trebuie să fie un număr întreg de cel puțin 1.' };
  }
  if (max === 'invalid' || (typeof max === 'number' && max < 1)) {
    return { error: 'Numărul maxim de sonete trebuie să fie un număr întreg de cel puțin 1.' };
  }
  const effectiveMin = typeof min === 'number' ? min : DEFAULT_SONET_MIN_COUNT;
  if (typeof max === 'number' && max < effectiveMin) {
    return { error: 'Numărul maxim de sonete nu poate fi mai mic decât minimul.' };
  }
  return { min: min ?? undefined, max: max ?? undefined };
};

/** True when the submission asked for the sonnet (photo and/or quote). */
export const submissionWantsSonet = (sub: any): boolean =>
  !!(sub && (sub.wantsSonetPhoto || sub.wantsSonetCitat || sub.sonetPhoto));

/**
 * How many sonnets a submission bought. New submissions store `sonetCount`
 * (0 when not wanted); older ones only have the yes/no flags, which count as 1.
 */
export const submissionSonetCount = (sub: any): number => {
  if (!sub) return 0;
  const n = Number(sub.sonetCount);
  if (sub.sonetCount != null && Number.isFinite(n)) return Math.max(0, Math.floor(n));
  return submissionWantsSonet(sub) ? 1 : 0;
};

// ───────────────────────── Dedication pages ─────────────────────────
// A dedication page is a blank album page where classmates write by hand: the
// student only picks how many (saved as `extraDedicationPagesCount`).

/** Default price (lei) of a dedication page when the class has none stored. */
export const DEFAULT_DEDICATION_PAGE_PRICE = 10;

/** Dedication pages are on unless the class explicitly turned them off. */
export const isDedicationEnabled = (classData: any): boolean =>
  classData?.dedicationPagesEnabled !== false;

/** Price (lei) of one dedication page for the class (default 10). */
export const dedicationPagePriceOf = (classData: any): number => {
  const raw = classData?.dedicationPagePrice;
  if (raw == null) return DEFAULT_DEDICATION_PAGE_PRICE;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, n) : DEFAULT_DEDICATION_PAGE_PRICE;
};

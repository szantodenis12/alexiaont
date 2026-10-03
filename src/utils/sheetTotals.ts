// Shared, pure helpers for computing row/grand totals on the class confirmation
// sheet (ClassSheetView) and the matching Excel export (excelExporter). Keeping
// this logic in one place guarantees the on-screen document, the print/PDF
// output and the Excel export always agree on the numbers.

/**
 * Tolerantly parses a money value coming from Firestore overrides, which may
 * already be a number, a numeric string ("50"), a string with a decimal comma
 * ("50,5"), a Romanian thousands-separated string ("1.200", "12.345.678"), a
 * string with a "lei" suffix ("50 lei", "2.500 lei"), or legacy free text
 * that was never meant to be a number ("X", "Y", "-", "nume greșit", "").
 * Always returns a finite number, never NaN.
 */
export function parseMoney(v: unknown): number {
  if (v === undefined || v === null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v !== 'string') return 0;

  const trimmed = v.trim();
  if (trimmed === '' || trimmed === '-') return 0;

  let cleaned = trimmed.replace(/lei/gi, '').trim().replace(/\s+/g, '');
  if (cleaned === '') return 0;

  if (cleaned.includes(',') && cleaned.includes('.')) {
    // Both separators present: Romanian convention is dot = thousands,
    // comma = decimal (e.g. "1.200,50" -> 1200.50).
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (cleaned.includes(',')) {
    // Decimal comma, Romanian-style (e.g. "50,5")
    cleaned = cleaned.replace(',', '.');
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    // No comma, but one or more dot-grouped sets of exactly 3 digits:
    // Romanian thousands separator (e.g. "1.200" -> 1200, "12.345.678" ->
    // 12345678). A dot followed by 1-2 digits is left alone below, since
    // that's a decimal point ("1.5" -> 1.5, "100.50" -> 100.50).
    cleaned = cleaned.replace(/\./g, '');
  }

  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : 0;
}

/**
 * When a legacy text override doesn't parse into a meaningful number (e.g. the
 * old "X"/"Y" placeholders, or a free-text GRESELI note like "nume greșit"),
 * this returns that original text so the UI can show it as a note/tooltip
 * instead of silently discarding it. Returns null when there's nothing worth
 * preserving (empty, dash, "0", or already-numeric text).
 */
export function getLegacyTextNote(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '-') return null;
  if (parseMoney(trimmed) !== 0) return null;
  if (/^0+([.,]0+)?$/.test(trimmed)) return null;
  return trimmed;
}

/** Minimal shape needed to know whether a custom column counts toward totals. */
export interface MoneyColumnLike {
  id: string;
  moneyType?: 'lei' | 'info';
}

/** Sums only the custom columns flagged as money ('lei') columns. */
export function sumMoneyCustomColumns(
  customColumns: MoneyColumnLike[],
  customValues: Record<string, string | number> | undefined
): number {
  return customColumns.reduce((sum, col) => {
    if (col.moneyType === 'lei') {
      return sum + parseMoney(customValues?.[col.id]);
    }
    return sum;
  }, 0);
}

/**
 * Computes a single row's TOTAL: the sum of its resolved money fields
 * (already-parsed numbers) plus any money-type custom column values.
 */
export function computeRowTotal(
  moneyFieldValues: number[],
  customColumns: MoneyColumnLike[],
  customValues: Record<string, string | number> | undefined
): number {
  const base = moneyFieldValues.reduce((sum, v) => sum + (Number.isFinite(v) ? v : 0), 0);
  return base + sumMoneyCustomColumns(customColumns, customValues);
}

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
 * Strictly parses a money value that doubles as a description field (like EXTRA).
 * Unlike parseMoney which tolerantly turns "2 tricouri" into 2, this only accepts
 * a value if the whole string (trimmed, after removing trailing "lei", case-insensitive)
 * is purely numeric in Romanian/plain format. If not, returns 0.
 *
 * Accepts: "10", "10 lei", "10,5", "1.200", "1.200,50", " 25 ", "-5", numeric values
 * Returns 0 for: "2 tricouri", "Da", "cană + tricou", "0", "", "-", any non-numeric text
 *
 * Used for EXTRA since it's both a money field and a description field.
 */
export function parseStrictMoney(v: unknown): number {
  if (v === undefined || v === null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v !== 'string') return 0;

  const trimmed = v.trim();
  if (trimmed === '' || trimmed === '-') return 0;

  // Remove trailing "lei" (case-insensitive) and trim again
  let cleaned = trimmed.replace(/lei\s*$/gi, '').trim();
  if (cleaned === '' || cleaned === '-') return 0;

  // Check if the string only contains digits, optional minus sign, comma, and dot
  // (Romanian numeric format). Remove spaces for this check but preserve original for parsing.
  const noSpaces = cleaned.replace(/\s+/g, '');

  // Pattern: optional minus sign, then only digits, commas and dots
  if (!/^-?[\d.,]+$/.test(noSpaces)) {
    return 0; // Contains non-numeric characters like letters
  }

  // Now use parseMoney on the original input to handle format variations
  return parseMoney(v);
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

/** Class prices needed to auto-fill a sheet row from a configurator submission. */
export interface SheetAutoPrices {
  priceMare: number;
  priceMic: number;
  pricePages: number;
  priceSonet: number;
  isSoneteEnabled: boolean;
}

/** Auto-filled (pre-override) values for one sheet row. */
export interface SheetAutoValues {
  albumCost: number;
  personalCost: number;
  dedicationCost: number;
  sonetCost: number;
  extraText: string;
}

/**
 * Derives a sheet row's automatic values from a configurator submission, using
 * exactly the same rules as the student rows (album price by type, extra pages
 * × page price, sonet price, extra items text). With no submission every value
 * is the neutral default (0 / '0'), so a row without a submission is unchanged.
 * Manual overrides are applied by the caller on top of these.
 */
export function autoSheetValuesFromSubmission(sub: any, prices: SheetAutoPrices): SheetAutoValues {
  if (!sub) {
    return { albumCost: 0, personalCost: 0, dedicationCost: 0, sonetCost: 0, extraText: '0' };
  }
  const albumCost = sub.selectedAlbumType === 'mic' ? prices.priceMic : prices.priceMare;
  const personalCost = (sub.extraPersonalPagesCount || 0) * prices.pricePages;
  const dedicationCost = (sub.extraDedicationPagesCount || 0) * prices.pricePages;
  const sonetCost = prices.isSoneteEnabled && (sub.wantsSonetPhoto || sub.wantsSonetCitat || sub.sonetPhoto)
    ? prices.priceSonet
    : 0;
  let extraText = '0';
  if (sub.extraItemsText && String(sub.extraItemsText).trim().length > 0) {
    extraText = String(sub.extraItemsText).trim();
  } else if (sub.wantsExtraItems) {
    extraText = 'Da';
  }
  return { albumCost, personalCost, dedicationCost, sonetCost, extraText };
}

/**
 * Case- and diacritics-insensitive matching used by the photo search boxes
 * (admin class gallery and the student photo picker). "ionescu" finds
 * "IONESCU_Ștefan.jpg", "stefan" finds "Ștefan", "IMG_12" finds "img_123".
 */
export const normalizeSearch = (value: string): string =>
  (value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/** `normalizedQuery` must already come out of `normalizeSearch`. */
export const matchesSearch = (text: string, normalizedQuery: string): boolean =>
  !normalizedQuery || normalizeSearch(text).includes(normalizedQuery);

const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Natural name compare ("2" before "10"), the same one the admin A–Z order uses. */
export const compareNames = (a: string, b: string): number => nameCollator.compare(a, b);

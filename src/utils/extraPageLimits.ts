// Default price (lei) of an extra personal page when the class has none stored.
// Client decision: 10 lei. Keep every fallback pointing here.
export const DEFAULT_EXTRA_PAGE_PRICE = 10;

// Client rule: personal extra pages + dedication pages together, per student.
export const MAX_TOTAL_EXTRA_PAGES = 20;

export interface ExtraPageLimits {
  /** Undefined = not set (the student form treats it as 1). */
  min?: number;
  /** Undefined = not set (no upper limit). */
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

// Validates the admin's "Poze pe pagina extra: minim / maxim" inputs. Empty =
// not set. Both must be whole numbers >= 1 and max >= min. Callers must only
// write defined fields (and deleteField() the empty ones on edit) — never
// undefined/NaN.
export const parseExtraPageLimits = (minRaw: string, maxRaw: string): ExtraPageLimits => {
  const min = parseOptionalInt(minRaw);
  const max = parseOptionalInt(maxRaw);
  if (min === 'invalid' || (typeof min === 'number' && min < 1)) {
    return { error: 'Minimul de poze pe pagina extra trebuie să fie un număr întreg de cel puțin 1.' };
  }
  if (max === 'invalid' || (typeof max === 'number' && max < 1)) {
    return { error: 'Maximul de poze pe pagina extra trebuie să fie un număr întreg de cel puțin 1.' };
  }
  if (typeof min === 'number' && typeof max === 'number' && max < min) {
    return { error: 'Maximul de poze pe pagina extra nu poate fi mai mic decât minimul.' };
  }
  return { min: min ?? undefined, max: max ?? undefined };
};

export interface ExtraPageGroup {
  /** 1-based page number, as the student sees it (empty pages keep their number). */
  page: number;
  photos: any[];
}

// Pages the student actually filled in: `submission.extraPages` is an array of
// `{ photos: Entry[] }` (Entry = same shape as a personal photo entry). Pages
// without photos are dropped so ZIPs/panels never show empty sections. Old
// submissions without `extraPages` yield [].
export const getExtraPageGroups = (sub: any): ExtraPageGroup[] => {
  if (!sub || !Array.isArray(sub.extraPages)) return [];
  const groups: ExtraPageGroup[] = [];
  sub.extraPages.forEach((pg: any, i: number) => {
    const photos = Array.isArray(pg?.photos) ? pg.photos.filter(Boolean) : [];
    if (photos.length > 0) groups.push({ page: i + 1, photos });
  });
  return groups;
};

/** Folder name used for an extra page in the ZIPs (client-requested wording). */
export const extraPageFolderName = (page: number): string => `Pagina extra ${page}`;

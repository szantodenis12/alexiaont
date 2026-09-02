/**
 * Interactive photo album (flipbook) — data model and layout templates.
 *
 * Reachable only through unlisted routes: the studio is not linked from the
 * admin dashboard, and a shared album is addressed by an unguessable token.
 */

/** A rectangle on the page, in percentages, so a page scales to any size. */
export interface SlotRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One photo placed in a layout slot. */
export interface PageSlot {
  /** Display copy (~1200px) — what the album renders. */
  previewUrl?: string;
  /** Full resolution, used when a viewer opens a page full-screen. */
  fullUrl?: string;
  /** Identifies the source photo so a slot can be re-matched later. */
  path?: string;
  name?: string;
  /** Focal point as percentages; lets the admin fix a bad crop. */
  focalX?: number;
  focalY?: number;
  /** 1 = cover the slot exactly; higher zooms in. */
  zoom?: number;
  /**
   * Half of a photo that runs across a facing pair of pages.
   *
   * The image is sized to cover the whole spread and offset so each page shows
   * its own half, which puts the cut exactly on the spine and makes the two
   * halves line up seamlessly when the book is open.
   */
  spreadHalf?: 'left' | 'right';
}

/** A text block on a page. */
export interface PageText {
  id: string;
  content: string;
  /** Position and width in page percentages. */
  x: number;
  y: number;
  w: number;
  /** Font size in design units (see PAGE_W); scales with the page. */
  size: number;
  color: string;
  align: 'left' | 'center' | 'right';
  font: 'serif' | 'sans' | 'script';
  weight: 400 | 600 | 700;
  italic?: boolean;
  /** Letter spacing in design units. */
  tracking?: number;
}

export interface FlipbookPage {
  id: string;
  layout: LayoutId;
  /** Indexed by layout slot; a hole is an empty slot. */
  slots: (PageSlot | null)[];
  texts: PageText[];
  bgColor?: string;
}

export interface FlipbookCover {
  imageUrl?: string;
  focalX?: number;
  focalY?: number;
  title: string;
  subtitle: string;
  bgColor: string;
  textColor: string;
  /** Typeface for the cover title; defaults to serif. */
  font?: PageText['font'];
  /** Title size in design units; defaults to 58. */
  titleSize?: number;
  /** How the cover treats its image. */
  style: 'full-bleed' | 'framed' | 'plain';
}

export type PageAspect = 'portrait' | 'square' | 'landscape';

/** A photo uploaded straight into an album, not drawn from a gallery. */
export interface UploadedPhoto {
  name: string;
  url: string;
  path: string;
}

export interface Flipbook {
  id: string;
  title: string;
  /**
   * Where photos come from. 'upload' means the album has no linked gallery and
   * is built entirely from photos uploaded into it.
   */
  sourceType: 'gallery' | 'class' | 'upload';
  sourceId: string;
  sourceName?: string;
  /** Photos uploaded directly into this album; usable alongside a gallery. */
  uploads?: UploadedPhoto[];
  /** Unguessable; the shared URL is /album/<shareToken>. */
  shareToken: string;
  published: boolean;
  pageAspect: PageAspect;
  cover: FlipbookCover;
  backCover: FlipbookCover;
  pages: FlipbookPage[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

/* ── Layout templates ────────────────────────────────────────────────────── */

export type LayoutId =
  | 'full'
  | 'single'
  | 'two-v'
  | 'two-h'
  | 'three-left'
  | 'quad'
  | 'photo-text'
  | 'text';

export interface PageLayout {
  id: LayoutId;
  name: string;
  slots: SlotRect[];
  /** Where a text block lands when first added to this layout. */
  textHome: { x: number; y: number; w: number };
}

const M = 7; // page margin, in percent

export const LAYOUTS: PageLayout[] = [
  {
    id: 'full',
    name: 'Foto complet',
    slots: [{ x: 0, y: 0, w: 100, h: 100 }],
    textHome: { x: 10, y: 78, w: 80 },
  },
  {
    id: 'single',
    name: 'O foto',
    slots: [{ x: M, y: M, w: 100 - M * 2, h: 100 - M * 2 }],
    textHome: { x: M, y: 100 - M - 12, w: 100 - M * 2 },
  },
  {
    id: 'two-v',
    name: 'Doua pe verticala',
    slots: [
      { x: M, y: M, w: (100 - M * 2 - 3) / 2, h: 100 - M * 2 },
      { x: M + (100 - M * 2 - 3) / 2 + 3, y: M, w: (100 - M * 2 - 3) / 2, h: 100 - M * 2 },
    ],
    textHome: { x: M, y: 100 - M - 10, w: 100 - M * 2 },
  },
  {
    id: 'two-h',
    name: 'Doua pe orizontala',
    slots: [
      { x: M, y: M, w: 100 - M * 2, h: (100 - M * 2 - 3) / 2 },
      { x: M, y: M + (100 - M * 2 - 3) / 2 + 3, w: 100 - M * 2, h: (100 - M * 2 - 3) / 2 },
    ],
    textHome: { x: M, y: 46, w: 100 - M * 2 },
  },
  {
    id: 'three-left',
    name: 'Una mare + doua',
    slots: [
      { x: M, y: M, w: (100 - M * 2) * 0.62, h: 100 - M * 2 },
      {
        x: M + (100 - M * 2) * 0.62 + 3,
        y: M,
        w: (100 - M * 2) * 0.38 - 3,
        h: (100 - M * 2 - 3) / 2,
      },
      {
        x: M + (100 - M * 2) * 0.62 + 3,
        y: M + (100 - M * 2 - 3) / 2 + 3,
        w: (100 - M * 2) * 0.38 - 3,
        h: (100 - M * 2 - 3) / 2,
      },
    ],
    textHome: { x: M, y: 100 - M - 10, w: 100 - M * 2 },
  },
  {
    id: 'quad',
    name: 'Patru',
    slots: [
      { x: M, y: M, w: (100 - M * 2 - 3) / 2, h: (100 - M * 2 - 3) / 2 },
      { x: M + (100 - M * 2 - 3) / 2 + 3, y: M, w: (100 - M * 2 - 3) / 2, h: (100 - M * 2 - 3) / 2 },
      { x: M, y: M + (100 - M * 2 - 3) / 2 + 3, w: (100 - M * 2 - 3) / 2, h: (100 - M * 2 - 3) / 2 },
      {
        x: M + (100 - M * 2 - 3) / 2 + 3,
        y: M + (100 - M * 2 - 3) / 2 + 3,
        w: (100 - M * 2 - 3) / 2,
        h: (100 - M * 2 - 3) / 2,
      },
    ],
    textHome: { x: M, y: 100 - M - 8, w: 100 - M * 2 },
  },
  {
    id: 'photo-text',
    name: 'Foto + text',
    slots: [{ x: M, y: M, w: 100 - M * 2, h: 62 }],
    textHome: { x: M + 4, y: 72, w: 100 - M * 2 - 8 },
  },
  {
    id: 'text',
    name: 'Doar text',
    slots: [],
    textHome: { x: 12, y: 38, w: 76 },
  },
];

export const layoutById = (id: LayoutId): PageLayout =>
  LAYOUTS.find(l => l.id === id) || LAYOUTS[1];

/* ── Page geometry ───────────────────────────────────────────────────────── */

/**
 * Real page dimensions, in pixels, as specified for print:
 *   portrait   756 x 945
 *   square     945 x 945
 *   landscape  945 x 756
 *
 * Pages are composed at these sizes and scaled to fit the screen, so what the
 * admin lays out matches the printed proportions exactly.
 */
export const PAGE_SIZES: Record<PageAspect, { w: number; h: number }> = {
  portrait: { w: 756, h: 945 },
  square: { w: 945, h: 945 },
  landscape: { w: 945, h: 756 },
};

export const pageWidth = (aspect: PageAspect): number => (PAGE_SIZES[aspect] ?? PAGE_SIZES.portrait).w;
export const pageHeight = (aspect: PageAspect): number => (PAGE_SIZES[aspect] ?? PAGE_SIZES.portrait).h;

/**
 * Reference width for text sizing. Text sizes are stored against this so a
 * caption keeps its relative size if the album format changes.
 */
export const PAGE_W = 800;

export const FONT_STACKS: Record<PageText['font'], string> = {
  serif: "'Cormorant Garamond', Georgia, 'Times New Roman', serif",
  sans: "'Outfit', system-ui, -apple-system, sans-serif",
  script: "'Great Vibes', 'Brush Script MT', cursive",
};

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/** Unguessable share token. Uses crypto when available. */
export function makeShareToken(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function blankPage(layout: LayoutId = 'single'): FlipbookPage {
  const def = layoutById(layout);
  return {
    id: makeId('pg'),
    layout,
    slots: new Array(def.slots.length).fill(null),
    texts: [],
  };
}

export function blankCover(title = '', subtitle = ''): FlipbookCover {
  return {
    title,
    subtitle,
    bgColor: '#14110F',
    textColor: '#F3EDE7',
    style: 'full-bleed',
  };
}

/**
 * Resize a page's slot array when its layout changes, keeping the photos that
 * still fit rather than clearing the page.
 */
export function relayoutPage(page: FlipbookPage, layout: LayoutId): FlipbookPage {
  const def = layoutById(layout);
  const slots: (PageSlot | null)[] = new Array(def.slots.length).fill(null);
  for (let i = 0; i < Math.min(slots.length, page.slots.length); i++) {
    slots[i] = page.slots[i];
  }
  return { ...page, layout, slots };
}

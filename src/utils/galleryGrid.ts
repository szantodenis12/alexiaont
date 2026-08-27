/**
 * Shared gallery grid layout.
 *
 * Both the public gallery (PhotoGalleryView) and the client selection page
 * (GallerySelector) render the same masonry. This module is the single
 * implementation so the two can never drift apart, and so per-folder grid
 * settings only have to be applied in one place.
 */
import { useEffect, useState } from 'react';

export type GridStyle = 'vertical' | 'horizontal';
export type ThumbnailSize = 'regular' | 'large';
export type GridSpacing = 'regular' | 'large';

export interface GridSettings {
  gridStyle: GridStyle;
  thumbnailSize: ThumbnailSize;
  gridSpacing: GridSpacing;
}

/** Reproduces the layout the galleries had before grid settings existed. */
export const DEFAULT_GRID_SETTINGS: GridSettings = {
  gridStyle: 'vertical',
  thumbnailSize: 'regular',
  gridSpacing: 'regular',
};

/**
 * Resolve the settings in force for one folder.
 *
 * Order: the folder's own override, then the gallery default, then the
 * pre-existing layout. A folder or gallery with nothing stored therefore
 * renders exactly as it did before grid settings existed.
 */
export function resolveGridSettings(
  folder?: { grid?: Partial<GridSettings> } | null,
  galleryDefaults?: Partial<GridSettings> | null
): GridSettings {
  return {
    gridStyle:
      folder?.grid?.gridStyle ?? galleryDefaults?.gridStyle ?? DEFAULT_GRID_SETTINGS.gridStyle,
    thumbnailSize:
      folder?.grid?.thumbnailSize ?? galleryDefaults?.thumbnailSize ?? DEFAULT_GRID_SETTINGS.thumbnailSize,
    gridSpacing:
      folder?.grid?.gridSpacing ?? galleryDefaults?.gridSpacing ?? DEFAULT_GRID_SETTINGS.gridSpacing,
  };
}

/** Minimum a photo must expose to be laid out. */
export interface LayoutPhoto {
  path: string;
  width?: number;
  height?: number;
}

/**
 * Column count for a viewport width.
 *
 * "large" is a modifier on the responsive ladder rather than a fixed number —
 * a fixed count would leave a phone trying to show five columns.
 */
export function columnsForWidth(
  viewportWidth: number,
  size: ThumbnailSize = 'regular'
): number {
  if (size === 'large') {
    if (viewportWidth > 1200) return 3;
    if (viewportWidth > 900) return 3;
    if (viewportWidth > 600) return 2;
    return 1;
  }
  if (viewportWidth > 1200) return 5;
  if (viewportWidth > 900) return 4;
  if (viewportWidth > 600) return 3;
  return 2;
}

/** Gap between photos. The "regular" values are the previous hardcoded ones. */
export function gapForColumns(
  columns: number,
  spacing: GridSpacing = 'regular'
): string {
  if (spacing === 'large') return columns > 2 ? '16px' : '10px';
  return columns > 2 ? '4px' : '3px';
}

/**
 * Aspect ratio (width / height) for a photo.
 *
 * Prefers the dimensions stored at upload; falls back to a measured ratio, then
 * to 4:3 for older photos that have neither.
 */
export function aspectOf(
  photo: LayoutPhoto,
  measured: Record<string, number> = {}
): number {
  if (photo.width && photo.height) return photo.width / photo.height;
  return measured[photo.path] || 4 / 3;
}

/**
 * Masonry: place each photo into whichever column is currently shortest,
 * estimating height from the aspect ratio at a column width of 1 unit.
 */
export function distributePhotos<T extends LayoutPhoto>(
  photos: T[],
  numCols: number,
  measured: Record<string, number> = {}
): T[][] {
  const safeCols = Math.max(1, numCols);
  const cols: T[][] = Array.from({ length: safeCols }, () => []);
  const colHeights: number[] = new Array(safeCols).fill(0);

  photos.forEach((photo) => {
    let shortest = 0;
    for (let c = 1; c < safeCols; c++) {
      if (colHeights[c] < colHeights[shortest]) shortest = c;
    }
    cols[shortest].push(photo);
    colHeights[shortest] += 1 / aspectOf(photo, measured);
  });

  return cols;
}

/**
 * Justified rows ("horizontal" style): greedily fill each row until the
 * accumulated aspect ratio reaches the target, then start a new one.
 *
 * Deliberately returns only the grouping, not pixel sizes. Rendering gives each
 * photo `flex-grow: aspect; flex-basis: 0` plus its own `aspect-ratio`, which
 * makes widths proportional to aspect and heights identical across the row —
 * so no container measurement or resize observation is needed.
 */
export function packJustifiedRows<T extends LayoutPhoto>(
  photos: T[],
  targetAspectSum: number,
  measured: Record<string, number> = {}
): T[][] {
  const rows: T[][] = [];
  let current: T[] = [];
  let aspectSum = 0;

  photos.forEach((photo) => {
    current.push(photo);
    aspectSum += aspectOf(photo, measured);
    if (aspectSum >= targetAspectSum) {
      rows.push(current);
      current = [];
      aspectSum = 0;
    }
  });

  // Trailing photos form a shorter final row rather than being stretched.
  if (current.length) rows.push(current);
  return rows;
}

/**
 * Target aspect sum per justified row, derived from the same responsive ladder
 * as the masonry so both styles feel consistent at every breakpoint.
 * 1.4 approximates the aspect of a typical landscape photo.
 */
export function targetRowAspect(columns: number): number {
  return Math.max(1.6, columns * 1.4);
}

/** Tracks the column count for the current viewport and thumbnail size. */
export function useResponsiveColumns(size: ThumbnailSize = 'regular'): number {
  const [columns, setColumns] = useState(() =>
    columnsForWidth(typeof window === 'undefined' ? 1400 : window.innerWidth, size)
  );

  useEffect(() => {
    const handleResize = () => setColumns(columnsForWidth(window.innerWidth, size));
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [size]);

  return columns;
}

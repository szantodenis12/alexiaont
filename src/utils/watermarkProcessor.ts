/**
 * Utility to optimize images and overlay watermark onto them using canvas before uploading.
 *
 * The geometry lives in `fitWithin` / `drawWatermark`, which touch no DOM, so the
 * upload Web Worker (imageDerivatives.worker.ts) draws exactly the same
 * watermark — same size, position, offset and opacity — as this function.
 */

export type WatermarkPlacement = 'center' | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'bottom-center' | 'tile' | null;

/** Output size for a source of width x height capped at maxDimension (aspect kept). */
export function fitWithin(width: number, height: number, maxDimension: number): { width: number; height: number } {
  if (width > maxDimension || height > maxDimension) {
    if (width > height) {
      height = Math.round((height * maxDimension) / width);
      width = maxDimension;
    } else {
      width = Math.round((width * maxDimension) / height);
      height = maxDimension;
    }
  }
  return { width, height };
}

/** Minimal 2D context surface shared by <canvas> and OffscreenCanvas. */
type Ctx2D = Pick<CanvasRenderingContext2D, 'save' | 'restore' | 'drawImage' | 'globalAlpha'>;

/**
 * Draws the watermark onto a canvas of width x height that already holds the
 * (resized) photo. `wmWidth`/`wmHeight` are the watermark's natural size.
 */
export function drawWatermark(
  ctx: Ctx2D,
  watermark: CanvasImageSource,
  wmNaturalWidth: number,
  wmNaturalHeight: number,
  width: number,
  height: number,
  position: WatermarkPlacement,
  offsetX: number = 0,
  offsetY: number = 0
): void {
  const padding = Math.max(width, height) * 0.02; // 2% padding based on optimized size

  if (position === 'tile') {
    // Draw a tiled grid pattern with lowered opacity
    ctx.save();
    ctx.globalAlpha = 0.25; // 25% opacity for tiles

    // Determine tile size: make each tile about 12% of the image width
    const tileWidth = width * 0.12;
    const scale = tileWidth / wmNaturalWidth;
    const tileHeight = wmNaturalHeight * scale;

    // Draw grid of tiles
    const cols = 4;
    const rows = 4;
    const xSpacing = width / cols;
    const ySpacing = height / rows;

    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        // Offset slightly to center the tiles in each grid cell
        const x = c * xSpacing + (xSpacing - tileWidth) / 2;
        const y = r * ySpacing + (ySpacing - tileHeight) / 2;
        ctx.drawImage(watermark, x, y, tileWidth, tileHeight);
      }
    }
    ctx.restore();
    return;
  }

  // Single watermark placement
  // Watermark width is 16% of the image width (minimum 80px, maximum 500px)
  let wWidth = width * 0.16;
  if (wWidth < 80) wWidth = Math.min(80, width);
  if (wWidth > 500) wWidth = 500;

  const scale = wWidth / wmNaturalWidth;
  const wHeight = wmNaturalHeight * scale;

  // Convert offset to pixels relative to watermark dimensions (each unit is 5% of watermark size)
  const shiftX = (offsetX || 0) * 0.05 * wWidth;
  const shiftY = (offsetY || 0) * 0.05 * wHeight;

  let x = padding;
  let y = padding;
  const activePos = position || 'bottom-right';

  switch (activePos) {
    case 'bottom-right':
      x = width - wWidth - padding - shiftX;
      y = height - wHeight - padding - shiftY;
      break;
    case 'bottom-left':
      x = padding + shiftX;
      y = height - wHeight - padding - shiftY;
      break;
    case 'bottom-center':
      x = (width - wWidth) / 2 + shiftX;
      y = height - wHeight - padding - shiftY;
      break;
    case 'top-right':
      x = width - wWidth - padding - shiftX;
      y = padding + shiftY;
      break;
    case 'top-left':
      x = padding + shiftX;
      y = padding + shiftY;
      break;
    case 'center':
      x = (width - wWidth) / 2 + shiftX;
      y = (height - wHeight) / 2 + shiftY;
      break;
  }

  ctx.save();
  ctx.globalAlpha = 0.45; // 45% opacity for subtle single placement
  ctx.drawImage(watermark, x, y, wWidth, wHeight);
  ctx.restore();
}

export async function applyWatermark(
  imageFile: File,
  watermarkUrl: string | null,
  position: WatermarkPlacement,
  offsetX: number = 0,
  offsetY: number = 0,
  maxDimension: number = 2048,
  quality: number = 0.82
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = URL.createObjectURL(imageFile);
    
    img.onload = async () => {
      try {
        // Calculate new dimensions keeping aspect ratio
        const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight, maxDimension);

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Could not get 2D canvas context');
        }
        
        // Configure high quality image smoothing
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Draw downscaled original image
        ctx.drawImage(img, 0, 0, width, height);
        
        // If watermark is provided, draw it
        if (watermarkUrl) {
          // Load watermark image
          const watermarkImg = new Image();
          watermarkImg.crossOrigin = 'anonymous'; // Avoid canvas tainting
          watermarkImg.src = watermarkUrl;
          
          await new Promise<void>((wResolve, wReject) => {
            watermarkImg.onload = () => wResolve();
            watermarkImg.onerror = (e) => wReject(new Error('Failed to load watermark image for processing: ' + e));
          });

          drawWatermark(ctx, watermarkImg, watermarkImg.naturalWidth, watermarkImg.naturalHeight, width, height, position, offsetX, offsetY);
        }
        
        // Export to high-performance web-optimized JPEG format
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Canvas toBlob returned null'));
            }
          },
          'image/jpeg',
          quality
        );
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(img.src);
      }
    };
    
    img.onerror = (e) => {
      URL.revokeObjectURL(img.src);
      reject(new Error('Failed to load original image file: ' + e));
    };
  });
}

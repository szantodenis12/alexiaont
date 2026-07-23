/**
 * Utility to optimize images and overlay watermark onto them using canvas before uploading.
 */
export async function applyWatermark(
  imageFile: File,
  watermarkUrl: string | null,
  position: 'center' | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'bottom-center' | 'tile' | null,
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
        let width = img.naturalWidth;
        let height = img.naturalHeight;
        
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

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
          
          const padding = Math.max(width, height) * 0.02; // 2% padding based on optimized size
          
          if (position === 'tile') {
            // Draw a tiled grid pattern with lowered opacity
            ctx.save();
            ctx.globalAlpha = 0.25; // 25% opacity for tiles
            
            // Determine tile size: make each tile about 12% of the image width
            const tileWidth = width * 0.12;
            const scale = tileWidth / watermarkImg.naturalWidth;
            const tileHeight = watermarkImg.naturalHeight * scale;
            
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
                ctx.drawImage(watermarkImg, x, y, tileWidth, tileHeight);
              }
            }
            ctx.restore();
          } else {
            // Single watermark placement
            // Watermark width is 16% of the image width (minimum 80px, maximum 500px)
            let wWidth = width * 0.16;
            if (wWidth < 80) wWidth = Math.min(80, width);
            if (wWidth > 500) wWidth = 500;
            
            const scale = wWidth / watermarkImg.naturalWidth;
            const wHeight = watermarkImg.naturalHeight * scale;
            
            // Convert percentage offset to pixels
            const shiftX = (offsetX || 0) * 0.01 * width;
            const shiftY = (offsetY || 0) * 0.01 * height;

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
            ctx.globalAlpha = 0.85; // High opacity for single placement
            ctx.drawImage(watermarkImg, x, y, wWidth, wHeight);
            ctx.restore();
          }
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

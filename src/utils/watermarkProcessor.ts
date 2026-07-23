/**
 * Utility to overlay watermark onto images using canvas before uploading.
 */
export async function applyWatermark(
  imageFile: File,
  watermarkUrl: string,
  position: 'center' | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'bottom-center' | 'tile'
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = URL.createObjectURL(imageFile);
    
    img.onload = async () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Could not get 2D canvas context');
        }
        
        // Draw original image
        ctx.drawImage(img, 0, 0);
        
        // Load watermark image
        const watermarkImg = new Image();
        watermarkImg.crossOrigin = 'anonymous'; // Avoid canvas tainting
        watermarkImg.src = watermarkUrl;
        
        await new Promise<void>((wResolve, wReject) => {
          watermarkImg.onload = () => wResolve();
          watermarkImg.onerror = (e) => wReject(new Error('Failed to load watermark image for processing: ' + e));
        });
        
        const padding = Math.max(img.naturalWidth, img.naturalHeight) * 0.02; // 2% padding
        
        if (position === 'tile') {
          // Draw a tiled grid pattern with lowered opacity
          ctx.save();
          ctx.globalAlpha = 0.25; // 25% opacity for tiles
          
          // Determine tile size: make each tile about 12% of the image width
          const tileWidth = img.naturalWidth * 0.12;
          const scale = tileWidth / watermarkImg.naturalWidth;
          const tileHeight = watermarkImg.naturalHeight * scale;
          
          // Draw grid of tiles
          const cols = 4;
          const rows = 4;
          const xSpacing = img.naturalWidth / cols;
          const ySpacing = img.naturalHeight / rows;
          
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
          // Watermark width is 16% of the image width (minimum 120px, maximum 600px unless image is tiny)
          let wWidth = img.naturalWidth * 0.16;
          if (wWidth < 80) wWidth = Math.min(80, img.naturalWidth);
          if (wWidth > 500) wWidth = 500;
          
          const scale = wWidth / watermarkImg.naturalWidth;
          const wHeight = watermarkImg.naturalHeight * scale;
          
          let x = padding;
          let y = padding;
          
          switch (position) {
            case 'bottom-right':
              x = img.naturalWidth - wWidth - padding;
              y = img.naturalHeight - wHeight - padding;
              break;
            case 'bottom-left':
              x = padding;
              y = img.naturalHeight - wHeight - padding;
              break;
            case 'bottom-center':
              x = (img.naturalWidth - wWidth) / 2;
              y = img.naturalHeight - wHeight - padding;
              break;
            case 'top-right':
              x = img.naturalWidth - wWidth - padding;
              y = padding;
              break;
            case 'top-left':
              x = padding;
              y = padding;
              break;
            case 'center':
              x = (img.naturalWidth - wWidth) / 2;
              y = (img.naturalHeight - wHeight) / 2;
              break;
          }
          
          ctx.save();
          ctx.globalAlpha = 0.85; // High opacity for single placement
          ctx.drawImage(watermarkImg, x, y, wWidth, wHeight);
          ctx.restore();
        }
        
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Canvas toBlob returned null'));
            }
          },
          'image/jpeg',
          0.90 // 90% quality JPEG
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

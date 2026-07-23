/**
 * Utility to process images on the client side using HTML5 Canvas.
 */

/**
 * Loads an image from a URL and returns an HTMLImageElement.
 * Enables crossOrigin requests to avoid canvas tainting.
 */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(new Error('Failed to load image for processing: ' + err));
    img.src = url;
  });
}

/**
 * Converts a given image URL into a Black & White (grayscale) image Blob.
 * Uses standard luminance formula: Y = 0.299R + 0.587G + 0.114B
 */
export async function convertToGrayscale(imageUrl: string, quality = 0.9): Promise<Blob> {
  const img = await loadImage(imageUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not get 2D context for image processing');
  }

  // Draw original image
  ctx.drawImage(img, 0, 0);

  // Get image pixels
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  // Apply luminance formula to make it black & white
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    
    // Standard luminance formula
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    
    data[i] = gray;     // Red
    data[i + 1] = gray; // Green
    data[i + 2] = gray; // Blue
    // Alpha data[i + 3] remains unchanged
  }

  // Put modified pixels back
  ctx.putImageData(imageData, 0, 0);

  // Convert to blob
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Canvas blob generation failed'));
        }
      },
      'image/jpeg',
      quality
    );
  });
}

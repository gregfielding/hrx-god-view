type CropArea = { x: number; y: number; width: number; height: number };

async function loadImage(imageSrc: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = imageSrc;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Failed to load image'));
  });
  return image;
}

export async function getCroppedBlobFromImageSrc(
  imageSrc: string,
  crop: CropArea,
  mimeType = 'image/jpeg',
  quality = 0.9,
): Promise<Blob> {
  const image = await loadImage(imageSrc);

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(crop.width));
  canvas.height = Math.max(1, Math.round(crop.height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');

  ctx.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (!b) reject(new Error('Failed to create cropped image'));
        else resolve(b);
      },
      mimeType,
      quality,
    );
  });
  return blob;
}

// Backward-compatible default export (data URL)
export default async function getCroppedImg(imageSrc: string, crop: CropArea) {
  const blob = await getCroppedBlobFromImageSrc(imageSrc, crop, 'image/jpeg', 0.9);
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read cropped image'));
    reader.readAsDataURL(blob);
  });
  return dataUrl;
}

/**
 * Convert HEIC/HEIF (common iPhone camera output) to JPEG in the browser before upload.
 * Document AI and many browsers handle JPEG reliably; HEIC often fails or won't preview.
 */

export function isHeicOrHeifFile(file: File): boolean {
  const t = (file.type || '').toLowerCase();
  const n = file.name.toLowerCase();
  return (
    t === 'image/heic' ||
    t === 'image/heif' ||
    n.endsWith('.heic') ||
    n.endsWith('.heif')
  );
}

/**
 * Returns a new JPEG `File` suitable for Storage + Document AI. Non-HEIC files are returned unchanged.
 */
export async function ensureJpegForUpload(file: File): Promise<File> {
  if (!isHeicOrHeifFile(file)) return file;

  const heic2any = (await import('heic2any')).default;
  const result = await heic2any({
    blob: file,
    toType: 'image/jpeg',
    quality: 0.92,
  });
  const blob = Array.isArray(result) ? result[0] : result;
  const base = file.name.replace(/\.(heic|heif)$/i, '').trim() || 'photo';
  const name = `${base}.jpg`;
  return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
}

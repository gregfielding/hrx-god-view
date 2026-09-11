/**
 * Client-side photo downscale before upload (2026-09-06).
 *
 * Why: the inline headshot uploader (`HeadshotGateCard`) sent the raw file
 * with a hard 5 MB cap — a phone photo or a large PNG was refused with
 * "Image must be smaller than 5MB" and never reached Storage (Greg's first
 * Claim Shift test). Every worker-photo path now shrinks to a ≤1280px JPEG
 * first, which also keeps the Vision verifier fast and the avatar cheap to
 * serve. Falls back to the original file when the browser can't decode it
 * (HEIC on some desktops) so the server-side pipeline still gets a chance.
 */

export interface DownscaleOptions {
  /** Longest edge after resize. */
  maxEdge?: number;
  /** JPEG quality 0..1. */
  quality?: number;
  /** Skip work when the file is already small enough (bytes). */
  skipBelowBytes?: number;
}

const DEFAULTS: Required<DownscaleOptions> = {
  maxEdge: 1280,
  quality: 0.88,
  skipBelowBytes: 600 * 1024,
};

async function decode(file: Blob): Promise<{ draw: CanvasImageSource; width: number; height: number; release: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      // imageOrientation honors EXIF rotation so phone photos don't come out sideways.
      // TS lib typings predate the 'from-image' value; browsers accept it.
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as unknown as ImageBitmapOptions);
      return { draw: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() };
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('image_decode_failed'));
      el.src = url;
    });
    return { draw: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

/**
 * Returns a JPEG blob no larger than `maxEdge` on its longest side, or the
 * original file when it is already small or cannot be decoded.
 */
export async function downscaleImage(file: File | Blob, options: DownscaleOptions = {}): Promise<Blob> {
  const opts = { ...DEFAULTS, ...options };
  const isJpeg = file.type === 'image/jpeg';
  if (isJpeg && file.size <= opts.skipBelowBytes) return file;

  let decoded: Awaited<ReturnType<typeof decode>>;
  try {
    decoded = await decode(file);
  } catch {
    return file;
  }
  try {
    const { width, height } = decoded;
    if (!width || !height) return file;
    const scale = Math.min(1, opts.maxEdge / Math.max(width, height));
    if (scale === 1 && isJpeg && file.size <= 2 * 1024 * 1024) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(decoded.draw, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', opts.quality));
    return blob && blob.size > 0 ? blob : file;
  } finally {
    decoded.release();
  }
}

import type { CertificationEvidenceFileRefV1 } from '../../shared/certifications/certificationRecord';

export type LegacyEvidenceInput = {
  fileUrl?: string | null;
  fileName?: string | null;
};

/**
 * Map legacy `users.certifications[]` file fields to canonical evidence refs.
 * Prefers `storagePath` derived from the download URL when parseable.
 */
export function extractEvidenceFiles(legacy: LegacyEvidenceInput): CertificationEvidenceFileRefV1[] {
  const url = typeof legacy.fileUrl === 'string' && legacy.fileUrl.trim() ? legacy.fileUrl.trim() : '';
  if (!url) return [];

  const storagePath = tryParseStoragePathFromDownloadUrl(url);
  return [
    {
      storagePath: storagePath ?? undefined,
      storageUrl: url,
      fileName: legacy.fileName ?? null,
    },
  ];
}

/**
 * Parses `.../o/<encodedPath>?...` from a Firebase Storage download URL.
 */
export function tryParseStoragePathFromDownloadUrl(fileUrl: string): string | null {
  try {
    const u = new URL(fileUrl);
    const idx = u.pathname.indexOf('/o/');
    if (idx === -1) return null;
    const encoded = u.pathname.slice(idx + 3);
    const path = decodeURIComponent(encoded.replace(/\+/g, ' '));
    return path || null;
  } catch {
    return null;
  }
}

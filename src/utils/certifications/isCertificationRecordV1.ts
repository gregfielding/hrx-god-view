import type { CertificationRecordV1 } from '../../shared/certifications/certificationRecord';

/** Lightweight guard for adapter + engine boundaries (Phase 1B+). */
export function isCertificationRecordV1(obj: unknown): obj is CertificationRecordV1 {
  if (obj === null || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return o.schemaVersion === 1 && typeof o.catalogEntryId === 'string';
}

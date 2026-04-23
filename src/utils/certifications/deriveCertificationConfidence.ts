import type { CertificationConfidence, CertificationEvaluationStatus } from '../../types/certifications/certificationEnums';
import type { CertificationRecordV1 } from '../../types/certifications/certificationRecord';

function evidenceCount(record: CertificationRecordV1 | null): number {
  if (!record?.evidenceFileRefs?.length) return 0;
  return record.evidenceFileRefs.filter((r) => typeof r?.storageUrl === 'string' && r.storageUrl.length > 0).length;
}

/**
 * Phase 1 confidence — architecture plan §15 + build spec §7 (no OCR fields yet).
 */
export function deriveCertificationConfidence(
  record: CertificationRecordV1 | null,
  status: CertificationEvaluationStatus,
): CertificationConfidence {
  if (
    status === 'missing' ||
    status === 'rejected' ||
    status === 'invalid' ||
    status === 'preferred_unmet' ||
    status === 'waived'
  ) {
    return status === 'waived' ? 'high' : 'low';
  }
  if (status === 'pending_review' || status === 'attested_only') return 'low';
  if (status === 'expired') return 'low';
  if (status === 'expiring_soon') return 'medium';

  if (status === 'approved') {
    const n = evidenceCount(record);
    if (n === 0) return 'low';
    if (record?.review?.status === 'approved') return 'high';
    if (record?.review?.status === 'not_required') return 'medium';
    return 'medium';
  }

  return 'low';
}

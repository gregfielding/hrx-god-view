import type { CertificationRecordStatus, CertificationReviewStatus } from '../../shared/certifications/certificationEnums';
import type { CertificationRecordV1 } from '../../shared/certifications/certificationRecord';
import { normalizeDateToISODateString } from '../../shared/certifications/normalizeDateToISODateString';

/**
 * Deterministic precedence for duplicate `catalogEntryId` rows (Phase 1C / readiness engine input).
 *
 * Order (best first):
 * 1. Canonical: `review.status === 'approved'` and `recordStatus === 'active'`
 * 2. Canonical: `recordStatus === 'pending_review'` OR `review.status === 'submitted'`
 * 3. Canonical: `recordStatus === 'draft'`
 * 4. Legacy: has `certificationRecordId` on legacy row
 * 5. Legacy: no id on legacy row
 *
 * Within the same tier: **not expired** (vs evaluation date UTC) beats expired.
 * Further tie-break: canonical by higher `updatedAt`; legacy by lower `legacyIndex` (stable).
 */
export type CanonicalRankInput = {
  kind: 'canonical';
  certificationRecordId: string;
  record: CertificationRecordV1;
  updatedAtMs: number;
};

export type LegacyRankInput = {
  kind: 'legacy';
  /** Index in `users.certifications[]` for deterministic ties */
  legacyIndex: number;
  certificationRecordId?: string;
  /** Normalized legacy expiration for valid-vs-expired sort */
  expirationDate?: string | null;
};

export type ChooseCertificationCandidate = CanonicalRankInput | LegacyRankInput;

function todayIsoUtc(): string {
  const d = new Date();
  return normalizeDateToISODateString(d) ?? '1970-01-01';
}

function isExpired(expirationDate: string | null | undefined, evaluationDateIso: string): boolean {
  const exp = expirationDate ?? null;
  if (!exp) return false;
  const n = normalizeDateToISODateString(exp);
  if (!n) return false;
  return n < evaluationDateIso;
}

/** Lower score = better (sort ascending). */
export function certificationCandidatePrimaryTier(
  c: ChooseCertificationCandidate,
): number {
  if (c.kind === 'legacy') {
    return c.certificationRecordId ? 4 : 5;
  }
  const { record } = c;
  const goodStanding =
    record.recordStatus === 'active' &&
    (record.review?.status === 'approved' || record.review?.status === 'not_required');
  if (goodStanding) return 1;
  const pending =
    record.recordStatus === 'pending_review' ||
    record.review?.status === 'submitted';
  if (pending) return 2;
  if (record.recordStatus === 'draft') return 3;
  return 4;
}

/** Secondary: 0 = not expired or no date, 1 = expired (worse). */
export function certificationCandidateExpiryRank(
  c: ChooseCertificationCandidate,
  evaluationDateIso: string,
): number {
  const exp =
    c.kind === 'canonical' ? c.record.expirationDate ?? null : c.expirationDate ?? null;
  if (isExpired(exp, evaluationDateIso)) return 1;
  return 0;
}

function compareCandidates(a: ChooseCertificationCandidate, b: ChooseCertificationCandidate, evaluationDateIso: string): number {
  const t1 = certificationCandidatePrimaryTier(a);
  const t2 = certificationCandidatePrimaryTier(b);
  if (t1 !== t2) return t1 - t2;

  const e1 = certificationCandidateExpiryRank(a, evaluationDateIso);
  const e2 = certificationCandidateExpiryRank(b, evaluationDateIso);
  if (e1 !== e2) return e1 - e2;

  if (a.kind === 'canonical' && b.kind === 'canonical') {
    if (a.updatedAtMs !== b.updatedAtMs) return b.updatedAtMs - a.updatedAtMs;
    return a.certificationRecordId.localeCompare(b.certificationRecordId);
  }
  if (a.kind === 'legacy' && b.kind === 'legacy') {
    return a.legacyIndex - b.legacyIndex;
  }
  if (a.kind === 'canonical' && b.kind === 'legacy') return -1;
  return 1;
}

export function chooseBestCertificationRecordForCatalogEntry(
  candidates: ChooseCertificationCandidate[],
  evaluationDateIso: string = todayIsoUtc(),
): { best: ChooseCertificationCandidate | null; duplicateCount: number } {
  const list = candidates.filter(Boolean);
  if (list.length === 0) return { best: null, duplicateCount: 0 };
  const sorted = [...list].sort((x, y) => compareCandidates(x, y, evaluationDateIso));
  return { best: sorted[0]!, duplicateCount: Math.max(0, list.length - 1) };
}

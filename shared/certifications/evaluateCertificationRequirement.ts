/**
 * Certification Readiness Engine — LOCKED
 *
 * This logic is the single source of truth for certification evaluation.
 * Do not introduce alternative logic paths elsewhere.
 *
 * Any changes must:
 * 1. Update tests in `evaluateCertificationRequirement.test.ts` (and dependents).
 * 2. Be reviewed against `certificationEnums.ts` (frozen contract).
 */

import { addDays, format, parseISO } from 'date-fns';

import type { CertificationConfidence, CertificationEvaluationStatus } from './certificationEnums';
import type { CertificationRecordV1 } from './certificationRecord';
import type { EvaluationContext, Phase1CertificationRequirement } from './certificationRequirement';
import { deriveCertificationConfidence } from './deriveCertificationConfidence';
import { normalizeDateToISODateString } from './normalizeDateToISODateString';

/** Build spec §7 — days ahead for expiring_soon. */
export const EXPIRING_SOON_DAYS = 30;

export type CertificationEvaluationResult = {
  status: CertificationEvaluationStatus;
  passesHardRequirement: boolean;
  passesSoftRequirement: boolean;
  blocking: boolean;
  severity: 'none' | 'warning' | 'blocking';
  reason: string;
  certificationRecordId?: string;
  confidence: CertificationConfidence;
};

function evidenceFilesCount(record: CertificationRecordV1): number {
  const refs = record.evidenceFileRefs ?? [];
  return refs.filter((r) => typeof r?.storageUrl === 'string' && r.storageUrl.trim().length > 0).length;
}

function policyRequiresUpload(policy: Phase1CertificationRequirement['evidencePolicy']): boolean {
  return policy === 'upload_required';
}

function isReviewPending(record: CertificationRecordV1): boolean {
  return (
    record.recordStatus === 'pending_review' ||
    record.review.status === 'submitted'
  );
}

function isReviewRejected(record: CertificationRecordV1): boolean {
  return record.recordStatus === 'rejected' || record.review.status === 'rejected';
}

function isReviewApprovedOrNotRequired(record: CertificationRecordV1): boolean {
  return record.review.status === 'approved' || record.review.status === 'not_required';
}

function pendingReviewBlocks(
  reviewPolicy: Phase1CertificationRequirement['reviewPolicy'],
  context: EvaluationContext,
): boolean {
  if (reviewPolicy === 'must_be_approved') return true;
  if (reviewPolicy === 'pending_ok_for_apply' && context === 'apply') return false;
  if (reviewPolicy === 'pending_ok_for_assignment' && context === 'assignment') return false;
  return true;
}

function passesHardForPendingReview(
  reviewPolicy: Phase1CertificationRequirement['reviewPolicy'],
  context: EvaluationContext,
): boolean {
  if (reviewPolicy === 'pending_ok_for_apply' && context === 'apply') return true;
  if (reviewPolicy === 'pending_ok_for_assignment' && context === 'assignment') return true;
  return false;
}

function isoAddDays(ymd: string, days: number): string {
  const base = parseISO(ymd);
  return format(addDays(base, days), 'yyyy-MM-dd');
}

function expirationState(
  expirationDate: string | null | undefined,
  todayISO: string,
  requirement: Phase1CertificationRequirement,
): { isExpired: boolean; isExpiringSoon: boolean } {
  const expNorm = expirationDate ? normalizeDateToISODateString(expirationDate) : null;

  if (!expNorm) {
    return { isExpired: false, isExpiringSoon: false };
  }

  const { expirationPolicy, gracePeriodDays } = requirement;

  if (expirationPolicy === 'must_be_valid') {
    const expired = expNorm < todayISO;
    const soonEnd = isoAddDays(todayISO, EXPIRING_SOON_DAYS);
    const expiringSoon = !expired && expNorm <= soonEnd && expNorm >= todayISO;
    return { isExpired: expired, isExpiringSoon: expiringSoon };
  }

  if (expirationPolicy === 'grace_days') {
    const grace = gracePeriodDays ?? 0;
    const graceEnd = grace > 0 ? isoAddDays(expNorm, grace) : expNorm;
    const expired = todayISO > graceEnd;
    const soonEnd = isoAddDays(todayISO, EXPIRING_SOON_DAYS);
    const expiringSoon = !expired && expNorm <= soonEnd && expNorm >= todayISO;
    return { isExpired: expired, isExpiringSoon: expiringSoon };
  }

  const expired = expNorm < todayISO;
  const soonEnd = isoAddDays(todayISO, EXPIRING_SOON_DAYS);
  const expiringSoon = !expired && expNorm <= soonEnd && expNorm >= todayISO;
  return { isExpired: expired, isExpiringSoon: expiringSoon };
}

function baseResult(
  partial: Omit<CertificationEvaluationResult, 'confidence'> & { record: CertificationRecordV1 | null },
): CertificationEvaluationResult {
  const { record, ...rest } = partial;
  return {
    ...rest,
    confidence: deriveCertificationConfidence(record, rest.status),
  };
}

type InnerResult = Omit<CertificationEvaluationResult, 'confidence'> & { record: CertificationRecordV1 | null };

/**
 * Pure certification readiness evaluation — **no record search / string matching**.
 * Caller supplies the single matching `CertificationRecordV1` or `null` for this `catalogEntryId`.
 */
export function evaluateCertificationRequirement(input: {
  requirement: Phase1CertificationRequirement;
  record: CertificationRecordV1 | null;
  /** Firestore doc id when known (batch / callers). */
  certificationRecordId?: string;
  context: EvaluationContext;
  todayISO: string;
}): CertificationEvaluationResult {
  const { requirement, record, context, todayISO, certificationRecordId: explicitId } = input;

  if (record && record.catalogEntryId !== requirement.catalogEntryId) {
    return baseResult({
      record,
      status: 'invalid',
      passesHardRequirement: false,
      passesSoftRequirement: false,
      blocking: requirement.scope === 'required',
      severity: requirement.scope === 'required' ? 'blocking' : 'warning',
      reason: 'catalog_entry_mismatch',
      certificationRecordId: explicitId,
    });
  }

  const inner: InnerResult =
    record == null
      ? evaluateRequiredWhenNoRecord(requirement, todayISO)
      : evaluateRequiredWithRecord(requirement, record, context, todayISO, explicitId);

  if (requirement.scope === 'preferred') {
    if (inner.status === 'approved' || inner.status === 'expiring_soon') {
      return baseResult({
        ...inner,
        record,
        passesHardRequirement: true,
        blocking: false,
        severity: inner.status === 'expiring_soon' ? 'warning' : 'none',
      });
    }
    return baseResult({
      record,
      status: 'preferred_unmet',
      passesHardRequirement: true,
      passesSoftRequirement: false,
      blocking: false,
      severity: 'none',
      reason: `preferred_unmet:${inner.status}:${inner.reason}`,
      certificationRecordId: inner.certificationRecordId,
    });
  }

  return baseResult({ ...inner, record });
}

function evaluateRequiredWhenNoRecord(
  _requirement: Phase1CertificationRequirement,
  _todayISO: string,
): InnerResult {
  return {
    record: null,
    status: 'missing',
    passesHardRequirement: false,
    passesSoftRequirement: false,
    blocking: true,
    severity: 'blocking',
    reason: 'no_record',
  };
}

function evaluateRequiredWithRecord(
  requirement: Phase1CertificationRequirement,
  record: CertificationRecordV1,
  context: EvaluationContext,
  todayISO: string,
  certificationRecordId: string | undefined,
): InnerResult {
  const rid = certificationRecordId;

  if (isReviewRejected(record)) {
    return {
      record,
      status: 'rejected',
      passesHardRequirement: false,
      passesSoftRequirement: false,
      blocking: true,
      severity: 'blocking',
      reason: 'review_rejected',
      certificationRecordId: rid,
    };
  }

  if (record.recordStatus === 'draft') {
    return {
      record,
      status: 'missing',
      passesHardRequirement: false,
      passesSoftRequirement: false,
      blocking: true,
      severity: 'blocking',
      reason: 'draft_incomplete',
      certificationRecordId: rid,
    };
  }

  if (record.recordStatus === 'superseded' || record.recordStatus === 'revoked') {
    return {
      record,
      status: 'missing',
      passesHardRequirement: false,
      passesSoftRequirement: false,
      blocking: true,
      severity: 'blocking',
      reason: 'record_not_usable',
      certificationRecordId: rid,
    };
  }

  const expNorm = normalizeDateToISODateString(record.expirationDate);
  const recordSaysExpired = record.recordStatus === 'expired';
  const { isExpired: policyExpired, isExpiringSoon } = expirationState(record.expirationDate, todayISO, requirement);
  const calendarExpired = expNorm ? expNorm < todayISO : false;

  const expiredOutcome =
    recordSaysExpired ||
    (requirement.expirationPolicy === 'must_be_valid' && policyExpired) ||
    (requirement.expirationPolicy === 'grace_days' && policyExpired) ||
    (requirement.expirationPolicy === 'warn_only' && calendarExpired);

  if (expiredOutcome) {
    const blocking = requirement.expirationPolicy !== 'warn_only';
    return {
      record,
      status: 'expired',
      passesHardRequirement: false,
      passesSoftRequirement: requirement.expirationPolicy === 'warn_only',
      blocking,
      severity: blocking ? 'blocking' : 'warning',
      reason: requirement.expirationPolicy === 'warn_only' ? 'expired_warn_only' : 'past_expiration',
      certificationRecordId: rid,
    };
  }

  if (isReviewPending(record) && !isReviewRejected(record)) {
    const blocks = pendingReviewBlocks(requirement.reviewPolicy, context);
    const passes = passesHardForPendingReview(requirement.reviewPolicy, context);
    return {
      record,
      status: 'pending_review',
      passesHardRequirement: passes,
      passesSoftRequirement: passes,
      blocking: blocks,
      severity: blocks ? 'blocking' : 'warning',
      reason: 'awaiting_review',
      certificationRecordId: rid,
    };
  }

  const uploads = evidenceFilesCount(record);
  if (policyRequiresUpload(requirement.evidencePolicy) && uploads === 0) {
    if (record.recordStatus === 'active' || isReviewApprovedOrNotRequired(record)) {
      return {
        record,
        status: 'attested_only',
        passesHardRequirement: false,
        passesSoftRequirement: true,
        blocking: true,
        severity: 'blocking',
        reason: 'upload_required_no_file',
        certificationRecordId: rid,
      };
    }
    return {
      record,
      status: 'pending_review',
      passesHardRequirement: passesHardForPendingReview(requirement.reviewPolicy, context),
      passesSoftRequirement: false,
      blocking: pendingReviewBlocks(requirement.reviewPolicy, context),
      severity: pendingReviewBlocks(requirement.reviewPolicy, context) ? 'blocking' : 'warning',
      reason: 'awaiting_upload_or_review',
      certificationRecordId: rid,
    };
  }

  if (!isReviewApprovedOrNotRequired(record)) {
    return {
      record,
      status: 'pending_review',
      passesHardRequirement: passesHardForPendingReview(requirement.reviewPolicy, context),
      passesSoftRequirement: false,
      blocking: pendingReviewBlocks(requirement.reviewPolicy, context),
      severity: pendingReviewBlocks(requirement.reviewPolicy, context) ? 'blocking' : 'warning',
      reason: 'review_not_approved',
      certificationRecordId: rid,
    };
  }

  if (!expNorm && requirement.expirationPolicy === 'must_be_valid') {
    return {
      record,
      status: 'expiring_soon',
      passesHardRequirement: true,
      passesSoftRequirement: true,
      blocking: false,
      severity: 'warning',
      reason: 'expiration_unknown_requires_attention',
      certificationRecordId: rid,
    };
  }

  if (expNorm && !calendarExpired && isExpiringSoon) {
    return {
      record,
      status: 'expiring_soon',
      passesHardRequirement: true,
      passesSoftRequirement: true,
      blocking: false,
      severity: 'warning',
      reason: `within_${EXPIRING_SOON_DAYS}_days`,
      certificationRecordId: rid,
    };
  }

  if (record.recordStatus === 'active' && isReviewApprovedOrNotRequired(record)) {
    return {
      record,
      status: 'approved',
      passesHardRequirement: true,
      passesSoftRequirement: true,
      blocking: false,
      severity: 'none',
      reason: 'approved_valid',
      certificationRecordId: rid,
    };
  }

  return {
    record,
    status: 'pending_review',
    passesHardRequirement: passesHardForPendingReview(requirement.reviewPolicy, context),
    passesSoftRequirement: false,
    blocking: pendingReviewBlocks(requirement.reviewPolicy, context),
    severity: 'warning',
    reason: 'unspecified_state',
    certificationRecordId: rid,
  };
}

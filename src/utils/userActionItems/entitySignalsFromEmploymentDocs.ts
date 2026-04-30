/**
 * Derives per-entity operational signals from `entity_employments` docs + assignments bucket.
 * Uses the same query results as `useUserProfileEntityEmploymentChips` — no extra reads.
 */
import type { EmploymentAssignmentSummary, EmploymentEntityKey } from '../../pages/UserProfile/components/employment-v2/employmentV2Types';
import type { EntityOnboardingSectionStatus } from '../../pages/UserProfile/components/employment-v2/employmentV2Types';
import {
  displayEntityLabelForOnboardingChip,
  type EntityEmploymentDocSnap,
} from '../userListEntityEmploymentStatus';

export type EntityEmploymentActionSignal = {
  dedupeKey: string;
  entityKey: string;
  entityLabel: string;
  /** Onboarding incomplete for this entity (coarse). */
  onboardingIncomplete: boolean;
  payrollIncomplete: boolean;
  i9Incomplete: boolean;
  everifyBucket: 'ok' | 'not_started' | 'pending' | 'action_required';
  assignments: EmploymentAssignmentSummary[];
  /**
   * Worker classification on this `entity_employments` row. Drives applicability
   * gates downstream — e.g. the `i9_incomplete` Action Item is suppressed for
   * `workerType === '1099'` because the canonical step matrix says contractors
   * have no I-9 (`docs/CANONICAL_ONBOARDING_STEP_MATRIX.md` §5; mirrored on the
   * server in `computeStepApplicability`). `null` when the field is absent;
   * rules should treat null as "unknown — apply the W-2 default" to stay safe.
   */
  workerType: 'w2' | '1099' | null;
};

function isSectionIncomplete(s: string | null | undefined): boolean {
  if (s == null) return true;
  const v = String(s).trim().toLowerCase();
  return v !== 'complete';
}

function everifyBucketFromDoc(d: Record<string, unknown>): EntityEmploymentActionSignal['everifyBucket'] {
  const required = d.everifyRequired === true;
  const raw = String(d.everifyStatus || '').trim().toLowerCase();
  if (!required && !raw) return 'ok';
  if (!raw || raw === 'not_started' || raw === 'none') return 'not_started';
  /** Matches readiness / ComplianceTab — completed in HRX or confirmed outside (no “in progress” action item). */
  if (raw === 'employment_authorized' || raw === 'manual_outside_hrx') return 'ok';
  if (raw.includes('action') || raw.includes('tnc') || raw.includes('refer') || raw === 'action_required') {
    return 'action_required';
  }
  if (raw.includes('pending') || raw.includes('progress') || raw.includes('submitted') || raw === 'in_progress') {
    return 'pending';
  }
  if (raw.includes('complete') || raw.includes('closed') || raw === 'verified') return 'ok';
  return 'pending';
}

export function buildEntityEmploymentActionSignals(
  snapDocs: EntityEmploymentDocSnap[],
  assignmentsByKey: Record<EmploymentEntityKey, EmploymentAssignmentSummary[]>,
): EntityEmploymentActionSignal[] {
  const byKey = (entityKeyRaw: string): EmploymentAssignmentSummary[] => {
    const k = entityKeyRaw.trim().toLowerCase();
    if (k === 'select' || k === 'workforce' || k === 'events') {
      return assignmentsByKey[k as EmploymentEntityKey] ?? [];
    }
    return [];
  };

  const out: EntityEmploymentActionSignal[] = [];

  snapDocs.forEach((docSnap) => {
    const d = docSnap.data() as Record<string, unknown>;
    const entityKeyRaw = String(d.entityKey || '').trim();
    if (!entityKeyRaw) return;
    const entityName = String(d.entityName || '').trim();
    const label = displayEntityLabelForOnboardingChip(entityKeyRaw, entityName);
    const dedupeKey = `entity:${entityKeyRaw.toLowerCase() || docSnap.id}`;

    const taxIdentity = d.taxIdentityStatus as EntityOnboardingSectionStatus | string | null | undefined;
    const payroll = d.payrollStatus as EntityOnboardingSectionStatus | string | null | undefined;
    const employmentState = String(d.employmentState || d.status || '').trim().toLowerCase();
    const onboardingComplete = d.onboardingComplete === true;
    const manualI9 = d.i9SupportingDocumentsManualCompleteAt != null;

    // RA.2 — defense-in-depth fallback for the per-section status fields.
    // The server-side mirror (`mirrorEvereeOnboardingCompleteToEmployments`)
    // now writes `payrollStatus: 'complete'` + `taxIdentityStatus: 'complete'`
    // on Everee onboarding completion, but legacy `entity_employments` rows
    // (and rows where the mirror failed mid-write — webhook 401s, etc.)
    // can still have stale `payrollStatus` while carrying the lifecycle
    // signals that say onboarding is done. Treat those signals as
    // authoritative when the explicit per-section status is missing or
    // not-complete: if Everee has reported completion (either via the
    // `evereeOnboardingStatus === 'complete'` mirror write or the
    // `payrollOnboardingCompletedAt` timestamp), the worker has already
    // finished payroll setup and the chip / Action Item should clear.
    // This closes Bug #2 in the action-items-readiness audit (RA.0).
    const evereeReportedComplete =
      String(d.evereeOnboardingStatus || '').trim().toLowerCase() === 'complete' ||
      d.payrollOnboardingCompletedAt != null;

    const i9Incomplete =
      !manualI9 && !evereeReportedComplete && isSectionIncomplete(taxIdentity as string);
    const payrollIncomplete =
      !evereeReportedComplete && isSectionIncomplete(payroll as string);

    const onboardingIncomplete =
      !onboardingComplete &&
      (employmentState === 'onboarding' ||
        i9Incomplete ||
        payrollIncomplete ||
        everifyBucketFromDoc(d) !== 'ok');

    const ev = everifyBucketFromDoc(d);

    // RA.1 — surface `workerType` so downstream rules can gate entity-specific
    // applicability (e.g. 1099 contractors have no I-9; the rule layer skips
    // emitting `i9_incomplete` based on this field). Falls back to `null` when
    // the field is missing on the doc — rules treat null as "unknown" and
    // apply the W-2 default.
    const workerTypeRaw = String(d.workerType || '').trim().toLowerCase();
    const workerType: 'w2' | '1099' | null =
      workerTypeRaw === '1099' ? '1099' : workerTypeRaw === 'w2' ? 'w2' : null;

    out.push({
      dedupeKey,
      entityKey: entityKeyRaw,
      entityLabel: label,
      onboardingIncomplete,
      payrollIncomplete,
      i9Incomplete,
      everifyBucket: ev,
      assignments: byKey(entityKeyRaw),
      workerType,
    });
  });

  return out;
}

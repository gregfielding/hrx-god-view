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

    const i9Incomplete = !manualI9 && isSectionIncomplete(taxIdentity as string);
    const payrollIncomplete = isSectionIncomplete(payroll as string);

    const onboardingIncomplete =
      !onboardingComplete &&
      (employmentState === 'onboarding' ||
        i9Incomplete ||
        payrollIncomplete ||
        everifyBucketFromDoc(d) !== 'ok');

    const ev = everifyBucketFromDoc(d);

    out.push({
      dedupeKey,
      entityKey: entityKeyRaw,
      entityLabel: label,
      onboardingIncomplete,
      payrollIncomplete,
      i9Incomplete,
      everifyBucket: ev,
      assignments: byKey(entityKeyRaw),
    });
  });

  return out;
}

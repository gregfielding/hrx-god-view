/**
 * Recruiter Employment path UI helpers — presentation only (does not change path building or blockers source).
 */
import type {
  EmploymentBlockerItem,
  EmploymentOnboardingRow,
} from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import type { ExternalOnboardingStepKey, ExternalOnboardingStepRecord } from '../types/externalOnboardingSteps';
import { EXTERNAL_ONBOARDING_STEP_LABELS, getExternalOnboardingStepDefinition } from '../types/externalOnboardingSteps';
import {
  isExternalOnboardingStepVerifiedComplete,
  mapExternalOnboardingStepToPathStatus,
} from './externalOnboardingSteps';
import { isOnboardingPathRowBlocker, isOnboardingPathRowDone } from './employmentOnboardingPath';

export interface MergedPathRow {
  row: EmploymentOnboardingRow;
  /** Source rows collapsed into `row` (same externalStepKey); for activity timeline merge. */
  mergedSources: EmploymentOnboardingRow[];
}

const STATUS_RANK: Record<string, number> = {
  error: 5,
  not_started: 2,
  in_progress: 3,
  completed: 1,
  satisfied_by_existing_record: 1,
  not_required: 0,
};

function rowStatusRank(r: EmploymentOnboardingRow): number {
  const base = STATUS_RANK[r.status] ?? 0;
  const blocker = isOnboardingPathRowBlocker(r) ? 10 : 0;
  return base + blocker;
}

function pickRepresentativeRow(group: EmploymentOnboardingRow[]): EmploymentOnboardingRow {
  const sorted = [...group].sort((a, b) => rowStatusRank(b) - rowStatusRank(a));
  return sorted[0];
}

function mergeExternalGroup(group: EmploymentOnboardingRow[], externalKey: ExternalOnboardingStepKey): EmploymentOnboardingRow {
  const rep = pickRepresentativeRow(group);
  const label =
    EXTERNAL_ONBOARDING_STEP_LABELS[externalKey] ||
    getExternalOnboardingStepDefinition(externalKey)?.displayLabel ||
    rep.label;

  const required = group.some((r) => r.required);
  const blocking = group.some((r) => r.blocking);
  const anyDone = group.some((r) => isOnboardingPathRowDone(r.status));
  const anyError = group.some((r) => r.status === 'error');

  let status = rep.status;
  let statusLabel = rep.statusLabel;
  if (anyError) {
    const err = group.find((r) => r.status === 'error');
    if (err) {
      status = err.status;
      statusLabel = err.statusLabel;
    }
  } else if (anyDone && group.every((r) => isOnboardingPathRowDone(r.status))) {
    const done = group.find((r) => r.status === 'completed') || group.find((r) => r.status === 'satisfied_by_existing_record');
    if (done) {
      status = done.status;
      statusLabel = done.statusLabel;
    }
  }

  const satisfied = group.find((r) => r.satisfiedByArtifact);
  const artifactFields = satisfied
    ? {
        satisfiedByArtifact: satisfied.satisfiedByArtifact,
        artifactSourceType: satisfied.artifactSourceType,
        artifactId: satisfied.artifactId,
        artifactCompletedAt: satisfied.artifactCompletedAt,
        artifactScope: satisfied.artifactScope,
      }
    : {};

  const actionableBy =
    externalKey === 'payroll_onboarding' ? ('either' as const) : rep.actionableBy;

  return {
    ...rep,
    rowId: `merged_ext__${rep.entityKey}__${externalKey}`,
    stepKey: rep.stepKey,
    label,
    actionableBy,
    sourceRef: {
      ...rep.sourceRef,
      externalStepKey: externalKey,
      requirementKey: externalKey,
    },
    required,
    blocking,
    status,
    statusLabel,
    ...artifactFields,
    helperText: rep.helperText,
    narrative: rep.narrative,
    lastUpdatedAt: group.reduce<string | null>((best, r) => {
      if (!r.lastUpdatedAt) return best;
      if (!best) return r.lastUpdatedAt;
      return r.lastUpdatedAt > best ? r.lastUpdatedAt : best;
    }, null),
  };
}

/**
 * Collapse Settings workflow rows that share the same TempWorks / external business key (e.g. w4_sent + w4_completed).
 */
export function mergeOnboardingPathRowsByExternalStepKey(rows: EmploymentOnboardingRow[]): MergedPathRow[] {
  const byExt = new Map<string, EmploymentOnboardingRow[]>();
  const rest: EmploymentOnboardingRow[] = [];

  for (const r of rows) {
    const k = r.sourceRef?.externalStepKey;
    if (k && typeof k === 'string') {
      if (!byExt.has(k)) byExt.set(k, []);
      byExt.get(k)!.push(r);
    } else {
      rest.push(r);
    }
  }

  const merged: MergedPathRow[] = rest.map((row) => ({ row, mergedSources: [row] }));

  for (const [extKey, group] of byExt) {
    if (group.length <= 1) {
      merged.push({ row: group[0], mergedSources: group });
      continue;
    }
    merged.push({
      row: mergeExternalGroup(group, extKey as ExternalOnboardingStepKey),
      mergedSources: group,
    });
  }

  const order = new Map(rows.map((r, i) => [r.rowId, i]));
  merged.sort((a, b) => {
    const ia = Math.min(...a.mergedSources.map((r) => order.get(r.rowId) ?? 9999));
    const ib = Math.min(...b.mergedSources.map((r) => order.get(r.rowId) ?? 9999));
    return ia - ib;
  });

  return merged;
}

/** Simplified recruiter-facing status for external (TempWorks) steps from Firestore record. */
export function recruiterExternalStepChip(
  record: ExternalOnboardingStepRecord | undefined,
  audience: 'admin' | 'worker' = 'admin'
): { label: string; tone: 'default' | 'info' | 'warning' | 'success' | 'error' } {
  if (!record) {
    return { label: 'Pending verification', tone: 'warning' };
  }

  if (record.status === 'error') {
    return { label: 'Needs attention', tone: 'error' };
  }

  if (record.status === 'completed' && isExternalOnboardingStepVerifiedComplete(record)) {
    return { label: 'Verified', tone: 'success' };
  }

  if (record.status === 'invite_sent') {
    return { label: 'Pending worker', tone: 'info' };
  }

  if (record.status === 'worker_completed_external' || record.status === 'pending_admin_verification') {
    return { label: 'Pending verification', tone: 'warning' };
  }

  if (record.status === 'completed' && !isExternalOnboardingStepVerifiedComplete(record)) {
    return { label: 'Pending verification', tone: 'warning' };
  }

  const mapped = mapExternalOnboardingStepToPathStatus(record, audience);
  if (mapped.status === 'not_started') {
    return { label: 'Pending worker', tone: 'default' };
  }
  return { label: mapped.statusLabel, tone: 'default' };
}

export function categorizeBlockersForHeader(blockers: EmploymentBlockerItem[]): {
  pendingWorker: number;
  pendingRecruiter: number;
  pendingVendor: number;
} {
  let pendingWorker = 0;
  let pendingRecruiter = 0;
  let pendingVendor = 0;
  for (const b of blockers) {
    if (b.owner === 'worker') pendingWorker += 1;
    else if (b.owner === 'recruiter') pendingRecruiter += 1;
    else if (b.owner === 'vendor') pendingVendor += 1;
    else if (b.owner === 'system') pendingVendor += 1;
  }
  return { pendingWorker, pendingRecruiter, pendingVendor };
}

export const TEMPWORKS_WIRING_HINT =
  'TempWorks is not wired into HRX by API — confirm work in TempWorks, then mark complete on this card when done.';

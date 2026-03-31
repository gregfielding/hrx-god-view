import type { EmploymentOnboardingRowStatus } from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import {
  EXTERNAL_ONBOARDING_STEP_KEYS,
  EXTERNAL_ONBOARDING_STEP_LABELS,
  EXTERNAL_ONBOARDING_STEP_VERIFICATION_UI_KEYS,
  LEGACY_EXTERNAL_ONBOARDING_STEP_KEY_ALIASES,
  WORKFLOW_STEP_TO_EXTERNAL_STEP_KEY,
  getExternalOnboardingStepDefinition,
  type ExternalOnboardingSource,
  type ExternalOnboardingStepKey,
  type ExternalOnboardingStepRecord,
  type ExternalOnboardingStepStatus,
  type ExternalOnboardingStepsState,
} from '../types/externalOnboardingSteps';

const VALID_SOURCES = new Set<ExternalOnboardingSource>(['tempworks']);

const VALID_STATUS = new Set<ExternalOnboardingStepStatus>([
  'not_started',
  'invite_sent',
  'worker_completed_external',
  'pending_admin_verification',
  'completed',
  'error',
]);

function tsToIso(v: unknown): string | null {
  if (v == null) return null;
  if (typeof (v as { toDate?: () => Date }).toDate === 'function') {
    const d = (v as { toDate: () => Date }).toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
  }
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  return null;
}

function isStepKey(k: string): k is ExternalOnboardingStepKey {
  return (EXTERNAL_ONBOARDING_STEP_KEYS as readonly string[]).includes(k);
}

function resolveCanonicalExternalStepKey(rawKey: string): ExternalOnboardingStepKey | null {
  if (isStepKey(rawKey)) return rawKey;
  const mapped = LEGACY_EXTERNAL_ONBOARDING_STEP_KEY_ALIASES[rawKey];
  return mapped ?? null;
}

function coerceRecord(raw: unknown): ExternalOnboardingStepRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const status = o.status;
  const externalSource = o.externalSource;
  if (typeof status !== 'string' || !VALID_STATUS.has(status as ExternalOnboardingStepStatus)) return null;
  if (typeof externalSource !== 'string' || !VALID_SOURCES.has(externalSource as ExternalOnboardingSource)) {
    return null;
  }
  return {
    status: status as ExternalOnboardingStepStatus,
    externalSource: externalSource as ExternalOnboardingSource,
    inviteSentAt: o.inviteSentAt,
    workerMarkedCompleteAt: o.workerMarkedCompleteAt,
    verifiedBy: typeof o.verifiedBy === 'string' ? o.verifiedBy : undefined,
    verifiedAt: o.verifiedAt,
    verificationNote: typeof o.verificationNote === 'string' ? o.verificationNote : undefined,
    correctionRequestedAt: o.correctionRequestedAt,
    updatedAt: o.updatedAt,
    updatedBy: typeof o.updatedBy === 'string' ? o.updatedBy : undefined,
  };
}

/**
 * Normalizes Firestore/map input to a typed state object (drops invalid keys/rows).
 */
export function parseExternalOnboardingSteps(raw: unknown): ExternalOnboardingStepsState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: ExternalOnboardingStepsState = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const canon = resolveCanonicalExternalStepKey(k);
    if (!canon) continue;
    const row = coerceRecord(v);
    if (row) out[canon] = row;
  }
  return Object.keys(out).length ? out : undefined;
}

export function externalStepKeyForWorkflowStep(workflowStepId: string): ExternalOnboardingStepKey | undefined {
  const k = WORKFLOW_STEP_TO_EXTERNAL_STEP_KEY[workflowStepId];
  return k;
}

function hasCorrectionReturn(record: ExternalOnboardingStepRecord): boolean {
  return record.status === 'invite_sent' && record.correctionRequestedAt != null;
}

/** `completed` in Firestore only counts as done in HRX when C1 verification wrote `verifiedAt`. */
export function isExternalOnboardingStepVerifiedComplete(record: ExternalOnboardingStepRecord): boolean {
  if (record.status !== 'completed') return false;
  return tsToIso(record.verifiedAt) != null;
}

/**
 * Maps external lifecycle → Employment V2 path row status + label.
 * Worker UI: pass `pathLabelAudience: 'worker'` into `buildOnboardingPathFromSettings`, or call this with `'worker'`.
 */
export function mapExternalOnboardingStepToPathStatus(
  record: ExternalOnboardingStepRecord,
  audience: 'admin' | 'worker' = 'admin'
): {
  status: EmploymentOnboardingRowStatus;
  statusLabel: string;
} {
  if (hasCorrectionReturn(record)) {
    return audience === 'worker'
      ? { status: 'in_progress', statusLabel: 'Your hiring team sent this back for updates' }
      : { status: 'in_progress', statusLabel: 'Returned for correction — waiting on worker' };
  }

  switch (record.status) {
    case 'completed':
      if (!isExternalOnboardingStepVerifiedComplete(record)) {
        return audience === 'worker'
          ? { status: 'in_progress', statusLabel: 'Submitted — waiting on your hiring team' }
          : { status: 'in_progress', statusLabel: 'Verification pending in HRX' };
      }
      return { status: 'completed', statusLabel: 'Completed' };
    case 'error':
      return audience === 'worker'
        ? { status: 'error', statusLabel: 'Your hiring team is reviewing this step' }
        : { status: 'error', statusLabel: 'Marked for review' };
    case 'pending_admin_verification':
      return audience === 'worker'
        ? { status: 'in_progress', statusLabel: 'Submitted — waiting on your hiring team' }
        : { status: 'in_progress', statusLabel: 'Completed in TempWorks — pending C1 verification' };
    case 'worker_completed_external':
      return audience === 'worker'
        ? { status: 'in_progress', statusLabel: 'Submitted — waiting on your hiring team' }
        : { status: 'in_progress', statusLabel: 'Completed in TempWorks — verify in HRX' };
    case 'invite_sent':
      return audience === 'worker'
        ? { status: 'in_progress', statusLabel: 'Complete this in TempWorks' }
        : { status: 'in_progress', statusLabel: 'Invite sent' };
    case 'not_started':
    default:
      return { status: 'not_started', statusLabel: 'Not started' };
  }
}

export function isExternalOnboardingStepVerificationUiKey(key: string): key is ExternalOnboardingStepKey {
  return (EXTERNAL_ONBOARDING_STEP_VERIFICATION_UI_KEYS as readonly string[]).includes(key);
}

/** Local timestamp for “Verified by C1 Staffing on …” (and similar). */
export function formatExternalOnboardingLocalTimestamp(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** When C1 marked a TempWorks-linked step complete in HRX (`verifiedAt` on the external step record). */
export function formatVerifiedAtDisplayForExternalRecord(
  record: ExternalOnboardingStepRecord | undefined
): string | null {
  if (!record?.verifiedAt) return null;
  return formatExternalOnboardingLocalTimestamp(tsToIso(record.verifiedAt));
}

export function lastUpdatedIsoForExternalStep(record: ExternalOnboardingStepRecord): string | null {
  return (
    tsToIso(record.verifiedAt) ??
    tsToIso(record.workerMarkedCompleteAt) ??
    tsToIso(record.correctionRequestedAt) ??
    tsToIso(record.inviteSentAt) ??
    tsToIso(record.updatedAt)
  );
}

export function externalStepLabel(key: ExternalOnboardingStepKey): string {
  return EXTERNAL_ONBOARDING_STEP_LABELS[key] ?? key;
}

/**
 * Normalized worker type for TempWorks `externalOnboardingSteps` gating only.
 * `unknown` = unresolved / unrecognized — only `appliesTo: 'both'` external steps may apply (conservative).
 */
export type ExternalOnboardingWorkerTypeNorm = 'w2' | '1099' | 'both' | 'unknown';

/**
 * Normalize a single raw worker-type string for TempWorks gating. For entity + employment precedence, use
 * `resolveEffectiveEmploymentWorkerType` in `employmentWorkerTypeResolution.ts` and pass `rawEffective` here
 * (or use `effective.normalizedExternal` directly).
 */
export function normalizeWorkerTypeForExternalSteps(raw: string | null | undefined): ExternalOnboardingWorkerTypeNorm {
  const s = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/-/g, '');
  if (!s) return 'unknown';
  if (s.includes('BOTH')) return 'both';
  if (s === '1099' || s === 'IC') return '1099';
  if (s === 'W2' || s === 'EMPLOYEE') return 'w2';
  return 'unknown';
}

/**
 * Whether an external step may be used as the status source for the current normalized worker type.
 * Uses `EXTERNAL_ONBOARDING_STEP_CATALOG` as the applicability source of truth.
 */
export function externalStepAppliesToWorkerType(
  stepKey: ExternalOnboardingStepKey,
  normalizedWorkerType: ExternalOnboardingWorkerTypeNorm
): boolean {
  const def = getExternalOnboardingStepDefinition(stepKey);
  if (!def) return false;
  if (def.appliesTo === 'both') return true;
  if (normalizedWorkerType === 'unknown') return false;
  if (normalizedWorkerType === 'both') return true;
  return def.appliesTo === normalizedWorkerType;
}

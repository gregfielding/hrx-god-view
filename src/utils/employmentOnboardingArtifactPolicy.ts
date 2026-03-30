/**
 * Compliance artifact reuse policy (frontend heuristics only).
 *
 * Distinguishes:
 * - Requirement rows: tied to entity / assignment / current onboarding flow
 * - Compliance artifacts: portable completed records (background checks, E-Verify cases, …)
 * - Satisfaction: a requirement may be met by an artifact without a new in-flow completion
 *
 * This is not a backend policy engine. Rules below are approximations until
 * tenant policy + equivalency metadata exist in Firestore.
 */

import type {
  EmploymentEverifySummary,
  EmploymentEntityKey,
  EmploymentOnboardingArtifactScope,
  PipelineStepRow,
} from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import type { BackgroundCheckRecord } from '../types/backgroundCheck';

/** Gaps that block fully automated, policy-correct reuse (for product/docs). */
export const COMPLIANCE_ARTIFACT_DATA_GAPS: readonly string[] = [
  'No tenant-level policy document for background package equivalency (e.g. which packageIds satisfy which requirements).',
  'BackgroundCheckRecord has no explicit expiration / “still valid until” for reuse across entities.',
  'No link from onboarding_instances.requirement to a specific backgroundCheckId that must be satisfied vs any completed check.',
  'E-Verify cases are not explicitly marked “reusable for all Select placements” vs “one-shot per assignment”; reuse is inferred from latest case + Select entityId.',
  'Cross-entity visibility of artifacts may need RBAC rules beyond current Employment V2 reads.',
  'Drug screen is not a separate Settings workflow key; drug_screen pipeline step is not wired in this mapping.',
  'Payroll / document rows can carry artifactSourceType payroll | document in the row model, but reuse heuristics are not wired yet (no portable payroll “receipt” or signed doc id promoted to artifact).',
];

export interface PortableBackgroundArtifact {
  record: BackgroundCheckRecord;
  scope: EmploymentOnboardingArtifactScope;
  /** Human-readable policy / heuristic explanation for helperText. */
  policyNote: string;
}

function tsIso(t: unknown): string | null {
  if (t == null) return null;
  if (typeof t === 'object' && t !== null && 'toDate' in t && typeof (t as { toDate: () => Date }).toDate === 'function') {
    const d = (t as { toDate: () => Date }).toDate();
    if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (typeof t === 'object' && t !== null && 'seconds' in t) {
    const sec = (t as { seconds: number }).seconds;
    if (typeof sec === 'number') return new Date(sec * 1000).toISOString();
  }
  return null;
}

const TERMINAL_BG = new Set(['completed', 'canceled', 'error']);

/**
 * Background check reuse (conceptual):
 * - Prefer orders linked to this entity’s job orders → “in this flow” (row status: completed).
 * - If this entity has no completed linked order, but the worker has another tenant completed order,
 *   treat as a portable artifact (worker_global) for UI purposes.
 *
 * Equivalency v1: same tenant + same candidate + hrxStatus completed. Package / recency parity not enforced.
 */
export function findPortableBackgroundArtifact(args: {
  entityLinkedJobOrderIds: Set<string>;
  allTenantWorkerChecks: BackgroundCheckRecord[];
}): PortableBackgroundArtifact | null {
  const { entityLinkedJobOrderIds, allTenantWorkerChecks } = args;
  const linked = allTenantWorkerChecks.filter(
    (c) => c.jobOrderId && entityLinkedJobOrderIds.has(String(c.jobOrderId))
  );
  const linkedAllCompleted =
    linked.length > 0 && linked.every((c) => String(c.hrxStatus || '').toLowerCase() === 'completed');
  if (linkedAllCompleted) {
    return null;
  }
  const hasLinkedOpen = linked.some((c) => !TERMINAL_BG.has(String(c.hrxStatus || '').toLowerCase()));
  if (hasLinkedOpen) {
    return null;
  }

  const completedElsewhere = allTenantWorkerChecks.filter((c) => {
    if (String(c.hrxStatus || '').toLowerCase() !== 'completed') return false;
    const jo = c.jobOrderId ? String(c.jobOrderId) : '';
    if (!jo) return true;
    return !entityLinkedJobOrderIds.has(jo);
  });
  if (completedElsewhere.length === 0) return null;

  const latest = [...completedElsewhere].sort((a, b) => {
    const ta = tsIso(a.updatedAt) || '';
    const tb = tsIso(b.updatedAt) || '';
    return tb.localeCompare(ta);
  })[0];

  return {
    record: latest,
    scope: 'worker_global',
    policyNote:
      'Heuristic reuse: a completed background order exists for this worker in the tenant outside (or unlinked to) this entity’s current assignments. Package equivalency and validity window are not verified by the app yet.',
  };
}

export interface SelectEverifyArtifact {
  caseId: string | undefined;
  completedAt: string | null;
  scope: Extract<EmploymentOnboardingArtifactScope, 'entity_scoped'>;
  policyNote: string;
}

function everifyDisplayIsTerminalSuccess(display: string): boolean {
  const lower = display.toLowerCase();
  return ['closed', 'authorized', 'completed', 'closure_duplicate'].some((x) => lower.includes(x));
}

/**
 * C1 Select E-Verify reuse (conceptual):
 * - E-Verify is Select-only; cases are scoped by entityId on the case (see everify hook).
 * - If the latest Select case for this worker is a terminal success, the requirement can be
 *   satisfied by that artifact without re-running per assignment (until policy says otherwise).
 *
 * Returns artifact when case indicates success but the e_verify pipeline step is not yet complete
 * (lag / partial sync), OR when we want to label completion as artifact-driven for everify_completed rows.
 */
export function evaluateSelectEverifyReuse(args: {
  entityKey: EmploymentEntityKey;
  stepKey: string;
  everifySummary: EmploymentEverifySummary | null | undefined;
  pipelineEverifyStep: PipelineStepRow | undefined;
}): { artifact: SelectEverifyArtifact; pipelineIncomplete: boolean } | null {
  if (args.entityKey !== 'select') return null;
  if (!args.everifySummary?.applicable || args.everifySummary.caseCount <= 0) return null;
  const disp = String(args.everifySummary.statusDisplay || '');
  if (!everifyDisplayIsTerminalSuccess(disp)) return null;

  const pipe = String(args.pipelineEverifyStep?.status || '').toLowerCase();
  const pipelineIncomplete = pipe !== 'complete' && pipe !== 'completed';

  const artifact: SelectEverifyArtifact = {
    caseId: args.everifySummary.latestCaseId ?? undefined,
    completedAt: null,
    scope: 'entity_scoped',
    policyNote:
      'Select E-Verify case shows a terminal outcome for this entity. Reuse across later Select assignments is allowed by this heuristic when tenant policy does not require a fresh case.',
  };

  if (args.stepKey === 'everify_sent' || args.stepKey === 'everify_completed') {
    return { artifact, pipelineIncomplete };
  }
  return null;
}

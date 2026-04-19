/**
 * Versioned operational override rules — deterministic, no I/O.
 * @see operationalOverrideTypes.ts
 */
import { createHash } from 'crypto';
import type { PrescreenCategoryScoresV1 } from './prescreenCategoryScores';
import type { WorkerAiPrescreenAnswers } from './scoreWorkerAiPrescreen';
import type { PrescreenAssignmentReadiness } from './aiInterviewContextTypes';
import { OPERATIONAL_OVERRIDE_RULES_VERSION, type OperationalOverrideItem } from './operationalOverrideTypes';

/** Single source for caps — prevents runaway adjustment. */
export const OVERRIDE_MAX_NET_UP = 12;
export const OVERRIDE_MAX_NET_DOWN = 15;

export type OperationalRuleEvalContext = {
  baseInterviewScore: number;
  flags: string[];
  answers: WorkerAiPrescreenAnswers;
  dynamicAnswers: Record<string, string>;
  categoryScores: PrescreenCategoryScoresV1 | null;
  assignmentReadiness: PrescreenAssignmentReadiness;
  /** workEligibility === false on user doc → hard stop */
  workAuthorized: boolean;
  /** When false, cert-related soft blocks are skipped (unknown state). */
  certificationsLoaded: boolean;
  /** Raw certifications array from user doc — optional length check. */
  certificationsCount: number;
};

function normLower(s: unknown): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function hasFlag(flags: string[], f: string): boolean {
  return flags.includes(f);
}

function dynYes(dynamicAnswers: Record<string, string>, key: string): boolean {
  return normLower(dynamicAnswers[key]) === 'yes';
}

function dynNo(dynamicAnswers: Record<string, string>, key: string): boolean {
  return normLower(dynamicAnswers[key]) === 'no';
}

export type RuleEvaluationResult = {
  items: OperationalOverrideItem[];
  softBlocks: string[];
  hardBlocks: string[];
  /** Sum of point deltas from items (gate_only contributes 0). */
  rawPointDelta: number;
};

/**
 * Evaluate all rules in deterministic order. Same context → same result.
 */
export function evaluateOperationalOverrideRules(ctx: OperationalRuleEvalContext): RuleEvaluationResult {
  const items: OperationalOverrideItem[] = [];
  const softBlocks: string[] = [];
  const hardBlocks: string[] = [];
  let rawPointDelta = 0;

  const push = (item: OperationalOverrideItem) => {
    items.push(item);
    if (typeof item.points === 'number' && Number.isFinite(item.points)) {
      rawPointDelta += item.points;
    }
  };

  // --- Hard blocks (policy / eligibility) — evaluated first for explainability order ---
  if (!ctx.workAuthorized) {
    hardBlocks.push('work_authorization_not_verified');
    push({
      code: 'hard_work_auth',
      label: 'Work authorization',
      direction: 'gate_only',
      reason: 'Work eligibility is not authorized on the worker profile.',
    });
  }

  if (hasFlag(ctx.flags, 'physical_mismatch') && dynNo(ctx.dynamicAnswers, 'dyn_physical_job_fit')) {
    hardBlocks.push('physical_requirement_failed');
    push({
      code: 'hard_physical_job_fit',
      label: 'Physical job fit',
      direction: 'gate_only',
      reason: 'Job-specific physical requirement failed (dynamic module).',
    });
  }

  if (hasFlag(ctx.flags, 'drug_risk_high') && hasFlag(ctx.flags, 'background_risk_high')) {
    hardBlocks.push('dual_high_compliance_screening');
    push({
      code: 'hard_dual_compliance_high',
      label: 'Compliance screening',
      direction: 'gate_only',
      reason: 'Elevated drug and background signals together — policy stop.',
    });
  }

  // --- Positive operational adjustments ---
  const ownVeh = normLower(ctx.answers.transportation_plan) === 'own_vehicle';
  const backupYes = normLower(ctx.answers.backup_transportation) === 'yes';
  if (ownVeh && backupYes && dynYes(ctx.dynamicAnswers, 'dyn_shift_punctuality') && dynYes(ctx.dynamicAnswers, 'dyn_worksite_commute')) {
    push({
      code: 'up_reliable_commute',
      label: 'Reliable commute + punctuality',
      direction: 'up',
      points: 4,
      reason: 'Own vehicle, backup plan, and positive job commute/punctuality dynamics.',
    });
  } else if (ownVeh && backupYes) {
    push({
      code: 'up_transport_stack',
      label: 'Vehicle + backup',
      direction: 'up',
      points: 4,
      reason: 'Own vehicle with a backup transport plan.',
    });
  }

  const sup = String(ctx.answers.supervisor_feedback ?? '').trim();
  if (sup.length >= 40 && /[a-z]{4,}/i.test(sup)) {
    push({
      code: 'up_supervisor_detail',
      label: 'Supervisor context',
      direction: 'up',
      points: 2,
      reason: 'Concrete supervisor feedback (not a one-word answer).',
    });
  }

  if (ctx.categoryScores) {
    const c = ctx.categoryScores;
    const vals = [c.reliability, c.punctuality, c.workEthic, c.teamFit, c.jobReadiness, c.stability];
    if (vals.every((v) => typeof v === 'number' && v >= 72)) {
      push({
        code: 'up_category_consistency',
        label: 'Strong category consistency',
        direction: 'up',
        points: 3,
        reason: 'All prescreen category scores are solid (≥72).',
      });
    }
  }

  let strongDynamicYes = 0;
  for (const k of Object.keys(ctx.dynamicAnswers)) {
    if (k.startsWith('dyn_') && dynYes(ctx.dynamicAnswers, k)) strongDynamicYes += 1;
  }
  if (strongDynamicYes >= 4) {
    push({
      code: 'up_dynamic_job_yes',
      label: 'Job-specific confirmations',
      direction: 'up',
      points: 2,
      reason: 'Multiple structured “yes” confirmations on job-specific requirements.',
    });
  }

  // --- Negative operational adjustments ---
  if (normLower(ctx.answers.backup_transportation) === 'no') {
    push({
      code: 'down_no_backup',
      label: 'No backup transport',
      direction: 'down',
      points: -3,
      reason: 'No backup transport plan recorded.',
    });
  }

  if (hasFlag(ctx.flags, 'attendance_risk')) {
    push({
      code: 'down_attendance',
      label: 'Attendance concern',
      direction: 'down',
      points: -4,
      reason: 'Attendance history flagged in prescreen.',
    });
  }

  if (hasFlag(ctx.flags, 'vague_response') && hasFlag(ctx.flags, 'low_effort_response')) {
    push({
      code: 'down_vague_stack',
      label: 'Thin answers',
      direction: 'down',
      points: -4,
      reason: 'Multiple low-effort or vague responses across key prompts.',
    });
  }

  const moderateStack =
    hasFlag(ctx.flags, 'attendance_risk') &&
    (hasFlag(ctx.flags, 'transportation_risk') || normLower(ctx.answers.backup_transportation) === 'no');
  if (moderateStack && ctx.baseInterviewScore < 85) {
    push({
      code: 'down_moderate_stack',
      label: 'Stacked logistics risk',
      direction: 'down',
      points: -3,
      reason: 'Attendance plus transport/logistics concerns together in a mid band.',
    });
  }

  // --- Soft blocks (do not always move score) ---
  if (ctx.assignmentReadiness.status === 'blocked') {
    softBlocks.push('assignment_readiness_blocked');
    push({
      code: 'soft_assignment_blocked',
      label: 'Assignment readiness',
      direction: 'gate_only',
      reason: 'Assignment readiness is blocked until onboarding or job steps complete.',
    });
  }

  const certDynKey = Object.keys(ctx.dynamicAnswers).find((k) => k.toLowerCase().includes('cert'));
  if (
    ctx.certificationsLoaded &&
    ctx.certificationsCount === 0 &&
    certDynKey &&
    (dynNo(ctx.dynamicAnswers, certDynKey) || normLower(ctx.dynamicAnswers[certDynKey]) === 'not_sure')
  ) {
    softBlocks.push('cert_requirement_unsatisfied');
    push({
      code: 'soft_cert_dependency',
      label: 'Certification',
      direction: 'gate_only',
      reason: 'Job asks about certification ability and evidence is not on file or not confirmed.',
    });
  }

  // Sort items for stable audit trail
  items.sort((a, b) => a.code.localeCompare(b.code));

  return { items, softBlocks, hardBlocks, rawPointDelta };
}

export function clampOverridePointDelta(raw: number): number {
  return Math.max(-OVERRIDE_MAX_NET_DOWN, Math.min(OVERRIDE_MAX_NET_UP, raw));
}

export function computeOverrideInputSignature(ctx: OperationalRuleEvalContext): string {
  const payload = JSON.stringify({
    v: OPERATIONAL_OVERRIDE_RULES_VERSION,
    base: ctx.baseInterviewScore,
    flags: [...ctx.flags].sort(),
    workAuthorized: ctx.workAuthorized,
    ar: ctx.assignmentReadiness.status,
    dyn: ctx.dynamicAnswers,
    cat: ctx.categoryScores,
    cc: ctx.certificationsCount,
    cl: ctx.certificationsLoaded,
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

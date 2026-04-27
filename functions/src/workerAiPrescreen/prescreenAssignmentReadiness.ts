/**
 * Assignment-level readiness + alternate paths from core score + dynamic module answers.
 */
import type {
  AiInterviewContext,
  DynamicPrescreenStep,
  PrescreenAssignmentReadiness,
  PrescreenAlternatePaths,
} from './aiInterviewContextTypes';
import type { AiPrescreenScoreResult } from './scoreWorkerAiPrescreen';

function normAns(s: unknown): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function mergeStatus(
  current: PrescreenAssignmentReadiness['status'],
  next: PrescreenAssignmentReadiness['status'],
): PrescreenAssignmentReadiness['status'] {
  const rank: Record<PrescreenAssignmentReadiness['status'], number> = {
    ready: 0,
    review: 1,
    blocked: 2,
  };
  return rank[next] > rank[current] ? next : current;
}

/**
 * Derive assignment readiness from dynamic answers; core recommendation informs severity when modules are sparse.
 */
export function computePrescreenAssignmentReadiness(args: {
  context: AiInterviewContext | null;
  dynamicSteps: DynamicPrescreenStep[];
  dynamicAnswers: Record<string, string>;
  coreScore: AiPrescreenScoreResult;
}): { assignmentReadiness: PrescreenAssignmentReadiness; alternatePaths: PrescreenAlternatePaths } {
  const { context, dynamicSteps, dynamicAnswers, coreScore } = args;

  if (!context) {
    return {
      assignmentReadiness: { status: 'ready', reasons: [] },
      alternatePaths: {},
    };
  }

  if (dynamicSteps.length === 0) {
    const reasons: string[] = [];
    let status: PrescreenAssignmentReadiness['status'] = 'ready';
    if (coreScore.recommendation === 'decline') {
      status = 'blocked';
      reasons.push('core_recommendation_decline');
    } else if (coreScore.recommendation === 'review') {
      status = 'review';
      reasons.push('core_recommendation_review');
    }
    return { assignmentReadiness: { status, reasons }, alternatePaths: {} };
  }

  let status: PrescreenAssignmentReadiness['status'] = 'ready';
  const reasons: string[] = [];

  const bump = (next: PrescreenAssignmentReadiness['status'], reason: string) => {
    status = mergeStatus(status, next);
    if (reason && !reasons.includes(reason)) reasons.push(reason);
  };

  for (const step of dynamicSteps) {
    const raw = dynamicAnswers[step.id];
    const a = normAns(raw);
    if (!raw || !a) {
      bump('review', `unanswered:${step.id}`);
      continue;
    }

    switch (step.module) {
      case 'shift':
        if (a === 'no') bump('blocked', 'shift_punctuality_no');
        else if (a === 'not_sure') bump('review', 'shift_punctuality_uncertain');
        break;
      case 'location':
        if (a === 'no') bump('blocked', 'worksite_commute_no');
        else if (a === 'not_sure') bump('review', 'worksite_commute_uncertain');
        break;
      case 'compliance_drug':
        if (a === 'no') bump('blocked', 'job_drug_screen_unable');
        else if (a === 'not_sure') bump('review', 'job_drug_screen_uncertain');
        break;
      case 'compliance_background':
        if (a === 'no') bump('blocked', 'job_background_unable');
        else if (a === 'not_sure') bump('review', 'job_background_uncertain');
        break;
      case 'physical':
        if (a === 'no') bump('blocked', 'physical_job_fit_no');
        else if (a === 'not_sure') bump('review', 'physical_job_fit_uncertain');
        break;
      case 'certification':
        if (a === 'no') bump('blocked', `certification_missing:${step.id}`);
        else if (a === 'not_sure') bump('review', `certification_uncertain:${step.id}`);
        break;
      case 'uniform':
        if (a === 'no') bump('review', 'uniform_not_available');
        else if (a === 'not_sure') bump('review', 'uniform_uncertain');
        break;
      case 'gig_path':
        // Eligibility computed below; unanswered handled at top
        break;
      default:
        break;
    }
  }

  let assignmentStatus: PrescreenAssignmentReadiness['status'] = status;
  if (coreScore.recommendation === 'decline') {
    assignmentStatus = mergeStatus(assignmentStatus, 'blocked');
    if (!reasons.includes('core_recommendation_decline')) reasons.push('core_recommendation_decline');
  } else if (coreScore.recommendation === 'review' && assignmentStatus === 'ready') {
    assignmentStatus = mergeStatus(assignmentStatus, 'review');
    if (!reasons.includes('core_recommendation_review')) reasons.push('core_recommendation_review');
  }

  const gigAns = normAns(dynamicAnswers.dyn_gig_path_willing);
  const hadGigStep = dynamicSteps.some((s) => s.id === 'dyn_gig_path_willing');
  const alternatePaths: PrescreenAlternatePaths = {};
  if (
    hadGigStep &&
    context.businessRules?.allowGigPath &&
    coreScore.overallScore >= 70 &&
    (assignmentStatus === 'blocked' || assignmentStatus === 'review') &&
    gigAns === 'yes'
  ) {
    alternatePaths.gigEligible = true;
  }

  return { assignmentReadiness: { status: assignmentStatus, reasons }, alternatePaths };
}

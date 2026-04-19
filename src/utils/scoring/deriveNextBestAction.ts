/**
 * Next best action + automation readiness for recruiter Overview scoring card.
 * Single sentence + primary CTA label; keep logic centralized (no duplicate scoring).
 */
import type { RecruiterScoreSnapshot } from '../../types/recruiterScoreSnapshot';
import type { WorkerInterviewAssignmentReadiness } from '../../types/workerAiPrescreenInterview';

export type NextBestActionIntent =
  | 'auto_advance'
  | 'request_interview'
  | 'verify_phone'
  | 'background_check'
  | 'review_risk'
  | 'review_decision'
  | 'advance_manual'
  | 'open_interview_tab';

export type AutomationReadiness = 'ready' | 'needs_action' | 'blocked';

export type NextBestAction = {
  sentence: string;
  primaryButtonLabel: string;
  intent: NextBestActionIntent;
  automationState: AutomationReadiness;
};

function readinessFromSignals(input: {
  hardBlockCount: number;
  decision: RecruiterScoreSnapshot['decision'] | null;
  recommendation: RecruiterScoreSnapshot['recommendation'] | null;
  assignmentReadiness: WorkerInterviewAssignmentReadiness | null | undefined;
  autoAdvanceEligible: boolean | undefined;
}): AutomationReadiness {
  const { hardBlockCount, decision, recommendation, assignmentReadiness, autoAdvanceEligible } = input;
  if (hardBlockCount > 0 || decision === 'reject' || recommendation === 'decline') return 'blocked';
  if (assignmentReadiness?.status === 'blocked') return 'blocked';
  if (autoAdvanceEligible === true && decision === 'advance' && recommendation === 'proceed') return 'ready';
  return 'needs_action';
}

export function deriveNextBestAction(input: {
  hiringScore: number | null;
  decision: RecruiterScoreSnapshot['decision'] | null;
  recommendation: RecruiterScoreSnapshot['recommendation'] | null;
  riskLevel: RecruiterScoreSnapshot['riskLevel'] | null;
  interviewCount: number;
  hardBlocks: string[];
  softBlocks: string[];
  autoAdvanceEligible?: boolean;
  assignmentReadiness?: WorkerInterviewAssignmentReadiness | null;
  phoneVerified?: boolean | null;
  backgroundCheckPending?: boolean;
}): NextBestAction {
  const {
    hiringScore,
    decision,
    recommendation,
    riskLevel,
    interviewCount,
    hardBlocks,
    softBlocks,
    autoAdvanceEligible,
    assignmentReadiness,
    phoneVerified,
    backgroundCheckPending,
  } = input;

  const hardBlockCount = hardBlocks.length;
  const softBlockCount = softBlocks.length;
  const automationState = readinessFromSignals({
    hardBlockCount,
    decision,
    recommendation,
    assignmentReadiness,
    autoAdvanceEligible,
  });

  const riskElevated = riskLevel === 'high' || riskLevel === 'medium';

  if (hardBlockCount > 0 || assignmentReadiness?.status === 'blocked') {
    return {
      sentence: 'Hard gates or assignment rules are blocking progression — review flags and records before advancing.',
      primaryButtonLabel: 'Review risk',
      intent: 'review_risk',
      automationState: 'blocked',
    };
  }

  if (interviewCount === 0) {
    return {
      sentence: 'No interview on file yet — run a prescreen or live interview to unlock a confident decision.',
      primaryButtonLabel: 'Request interview',
      intent: 'request_interview',
      automationState: 'needs_action',
    };
  }

  if (phoneVerified === false) {
    return {
      sentence: 'Phone is not verified — confirm contactability before you advance this candidate.',
      primaryButtonLabel: 'Send verification SMS',
      intent: 'verify_phone',
      automationState: 'needs_action',
    };
  }

  if (backgroundCheckPending) {
    return {
      sentence: 'Background check is still pending — wait for results or open screening before final hire.',
      primaryButtonLabel: 'Review screening',
      intent: 'background_check',
      automationState: 'needs_action',
    };
  }

  if (
    softBlockCount > 0 ||
    riskElevated ||
    recommendation === 'caution' ||
    recommendation === 'review' ||
    decision === 'review'
  ) {
    return {
      sentence: 'Moderate risk signals or policy checks need a quick human pass before you advance.',
      primaryButtonLabel: 'Review risk flags',
      intent: 'review_risk',
      automationState: automationState === 'ready' ? 'needs_action' : automationState,
    };
  }

  if (autoAdvanceEligible === true && decision === 'advance' && recommendation === 'proceed' && hiringScore != null && hiringScore >= 75) {
    return {
      sentence: 'Eligible for automation — candidate clears gates and is ready to move forward.',
      primaryButtonLabel: 'Advance candidate',
      intent: 'auto_advance',
      automationState: 'ready',
    };
  }

  if (decision === 'advance' && recommendation === 'proceed') {
    return {
      sentence: 'Proceed path is open — confirm any final checks, then advance when ready.',
      primaryButtonLabel: 'Advance candidate',
      intent: 'advance_manual',
      automationState: 'needs_action',
    };
  }

  if (decision === 'hold' || decision === 'reject') {
    return {
      sentence: 'Decision is not proceed — review rationale and next steps on the interview record.',
      primaryButtonLabel: 'Review decision',
      intent: 'review_decision',
      automationState: 'blocked',
    };
  }

  return {
    sentence: 'Open the latest interview for full context and sub-scores before you decide.',
    primaryButtonLabel: 'View interview',
    intent: 'open_interview_tab',
    automationState: 'needs_action',
  };
}

/** Snapshot lines hidden from “Why this decision?” / recommendation bullets (product). */
export const SUPPRESSED_RECRUITER_REASONING_SUMMARY_LINES = new Set([
  'Primary score uses profile/composite hiring score (no operational prescreen layer).',
]);

export function reasoningSummaryLinesForUi(raw: string | null | undefined): string[] {
  if (raw == null || typeof raw !== 'string') return [];
  return raw
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((l) => !SUPPRESSED_RECRUITER_REASONING_SUMMARY_LINES.has(l));
}

/** Short trust-building lines (max ~2 lines) — not the full accordion narrative. */
export function deriveWhyThisDecision(input: {
  reasoningSummary?: string | null;
  riskLevel: RecruiterScoreSnapshot['riskLevel'] | null;
  hardBlocks: string[];
  strengths: string[];
  risks: string[];
}): string {
  const lines = reasoningSummaryLinesForUi(input.reasoningSummary);
  if (lines.length > 0) {
    const two = lines.slice(0, 2).join(' ');
    return two.length > 220 ? `${two.slice(0, 217)}…` : two;
  }
  const parts: string[] = [];
  if (input.strengths.length) parts.push(input.strengths[0]);
  if (input.risks.length) parts.push(`Watch: ${input.risks[0]}`);
  if (parts.length === 0 && input.riskLevel) {
    parts.push(`Risk posture is ${input.riskLevel} — align actions with policy.`);
  }
  if (parts.length === 0 && input.hardBlocks.length) {
    parts.push('Hard blocks require clearance before hire.');
  }
  const out = parts.join(' ');
  return out.length > 220 ? `${out.slice(0, 217)}…` : out || 'Signals from the latest interview and profile inform this decision.';
}

/** Uppercase headline for recruiter UI (ADVANCE / REVIEW / …) — Overview card + record header. */
export function recruiterDecisionHeadline(
  d: RecruiterScoreSnapshot['decision'] | null | undefined,
  recommendation: RecruiterScoreSnapshot['recommendation'] | null | undefined,
): string {
  if (d) {
    switch (d) {
      case 'advance':
        return 'ADVANCE';
      case 'review':
        return 'REVIEW';
      case 'reject':
        return 'REJECT';
      case 'hold':
        return 'HOLD';
      default:
        break;
    }
  }
  if (recommendation === 'proceed') return 'ADVANCE';
  if (recommendation === 'decline') return 'REJECT';
  return 'REVIEW';
}

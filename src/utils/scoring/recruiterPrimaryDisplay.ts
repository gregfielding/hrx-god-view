/**
 * Single recruiter-facing primary score package: operational prescreen first, legacy composite secondary.
 */

import type { ScoreSummary } from '../scoreSummary';
import { getCanonicalStoredAiScore } from '../scoreSummary';
import type { WorkerInterviewAiBlock } from '../../types/workerAiPrescreenInterview';
import {
  resolveRecruiterOperationalScore100,
  type OperationalScoreSource,
} from './recruiterOperationalScore';
import { recruiterTableLetterGrade } from '../recruiterUsersReadinessDisplay';

export type RecruiterPrimarySourceKey =
  | 'operational_interview'
  | 'operational_summary'
  | 'interview_base'
  | 'interview_last10_proxy'
  | 'legacy_composite'
  | 'none';

function mapToPrimaryKey(adjusted: OperationalScoreSource): RecruiterPrimarySourceKey {
  if (adjusted === 'interview_override') return 'operational_interview';
  if (adjusted === 'summary_override') return 'operational_summary';
  if (adjusted === 'interview_base' || adjusted === 'summary_base') return 'interview_base';
  if (adjusted === 'interview_last10_proxy') return 'interview_last10_proxy';
  if (adjusted === 'composite_ai') return 'legacy_composite';
  return 'none';
}

export type RecruiterPrimaryDisplay = {
  primaryScore100: number | null;
  primarySource: RecruiterPrimarySourceKey;
  /** Legacy profile/composite Hiring Score (scoreSummary.aiScore) — not the main recruiter truth when prescreen exists */
  secondaryProfileComposite100: number | null;
  /** True when operational layer differs from composite by ≥15 (recruiter confusion risk) */
  hasConflict: boolean;
  /** Short plain-language hint for UI */
  conflictHint: string | null;
  /** Letter grade from primary score */
  primaryGrade: string;
  /** True when latest prescreen interview AI was passed into resolution */
  usedLatestInterviewAi: boolean;
};

const CONFLICT_DELTA = 15;

export function resolveRecruiterPrimaryDisplay(args: {
  scoreSummary?: ScoreSummary | null;
  latestPrescreenInterviewAi?: WorkerInterviewAiBlock | null;
}): RecruiterPrimaryDisplay {
  const { scoreSummary, latestPrescreenInterviewAi } = args;
  const usedLatestInterviewAi = Boolean(latestPrescreenInterviewAi);
  const r = resolveRecruiterOperationalScore100({
    scoreSummary: scoreSummary ?? undefined,
    interviewAi: latestPrescreenInterviewAi ?? undefined,
  });
  const composite = getCanonicalStoredAiScore(scoreSummary ?? undefined);
  const primary = r.adjustedScore;
  const primarySource = mapToPrimaryKey(r.adjustedSource);

  const hasConflict =
    primary != null &&
    composite != null &&
    Math.abs(Math.round(primary) - Math.round(composite)) >= CONFLICT_DELTA;

  let conflictHint: string | null = null;
  if (hasConflict) {
    if (usedLatestInterviewAi || primarySource !== 'legacy_composite') {
      conflictHint = 'Using operational prescreen score; profile/composite score differs (legacy formula).';
    } else if (typeof scoreSummary?.interviewCount === 'number' && scoreSummary.interviewCount > 0) {
      conflictHint = 'Profile score differs from latest interview signals — open Score tab or run resync.';
    } else {
      conflictHint = 'Profile score differs from primary operational score.';
    }
  }

  const primaryGrade = primary != null ? recruiterTableLetterGrade(Math.round(primary)) : '—';

  return {
    primaryScore100: primary,
    primarySource,
    secondaryProfileComposite100: composite,
    hasConflict,
    conflictHint,
    primaryGrade,
    usedLatestInterviewAi,
  };
}

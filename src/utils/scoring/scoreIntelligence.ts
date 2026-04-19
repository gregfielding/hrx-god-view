/**
 * Derives recruiter-facing score intelligence from a stored worker AI pre-screen interview + profile score summary.
 * No raw flags in output — callers translate for UI.
 */

import type { ScoreSummary } from '../scoreSummary';
import type { ScoreIntelligence } from '../../types/scoreIntelligence';
import { resolveRecruiterOperationalScore100 } from './recruiterOperationalScore';

/** Minimal interview shape from `users/{uid}/interviews/{id}` (worker AI pre-screen). */
export type ScoreIntelligenceInterviewInput = {
  interviewKind?: string;
  score10?: number;
  score?: number;
  ai?: {
    overallScore?: number;
    baseInterviewScore?: number;
    overrideAdjustedScore?: number;
    recommendation?: string;
    flags?: string[];
    softBlocks?: string[];
    hardBlocks?: string[];
    subScores?: {
      experience?: number;
      reliability?: number;
      transportation?: number;
      risk?: number;
      physical?: number;
    };
    hiringDecision?: {
      decision?: string;
      eligibleForAutoAdvance?: boolean;
      reasonCodes?: string[];
    };
    summary?: string;
  };
  questions?: Array<{ id?: string; answer?: unknown }>;
};

const PRESCREEN = 'worker_ai_prescreen';

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function answerText(answer: unknown): string {
  if (answer == null) return '';
  if (typeof answer === 'string') return answer;
  if (Array.isArray(answer)) return answer.map((x) => String(x)).join(', ');
  return String(answer);
}

function getQuestionAnswer(questions: Array<{ id?: string; answer?: unknown }> | undefined, id: string): string {
  const q = questions?.find((x) => String(x.id || '') === id);
  return q ? answerText(q.answer) : '';
}

function mapHiringToPanel(decision: string | undefined): 'advance' | 'review' | 'reject' | null {
  const d = norm(String(decision || ''));
  if (d === 'advance') return 'advance';
  if (d === 'review' || d === 'hold') return 'review';
  if (d === 'reject') return 'reject';
  return null;
}

function mapRecommendationToPanel(rec: string | undefined): 'advance' | 'review' | 'reject' | null {
  const r = norm(String(rec || ''));
  if (r === 'proceed') return 'advance';
  if (r === 'review' || r === 'caution') return 'review';
  if (r === 'decline') return 'reject';
  return null;
}

/** Human-readable risk lines — never expose raw flag keys in UI copy. */
const FLAG_RISK_COPY: Record<string, string> = {
  drug_risk_moderate:
    'Drug-screen response needs review (low confidence, not an automatic disqualifier)',
  background_risk_moderate:
    'Background-check response needs review (low confidence, not an automatic disqualifier)',
  drug_risk_low: 'Drug-screen detail is light — confirm with policy if needed',
  background_risk_low: 'Background detail is light — confirm with policy if needed',
  drug_unknown: 'Drug screening answer was short or unclear — recruiter review recommended',
  background_unknown: 'Background answer was short or unclear — recruiter review recommended',
  drug_risk_high: 'Serious drug-screening concern — review before proceeding',
  background_risk_high: 'Serious background concern — review before proceeding',
  vague_response: 'Some answers lacked detail',
  low_effort_response: 'Several answers were very short',
  attendance_risk: 'Attendance risk flagged from responses',
  transportation_risk: 'Transportation plan may need confirmation',
  no_backup_transport: 'No backup transportation described',
  limited_relevant_experience: 'Limited relevant experience called out',
  physical_mismatch: 'Physical fit may not match role requirements',
  risk_admission_detected: 'Risk admission noted in responses',
};

function uniqueStrings(xs: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const t = x.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

function hasExplicitFailure(flags: string[]): boolean {
  return (
    flags.includes('drug_risk_high') ||
    flags.includes('background_risk_high') ||
    flags.includes('physical_mismatch')
  );
}

function deriveConfidence(flags: string[]): 'low' | 'medium' | 'high' {
  const vague = flags.includes('vague_response');
  const lowEffort = flags.includes('low_effort_response');
  const complianceSoft =
    flags.some((f) =>
      ['drug_risk_moderate', 'background_risk_moderate', 'drug_unknown', 'background_unknown'].includes(f),
    );
  const heavy = hasExplicitFailure(flags) || flags.includes('attendance_risk');

  if (heavy) return 'low';
  if (vague && complianceSoft) return 'low';
  if (vague && lowEffort) return 'low';
  if (complianceSoft || vague || lowEffort) return 'medium';
  return 'high';
}

function buildImprovements(flags: string[]): string[] {
  const out: string[] = [];
  if (flags.includes('vague_response')) {
    out.push('Add more detail to experience and role-specific examples.');
  }
  if (flags.some((f) => f.includes('drug') || f.includes('background'))) {
    out.push('Clarify compliance answers with specifics recruiters can verify.');
  }
  if (flags.includes('transportation_risk') || flags.includes('no_backup_transport')) {
    out.push('Confirm commute and backup plan for start times.');
  }
  if (flags.includes('limited_relevant_experience')) {
    out.push('Capture more concrete work history for this role type.');
  }
  return uniqueStrings(out, 5);
}

function buildReasoning(
  breakdown: ScoreIntelligence['breakdown'],
  flags: string[],
  aiSummary?: string,
): string[] {
  const lines: string[] = [];
  const { experience, reliability, transportation, physical, risk } = breakdown;

  if (experience >= 18) {
    lines.push('Experience points are strong relative to the rubric — history and confidence selections carried weight.');
  } else if (experience >= 12) {
    lines.push('Experience is mixed: some signal present, but not as detailed as a top-tier score.');
  } else {
    lines.push('Experience is a drag on the total: add more concrete role and task detail.');
  }

  if (reliability >= 18) {
    lines.push('Reliability reads well — attendance and/or supervisor signal is positive.');
  } else if (flags.includes('attendance_risk')) {
    lines.push('Reliability is pulled down by attendance-related responses.');
  }

  if (transportation >= 14) {
    lines.push('Transportation and backup plan are workable for most schedulers.');
  } else if (flags.includes('transportation_risk') || flags.includes('no_backup_transport')) {
    lines.push('Transportation needs a closer look before scheduling.');
  }

  if (physical >= 8) {
    lines.push('Physical comfort aligns with typical on-site expectations.');
  } else if (flags.includes('physical_mismatch')) {
    lines.push('Physical fit may not match the role as described.');
  }

  if (risk < 10) {
    lines.push('Screening / compliance axis pulled points — disclosures or unknowns need a closer look.');
  } else if (risk >= 14) {
    lines.push('Screening / compliance axis is in a workable range relative to heavier profiles.');
  }

  if (aiSummary && aiSummary.length < 220) {
    lines.push(aiSummary);
  }

  return uniqueStrings(lines, 5);
}

function transportStrongFromAnswers(questions: Array<{ id?: string; answer?: unknown }> | undefined, flags: string[]): boolean {
  const plan = norm(getQuestionAnswer(questions, 'transportation_plan'));
  const ownOrRideOrPublic =
    plan === 'own_vehicle' || plan === 'ride_from_someone_else' || plan === 'public_transportation';
  const noLogisticsFlags = !flags.includes('transportation_risk') && !flags.includes('no_backup_transport');
  return ownOrRideOrPublic || noLogisticsFlags;
}

function hasRelevantExperienceHint(questions: Array<{ id?: string; answer?: unknown }> | undefined): boolean {
  const keys = [
    'opening_experience_industrial',
    'opening_experience_hospitality',
    'opening_experience_events',
    'opening_experience_clerical',
    'opening_experience_healthcare',
    'opening_gig_types',
  ];
  for (const k of keys) {
    const t = String(getQuestionAnswer(questions, k) || '').trim();
    if (t.length > 2) return true;
  }
  const exp = String(getQuestionAnswer(questions, 'experience_details') || '').trim();
  return exp.length >= 24;
}

/**
 * Derive structured score intelligence for the Score Intelligence panel.
 *
 * @param interview Latest worker AI pre-screen interview doc (or null).
 * @param scoreSummary Profile `scoreSummary` for light cross-check (optional).
 * @param flagsOverride Optional flag list; defaults to `interview.ai.flags`.
 */
export function deriveScoreIntelligence(
  interview: ScoreIntelligenceInterviewInput | null | undefined,
  scoreSummary: ScoreSummary | undefined,
  flagsOverride?: string[],
): ScoreIntelligence | null {
  if (!interview || interview.interviewKind !== PRESCREEN) {
    return null;
  }

  const ai = interview.ai || {};
  const flags = Array.isArray(flagsOverride) ? flagsOverride : Array.isArray(ai.flags) ? [...ai.flags] : [];
  const questions = interview.questions;

  const sub = ai.subScores || {};
  const breakdown: ScoreIntelligence['breakdown'] = {
    experience: typeof sub.experience === 'number' && Number.isFinite(sub.experience) ? sub.experience : 0,
    reliability: typeof sub.reliability === 'number' && Number.isFinite(sub.reliability) ? sub.reliability : 0,
    transportation: typeof sub.transportation === 'number' && Number.isFinite(sub.transportation) ? sub.transportation : 0,
    physical: typeof sub.physical === 'number' && Number.isFinite(sub.physical) ? sub.physical : 0,
    risk: typeof sub.risk === 'number' && Number.isFinite(sub.risk) ? sub.risk : 0,
  };

  const resolved = resolveRecruiterOperationalScore100({ interviewAi: ai, scoreSummary });
  let interviewScore =
    resolved.baseScore ??
    (typeof ai.overallScore === 'number' && Number.isFinite(ai.overallScore) ? Math.round(ai.overallScore) : null);
  if (interviewScore == null && typeof interview.score10 === 'number') {
    interviewScore = Math.round(interview.score10 * 10);
  }
  if (interviewScore == null && typeof interview.score === 'number') {
    interviewScore = Math.round(interview.score * 10);
  }
  if (interviewScore == null && typeof scoreSummary?.interviewLastScore10 === 'number') {
    interviewScore = Math.round(scoreSummary.interviewLastScore10 * 10);
  }
  if (interviewScore == null) interviewScore = 0;

  const operationalScore = resolved.adjustedScore ?? interviewScore;
  const scoreDelta =
    resolved.scoreDelta ??
    (interviewScore != null && operationalScore != null ? operationalScore - interviewScore : null);

  const correctionApplied =
    typeof ai.overrideAdjustedScore === 'number' || typeof scoreSummary?.overrideAdjustedScore === 'number';

  const operationalCorrectionLines: string[] = [];
  if (correctionApplied) {
    operationalCorrectionLines.push('Operational correction applied — use operational score for decisions.');
    if (typeof scoreDelta === 'number' && scoreDelta !== 0) {
      operationalCorrectionLines.push(`Adjusted for operations (${scoreDelta >= 0 ? '+' : ''}${scoreDelta} vs interview score).`);
    }
    const soft = Array.isArray(ai.softBlocks) ? ai.softBlocks : [];
    for (const x of soft.slice(0, 4)) {
      const t = String(x).trim();
      if (t) operationalCorrectionLines.push(t.replace(/_/g, ' '));
    }
    if (scoreSummary?.recruiterTrustLevel) {
      operationalCorrectionLines.push(`Trust band: ${scoreSummary.recruiterTrustLevel}`);
    }
  }

  const fromHiring = mapHiringToPanel(ai.hiringDecision?.decision);
  const fromRec = mapRecommendationToPanel(ai.recommendation);
  const hiringPanel = fromHiring;
  const recommendationPanel = fromRec;
  const decision: 'advance' | 'review' | 'reject' = fromHiring ?? fromRec ?? 'review';

  const strengths: string[] = [];
  const att = norm(getQuestionAnswer(questions, 'attendance_issues'));
  if (att === 'no' || att === 'n') {
    strengths.push('No attendance issues reported');
  }
  const plan = norm(getQuestionAnswer(questions, 'transportation_plan'));
  if (plan === 'own_vehicle') {
    strengths.push('Reliable transportation (own vehicle)');
  } else if (plan === 'ride_from_someone_else' || plan === 'public_transportation') {
    strengths.push('Transportation plan in place');
  }
  const backup = norm(getQuestionAnswer(questions, 'backup_transportation'));
  if (backup === 'yes' || backup === 'y') {
    strengths.push('Backup transportation available');
  }
  const phys = norm(getQuestionAnswer(questions, 'physical_comfort'));
  if (phys === 'yes' || phys === 'y') {
    strengths.push('Meets physical requirements as stated');
  }
  if (hasRelevantExperienceHint(questions)) {
    strengths.push('Relevant experience indicated');
  }

  const risks: string[] = [];
  for (const f of flags) {
    const line = FLAG_RISK_COPY[f];
    if (line) risks.push(line);
  }
  const uniqueRisks = uniqueStrings(risks, 5);

  const confidence = deriveConfidence(flags);

  const transportStrong = transportStrongFromAnswers(questions, flags);
  const attendanceClean = att === 'no' || att === 'n';
  const physicalOk = phys === 'yes' || phys === 'y' || phys === '';
  const noExplicitFailure = !hasExplicitFailure(flags);

  let overrideSuggested = false;
  let suggestedDecision: 'advance' | 'review' | 'reject' | undefined;

  if (
    !correctionApplied &&
    decision === 'reject' &&
    transportStrong &&
    attendanceClean &&
    physicalOk &&
    noExplicitFailure
  ) {
    overrideSuggested = true;
    suggestedDecision = 'review';
  }

  const improvements = buildImprovements(flags);
  const reasoning = buildReasoning(breakdown, flags, typeof ai.summary === 'string' ? ai.summary : undefined);

  const autoAdvanceEligible =
    typeof ai.hiringDecision?.eligibleForAutoAdvance === 'boolean'
      ? ai.hiringDecision.eligibleForAutoAdvance
      : typeof scoreSummary?.autoAdvanceEligible === 'boolean'
        ? scoreSummary.autoAdvanceEligible
        : null;

  return {
    summary: {
      interviewScore,
      operationalScore,
      scoreDelta,
      score: operationalScore,
      recommendation: recommendationPanel,
      hiringDecision: hiringPanel,
      autoAdvanceEligible,
      decision,
      confidence,
      operationalCorrectionApplied: correctionApplied,
      operationalCorrectionLines: uniqueStrings(operationalCorrectionLines, 6),
      overrideSuggested: overrideSuggested || undefined,
      suggestedDecision,
    },
    strengths: uniqueStrings(strengths, 5),
    risks: uniqueRisks,
    breakdown,
    reasoning,
    improvements,
  };
}

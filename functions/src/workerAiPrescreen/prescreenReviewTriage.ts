/**
 * Structured prescreen "review" triage — separates strong-with-caution from borderline/weak reviews.
 * Top-level `recommendation` stays `proceed` | `review` | `decline`; this adds explainability only.
 */

import type { PrescreenRiskSummary } from './prescreenRiskSeverity';

/** Legacy bucket from rules engine; used only to detect borderline-quality reviews. */
export type PrescreenReviewKindLegacy = 'review_quality' | 'review_risk';

/** Recruiter mental model: one clear action vs. maybe usable. */
export type PrescreenReviewLane = 'strong_check_one' | 'borderline_maybe_usable';

/**
 * Primary review theme (orthogonal to score — use with `reviewLane` + score).
 * `mixed_review` = multiple competing drivers; see `reasons`.
 */
export type PrescreenReviewSubtype =
  | 'compliance_unknown'
  | 'compliance_disclosure'
  | 'reliability_attendance'
  | 'reliability_transport'
  | 'physical_job_fit'
  | 'answer_quality'
  | 'borderline_score'
  | 'mixed_review';

export type PrescreenReviewTriage = {
  lane: PrescreenReviewLane;
  subtype: PrescreenReviewSubtype;
  /** Short machine tags for analytics / UI filters. */
  reasons: string[];
  /** One-line recruiter copy; operational, not legal advice. */
  summaryShort: string;
};

const TRANSPORT_FLAGS = ['transportation_risk', 'no_backup_transport'] as const;
const QUALITY_FLAGS = ['vague_response', 'low_effort_response', 'limited_relevant_experience'] as const;

function hasAny(flags: string[], candidates: readonly string[]): boolean {
  const set = new Set(flags);
  return candidates.some((c) => set.has(c));
}

function scoreBandLabel(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/**
 * Whether drug/bg flags are **only** low-severity disclosures (no unknown / elevated).
 */
export function flagsOnlyLowDrugBackgroundSeverity(flags: string[]): boolean {
  const relevant = flags.filter(
    (f) =>
      f.startsWith('drug_risk_') ||
      f.startsWith('background_risk_') ||
      f === 'drug_unknown' ||
      f === 'background_unknown',
  );
  if (relevant.length === 0) return false;
  return relevant.every((f) => f === 'drug_risk_low' || f === 'background_risk_low');
}

export function hasComplianceUnknown(flags: string[]): boolean {
  return flags.includes('drug_unknown') || flags.includes('background_unknown');
}

export function hasElevatedComplianceDisclosure(flags: string[]): boolean {
  return flags.some((f) =>
    ['drug_risk_moderate', 'drug_risk_high', 'background_risk_moderate', 'background_risk_high'].includes(f),
  );
}

/**
 * Non–drug/bg drivers that justify review at 80+ (excluding low-only compliance).
 */
export function hasHighScoreReviewDrivers(flags: string[]): boolean {
  return (
    hasComplianceUnknown(flags) ||
    hasElevatedComplianceDisclosure(flags) ||
    flags.includes('attendance_risk') ||
    flags.includes('physical_mismatch') ||
    hasAny(flags, QUALITY_FLAGS) ||
    hasAny(flags, TRANSPORT_FLAGS) ||
    flags.includes('risk_admission_detected')
  );
}

type Driver = { id: string; weight: number; subtype: PrescreenReviewSubtype };

/**
 * Pick dominant review subtype and build reasons + summary for `recommendation === 'review'` only.
 */
export function computePrescreenReviewTriage(args: {
  overallScore: number;
  flags: string[];
  reviewKind: PrescreenReviewKindLegacy | undefined;
  riskSummary: PrescreenRiskSummary | null | undefined;
}): PrescreenReviewTriage | null {
  const { overallScore, flags, reviewKind } = args;
  const strong = flags.includes('strong_candidate_signal');
  const highConf = flags.includes('high_confidence_candidate');
  const grade = scoreBandLabel(overallScore);

  const lane: PrescreenReviewLane = overallScore >= 80 ? 'strong_check_one' : 'borderline_maybe_usable';

  const drivers: Driver[] = [];

  if (flags.includes('physical_mismatch')) {
    drivers.push({ id: 'physical_mismatch', weight: 5, subtype: 'physical_job_fit' });
  }
  if (flags.includes('attendance_risk')) {
    drivers.push({ id: 'attendance_risk', weight: 4, subtype: 'reliability_attendance' });
  }
  if (hasComplianceUnknown(flags)) {
    drivers.push({ id: 'compliance_unknown', weight: 4, subtype: 'compliance_unknown' });
  }
  const hasDisclosure =
    flags.some((f) =>
      ['drug_risk_low', 'drug_risk_moderate', 'drug_risk_high', 'background_risk_low', 'background_risk_moderate', 'background_risk_high'].includes(
        f,
      ),
    ) && !hasComplianceUnknown(flags);
  if (hasDisclosure) {
    drivers.push({ id: 'compliance_disclosure', weight: 3, subtype: 'compliance_disclosure' });
  }
  if (hasAny(flags, TRANSPORT_FLAGS)) {
    drivers.push({ id: 'transport', weight: 2, subtype: 'reliability_transport' });
  }
  if (hasAny(flags, QUALITY_FLAGS)) {
    drivers.push({ id: 'answer_quality', weight: 2, subtype: 'answer_quality' });
  }
  if (overallScore < 80 && reviewKind === 'review_quality' && drivers.length === 0) {
    drivers.push({ id: 'borderline_band', weight: 1, subtype: 'borderline_score' });
  }

  drivers.sort((a, b) => b.weight - a.weight);

  let subtype: PrescreenReviewSubtype;
  if (drivers.length === 0) {
    subtype = overallScore < 80 ? 'borderline_score' : 'mixed_review';
  } else if (drivers.length >= 3 && drivers[0].weight <= 3) {
    subtype = 'mixed_review';
  } else {
    subtype = drivers[0].subtype;
  }

  const reasons: string[] = [];
  if (drivers[0]) reasons.push(drivers[0].id);
  if (drivers[1] && drivers[1].id !== drivers[0]?.id) reasons.push(drivers[1].id);
  if (drivers[2] && reasons.length < 3) reasons.push(drivers[2].id);

  const summaryShort = buildReviewSummaryShort({
    overallScore,
    grade,
    lane,
    subtype,
    flags,
    strong,
    highConf,
    riskSummary: args.riskSummary,
  });

  return { lane, subtype, reasons, summaryShort };
}

function buildReviewSummaryShort(args: {
  overallScore: number;
  grade: string;
  lane: PrescreenReviewLane;
  subtype: PrescreenReviewSubtype;
  flags: string[];
  strong: boolean;
  highConf: boolean;
  riskSummary: PrescreenRiskSummary | null | undefined;
}): string {
  const { lane, subtype, flags, strong, highConf } = args;
  const prefix =
    strong || (highConf && args.overallScore >= 85)
      ? 'Strong candidate — '
      : args.overallScore >= 80
        ? 'Good overall score — '
        : args.overallScore >= 70
          ? 'Mixed/borderline band — '
          : 'Weak band — ';

  const unk = hasComplianceUnknown(flags);
  const bgUnk = flags.includes('background_unknown');
  const drugUnk = flags.includes('drug_unknown');

  switch (subtype) {
    case 'compliance_unknown':
      if (unk && (strong || args.overallScore >= 90)) {
        if (bgUnk && !drugUnk) return `${prefix}background screening answer unclear; confirm status before advancing.`;
        if (drugUnk && !bgUnk) return `${prefix}drug screening answer unclear; confirm status before advancing.`;
        return `${prefix}drug/background screening unclear; confirm what applies before advancing.`;
      }
      return `${prefix}unknown drug/background response — review (not an auto-rejection signal).`;
    case 'compliance_disclosure': {
      const rs = args.riskSummary;
      const d = rs?.drug?.level;
      const b = rs?.background?.level;
      if (d === 'low' || b === 'low') {
        return `${prefix}minor disclosure on file — quick recruiter pass for role/client fit.`;
      }
      return `${prefix}disclosed drug/background topic — confirm fit for role and client policy.`;
    }
    case 'reliability_attendance':
      return strong
        ? `${prefix}attendance history needs a quick review despite strong answers elsewhere.`
        : `${prefix}attendance or reliability concerns to verify.`;
    case 'reliability_transport':
      return `${prefix}transportation reliability concern — confirm backup plan if needed.`;
    case 'physical_job_fit':
      return `${prefix}physical demands may not match what the candidate prefers — check role fit.`;
    case 'answer_quality':
      return `${prefix}answer quality soft concern — quick detail check if other signals are strong.`;
    case 'borderline_score':
      return `${prefix}score is below the auto-advance bar — assess fit before moving forward.`;
    case 'mixed_review':
    default:
      if (lane === 'strong_check_one') {
        return `${prefix}multiple small signals; pick the dominant concern and confirm one thing.`;
      }
      return `${prefix}not strong enough to auto-advance — may still be usable with recruiter judgment.`;
  }
}

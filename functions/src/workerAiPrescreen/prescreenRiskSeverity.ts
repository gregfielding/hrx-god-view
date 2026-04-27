/**
 * Drug / background risk severity for prescreen scoring (routing + penalties, not legal adjudication).
 * Aligns with product: we surface signals with proportional impact — not flat "risk = fail".
 */

import type { ComplianceConcernLevel } from './prescreenComplianceSemantics';
import {
  isExplicitComplianceAnswer,
  isExplicitDrugBackgroundPassSignal,
  isExplicitBackgroundPassSignal,
  isExplicitUncertaintySignal,
  isLikelyComplianceAdmission,
} from './prescreenBlueCollarHelpers';

/** Four-band model used in penalties + riskSummary. */
export type PrescreenRiskSeverity = 'low' | 'moderate' | 'high' | 'unknown';

export type PrescreenRiskSummaryEntry = {
  level: PrescreenRiskSeverity;
  /** Recruiter-facing explanation (no legal conclusions). */
  reason: string;
};

export type PrescreenRiskSummary = {
  drug: PrescreenRiskSummaryEntry;
  background: PrescreenRiskSummaryEntry;
};

const CURRENT_YEAR = new Date().getFullYear();
/** Screening relevance window (years); offenses described as older are downgraded. */
export const PRESCREEN_OFFENSE_RECENCY_WINDOW_YEARS = 10;

function normText(s: unknown): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Extract a 4-digit year from free text (e.g. "2019", "in 2015"). */
function extractLikelyYear(text: string): number | null {
  const m = normText(text).match(/\b(19|20)\d{2}\b/);
  if (!m) return null;
  const y = Number.parseInt(m[0], 10);
  if (!Number.isFinite(y) || y < 1950 || y > CURRENT_YEAR + 1) return null;
  return y;
}

function yearsAgoFromYear(y: number): number {
  return Math.max(0, CURRENT_YEAR - y);
}

/** Hard-drug / failure-to-test patterns → high concern for staffing screening. */
const DRUG_HIGH_PATTERNS =
  /\b(cocaine|crack|meth|methamphetamine|heroin|fentanyl|opiate|opioids?|iv\s*drug|needle|failed\s+(the\s+)?(drug\s+)?test|fail(ed)?\s+(the\s+)?drug|cannot\s+pass|can't\s+pass|cant\s+pass|will\s+not\s+pass|dirty\s+(test|screen))\b/i;

const DRUG_MARIJUANA_ONLY =
  /\b(weed|marijuana|cannabis|thc|pot\b|cbd|edible|smok(e|ing)\s+weed|only\s+marijuana|just\s+weed)\b/i;

const DRUG_MODERATE_PATTERNS =
  /\b(pill|pills|prescription|benzo|xanax|adderall|percocet|oxy|suboxone|alcohol\s+and\s+drug|dui|dwi)\b/i;

const BG_HIGH_PATTERNS =
  /\b(assault|aggravated|robbery|burglary|weapon|violent|felony|sex\s*offense|domestic\s+violence|kidnapping|manslaughter|murder)\b/i;

const BG_THEFT_FRAUD = /\b(theft|shoplift|embezzlement|fraud|identity\s+fraud|forgery|felony\s+theft)\b/i;

const BG_MODERATE_PATTERNS =
  /\b(misdemeanor|dui|dwi|petty|minor|non[-\s]?violent|weed|marijuana|disorderly|trespass|suspended\s+license)\b/i;

const BG_OUTSIDE_WINDOW =
  /\b(over\s+10\s+years|more\s+than\s+10|15\s+years|20\s+years|long\s+time\s+ago|when\s+i\s+was\s+(a\s+)?(kid|teen|minor))\b/i;

export type DrugSeverityArgs = {
  concernLevel: ComplianceConcernLevel;
  /** Core `drug_screen_detail` or dynamic equivalent context. */
  detailText: string;
};

export type BackgroundSeverityArgs = {
  concernLevel: ComplianceConcernLevel;
  detailText: string;
  /** Optional structured fields if the client collects them later. */
  offenseClass?: string;
  offenseYear?: string;
};

/**
 * Classify drug screening concern into severity using disclosure text heuristics.
 * Dynamic "ability" questions use the same tokens but concern = cannot pass.
 */
export function classifyDrugRiskSeverity(args: DrugSeverityArgs): PrescreenRiskSummaryEntry {
  const { concernLevel } = args;
  const detail = normText(args.detailText);

  if (concernLevel === 'clean') {
    return { level: 'low', reason: 'Screening answer indicates no drug-related disclosure concern.' };
  }
  if (concernLevel === 'uncertain' || concernLevel === 'empty') {
    return {
      level: 'unknown',
      reason: 'Drug screening answer was unclear or missing; treat as unknown until clarified.',
    };
  }

  if (isExplicitUncertaintySignal(detail)) {
    return {
      level: 'unknown',
      reason: 'Drug screening follow-up was uncertain; treat as mild unknown until clarified.',
    };
  }

  if (DRUG_HIGH_PATTERNS.test(detail)) {
    return {
      level: 'high',
      reason: 'Disclosure suggests hard substances or inability to pass required screening; treat as high review priority.',
    };
  }

  if (DRUG_MARIJUANA_ONLY.test(detail) && !DRUG_MODERATE_PATTERNS.test(detail)) {
    return {
      level: 'low',
      reason: 'Disclosure appears limited to cannabis/marijuana; many clients accept with context.',
    };
  }

  if (DRUG_MODERATE_PATTERNS.test(detail)) {
    return {
      level: 'moderate',
      reason: 'Disclosure suggests prescription or mixed substance concerns; needs recruiter context.',
    };
  }

  if (isExplicitDrugBackgroundPassSignal(detail) && !isLikelyComplianceAdmission(detail)) {
    return {
      level: 'low',
      reason: 'Short answer reads as able to pass / clean for screening purposes.',
    };
  }

  if (!detail || detail.length < 4) {
    if (detail && isExplicitComplianceAnswer(detail) && !isLikelyComplianceAdmission(detail)) {
      return {
        level: 'unknown',
        reason: 'Brief screening follow-up; severity unclear—mild unknown (not moderate) for plain one-word replies.',
      };
    }
    return {
      level: 'moderate',
      reason: 'Disclosed concern without enough detail to classify severity; defaulting to moderate review.',
    };
  }

  return {
    level: 'moderate',
    reason: 'Drug disclosure present; severity not clearly low from text; defaulting to moderate review.',
  };
}

/**
 * Classify background concern into severity using disclosure text + optional structured fields.
 */
export function classifyBackgroundRiskSeverity(args: BackgroundSeverityArgs): PrescreenRiskSummaryEntry {
  const { concernLevel } = args;
  const detail = normText(args.detailText);
  const cls = normText(args.offenseClass);

  if (concernLevel === 'clean') {
    return { level: 'low', reason: 'Screening answer indicates no background disclosure concern.' };
  }
  if (concernLevel === 'uncertain' || concernLevel === 'empty') {
    return {
      level: 'unknown',
      reason: 'Background screening answer was unclear or missing; treat as unknown until clarified.',
    };
  }

  const yearFromField = args.offenseYear ? extractLikelyYear(String(args.offenseYear)) : null;
  const yearFromDetail = extractLikelyYear(detail);
  const y = yearFromField ?? yearFromDetail;
  if (y !== null && yearsAgoFromYear(y) > PRESCREEN_OFFENSE_RECENCY_WINDOW_YEARS) {
    return {
      level: 'low',
      reason: `Offense timing appears older than the ${PRESCREEN_OFFENSE_RECENCY_WINDOW_YEARS}-year review window; lower staffing impact for routing.`,
    };
  }

  if (BG_OUTSIDE_WINDOW.test(detail)) {
    return {
      level: 'low',
      reason: 'Candidate described the issue as older / outside a typical recent window; lower routing impact.',
    };
  }

  if (cls.includes('misdemeanor') && !cls.includes('felony')) {
    return {
      level: 'low',
      reason: 'Structured response indicates misdemeanor; often acceptable depending on role/client.',
    };
  }
  if (cls.includes('felony')) {
    return {
      level: 'high',
      reason: 'Structured response indicates felony; needs recruiter review for role/client fit.',
    };
  }

  if (BG_HIGH_PATTERNS.test(detail)) {
    return {
      level: 'high',
      reason: 'Disclosure language suggests serious/violent offenses; high review priority.',
    };
  }

  if (BG_THEFT_FRAUD.test(detail)) {
    return {
      level: 'high',
      reason: 'Disclosure suggests theft/fraud-related records; high review priority for many roles.',
    };
  }

  if (BG_MODERATE_PATTERNS.test(detail)) {
    return {
      level: 'moderate',
      reason: 'Disclosure suggests non-violent or lower-level records; moderate review.',
    };
  }

  if (isExplicitUncertaintySignal(detail)) {
    return {
      level: 'unknown',
      reason: 'Background follow-up was uncertain; treat as mild unknown until clarified.',
    };
  }

  if (
    isExplicitBackgroundPassSignal(detail) &&
    !BG_HIGH_PATTERNS.test(detail) &&
    !BG_THEFT_FRAUD.test(detail) &&
    !isLikelyComplianceAdmission(detail)
  ) {
    return {
      level: 'low',
      reason: 'Short answer reads as clean / no record for screening purposes.',
    };
  }

  if (!detail || detail.length < 4) {
    if (detail && isExplicitComplianceAnswer(detail) && !isLikelyComplianceAdmission(detail)) {
      return {
        level: 'unknown',
        reason: 'Brief background follow-up; severity unclear—mild unknown (not moderate) for plain short replies.',
      };
    }
    return {
      level: 'moderate',
      reason: 'Disclosed concern without enough detail to classify severity; defaulting to moderate review.',
    };
  }

  return {
    level: 'low',
    reason: 'Background disclosure present but not clearly high-severity from text; treating as lower routing impact.',
  };
}

/** Penalty flag names emitted into `flags` / `flagPenalties`. */
export function drugSeverityPenaltyFlag(level: PrescreenRiskSeverity): string | null {
  if (level === 'unknown') return 'drug_unknown';
  if (level === 'low') return 'drug_risk_low';
  if (level === 'moderate') return 'drug_risk_moderate';
  if (level === 'high') return 'drug_risk_high';
  return null;
}

export function backgroundSeverityPenaltyFlag(level: PrescreenRiskSeverity): string | null {
  if (level === 'unknown') return 'background_unknown';
  if (level === 'low') return 'background_risk_low';
  if (level === 'moderate') return 'background_risk_moderate';
  if (level === 'high') return 'background_risk_high';
  return null;
}

/** True if any drug/bg severity flag should drive "compliance review" routing (moderate+ or unknown). */
export function hasDrugBgComplianceReview(flags: string[]): boolean {
  return flags.some((f) =>
    [
      'drug_risk_moderate',
      'drug_risk_high',
      'drug_unknown',
      'background_risk_moderate',
      'background_risk_high',
      'background_unknown',
    ].includes(f),
  );
}

/** Any drug/bg axis produced a screening signal (including low severity). */
export function hasAnyDrugBgScreeningFlag(flags: string[]): boolean {
  return flags.some(
    (f) =>
      f.startsWith('drug_risk_') ||
      f.startsWith('background_risk_') ||
      f === 'drug_unknown' ||
      f === 'background_unknown',
  );
}

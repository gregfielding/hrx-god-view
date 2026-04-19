/**
 * Human-readable score intelligence for recruiter decision support (pre-screen + profile context).
 */

export type ScoreIntelligence = {
  summary: {
    /** Interview layer: how answers scored (base / raw interview). */
    interviewScore: number;
    /** Operational layer: recruiter-trust score (adjusted / override). */
    operationalScore: number;
    scoreDelta: number | null;

    /** @deprecated use operationalScore — kept for quick greps during migration */
    score: number;

    /** Mapped from `ai.recommendation`. */
    recommendation: 'advance' | 'review' | 'reject' | null;
    /** Mapped from `ai.hiringDecision.decision`. */
    hiringDecision: 'advance' | 'review' | 'reject' | null;

    autoAdvanceEligible: boolean | null;

    decision: 'advance' | 'review' | 'reject';
    confidence: 'low' | 'medium' | 'high';

    /** When true, stored operational overrides already applied — do not imply a hypothetical override. */
    operationalCorrectionApplied: boolean;
    operationalCorrectionLines: string[];

    /** When true, fundamentals suggest manual review may be appropriate despite a reject-style outcome (pre-correction path only). */
    overrideSuggested?: boolean;
    /** When override is suggested, the panel recommends this next step. */
    suggestedDecision?: 'advance' | 'review' | 'reject';

    /** Shared with interview modal / provenance strip */
    adjustmentSummaryLines: string[];
    autoAdvanceBlockedReasons: string[];
    decisionSourceKey: 'rules_v1' | 'corrected_rules' | 'operational_override';
    decisionSourceLabel: string;
    compositeHiringScoreLabel: string | null;
    /** Same as composite label, numeric for provenance strip */
    compositeHiringScore100: number | null;
    lastUpdatedLabel: string;
    /** Provenance strip — true when base interview score differs from operational score */
    correctionAppliedDisplay: boolean;
  };

  strengths: string[];
  risks: string[];

  breakdown: {
    experience: number;
    reliability: number;
    transportation: number;
    physical: number;
    risk: number;
  };

  reasoning: string[];
  improvements: string[];
};

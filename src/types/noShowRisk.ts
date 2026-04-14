/**
 * No-show risk: application (`aiAutomation.noShowRisk`) vs assignment (`noShowRiskPredictionV1`).
 */

export type NoShowRiskBand = 'low' | 'moderate' | 'high' | 'critical';

export type ApplicationNoShowRisk = {
  engineVersion: number;
  score: number;
  band: NoShowRiskBand;
  reasons: string[];
  recommendedAction: string;
  computedAt?: unknown;
};

export type NoShowRiskPredictionV1 = ApplicationNoShowRisk & {
  adjustments?: {
    applicationBase: number;
    shiftStress: number;
    readiness: number;
    commute: number;
    confirmation: number;
  };
  computedAt?: unknown;
};

/** Canonical attendance outcome for analytics and future model training. */
export type AssignmentAttendanceOutcome =
  | 'unknown'
  | 'showed'
  | 'no_show'
  | 'late'
  | 'cancelled_worker'
  | 'cancelled_client';

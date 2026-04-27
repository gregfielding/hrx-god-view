/**
 * Rules-based no-show risk: application layer + assignment layer (transparent scoring).
 * Lives under `readiness/` so triggers do not synchronously import `workerAiPrescreen/*`.
 */

/** Same shape as `interviewAiEnrichment.InterviewRiskProfile` (inlined to avoid cross-package imports). */
export type InterviewRiskProfileLite = {
  complianceRisk: number;
  attendanceRisk: number;
  transportationRisk: number;
};

/** Minimal readiness shape for no-show adjustment (matches `readinessSnapshotV1.summary`). */
export type ReadinessSummaryLike = { summary?: { blockers?: number; warnings?: number } };

export const NO_SHOW_RISK_ENGINE_VERSION = 1;

export type NoShowRiskBand = 'low' | 'moderate' | 'high' | 'critical';

export type ApplicationNoShowRiskStored = {
  engineVersion: number;
  score: number;
  band: NoShowRiskBand;
  reasons: string[];
  recommendedAction: string;
  computedAt?: unknown;
};

export type NoShowRiskPredictionV1Stored = ApplicationNoShowRiskStored & {
  adjustments?: {
    applicationBase: number;
    shiftStress: number;
    readiness: number;
    commute: number;
    confirmation: number;
  };
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function bandFromScore(score: number): NoShowRiskBand {
  if (score <= 24) return 'low';
  if (score <= 49) return 'moderate';
  if (score <= 74) return 'high';
  return 'critical';
}

function recommendedActionFromBand(band: NoShowRiskBand): string {
  if (band === 'low') return 'proceed';
  if (band === 'moderate') return 'confirm_availability_and_transport';
  if (band === 'high') return 'manual_review_before_placement';
  return 'do_not_auto_place';
}

/**
 * Application-level no-show risk (hiring / pipeline). Uses riskProfile + interview flags + optional reminder/profile signals.
 */
export function computeApplicationNoShowRisk(args: {
  riskProfile: InterviewRiskProfileLite;
  flags: string[];
  applicationFields?: Record<string, unknown>;
  completenessScore?: number | null;
}): Omit<ApplicationNoShowRiskStored, 'engineVersion'> & { engineVersion: number } {
  const { riskProfile, flags, applicationFields = {}, completenessScore } = args;
  const C = riskProfile.complianceRisk;
  const A = riskProfile.attendanceRisk;
  const T = riskProfile.transportationRisk;

  let score = 100 * (0.45 * C + 0.35 * A + 0.2 * T);
  const reasons: string[] = [];

  const elevatedDrug = (f: string) =>
    ['drug_risk_moderate', 'drug_risk_high', 'drug_unknown', 'drug_risk'].includes(f);
  const elevatedBg = (f: string) =>
    ['background_risk_moderate', 'background_risk_high', 'background_unknown', 'background_risk'].includes(f);
  const hasDrugElev = flags.some(elevatedDrug);
  const hasBgElev = flags.some(elevatedBg);
  /** Low-severity-only disclosures do not raise the no-show floor (legacy `drug_risk`/`background_risk` treated as elevated). */
  if (hasDrugElev || hasBgElev) {
    score = Math.max(score, 78);
    reasons.push('floor:drug_or_background_elevated');
  }
  if (hasDrugElev && hasBgElev) {
    score = Math.max(score, 88);
    reasons.push('floor:drug_and_background_elevated');
  }
  if (C >= 0.75) {
    score = Math.max(score, 72);
    reasons.push('floor:high_compliance_risk');
  }

  let qualityAdj = 0;
  if (flags.includes('low_effort_response')) {
    qualityAdj += 10;
    reasons.push('quality:low_effort_response');
  }
  if (flags.includes('vague_response')) {
    qualityAdj += 7;
    reasons.push('quality:vague_response');
  }
  qualityAdj = Math.min(15, qualityAdj);
  score += qualityAdj;

  if (flags.includes('strong_candidate_signal')) {
    score -= 8;
    reasons.push('mitigation:strong_candidate_signal');
  }
  if (flags.includes('high_confidence_candidate')) {
    score -= 6;
    reasons.push('mitigation:high_confidence_candidate');
  }

  const fuSent = applicationFields.workerAiPrescreenFollowUpInviteSentAt;
  const fuPending = applicationFields.workerAiPrescreenFollowUpPending === true;
  if (fuSent || fuPending) {
    score += 12;
    reasons.push('behavior:second_wave_followup');
  }

  if (typeof completenessScore === 'number' && Number.isFinite(completenessScore)) {
    const profileAdj = Math.max(0, 12 - 0.12 * completenessScore);
    score += profileAdj;
    if (profileAdj >= 2) reasons.push('profile:low_completeness');
  }

  score = clamp(score, 0, 100);
  const band = bandFromScore(score);
  return {
    engineVersion: NO_SHOW_RISK_ENGINE_VERSION,
    score,
    band,
    reasons,
    recommendedAction: recommendedActionFromBand(band),
  };
}

export function parseStartTimeToMinutes(startTime: unknown): number | null {
  const s = String(startTime ?? '').trim();
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function computeShiftStressAdjustment(startTime: unknown): { points: number; reasons: string[] } {
  const mins = parseStartTimeToMinutes(startTime);
  if (mins == null) return { points: 0, reasons: [] };
  const reasons: string[] = [];
  let points = 0;
  if (mins < 6 * 60) {
    points += 12;
    reasons.push('shift:early_morning');
  }
  if (mins >= 22 * 60) {
    points += 10;
    reasons.push('shift:late_night_start');
  }
  return { points, reasons };
}

export function computeReadinessAdjustment(snapshot: ReadinessSummaryLike | null | undefined): {
  points: number;
  reasons: string[];
} {
  if (!snapshot?.summary) return { points: 0, reasons: [] };
  const b = snapshot.summary.blockers ?? 0;
  const w = snapshot.summary.warnings ?? 0;
  const points = clamp(b * 8 + w * 3, 0, 28);
  const reasons: string[] = [];
  if (b > 0) reasons.push(`readiness:blockers_${b}`);
  if (w > 0) reasons.push(`readiness:warnings_${w}`);
  return { points, reasons };
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function computeCommuteAdjustmentKm(km: number | null): { points: number; reasons: string[] } {
  if (km == null || !Number.isFinite(km)) return { points: 0, reasons: [] };
  let points = 0;
  const reasons: string[] = [];
  if (km > 50) {
    points += 12;
    reasons.push('commute:over_50km');
  } else if (km > 35) {
    points += 8;
    reasons.push('commute:over_35km');
  } else if (km > 20) {
    points += 5;
    reasons.push('commute:over_20km');
  }
  return { points, reasons };
}

function isConfirmedStatus(status: unknown): boolean {
  const s = String(status ?? '').toLowerCase();
  return s === 'confirmed' || s === 'active';
}

export function computeNoShowRiskForAssignment(context: {
  applicationNoShowRisk: Pick<ApplicationNoShowRiskStored, 'score'> | null;
  assignment: Record<string, unknown>;
  readinessSnapshotV1?: ReadinessSummaryLike | null;
  commuteKm?: number | null;
}): NoShowRiskPredictionV1Stored {
  const baseScore =
    context.applicationNoShowRisk?.score != null && Number.isFinite(context.applicationNoShowRisk.score)
      ? Number(context.applicationNoShowRisk.score)
      : 50;

  const shift = computeShiftStressAdjustment(context.assignment.startTime);
  const readiness = computeReadinessAdjustment(context.readinessSnapshotV1);
  const commute = computeCommuteAdjustmentKm(
    context.commuteKm == null || !Number.isFinite(context.commuteKm) ? null : context.commuteKm,
  );

  let confirmation = 0;
  const confReasons: string[] = [];
  if (context.assignment.confirmedAt && isConfirmedStatus(context.assignment.status)) {
    confirmation = -6;
    confReasons.push('confirmation:worker_confirmed');
  }

  let score = baseScore + shift.points + readiness.points + commute.points + confirmation;
  score = clamp(score, 0, 100);

  const reasons = [
    `base:application_${Math.round(baseScore)}`,
    ...shift.reasons,
    ...readiness.reasons,
    ...commute.reasons,
    ...confReasons,
  ];

  const band = bandFromScore(score);
  return {
    engineVersion: NO_SHOW_RISK_ENGINE_VERSION,
    score,
    band,
    reasons,
    recommendedAction: recommendedActionFromBand(band),
    adjustments: {
      applicationBase: baseScore,
      shiftStress: shift.points,
      readiness: readiness.points,
      commute: commute.points,
      confirmation,
    },
  };
}

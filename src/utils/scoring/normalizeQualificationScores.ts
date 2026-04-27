/**
 * QUALIFICATION SCORE DISPLAY — LOCKED
 *
 * All UI surfaces for the five interview qualification dimensions (experience, reliability,
 * transportation, risk, physical) must use:
 * - {@link rawQualificationPointsToPercentages} when starting from raw segment points, then
 * - {@link normalizeQualificationScores}, then
 * - {@link qualificationBarDisplayPercent} for `LinearProgress` / bar **value** props.
 *
 * Raw values must NEVER be used directly for bar widths (no ad-hoc `(value / max) * 100` for these bars).
 * This prevents physical score dominance and keeps visual weighting consistent across surfaces.
 *
 * @see qualificationDisplayOrder.ts — display order (risk-first).
 */

export type RawQualificationScores = {
  experience: number;
  reliability: number;
  transport: number;
  risk: number;
  physical: number;
};

export type NormalizedQualificationScores = RawQualificationScores;

/** Display bar width cap — no category may use the full track (stops any one signal from visually overwhelming). */
export const QUALIFICATION_BAR_WIDTH_CAP = 85;

/**
 * Physical is intentionally capped below other categories’ **display** percentages
 * to prevent visual over-weighting of strength vs reliability / risk.
 */
export const PHYSICAL_DISPLAY_CAP = 85;

/**
 * Severity for qualification bar color (operational risk emphasis).
 * &lt; LOW_THRESHOLD = high concern (red).
 * LOW_THRESHOLD .. MID_THRESHOLD-1 = caution (amber).
 */
export const QUALIFICATION_SCORE_LOW_THRESHOLD = 25;

export const QUALIFICATION_SCORE_MID_THRESHOLD = 40;

export function qualificationSeverityBand(displayPercent: number): 'strong' | 'mid' | 'ok' {
  if (displayPercent < QUALIFICATION_SCORE_LOW_THRESHOLD) return 'strong';
  if (displayPercent < QUALIFICATION_SCORE_MID_THRESHOLD) return 'mid';
  return 'ok';
}

/**
 * Soft-cap physical on a 0–100 display scale so it cannot visually dominate other categories.
 * Other categories pass through unchanged.
 */
export function normalizeQualificationScores(raw: RawQualificationScores): NormalizedQualificationScores {
  const physical = Math.min(raw.physical, PHYSICAL_DISPLAY_CAP);

  return {
    experience: raw.experience,
    reliability: raw.reliability,
    transport: raw.transport,
    risk: raw.risk,
    physical,
  };
}

/** Max raw points per breakdown segment — must match `ScoreIntelligence.breakdown` / interview model. */
export const QUALIFICATION_BREAKDOWN_RAW_MAX = {
  experience: 25,
  reliability: 25,
  transportation: 20,
  risk: 20,
  physical: 10,
} as const;

/** Convert raw segment points to comparable 0–100 percentages (display input for {@link normalizeQualificationScores}). */
export function rawQualificationPointsToPercentages(raw: {
  experience: number;
  reliability: number;
  transportation: number;
  risk: number;
  physical: number;
}): RawQualificationScores {
  const pct = (value: number, max: number) => {
    if (max <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
  };
  const m = QUALIFICATION_BREAKDOWN_RAW_MAX;
  return {
    experience: pct(raw.experience, m.experience),
    reliability: pct(raw.reliability, m.reliability),
    transport: pct(raw.transportation, m.transportation),
    risk: pct(raw.risk, m.risk),
    physical: pct(raw.physical, m.physical),
  };
}

/**
 * Bar width for `LinearProgress` — **only** pass values returned here (after {@link normalizeQualificationScores}).
 * Caps width so no category visually fills 100% of the track.
 */
export function qualificationBarDisplayPercent(normalizedCategoryPercent: number): number {
  return Math.min(normalizedCategoryPercent, QUALIFICATION_BAR_WIDTH_CAP);
}

/**
 * Map persisted interview `subScores` values (0–10 or 0–100) to a single 0–100 display scale.
 * Used before {@link normalizeQualificationScores} for overview / snapshot UIs.
 */
export function normalizeQualificationSubScoreValue(raw: unknown): number | null {
  let n: number | null = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
  if (n != null && n <= 10 && n >= 0) n = Math.round(n * 10);
  if (n != null) n = Math.max(0, Math.min(100, n));
  return n;
}

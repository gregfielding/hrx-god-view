/**
 * Tier promotion scoring — the ONE scorer used by both the Settings → Tier
 * automation page (web) and the nightly sweep riding scheduledScoringDistribution
 * (functions). Pure module: no Firebase imports, mirrored byte-identical in
 * shared/, src/shared/, functions/src/shared/.
 *
 * Policy (docs/claude/project_tiered_shift_access.md, 8/31 agreed spec +
 * Greg 2026-09-04): AI/threshold promotion moves Tier 3 → Tier 2 ONLY, never
 * to Tier 1 (manual). "Be picky" — defaults keep the threshold high, and a
 * worker with no completed interview cannot cross it on profile polish alone.
 * The app-install factor takes effect 2026-10-01 (TestFlight-only before then;
 * scoring it earlier would suppress every promotion).
 */

export type TierAutomationMode = 'off' | 'propose' | 'automatic';

export interface TierAutomationPoints {
  /** Scaled by the 0-100 profile completeness score. */
  profileCompletion: number;
  /** Scaled by the 0-100 interview score (recruiterScoreSnapshot precedence). */
  interviewScore: number;
  resume: number;
  /** Full at 3+ skills, half at 1-2. */
  skills: number;
  profilePhoto: number;
  /** iOS/Android push token present. Zero before `appInstalledEffectiveFrom`. */
  appInstalled: number;
  /** Completed + clear (Greg 2026-09-04: strong "serious about working" signal). */
  backgroundCheck: number;
  /** Completed + negative. */
  drugScreen: number;
}

export interface TierAutomationConfig {
  mode: TierAutomationMode;
  /** Promotion fires at total >= threshold. */
  threshold: number;
  points: TierAutomationPoints;
  /** ISO date (YYYY-MM-DD); the appInstalled factor scores 0 before this day. */
  appInstalledEffectiveFrom: string;
}

export const DEFAULT_TIER_AUTOMATION_CONFIG: TierAutomationConfig = {
  mode: 'propose',
  threshold: 70,
  points: {
    profileCompletion: 25,
    interviewScore: 25,
    resume: 10,
    skills: 10,
    profilePhoto: 5,
    appInstalled: 5,
    backgroundCheck: 10,
    drugScreen: 10,
  },
  appInstalledEffectiveFrom: '2026-10-01',
};

export const TIER_FACTOR_LABELS: Record<keyof TierAutomationPoints, string> = {
  profileCompletion: 'Profile completion',
  interviewScore: 'Interview score',
  resume: 'Resume uploaded',
  skills: 'Job skills',
  profilePhoto: 'Profile photo',
  appInstalled: 'App installed',
  backgroundCheck: 'Background check clear',
  drugScreen: 'Drug screen clear',
};

/** Normalized inputs the scorer runs on — extraction lives separately. */
export interface TierScoreSignals {
  /** 0-100 or null when nothing usable exists. */
  profileScore100: number | null;
  /** 0-100 or null when no completed interview. */
  interviewScore100: number | null;
  hasResume: boolean;
  skillsCount: number;
  hasProfilePhoto: boolean;
  /**
   * iOS/Android push token registered. Server-only signal (pushTokens
   * subcollection is worker-readable only); null = not checked, scores 0.
   */
  appInstalled: boolean | null;
  backgroundCheckClear: boolean;
  drugScreenClear: boolean;
}

export interface TierScoreFactor {
  key: keyof TierAutomationPoints;
  label: string;
  earned: number;
  max: number;
  detail: string;
}

export interface TierScorecard {
  total: number;
  maxPossible: number;
  threshold: number;
  qualifies: boolean;
  factors: TierScoreFactor[];
}

function clamp100(n: unknown): number | null {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return null;
  return Math.max(0, Math.min(100, v));
}

function nonEmpty(v: unknown): boolean {
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * Clear/denied token matching, same semantics as isVerifiedResult
 * (src/utils/jobRequirementStatus.ts) — denied tokens always win.
 */
const DENIED_RE = /cancell?ed|failed|denied|rejected|expired|incomplete|positive/i;
const CLEAR_RE = /verified|completed?|passed|\bclear\b|authorized|negative/i;

function orderIsClear(order: unknown): boolean {
  if (!order || typeof order !== 'object') return false;
  const o = order as Record<string, unknown>;
  const hay = `${String(o.status ?? '')} ${String(o.result ?? '')}`;
  if (DENIED_RE.test(hay)) return false;
  return CLEAR_RE.test(hay);
}

function complianceIsClear(entry: unknown): boolean {
  return orderIsClear(entry);
}

/**
 * Pull scorecard signals off a raw `users/{uid}` doc. `appInstalled` cannot be
 * derived from the doc (pushTokens is a subcollection) — the sweep passes it
 * when checked; the web review UI shows whatever the proposal recorded.
 *
 * v1 reads user-doc screening fields only (backgroundCheckOrders /
 * drugScreeningOrders / workerCompliance). AccuSource `backgroundChecks` docs
 * are not consulted yet — TODO fold the CLEARED band in server-side.
 */
export function extractTierScoreSignals(
  userData: Record<string, unknown>,
  opts: { appInstalled?: boolean | null } = {},
): TierScoreSignals {
  const scoreSummary = (userData.scoreSummary ?? {}) as Record<string, unknown>;
  const snapshot = (userData.recruiterScoreSnapshot ?? {}) as Record<string, unknown>;

  const profileScore100 =
    clamp100(scoreSummary.completenessScore) ?? clamp100(userData.aiProfileScore);

  // recruiterScoreSnapshot is the canonical interview read; scoreSummary
  // fallbacks match src/shared/recruiterMasterScore.ts precedence. NOTE
  // interviewLastScore10 is 0-10, everything else 0-100.
  const last10 = clamp100(scoreSummary.interviewLastScore10);
  const interviewScore100 =
    clamp100(snapshot.interviewScoreBase100) ??
    clamp100(scoreSummary.overrideAdjustedScore) ??
    clamp100(scoreSummary.baseInterviewScore) ??
    (last10 != null && last10 <= 10 ? last10 * 10 : last10);

  const resume = (userData.resume ?? null) as Record<string, unknown> | null;
  const hasResume = Boolean(resume && (nonEmpty(resume.downloadUrl) || nonEmpty(resume.storagePath)));

  const skills = Array.isArray(userData.skills) ? userData.skills : [];

  const compliance = (userData.workerCompliance ?? {}) as Record<string, unknown>;
  const bgOrders = Array.isArray(userData.backgroundCheckOrders) ? userData.backgroundCheckOrders : [];
  const drugOrders = Array.isArray(userData.drugScreeningOrders) ? userData.drugScreeningOrders : [];

  return {
    profileScore100,
    interviewScore100,
    hasResume,
    skillsCount: skills.filter((s) => nonEmpty(s)).length,
    hasProfilePhoto: nonEmpty(userData.avatar),
    appInstalled: opts.appInstalled ?? null,
    backgroundCheckClear:
      bgOrders.some(orderIsClear) || complianceIsClear(compliance.backgroundCheck),
    drugScreenClear: drugOrders.some(orderIsClear) || complianceIsClear(compliance.drugScreen),
  };
}

export function scoreTierPromotion(
  signals: TierScoreSignals,
  config: TierAutomationConfig,
  now: Date = new Date(),
): TierScorecard {
  const p = config.points;
  const factors: TierScoreFactor[] = [];

  const profile = signals.profileScore100;
  factors.push({
    key: 'profileCompletion',
    label: TIER_FACTOR_LABELS.profileCompletion,
    earned: profile != null ? Math.round((p.profileCompletion * profile) / 100) : 0,
    max: p.profileCompletion,
    detail: profile != null ? `${Math.round(profile)}/100` : 'no score',
  });

  const interview = signals.interviewScore100;
  factors.push({
    key: 'interviewScore',
    label: TIER_FACTOR_LABELS.interviewScore,
    earned: interview != null ? Math.round((p.interviewScore * interview) / 100) : 0,
    max: p.interviewScore,
    detail: interview != null ? `${Math.round(interview)}/100` : 'no interview',
  });

  factors.push({
    key: 'resume',
    label: TIER_FACTOR_LABELS.resume,
    earned: signals.hasResume ? p.resume : 0,
    max: p.resume,
    detail: signals.hasResume ? 'on file' : 'missing',
  });

  const skillsEarned =
    signals.skillsCount >= 3 ? p.skills : signals.skillsCount > 0 ? Math.round(p.skills / 2) : 0;
  factors.push({
    key: 'skills',
    label: TIER_FACTOR_LABELS.skills,
    earned: skillsEarned,
    max: p.skills,
    detail: `${signals.skillsCount} listed`,
  });

  factors.push({
    key: 'profilePhoto',
    label: TIER_FACTOR_LABELS.profilePhoto,
    earned: signals.hasProfilePhoto ? p.profilePhoto : 0,
    max: p.profilePhoto,
    detail: signals.hasProfilePhoto ? 'yes' : 'no',
  });

  const appActive = now.toISOString().slice(0, 10) >= config.appInstalledEffectiveFrom;
  factors.push({
    key: 'appInstalled',
    label: TIER_FACTOR_LABELS.appInstalled,
    earned: appActive && signals.appInstalled === true ? p.appInstalled : 0,
    max: p.appInstalled,
    detail: !appActive
      ? `starts ${config.appInstalledEffectiveFrom}`
      : signals.appInstalled === true
        ? 'yes'
        : signals.appInstalled === false
          ? 'no'
          : 'not checked',
  });

  factors.push({
    key: 'backgroundCheck',
    label: TIER_FACTOR_LABELS.backgroundCheck,
    earned: signals.backgroundCheckClear ? p.backgroundCheck : 0,
    max: p.backgroundCheck,
    detail: signals.backgroundCheckClear ? 'clear' : 'none/not clear',
  });

  factors.push({
    key: 'drugScreen',
    label: TIER_FACTOR_LABELS.drugScreen,
    earned: signals.drugScreenClear ? p.drugScreen : 0,
    max: p.drugScreen,
    detail: signals.drugScreenClear ? 'clear' : 'none/not clear',
  });

  const total = factors.reduce((s, f) => s + f.earned, 0);
  const maxPossible = factors.reduce((s, f) => s + f.max, 0);
  return {
    total,
    maxPossible,
    threshold: config.threshold,
    qualifies: total >= config.threshold,
    factors,
  };
}

/** Merge a stored settings doc over the defaults, tolerating partial/legacy shapes. */
export function normalizeTierAutomationConfig(raw: unknown): TierAutomationConfig {
  const d = DEFAULT_TIER_AUTOMATION_CONFIG;
  if (!raw || typeof raw !== 'object') return { ...d, points: { ...d.points } };
  const obj = raw as Record<string, unknown>;
  const rp = (obj.points ?? {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number) => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
  };
  const mode: TierAutomationMode =
    obj.mode === 'off' || obj.mode === 'automatic' ? obj.mode : 'propose';
  return {
    mode,
    threshold: num(obj.threshold, d.threshold),
    points: {
      profileCompletion: num(rp.profileCompletion, d.points.profileCompletion),
      interviewScore: num(rp.interviewScore, d.points.interviewScore),
      resume: num(rp.resume, d.points.resume),
      skills: num(rp.skills, d.points.skills),
      profilePhoto: num(rp.profilePhoto, d.points.profilePhoto),
      appInstalled: num(rp.appInstalled, d.points.appInstalled),
      backgroundCheck: num(rp.backgroundCheck, d.points.backgroundCheck),
      drugScreen: num(rp.drugScreen, d.points.drugScreen),
    },
    appInstalledEffectiveFrom:
      typeof obj.appInstalledEffectiveFrom === 'string' && obj.appInstalledEffectiveFrom
        ? obj.appInstalledEffectiveFrom
        : d.appInstalledEffectiveFrom,
  };
}

/**
 * Job Match Score v1 — Scoring rubric implementation.
 * Formula: jobScore = 0.80 * RequirementsScore + 0.20 * HiringLift
 * RequirementsScore = Licenses(30) + Experience(25) + Education(15) + Shift(20) + Language(5) + Physical(5)
 */
import type { JobScoreSummaryV1, RequirementImportance, RequirementPackV1 } from '../types/jobScore';
import { getRequirementPackV1 } from '../data/jobRequirementPacksV1';
import { coerceToMillis } from './onboardingExpiration';

/** User doc shape for v1 (extends base with languages). */
export interface UserDocForJobScoreV1 {
  certifications?: Array<{ name?: string } | string>;
  workExperience?: any[];
  workHistory?: any[];
  education?: any[];
  preferences?: { shiftPreferences?: string[] };
  languages?: string[];
  [key: string]: any;
}

// ——— Education rank (spec 5.3) ———
const EDUCATION_RANK: Record<string, number> = {
  none: 0,
  hs: 1,
  high_school: 1,
  'high school': 1,
  aa: 2,
  trade: 2,
  associate: 2,
  ba: 3,
  bs: 3,
  bachelors: 3,
  ma: 4,
  ms: 4,
  masters: 4,
  doctorate: 5,
  phd: 5,
};

function normalizeEducationRank(level: string): number {
  const key = String(level || '').toLowerCase().replace(/\s+/g, '_');
  return EDUCATION_RANK[key] ?? 0;
}

function getWorkerEducationRank(education: any[] | undefined): number {
  if (!Array.isArray(education) || education.length === 0) return 0;
  let maxRank = 0;
  for (const e of education) {
    const level = typeof e === 'object' && e != null ? (e as any).level ?? (e as any).degree ?? (e as any).educationLevel : e;
    const rank = normalizeEducationRank(String(level ?? ''));
    if (rank > maxRank) maxRank = rank;
  }
  return maxRank;
}

// ——— Experience years band (spec 5.2) ———
const EXPERIENCE_BAND_YEARS: Record<string, number> = {
  entry: 0,
  '0-1': 1,
  '1-2': 2,
  '3-5': 5,
  '5+': 6,
};

function normalizeRequiredExperienceYears(levels: string[]): number {
  if (!levels || levels.length === 0) return 0;
  let maxYears = 0;
  for (const level of levels) {
    const key = String(level || '').toLowerCase().replace(/\s+/g, '');
    const y = EXPERIENCE_BAND_YEARS[key] ?? (key === 'entry' ? 0 : 1);
    if (y > maxYears) maxYears = y;
  }
  return maxYears;
}

function getWorkerExperienceYears(work: any[] | undefined): number {
  const list = work ?? [];
  if (!Array.isArray(list) || list.length === 0) return 0;
  let totalYears = 0;
  for (const entry of list) {
    const start = (entry as any).startDate ?? (entry as any).start;
    const end = (entry as any).endDate ?? (entry as any).end ?? new Date();
    if (start) {
      const s = typeof start === 'string' ? new Date(start) : start?.toDate?.() ?? start;
      const e = typeof end === 'string' ? new Date(end) : end?.toDate?.() ?? end;
      const years = (e.getTime() - s.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      totalYears += Math.max(0, years);
    }
  }
  return Math.min(6, Math.round(totalYears * 10) / 10);
}

// ——— Cert names (worker) ———
function getWorkerCertNames(user: UserDocForJobScoreV1): string[] {
  const c = user?.certifications;
  if (!Array.isArray(c)) return [];
  return c.map((x) => (typeof x === 'string' ? x : (x as any)?.name ?? '')).filter(Boolean);
}

// ——— Shift overlap ———
function getWorkerShiftPreferences(user: UserDocForJobScoreV1): string[] {
  const p = user?.preferences?.shiftPreferences;
  return Array.isArray(p) ? p : [];
}

function normalizeShiftLabel(s: string): string {
  return String(s || '').trim().toLowerCase();
}

function shiftOverlapCount(required: string[], worker: string[]): number {
  if (!required?.length) return 0;
  const set = new Set(worker.map(normalizeShiftLabel));
  return required.filter((r) => set.has(normalizeShiftLabel(r))).length;
}

// ——— Language ———
function getWorkerLanguages(user: UserDocForJobScoreV1): string[] {
  const l = user?.languages;
  return Array.isArray(l) ? l.map((x) => String(x).toLowerCase().trim()) : [];
}

function hasAllLanguages(required: string[], worker: string[]): boolean {
  if (!required?.length) return true;
  const set = new Set(worker);
  return required.every((r) => set.has(r.toLowerCase().trim()));
}

// ——— Section IDs for nextActions ———
const SECTION_IDS = {
  certifications: 'readiness-certifications',
  experience: 'readiness-experience',
  education: 'readiness-education',
  availability: 'readiness-availability',
  languages: 'readiness-skills-languages',
} as const;

const WEIGHTS = {
  licenses: 30,
  experience: 25,
  education: 15,
  shift: 20,
  language: 5,
  physical: 5,
} as const;

const REQUIREMENTS_MAX = 100;

function clamp(num: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, num));
}

/**
 * Determine if a stored v1 job score snapshot is stale (v1.1).
 * Stale if: profile updated after compute, or pack version changed, or hiring score moved ≥10.
 * Reads profileUpdatedAt/updatedAt as unknown and uses coerceToMillis so TS stays strict and
 * we handle Firestore Timestamp, ISO string, number millis, or missing safely.
 */
export function computeJobScoreStale(
  stored: JobScoreSummaryV1,
  userDoc: Record<string, unknown> | null,
  currentPackVersion: number | undefined,
  currentAiScore: number | undefined
): JobScoreSummaryV1['stale'] | undefined {
  const reasons: ('profileChanged' | 'requirementPackChanged' | 'aiScoreChanged')[] = [];

  const profileUpdatedAt: unknown = userDoc?.profileUpdatedAt;
  const updatedAt: unknown = userDoc?.updatedAt;
  const profileUpdated =
    userDoc != null
      ? Math.max(coerceToMillis(profileUpdatedAt), coerceToMillis(updatedAt))
      : -1;

  const computedAt = coerceToMillis(stored.computedAt);

  if (profileUpdated > 0 && computedAt > 0 && profileUpdated > computedAt) reasons.push('profileChanged');
  const storedVer = stored.requirementPackVersion ?? 0;
  if (typeof currentPackVersion === 'number' && currentPackVersion !== storedVer) reasons.push('requirementPackChanged');
  const storedAi = stored.inputs?.aiScoreAtCompute;
  if (typeof currentAiScore === 'number' && typeof storedAi === 'number' && Math.abs(currentAiScore - storedAi) >= 10) reasons.push('aiScoreChanged');
  if (reasons.length === 0) return undefined;
  return { isStale: true, reasons };
}

/**
 * Compute Job Match Score v1 and full summary.
 */
export function computeJobScoreSummaryV1(
  userDoc: UserDocForJobScoreV1 | null,
  requirementPackId: string,
  aiScoreAtCompute: number | undefined,
  computedAt: any,
  options?: { capIneligibleAt49?: boolean; userProfileUpdatedAt?: any }
): JobScoreSummaryV1 | null {
  const pack = getRequirementPackV1(requirementPackId);
  if (!pack) return null;

  const capIneligible = options?.capIneligibleAt49 !== false;
  const user = userDoc ?? ({} as UserDocForJobScoreV1);
  const imp = pack.importance ?? {};

  const gates: { label: string; status: 'pass' | 'fail'; reason?: string }[] = [];
  const missingRequired: { key: string; label: string; sectionId?: string; reason?: string }[] = [];
  const missingOptional: { key: string; label: string; sectionId?: string; reason?: string }[] = [];
  const matched: { key: string; label: string }[] = [];
  const nextActions: { label: string; sectionId?: string; priority: 1 | 2 | 3 }[] = [];

  let requirementsScore = 0;
  let eligible = true;

  // ——— 5.1 Licenses & Certifications (30) ———
  const requiredCerts = pack.requiredCerts ?? [];
  const workerCerts = getWorkerCertNames(user);
  const certImportance = imp.licenses ?? 'hard';

  if (requiredCerts.length === 0) {
    requirementsScore += WEIGHTS.licenses;
    matched.push({ key: 'licenses', label: 'Licenses/Certifications' });
  } else {
    const metCount = requiredCerts.filter((req) =>
      workerCerts.some((c) => c.toLowerCase().includes(req.toLowerCase()) || req.toLowerCase().includes(c.toLowerCase()))
    ).length;
    const ratio = metCount / requiredCerts.length;
    const score = WEIGHTS.licenses * ratio;
    requirementsScore += score;
    if (ratio >= 1) {
      matched.push({ key: 'licenses', label: 'Licenses/Certifications' });
    } else {
      const missing = requiredCerts.filter(
        (req) => !workerCerts.some((c) => c.toLowerCase().includes(req.toLowerCase()) || req.toLowerCase().includes(c.toLowerCase()))
      );
      for (const cert of missing) {
        if (certImportance === 'hard') {
          eligible = false;
          missingRequired.push({ key: 'licenses', label: cert, sectionId: SECTION_IDS.certifications, reason: 'Required certification missing' });
          nextActions.push({ label: `Upload ${cert} certification`, sectionId: SECTION_IDS.certifications, priority: 1 });
        } else {
          missingOptional.push({ key: 'licenses', label: cert, sectionId: SECTION_IDS.certifications });
          nextActions.push({ label: `Upload ${cert} certification`, sectionId: SECTION_IDS.certifications, priority: 2 });
        }
      }
    }
  }

  // ——— 5.2 Experience (25) ———
  const requiredExpLevels = pack.requiredExperienceLevels ?? [];
  const requiredYears = normalizeRequiredExperienceYears(requiredExpLevels);
  const workerYears = getWorkerExperienceYears(user.workExperience ?? user.workHistory);
  const expImportance = imp.experience ?? 'scored';

  if (requiredExpLevels.length === 0) {
    requirementsScore += WEIGHTS.experience;
    matched.push({ key: 'experience', label: 'Experience Level' });
  } else {
    if (workerYears <= 0 && requiredYears > 0 && expImportance === 'hard') {
      eligible = false;
      missingRequired.push({ key: 'experience', label: `Experience required (e.g. ${requiredExpLevels.join(', ')})`, sectionId: SECTION_IDS.experience });
      nextActions.push({ label: 'Add work experience', sectionId: SECTION_IDS.experience, priority: 1 });
    } else if (workerYears >= requiredYears) {
      requirementsScore += WEIGHTS.experience;
      matched.push({ key: 'experience', label: 'Experience Level' });
    } else {
      const score = requiredYears > 0 ? WEIGHTS.experience * (workerYears / requiredYears) : 0;
      requirementsScore += clamp(score, 0, WEIGHTS.experience);
      missingOptional.push({ key: 'experience', label: `More experience (${requiredExpLevels.join(', ')})`, sectionId: SECTION_IDS.experience });
      nextActions.push({ label: 'Add work experience', sectionId: SECTION_IDS.experience, priority: 2 });
    }
  }

  // ——— 5.3 Education (15) ———
  const requiredEduLevels = pack.requiredEducationLevels ?? [];
  const requiredRank = requiredEduLevels.length === 0 ? 0 : Math.max(...requiredEduLevels.map(normalizeEducationRank));
  const workerRank = getWorkerEducationRank(user.education);
  const eduImportance = imp.education ?? 'scored';

  if (requiredEduLevels.length === 0) {
    requirementsScore += WEIGHTS.education;
    matched.push({ key: 'education', label: 'Education Level' });
  } else {
    if (workerRank < requiredRank && eduImportance === 'hard') {
      eligible = false;
      missingRequired.push({ key: 'education', label: `Education (e.g. ${requiredEduLevels.join(', ')})`, sectionId: SECTION_IDS.education });
      nextActions.push({ label: 'Add education', sectionId: SECTION_IDS.education, priority: 1 });
    } else if (workerRank >= requiredRank) {
      requirementsScore += WEIGHTS.education;
      matched.push({ key: 'education', label: 'Education Level' });
    } else {
      const score = requiredRank > 0 ? WEIGHTS.education * (workerRank / requiredRank) : 0;
      requirementsScore += clamp(score, 0, WEIGHTS.education);
      missingOptional.push({ key: 'education', label: `Education (${requiredEduLevels.join(', ')})`, sectionId: SECTION_IDS.education });
      nextActions.push({ label: 'Add education', sectionId: SECTION_IDS.education, priority: 2 });
    }
  }

  // ——— 5.4 Shift Overlap (20) ———
  const requiredShifts = pack.requiredShiftTypes ?? [];
  const workerShifts = getWorkerShiftPreferences(user);
  const overlap = shiftOverlapCount(requiredShifts, workerShifts);

  if (requiredShifts.length === 0) {
    requirementsScore += WEIGHTS.shift;
    matched.push({ key: 'shift', label: 'Shift Preference' });
  } else {
    const ratio = overlap / requiredShifts.length;
    requirementsScore += WEIGHTS.shift * ratio;
    if (ratio >= 1) matched.push({ key: 'shift', label: 'Shift Preference' });
    else {
      missingOptional.push({ key: 'shift', label: 'Update availability/preferences', sectionId: SECTION_IDS.availability });
      nextActions.push({ label: 'Update availability/preferences', sectionId: SECTION_IDS.availability, priority: 2 });
    }
  }

  // ——— 5.5 Language (5) ———
  const requiredLangs = pack.requiredLanguages ?? [];
  const workerLangs = getWorkerLanguages(user);
  const langOk = hasAllLanguages(requiredLangs, workerLangs);
  const langImportance = imp.language ?? 'scored';

  if (requiredLangs.length === 0) {
    requirementsScore += WEIGHTS.language;
    matched.push({ key: 'language', label: 'Language' });
  } else {
    if (!langOk && langImportance === 'hard') {
      eligible = false;
      missingRequired.push({ key: 'language', label: requiredLangs.join(', '), sectionId: SECTION_IDS.languages });
      nextActions.push({ label: `Add ${requiredLangs.join(', ')} language`, sectionId: SECTION_IDS.languages, priority: 1 });
    } else if (langOk) {
      requirementsScore += WEIGHTS.language;
      matched.push({ key: 'language', label: 'Language' });
    } else {
      missingOptional.push({ key: 'language', label: requiredLangs.join(', '), sectionId: SECTION_IDS.languages });
      nextActions.push({ label: `Add ${requiredLangs.join(', ')} language`, sectionId: SECTION_IDS.languages, priority: 2 });
    }
  }

  // ——— 5.6 Physical/PPE (5) ——— v1: always 5 (info)
  requirementsScore += WEIGHTS.physical;
  matched.push({ key: 'physical', label: 'Physical/PPE/Uniform' });

  const requirementsRounded = Math.round(clamp(requirementsScore, 0, REQUIREMENTS_MAX));
  const hiringLift = typeof aiScoreAtCompute === 'number' && Number.isFinite(aiScoreAtCompute)
    ? clamp(aiScoreAtCompute, 0, 100)
    : 50;
  let jobScore = Math.round(0.8 * requirementsRounded + 0.2 * hiringLift);
  if (!eligible && capIneligible && jobScore > 49) jobScore = 49;

  return {
    version: 'v1',
    requirementPackId: pack.id,
    requirementPackVersion: pack.version,
    computedAt,
    jobScore: clamp(jobScore, 0, 100),
    eligible,
    breakdown: {
      requirements: requirementsRounded,
      hiringLift,
    },
    buckets: {
      gates,
      missingRequired,
      missingOptional,
      matched,
    },
    nextActions: nextActions.slice(0, 10),
    inputs: {
      aiScoreAtCompute,
      userProfileUpdatedAt: options?.userProfileUpdatedAt,
    },
  };
}

/**
 * Get stored v1 summary or compute now (for UI/display).
 * When returning stored snapshot, attaches stale block if stale (v1.1).
 */
export function getOrComputeJobScoreSummaryV1(
  applicationDoc: { jobScoreSummary?: any } | null,
  userDoc: UserDocForJobScoreV1 | null,
  requirementPackId: string | undefined,
  aiScore?: number
): JobScoreSummaryV1 | null {
  if (!requirementPackId) return null;
  const stored = applicationDoc?.jobScoreSummary;
  const pack = getRequirementPackV1(requirementPackId);
  if (stored?.version === 'v1' && stored?.requirementPackId === requirementPackId) {
    const withStale = { ...stored } as JobScoreSummaryV1;
    const stale = computeJobScoreStale(
      withStale,
      userDoc ?? null,
      pack?.version,
      aiScore
    );
    if (stale) withStale.stale = stale;
    return withStale;
  }
  return computeJobScoreSummaryV1(userDoc, requirementPackId, aiScore, new Date(), {
    userProfileUpdatedAt: userDoc && typeof userDoc === 'object' ? (userDoc as any).profileUpdatedAt ?? (userDoc as any).updatedAt : undefined,
  });
}

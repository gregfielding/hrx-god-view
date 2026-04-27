/**
 * Job Score computation: eligibility (missing requirements), fit score, and final Job Score.
 * Blend uses Global Hiring Score (users/{uid}.scoreSummary.aiScore) + fit score.
 */
import type { JobScoreSummary, RequirementPack, UserDocForJobScore } from '../types/jobScore';
import { getRequirementPack } from '../data/jobRequirementPacks';
import { getUserScore } from './scoreSummary';

function hasWorkEligibility(u: UserDocForJobScore): boolean {
  return !!u?.workEligibility;
}

function hasAvailability(u: UserDocForJobScore): boolean {
  void u;
  // Availability is optional for onboarding/profile completion and should not block worker progress.
  return true;
}

function hasWorkExperience(u: UserDocForJobScore): boolean {
  const work = u?.workExperience ?? u?.workHistory;
  return Array.isArray(work) && work.length > 0;
}

function hasSkills(u: UserDocForJobScore, minCount = 1): boolean {
  const s = u?.skills;
  return Array.isArray(s) && s.length >= minCount;
}

function hasCertifications(u: UserDocForJobScore, minCount = 1): boolean {
  const c = u?.certifications;
  return Array.isArray(c) && c.length >= minCount;
}

function hasEducation(u: UserDocForJobScore): boolean {
  const e = u?.education;
  return Array.isArray(e) && e.length > 0;
}

function hasResume(u: UserDocForJobScore): boolean {
  const r = u?.resume;
  return !!(r && (r.downloadUrl || r.storagePath));
}

function hasIdentityBasics(u: UserDocForJobScore): boolean {
  return !!(
    u?.firstName &&
    u?.lastName &&
    u?.email &&
    (u?.phone || u?.phoneE164)
  );
}

const REQUIREMENT_CHECK: Record<
  string,
  (u: UserDocForJobScore, ...args: number[]) => boolean
> = {
  workEligibility: hasWorkEligibility,
  availability: hasAvailability,
  workExperience: hasWorkExperience,
  skills: (u, min = 1) => hasSkills(u, min),
  certifications: (u, min = 1) => hasCertifications(u, min),
  education: hasEducation,
  resume: hasResume,
  identityBasics: hasIdentityBasics,
};

function checkRequirement(
  userDoc: UserDocForJobScore,
  key: string,
  pack: RequirementPack
): boolean {
  const req = [...pack.mustHave, ...pack.niceToHave].find((r) => r.key === key);
  if (!req) return true;
  const fn = REQUIREMENT_CHECK[key];
  if (!fn) return false;
  if (key === 'skills') return hasSkills(userDoc, 3);
  return fn(userDoc);
}

/**
 * Returns list of missing requirement keys and their labels for the user + pack.
 */
export function computeMissingRequirements(
  userDoc: UserDocForJobScore | null,
  pack: RequirementPack
): { keys: string[]; labels: string[] } {
  if (!userDoc) {
    const all = [...pack.mustHave, ...pack.niceToHave];
    return {
      keys: all.map((r) => r.key),
      labels: all.map((r) => r.label),
    };
  }
  const keys: string[] = [];
  const labels: string[] = [];
  for (const req of [...pack.mustHave, ...pack.niceToHave]) {
    if (!checkRequirement(userDoc, req.key, pack)) {
      keys.push(req.key);
      labels.push(req.label);
    }
  }
  return { keys, labels };
}

/**
 * Eligibility: user meets all must-haves.
 */
export function computeEligibility(
  userDoc: UserDocForJobScore | null,
  pack: RequirementPack
): boolean {
  if (!userDoc) return false;
  for (const req of pack.mustHave) {
    if (!checkRequirement(userDoc, req.key, pack)) return false;
  }
  return true;
}

/**
 * Fit score 0–100: fraction of requirements (must + nice) met, scaled to 100.
 */
export function computeFitScore(
  userDoc: UserDocForJobScore | null,
  pack: RequirementPack
): number {
  if (!userDoc) return 0;
  const all = [...pack.mustHave, ...pack.niceToHave];
  let met = 0;
  for (const req of all) {
    if (checkRequirement(userDoc, req.key, pack)) met++;
  }
  if (all.length === 0) return 100;
  return Math.round((met / all.length) * 100);
}

/** Default blend: 50% Hiring Score, 50% fit. Both 0–100. */
const DEFAULT_HIRING_WEIGHT = 0.5;

/**
 * Final Job Score 0–100: blend of Hiring Score and fit score.
 */
export function computeJobScore(
  hiringScore: number | undefined,
  fitScore: number,
  hiringWeight: number = DEFAULT_HIRING_WEIGHT
): number {
  const h = typeof hiringScore === 'number' && Number.isFinite(hiringScore)
    ? Math.max(0, Math.min(100, hiringScore))
    : 50; // neutral if missing
  const f = Math.max(0, Math.min(100, fitScore));
  const blended = hiringWeight * h + (1 - hiringWeight) * f;
  return Math.round(Math.max(0, Math.min(100, blended)));
}

/**
 * Full Job Score summary for an application. Persist to applications/{appId}.jobScoreSummary.
 */
export function computeJobScoreSummary(
  userDoc: UserDocForJobScore | null,
  requirementPackId: string,
  hiringScore: number | undefined,
  computedAt: any
): JobScoreSummary | null {
  const pack = getRequirementPack(requirementPackId);
  if (!pack) return null;
  const { keys: missingRequirements, labels: missingLabels } = computeMissingRequirements(
    userDoc,
    pack
  );
  const eligible = computeEligibility(userDoc, pack);
  const fitScore = computeFitScore(userDoc, pack);
  const jobScore = computeJobScore(hiringScore, fitScore);
  return {
    requirementPackId: pack.id,
    computedAt,
    eligible,
    missingRequirements,
    missingLabels,
    fitScore,
    jobScore,
    hiringScoreUsed: hiringScore,
  };
}

/**
 * Get Job Score summary from application doc (already computed) or compute now.
 */
export function getOrComputeJobScoreSummary(
  applicationDoc: { jobScoreSummary?: JobScoreSummary | null; userId?: string } | null,
  userDoc: UserDocForJobScore | null,
  requirementPackId: string | undefined,
  hiringScore?: number
): JobScoreSummary | null {
  if (!requirementPackId) return applicationDoc?.jobScoreSummary ?? null;
  // Prefer stored if present and same pack
  const stored = applicationDoc?.jobScoreSummary;
  if (stored && stored.requirementPackId === requirementPackId) return stored;
  return computeJobScoreSummary(userDoc, requirementPackId, hiringScore, new Date());
}

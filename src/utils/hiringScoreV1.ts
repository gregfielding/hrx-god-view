/**
 * Hiring Score v1.1 — Global person-level score.
 * Spec: HRX-Scoring-Architecture-v1.1
 * Formula: HiringScore = 0.60*C + 0.25*D + 0.15*R (Completeness, Depth, Reliability)
 *
 * App bundle copy — keep in sync with `shared/hiringScoreV1.ts` (Cloud Functions / scripts).
 */

export interface HiringScoreV1Components {
  completeness: number;
  depth: number;
  reliability: number;
}

export interface HiringScoreV1Explainability {
  missingFields: string[];
  nextActions: { label: string; priority?: number }[];
}

export interface HiringScoreV1Result {
  score: number;
  version: 'v1.1';
  components: HiringScoreV1Components;
  explainability: HiringScoreV1Explainability;
  computedAt: Date;
}

/** Checklist weights for Completeness (sum = 100). */
const COMPLETENESS_WEIGHTS: Record<string, number> = {
  phoneVerified: 15,
  homeAddress: 10,
  availability: 15,
  resume: 10,
  bio: 10,
  skills: 10,
  workHistory: 20,
  education: 10,
};

const RELIABILITY_BASELINE = 50;

function hasHomeAddress(user: any): boolean {
  const a = user?.address || user?.addressInfo || {};
  return !!(a.street || a.streetAddress) && !!(a.city && a.state);
}

function hasAvailability(user: any): boolean {
  const p = user?.preferences;
  if (!p || typeof p !== 'object') return false;
  return !!(
    (Array.isArray(p.shiftPreferences) && p.shiftPreferences.length > 0) ||
    (p.availableToStartDate && String(p.availableToStartDate).trim()) ||
    (p.availabilityNotes && String(p.availabilityNotes).trim())
  );
}

function hasBio(user: any): boolean {
  const bio =
    user?.professionalBio ?? user?.bio ?? user?.summary ?? '';
  return typeof bio === 'string' && bio.trim().length > 0;
}

function hasResume(user: any): boolean {
  const r = user?.resume;
  return !!(r && (r.storagePath || r.downloadUrl));
}

function skillsCount(user: any): number {
  const s = user?.skills;
  return Array.isArray(s) ? s.length : 0;
}

function workHistoryCount(user: any): number {
  const w = user?.workHistory ?? user?.workExperience ?? [];
  return Array.isArray(w) ? w.length : 0;
}

/** Education: present if >= 1 entry OR explicitly "none declared". */
function hasEducation(user: any): boolean {
  const e = user?.education;
  if (Array.isArray(e) && e.length > 0) return true;
  if (user?.educationNoneDeclared === true) return true;
  if (Array.isArray(e) && e.length === 0) return false;
  return false;
}

/** Completeness (C): weighted checklist 0–100. */
function computeCompleteness(user: any): { score: number; missing: string[]; nextActions: { label: string; priority: number }[] } {
  const missing: string[] = [];
  const nextActions: { label: string; priority: number }[] = [];
  let earned = 0;

  const checks: Array<{ key: string; label: string; have: boolean; action: string }> = [
    { key: 'phoneVerified', label: 'Phone verified', have: !!user?.phoneVerified, action: 'Verify your phone number' },
    { key: 'homeAddress', label: 'Home address', have: hasHomeAddress(user), action: 'Add your home address' },
    { key: 'availability', label: 'Availability/preferences', have: hasAvailability(user), action: 'Add availability and shift preferences' },
    { key: 'resume', label: 'Resume uploaded', have: hasResume(user), action: 'Upload your resume' },
    { key: 'bio', label: 'Bio present', have: hasBio(user), action: 'Add a short bio' },
    { key: 'skills', label: 'Skills (≥3)', have: skillsCount(user) >= 3, action: 'Add at least 3 skills' },
    { key: 'workHistory', label: 'Work history (≥1)', have: workHistoryCount(user) >= 1, action: 'Add at least one work experience' },
    { key: 'education', label: 'Education', have: hasEducation(user), action: 'Add education or mark none' },
  ];

  for (const c of checks) {
    const w = COMPLETENESS_WEIGHTS[c.key] ?? 0;
    if (c.have) {
      earned += w;
    } else {
      missing.push(c.label);
      nextActions.push({ label: c.action, priority: w });
    }
  }

  nextActions.sort((a, b) => b.priority - a.priority);
  const score = Math.round(Math.min(100, earned));
  return { score, missing, nextActions: nextActions.slice(0, 5).map((a) => ({ label: a.label, priority: a.priority })) };
}

// ——— Depth: diminishing returns ———

/** ExperienceDepth max 45: 1→15, 2→25, 3→35, 4+→45 */
function experienceDepth(work: any[] | undefined): number {
  const n = Array.isArray(work) ? work.length : 0;
  if (n >= 4) return 45;
  if (n === 3) return 35;
  if (n === 2) return 25;
  if (n === 1) return 15;
  return 0;
}

/** CertDepth max 35; expired count at 25% value. */
function certDepth(certs: any[] | undefined): number {
  if (!Array.isArray(certs) || certs.length === 0) return 0;
  let effective = 0;
  for (const c of certs) {
    const exp = c?.expiresAt ?? c?.expiryDate;
    const isExpired = exp && (typeof exp.toDate === 'function' ? exp.toDate() : new Date(exp)) < new Date();
    effective += isExpired ? 0.25 : 1;
  }
  if (effective >= 4) return 35;
  if (effective >= 3) return 30;
  if (effective >= 2) return 25;
  if (effective >= 1) return 15;
  return 0;
}

const EDUCATION_RANK: Record<string, number> = {
  none: 0, hs: 1, high_school: 1, 'high school': 1,
  aa: 2, trade: 2, associate: 2,
  ba: 3, bs: 3, bachelors: 3,
  ma: 4, ms: 4, masters: 4,
  doctorate: 5, phd: 5,
};

function educationDepth(education: any[] | undefined): number {
  if (!Array.isArray(education) || education.length === 0) return 0;
  let maxRank = 0;
  for (const e of education) {
    const level = typeof e === 'object' && e != null ? (e as any).level ?? (e as any).degree ?? (e as any).educationLevel : e;
    const key = String(level ?? '').toLowerCase().replace(/\s+/g, '_');
    const rank = EDUCATION_RANK[key] ?? 0;
    if (rank > maxRank) maxRank = rank;
  }
  if (maxRank >= 5) return 20;
  if (maxRank >= 4) return 20;
  if (maxRank >= 3) return 15;
  if (maxRank >= 2) return 10;
  if (maxRank >= 1) return 5;
  return 0;
}

/** BonusSignals max 10: languages +5, references (future) +5 */
function bonusSignals(user: any): number {
  let s = 0;
  const langs = user?.languages;
  if (Array.isArray(langs) && langs.length >= 1) s += 5;
  return Math.min(10, s);
}

/** Depth (D): 0–100 from Experience + Cert + Education + Bonus (capped). */
function computeDepth(user: any): number {
  const work = user?.workHistory ?? user?.workExperience ?? [];
  const certs = user?.certifications ?? [];
  const education = user?.education ?? [];

  const exp = experienceDepth(work);
  const cert = certDepth(certs);
  const edu = educationDepth(education);
  const bonus = bonusSignals(user);

  const raw = exp + cert + edu + bonus;
  return Math.round(Math.min(100, raw));
}

/**
 * Compute Hiring Score v1.1 for a user document.
 */
export function computeHiringScoreV1(userDoc: any): HiringScoreV1Result {
  const user = userDoc ?? {};
  const now = new Date();

  const { score: cScore, missing, nextActions: completenessNext } = computeCompleteness(user);
  const c = Math.max(0, Math.min(100, cScore));
  const d = computeDepth(user);
  const r = RELIABILITY_BASELINE;

  const raw = 0.6 * c + 0.25 * d + 0.15 * r;
  const score = Math.round(Math.max(0, Math.min(100, raw)));

  const explainability: HiringScoreV1Explainability = {
    missingFields: missing,
    nextActions: completenessNext.slice(0, 3).map((a) => ({ label: a.label, priority: a.priority })),
  };

  return {
    score,
    version: 'v1.1',
    components: { completeness: c, depth: d, reliability: r },
    explainability,
    computedAt: now,
  };
}

/**
 * Deterministic fingerprint of profile inputs that drive Hiring Score v1.1 (same C/D/R → same signature).
 * Used to skip redundant Firestore writes when profile-derived score would be unchanged.
 */
export function computeHiringScoreInputSignature(userDoc: any): string {
  const r = computeHiringScoreV1(userDoc);
  return `v1.1:${r.components.completeness}:${r.components.depth}:${r.components.reliability}:${r.score}`;
}

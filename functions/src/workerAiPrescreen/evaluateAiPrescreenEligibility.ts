/**
 * Worker AI pre-screen **invite** eligibility (profile baseline).
 * Algorithm: `AI_PRESCREEN_SCORING_AND_ELIGIBILITY.md` §1 (v1).
 *
 * Used by delayed-invite / messaging flows; not written to interview docs by default.
 */

/** Exact shape from AI_PRESCREEN_SCORING_AND_ELIGIBILITY.md § "Eligibility Output Shape". */
export type AiPrescreenEligibilityResult = {
  eligibleForInterview: boolean;
  reason:
    | 'eligible'
    | 'missing_contact'
    | 'missing_location'
    | 'missing_experience_signal'
    | 'missing_work_auth_baseline'
    | 'incomplete_profile';
  missingFields: string[];
};

function norm(s: unknown): string {
  return String(s ?? '').trim();
}

/** Usable phone: same spirit as apply-wizard / SMS (E.164 or normalizable US 10-digit). */
export function userDocHasUsablePhone(userDoc: Record<string, unknown> | null | undefined): boolean {
  if (!userDoc || typeof userDoc !== 'object') return false;
  const e = norm(userDoc.phoneE164);
  if (/^\+[1-9]\d{7,14}$/.test(e)) return true;
  let d = norm(userDoc.phone).replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d.length === 10;
}

/** Aligns with worker profile “home address” completeness (geocoded baseline). */
export function isWorkerHomeAddressComplete(userDoc: Record<string, unknown> | null | undefined): boolean {
  if (!userDoc || typeof userDoc !== 'object') return false;
  const addr = (userDoc.addressInfo as Record<string, unknown>) || {};
  const street = norm(addr.streetAddress);
  const city = norm(addr.city ?? userDoc.city);
  const state = norm(addr.state ?? userDoc.state);
  const zip = norm(addr.zip ?? addr.zipCode ?? userDoc.zip);
  const lat = addr.homeLat;
  const lng = addr.homeLng;
  const hasCoords =
    typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng);
  return !!(street && city && state && zip && hasCoords);
}

/**
 * Spec §1.B: city+state, zip, or equivalent baseline used elsewhere.
 * Slightly looser than full geocoded address when coords are still pending.
 */
export function userDocHasBasicLocation(userDoc: Record<string, unknown> | null | undefined): boolean {
  if (!userDoc || typeof userDoc !== 'object') return false;
  if (isWorkerHomeAddressComplete(userDoc)) return true;
  const addr = (userDoc.addressInfo as Record<string, unknown>) || {};
  const city = norm(addr.city ?? userDoc.city);
  const state = norm(addr.state ?? userDoc.state);
  const zipRaw = norm(addr.zip ?? addr.zipCode ?? userDoc.zip).replace(/\D/g, '');
  if (city && state) return true;
  if (zipRaw.length >= 5) return true;
  return false;
}

export function userDocHasStoredResume(userDoc: Record<string, unknown> | null | undefined): boolean {
  if (!userDoc || typeof userDoc !== 'object') return false;
  const resumeObj = (userDoc.resume || {}) as Record<string, unknown>;
  return Boolean(
    resumeObj.downloadUrl ||
      resumeObj.fileName ||
      resumeObj.storagePath ||
      resumeObj.fileUrl ||
      userDoc.resumeStoragePath ||
      userDoc.resumeUrl,
  );
}

/**
 * Spec §1.C: at least one role with employer and/or title and non-blank detail/duration signal.
 */
export function userDocHasMeaningfulWorkHistory(userDoc: Record<string, unknown> | null | undefined): boolean {
  if (!userDoc || typeof userDoc !== 'object') return false;
  const rows = (userDoc.workHistory || userDoc.workExperience) as unknown;
  if (!Array.isArray(rows) || rows.length === 0) return false;
  return rows.some((row) => {
    if (!row || typeof row !== 'object') return false;
    const o = row as Record<string, unknown>;
    const employer = norm(o.employer ?? o.company);
    const title = norm(o.title ?? o.jobTitle);
    const desc = norm(o.description ?? o.summary ?? o.details);
    const durationSignal = norm(o.startDate ?? o.endDate ?? o.duration);
    const hasRole = employer.length > 0 || title.length > 0;
    if (!hasRole) return false;
    if (desc.length > 10) return true;
    if (durationSignal.length > 0) return true;
    return employer.length > 2 && title.length > 2;
  });
}

/** At least one non-empty skill (string or `{ name }`) on `users/{uid}.skills`. */
export function userDocHasAtLeastOneSkill(userDoc: Record<string, unknown> | null | undefined): boolean {
  if (!userDoc || typeof userDoc !== 'object') return false;
  const raw = userDoc.skills;
  if (!Array.isArray(raw) || raw.length === 0) return false;
  return raw.some((item) => {
    const name =
      typeof item === 'string' ? norm(item) : norm((item as Record<string, unknown>)?.name);
    return name.length > 0;
  });
}

/**
 * Spec §1.D: enough work-authorization signal from existing profile fields.
 */
export function userDocHasWorkAuthorizationBaseline(userDoc: Record<string, unknown> | null | undefined): boolean {
  if (!userDoc || typeof userDoc !== 'object') return false;
  if (userDoc.workAuthorization === true) return true;
  if (userDoc.workEligibility === true) return true;
  const att = (userDoc.workEligibilityAttestation || {}) as Record<string, unknown>;
  if (typeof att.authorizedToWorkUS === 'boolean' && typeof att.requireSponsorship === 'boolean') return true;
  return false;
}

export type EvaluateAiPrescreenEligibilityOptions = {
  /**
   * When false, resume and skills are not required for invite eligibility.
   * Default true. Replaces legacy `requireResumeOrWorkHistory` (resume or work history); v2 is resume or ≥1 skill.
   */
  requireResumeOrSkill?: boolean;
  /** @deprecated Use `requireResumeOrSkill`. Honored if present for older call sites. */
  requireResumeOrWorkHistory?: boolean;
  /** Default true — same checks as legacy v1 when unset. */
  requirePhone?: boolean;
  requireLocation?: boolean;
  requireWorkAuthorization?: boolean;
};

/**
 * Evaluate whether the worker’s profile meets v1 pre-screen **invitation** thresholds.
 */
export function evaluateAiPrescreenEligibility(
  userDoc: Record<string, unknown> | null | undefined,
  options?: EvaluateAiPrescreenEligibilityOptions,
): AiPrescreenEligibilityResult {
  const requireResumeOrSkill =
    options?.requireResumeOrSkill !== false && options?.requireResumeOrWorkHistory !== false;
  const requirePhone = options?.requirePhone !== false;
  const requireLocation = options?.requireLocation !== false;
  // 2026-07-09 (Greg): default flipped to FALSE — sign-up no longer asks
  // work authorization, so an unanswered profile must not be excluded from
  // the interview/scoring funnel. Tenants that explicitly set the policy
  // flag to true can still enforce it.
  const requireWorkAuthorization = options?.requireWorkAuthorization === true;

  const missingFields: string[] = [];

  const phoneOk = userDocHasUsablePhone(userDoc);
  if (requirePhone && !phoneOk) missingFields.push('phone');

  const locOk = userDocHasBasicLocation(userDoc);
  if (requireLocation && !locOk) missingFields.push('location');

  const resumeOk = userDocHasStoredResume(userDoc);
  const skillOk = userDocHasAtLeastOneSkill(userDoc);
  if (requireResumeOrSkill && !resumeOk && !skillOk) {
    missingFields.push('resume_or_skill');
  }

  const authOk = userDocHasWorkAuthorizationBaseline(userDoc);
  if (requireWorkAuthorization && !authOk) missingFields.push('work_authorization');

  if (missingFields.length === 0) {
    return { eligibleForInterview: true, reason: 'eligible', missingFields: [] };
  }

  let reason: AiPrescreenEligibilityResult['reason'] = 'incomplete_profile';
  if (requirePhone && !phoneOk) reason = 'missing_contact';
  else if (requireLocation && !locOk) reason = 'missing_location';
  else if (requireResumeOrSkill && !resumeOk && !skillOk) reason = 'missing_experience_signal';
  else if (requireWorkAuthorization && !authOk) reason = 'missing_work_auth_baseline';

  return {
    eligibleForInterview: false,
    reason,
    missingFields,
  };
}

/** Raw profile primitives aligned with `evaluateAiPrescreenEligibility` inputs (policy-agnostic). */
export type AiPrescreenEligibilityPrimitiveFlags = {
  phoneOk: boolean;
  locationOk: boolean;
  experienceOk: boolean;
  workAuthOk: boolean;
};

export function getAiPrescreenEligibilityPrimitiveFlags(
  userDoc: Record<string, unknown> | null | undefined,
): AiPrescreenEligibilityPrimitiveFlags {
  return {
    phoneOk: userDocHasUsablePhone(userDoc),
    locationOk: userDocHasBasicLocation(userDoc),
    experienceOk: userDocHasStoredResume(userDoc) || userDocHasAtLeastOneSkill(userDoc),
    workAuthOk: userDocHasWorkAuthorizationBaseline(userDoc),
  };
}

/**
 * True when at least one primitive flips false→true (profile improvement toward invite eligibility).
 * Used to schedule a bounded follow-up invite after an `ineligible_nudge` SMS.
 */
export function hasAiPrescreenEligibilityFalseToTrueTransition(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): boolean {
  const b = getAiPrescreenEligibilityPrimitiveFlags(before);
  const a = getAiPrescreenEligibilityPrimitiveFlags(after);
  return (
    (!b.phoneOk && a.phoneOk) ||
    (!b.locationOk && a.locationOk) ||
    (!b.experienceOk && a.experienceOk) ||
    (!b.workAuthOk && a.workAuthOk)
  );
}

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

/**
 * Evaluate whether the worker’s profile meets v1 pre-screen **invitation** thresholds.
 */
export function evaluateAiPrescreenEligibility(
  userDoc: Record<string, unknown> | null | undefined,
): AiPrescreenEligibilityResult {
  const missingFields: string[] = [];

  const phoneOk = userDocHasUsablePhone(userDoc);
  if (!phoneOk) missingFields.push('phone');

  const locOk = userDocHasBasicLocation(userDoc);
  if (!locOk) missingFields.push('location');

  const resumeOk = userDocHasStoredResume(userDoc);
  const historyOk = userDocHasMeaningfulWorkHistory(userDoc);
  if (!resumeOk && !historyOk) missingFields.push('resume_or_work_history');

  const authOk = userDocHasWorkAuthorizationBaseline(userDoc);
  if (!authOk) missingFields.push('work_authorization');

  if (missingFields.length === 0) {
    return { eligibleForInterview: true, reason: 'eligible', missingFields: [] };
  }

  let reason: AiPrescreenEligibilityResult['reason'] = 'incomplete_profile';
  if (!phoneOk) reason = 'missing_contact';
  else if (!locOk) reason = 'missing_location';
  else if (!resumeOk && !historyOk) reason = 'missing_experience_signal';
  else if (!authOk) reason = 'missing_work_auth_baseline';

  return {
    eligibleForInterview: false,
    reason,
    missingFields,
  };
}

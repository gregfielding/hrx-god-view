/**
 * **Mirror of `shared/profileEligibilityForHiringLifecycle.ts`** — CRA cannot import outside `src/`.
 * Keep logic in sync when changing either copy.
 */

export type ProfileEligibilityForHiringLifecycleOptions = {
  requireResumeOrSkill?: boolean;
  requireResumeOrWorkHistory?: boolean;
  requirePhone?: boolean;
  requireLocation?: boolean;
  requireWorkAuthorization?: boolean;
};

function norm(s: unknown): string {
  return String(s ?? '').trim();
}

function userDocHasUsablePhone(userDoc: Record<string, unknown> | null | undefined): boolean {
  if (!userDoc || typeof userDoc !== 'object') return false;
  const e = norm(userDoc.phoneE164);
  if (/^\+[1-9]\d{7,14}$/.test(e)) return true;
  let d = norm(userDoc.phone).replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d.length === 10;
}

function isWorkerHomeAddressComplete(userDoc: Record<string, unknown> | null | undefined): boolean {
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

function userDocHasBasicLocation(userDoc: Record<string, unknown> | null | undefined): boolean {
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

function userDocHasStoredResume(userDoc: Record<string, unknown> | null | undefined): boolean {
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

function userDocHasAtLeastOneSkill(userDoc: Record<string, unknown> | null | undefined): boolean {
  if (!userDoc || typeof userDoc !== 'object') return false;
  const raw = userDoc.skills;
  if (!Array.isArray(raw) || raw.length === 0) return false;
  return raw.some((item) => {
    const name =
      typeof item === 'string' ? norm(item) : norm((item as Record<string, unknown>)?.name);
    return name.length > 0;
  });
}

function userDocHasWorkAuthorizationBaseline(userDoc: Record<string, unknown> | null | undefined): boolean {
  if (!userDoc || typeof userDoc !== 'object') return false;
  if (userDoc.workAuthorization === true) return true;
  if (userDoc.workEligibility === true) return true;
  const att = (userDoc.workEligibilityAttestation || {}) as Record<string, unknown>;
  if (typeof att.authorizedToWorkUS === 'boolean' && typeof att.requireSponsorship === 'boolean') return true;
  return false;
}

const BLOCKER = {
  phone: 'ELIGIBILITY_PHONE_MISSING',
  location: 'ELIGIBILITY_LOCATION_REQUIRED',
  resumeOrSkill: 'ELIGIBILITY_RESUME_MISSING',
  workAuth: 'ELIGIBILITY_WORK_AUTH_MISSING',
} as const;

export function deriveProfileEligibilityForHiringLifecycle(
  userDoc: Record<string, unknown> | null | undefined,
  options?: ProfileEligibilityForHiringLifecycleOptions,
): { profileEligible: boolean; profileBlockerCodes: string[] } {
  const requireResumeOrSkill =
    options?.requireResumeOrSkill !== false && options?.requireResumeOrWorkHistory !== false;
  const requirePhone = options?.requirePhone !== false;
  const requireLocation = options?.requireLocation !== false;
  // 2026-07-09 (Greg): default FALSE — sign-up no longer collects work
  // authorization; only an explicit tenant policy `true` enforces it.
  const requireWorkAuthorization = options?.requireWorkAuthorization === true;

  const profileBlockerCodes: string[] = [];

  const phoneOk = userDocHasUsablePhone(userDoc);
  if (requirePhone && !phoneOk) profileBlockerCodes.push(BLOCKER.phone);

  const locOk = userDocHasBasicLocation(userDoc);
  if (requireLocation && !locOk) profileBlockerCodes.push(BLOCKER.location);

  const resumeOk = userDocHasStoredResume(userDoc);
  const skillOk = userDocHasAtLeastOneSkill(userDoc);
  if (requireResumeOrSkill && !resumeOk && !skillOk) {
    profileBlockerCodes.push(BLOCKER.resumeOrSkill);
  }

  const authOk = userDocHasWorkAuthorizationBaseline(userDoc);
  if (requireWorkAuthorization && !authOk) profileBlockerCodes.push(BLOCKER.workAuth);

  return {
    profileEligible: profileBlockerCodes.length === 0,
    profileBlockerCodes,
  };
}

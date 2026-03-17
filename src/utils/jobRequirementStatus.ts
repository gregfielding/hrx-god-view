/**
 * Determine which job requirements are met by the user (profile + application answers).
 * Used on the job posting detail page to show green check (met) vs red + fix (not met).
 */

export type RequirementCategory =
  | 'backgroundCheckPackages'
  | 'drugScreeningPanels'
  | 'additionalScreenings'
  | 'licensesCerts'
  | 'skills'
  | 'experienceLevels'
  | 'educationLevels'
  | 'languages'
  | 'eVerify'
  | 'physicalRequirements'
  | 'uniformRequirements'
  | 'requiredPpe';

/** requiredToApply = on job post; recommended = optional boost; jobPreparation = shown only after assignment */
export type RequirementTier = 'requiredToApply' | 'recommended' | 'jobPreparation';

/** For upload-required certifications: verification state (not simple yes/no). */
export type CertificationVerificationStatus = 'missing' | 'uploaded' | 'verified' | 'expired';

export interface RequirementItemStatus {
  label: string;
  met: boolean;
  /** Optional key for acks, e.g. skills_Reading Comprehension, languages_English */
  ackKey?: string;
  /** When set, this is an upload-required cert; use this for UI (Upload to qualify / Pending review / Verified / Expired). */
  certificationVerification?: CertificationVerificationStatus;
  /** Expiration date (YYYY-MM-DD or ISO string) when relevant. */
  expirationDate?: string;
  /** When true, do not show yes/no self-attest dialog; show upload CTA or status only. */
  requiresUpload?: boolean;
  /** For willingness-style responses that are NOT verified completion. */
  attestationState?: 'willing' | 'unwilling' | 'unknown';
}

export interface CategoryRequirementStatus {
  category: RequirementCategory;
  categoryLabel: string;
  tier: RequirementTier;
  items: RequirementItemStatus[];
}

export interface EligibilitySummary {
  percent: number;
  totalCount: number;
  metCount: number;
  missingRequired: Array<{ categoryLabel: string; itemLabel: string; category: RequirementCategory; item: RequirementItemStatus }>;
  categories: CategoryRequirementStatus[];
}

function normalizeForMatch(a: string): string {
  return (a || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function profileSkillsInclude(profile: any, skillLabel: string): boolean {
  const skills = profile?.skills;
  if (!Array.isArray(skills)) return false;
  const needle = normalizeForMatch(skillLabel);
  return skills.some((s: any) => {
    const name = typeof s === 'string' ? s : s?.name ?? s?.label ?? '';
    return normalizeForMatch(name) === needle || normalizeForMatch(name).includes(needle) || needle.includes(normalizeForMatch(name));
  });
}

function profileLanguagesInclude(profile: any, langLabel: string): boolean {
  const langs = profile?.languages;
  if (!Array.isArray(langs)) return false;
  const needle = normalizeForMatch(langLabel);
  return langs.some((l: any) => {
    const name = typeof l === 'string' ? l : l?.name ?? l?.label ?? '';
    return normalizeForMatch(name) === needle || normalizeForMatch(name).includes(needle);
  });
}

function profileEducationMeets(profile: any, educationLabel: string): boolean {
  const level = profile?.educationLevel || (Array.isArray(profile?.education) && profile.education.length > 0 ? profile.education[0]?.level : null);
  if (!level && !educationLabel) return false;
  return normalizeForMatch(String(level)).includes(normalizeForMatch(educationLabel)) ||
    normalizeForMatch(educationLabel).includes(normalizeForMatch(String(level)));
}

function profileCertificationsInclude(profile: any, certLabel: string): boolean {
  const certs = profile?.certifications;
  if (!Array.isArray(certs)) return false;
  const needle = normalizeForMatch(certLabel);
  return certs.some((c: any) => {
    const name = typeof c === 'string' ? c : c?.name ?? c?.label ?? '';
    return normalizeForMatch(name) === needle || normalizeForMatch(name).includes(needle) || needle.includes(normalizeForMatch(name));
  });
}

function appAck(applicationData: any, key: string): string | undefined {
  const acks = applicationData?.data?.requirements?.acks || {};
  return acks[key];
}

/** Profile-persisted acks (so future applications can pre-fill from profile). */
function profileAck(userProfile: any, key: string): string | undefined {
  const acks = userProfile?.requirementsAcks || {};
  return acks[key];
}

/** Prefer application answer, fall back to profile so saved profile updates apply to future applications. */
function reqAck(applicationData: any, userProfile: any, key: string): string | undefined {
  return appAck(applicationData, key) ?? profileAck(userProfile, key);
}

function appUploaded(applicationData: any, name: string): boolean {
  const uploaded = applicationData?.data?.requirements?.uploaded || {};
  return !!uploaded[name];
}

function normalizeStatus(v: unknown): string {
  return String(v || '').toLowerCase().trim();
}

function isVerifiedResult(status: unknown, result?: unknown): boolean {
  const s = normalizeStatus(status);
  const r = normalizeStatus(result);
  const deniedTokens = ['cancelled', 'canceled', 'failed', 'denied', 'rejected', 'expired', 'incomplete'];
  if (deniedTokens.some((t) => s.includes(t) || r.includes(t))) return false;
  const verifiedTokens = [
    'verified',
    'complete',
    'completed',
    'passed',
    'clear',
    'employment authorized',
    'authorized',
    'negative',
  ];
  return verifiedTokens.some((t) => s.includes(t) || r.includes(t));
}

function matchesLabel(candidate: unknown, label: string): boolean {
  const c = normalizeForMatch(String(candidate || ''));
  const l = normalizeForMatch(label);
  return !!c && (c.includes(l) || l.includes(c));
}

function hasVerifiedChecklistItem(userProfile: any, matcher: (key: string, item: any) => boolean): boolean {
  const checklist = userProfile?.onboarding?.checklist;
  if (!checklist || typeof checklist !== 'object') return false;
  return Object.entries(checklist).some(([key, item]) => {
    const row = item as any;
    return normalizeStatus(row?.status) === 'verified' && matcher(key, row);
  });
}

function hasVerifiedBackground(userProfile: any, label: string): boolean {
  const normalized = normalizeForMatch(label);
  const compliance = userProfile?.workerCompliance?.backgroundCheck;
  if (compliance && isVerifiedResult(compliance.status, compliance.result)) {
    if (!compliance.packageName) return true;
    if (matchesLabel(compliance.packageName, label)) return true;
  }
  const orders = Array.isArray(userProfile?.backgroundCheckOrders) ? userProfile.backgroundCheckOrders : [];
  if (
    orders.some(
      (o: any) =>
        isVerifiedResult(o?.status, o?.result) &&
        (!o?.typeLabel && !o?.type ? true : matchesLabel(o?.typeLabel || o?.type, label))
    )
  ) {
    return true;
  }
  return hasVerifiedChecklistItem(userProfile, (key, item) => {
    const k = normalizeForMatch(key);
    const labelMatch =
      matchesLabel(item?.label || item?.name || item?.externalId, label) ||
      k.includes(normalized) ||
      normalized.includes(k);
    return (k.includes('background') || k.includes('criminal')) && (labelMatch || !label);
  });
}

function hasVerifiedDrug(userProfile: any, label: string): boolean {
  const compliance = userProfile?.workerCompliance?.drugScreen;
  if (compliance && isVerifiedResult(compliance.status, compliance.result)) {
    if (!compliance.panelName) return true;
    if (matchesLabel(compliance.panelName, label)) return true;
  }
  const orders = Array.isArray(userProfile?.drugScreeningOrders) ? userProfile.drugScreeningOrders : [];
  if (
    orders.some(
      (o: any) =>
        isVerifiedResult(o?.status, o?.result) &&
        (!o?.typeLabel && !o?.type ? true : matchesLabel(o?.typeLabel || o?.type, label))
    )
  ) {
    return true;
  }
  return hasVerifiedChecklistItem(userProfile, (key, item) => {
    const k = normalizeForMatch(key);
    return k.includes('drug') && (matchesLabel(item?.label || item?.name || item?.externalId, label) || !label);
  });
}

function hasVerifiedEVerify(userProfile: any): boolean {
  const compliance = userProfile?.workerCompliance?.eVerify;
  if (compliance && isVerifiedResult(compliance.status, compliance.result)) return true;
  const orders = Array.isArray(userProfile?.eVerifyOrders) ? userProfile.eVerifyOrders : [];
  if (orders.some((o: any) => isVerifiedResult(o?.status, o?.result))) return true;
  return hasVerifiedChecklistItem(userProfile, (key) => normalizeForMatch(key).includes('everify'));
}

function hasVerifiedAdditionalScreening(userProfile: any, label: string): boolean {
  const slug = normalizeForMatch(label).replace(/[^a-z0-9]+/g, '_');
  const additional = userProfile?.workerCompliance?.additionalScreenings?.[slug];
  if (additional && isVerifiedResult(additional.status, additional.result)) return true;
  const vaccination = userProfile?.workerCompliance?.vaccination?.[slug];
  if (vaccination && isVerifiedResult(vaccination.status, vaccination.result)) return true;
  const orders = Array.isArray(userProfile?.additionalScreeningOrders) ? userProfile.additionalScreeningOrders : [];
  if (
    orders.some(
      (o: any) =>
        isVerifiedResult(o?.status, o?.result) &&
        (!o?.typeLabel && !o?.type ? true : matchesLabel(o?.typeLabel || o?.type, label))
    )
  ) {
    return true;
  }
  return hasVerifiedChecklistItem(userProfile, (key, item) => {
    const k = normalizeForMatch(key);
    const detail = item?.label || item?.name || item?.externalId;
    return (
      (k.includes('vaccin') || k.includes('screen') || k.includes(slug)) &&
      (!detail || matchesLabel(detail, label))
    );
  });
}

// Certification verification (upload-required vs self-attest)
import {
  isUploadRequiredCert,
  getCertificationVerificationStatus,
  findProfileCertForRequirement,
} from './certificationVerification';

/**
 * Build status for all requirement categories on the posting.
 * When user is not logged in or no application, all items are considered "not met" for UI (we still show chips, but no check/fix).
 */
export function getRequirementsWithStatus(
  posting: any,
  userProfile: any | null,
  applicationData: any | null
): CategoryRequirementStatus[] {
  const result: CategoryRequirementStatus[] = [];
  const hasUser = !!userProfile || !!applicationData;

  const tierRequired: RequirementTier = 'requiredToApply';
  const tierJobPrep: RequirementTier = 'jobPreparation';

  if (posting.showBackgroundChecks && Array.isArray(posting.backgroundCheckPackages) && posting.backgroundCheckPackages.length > 0) {
    const backgroundComfort = applicationData?.data?.requirements?.backgroundScreeningComfort ?? userProfile?.comfortablePassBackground;
    const attestationState: RequirementItemStatus['attestationState'] =
      backgroundComfort === 'Yes' || backgroundComfort === 'Maybe'
        ? 'willing'
        : backgroundComfort === 'No'
          ? 'unwilling'
          : 'unknown';
    result.push({
      category: 'backgroundCheckPackages',
      categoryLabel: 'Background Check Packages',
      tier: tierRequired,
      items: posting.backgroundCheckPackages.map((pkg: string, idx: number) => {
        // Phase 1: green completion must come from verified compliance sources only.
        const met = hasUser ? hasVerifiedBackground(userProfile, pkg) : false;
        return {
          label: pkg,
          met: hasUser ? met : false,
          ackKey: idx === 0 ? 'backgroundScreeningComfort' : undefined,
          attestationState,
        };
      }),
    });
  }

  if (posting.showDrugScreening && Array.isArray(posting.drugScreeningPanels) && posting.drugScreeningPanels.length > 0) {
    const drugComfort = applicationData?.data?.requirements?.drugScreeningComfort ?? userProfile?.comfortablePassDrug;
    const attestationState: RequirementItemStatus['attestationState'] =
      drugComfort === 'Yes' || drugComfort === 'Maybe'
        ? 'willing'
        : drugComfort === 'No'
          ? 'unwilling'
          : 'unknown';
    result.push({
      category: 'drugScreeningPanels',
      categoryLabel: 'Drug Screening Panels',
      tier: tierRequired,
      items: posting.drugScreeningPanels.map((panel: string, idx: number) => {
        // Phase 1: green completion must come from verified compliance sources only.
        const met = hasUser ? hasVerifiedDrug(userProfile, panel) : false;
        return {
          label: panel,
          met: hasUser ? met : false,
          ackKey: idx === 0 ? 'drugScreeningComfort' : undefined,
          attestationState,
        };
      }),
    });
  }

  if (posting.showAdditionalScreenings && Array.isArray(posting.additionalScreenings) && posting.additionalScreenings.length > 0) {
    const additionalScreeningsApp = applicationData?.data?.requirements?.additionalScreenings || {};
    result.push({
      category: 'additionalScreenings',
      categoryLabel: 'Additional Screenings',
      tier: tierRequired,
      items: posting.additionalScreenings.map((screening: string) => {
        const slug = screening.replace(/[^a-zA-Z0-9]+/g, '_');
        const key = `additionalScreenings_${slug}`;
        const mainVal = additionalScreeningsApp[screening] ?? appAck(applicationData, key);
        const attestationState: RequirementItemStatus['attestationState'] =
          mainVal === 'Yes' || mainVal === 'Maybe'
            ? 'willing'
            : mainVal === 'No'
              ? 'unwilling'
              : 'unknown';
        // Phase 1: additional/vaccine willingness does not mark completion.
        const met = hasUser ? hasVerifiedAdditionalScreening(userProfile, screening) : false;
        return { label: screening, met: hasUser ? met : false, ackKey: key, attestationState };
      }),
    });
  }

  if (posting.eVerifyRequired) {
    const eVerifyComfort = applicationData?.data?.requirements?.eVerifyComfort ?? userProfile?.comfortableEVerify;
    const attestationState: RequirementItemStatus['attestationState'] =
      eVerifyComfort === 'Yes' || eVerifyComfort === 'Maybe'
        ? 'willing'
        : eVerifyComfort === 'No'
          ? 'unwilling'
          : 'unknown';
    const met = hasUser && hasVerifiedEVerify(userProfile);
    result.push({
      category: 'eVerify',
      categoryLabel: 'E-Verify',
      tier: tierRequired,
      items: [{ label: 'E-Verify', met: !!met, ackKey: 'eVerifyComfort', attestationState }],
    });
  }

  if (posting.showLicensesCerts && Array.isArray(posting.licensesCerts) && posting.licensesCerts.length > 0) {
    const profileCerts = Array.isArray(userProfile?.certifications) ? userProfile.certifications : [];
    result.push({
      category: 'licensesCerts',
      categoryLabel: 'Licenses & Certifications',
      tier: tierRequired,
      items: posting.licensesCerts.map((cert: string) => {
        const uploadRequired = isUploadRequiredCert(cert);
        if (uploadRequired && hasUser) {
          const profileCert = findProfileCertForRequirement(profileCerts, cert);
          const certObj =
            profileCert && typeof profileCert === 'object' && 'fileUrl' in profileCert
              ? (profileCert as { fileUrl?: string; expirationDate?: string; verificationStatus?: string })
              : null;
          const status = getCertificationVerificationStatus(certObj);
          const met = status === 'verified';
          const expirationDate = certObj?.expirationDate ? String(certObj.expirationDate) : undefined;
          return {
            label: cert,
            met,
            ackKey: `cert_${cert}`,
            certificationVerification: status,
            expirationDate,
            requiresUpload: true,
          };
        }
        const met = hasUser && (profileCertificationsInclude(userProfile, cert) || appUploaded(applicationData, cert));
        return { label: cert, met: !!met, ackKey: `cert_${cert}` };
      }),
    });
  }

  if (posting.showSkills && Array.isArray(posting.skills) && posting.skills.length > 0) {
    result.push({
      category: 'skills',
      categoryLabel: 'Required Skills',
      tier: tierRequired,
      items: posting.skills.map((skill: string) => {
        const met = hasUser && profileSkillsInclude(userProfile, skill);
        return { label: skill, met: !!met, ackKey: `skills_${skill}` };
      }),
    });
  }

  if (posting.showExperience && Array.isArray(posting.experienceLevels) && posting.experienceLevels.length > 0) {
    result.push({
      category: 'experienceLevels',
      categoryLabel: 'Experience',
      tier: tierRequired,
      items: posting.experienceLevels.map((exp: string) => {
        const profileExp = userProfile?.yearsExperience || userProfile?.experienceLevel;
        const met = hasUser && profileExp && normalizeForMatch(String(profileExp)).includes(normalizeForMatch(exp));
        return { label: exp, met: !!met, ackKey: `experience_${exp}` };
      }),
    });
  }

  if (posting.showEducation && Array.isArray(posting.educationLevels) && posting.educationLevels.length > 0) {
    result.push({
      category: 'educationLevels',
      categoryLabel: 'Education',
      tier: tierRequired,
      items: posting.educationLevels.map((edu: string) => {
        const met = hasUser && profileEducationMeets(userProfile, edu);
        return { label: edu, met: !!met, ackKey: `education_${edu}` };
      }),
    });
  }

  if (posting.showLanguages && Array.isArray(posting.languages) && posting.languages.length > 0) {
    result.push({
      category: 'languages',
      categoryLabel: 'Languages',
      tier: tierRequired,
      items: posting.languages.map((lang: string) => {
        const ackVal = reqAck(applicationData, userProfile, `languages_${lang}`);
        const met = hasUser && (profileLanguagesInclude(userProfile, lang) || ackVal === 'Yes' || ackVal === 'Maybe');
        return { label: lang, met: !!met, ackKey: `languages_${lang}` };
      }),
    });
  }

  if (posting.showPhysicalRequirements && Array.isArray(posting.physicalRequirements) && posting.physicalRequirements.length > 0) {
    result.push({
      category: 'physicalRequirements',
      categoryLabel: 'Physical Requirements',
      tier: tierJobPrep,
      items: posting.physicalRequirements.map((req: string) => {
        const ackVal = reqAck(applicationData, userProfile, `physical_${req}`);
        const met = hasUser && (ackVal === 'Yes' || ackVal === 'Maybe');
        return { label: req, met: !!met, ackKey: `physical_${req}` };
      }),
    });
  }

  if (posting.showUniformRequirements && Array.isArray(posting.uniformRequirements) && posting.uniformRequirements.length > 0) {
    result.push({
      category: 'uniformRequirements',
      categoryLabel: 'Uniform Requirements',
      tier: tierJobPrep,
      items: posting.uniformRequirements.map((uniform: string) => {
        const ackVal = reqAck(applicationData, userProfile, `uniform_${uniform}`);
        const met = hasUser && (ackVal === 'Yes' || ackVal === 'Maybe');
        return { label: uniform, met: !!met, ackKey: `uniform_${uniform}` };
      }),
    });
  }

  if (posting.showRequiredPpe && Array.isArray(posting.requiredPpe) && posting.requiredPpe.length > 0) {
    result.push({
      category: 'requiredPpe',
      categoryLabel: 'Required PPE',
      tier: tierJobPrep,
      items: posting.requiredPpe.map((ppe: string) => {
        const ackVal = reqAck(applicationData, userProfile, `ppe_${ppe}`);
        const met = hasUser && (ackVal === 'Yes' || ackVal === 'Maybe');
        return { label: ppe, met: !!met, ackKey: `ppe_${ppe}` };
      }),
    });
  }

  return result;
}

/** Requirements to show on job post (excludes Job preparation — uniform, PPE, physical). */
export function getRequirementsWithStatusForJobPost(
  posting: any,
  userProfile: any | null,
  applicationData: any | null
): CategoryRequirementStatus[] {
  return getRequirementsWithStatus(posting, userProfile, applicationData).filter(
    (c) => c.tier !== 'jobPreparation'
  );
}

/** Eligibility percent and flat list of missing required items for "Complete these steps" UX. */
export function getEligibilitySummary(
  posting: any,
  userProfile: any | null,
  applicationData: any | null
): EligibilitySummary {
  const categories = getRequirementsWithStatusForJobPost(posting, userProfile, applicationData);
  let totalCount = 0;
  let metCount = 0;
  const missingRequired: EligibilitySummary['missingRequired'] = [];
  for (const cat of categories) {
    for (const item of cat.items) {
      totalCount += 1;
      if (item.met) metCount += 1;
      else missingRequired.push({ categoryLabel: cat.categoryLabel, itemLabel: item.label, category: cat.category, item });
    }
  }
  const percent = totalCount > 0 ? Math.round((metCount / totalCount) * 100) : 100;
  return { percent, totalCount, metCount, missingRequired, categories };
}

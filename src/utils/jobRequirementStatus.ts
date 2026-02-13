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
  | 'physicalRequirements'
  | 'uniformRequirements'
  | 'requiredPpe';

export interface RequirementItemStatus {
  label: string;
  met: boolean;
  /** Optional key for acks, e.g. skills_Reading Comprehension, languages_English */
  ackKey?: string;
}

export interface CategoryRequirementStatus {
  category: RequirementCategory;
  categoryLabel: string;
  items: RequirementItemStatus[];
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

function appUploaded(applicationData: any, name: string): boolean {
  const uploaded = applicationData?.data?.requirements?.uploaded || {};
  return !!uploaded[name];
}

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

  if (posting.showBackgroundChecks && Array.isArray(posting.backgroundCheckPackages) && posting.backgroundCheckPackages.length > 0) {
    result.push({
      category: 'backgroundCheckPackages',
      categoryLabel: 'Background Check Packages',
      items: posting.backgroundCheckPackages.map((pkg: string, idx: number) => {
        const comfort = applicationData?.data?.requirements?.backgroundScreeningComfort;
        const met = comfort === 'Yes' || comfort === 'Maybe';
        return {
          label: pkg,
          met: hasUser ? met : false,
          ackKey: idx === 0 ? 'backgroundScreeningComfort' : undefined,
        };
      }),
    });
  }

  if (posting.showDrugScreening && Array.isArray(posting.drugScreeningPanels) && posting.drugScreeningPanels.length > 0) {
    result.push({
      category: 'drugScreeningPanels',
      categoryLabel: 'Drug Screening Panels',
      items: posting.drugScreeningPanels.map((panel: string, idx: number) => {
        const comfort = applicationData?.data?.requirements?.drugScreeningComfort;
        const met = comfort === 'Yes' || comfort === 'Maybe';
        return {
          label: panel,
          met: hasUser ? met : false,
          ackKey: idx === 0 ? 'drugScreeningComfort' : undefined,
        };
      }),
    });
  }

  if (posting.showAdditionalScreenings && Array.isArray(posting.additionalScreenings) && posting.additionalScreenings.length > 0) {
    result.push({
      category: 'additionalScreenings',
      categoryLabel: 'Additional Screenings',
      items: posting.additionalScreenings.map((screening: string) => {
        const key = `additionalScreenings_${screening.replace(/[^a-zA-Z0-9]+/g, '_')}`;
        const val = applicationData?.data?.requirements?.additionalScreenings?.[screening] ?? appAck(applicationData, key);
        const met = val === 'Yes' || val === 'Maybe';
        return { label: screening, met: hasUser ? met : false, ackKey: key };
      }),
    });
  }

  if (posting.showLicensesCerts && Array.isArray(posting.licensesCerts) && posting.licensesCerts.length > 0) {
    result.push({
      category: 'licensesCerts',
      categoryLabel: 'Licenses & Certifications',
      items: posting.licensesCerts.map((cert: string) => {
        const met = hasUser && (profileCertificationsInclude(userProfile, cert) || appUploaded(applicationData, cert));
        return { label: cert, met: !!met, ackKey: `cert_${cert}` };
      }),
    });
  }

  if (posting.showSkills && Array.isArray(posting.skills) && posting.skills.length > 0) {
    result.push({
      category: 'skills',
      categoryLabel: 'Required Skills',
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
      items: posting.languages.map((lang: string) => {
        const ackVal = appAck(applicationData, `languages_${lang}`);
        const met = hasUser && (profileLanguagesInclude(userProfile, lang) || ackVal === 'Yes' || ackVal === 'Maybe');
        return { label: lang, met: !!met, ackKey: `languages_${lang}` };
      }),
    });
  }

  if (posting.showPhysicalRequirements && Array.isArray(posting.physicalRequirements) && posting.physicalRequirements.length > 0) {
    result.push({
      category: 'physicalRequirements',
      categoryLabel: 'Physical Requirements',
      items: posting.physicalRequirements.map((req: string) => {
        const ackVal = appAck(applicationData, `physical_${req}`);
        const met = hasUser && (ackVal === 'Yes' || ackVal === 'Maybe');
        return { label: req, met: !!met, ackKey: `physical_${req}` };
      }),
    });
  }

  if (posting.showUniformRequirements && Array.isArray(posting.uniformRequirements) && posting.uniformRequirements.length > 0) {
    result.push({
      category: 'uniformRequirements',
      categoryLabel: 'Uniform Requirements',
      items: posting.uniformRequirements.map((uniform: string) => {
        const ackVal = appAck(applicationData, `uniform_${uniform}`);
        const met = hasUser && (ackVal === 'Yes' || ackVal === 'Maybe');
        return { label: uniform, met: !!met, ackKey: `uniform_${uniform}` };
      }),
    });
  }

  if (posting.showRequiredPpe && Array.isArray(posting.requiredPpe) && posting.requiredPpe.length > 0) {
    result.push({
      category: 'requiredPpe',
      categoryLabel: 'Required PPE',
      items: posting.requiredPpe.map((ppe: string) => {
        const ackVal = appAck(applicationData, `ppe_${ppe}`);
        const met = hasUser && (ackVal === 'Yes' || ackVal === 'Maybe');
        return { label: ppe, met: !!met, ackKey: `ppe_${ppe}` };
      }),
    });
  }

  return result;
}

/**
 * Job Readiness conditional prompts from user doc.
 * Used by /c1/workers/profile to show only relevant unlock prompts; each has a section id for scroll/expand.
 */

export const READINESS_SECTION_IDS = {
  availability: 'readiness-availability',
  'work-experience': 'readiness-work-experience',
  certifications: 'readiness-certifications',
  bio: 'readiness-bio',
} as const;

export type ReadinessSectionId = keyof typeof READINESS_SECTION_IDS;

export interface ReadinessPrompt {
  id: ReadinessSectionId;
  text: string;
  icon: string;
}

/**
 * Returns prompts for missing profile fields only. Worker sees only relevant prompts.
 */
export function getReadinessPrompts(userDoc: any): ReadinessPrompt[] {
  if (!userDoc || typeof userDoc !== 'object') return [];

  const prompts: ReadinessPrompt[] = [];
  const prefs = userDoc.preferences || {};
  const hasAvailability =
    (Array.isArray(prefs.shiftPreferences) && prefs.shiftPreferences.length > 0) ||
    !!userDoc.availableToStartDate ||
    !!(prefs.availabilityNotes && String(prefs.availabilityNotes).trim());

  const certs = userDoc.certifications;
  const hasCertifications = Array.isArray(certs) && certs.length > 0;

  const work = userDoc.workExperience || userDoc.workHistory;
  const hasWorkExperience = Array.isArray(work) && work.length > 0;

  const bio = userDoc.professionalBio || userDoc.bio;
  const hasBio = typeof bio === 'string' && bio.trim().length > 0;

  if (!hasAvailability) {
    prompts.push({
      id: 'availability',
      text: 'Add availability → Unlock more shifts',
      icon: '🔓',
    });
  }
  if (!hasCertifications) {
    prompts.push({
      id: 'certifications',
      text: 'Add a certification → Qualify for higher-paying roles',
      icon: '🔓',
    });
  }
  if (!hasWorkExperience) {
    prompts.push({
      id: 'work-experience',
      text: 'Add work experience → Increase your match rate',
      icon: '🔓',
    });
  }
  if (!hasBio) {
    prompts.push({
      id: 'bio',
      text: 'Add a short bio → Stand out to recruiters',
      icon: '🔓',
    });
  }

  return prompts;
}

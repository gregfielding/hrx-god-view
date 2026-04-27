import { getWorkAuthorizedStatus, type WorkAuthorizedStatus } from '../../../utils/workAuthorizedDisplay';
import { extractAllSkillLabelsFromUserDoc } from './overviewDashboardComposer';
import { toChipLabel } from '../../../utils/chipLabel';

/** Normalize display lines so they don't start with accidental lowercase (e.g. degree types). */
function capitalizeLineStart(s: string): string {
  const t = s.trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export type OverviewCertificationLine = { label: string; fileUrl?: string };

export type OverviewQualificationsData = {
  workAuthorizedStatus: WorkAuthorizedStatus;
  /** EEO / work-eligibility adjacent (same fields as Work eligibility / Skills flows). */
  gender: string;
  veteranStatus: string;
  disabilityStatus: string;
  /** `null` when not answered on the user doc. */
  requireSponsorship: boolean | null;
  resumeUrl: string | null;
  hasResume: boolean;
  bio: string;
  educationLines: string[];
  certifications: OverviewCertificationLine[];
  workExperienceLines: string[];
  skillLabels: string[];
  languageLabels: string[];
};

/**
 * Mirrors read-only content from Qualifications tab accordions (same field mappings).
 */
export function buildOverviewQualificationsFromUserDoc(data: Record<string, unknown>): OverviewQualificationsData {
  const workAuthorizedStatus = getWorkAuthorizedStatus(data);

  const att = data.workEligibilityAttestation;
  const attObj = att && typeof att === 'object' ? (att as Record<string, unknown>) : null;
  const genderRaw =
    (typeof attObj?.gender === 'string' && attObj.gender.trim()) ||
    (typeof data.gender === 'string' && data.gender.trim()) ||
    '';
  const veteranRaw =
    (typeof attObj?.veteranStatus === 'string' && attObj.veteranStatus.trim()) ||
    (typeof data.veteranStatus === 'string' && data.veteranStatus.trim()) ||
    '';
  const disabilityRaw =
    (typeof attObj?.disabilityStatus === 'string' && attObj.disabilityStatus.trim()) ||
    (typeof data.disabilityStatus === 'string' && data.disabilityStatus.trim()) ||
    '';
  let requireSponsorship: boolean | null = null;
  if (typeof attObj?.requireSponsorship === 'boolean') {
    requireSponsorship = attObj.requireSponsorship;
  } else if (typeof data.requireSponsorship === 'boolean') {
    requireSponsorship = data.requireSponsorship;
  }

  const resumeObj = (data.resume || {}) as Record<string, unknown>;
  const resumeUrl =
    (typeof resumeObj.downloadUrl === 'string' ? resumeObj.downloadUrl : null) ||
    (typeof data.resumeUrl === 'string' ? data.resumeUrl : null);
  const hasResume = Boolean(
    resumeObj.downloadUrl ||
      resumeObj.fileName ||
      resumeObj.storagePath ||
      data.resumeStoragePath ||
      data.resumeUrl,
  );
  const bio = String(
    data.professionalBio || data.bio || data.summary || (data as { professionalSummary?: string }).professionalSummary || '',
  ).trim();

  const educationArray = Array.isArray(data.education) ? data.education : [];
  const educationLines = educationArray.map((item: unknown) => {
    if (!item || typeof item !== 'object') return 'Education entry';
    const o = item as Record<string, unknown>;
    const line = [o.degreeType || o.degree, o.school || o.institution].filter(Boolean).join(' — ');
    return capitalizeLineStart(line || 'Education entry');
  });

  const certificationsArray = Array.isArray(data.certifications) ? data.certifications : [];
  const certifications: OverviewCertificationLine[] = certificationsArray.map((item: unknown) => {
    if (!item || typeof item !== 'object') return { label: 'Certification' };
    const o = item as Record<string, unknown>;
    const label = String(o.name || o.certificationName || toChipLabel(item) || 'Certification');
    const fileUrl = typeof o.fileUrl === 'string' ? o.fileUrl : undefined;
    return fileUrl ? { label, fileUrl } : { label };
  });

  const workHistoryArr = data.workHistory || data.workExperience;
  const workExperienceLines: string[] = [];
  if (Array.isArray(workHistoryArr)) {
    for (const item of workHistoryArr) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const line = [o.jobTitle || o.title, o.employer || o.company].filter(Boolean).join(' at ');
      workExperienceLines.push(line || 'Work experience');
    }
  }

  const skillLabels = extractAllSkillLabelsFromUserDoc(data.skills);
  const langs = Array.isArray(data.languages) ? data.languages : [];
  const languageLabels = langs.map((l: unknown) => toChipLabel(l)).filter(Boolean);

  return {
    workAuthorizedStatus,
    gender: genderRaw,
    veteranStatus: veteranRaw,
    disabilityStatus: disabilityRaw,
    requireSponsorship,
    resumeUrl,
    hasResume,
    bio,
    educationLines,
    certifications,
    workExperienceLines,
    skillLabels,
    languageLabels,
  };
}

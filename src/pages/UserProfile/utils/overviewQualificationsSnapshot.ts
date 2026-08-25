import { getWorkAuthorizedStatus, type WorkAuthorizedStatus } from '../../../utils/workAuthorizedDisplay';
import { extractAllSkillLabelsFromUserDoc } from './overviewDashboardComposer';
import { toChipLabel } from '../../../utils/chipLabel';

/** Normalize display lines so they don't start with accidental lowercase (e.g. degree types). */
function capitalizeLineStart(s: string): string {
  const t = s.trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export type OverviewCertificationLine = { label: string; fileUrl?: string; expirationDate?: string };

/** One answered application question (attestation), for the Overview card. */
export type OverviewApplicationAnswer = { label: string; answer: string; date?: string };

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
  /** Resume-derived scalars (parser writes these; previously loaded but unrendered). */
  yearsExperience: number | null;
  educationLevel: string;
  /** Application answers (drug/background/E-Verify/physical/uniform/PPE/languages
   *  comfort + transport + per-job additional screenings) — reads the canonical
   *  workerAttestations map, the literal dotted-key variants older docs carry
   *  from the setDoc-merge era, and the legacy top-level comfortable* fields. */
  applicationAnswers: OverviewApplicationAnswer[];
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
    const expirationDate =
      typeof o.expirationDate === 'string' && o.expirationDate.trim() ? o.expirationDate.trim() : undefined;
    return { label, ...(fileUrl ? { fileUrl } : {}), ...(expirationDate ? { expirationDate } : {}) };
  });

  // Empty-but-truthy arrays must not mask the other name (phone signup seeds
  // workHistory: [] while some writers only populate workExperience).
  const workHistoryArr =
    Array.isArray(data.workHistory) && data.workHistory.length > 0 ? data.workHistory : data.workExperience;
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

  const yearsExpRaw = (data as Record<string, unknown>).yearsExperience;
  const yearsExperience =
    typeof yearsExpRaw === 'number' && Number.isFinite(yearsExpRaw) && yearsExpRaw > 0
      ? yearsExpRaw
      : null;
  const educationLevel = String((data as Record<string, unknown>).educationLevel || '').trim();

  const attMap = (data.workerAttestations || {}) as Record<string, unknown>;
  const dotted = (leaf: string) => (data as Record<string, unknown>)['workerAttestations.' + leaf];
  const metaObj = (attMap as { _meta?: Record<string, unknown> })._meta || {};
  const attDate = (leaf: string): string | undefined => {
    const meta =
      (metaObj as Record<string, Record<string, unknown>>)[leaf] ||
      ((data as Record<string, unknown>)['workerAttestations._meta.' + leaf + '.attestedAt'] !== undefined
        ? { attestedAt: (data as Record<string, unknown>)['workerAttestations._meta.' + leaf + '.attestedAt'] }
        : undefined);
    const at = (meta as Record<string, unknown> | undefined)?.attestedAt as
      | { toDate?: () => Date }
      | string
      | undefined;
    if (!at) return undefined;
    try {
      const d = typeof at === 'string' ? new Date(at) : at.toDate?.();
      return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString() : undefined;
    } catch {
      return undefined;
    }
  };
  const attVal = (legacy: string, leaf: string): string =>
    String(
      (data as Record<string, unknown>)[legacy] ?? attMap[leaf] ?? dotted(leaf) ?? '',
    ).trim();
  const applicationAnswers: OverviewApplicationAnswer[] = [];
  const pushAnswer = (label: string, legacy: string, leaf: string) => {
    const answer = attVal(legacy, leaf);
    if (answer) applicationAnswers.push({ label, answer, date: attDate(leaf) });
  };
  pushAnswer('Drug screening', 'comfortablePassDrug', 'drugScreeningWillingness');
  pushAnswer('Background check', 'comfortablePassBackground', 'backgroundCheckWillingness');
  pushAnswer('E-Verify', 'comfortableEVerify', 'eVerifyWillingness');
  pushAnswer('Physical requirements', 'comfortableWithPhysicalRequirements', 'physicalRequirementWillingness');
  pushAnswer('Uniform', 'comfortableWithUniformRequirements', 'uniformRequirementWillingness');
  pushAnswer('Custom uniform', 'comfortableWithCustomUniformRequirements', 'customUniformRequirementWillingness');
  pushAnswer('Required PPE', 'comfortableWithRequiredPpe', 'requiredPpeWillingness');
  pushAnswer('Language requirements', 'comfortableWithLanguages', 'languageRequirementWillingness');
  const transport = String(
    (data as Record<string, unknown>).transportMethod ??
      ((data.workerProfile as Record<string, { transportMethod?: unknown }> | undefined)?.preferences
        ?.transportMethod as string | undefined) ??
      (data as Record<string, unknown>)['workerProfile.preferences.transportMethod'] ??
      '',
  ).trim();
  if (transport) applicationAnswers.push({ label: 'Gets to work by', answer: transport });
  const additional = {
    ...((attMap.additionalScreenings as Record<string, unknown>) || {}),
    ...((data as { additionalScreenings?: Record<string, unknown> }).additionalScreenings || {}),
  };
  for (const [name, val] of Object.entries(additional)) {
    const v = String(val ?? '').trim();
    if (v && typeof name === 'string' && name && name !== '_meta') {
      applicationAnswers.push({ label: capitalizeLineStart(name.replace(/_/g, ' ')), answer: v });
    }
  }

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
    yearsExperience,
    educationLevel,
    applicationAnswers,
  };
}

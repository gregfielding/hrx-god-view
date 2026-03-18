import type { DesiredWorkType, TargetIndustry } from './jobReadinessOpportunityMap';

export type ReadModelDomain = 'durable_profile' | 'attestation_only' | 'verified_compliance';

export interface ReadinessInputFieldMapRow {
  domain: ReadModelDomain;
  signal: string;
  canonicalPaths: string[];
  legacyFallbackPaths: string[];
}

export const READINESS_INPUT_DOMAIN_MAP: ReadinessInputFieldMapRow[] = [
  {
    domain: 'durable_profile',
    signal: 'desired work intent',
    canonicalPaths: ['workerProfile.preferences.desiredWorkType', 'workerProfile.preferences.targetIndustries'],
    legacyFallbackPaths: ['jobReadiness.intent.desiredWorkType', 'jobReadiness.intent.targetIndustries'],
  },
  {
    domain: 'durable_profile',
    signal: 'availability preferences',
    canonicalPaths: ['workerProfile.preferences.availabilityDays', 'workerProfile.availability.preferredDays'],
    legacyFallbackPaths: ['availability.preferredDays', 'availabilityDays'],
  },
  {
    domain: 'durable_profile',
    signal: 'experience and skills',
    canonicalPaths: ['workerProfile.experience.workHistory', 'workerProfile.experience.previousRoles', 'workerProfile.skills'],
    legacyFallbackPaths: ['workHistory', 'workExperience', 'previousRoles', 'skills'],
  },
  {
    domain: 'durable_profile',
    signal: 'profile photo',
    canonicalPaths: ['workerProfile.photoUrl'],
    legacyFallbackPaths: ['avatar'],
  },
  {
    domain: 'attestation_only',
    signal: 'readiness attestations',
    canonicalPaths: ['workerAttestations.*', 'workerProfile.attestations.*'],
    legacyFallbackPaths: ['workerProfile.preferences.uniformReady', 'workerProfile.preferences.hasSteelToeBoots'],
  },
  {
    domain: 'verified_compliance',
    signal: 'certification verification',
    canonicalPaths: ['workerProfile.credentials.certifications.*', 'workerCompliance.certifications.*'],
    legacyFallbackPaths: ['certifications.*'],
  },
];

interface NormalizedCertification {
  label: string;
  status: string;
  hasProof: boolean;
  sourcePath: string;
}

interface DurableProfileReadModel {
  desiredWorkType?: DesiredWorkType;
  targetIndustries?: TargetIndustry[];
  availabilityDays: string[];
  skills: string[];
  workHistoryText: string;
  photoUrl?: string;
  preferences: {
    uniformReady: boolean;
    hasSteelToeBoots: boolean;
    flexibleShifts: boolean;
  };
}

interface AttestationReadModel {
  uniformReady: boolean;
  hasSteelToeBoots: boolean;
}

interface VerifiedComplianceReadModel {
  certifications: NormalizedCertification[];
}

export interface JobReadinessReadModel {
  durableProfile: DurableProfileReadModel;
  attestation: AttestationReadModel;
  verifiedCompliance: VerifiedComplianceReadModel;
  legacyFieldsUsed: string[];
  hasVerifiedCertification: (patterns: string[]) => boolean;
  hasCertificationProofUploaded: (patterns: string[]) => boolean;
  hasWeekendAvailability: () => boolean;
  hasExperienceKeywords: (keywords: string[]) => boolean;
  hasProfilePhoto: () => boolean;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => String(v || '').trim())
    .filter(Boolean);
}

function normalizeStatus(value: unknown): string {
  return String(value || '').toLowerCase().trim();
}

function normalizeCertification(value: unknown, sourcePath: string): NormalizedCertification | null {
  if (typeof value === 'string') {
    const label = value.trim();
    if (!label) return null;
    return { label, status: '', hasProof: false, sourcePath };
  }
  if (!value || typeof value !== 'object') return null;

  const row = value as Record<string, unknown>;
  const label = String(row.name || row.title || row.type || row.certificationName || '').trim();
  if (!label) return null;
  const status = normalizeStatus(row.verificationStatus || row.status || toRecord(row.verification).status);
  const hasProof = Boolean(
    row.fileUrl ||
    row.documentUrl ||
    row.proofUrl ||
    row.uploadedAt ||
    row.documentId ||
    row.fileName
  );
  return { label, status, hasProof, sourcePath };
}

function getCanonicalCertifications(userDoc: Record<string, unknown>): { certifications: NormalizedCertification[]; usedLegacy: boolean } {
  const workerProfile = toRecord(userDoc.workerProfile);
  const workerCreds = toRecord(workerProfile.credentials);
  const workerCompliance = toRecord(userDoc.workerCompliance);
  const complianceCerts = toRecord(workerCompliance.certifications);

  const normalized: NormalizedCertification[] = [];
  const canonicalRaw = Array.isArray(workerCreds.certifications) ? workerCreds.certifications : [];
  canonicalRaw.forEach((c) => {
    const norm = normalizeCertification(c, 'workerProfile.credentials.certifications');
    if (norm) normalized.push(norm);
  });

  if (Object.keys(complianceCerts).length > 0) {
    Object.values(complianceCerts).forEach((c) => {
      const norm = normalizeCertification(c, 'workerCompliance.certifications');
      if (norm) normalized.push(norm);
    });
  }

  let usedLegacy = false;
  if (normalized.length === 0) {
    const legacyRaw = Array.isArray(userDoc.certifications) ? userDoc.certifications : [];
    legacyRaw.forEach((c) => {
      const norm = normalizeCertification(c, 'certifications');
      if (norm) normalized.push(norm);
    });
    usedLegacy = legacyRaw.length > 0;
  }

  return { certifications: normalized, usedLegacy };
}

export function buildJobReadinessReadModel(userDocInput: Record<string, unknown> | null): JobReadinessReadModel {
  const userDoc = userDocInput || {};
  const workerProfile = toRecord(userDoc.workerProfile);
  const preferences = toRecord(workerProfile.preferences);
  const availability = toRecord(userDoc.availability);
  const workerAvailability = toRecord(workerProfile.availability);
  const experience = toRecord(workerProfile.experience);
  const workerAttestations = toRecord(userDoc.workerAttestations);
  const profileAttestations = toRecord(workerProfile.attestations);
  const legacyFieldsUsed: string[] = [];

  const desiredWorkType = (() => {
    const canonical = String(preferences.desiredWorkType || '').toLowerCase();
    if (canonical === 'full_time' || canonical === 'part_time' || canonical === 'gig' || canonical === 'any') {
      return canonical as DesiredWorkType;
    }
    const legacy = String(toRecord(userDoc.jobReadiness).intent && toRecord(toRecord(userDoc.jobReadiness).intent).desiredWorkType || '').toLowerCase();
    if (legacy === 'full_time' || legacy === 'part_time' || legacy === 'gig' || legacy === 'any') {
      legacyFieldsUsed.push('jobReadiness.intent.desiredWorkType');
      return legacy as DesiredWorkType;
    }
    return undefined;
  })();

  const targetIndustries = (() => {
    const canonical = toStringList(preferences.targetIndustries)
      .map((v) => v.toLowerCase())
      .filter((v): v is TargetIndustry => v === 'hospitality' || v === 'industrial');
    if (canonical.length) return canonical;
    const legacy = toStringList(toRecord(toRecord(userDoc.jobReadiness).intent).targetIndustries)
      .map((v) => v.toLowerCase())
      .filter((v): v is TargetIndustry => v === 'hospitality' || v === 'industrial');
    if (legacy.length) {
      legacyFieldsUsed.push('jobReadiness.intent.targetIndustries');
      return legacy;
    }
    return undefined;
  })();

  const availabilityDays = [
    ...toStringList(workerAvailability.preferredDays),
    ...toStringList(preferences.availabilityDays),
    ...toStringList(availability.preferredDays),
    ...toStringList(userDoc.availabilityDays),
  ].map((d) => d.toLowerCase());
  if (toStringList(availability.preferredDays).length > 0 || toStringList(userDoc.availabilityDays).length > 0) {
    legacyFieldsUsed.push('availability.preferredDays', 'availabilityDays');
  }

  const skills = [
    ...toStringList(workerProfile.skills),
    ...toStringList(userDoc.skills),
  ].map((s) => s.toLowerCase());
  if (toStringList(userDoc.skills).length > 0 && toStringList(workerProfile.skills).length === 0) {
    legacyFieldsUsed.push('skills');
  }

  const photoUrl = String(workerProfile.photoUrl || userDoc.avatar || '').trim();
  if (!workerProfile.photoUrl && userDoc.avatar) {
    legacyFieldsUsed.push('avatar');
  }

  const workHistoryParts = [
    ...toStringList(experience.workHistory),
    ...toStringList(experience.previousRoles),
    ...toStringList(userDoc.workHistory),
    ...toStringList(userDoc.workExperience),
    ...toStringList(userDoc.previousRoles),
  ];
  if (
    toStringList(userDoc.workHistory).length > 0 ||
    toStringList(userDoc.workExperience).length > 0 ||
    toStringList(userDoc.previousRoles).length > 0
  ) {
    legacyFieldsUsed.push('workHistory', 'workExperience', 'previousRoles');
  }

  const uniformReady = Boolean(preferences.uniformReady || workerAttestations.uniformReady || profileAttestations.uniformReady);
  const hasSteelToeBoots = Boolean(
    preferences.hasSteelToeBoots ||
    workerAttestations.hasSteelToeBoots ||
    profileAttestations.hasSteelToeBoots
  );
  const flexibleShifts = Boolean(preferences.flexibleShifts);

  const certInfo = getCanonicalCertifications(userDoc);
  if (certInfo.usedLegacy) legacyFieldsUsed.push('certifications');

  const readModel: JobReadinessReadModel = {
    durableProfile: {
      desiredWorkType,
      targetIndustries,
      availabilityDays,
      skills,
      workHistoryText: workHistoryParts.join(' ').toLowerCase(),
      photoUrl,
      preferences: {
        uniformReady,
        hasSteelToeBoots,
        flexibleShifts,
      },
    },
    attestation: {
      uniformReady,
      hasSteelToeBoots,
    },
    verifiedCompliance: {
      certifications: certInfo.certifications,
    },
    legacyFieldsUsed: Array.from(new Set(legacyFieldsUsed)),
    hasVerifiedCertification: (patterns: string[]) => {
      const p = patterns.map((v) => v.toLowerCase());
      return certInfo.certifications.some((c) => {
        const verified = ['verified', 'approved', 'active', 'completed'].includes(c.status);
        return verified && p.some((needle) => c.label.toLowerCase().includes(needle));
      });
    },
    hasCertificationProofUploaded: (patterns: string[]) => {
      const p = patterns.map((v) => v.toLowerCase());
      return certInfo.certifications.some((c) => {
        const verified = ['verified', 'approved', 'active', 'completed'].includes(c.status);
        const pending = ['pending', 'submitted', 'uploaded', 'review'].includes(c.status) || c.hasProof;
        return pending && !verified && p.some((needle) => c.label.toLowerCase().includes(needle));
      });
    },
    hasWeekendAvailability: () =>
      availabilityDays.includes('weekend') ||
      availabilityDays.includes('saturday') ||
      availabilityDays.includes('sunday'),
    hasExperienceKeywords: (keywords: string[]) => {
      const haystack = `${skills.join(' ')} ${workHistoryParts.join(' ')}`.toLowerCase();
      return keywords.some((k) => haystack.includes(k.toLowerCase()));
    },
    hasProfilePhoto: () => Boolean(photoUrl),
  };

  return readModel;
}


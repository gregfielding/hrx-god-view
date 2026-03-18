import { serverTimestamp } from 'firebase/firestore';

type AnyMap = Record<string, unknown>;

const ATTESTATION_KEY_MAP: Record<string, string> = {
  comfortablePassDrug: 'workerAttestations.drugScreeningWillingness',
  passDrugExplanation: 'workerAttestations.drugScreeningNotes',
  comfortablePassBackground: 'workerAttestations.backgroundCheckWillingness',
  passBackgroundExplanation: 'workerAttestations.backgroundCheckNotes',
  comfortableEVerify: 'workerAttestations.eVerifyWillingness',
  comfortableWithLanguages: 'workerAttestations.languageRequirementWillingness',
  comfortableWithPhysicalRequirements: 'workerAttestations.physicalRequirementWillingness',
  comfortableWithUniformRequirements: 'workerAttestations.uniformRequirementWillingness',
  comfortableWithCustomUniformRequirements: 'workerAttestations.customUniformRequirementWillingness',
  comfortableWithRequiredPpe: 'workerAttestations.requiredPpeWillingness',
};

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function setIfDefined(target: AnyMap, key: string, value: unknown) {
  if (value !== undefined) {
    target[key] = value;
  }
}

export function buildCanonicalWorkerProfileWritePatch(partial: AnyMap): AnyMap {
  const patch: AnyMap = { ...partial };

  if (partial.skills !== undefined) {
    setIfDefined(patch, 'workerProfile.skills', partial.skills);
  }

  if (partial.languages !== undefined) {
    setIfDefined(patch, 'workerProfile.languages', partial.languages);
  }

  if (partial.education !== undefined) {
    setIfDefined(patch, 'workerProfile.experience.education', partial.education);
  }
  if (partial.educationLevel !== undefined) {
    setIfDefined(patch, 'workerProfile.experience.educationLevel', partial.educationLevel);
  }
  if (partial.experienceLevel !== undefined) {
    setIfDefined(patch, 'workerProfile.experience.level', partial.experienceLevel);
  }

  const workHistory = partial.workHistory !== undefined
    ? partial.workHistory
    : partial.workExperience;
  const workExperience = partial.workExperience !== undefined
    ? partial.workExperience
    : partial.workHistory;
  if (workHistory !== undefined || workExperience !== undefined) {
    setIfDefined(patch, 'workerProfile.experience.workHistory', workHistory);
    setIfDefined(patch, 'workerProfile.experience.workExperience', workExperience);
    setIfDefined(patch, 'workHistory', workHistory);
    setIfDefined(patch, 'workExperience', workExperience);
  }

  if (partial.certifications !== undefined) {
    setIfDefined(patch, 'workerProfile.credentials.certifications', partial.certifications);
  }

  if (partial.avatar !== undefined) {
    setIfDefined(patch, 'workerProfile.photoUrl', partial.avatar);
  }

  if (partial.transportMethod !== undefined) {
    setIfDefined(patch, 'workerProfile.preferences.transportMethod', partial.transportMethod);
  }

  if (partial.availableToStartDate !== undefined) {
    setIfDefined(patch, 'workerProfile.preferences.availableToStartDate', partial.availableToStartDate);
  }

  if (partial['preferences.shiftPreferences'] !== undefined) {
    setIfDefined(
      patch,
      'workerProfile.preferences.shiftPreferences',
      partial['preferences.shiftPreferences'],
    );
  }

  if (partial['preferences.availabilityNotes'] !== undefined) {
    setIfDefined(
      patch,
      'workerProfile.preferences.availabilityNotes',
      partial['preferences.availabilityNotes'],
    );
  }

  if (partial.preferences && typeof partial.preferences === 'object') {
    const pref = partial.preferences as AnyMap;
    if (pref.shiftPreferences !== undefined) {
      setIfDefined(patch, 'workerProfile.preferences.shiftPreferences', pref.shiftPreferences);
    }
    if (pref.availableToStartDate !== undefined) {
      setIfDefined(patch, 'workerProfile.preferences.availableToStartDate', pref.availableToStartDate);
    }
    if (pref.availabilityNotes !== undefined) {
      setIfDefined(patch, 'workerProfile.preferences.availabilityNotes', pref.availabilityNotes);
    }
    if (pref.targetPay !== undefined) {
      setIfDefined(patch, 'workerProfile.preferences.targetPay', pref.targetPay);
    }
    if (pref.shift !== undefined) {
      setIfDefined(patch, 'workerProfile.preferences.shift', pref.shift);
    }
  }

  if (partial['workerProfile.preferences.desiredWorkType'] !== undefined) {
    setIfDefined(
      patch,
      'jobReadiness.intent.desiredWorkType',
      partial['workerProfile.preferences.desiredWorkType'],
    );
  }
  if (partial['workerProfile.preferences.targetIndustries'] !== undefined) {
    setIfDefined(
      patch,
      'jobReadiness.intent.targetIndustries',
      partial['workerProfile.preferences.targetIndustries'],
    );
  }

  for (const [legacyKey, canonicalKey] of Object.entries(ATTESTATION_KEY_MAP)) {
    if (partial[legacyKey] !== undefined) {
      setIfDefined(patch, canonicalKey, partial[legacyKey]);
    }
  }

  if (partial.additionalScreenings && typeof partial.additionalScreenings === 'object') {
    setIfDefined(patch, 'workerAttestations.additionalScreenings', partial.additionalScreenings);
  }

  if (partial.requirementsAcks && typeof partial.requirementsAcks === 'object') {
    setIfDefined(patch, 'workerProfile.readiness.requirementsAcks', partial.requirementsAcks);
  }

  for (const [key, value] of Object.entries(partial)) {
    if (!key.startsWith('comfortableWith')) continue;
    if (ATTESTATION_KEY_MAP[key]) continue;
    const suffix = key.replace(/^comfortableWith/, '');
    if (!suffix) continue;
    const normalized = suffix.charAt(0).toLowerCase() + suffix.slice(1);
    setIfDefined(patch, `workerAttestations.additionalScreenings.${normalized}`, value);
  }

  return patch;
}

export function buildReadinessIntentWritePatch(
  desiredWorkType: string,
  targetIndustries: string[],
  scheduleIntentOptions?: string[],
): AnyMap {
  const patch = buildCanonicalWorkerProfileWritePatch({
    'workerProfile.preferences.desiredWorkType': desiredWorkType,
    'workerProfile.preferences.targetIndustries': targetIndustries,
    updatedAt: serverTimestamp(),
  });

  if (Array.isArray(scheduleIntentOptions)) {
    patch['workerProfile.preferences.scheduleIntentOptions'] = scheduleIntentOptions;
    patch['jobReadiness.intent.scheduleIntentOptions'] = scheduleIntentOptions;
  }

  return patch;
}

export function buildReadinessResponseWritePatch(requirementId: string, value: string): AnyMap {
  return {
    [`workerProfile.readiness.responses.${requirementId}.value`]: value,
    [`workerProfile.readiness.responses.${requirementId}.answeredAt`]: serverTimestamp(),
    [`jobReadinessEngineResponses.${requirementId}.value`]: value,
    [`jobReadinessEngineResponses.${requirementId}.answeredAt`]: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

export function buildCertificationUploadWritePatch(unionValue: unknown): AnyMap {
  return {
    certifications: unionValue,
    'workerProfile.credentials.certifications': unionValue,
    updatedAt: serverTimestamp(),
  };
}

export function buildCertificationReplaceWritePatch(nextCertifications: unknown[]): AnyMap {
  return buildCanonicalWorkerProfileWritePatch({
    certifications: asArray(nextCertifications),
    updatedAt: serverTimestamp(),
  });
}


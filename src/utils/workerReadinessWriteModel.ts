import { serverTimestamp } from 'firebase/firestore';
import {
  scheduleIntentOptionsToSchedulePreferences,
} from './workerPreferencesCanonical';
import { warnLegacyCertUsageDetected } from '../shared/certifications/certificationsLogging';
import type { WorkerAttestationSource } from '../types/UserProfile';

type AnyMap = Record<string, unknown>;

/**
 * Re-export of the WorkerAttestationSource union from `UserProfile`. Kept here
 * so call sites that build patches don't need a second import. Default source
 * is `'application'` — see `buildCanonicalWorkerProfileWritePatch` options.
 */
export type { WorkerAttestationSource } from '../types/UserProfile';

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

/**
 * Free-text explanation fields don't get provenance stamps — they're notes
 * attached to a willingness answer, not separate attestations. The willingness
 * answer they accompany already carries the `_meta` entry.
 */
const ATTESTATION_NOTE_KEYS = new Set<string>([
  'workerAttestations.drugScreeningNotes',
  'workerAttestations.backgroundCheckNotes',
]);

/**
 * Strip the `workerAttestations.` prefix from a canonical key to produce the
 * `_meta` entry key. Used by both the static `ATTESTATION_KEY_MAP` loop and
 * the dynamic `comfortableWith*` fallback.
 */
function metaKeyForCanonicalKey(canonicalKey: string): string | null {
  if (!canonicalKey.startsWith('workerAttestations.')) return null;
  if (ATTESTATION_NOTE_KEYS.has(canonicalKey)) return null;
  return canonicalKey.slice('workerAttestations.'.length);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function setIfDefined(target: AnyMap, key: string, value: unknown) {
  if (value !== undefined) {
    target[key] = value;
  }
}

/**
 * Options for `buildCanonicalWorkerProfileWritePatch`.
 *
 * `source` controls the `workerAttestations._meta.<field>.source` value
 * stamped alongside each attestation answer this patch writes. Defaults to
 * `'application'` (the original wizard submission path). The R.0c backfill
 * callable passes `'application_backfill'`; the future R.9 worker-edit path
 * passes `'worker_edit'`; CSA overrides pass `'csa_override'`.
 */
export interface BuildCanonicalWorkerProfileWritePatchOptions {
  source?: WorkerAttestationSource;
}

export function buildCanonicalWorkerProfileWritePatch(
  partial: AnyMap,
  options: BuildCanonicalWorkerProfileWritePatchOptions = {},
): AnyMap {
  const patch: AnyMap = { ...partial };
  const attestationSource: WorkerAttestationSource = options.source ?? 'application';

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
    warnLegacyCertUsageDetected({
      surface: 'buildCanonicalWorkerProfileWritePatch',
      field: 'workerProfile.credentials.certifications',
    });
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
      const metaKey = metaKeyForCanonicalKey(canonicalKey);
      if (metaKey) {
        patch[`workerAttestations._meta.${metaKey}.attestedAt`] = serverTimestamp();
        patch[`workerAttestations._meta.${metaKey}.source`] = attestationSource;
      }
    }
  }

  if (partial.additionalScreenings && typeof partial.additionalScreenings === 'object') {
    setIfDefined(patch, 'workerAttestations.additionalScreenings', partial.additionalScreenings);
    // Stamp per-screening provenance under `_meta.<screeningName>` so each
    // entry in the screenings map carries its own attestedAt/source. The
    // screening name is the meta key (matches how the value is read).
    for (const screeningName of Object.keys(partial.additionalScreenings as AnyMap)) {
      patch[`workerAttestations._meta.${screeningName}.attestedAt`] = serverTimestamp();
      patch[`workerAttestations._meta.${screeningName}.source`] = attestationSource;
    }
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
    patch[`workerAttestations._meta.${normalized}.attestedAt`] = serverTimestamp();
    patch[`workerAttestations._meta.${normalized}.source`] = attestationSource;
  }

  return patch;
}

export function buildReadinessIntentWritePatch(
  desiredWorkType: string,
  targetIndustries: string[],
  scheduleIntentOptions?: string[],
): AnyMap {
  const normalizedIndustries = targetIndustries
    .map((x) => String(x).toLowerCase().trim())
    .filter((x) => x === 'hospitality' || x === 'industrial');

  const patch = buildCanonicalWorkerProfileWritePatch({
    'workerProfile.preferences.desiredWorkType': desiredWorkType,
    'workerProfile.preferences.targetIndustries': targetIndustries,
    updatedAt: serverTimestamp(),
  });

  /** Canonical prescreen-aligned work types — UI today only toggles hospitality/industrial. */
  patch['workerProfile.preferences.targetWorkTypes'] =
    normalizedIndustries.length > 0 ? normalizedIndustries : targetIndustries.map((x) => String(x).toLowerCase().trim())
      .filter(Boolean);

  if (Array.isArray(scheduleIntentOptions)) {
    patch['workerProfile.preferences.scheduleIntentOptions'] = scheduleIntentOptions;
    patch['jobReadiness.intent.scheduleIntentOptions'] = scheduleIntentOptions;
    const schedulePreferences = scheduleIntentOptionsToSchedulePreferences(scheduleIntentOptions, desiredWorkType);
    patch['workerProfile.preferences.schedulePreferences'] = schedulePreferences;
    patch['workerProfile.preferences.openToGigWork'] = schedulePreferences.includes('gig_work');
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
  warnLegacyCertUsageDetected({
    surface: 'buildCertificationUploadWritePatch',
    field: 'user.certifications + workerProfile.credentials.certifications',
  });
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


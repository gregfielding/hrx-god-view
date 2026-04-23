import certificationCatalogManifest from '../data/generated/certificationCatalogManifest.v1.json';
import type { CertificationCatalogManifestV1 } from '../types/certifications/certificationCatalogManifest';
import { isCertEngineReadinessEnabled } from './certifications/certEngineReadinessFlag';
import {
  computeEngineGapForPhase1Requirements,
  computeEngineGapLabelsForLegacyJobStrings,
} from './certifications/evaluateCertificationsForLegacyRequirementStrings';
import { warnCertifications } from './certifications/certificationsLogging';
import { buildCertificationRequirementsFromJobPosting, type JobPostingLike } from './certifications/buildCertificationRequirementsFromJobPosting';
import { logCertEngineShadowMismatch } from './certifications/certEngineShadowCompare';
import { normalizeDateToISODateString } from './certifications/normalizeDateToISODateString';

const defaultManifest = certificationCatalogManifest as CertificationCatalogManifestV1;

/**
 * Utility function to check if a user is missing any required licenses/certifications for a job posting
 *
 * @param requiredCerts - Array of required certifications from job posting (e.g., ["Food Handler's License (License)", "CPR Certification (Certification)"])
 * @param userCerts - Array of user's certifications from their profile (objects with `name` property)
 * @returns Array of missing certification names
 */
export function checkMissingCertifications(
  requiredCerts: string[] | undefined,
  userCerts: Array<{ name?: string }> | undefined,
): string[] {
  if (!requiredCerts || requiredCerts.length === 0) {
    return [];
  }

  if (!userCerts || userCerts.length === 0) {
    return requiredCerts;
  }

  // Normalize user cert names for comparison
  const userCertNames = userCerts
    .map((cert) => {
      const name = typeof cert === 'string' ? cert : cert?.name;
      return name ? name.toLowerCase().trim() : '';
    })
    .filter(Boolean);

  // Check each required cert against user's certs
  const missing: string[] = [];

  for (const requiredCert of requiredCerts) {
    const requiredCertLower = requiredCert.toLowerCase().trim();

    // Check for exact match
    let found = userCertNames.some((userCert) => userCert === requiredCertLower);

    // If not found, try partial matching (e.g., "Food Handler" matches "Food Handler's License")
    if (!found) {
      // Extract the main part of the cert name (before parentheses)
      const mainPart = requiredCertLower.split('(')[0].trim();
      found = userCertNames.some((userCert) => {
        // Check if user cert contains the main part or vice versa
        return userCert.includes(mainPart) || mainPart.includes(userCert);
      });
    }

    if (!found) {
      missing.push(requiredCert);
    }
  }

  return missing;
}

/**
 * Engine-backed gap list for apply-style surfaces — **only when** `REACT_APP_CERT_ENGINE_READINESS=true`.
 * Falls back to legacy string heuristic via {@link checkMissingCertifications} when the flag is off.
 * Logs dev-only readiness mismatches when both paths are evaluated.
 */
export async function checkMissingCertificationsWithEngine(options: {
  requiredCerts: string[] | undefined;
  userCerts: Array<{ name?: string }> | undefined;
  workerUid: string;
  /** Phase 6 — when set, requirements are derived via {@link buildCertificationRequirementsFromJobPosting} for shadow metadata. */
  jobPosting?: JobPostingLike | null;
}): Promise<string[]> {
  const { requiredCerts, userCerts, workerUid, jobPosting } = options;
  if (!requiredCerts?.length) return [];

  const legacy = checkMissingCertifications(requiredCerts, userCerts);

  if (!isCertEngineReadinessEnabled()) {
    return legacy;
  }

  const todayISO = normalizeDateToISODateString(new Date()) ?? '1970-01-01';

  let engineLabels: string[];
  let unmappedStrings: string[] | undefined;
  let rows: Awaited<ReturnType<typeof computeEngineGapLabelsForLegacyJobStrings>>['rows'] = [];

  if (jobPosting) {
    const built = buildCertificationRequirementsFromJobPosting({
      posting: jobPosting,
      manifest: defaultManifest,
    });
    const ev = await computeEngineGapForPhase1Requirements({
      workerUid,
      requirements: built.requirements,
      context: 'apply',
      todayISO,
      manifest: defaultManifest,
    });
    engineLabels = ev.labels;
    rows = ev.rows;
    unmappedStrings = built.unmappedStrings;
    if (built.requirements.length === 0 && requiredCerts.length > 0) {
      const fallback = await computeEngineGapLabelsForLegacyJobStrings({
        workerUid,
        licensesCertsCombined: requiredCerts,
        context: 'apply',
        todayISO,
        manifest: defaultManifest,
      });
      engineLabels = fallback.labels;
      rows = fallback.rows;
      unmappedStrings = fallback.unmappedStrings;
    }
  } else {
    const ev = await computeEngineGapLabelsForLegacyJobStrings({
      workerUid,
      licensesCertsCombined: requiredCerts,
      context: 'apply',
      todayISO,
      manifest: defaultManifest,
    });
    engineLabels = ev.labels;
    rows = ev.rows;
    unmappedStrings = ev.unmappedStrings;
  }

  logCertEngineShadowMismatch({
    surface: 'apply',
    requirementSource: 'job_posting',
    userId: workerUid,
    jobPostingId: jobPosting?.id,
    legacyMissing: legacy,
    engineLabels,
    unmappedStrings,
    engineRows: rows.map((r) => ({
      catalogEntryId: r.requirement.catalogEntryId,
      status: r.result.status,
      legacySourceLabel: r.requirement.legacySourceLabel,
    })),
  });

  if (process.env.NODE_ENV !== 'production') {
    const oldS = [...legacy].sort().join('\u0000');
    const newS = [...engineLabels].sort().join('\u0000');
    if (oldS !== newS) {
      warnCertifications('readiness_mismatch', {
        userId: workerUid,
        detail: {
          oldMissing: legacy,
          newMissing: engineLabels,
          oldBlockers: legacy,
          newBlockers: engineLabels,
        },
      });
    }
  }

  return engineLabels.length > 0 ? engineLabels : legacy;
}


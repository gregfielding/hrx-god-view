/**
 * Apply-flow "missing certs" entry point.
 *
 * **Phase B.4 (2026-04):** the legacy fuzzy string-matcher path was removed.
 * The cert engine (`evaluateCertificationRequirement` via the gap helpers)
 * is now the single source of truth for which required certifications a
 * worker is missing at apply time. The `REACT_APP_CERT_ENGINE_READINESS`
 * flag still exists for OTHER surfaces (PlacementsTab placement-blocker
 * shadow compare, `placementQualificationChipsModel`) but no longer gates
 * this function — engine is always on here.
 *
 * The previously-exported legacy `checkMissingCertifications(requiredCerts,
 * userCerts): string[]` was deleted. It did fuzzy substring matching with
 * NO expiration check — workers with expired certs passed silently. Anyone
 * who needs that string-only matcher today should think twice and call the
 * engine path instead.
 *
 * @see shared/certifications/evaluateCertificationRequirement.ts (engine)
 * @see shared/jobRequirementMatchers/matchCertifications.ts (readiness adapter)
 * @see docs/READINESS_EXECUTION_MATRIX.md §4.1, §6 hole #14
 */

import certificationCatalogManifest from '../shared/data/certificationCatalogManifest.v1.json';
import type { CertificationCatalogManifestV1 } from '../shared/certifications/certificationCatalogManifest';
import {
  computeEngineGapForPhase1Requirements,
  computeEngineGapLabelsForLegacyJobStrings,
} from './certifications/evaluateCertificationsForLegacyRequirementStrings';
import {
  buildCertificationRequirementsFromJobPosting,
  type JobPostingLike,
} from './certifications/buildCertificationRequirementsFromJobPosting';
import { normalizeDateToISODateString } from '../shared/certifications/normalizeDateToISODateString';

const defaultManifest = certificationCatalogManifest as CertificationCatalogManifestV1;

/**
 * Engine-backed missing-certs gap list for apply-style surfaces.
 *
 * Returns user-visible labels for required certs the worker doesn't satisfy
 * (missing, expired, rejected, pending review under apply context, etc.).
 * Empty result → worker satisfies every required cert.
 *
 * **Conservative handling for unresolvable strings:** if the JO declares a
 * required cert string that can't be mapped to a catalog entry, the engine
 * returns it as an `unmappedString`. We surface those as "missing" — better
 * to ask the worker about an ambiguous requirement than to silently let them
 * through. (Catalog hygiene is the long-term fix.)
 *
 * Public API kept stable for `src/pages/PublicJobsBoard.tsx`. The function
 * name retains "WithEngine" for now since renaming touches the UI caller; a
 * follow-up can drop the suffix once we're certain the engine path is
 * stable.
 */
export async function checkMissingCertificationsWithEngine(options: {
  requiredCerts: string[] | undefined;
  userCerts: Array<{ name?: string }> | undefined;
  workerUid: string;
  /** Phase 6 — when set, requirements are derived via {@link buildCertificationRequirementsFromJobPosting}. */
  jobPosting?: JobPostingLike | null;
}): Promise<string[]> {
  const { requiredCerts, workerUid, jobPosting } = options;
  if (!requiredCerts?.length) return [];

  const todayISO = normalizeDateToISODateString(new Date()) ?? '1970-01-01';

  let engineLabels: string[] = [];
  let unmappedStrings: string[] | undefined;

  if (jobPosting) {
    const built = buildCertificationRequirementsFromJobPosting({
      posting: jobPosting,
      manifest: defaultManifest,
    });

    if (built.requirements.length === 0 && requiredCerts.length > 0) {
      // Posting yielded no structured requirements but the JO carries
      // legacy required-cert strings — fall through to the legacy-string
      // engine path (which does its own catalog lookup over the strings).
      // Skip the structured-engine call entirely; it would do nothing.
      const fallback = await computeEngineGapLabelsForLegacyJobStrings({
        workerUid,
        licensesCertsCombined: requiredCerts,
        context: 'apply',
        todayISO,
        manifest: defaultManifest,
      });
      engineLabels = fallback.labels;
      unmappedStrings = fallback.unmappedStrings;
    } else {
      const ev = await computeEngineGapForPhase1Requirements({
        workerUid,
        requirements: built.requirements,
        context: 'apply',
        todayISO,
        manifest: defaultManifest,
      });
      engineLabels = ev.labels;
      unmappedStrings = built.unmappedStrings;
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
    unmappedStrings = ev.unmappedStrings;
  }

  // Conservative: if the JO declared a required string the engine couldn't
  // map to a catalog entry, treat it as missing. The pre-B.4 code lost these
  // (only logged in shadow-compare); we surface them now.
  if (unmappedStrings && unmappedStrings.length > 0) {
    const seen = new Set(engineLabels);
    for (const s of unmappedStrings) {
      if (s && !seen.has(s)) {
        engineLabels.push(s);
        seen.add(s);
      }
    }
  }

  return engineLabels;
}

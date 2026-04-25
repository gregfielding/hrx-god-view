/**
 * License matcher — does the worker hold a license matching the JO's required
 * class with at least the listed endorsements, and is it currently valid?
 *
 * Cardinality: **one matcher call per `RequiredLicenseV1` entry on the JO.**
 * Trigger calls per entry, producing one `license_match` readiness item per
 * required license.
 *
 * No legacy parser — `users.licenses[]` is greenfield (B.1). For tenants with
 * legacy data still in `users.certifications[]` mash, the trigger will need
 * to extract license-shaped entries; that extraction is NOT this matcher's job.
 *
 * Expiration: `complete_fail` if the matched license has expired (today >
 * expirationDate). Future-dated or absent expiration → still passes.
 *
 * @see shared/licenseRecord.ts
 * @see docs/READINESS_EXECUTION_MATRIX.md §4.2
 */

import type { LicenseRecordV1, RequiredLicenseV1 } from '../licenseRecord';
import { matcherResult, type MatcherResult } from './types';

export type MatchLicensesInput = {
  /** The single license requirement to evaluate. */
  required: RequiredLicenseV1;
  /** Worker's typed license records. */
  workerLicenses?: LicenseRecordV1[] | null;
  /**
   * Today as ISO YYYY-MM-DD for expiration comparisons. Caller injects to
   * keep the matcher pure (testable / deterministic).
   */
  todayISO: string;
};

export type MatchLicensesDetails = {
  requiredClass: string;
  requiredEndorsements: string[];
  matchedLicense: LicenseRecordV1 | null;
  /** Endorsements required by JO that the matched worker license is missing. */
  missingEndorsements: string[];
  /** True when the matched license has expired relative to `todayISO`. */
  expired: boolean;
};

const norm = (s: string): string => s.trim().toLowerCase();

function matchesClass(required: string, candidate: string): boolean {
  return norm(required) === norm(candidate);
}

function endorsementSet(arr?: string[] | null): Set<string> {
  if (!Array.isArray(arr)) return new Set();
  return new Set(arr.map(norm).filter((s) => s.length > 0));
}

/**
 * Match a single required license against the worker's licenses.
 *
 *   - JO requirement has no `licenseClass` → `not_applicable`
 *   - Worker has no licenses array / empty → `incomplete`
 *   - No license class matches → `complete_fail` (worker doesn't hold the right type)
 *   - License class matches but missing required endorsements → `complete_fail`
 *   - License class matches, all endorsements present, but expired → `complete_fail`
 *   - License class matches, all endorsements present, not expired → `complete_pass`
 *
 * When a class matches but the worker holds it without all endorsements, we
 * surface the missing endorsements in `details.missingEndorsements` for the
 * audit trail — recruiters can use that to coach the worker.
 */
export function matchLicenses(input: MatchLicensesInput): MatcherResult<MatchLicensesDetails> {
  const requiredClass = input.required.licenseClass?.trim() ?? '';
  const requiredEndorsements = (input.required.requiredEndorsements ?? []).filter(
    (e) => typeof e === 'string' && e.trim().length > 0,
  );

  if (!requiredClass) {
    return matcherResult.notApplicable<MatchLicensesDetails>('required_class_empty', {
      requiredClass: input.required.licenseClass ?? '',
      requiredEndorsements,
      matchedLicense: null,
      missingEndorsements: [],
      expired: false,
    });
  }

  const workerLicenses = Array.isArray(input.workerLicenses) ? input.workerLicenses : [];

  if (workerLicenses.length === 0) {
    return matcherResult.incomplete<MatchLicensesDetails>('worker_has_no_licenses', {
      requiredClass,
      requiredEndorsements,
      matchedLicense: null,
      missingEndorsements: requiredEndorsements,
      expired: false,
    });
  }

  // Find a license whose class matches.
  const candidate = workerLicenses.find(
    (l) => l && typeof l.licenseClass === 'string' && matchesClass(requiredClass, l.licenseClass),
  );

  if (!candidate) {
    return matcherResult.fail<MatchLicensesDetails>('class_not_held', {
      requiredClass,
      requiredEndorsements,
      matchedLicense: null,
      missingEndorsements: requiredEndorsements,
      expired: false,
    });
  }

  // Endorsement subset check (case-insensitive).
  const reqSet = endorsementSet(requiredEndorsements);
  const heldSet = endorsementSet(candidate.endorsements);
  const missing: string[] = [];
  for (const required of reqSet) {
    if (!heldSet.has(required)) {
      // Re-derive original casing from input for nicer surface display.
      const orig = requiredEndorsements.find((e) => norm(e) === required) ?? required;
      missing.push(orig);
    }
  }

  // Expiration check.
  const expired =
    typeof candidate.expirationDate === 'string' &&
    candidate.expirationDate.trim().length > 0 &&
    candidate.expirationDate < input.todayISO;

  const details: MatchLicensesDetails = {
    requiredClass,
    requiredEndorsements,
    matchedLicense: candidate,
    missingEndorsements: missing,
    expired,
  };

  if (missing.length > 0) {
    return matcherResult.fail<MatchLicensesDetails>('missing_endorsement', details);
  }

  if (expired) {
    return matcherResult.fail<MatchLicensesDetails>('expired', details);
  }

  return matcherResult.pass<MatchLicensesDetails>('class_and_endorsements_match', details);
}

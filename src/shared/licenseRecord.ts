/**
 * Worker-held License record — split from the legacy `users.certifications[]`
 * string mash so we can express class + endorsements + expiration on a typed
 * shape. Consumed by the License requirement matcher (Phase B).
 *
 * **Not** the same as `CertificationRecordV1` (in `src/types/certifications/`).
 * Licenses (CDL, forklift, food handler) carry vocabulary that certifications
 * don't — vehicle / cargo class, required endorsements, issuing state.
 * Certifications are flat. Both can expire.
 *
 * Runtime-neutral. No firebase imports; callers convert dates on write.
 *
 * @see docs/READINESS_EXECUTION_MATRIX.md §4.2
 * @see shared/jobRequirementMatchers/matchLicenses.ts (consumer — Phase B.3)
 */

export const LICENSE_RECORD_V1_VERSION = 1;

/**
 * One entry in `users.licenses[]`. Worker holds at most one record per
 * (licenseClass, issuingState) tuple at a time — re-issuance supersedes.
 *
 * Matching is case-insensitive on `licenseClass` and on each endorsement,
 * comparing trimmed values. See `matchLicenses.ts` for the matcher contract.
 */
export type LicenseRecordV1 = {
  schemaVersion: 1;
  /**
   * License class as recognized by the issuing authority. Free-form so tenants
   * can accept any vocabulary. Examples: `'CDL Class A'`, `'CDL Class B'`,
   * `'Forklift'`, `'Food Handler'`, `'OSHA-30'`.
   */
  licenseClass: string;
  /**
   * Endorsements on top of the base class. CDL examples: `'H'` hazmat,
   * `'T'` doubles/triples, `'X'` tank+hazmat, `'P'` passenger. Absent or `[]`
   * are treated identically by matchers.
   */
  endorsements?: string[];
  /** UTC calendar date `YYYY-MM-DD` when set. `null` / absent = no expiration on file. */
  expirationDate?: string | null;
  /** Issuing US state as two-letter code or full name. Optional. */
  issuingState?: string | null;
  /** License / permit number for the worker's records. Not validated. */
  licenseNumber?: string | null;
  /** Firestore Timestamp on write; runtime-neutral here. */
  createdAt?: unknown;
  updatedAt?: unknown;
};

/**
 * One entry in `JobOrder.requiredLicensesV2[]`. The JO declares "the worker
 * must hold a license whose class matches `licenseClass` and that carries at
 * least the listed `requiredEndorsements`".
 *
 * Worker may carry additional endorsements beyond what's required; the
 * matcher treats `requiredEndorsements` as a subset check, not equality.
 */
export type RequiredLicenseV1 = {
  /** Class to match against `LicenseRecordV1.licenseClass` (case-insensitive). */
  licenseClass: string;
  /**
   * Endorsements that MUST be present on the worker's matching license
   * (case-insensitive set comparison; subset). Absent / `[]` = no endorsement
   * requirement.
   */
  requiredEndorsements?: string[];
};

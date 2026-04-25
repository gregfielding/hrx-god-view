/**
 * Phase C — stamp `expiresAtMs` onto Phase B match specs at seed time.
 *
 * Wraps `buildPhaseBMatchSpecs` (in `jobRequirementMatcherHelpers.ts`) without
 * editing it — Cursor is concurrently working on B.5.1 in that file, so all
 * Phase C additions live in this new file.
 *
 * **Why stamp at seed time, not query-time:** the daily reconciler runs across
 * the entire `assignmentReadinessItems` collection group. Without an indexed
 * `expiresAtMs` field on each doc, the reconciler would have to load every
 * `complete_pass` item + the worker doc + the JO doc per item to check
 * expiration. With the field stamped, the reconciler is a single composite
 * query: `where('expiresAtMs', '<', nowMs).where('status', '==', 'complete_pass')`.
 *
 * **Which items get stamped:**
 *   - `license_match` — derived from the matched worker license's
 *     `expirationDate` (ISO YYYY-MM-DD → ms). Skipped when license has no
 *     expiration on file.
 *   - `screening_package_match` — uses `screeningEval.expiresAtMs` directly
 *     when satisfied + non-expired. Skipped when not satisfied (the item's
 *     status is already complete_fail; no expiry semantics).
 *   - `cert_match` — currently shells with status='incomplete' (no engine
 *     wire-up until B.5.1). Once Cursor lands B.5.1 with cert eval, an
 *     equivalent stamping path can fold in here.
 *
 * Other types (`education_match`, `language_match`, `skill_match`, etc.) leave
 * `expiresAtMs` unset — they don't have meaningful expiration.
 *
 * @see docs/READINESS_EXECUTION_MATRIX.md §7 Phase C
 */

import type { SeedAssignmentReadinessRequirementSpec } from '../shared/seedAssignmentReadinessItems';
import type { LicenseRecordV1, RequiredLicenseV1 } from '../shared/licenseRecord';
import type { ScreeningEvalResult } from '../shared/jobRequirementMatchers/matchScreeningPackage';

export interface StampExpiryArgs {
  /** Output of `buildPhaseBMatchSpecs` — specs to augment in place. */
  specs: SeedAssignmentReadinessRequirementSpec[];
  /** Worker's license records — used to look up the matched license's expirationDate. */
  workerLicenses: LicenseRecordV1[] | null;
  /** JO's required licenses (V2). Used to identify which license slot each
   *  `license_match` spec corresponds to (matched by customKey from licenseClass). */
  requiredLicensesV2: RequiredLicenseV1[];
  /** Pre-computed screening eval result (from `loadScreeningEvalForJobOrder`). */
  screeningEval: ScreeningEvalResult | null;
}

/**
 * Mutate the spec list in place, adding `expiresAtMs` where applicable.
 *
 * Returns the same array reference for ergonomic chaining; mutation is
 * intentional — the spec list is short-lived and not shared.
 */
export function stampExpiryOnSpecs(
  args: StampExpiryArgs,
): SeedAssignmentReadinessRequirementSpec[] {
  for (const spec of args.specs) {
    const expiresAtMs = computeExpiryForSpec(spec, args);
    if (expiresAtMs != null) {
      spec.expiresAtMs = expiresAtMs;
    }
  }
  return args.specs;
}

function computeExpiryForSpec(
  spec: SeedAssignmentReadinessRequirementSpec,
  args: StampExpiryArgs,
): number | null {
  // Only stamp when the spec is currently complete_pass — items that already
  // failed or are incomplete have no expiry to track. (Status defaults to
  // 'incomplete' when omitted by the spec generator.)
  if (spec.status !== 'complete_pass') return null;

  switch (spec.requirementType) {
    case 'license_match':
      return expiryForLicenseMatch(spec, args);
    case 'screening_package_match':
      return expiryForScreeningMatch(args.screeningEval);
    default:
      return null;
  }
}

function expiryForLicenseMatch(
  spec: SeedAssignmentReadinessRequirementSpec,
  args: StampExpiryArgs,
): number | null {
  // Find which JO license requirement this spec corresponds to via the
  // spec's customKey (slugified licenseClass). Then find the worker license
  // that satisfies that requirement (case-insensitive class match) and read
  // its expirationDate.
  if (!args.workerLicenses || args.workerLicenses.length === 0) return null;

  const requiredClass = findRequiredClassForSpec(spec, args.requiredLicensesV2);
  if (!requiredClass) return null;

  const matchedLicense = args.workerLicenses.find(
    (l) =>
      l &&
      typeof l.licenseClass === 'string' &&
      l.licenseClass.trim().toLowerCase() === requiredClass.trim().toLowerCase(),
  );
  if (!matchedLicense) return null;

  return parseIsoDateToMillis(matchedLicense.expirationDate);
}

function expiryForScreeningMatch(eval_: ScreeningEvalResult | null): number | null {
  if (!eval_) return null;
  if (typeof eval_.expiresAtMs !== 'number') return null;
  if (eval_.expiresAtMs <= 0) return null;
  return eval_.expiresAtMs;
}

/**
 * Slugify the same way `jobRequirementMatcherHelpers.slugify` does — kept
 * inline to avoid importing from a file Cursor is concurrently editing.
 * Same behavior; verified against the same id-builder regex.
 */
function slugifyForMatch(s: string): string {
  return s.trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
}

function findRequiredClassForSpec(
  spec: SeedAssignmentReadinessRequirementSpec,
  required: RequiredLicenseV1[],
): string | null {
  const customKey = spec.customKey;
  if (!customKey) return null;
  for (const req of required) {
    if (slugifyForMatch(req.licenseClass) === customKey) {
      return req.licenseClass;
    }
  }
  return null;
}

/**
 * Convert an ISO YYYY-MM-DD date string to UTC midnight in ms. Returns null
 * for non-strings, empty, or unparseable values.
 *
 * Day-precision intentional: license expirationDate is a calendar date, not a
 * datetime. Reconciler treats today === expirationDate as still valid (matches
 * `matchLicenses` semantics: `expirationDate < todayISO` is the failure
 * condition).
 */
function parseIsoDateToMillis(iso: string | null | undefined): number | null {
  if (typeof iso !== 'string') return null;
  const trimmed = iso.trim();
  if (!trimmed) return null;
  // Strict YYYY-MM-DD parse to avoid accepting freeform date strings.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const [, y, m, d] = match;
  const ms = Date.UTC(Number(y), Number(m) - 1, Number(d));
  if (Number.isNaN(ms)) return null;
  return ms;
}

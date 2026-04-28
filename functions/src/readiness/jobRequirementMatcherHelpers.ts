/**
 * Phase B.5 / B.5.1 helpers — load worker / background-check / cert-record
 * data and run the `shared/jobRequirementMatchers/` over a JO's requirements
 * at assignment-creation time.
 *
 * Returns a list of `SeedAssignmentReadinessRequirementSpec` entries, one per
 * applicable Phase B match item. The trigger concatenates these with the
 * existing flag-based requirements (background_check, drug_screen, etc.)
 * before invoking the seed runner.
 *
 * **Scope (Phase B.5.1):** all six matchers are wired — Education, Languages,
 * Skills, Licenses, Screening Package, and **Certifications**. The cert
 * engine (`evaluateCertificationRequirement`) lives in `shared/certifications/`
 * (promoted in B.5.1) and runs server-side here at seed time. Worker
 * `certification_records` are pre-loaded from `users/{uid}/certification_records`
 * and indexed by `catalogEntryId`; legacy JO requirement strings get mapped
 * via the catalog manifest (`buildCertificationRequirementsFromJobOrder`),
 * unmapped ones surface as `needs_review` so a CSA looks at them.
 *
 * @see docs/READINESS_EXECUTION_MATRIX.md §7 Phase B
 * @see shared/certifications/evaluateCertificationRequirement.ts (engine)
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

import {
  evaluateScreeningSatisfiedServer,
  requestedEquivalencyKey,
  type BgLike,
  type ScreeningSatisfiedEvaluation,
} from '../compliance/screeningAutomationShared';
import {
  DEFAULT_REQUIREMENT_SEVERITY,
  type SeedAssignmentReadinessRequirementSpec,
} from '../shared/seedAssignmentReadinessItems';
import type {
  AssignmentReadinessRequirementType,
  AssignmentReadinessSeverity,
} from '../shared/assignmentReadinessItemV1';

import { matchEducation } from '../shared/jobRequirementMatchers/matchEducation';
import { matchLanguages } from '../shared/jobRequirementMatchers/matchLanguages';
import { matchSkills } from '../shared/jobRequirementMatchers/matchSkills';
import { matchLicenses } from '../shared/jobRequirementMatchers/matchLicenses';
import {
  matchScreeningPackage,
  type ScreeningEvalResult,
} from '../shared/jobRequirementMatchers/matchScreeningPackage';
import {
  matchCertifications,
  type CertificationEvalStatus,
} from '../shared/jobRequirementMatchers/matchCertifications';
// R.2 — willingness matchers (worker self-attestations).
import { matchPhysicalWillingness } from '../shared/jobRequirementMatchers/matchPhysicalWillingness';
import { matchPpeWillingness } from '../shared/jobRequirementMatchers/matchPpeWillingness';
import { matchLanguageWillingness } from '../shared/jobRequirementMatchers/matchLanguageWillingness';
import { matchUniformWillingness } from '../shared/jobRequirementMatchers/matchUniformWillingness';
import type { WillingnessInput } from '../shared/jobRequirementMatchers/willingness';
import type { MatcherResult } from '../shared/jobRequirementMatchers/types';
// R.16.2c — snapshot precedence for `physicalRequirements` +
// `customUniformRequirements` reads (see L5.physicalRequirements +
// L5.customUniformRequirements decisions). Keeps the willingness gates
// reading the value the JO was activated under, even after a CSA
// edits the parent Account post-activation.
import {
  getEffectiveJobOrderField,
  type JobOrderForEffectiveRead,
} from '../shared/jobOrder/getEffectiveJobOrderField';

import {
  isEducationLevel,
  type EducationLevel,
} from '../shared/educationLevel';
import {
  isLanguageProficiencyLevel,
  type LanguageProficiencyV1,
  type RequiredLanguageV1,
} from '../shared/languageProficiency';
import type { LicenseRecordV1, RequiredLicenseV1 } from '../shared/licenseRecord';

// B.5.1 — cert engine + catalog-string mapper, both promoted to shared/
// (functions reads via the functions/src/shared symlink).
import { buildCertificationRequirementsFromJobOrder } from '../shared/certifications/buildCertificationRequirementsFromJobOrder';
import {
  evaluateCertificationRequirement,
  type CertificationEvaluationResult,
} from '../shared/certifications/evaluateCertificationRequirement';
import type { CertificationCatalogManifestV1 } from '../shared/certifications/certificationCatalogManifest';
import type { CertificationRecordV1 } from '../shared/certifications/certificationRecord';

// Static-import the generated catalog manifest. It's a build-time-baked JSON
// file (see scripts/buildCertificationCatalogManifest.ts) — no Firestore
// loader needed; if we ever want runtime per-tenant overrides we'd add one
// here. resolveJsonModule is enabled in functions/tsconfig.json so this
// resolves at compile time.
import catalogManifestJson from '../shared/data/certificationCatalogManifest.v1.json';
const CERTIFICATION_CATALOG_MANIFEST = catalogManifestJson as CertificationCatalogManifestV1;

// ─────────────────────────────────────────────────────────────────────────
// Worker projection — narrow what the matchers need from the user doc.
// ─────────────────────────────────────────────────────────────────────────

/**
 * **R.2** — Narrow projection of the `workerAttestations` sub-object for
 * the willingness matchers. Mirrors a subset of
 * `WorkerAttestations` from `src/types/UserProfile.ts` — kept inline so the
 * runtime-neutral `shared/` matcher layer doesn't import client types.
 *
 * Values are passed through as-is (Title-Case from the wizard, lowercase
 * from typed clients, `''` / `undefined` when the worker hasn't picked).
 * `normalizeWillingness` inside the matchers handles the variance.
 */
export interface WorkerAttestationsForMatching {
  physicalRequirementWillingness?: WillingnessInput;
  uniformRequirementWillingness?: WillingnessInput;
  customUniformRequirementWillingness?: WillingnessInput;
  requiredPpeWillingness?: WillingnessInput;
  languageRequirementWillingness?: WillingnessInput;
}

/** Subset of `users/{uid}` projected for Phase B matcher input. */
export interface WorkerForMatching {
  uid: string;
  educationLevelV2: EducationLevel | null;
  legacyEducationLevel: string | null;
  languagesV2: LanguageProficiencyV1[] | null;
  legacyLanguages: string[] | null;
  skills: Array<string | { name?: string }> | null;
  licenses: LicenseRecordV1[] | null;
  /**
   * **R.2** — Worker self-attestations. `null` when the user doc has no
   * `workerAttestations` sub-object (pre-R.0 / never applied) — the
   * willingness matchers degrade to `'incomplete'` in that case.
   */
  workerAttestations: WorkerAttestationsForMatching | null;
}

/**
 * Load + project a worker doc for matcher input. Returns a "blank" worker
 * (all fields null) when the doc doesn't exist; matchers degrade gracefully
 * to `incomplete` status in that case.
 */
export async function loadWorkerForMatching(
  db: admin.firestore.Firestore,
  workerUid: string,
): Promise<WorkerForMatching> {
  const blank: WorkerForMatching = {
    uid: workerUid,
    educationLevelV2: null,
    legacyEducationLevel: null,
    languagesV2: null,
    legacyLanguages: null,
    skills: null,
    licenses: null,
    workerAttestations: null,
  };

  try {
    const snap = await db.doc(`users/${workerUid}`).get();
    if (!snap.exists) return blank;
    const u = snap.data() as Record<string, unknown>;

    return {
      uid: workerUid,
      educationLevelV2: pickEducationLevelV2(u.educationLevelV2),
      legacyEducationLevel: typeof u.educationLevel === 'string' ? u.educationLevel : null,
      languagesV2: pickLanguagesV2(u.languagesV2),
      legacyLanguages: pickLegacyLanguages(u.languages),
      skills: Array.isArray(u.skills) ? (u.skills as Array<string | { name?: string }>) : null,
      licenses: pickLicenses(u.licenses),
      workerAttestations: pickWorkerAttestations(u.workerAttestations),
    };
  } catch (err) {
    logger.warn('loadWorkerForMatching: read failed; defaulting to blank worker', {
      workerUid,
      err: (err as Error).message,
    });
    return blank;
  }
}

function pickEducationLevelV2(v: unknown): EducationLevel | null {
  return isEducationLevel(v) ? v : null;
}

function pickLanguagesV2(v: unknown): LanguageProficiencyV1[] | null {
  if (!Array.isArray(v)) return null;
  const out: LanguageProficiencyV1[] = [];
  for (const e of v) {
    if (
      e &&
      typeof e === 'object' &&
      typeof (e as { language?: unknown }).language === 'string' &&
      isLanguageProficiencyLevel((e as { level?: unknown }).level)
    ) {
      out.push({
        language: (e as { language: string }).language,
        level: (e as { level: LanguageProficiencyV1['level'] }).level,
      });
    }
  }
  return out.length > 0 ? out : null;
}

function pickLegacyLanguages(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
  return out.length > 0 ? out : null;
}

function pickLicenses(v: unknown): LicenseRecordV1[] | null {
  if (!Array.isArray(v)) return null;
  const out: LicenseRecordV1[] = [];
  for (const e of v) {
    if (e && typeof e === 'object' && typeof (e as { licenseClass?: unknown }).licenseClass === 'string') {
      out.push(e as LicenseRecordV1);
    }
  }
  return out.length > 0 ? out : null;
}

// ─────────────────────────────────────────────────────────────────────────
// Background-check loader for screening_package_match.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Load the worker's most-recent `backgroundChecks` record and run
 * `evaluateScreeningSatisfiedServer` against the JO's screening package.
 *
 * Returns:
 *   - `null` when the JO declares no screening package, OR the worker has no
 *     records at all → matcher will produce `not_applicable` or `incomplete`.
 *   - Otherwise the eval result, ready to feed into `matchScreeningPackage`.
 *
 * Note: `backgroundChecks` is a top-level (not tenant-scoped) collection in
 * this codebase; records carry `tenantId` + `candidateId` (worker uid).
 */
export async function loadScreeningEvalForJobOrder(
  db: admin.firestore.Firestore,
  args: {
    tenantId: string;
    workerUid: string;
    requiredPackageId: string | null;
    requiredPackageName: string | null;
  },
): Promise<ScreeningEvalResult | null> {
  if (!args.requiredPackageId) return null;
  const reqEquivKey = requestedEquivalencyKey(
    args.requiredPackageId,
    args.requiredPackageName ?? '',
  );

  let snap: admin.firestore.QuerySnapshot;
  try {
    snap = await db
      .collection('backgroundChecks')
      .where('candidateId', '==', args.workerUid)
      .where('tenantId', '==', args.tenantId)
      .limit(50)
      .get();
  } catch (err) {
    logger.warn('loadScreeningEvalForJobOrder: backgroundChecks query failed', {
      tenantId: args.tenantId,
      workerUid: args.workerUid,
      err: (err as Error).message,
    });
    return null;
  }

  if (snap.empty) return null;

  // Pick the most-recent record by updatedAt (fallback to createdAt).
  const records = snap.docs.map((d) => d.data() as BgLike);
  records.sort((a, b) => bgRecordMillis(b) - bgRecordMillis(a));

  const evalResult: ScreeningSatisfiedEvaluation = evaluateScreeningSatisfiedServer(records[0], {
    requestedEquivalencyKey: reqEquivKey,
    enforceEquivalency: true,
    enforceValidityWindow: true,
  });

  // ScreeningEvalResult (shared/) has the same shape as ScreeningSatisfiedEvaluation;
  // assignment is safe but we project explicitly to make the contract obvious.
  return {
    satisfied: evalResult.satisfied,
    equivalencyKey: evalResult.equivalencyKey,
    expiresAtMs: evalResult.expiresAtMs,
    decisionDetail: evalResult.decisionDetail,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// B.5.1 — worker certification records loader (cert engine input).
// ─────────────────────────────────────────────────────────────────────────

/** Worker cert records indexed by `catalogEntryId` (with doc id retained for the engine). */
export type WorkerCertRecordsIndex = Map<
  string,
  { record: CertificationRecordV1; certificationRecordId: string }
>;

/**
 * Load all of a worker's canonical certification records and index by
 * `catalogEntryId` for O(1) lookup at match time. Mirrors the canonical
 * client-side reader (`getCanonicalCertificationRecordsWithIds`) but uses
 * the admin SDK and orders newest-first so duplicates resolve to the most
 * recent record per catalog id.
 *
 * Returns an empty index on read failure; matchers degrade to `missing`
 * (mapped → `incomplete`) when the worker has no record for a given cert,
 * which is the correct behaviour either way.
 */
export async function loadWorkerCertRecords(
  db: admin.firestore.Firestore,
  workerUid: string,
): Promise<WorkerCertRecordsIndex> {
  const index: WorkerCertRecordsIndex = new Map();

  let snap: admin.firestore.QuerySnapshot;
  try {
    snap = await db
      .collection('users')
      .doc(workerUid)
      .collection('certification_records')
      .orderBy('updatedAt', 'desc')
      .get();
  } catch (err) {
    logger.warn('loadWorkerCertRecords: query failed; treating worker as no-records', {
      workerUid,
      err: (err as Error).message,
    });
    return index;
  }

  for (const doc of snap.docs) {
    const data = doc.data() as CertificationRecordV1 | undefined;
    if (!data || typeof data.catalogEntryId !== 'string' || data.catalogEntryId.length === 0) {
      continue;
    }
    if (!index.has(data.catalogEntryId)) {
      index.set(data.catalogEntryId, { record: data, certificationRecordId: doc.id });
    }
  }

  return index;
}

function bgRecordMillis(r: BgLike): number {
  const u = r.updatedAt as unknown as { toMillis?: () => number } | null | undefined;
  if (u && typeof u.toMillis === 'function') {
    try {
      return u.toMillis();
    } catch {
      /* fallthrough */
    }
  }
  const c = r.createdAt as unknown as { toMillis?: () => number } | null | undefined;
  if (c && typeof c.toMillis === 'function') {
    try {
      return c.toMillis();
    } catch {
      /* fallthrough */
    }
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────
// Spec builder — runs matchers and emits SeedAssignmentReadinessRequirementSpec[]
// ─────────────────────────────────────────────────────────────────────────

export interface BuildPhaseBMatchSpecsArgs {
  jo: Record<string, unknown>;
  worker: WorkerForMatching;
  /** Pre-loaded screening eval result (from `loadScreeningEvalForJobOrder`). */
  screeningEval: ScreeningEvalResult | null;
  /**
   * Pre-loaded worker certification records, indexed by `catalogEntryId`
   * (from `loadWorkerCertRecords`). Cert engine consumes one record per
   * requirement; missing entries → engine returns `missing` → matcher
   * emits `incomplete`. **Optional** for backward compat — when omitted,
   * the engine sees `null` for every requirement (always `missing`), which
   * matches the pre-B.5.1 behaviour of seeding bare cert shells.
   */
  workerCertRecords?: WorkerCertRecordsIndex;
  /** Today as ISO YYYY-MM-DD (for license expiration). */
  todayISO: string;
  /** Today as ms since epoch (for screening validity window). */
  todayMs: number;
}

/**
 * Run all six wired matchers against the JO + worker and return one spec per
 * applicable Phase B requirement. Skips items that come back `not_applicable`
 * (matcher's way of saying "this requirement doesn't apply").
 *
 * **B.5.1:** `cert_match` is now engine-driven. JO `requiredCertifications`
 * strings flow through `buildCertificationRequirementsFromJobOrder` to map
 * against the catalog manifest; each resolved requirement is evaluated by
 * `evaluateCertificationRequirement` against the worker's records, and the
 * adapter (`matchCertifications`) translates the engine status to a
 * readiness status. Unmapped strings emit a `cert_match` with
 * `status='needs_review'` so a CSA can fix the JO config.
 */
export function buildPhaseBMatchSpecs(
  args: BuildPhaseBMatchSpecsArgs,
): SeedAssignmentReadinessRequirementSpec[] {
  const { jo, worker, screeningEval, workerCertRecords, todayISO, todayMs } = args;
  const specs: SeedAssignmentReadinessRequirementSpec[] = [];

  // R.1 — Pre-extract the JO's parallel severity-override surfaces so each
  // matcher block can resolve severity without re-reading them. Validates
  // shape defensively (the JO payload is `Record<string, unknown>`).
  const skillSeverityOverrides = pickSeverityRecord(jo.skillsRequiredSeverityOverrides);
  const requirementTypeOverrides = pickSeverityRecord(jo.requirementSeverityOverrides) as Partial<
    Record<AssignmentReadinessRequirementType, AssignmentReadinessSeverity>
  >;

  // Education — single instance per JO.
  const educationLevelRequiredV2 = pickEducationLevelV2(jo.educationLevelRequiredV2);
  if (educationLevelRequiredV2) {
    const result = matchEducation({
      required: educationLevelRequiredV2,
      workerLevelV2: worker.educationLevelV2 ?? undefined,
      workerLegacyLevel: worker.legacyEducationLevel,
    });
    pushIfApplicable(specs, result, {
      requirementType: 'education_match',
      requirementLabel: `Education: ${educationLevelRequiredV2}`,
      severity: resolveSeverity('education_match', undefined, undefined, requirementTypeOverrides),
    });
  }

  // Languages — N per JO. Per-instance severity comes from `RequiredLanguageV1.severity`.
  const languagesRequired = pickLanguagesRequiredV2(jo.languagesRequiredV2);
  for (const req of languagesRequired) {
    const result = matchLanguages({
      required: req,
      workerLanguagesV2: worker.languagesV2 ?? undefined,
      workerLegacyLanguages: worker.legacyLanguages,
    });
    pushIfApplicable(specs, result, {
      requirementType: 'language_match',
      customKey: slugify(req.language),
      requirementLabel: `${req.language} (${req.minLevel})`,
      severity: resolveSeverity('language_match', req.severity, undefined, requirementTypeOverrides),
    });
  }

  // Skills — N per JO. Per-instance severity is keyed by the same slug we use
  // for the readiness item (`slugify(skill)`) on the parallel
  // `skillsRequiredSeverityOverrides` map (Q-R1-1).
  const skillsRequired = pickStringArray(jo.skillsRequired);
  for (const skill of skillsRequired) {
    const result = matchSkills({
      required: skill,
      workerSkills: worker.skills,
    });
    const skillKey = slugify(skill);
    pushIfApplicable(specs, result, {
      requirementType: 'skill_match',
      customKey: skillKey,
      requirementLabel: skill,
      severity: resolveSeverity(
        'skill_match',
        skillSeverityOverrides[skillKey],
        undefined,
        requirementTypeOverrides,
      ),
    });
  }

  // Licenses — N per JO from V2 typed field. Per-instance severity from
  // `RequiredLicenseV1.severity`.
  const licensesRequired = pickRequiredLicensesV2(jo.requiredLicensesV2);
  for (const req of licensesRequired) {
    const result = matchLicenses({
      required: req,
      workerLicenses: worker.licenses,
      todayISO,
    });
    pushIfApplicable(specs, result, {
      requirementType: 'license_match',
      customKey: slugify(req.licenseClass),
      requirementLabel: req.licenseClass,
      severity: resolveSeverity('license_match', req.severity, undefined, requirementTypeOverrides),
    });
  }

  // Certifications — engine-driven (B.5.1). Map JO freeform strings to
  // catalog requirements, then evaluate each against the worker's records.
  // Pass ONLY `requiredCertifications` (not `requiredLicenses`) — licenses
  // are owned by `license_match` above; mixing would double-count.
  const requiredCerts = pickStringArray(jo.requiredCertifications);
  if (requiredCerts.length > 0) {
    const { requirements: certRequirements, unmappedStrings } =
      buildCertificationRequirementsFromJobOrder({
        jobOrder: { requiredCertifications: requiredCerts, requiredLicenses: null },
        manifest: CERTIFICATION_CATALOG_MANIFEST,
      });

    for (const requirement of certRequirements) {
      const indexed = workerCertRecords?.get(requirement.catalogEntryId) ?? null;
      const evalResult: CertificationEvaluationResult = evaluateCertificationRequirement({
        requirement,
        record: indexed?.record ?? null,
        certificationRecordId: indexed?.certificationRecordId,
        context: 'assignment',
        todayISO,
      });

      const matched = matchCertifications({
        catalogEntryId: requirement.catalogEntryId,
        evalStatus: evalResult.status as CertificationEvalStatus,
        evalReason: evalResult.reason,
      });

      pushIfApplicable(specs, matched, {
        requirementType: 'cert_match',
        customKey: slugify(requirement.catalogEntryId),
        requirementLabel: requirement.legacySourceLabel ?? requirement.catalogEntryId,
        severity: resolveSeverity(
          'cert_match',
          requirement.severity,
          undefined,
          requirementTypeOverrides,
        ),
      });
    }

    // Unmapped legacy strings → emit a `needs_review` cert_match so a CSA
    // sees them and either fixes the JO or adds a catalog alias. Without
    // this, unmapped requirements would silently disappear.
    for (const raw of unmappedStrings) {
      specs.push({
        requirementType: 'cert_match',
        customKey: slugify(raw),
        requirementLabel: raw,
        status: 'needs_review',
        severity: resolveSeverity('cert_match', undefined, undefined, requirementTypeOverrides),
        // R.1 — Unmapped strings still resolve via the matcher pathway once a
        // CSA fixes the catalog. Stamp 'auto' so the chip groups them with
        // other matcher-derived items.
        resolutionMethod: 'auto',
      });
    }
  }

  // Screening package — single instance per JO.
  const requiredPackageId = pickStringOrNull(jo.screeningPackageId);
  if (requiredPackageId) {
    const result = matchScreeningPackage({
      requiredPackageId,
      evalResult: screeningEval,
      nowMs: todayMs,
    });
    pushIfApplicable(specs, result, {
      requirementType: 'screening_package_match',
      requirementLabel: `Screening package: ${requiredPackageId}`,
      severity: resolveSeverity(
        'screening_package_match',
        undefined,
        undefined,
        requirementTypeOverrides,
      ),
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // R.2 — Willingness self-attestations (D9.R2 gating).
  //
  // Each block independently checks whether the JO declares a
  // corresponding requirement field (lockede via Q-R2-4 grounding pass —
  // see `READINESS_R1_R2_HANDOFF.md`). When the gate is open, run the
  // matcher against the worker's `workerAttestations.*Willingness` answer
  // and stamp `resolutionMethod: 'self_attest'`. When the gate is closed,
  // the willingness item simply doesn't seed — the chip aggregator (R.4)
  // sees no item and treats it as N/A.
  //
  // Severity defaults to `'soft'` for all four (D10.R2). Per-JO overrides
  // via `requirementSeverityOverrides[<type>]` flip to hard for tenants
  // that genuinely consider the willingness blocking.
  // ─────────────────────────────────────────────────────────────────────

  const attestations = worker.workerAttestations;

  // Physical — JO field is `physicalRequirements` (declared `string` but
  // production is `string[]`). Gate accepts both shapes.
  //
  // R.16.2c — wrap with `getEffectiveJobOrderField` so the gate reads
  // the snapshot value (frozen at activation) rather than whatever
  // the parent Account currently advertises. Pre-snapshot drafts +
  // already-snapshotted JOs are both handled by the helper's
  // precedence rule.
  const joForRead = jo as JobOrderForEffectiveRead;
  const { value: effectivePhysicalReqs } = getEffectiveJobOrderField<unknown>(
    joForRead,
    'physicalRequirements',
    { fallback: jo.physicalRequirements },
  );
  if (jobHasNonEmptyText(effectivePhysicalReqs)) {
    const result = matchPhysicalWillingness({
      willingness: attestations?.physicalRequirementWillingness,
    });
    pushIfApplicable(specs, result, {
      requirementType: 'physical_willingness',
      requirementLabel: 'Physical requirements',
      severity: resolveSeverity(
        'physical_willingness',
        undefined,
        undefined,
        requirementTypeOverrides,
      ),
      resolutionMethod: 'self_attest',
    });
  }

  // PPE — JO field is `ppeRequirements` (also string|string[] in
  // production). Distinct from `ppe_acknowledgement` (per-shift, hard).
  if (jobHasNonEmptyText(jo.ppeRequirements)) {
    const result = matchPpeWillingness({
      willingness: attestations?.requiredPpeWillingness,
    });
    pushIfApplicable(specs, result, {
      requirementType: 'ppe_willingness',
      requirementLabel: 'Required PPE',
      severity: resolveSeverity(
        'ppe_willingness',
        undefined,
        undefined,
        requirementTypeOverrides,
      ),
      resolutionMethod: 'self_attest',
    });
  }

  // Language — gate on either the legacy `languagesRequired` or the
  // structured `languagesRequiredV2`. Language willingness lives alongside
  // `language_match` (Q-R2-3 — they answer different questions).
  const hasLanguageGate =
    jobHasNonEmptyArray(jo.languagesRequired) || jobHasNonEmptyArray(jo.languagesRequiredV2);
  if (hasLanguageGate) {
    const result = matchLanguageWillingness({
      willingness: attestations?.languageRequirementWillingness,
    });
    pushIfApplicable(specs, result, {
      requirementType: 'language_willingness',
      requirementLabel: 'Working language',
      severity: resolveSeverity(
        'language_willingness',
        undefined,
        undefined,
        requirementTypeOverrides,
      ),
      resolutionMethod: 'self_attest',
    });
  }

  // Uniform — single matcher with worse-of combination. Library and
  // custom JO fields are independent; the worker has separate willingness
  // answers for each. The matcher itself decides which side(s) to read
  // based on the gate flags we pass.
  const jobHasLibraryUniform =
    jobHasNonEmptyText(jo.dressCode) || jobHasNonEmptyText(jo.uniformRequirements);
  // R.16.2c — same wrap pattern as `physicalRequirements` above.
  // Library uniform fields (`dressCode` / `uniformRequirements`) are
  // not yet promoted to snapshot policy and stay live; only the
  // custom freeform field flows through the snapshot precedence.
  const { value: effectiveCustomUniform } = getEffectiveJobOrderField<unknown>(
    joForRead,
    'customUniformRequirements',
    { fallback: jo.customUniformRequirements },
  );
  const jobHasCustomUniform = jobHasNonEmptyText(effectiveCustomUniform);
  if (jobHasLibraryUniform || jobHasCustomUniform) {
    const result = matchUniformWillingness({
      jobHasLibraryUniform,
      jobHasCustomUniform,
      libraryWillingness: attestations?.uniformRequirementWillingness,
      customWillingness: attestations?.customUniformRequirementWillingness,
    });
    pushIfApplicable(specs, result, {
      requirementType: 'uniform_willingness',
      requirementLabel: 'Uniform requirements',
      severity: resolveSeverity(
        'uniform_willingness',
        undefined,
        undefined,
        requirementTypeOverrides,
      ),
      resolutionMethod: 'self_attest',
    });
  }

  return specs;
}

/**
 * **R.1** — Resolve severity for a Phase B match item via the locked
 * three-insertion-point rule (D4.R1):
 *
 *   1. `perInstance` (e.g. `RequiredLicenseV1.severity`,
 *      `Phase1CertificationRequirement.severity`,
 *      `RequiredLanguageV1.severity`, or — for skills — the parallel slug map
 *      `JobOrder.skillsRequiredSeverityOverrides[slug]`)
 *   2. `requirementTypeOverride` (`JobOrder.requirementSeverityOverrides[type]`)
 *   3. `DEFAULT_REQUIREMENT_SEVERITY[type]` (the locked D3.R1 table)
 *
 * Caller passes the per-instance value where applicable; the function picks
 * the highest-priority defined value. Returns `'soft'` only when the chain
 * lands on the type-default's `'soft'`; never undefined.
 */
function resolveSeverity(
  requirementType: Exclude<AssignmentReadinessRequirementType, 'custom'>,
  perInstance: AssignmentReadinessSeverity | undefined,
  // Parallel-map override — currently only used by skill_match, threaded as
  // `perInstance` for that case. Keeping the slot here so future call sites
  // (e.g. R.2 willingness items keyed by attestation field) can plug in.
  _parallelMapOverride: AssignmentReadinessSeverity | undefined,
  requirementTypeOverrides: Partial<
    Record<AssignmentReadinessRequirementType, AssignmentReadinessSeverity>
  >,
): AssignmentReadinessSeverity {
  if (perInstance === 'hard' || perInstance === 'soft') return perInstance;
  const typeOverride = requirementTypeOverrides[requirementType];
  if (typeOverride === 'hard' || typeOverride === 'soft') return typeOverride;
  return DEFAULT_REQUIREMENT_SEVERITY[requirementType];
}

/**
 * Defensive shape coercion for the JO's severity-override surfaces. Both
 * `skillsRequiredSeverityOverrides` and `requirementSeverityOverrides` ride on
 * a `Record<string, unknown>` JO doc, so we filter to the typed values
 * (`'hard' | 'soft'`) here once.
 */
function pickSeverityRecord(v: unknown): Record<string, AssignmentReadinessSeverity> {
  if (!v || typeof v !== 'object') return {};
  const out: Record<string, AssignmentReadinessSeverity> = {};
  for (const [key, val] of Object.entries(v)) {
    if (val === 'hard' || val === 'soft') out[key] = val;
  }
  return out;
}

/**
 * **R.1 / R.2** — Push a matcher result onto the spec list, stamping the
 * partner `resolutionMethod`.
 *
 * Two shapes:
 *
 *   - **Auto-resolution items (R.1)** — the default. Phase B matchers
 *     derive readiness from the worker's typed records + the JO's typed
 *     requirements. Caller passes a base WITHOUT `resolutionMethod`; we
 *     stamp `'auto'`.
 *   - **Self-attest items (R.2)** — willingness matchers derive readiness
 *     from `workerAttestations`. Caller passes
 *     `{ ...base, resolutionMethod: 'self_attest' }`; we honour the
 *     explicit value.
 *
 * Future R.3 CSA actions adjust to `'csa_confirmed'` / `'csa_waived'`
 * post-seed via a separate write surface.
 */
function pushIfApplicable(
  specs: SeedAssignmentReadinessRequirementSpec[],
  result: MatcherResult<unknown>,
  base:
    | Omit<SeedAssignmentReadinessRequirementSpec, 'status' | 'resolutionMethod'>
    | (Omit<SeedAssignmentReadinessRequirementSpec, 'status' | 'resolutionMethod'> & {
        resolutionMethod: NonNullable<SeedAssignmentReadinessRequirementSpec['resolutionMethod']>;
      }),
): void {
  if (result.status === 'not_applicable') return;
  const resolutionMethod =
    'resolutionMethod' in base && base.resolutionMethod ? base.resolutionMethod : 'auto';
  specs.push({ ...base, status: result.status, resolutionMethod });
}

// ─────────────────────────────────────────────────────────────────────────
// JO field readers (defensive — JO is `Record<string, unknown>`)
// ─────────────────────────────────────────────────────────────────────────

function pickStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
}

function pickStringOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function pickLanguagesRequiredV2(v: unknown): RequiredLanguageV1[] {
  if (!Array.isArray(v)) return [];
  const out: RequiredLanguageV1[] = [];
  for (const e of v) {
    if (
      e &&
      typeof e === 'object' &&
      typeof (e as { language?: unknown }).language === 'string' &&
      isLanguageProficiencyLevel((e as { minLevel?: unknown }).minLevel)
    ) {
      const req: RequiredLanguageV1 = {
        language: (e as { language: string }).language,
        minLevel: (e as { minLevel: RequiredLanguageV1['minLevel'] }).minLevel,
      };
      // R.1 — Carry the per-instance severity through so the matcher's
      // resolveSeverity() chain can see it.
      const sev = (e as { severity?: unknown }).severity;
      if (sev === 'hard' || sev === 'soft') req.severity = sev;
      out.push(req);
    }
  }
  return out;
}

function pickRequiredLicensesV2(v: unknown): RequiredLicenseV1[] {
  if (!Array.isArray(v)) return [];
  const out: RequiredLicenseV1[] = [];
  for (const e of v) {
    if (e && typeof e === 'object' && typeof (e as { licenseClass?: unknown }).licenseClass === 'string') {
      const req: RequiredLicenseV1 = {
        licenseClass: (e as { licenseClass: string }).licenseClass,
      };
      const re = (e as { requiredEndorsements?: unknown }).requiredEndorsements;
      if (Array.isArray(re)) {
        const endorsements = re.filter((s): s is string => typeof s === 'string');
        if (endorsements.length > 0) req.requiredEndorsements = endorsements;
      }
      // R.1 — Carry the per-instance severity through so the matcher's
      // resolveSeverity() chain can see it (D4.R1 priority 1).
      const sev = (e as { severity?: unknown }).severity;
      if (sev === 'hard' || sev === 'soft') req.severity = sev;
      out.push(req);
    }
  }
  return out;
}

/**
 * Slugify a free-text label into a Firestore-safe customKey (alphanumeric +
 * underscore only). Matches the normalization in `buildAssignmentReadinessItemId`
 * so that what the trigger emits is what the id-builder accepts.
 */
export function slugify(s: string): string {
  return s.trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
}

// ─────────────────────────────────────────────────────────────────────────
// R.2 — Worker attestations + JO gate readers.
// ─────────────────────────────────────────────────────────────────────────

/** Defensive shape coercion for `users/{uid}.workerAttestations`. */
function pickWorkerAttestations(
  v: unknown,
): WorkerForMatching['workerAttestations'] {
  if (!v || typeof v !== 'object') return null;
  const src = v as Record<string, unknown>;
  // Pass through string fields; the matcher's `normalizeWillingness`
  // tolerates Title-Case + `''` + unknown values. We don't pre-validate
  // against the canonical enum here because production data has both
  // wizard-Title-Case and typed-lowercase shapes (Q-R2-2 grounding).
  const out: WorkerAttestationsForMatching = {};
  if (typeof src.physicalRequirementWillingness === 'string') {
    out.physicalRequirementWillingness = src.physicalRequirementWillingness;
  }
  if (typeof src.uniformRequirementWillingness === 'string') {
    out.uniformRequirementWillingness = src.uniformRequirementWillingness;
  }
  if (typeof src.customUniformRequirementWillingness === 'string') {
    out.customUniformRequirementWillingness = src.customUniformRequirementWillingness;
  }
  if (typeof src.requiredPpeWillingness === 'string') {
    out.requiredPpeWillingness = src.requiredPpeWillingness;
  }
  if (typeof src.languageRequirementWillingness === 'string') {
    out.languageRequirementWillingness = src.languageRequirementWillingness;
  }
  return out;
}

/**
 * **R.2 — D9.R2 gate helper.** Whether a JO field has any text content.
 *
 * The JO's `physicalRequirements` / `ppeRequirements` / `dressCode` /
 * `uniformRequirements` / `customUniformRequirements` fields are typed as
 * `string` on `JobOrder` but production data persists `string[]` for the
 * multi-select ones (Q-R2-4 grounding). Accepts both:
 *
 *   - non-empty trimmed string                       → true
 *   - array containing at least one non-empty string → true
 *   - everything else                                → false
 */
function jobHasNonEmptyText(v: unknown): boolean {
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) {
    return v.some((s) => typeof s === 'string' && s.trim().length > 0);
  }
  return false;
}

/** Whether a JO field is a non-empty array (used for `languagesRequired*`). */
function jobHasNonEmptyArray(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0;
}

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
import type { SeedAssignmentReadinessRequirementSpec } from '../shared/seedAssignmentReadinessItems';

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
import type { MatcherResult } from '../shared/jobRequirementMatchers/types';

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

/** Subset of `users/{uid}` projected for Phase B matcher input. */
export interface WorkerForMatching {
  uid: string;
  educationLevelV2: EducationLevel | null;
  legacyEducationLevel: string | null;
  languagesV2: LanguageProficiencyV1[] | null;
  legacyLanguages: string[] | null;
  skills: Array<string | { name?: string }> | null;
  licenses: LicenseRecordV1[] | null;
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
    });
  }

  // Languages — N per JO.
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
    });
  }

  // Skills — N per JO. Strictness defaults to matcher default ('tokenized').
  const skillsRequired = pickStringArray(jo.skillsRequired);
  for (const skill of skillsRequired) {
    const result = matchSkills({
      required: skill,
      workerSkills: worker.skills,
    });
    pushIfApplicable(specs, result, {
      requirementType: 'skill_match',
      customKey: slugify(skill),
      requirementLabel: skill,
    });
  }

  // Licenses — N per JO from V2 typed field.
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
    });
  }

  return specs;
}

function pushIfApplicable(
  specs: SeedAssignmentReadinessRequirementSpec[],
  result: MatcherResult<unknown>,
  base: Omit<SeedAssignmentReadinessRequirementSpec, 'status'>,
): void {
  if (result.status === 'not_applicable') return;
  specs.push({ ...base, status: result.status });
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
      out.push({
        language: (e as { language: string }).language,
        minLevel: (e as { minLevel: RequiredLanguageV1['minLevel'] }).minLevel,
      });
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

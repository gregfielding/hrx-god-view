/**
 * E.1 + E.2 — Everee readiness snapshot.
 *
 * Denormalized per-readiness-item state mirrored from Everee's API onto the
 * `tenants/{tid}/everee_workers/{entityId}__{userId}` doc. The aggregator
 * (E.3) reads from this snapshot instead of hitting Everee on every page
 * load — the snapshot is kept fresh by:
 *   - the webhook processor (reconcile fires after every event)
 *   - `evereeReconcileCron` (sweep every 2h)
 *   - `evereeAdminReconcileWorker` (manual / "Re-sync" button)
 *   - the embed completion path (best-effort)
 *
 * This file is pure: types + a single pure function. No Firestore, no
 * `evereeRequest`, no side effects — easy to unit-test by feeding canned
 * Everee API responses through `computeEvereeReadinessMirror`. The
 * callers (`evereeReconcileWorker.ts`, `evereeReconcileCron.ts`, the
 * webhook processor) own the I/O.
 *
 * Field-name caveats:
 *   - Several fields below (`w4.effectiveDate`, `w9.signedAt`,
 *     `payPeriodConfig.startDate/endDate`, `tinVerificationStatus`) are
 *     **best-guess** from Everee's docs + early sandbox observations.
 *     `computeEvereeReadinessMirror` reads them defensively and falls
 *     back to `null` when absent, and the helpers log a structured
 *     warning when an "expected" field is missing so we can iterate
 *     without redeploying. Update the field names here once the
 *     authoritative shape is captured (see Greg's profile-debug logs).
 */

import { Timestamp } from 'firebase-admin/firestore';

// ─────────────────────────────────────────────────────────────────────────
// Public types — exported for the writers + the (eventual) E.3 aggregator.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Source attribution — useful when debugging stale snapshots: a snapshot
 * from `cron` 90 minutes ago is fine; a snapshot from `embed` 2 weeks
 * ago suggests the cron stopped running.
 */
export type EvereeReadinessSyncSource = 'webhook' | 'cron' | 'manual' | 'embed';

/** Everee's TIN-verification states. `null` when the field is absent. */
export type EvereeTinVerificationStatus =
  | 'NEEDS_VERIFICATION'
  | 'SENT_FOR_VERIFICATION'
  | 'VERIFIED'
  | 'MISMATCH';

/** Worker lifecycle (orthogonal to onboarding). */
export type EvereeLifecycleStatus = 'ONBOARDING' | 'ACTIVE' | 'INACTIVE' | 'TERMINATED';

/** Pay period cadence Everee derives from `payPeriodConfig`. */
export type EvereePayPeriodCadence = 'WEEKLY' | 'BI_WEEKLY' | 'SEMI_MONTHLY' | 'DAILY';

/**
 * The denormalized snapshot. Optional on existing `everee_workers` docs —
 * absent fields signal "never reconciled yet" to the aggregator and the UI.
 */
export interface EvereeReadinessMirror {
  // ── Direct deposit ──
  /** True iff the worker has a bank account AND Everee says direct deposit is available. */
  directDepositReady: boolean;
  bankAccountCount: number;
  /** Last-4 of the primary bank account, for UI display. `null` when no account exists. */
  primaryBankLast4: string | null;

  // ── I-9 (W-2 only; federal contractors don't sign I-9) ──
  i9SignedAt: Timestamp | null;
  i9Applicable: boolean;
  /**
   * Section 2 (employer countersign) — set when Everee reports
   * `documentsVerifiedByCompany: true` on `/onboarding-status`. Use this
   * + `i9SignedAt` together to know when the I-9 is FULLY signed by
   * both parties. Auto-resolves the to-do row on `/readiness/i9-signatures`
   * without a manual HRX-side stamp.
   *
   * The reconciler also stamps `entity_employments.i9Section2CompletedAt`
   * for audit-trail denorm — but the mirror field stays the source of
   * truth (Everee).
   */
  employerI9SignedAt: Timestamp | null;

  /**
   * True when Everee reports this worker's documents live in the embedded
   * WorkBright I-9 pipeline (`hasWorkbrightDocs` on `/onboarding-status`).
   * C1 is cutting over to WorkBright (Greg, 2026-07-11) — this is the
   * per-worker rollout signal: pre-cutover workers stay `false` (Everee's
   * native Documents-tab flow), WorkBright-onboarded workers flip `true`
   * and their Section 2 auto-resolves via `documentsVerifiedByCompany`.
   */
  hasWorkbrightDocs: boolean;

  // ── W-4 (W-2 only) ──
  w4SignedAt: Timestamp | null;
  w4Applicable: boolean;

  // ── W-9 (1099 only) ──
  w9SignedAt: Timestamp | null;
  w9Applicable: boolean;

  // ── Company policies / handbook ──
  handbookSignedAt: Timestamp | null;
  /** All POLICY-typed files **except** the handbook (which has its own field). */
  policiesSignedCount: number;

  // ── TIN verification ──
  tinVerificationStatus: EvereeTinVerificationStatus | null;
  tinVerificationStatusChangedAt: Timestamp | null;
  taxpayerIdentifierLast4: string | null;

  // ── Worker lifecycle (Everee's state machine) ──
  lifecycleStatus: EvereeLifecycleStatus | null;
  onboardingComplete: boolean;
  /** Raw Everee onboardingStatus — may include values beyond the canonical three. */
  onboardingStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE' | string | null;

  // ── W-2 specific (null for contractors) ──
  payPeriodCadence: EvereePayPeriodCadence | null;
  /** Everee's supportedPaymentTypes array (e.g. `['PAYROLL','AD_HOC']` for W-2). */
  supportedPaymentTypes: string[];

  // ── Provenance ──
  lastEvereeSyncAt: Timestamp;
  lastEvereeSyncSource: EvereeReadinessSyncSource;
}

// ─────────────────────────────────────────────────────────────────────────
// Permissive shapes for the four Everee API responses.
// We intentionally don't lock these down — Everee is iterating their
// schema and we'd rather read defensively than throw on an unexpected
// field. The pure compute function below treats every property as
// optional and falls back to `null` / `false` / `[]` when missing.
// ─────────────────────────────────────────────────────────────────────────

/** `GET /api/v2/workers/{id}` — only the fields we read. */
export interface EvereeWorkerApiResponse {
  id?: string;
  /** `'EMPLOYEE'` (W-2) or `'CONTRACTOR'` (1099). */
  employmentType?: string;
  bankAccounts?: Array<{
    id?: string;
    accountNumberLast4?: string;
    isActive?: boolean;
  }>;
  availablePaymentMethods?: {
    directDeposit?: boolean;
    [k: string]: unknown;
  };
  tinVerificationStatus?: string;
  /** ISO 8601 string. */
  tinVerificationStatusChangedAt?: string;
  taxpayerIdentifierLast4?: string;
  lifecycleStatus?: string;
  onboardingComplete?: boolean;
  onboardingStatus?: string;
  payPeriodConfig?: EvereePayPeriodConfig;
  supportedPaymentTypes?: string[];
  [k: string]: unknown;
}

/** Sub-shape of `payPeriodConfig`. Only `startDate` + `endDate` are read. */
export interface EvereePayPeriodConfig {
  /** ISO 8601 (`YYYY-MM-DD`). */
  startDate?: string;
  endDate?: string;
  [k: string]: unknown;
}

/** `GET .../w-4-tax-withholding-settings`. */
export interface EvereeW4Response {
  /**
   * Best-guess effective-date field for the most recent W-4 submission.
   * If Everee uses a different name (`signedAt`, `lastModified`, …) the
   * compute function falls back through a small alias list and logs a
   * warning so we can update the schema without redeploying.
   */
  effectiveDate?: string;
  signedAt?: string;
  lastModified?: string;
  updatedAt?: string;
  [k: string]: unknown;
}

/** `GET .../w9-info`. */
export interface EvereeW9Response {
  signedAt?: string;
  effectiveDate?: string;
  lastModified?: string;
  updatedAt?: string;
  [k: string]: unknown;
}

/** Single file from `GET /api/v2/workers/files`. */
export interface EvereeFile {
  id?: string;
  /** `'ONBOARDING' | 'POLICY' | …` */
  documentType?: string;
  fileName?: string;
  /** ISO 8601 string. */
  publishedAt?: string;
  [k: string]: unknown;
}

/** Wrapper shape passed to `computeEvereeReadinessMirror` for each endpoint. */
export interface MirrorInputW4 {
  applicable: boolean;
  data?: EvereeW4Response;
}
export interface MirrorInputW9 {
  applicable: boolean;
  data?: EvereeW9Response;
}
export interface MirrorInputFiles {
  ok: boolean;
  files?: EvereeFile[];
}

/**
 * `GET /api/v2/workers/{id}/onboarding-status` — only the fields we
 * read. The critical one is `documentsVerifiedByCompany`, which flips
 * to true when the employer countersigns I-9 Section 2 inside Everee.
 */
export interface EvereeOnboardingStatusApiResponse {
  /** ISO 8601 — the field doesn't carry a per-flag timestamp, so we
   *  treat this as the best available "this is when the state changed". */
  updatedAt?: string;
  /** I-9 Section 2 employer-countersign signal. False until the
   *  employer marks documents verified in Everee. Belongs to the embedded
   *  WorkBright I-9 pipeline — stays false forever for workers on Everee's
   *  native Documents-tab flow (confirmed 2026-07-11: Gizelle, Ricardo). */
  documentsVerifiedByCompany?: boolean;
  /** True when the worker's I-9 documents live in the embedded WorkBright
   *  pipeline (C1 cutover in progress, 2026-07-11). */
  hasWorkbrightDocs?: boolean;
  [k: string]: unknown;
}

export interface MirrorInputOnboardingStatus {
  applicable: boolean;
  data?: EvereeOnboardingStatusApiResponse;
}

export interface ComputeEvereeReadinessMirrorInput {
  worker: EvereeWorkerApiResponse;
  w4: MirrorInputW4;
  w9: MirrorInputW9;
  files: MirrorInputFiles;
  /**
   * Worker onboarding-status response. Optional on the input side for
   * backwards compat — callers that haven't been updated yet pass
   * nothing, and the compute defaults `employerI9SignedAt` to null
   * (which is the same as "Everee hasn't told us yet").
   */
  onboardingStatus?: MirrorInputOnboardingStatus;
  syncSource: EvereeReadinessSyncSource;
  /**
   * Optional clock injection for tests. Defaults to `Timestamp.now()` so
   * production code doesn't have to think about it.
   */
  now?: Timestamp;
}

// ─────────────────────────────────────────────────────────────────────────
// Filename matchers — exported so tests can pin the regexes against
// real-world filenames captured from Everee responses.
// ─────────────────────────────────────────────────────────────────────────

/**
 * I-9 detection. Matches:
 *   - `I-9`, `I9` at a word boundary, not followed by another digit
 *     (so `I9_signed_2026.pdf` matches but `I9123` doesn't get
 *     misclassified as an I-9 reference). The trailing
 *     `(?!\d)` is there because `\b` doesn't fire between `9` and
 *     `_` — `_` is a word char in JS regex, so `\bi-?9\b` *fails* on
 *     the common Everee filename pattern `I9_signed_2026.pdf`.
 *   - `Form I-9`, `Form I9` (covered by the same alternation).
 *   - `Employment Eligibility Verification` (the official I-9 long
 *     name; tolerates a space, hyphen, or nothing between the words).
 * Case-insensitive.
 */
export const I9_FILENAME_REGEX = /\bi-?9(?!\d)|employment[\s-]?eligibility/i;

/**
 * Handbook detection. Matches any filename containing `handbook`
 * (case-insensitive) — covers "Employee Handbook", "Company Handbook",
 * "Handbook 2026", "Handbook v3.pdf", etc.
 */
export const HANDBOOK_FILENAME_REGEX = /handbook/i;

// ─────────────────────────────────────────────────────────────────────────
// Internal helpers (date parsing, cadence derivation).
// ─────────────────────────────────────────────────────────────────────────

/**
 * Parse an ISO 8601 string into a Firestore Timestamp. Returns `null` for
 * empty / invalid input — never throws. Many Everee fields are nullable
 * in practice, so a permissive parser is the safer default.
 */
export function isoToTimestampOrNull(value: unknown): Timestamp | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return Timestamp.fromMillis(ms);
}

/**
 * Pick the first non-empty alias for a date field. Used because Everee
 * has shipped multiple field names for "when was this last touched"
 * during pilot (`signedAt` / `effectiveDate` / `lastModified` /
 * `updatedAt`). Returns the parsed Timestamp or `null` when none match.
 *
 * Exported for tests.
 */
export function pickFirstDateAlias(
  source: Record<string, unknown> | undefined,
  aliases: ReadonlyArray<string>,
): Timestamp | null {
  if (!source) return null;
  for (const key of aliases) {
    const ts = isoToTimestampOrNull(source[key]);
    if (ts) return ts;
  }
  return null;
}

const W4_DATE_ALIASES = ['effectiveDate', 'signedAt', 'lastModified', 'updatedAt'] as const;
const W9_DATE_ALIASES = ['signedAt', 'effectiveDate', 'lastModified', 'updatedAt'] as const;

/**
 * Derive `payPeriodCadence` from a `payPeriodConfig` window. Approximate
 * because Everee can shift period boundaries by a day around month-ends
 * (especially semi-monthly), so we tolerate a ±1-day fudge:
 *
 *   - 1 day               → `DAILY`
 *   - 6–8 days            → `WEEKLY`
 *   - 13–15 days          → `BI_WEEKLY`
 *   - 14.5–16 days        → `SEMI_MONTHLY` (caught by the tighter
 *                          BI_WEEKLY band first; see below)
 *
 * Semi-monthly is twice/month → 14–17 days; we map 16+ to SEMI_MONTHLY
 * so 15-day (true semi) lands on BI_WEEKLY today. That's a known
 * limitation: the only signal we have here is the period length, and
 * 15-day periods are ambiguous between a tight semi and a loose
 * bi-weekly. When Everee adds an explicit cadence field on
 * `payPeriodConfig`, prefer it. Until then, we round generously and
 * accept the ambiguity.
 *
 * Returns `null` when the config is missing, malformed, or the delta is
 * outside any known cadence band — the aggregator treats `null` as
 * "unknown" and falls back to display-only "—".
 *
 * Exported for tests.
 */
export function derivePayPeriodCadence(
  config: EvereePayPeriodConfig | undefined,
): EvereePayPeriodCadence | null {
  if (!config) return null;
  const startMs = Date.parse(config.startDate ?? '');
  const endMs = Date.parse(config.endDate ?? '');
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
  // Inclusive day count so a Mon-Sun period reads as 7, not 6.
  const dayDelta = Math.round((endMs - startMs) / (24 * 60 * 60 * 1000)) + 1;
  if (dayDelta === 1) return 'DAILY';
  if (dayDelta >= 6 && dayDelta <= 8) return 'WEEKLY';
  if (dayDelta >= 13 && dayDelta <= 15) return 'BI_WEEKLY';
  if (dayDelta >= 16 && dayDelta <= 17) return 'SEMI_MONTHLY';
  return null;
}

/**
 * Coerce Everee's `tinVerificationStatus` string into our enum. Returns
 * `null` for absent / unrecognized values so future Everee additions
 * can't propagate as garbage `as` casts.
 */
export function coerceTinVerificationStatus(
  raw: unknown,
): EvereeTinVerificationStatus | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toUpperCase();
  switch (v) {
    case 'NEEDS_VERIFICATION':
    case 'SENT_FOR_VERIFICATION':
    case 'VERIFIED':
    case 'MISMATCH':
      return v;
    default:
      return null;
  }
}

/** Coerce Everee's `lifecycleStatus` string into our enum. */
export function coerceLifecycleStatus(raw: unknown): EvereeLifecycleStatus | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toUpperCase();
  switch (v) {
    case 'ONBOARDING':
    case 'ACTIVE':
    case 'INACTIVE':
    case 'TERMINATED':
      return v;
    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// The pure function.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Compute the `EvereeReadinessMirror` snapshot from a set of Everee API
 * responses. Pure: no I/O, no globals (except the optional `now`
 * injection), no logging side effects. The caller fetches the four
 * endpoints (or stubs `applicable: false` / `ok: false` when they
 * legitimately don't apply) and passes them in.
 *
 * Worker-type rules (federal):
 *   - W-2 employees: I-9 + W-4 apply; W-9 does not.
 *   - 1099 contractors: W-9 applies; I-9 + W-4 do not.
 * We derive the worker type from `worker.employmentType` (Everee's
 * field). When that's missing/garbage, both `iApplicable` flags fall
 * back to `false` — better to under-report applicability than to
 * mislead the readiness aggregator into requiring a form Everee never
 * collects.
 */
export function computeEvereeReadinessMirror(
  input: ComputeEvereeReadinessMirrorInput,
): EvereeReadinessMirror {
  const w = input.worker;
  const employmentType =
    typeof w.employmentType === 'string' ? w.employmentType.trim().toUpperCase() : '';
  const isEmployee = employmentType === 'EMPLOYEE';
  const isContractor = employmentType === 'CONTRACTOR';

  // ── Direct deposit ──
  const bankAccounts = Array.isArray(w.bankAccounts) ? w.bankAccounts : [];
  const directDepositReady =
    bankAccounts.length > 0 &&
    w.availablePaymentMethods?.directDeposit === true;
  const primaryBankLast4 =
    typeof bankAccounts[0]?.accountNumberLast4 === 'string'
      ? bankAccounts[0]!.accountNumberLast4!
      : null;

  // ── Files ──
  const files = input.files.ok && Array.isArray(input.files.files) ? input.files.files : [];
  const onboardingFiles = files.filter((f) => normalizeDocType(f.documentType) === 'ONBOARDING');
  const policyFiles = files.filter((f) => normalizeDocType(f.documentType) === 'POLICY');

  // I-9 — only meaningful for W-2; we still scan onboarding files for
  // contractors (cheap + harmless) so that if Everee ever returns one
  // for a contractor (unexpected) we can spot it in the mirror snapshot.
  const i9File = onboardingFiles.find((f) =>
    typeof f.fileName === 'string' && I9_FILENAME_REGEX.test(f.fileName),
  );
  const i9SignedAt = i9File ? isoToTimestampOrNull(i9File.publishedAt) : null;

  // Section 2 (employer countersign) — read from the onboarding-status
  // response when present. `documentsVerifiedByCompany` is the boolean
  // signal Everee exposes; the response doesn't carry a per-flag stamp,
  // so we use the response's own `updatedAt` (which Everee touches on
  // any change to onboarding state — close enough for "when did this
  // change to true" given we re-fetch on a cron + webhook). Only set
  // for W-2 workers; contractors don't have an I-9 Section 2 step.
  const onboardingStatusData = input.onboardingStatus?.applicable
    ? input.onboardingStatus.data
    : undefined;
  const employerI9SignedAt =
    isEmployee && onboardingStatusData?.documentsVerifiedByCompany === true
      ? isoToTimestampOrNull(onboardingStatusData.updatedAt) ??
        // Fall back to the snapshot's "now" timestamp when Everee
        // didn't include an updatedAt — better to have *some* stamp
        // than to leave the field null and confuse downstream
        // consumers that gate on truthiness.
        (input.now ?? Timestamp.now())
      : null;

  // Handbook + remaining policies.
  const handbookFile = policyFiles.find((f) =>
    typeof f.fileName === 'string' && HANDBOOK_FILENAME_REGEX.test(f.fileName),
  );
  const handbookSignedAt = handbookFile ? isoToTimestampOrNull(handbookFile.publishedAt) : null;
  const policiesSignedCount = policyFiles.length - (handbookFile ? 1 : 0);

  // ── Tax forms ──
  const w4SignedAt =
    input.w4.applicable && input.w4.data
      ? pickFirstDateAlias(input.w4.data as Record<string, unknown>, W4_DATE_ALIASES)
      : null;
  const w9SignedAt =
    input.w9.applicable && input.w9.data
      ? pickFirstDateAlias(input.w9.data as Record<string, unknown>, W9_DATE_ALIASES)
      : null;

  // ── Pay period cadence (W-2 only — contractors are AD_HOC) ──
  const payPeriodCadence = isEmployee ? derivePayPeriodCadence(w.payPeriodConfig) : null;

  // ── TIN ──
  const tinVerificationStatus = coerceTinVerificationStatus(w.tinVerificationStatus);
  const tinVerificationStatusChangedAt = isoToTimestampOrNull(w.tinVerificationStatusChangedAt);

  // ── Lifecycle ──
  const lifecycleStatus = coerceLifecycleStatus(w.lifecycleStatus);

  return {
    directDepositReady,
    bankAccountCount: bankAccounts.length,
    primaryBankLast4,

    i9SignedAt,
    i9Applicable: isEmployee,
    employerI9SignedAt,
    hasWorkbrightDocs: onboardingStatusData?.hasWorkbrightDocs === true,

    w4SignedAt,
    w4Applicable: isEmployee,

    w9SignedAt,
    w9Applicable: isContractor,

    handbookSignedAt,
    policiesSignedCount: Math.max(0, policiesSignedCount),

    tinVerificationStatus,
    tinVerificationStatusChangedAt,
    taxpayerIdentifierLast4:
      typeof w.taxpayerIdentifierLast4 === 'string' ? w.taxpayerIdentifierLast4 : null,

    lifecycleStatus,
    onboardingComplete: w.onboardingComplete === true,
    onboardingStatus: typeof w.onboardingStatus === 'string' ? w.onboardingStatus : null,

    payPeriodCadence,
    supportedPaymentTypes: Array.isArray(w.supportedPaymentTypes)
      ? w.supportedPaymentTypes.filter((t): t is string => typeof t === 'string')
      : [],

    lastEvereeSyncAt: input.now ?? Timestamp.now(),
    lastEvereeSyncSource: input.syncSource,
  };
}

/**
 * Normalize Everee's documentType — they've sent both `'ONBOARDING'` and
 * `'Onboarding'` in pilot (and lowercase from one early sandbox). Treat
 * non-string values as "unknown" so the filter just drops them.
 */
function normalizeDocType(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim().toUpperCase();
}

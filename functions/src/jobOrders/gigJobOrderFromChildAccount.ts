/**
 * **§14b — Shared gig-JO construction helper.**
 *
 * Single source of truth for the field mapping that turns a Child Account
 * into a draft Gig Job Order. Used by:
 *
 *   1. **`onChildAccountCreatedAutoCreateGigJobOrder`** trigger
 *      (going-forward auto-create when a new child account appears).
 *   2. **`backfillGigJobOrdersForNationalAccount`** callable (one-shot
 *      retroactive scan over existing child accounts).
 *
 * Splitting this out guarantees both code paths produce identical-shape
 * JOs and lets the field-mapping be unit-tested as a pure function
 * (no Firestore mocks needed for the mapping itself).
 *
 * ### Layering
 *
 *   ┌──────────────────────────────────────────────┐
 *   │  Trigger / Backfill Callable (orchestrator)   │
 *   │  ─ permission gating                          │
 *   │  ─ per-tenant fan-out                         │
 *   │  ─ notification dispatch                      │
 *   └────────────┬─────────────────────────────────┘
 *                │ calls
 *                ▼
 *   ┌──────────────────────────────────────────────┐
 *   │  createGigJobOrderForChildAccount            │
 *   │  (per-child orchestrator — IO + write)       │
 *   │  ─ idempotency check                         │
 *   │  ─ cascade resolution                        │
 *   │  ─ counter allocation                        │
 *   │  ─ Firestore write                           │
 *   └────────────┬─────────────────────────────────┘
 *                │ calls (sub-steps)
 *                ▼
 *   ┌──────────────────────────────────────────────┐
 *   │  resolveGigJobOrderCascade   (IO)            │
 *   │  loadWorksiteFromChildLocation  (IO)         │
 *   │  getNextJobOrderSeq  (IO)                    │
 *   │  buildGigJobOrderFromChildAccount  (PURE)    │
 *   └──────────────────────────────────────────────┘
 *
 * The pure builder is the unit-test sweet spot: feed it explicit
 * cascade-resolved values and confirm the JO doc shape — no Firestore,
 * no chain-walking, no counter reads.
 *
 * ### Field-mapping spec (Greg, 2026-04-30)
 *
 *   - **Name**:     `${childAccount.name} - Gig Work`
 *   - **Account**:  `childAccountId` (Company + Worksite auto-populate)
 *   - **Type**:     `'gig'`
 *   - **Status**:   `'on_hold'` (auto-managed by `gigJobOrderStatusCron`)
 *   - **Positions**: inherited from cascade (filtered by selectedPositionIds)
 *   - **Hiring Entity / E-Verify / Screening / Pay**: inherited from cascade
 *   - **Assigned Recruiters**: child.associations.recruiterIds → parent fallback
 *   - **Marker**:   `autoCreatedFrom: 'autoCreateGigJobOrders'`
 */

import * as admin from 'firebase-admin';

import {
  EMPTY_RECRUITER_ORDER_DETAILS,
  mergeRecruiterOrderDetails,
  type RecruiterOrderDetailsData,
} from '../utils/recruiterOrderDetailsMergePure';
import {
  createLoaderContext,
  loadCascadeChain,
} from '../shared/cascade/loaders';
import { resolveCascadedField } from '../shared/cascade/resolveCascadedField';
import { shouldAutoCreateUserGroups } from '../accounts/nationalChildCascadeMerge';
import { ensureAutoUserGroup } from '../userGroups/ensureAutoUserGroup';
import { resolveSnapshotEnvelope } from './onJobOrderStatusTransitionSnapshot';

const FieldValue = admin.firestore.FieldValue;

// ─────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────

/**
 * Marker stamped on every auto-spawned JO. Reads:
 *   - Recruiters seeing "Auto-created" badge in the JO list.
 *   - `gigJobOrderStatusCron` (only auto-manages JOs with this marker).
 *   - `backfillGigJobOrdersForNationalAccount` (idempotency check).
 */
export const AUTO_CREATED_FROM_MARKER = 'autoCreateGigJobOrders';

/** Fallback when no `parent.defaultGigJobTitle` and no cascade position. */
export const DEFAULT_GIG_JOB_TITLE = 'Event Worker';

/** Stamped on `createdBy` / `updatedBy` for traceability. */
export const SYSTEM_ACTOR = 'system_auto_gig_jo';

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export type AccountDoc = Record<string, unknown> & {
  accountType?: string;
  parentAccountId?: string | null;
  autoCreatedFromCompanyLocation?: boolean;
  autoCreateGigJobOrders?: boolean;
  associations?: {
    companyIds?: string[];
    locations?: Array<{ companyId?: string; locationId?: string }>;
    recruiterIds?: string[];
  };
  companyId?: string | null;
  companyLocationId?: string | null;
  name?: string;
  /** F.4 (CC.A audit) — National-only seed for auto-spawned Gig JOs. */
  defaultGigJobTitle?: string | null;
  /** F.4 (CC.A audit) — National-only seed for auto-spawned Gig JOs. */
  defaultGigJobDescription?: string | null;
};

/**
 * One position from the cascade-resolved `positions` keyed_list, after
 * the engine has merged Account header fields with Child pricing fields.
 *
 * The keyed_list merge passes through any field whether or not it's in
 * the registry's `itemFields` — but only fields registered in
 * `itemFields` carry a propagation policy. We stay defensive: read with
 * coalesce on alternate spellings (`markupPercent` vs `markupPercentage`,
 * `futa` vs `futaRate`, etc.) since storage drift exists in the wild.
 */
export interface ResolvedPosition {
  positionId?: string;
  jobTitle?: string;
  jobDescription?: string;
  rateMode?: string;
  payRate?: number;
  billRate?: number;
  markupPercent?: number;
  markupPercentage?: number;
  workersCompCode?: string;
  workersCompRate?: number;
  futa?: number;
  futaRate?: number;
  suta?: number;
  sutaRate?: number;
  /** Per-position compliance overlay (from account pricing row); merged atop cascade account-level screening lists. */
  orderDetails?: Record<string, unknown>;
  screeningPackageId?: string;
  screeningPackageName?: string;
}

/**
 * Cascade-resolved values needed to build a gig JO. Produced by
 * `resolveGigJobOrderCascade`; consumed by `buildGigJobOrderFromChildAccount`.
 *
 * Why a dedicated DTO (vs the raw chain): the builder is pure and stays
 * testable without spinning up a fake cascade chain. Everything the JO
 * needs is in this struct — no engine knowledge required at the
 * builder layer.
 */
export interface ResolvedCascadeValues {
  hiringEntityId: string | null;
  eVerifyRequired: boolean;
  screeningPackageId: string | null;
  /** Catalog display name aligned with `screeningPackageId` (account orderDefaults + default position). */
  screeningPackageName: string | null;
  additionalScreenings: string[];
  selectedPositionIds: string[];
  positions: ResolvedPosition[];
  workersCompCode: string;
  /** National-only flat markup; used as fallback when position has no own markup. */
  flatMarkupPercent?: number;
  /**
   * Account-level merged compliance defaults (parent → child), read from
   * `orderDefaults.orderDetails` on each account. Carries every shared
   * `RecruiterOrderDetailsData` field that the recruiter UI exposes on the
   * Cascading Data → Compliance Defaults section: `physicalRequirements`,
   * `skillsRequired`, `licensesCerts`, `languagesRequired`, `educationRequired`,
   * `experienceRequired`, `ppeRequirements`, `ppeProvidedBy`, `dressCode`,
   * `customUniformRequirements`, `requirementPackId`, etc.
   *
   * The pure builder layers position-row `orderDetails` ON TOP of this so a
   * National's lead position can still override the account-level defaults
   * for that one position. `undefined` when neither account carries
   * `orderDefaults.orderDetails` — treated as `EMPTY_RECRUITER_ORDER_DETAILS`
   * by the merger.
   *
   * Mirrors the client-side merge in
   * `src/utils/recruiterAccountOrderDefaultsMerge.ts:fetchMergedRecruiterOrderDefaultsForJobOrder`
   * (account layer only — the per-position overlay is applied in the builder).
   */
  accountOrderDetails?: RecruiterOrderDetailsData;
  /**
   * Account-level "Other Attachments" file metadata, resolved via the
   * cascade engine (`registry.attachments`, strategy `'replace'`). Each
   * entry is the raw `{ name?, label?, url?, uploadedAt? }` shape stored
   * under `orderDefaults.staffInstructions.attachments.files`. Empty array
   * when neither side carries attachments — explicit empty (not undefined)
   * so the JO write deterministically clears any stale value.
   */
  attachmentFiles: unknown[];
}

/** Worksite address shape consumed by JO doc + downstream readiness. */
export interface WorksiteHydration {
  worksiteId: string;
  worksiteName: string;
  worksiteAddress: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
}

/**
 * Pure-function input. Everything the builder needs is here — no IO,
 * no Firestore reads happen inside `buildGigJobOrderFromChildAccount`.
 */
export interface BuildGigJobOrderInput {
  tenantId: string;
  childAccount: AccountDoc & { id: string };
  parentAccount: AccountDoc & { id: string };
  cascade: ResolvedCascadeValues;
  worksite: WorksiteHydration | null;
  jobOrderSeq: number;
  jobOrderNumber: string;
  source: 'backfill' | 'auto_create_trigger';
}

export interface BuildGigJobOrderOutput {
  jobOrderData: Record<string, unknown>;
  /** Recruiters the orchestrator should notify after the write succeeds. */
  assignedRecruiterUids: string[];
  /** Cleaned-up child account name for downstream notification copy. */
  childAccountName: string;
}

export interface CreateGigJobOrderResult {
  jobOrderId: string;
  jobOrderNumber: string;
  jobOrderSeq: number;
  assignedRecruiterUids: string[];
  childAccountName: string;
  /**
   * AG.0 — auto-group attached to this JO (when the cascade had `autoCreateUserGroups`
   * enabled). `null` when the toggle was off, when the cascade had no resolvable default
   * job title, or when the upsert hiccupped (errors are logged but never fail the JO write).
   */
  autoCreatedUserGroupId: string | null;
}

// ─────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────

export function trim(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

/**
 * Child → parent merge for `orderDefaults.screeningPackageId` / `screeningPackageName`,
 * matching client `mergeScreeningPackageFromOrderDefaultLayers` (account layers only).
 */
export function mergeOrderDefaultsScreeningPackage(
  child: AccountDoc,
  parent: AccountDoc,
): { id: string; name: string } {
  const c = child.orderDefaults as Record<string, unknown> | undefined;
  const p = parent.orderDefaults as Record<string, unknown> | undefined;
  const childId = trim(c?.screeningPackageId);
  const parentId = trim(p?.screeningPackageId);
  const childName = trim(c?.screeningPackageName);
  const parentName = trim(p?.screeningPackageName);
  return {
    id: childId || parentId,
    name: childId ? childName : parentName,
  };
}

export function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = parseFloat(value.trim());
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * Walk `orderDefaults.orderDetails` on an account doc and return it as the
 * shared `RecruiterOrderDetailsData` shape, or `undefined` when nothing's
 * there. Defensive against malformed docs (string, number, array at any of
 * the path segments) — the recruiter UI tolerates the same drift.
 */
export function readAccountOrderDetails(
  account: AccountDoc | undefined,
): RecruiterOrderDetailsData | undefined {
  if (!account || typeof account !== 'object') return undefined;
  const od = (account as { orderDefaults?: unknown }).orderDefaults;
  if (!od || typeof od !== 'object' || Array.isArray(od)) return undefined;
  const details = (od as { orderDetails?: unknown }).orderDetails;
  if (!details || typeof details !== 'object' || Array.isArray(details)) return undefined;
  return details as RecruiterOrderDetailsData;
}

/**
 * Walk `orderDefaults.staffInstructions.attachments.files` on an account
 * doc — the same nested path the cascade registry's `attachments` field
 * is keyed to (`src/shared/cascade/loaders.ts:67`). Returns `[]` when any
 * level of the path is missing or malformed; this keeps the cascade
 * write deterministic (we always set the field, never leave a stale
 * value).
 */
export function readAccountAttachmentFiles(
  account: AccountDoc | undefined,
): unknown[] {
  if (!account || typeof account !== 'object') return [];
  const od = (account as { orderDefaults?: unknown }).orderDefaults;
  if (!od || typeof od !== 'object' || Array.isArray(od)) return [];
  const si = (od as { staffInstructions?: unknown }).staffInstructions;
  if (!si || typeof si !== 'object' || Array.isArray(si)) return [];
  const att = (si as { attachments?: unknown }).attachments;
  if (!att || typeof att !== 'object' || Array.isArray(att)) return [];
  const files = (att as { files?: unknown }).files;
  return Array.isArray(files) ? files : [];
}

/**
 * Strip `undefined` recursively. Firestore rejects undefined; the
 * cascade chain can return undefined for unset fields, which would
 * otherwise blow up the write. We accept null as a legal stored value
 * (distinct from "field not present") to preserve cascade semantics.
 */
export function stripUndefined<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => stripUndefined(item))
      .filter((item) => item !== undefined) as unknown as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = stripUndefined(v);
    }
    return out as unknown as T;
  }
  return value;
}

/**
 * Pick the position the auto-JO should default to. Prefers the first id
 * in `selectedPositionIds` (the National's curated lead position) and
 * falls back to the first position with a non-empty job title. Returns
 * `null` only when the cascade has no positions at all — recruiter
 * sees a JO with the default title and zero rates, which is the right
 * "needs review" signal.
 */
export function pickDefaultPosition(
  selectedIds: string[],
  positions: ResolvedPosition[],
): ResolvedPosition | null {
  if (positions.length === 0) return null;
  if (selectedIds.length > 0) {
    const byId = new Map<string, ResolvedPosition>();
    for (const p of positions) {
      const id = trim(p.positionId);
      if (id) byId.set(id, p);
    }
    for (const id of selectedIds) {
      const hit = byId.get(id);
      if (hit && trim(hit.jobTitle)) return hit;
    }
  }
  return positions.find((p) => trim(p.jobTitle)) ?? positions[0];
}

// ─────────────────────────────────────────────────────────────────────
// Pure builder — the field-mapping single source of truth
// ─────────────────────────────────────────────────────────────────────

/**
 * **The §14b field-mapping spec, codified.**
 *
 * Pure function. Given a child account, its parent national, the pre-
 * resolved cascade values, and the seq # the orchestrator allocated,
 * return the JO doc payload that should be written to Firestore.
 *
 * Both the auto-create trigger and the backfill callable run this same
 * function so a recruiter can't tell the difference between a JO spawned
 * by automation today and one spawned via backfill last week — they're
 * byte-identical-shape JOs (modulo the seq #).
 *
 * The returned `jobOrderData` is **not** stripped of undefined values;
 * the orchestrator should call `stripUndefined()` before writing.
 * (Keeping undefined in the pure return makes test assertions cleaner —
 * `expect(jo.workersCompCode).to.be.undefined` is more readable than
 * inferring its absence from a Firestore-cleaned object.)
 */
export function buildGigJobOrderFromChildAccount(
  input: BuildGigJobOrderInput,
): BuildGigJobOrderOutput {
  const {
    tenantId,
    childAccount,
    parentAccount,
    cascade,
    worksite,
    jobOrderSeq,
    jobOrderNumber,
    source,
  } = input;

  const childAccountId = childAccount.id;
  const childName = trim(childAccount.name) || 'Child Account';
  const parentName = trim(parentAccount.name);
  const companyId = trim(childAccount.companyId);

  // ── Position + pricing derivation ─────────────────────────────────
  const defaultPosition = pickDefaultPosition(
    cascade.selectedPositionIds,
    cascade.positions,
  );
  const fallbackJobTitle =
    trim(parentAccount.defaultGigJobTitle) ||
    trim(defaultPosition?.jobTitle) ||
    DEFAULT_GIG_JOB_TITLE;

  // F.4 (CC.A audit): description cascade order, broadened 2026-05-05 to
  // pick up National-account inputs that aren't keyed to `defaultGigJobDescription`.
  // Recruiters in the wild type the description into one of:
  //   1. `parentAccount.defaultGigJobDescription` (the dedicated NA Cascading
  //      Data → Automations textarea) — original source.
  //   2. The lead position's `jobDescription` (the per-position description
  //      stored on `pricing.positions[i].jobDescription`).
  //   3. The lead position's `jobDescriptionFromClient` (alt key the
  //      position-row form persists when the recruiter pastes a client-
  //      provided description; see `accountPricingForJobOrder.ts:42`).
  //   4. `childAccount.defaultGigJobDescription` (occasionally set on the
  //      child instead of the parent for child-overrides).
  //   5. `childAccount.jobDescription` / `parentAccount.jobDescription`
  //      (legacy top-level field on a few imported accounts).
  // Empty string only when none of the above produced text.
  //
  // 2026-05-05 (CC.B): the resolved value lands on `jobOrder.jobDescriptionFromClient`
  // — *not* `jobOrder.jobDescription`. The latter is the AI-generated public-
  // facing posting copy (Overview tab leaves it untouched; Jobs Board tab
  // calls "Generate Job Description" to produce it). The former is the prompt
  // input the recruiter pasted from the client. Earlier auto-create versions
  // wrote the prompt into `jobDescription`, which then bled through
  // `jobsBoardService.createPostFromJobOrder` (`jobDescription: jobOrder.jobDescription`)
  // and `getInitialDataStatic`'s `jobDescription: savedDesc || accountJd` into
  // the public-facing posting field. This restores the intended split.
  const positionJobDescriptionFromClient = trim(
    (defaultPosition as { jobDescriptionFromClient?: unknown } | null | undefined)
      ?.jobDescriptionFromClient,
  );
  const fallbackClientJobDescription =
    trim(parentAccount.defaultGigJobDescription) ||
    trim(defaultPosition?.jobDescription) ||
    positionJobDescriptionFromClient ||
    trim((childAccount as { defaultGigJobDescription?: unknown }).defaultGigJobDescription) ||
    trim((childAccount as { jobDescription?: unknown }).jobDescription) ||
    trim((parentAccount as { jobDescription?: unknown }).jobDescription) ||
    '';

  const positionPayRate = defaultPosition
    ? asFiniteNumber(defaultPosition.payRate)
    : undefined;
  const positionBillRate = defaultPosition
    ? asFiniteNumber(defaultPosition.billRate)
    : undefined;
  const positionMarkup = defaultPosition
    ? asFiniteNumber(
        defaultPosition.markupPercent ?? defaultPosition.markupPercentage,
      )
    : undefined;
  // Per-position WC code wins over the account-level cascade code —
  // it's the more specific source.
  const positionWcCode =
    (defaultPosition ? trim(defaultPosition.workersCompCode) : '') ||
    cascade.workersCompCode;
  const positionWcRate = defaultPosition
    ? asFiniteNumber(defaultPosition.workersCompRate)
    : undefined;

  const dp = defaultPosition as ResolvedPosition | undefined;
  const posOdRaw = dp?.orderDetails;
  const posOd: RecruiterOrderDetailsData | undefined =
    posOdRaw && typeof posOdRaw === 'object'
      ? (posOdRaw as RecruiterOrderDetailsData)
      : undefined;
  // Layer order (top → bottom):
  //   position.orderDetails  (override)
  //   account-level merged OD (parent → child) (broader cascade)
  //   { additionalScreenings: cascade } (engine-resolved fallback)
  //   EMPTY_RECRUITER_ORDER_DETAILS (defaults baseline)
  // mergeRecruiterOrderDetails treats the first arg as override, second as
  // base — chain twice so we end up with position-wins-over-account-wins-
  // over-cascade-defaults semantics, matching how the client-side
  // `fetchMergedRecruiterOrderDefaultsForJobOrder` resolves the same
  // values for the JO form.
  const baseComplianceOd: RecruiterOrderDetailsData = {
    ...EMPTY_RECRUITER_ORDER_DETAILS,
    additionalScreenings: cascade.additionalScreenings,
  };
  const accountPlusBase = cascade.accountOrderDetails
    ? mergeRecruiterOrderDetails(cascade.accountOrderDetails, baseComplianceOd)
    : baseComplianceOd;
  const mergedComplianceOd = mergeRecruiterOrderDetails(posOd, accountPlusBase);

  const posScreeningId = trim(dp?.screeningPackageId);
  const cascadeScreeningId = cascade.screeningPackageId ? trim(cascade.screeningPackageId) : '';
  const effectiveScreeningPackageId = posScreeningId || cascadeScreeningId || '';
  const posScreeningName = trim(dp?.screeningPackageName);
  const cascadeScreeningName = cascade.screeningPackageName ? trim(cascade.screeningPackageName) : '';
  const effectiveScreeningPackageName = posScreeningId
    ? posScreeningName || cascadeScreeningName
    : cascadeScreeningName;
  const hasPpeRows = (mergedComplianceOd.ppeRequirements?.length ?? 0) > 0;

  // Bill-rate fallback: payRate * (1 + markup/100) when the position
  // didn't carry an explicit bill rate. Use the National's flat markup
  // when subAccountsManageOwnPricing is false (cascade resolves it on
  // pricingFlatMarkupPercent). Last-resort: 0.
  const effectiveMarkup = positionMarkup ?? cascade.flatMarkupPercent;
  const computedBillRate =
    positionBillRate ??
    (positionPayRate != null && effectiveMarkup != null
      ? Math.round(positionPayRate * (1 + effectiveMarkup / 100) * 100) / 100
      : 0);

  // ── Assigned recruiters ───────────────────────────────────────────
  // Spec priority: child.associations.recruiterIds → parent fallback.
  // Tenant-default recruiter is deferred — empty array means recruiters
  // see the JO via the "unassigned" filter rather than via a stranger's
  // queue.
  const childRecruiters = Array.isArray(childAccount.associations?.recruiterIds)
    ? (childAccount.associations!.recruiterIds as string[]).filter(
        (id) => trim(id) !== '',
      )
    : [];
  const parentRecruiters = Array.isArray(parentAccount.associations?.recruiterIds)
    ? (parentAccount.associations!.recruiterIds as string[]).filter(
        (id) => trim(id) !== '',
      )
    : [];
  const assignedRecruiters =
    childRecruiters.length > 0 ? childRecruiters : parentRecruiters;

  // ── Compose the JO doc ────────────────────────────────────────────
  // Name format per Greg's 2026-04-30 spec: `<child name> - Gig Work`.
  // Plain ASCII hyphen, no em-dash — the recruiter list views render in
  // a monospace-ish layout where em-dashes drop visual weight.
  const jobOrderName = `${childName} - Gig Work`;
  const now = FieldValue.serverTimestamp();

  const jobOrderData: Record<string, unknown> = {
    // Core
    jobOrderSeq,
    jobOrderNumber,
    jobOrderName,
    // Status `'on_hold'` is the auto-managed default. The
    // `gigJobOrderStatusCron` flips it to `'open'` once an active
    // upcoming shift exists, and back to `'on_hold'` when none remain.
    // Recruiters never have to hand-manage it.
    status: 'on_hold',
    jobType: 'gig',
    tenantId,
    createdAt: now,
    updatedAt: now,
    createdBy: SYSTEM_ACTOR,
    updatedBy: SYSTEM_ACTOR,

    // Account / lookup denorm
    recruiterAccountId: childAccountId,
    accountId: childAccountId,
    accountName: childName,
    parentAccountId: trim(childAccount.parentAccountId) || null,
    parentAccountName: parentName || null,

    // Company (CRM)
    companyId: companyId || '',
    companyName: parentName || childName,

    // Worksite
    worksiteId: worksite?.worksiteId ?? '',
    worksiteName: worksite?.worksiteName ?? '',
    worksiteAddress:
      worksite?.worksiteAddress ?? {
        street: '',
        city: '',
        state: '',
        zipCode: '',
        country: 'US',
      },
    locationId: worksite?.worksiteId ?? undefined,
    locationName: worksite?.worksiteName ?? undefined,

    // Job details
    jobTitle: fallbackJobTitle,
    // `jobDescription` (AI-generated public-facing copy) intentionally left
    // empty on auto-create. Recruiter clicks "Generate Job Description" on
    // the Jobs Board tab to fill it from the prompt below.
    jobDescription: '',
    // `jobDescriptionFromClient` is the prompt input the recruiter pasted
    // from the client (or that cascaded down from the position row). Reads
    // back into the Overview tab's "Job Description from Client" field and
    // seeds `posting.jobDescriptionPrompt` on the Jobs Board tab.
    jobDescriptionFromClient: fallbackClientJobDescription,
    assignedRecruiters,
    payRate: positionPayRate ?? 0,
    billRate: computedBillRate,
    workersNeeded: 0,
    headcountRequested: 0,
    headcountFilled: 0,
    workersCompCode: positionWcCode || undefined,
    workersCompRate: positionWcRate,
    timesheetCollectionMethod: 'app_clock_in_out' as const,
    poRequired: false,

    // Jobs board defaults — recruiter chooses visibility on activation.
    jobsBoardVisibility: 'hidden' as const,
    visibility: 'hidden' as const,
    showPayRate: false,
    showStartDate: false,
    showShiftTimes: false,

    // Compliance — cascade + optional per-position row overlay (`orderDetails`, screening on `ResolvedPosition`).
    hiringEntityId: cascade.hiringEntityId,
    eVerifyRequired: cascade.eVerifyRequired,
    screeningPackageId: effectiveScreeningPackageId || cascade.screeningPackageId,
    ...(effectiveScreeningPackageName ? { screeningPackageName: effectiveScreeningPackageName } : {}),
    additionalScreenings: mergedComplianceOd.additionalScreenings,
    backgroundCheckRequired: Boolean(effectiveScreeningPackageId || cascade.screeningPackageId),
    drugScreenRequired: false,
    backgroundCheckPackages: [],

    // Compliance — full RecruiterOrderDetailsData fan-out from
    // `mergedComplianceOd` (position OD overlaid on the account-level
    // cascade). Empty arrays / strings when neither layer supplied a value.
    // Recruiter UI reads these flat fields directly on the JO doc; the
    // matching `jo.snapshot.{...}` envelope is stamped post-write below
    // so snapshot-aware consumers (`getEffectiveJobOrderField`) see the
    // same resolved values.
    requiredLicenses: [],
    requiredCertifications: mergedComplianceOd.licensesCerts ?? [],
    licensesCerts: mergedComplianceOd.licensesCerts ?? [],
    languagesRequired: mergedComplianceOd.languagesRequired ?? [],
    skillsRequired: mergedComplianceOd.skillsRequired ?? [],
    physicalRequirements: mergedComplianceOd.physicalRequirements ?? [],
    ppeRequirements: mergedComplianceOd.ppeRequirements ?? [],
    ppeProvidedBy: hasPpeRows ? mergedComplianceOd.ppeProvidedBy ?? 'company' : 'company',
    dressCode: mergedComplianceOd.dressCode ?? [],
    educationRequired: mergedComplianceOd.educationRequired ?? '',
    experienceRequired: mergedComplianceOd.experienceRequired ?? '',
    customUniformRequirements: mergedComplianceOd.customUniformRequirements ?? '',
    requirementPackId: mergedComplianceOd.requirementPackId ?? '',
    contactRoles: [],
    companyContacts: [],

    // "Other Attachments" (registry: `attachments` strategy `'replace'`).
    // Stored at the JO under the same nested key the client-side reader
    // expects when surfacing files on the JO Documents tab. The cascade
    // engine writes these as a flat `files: []` blob; mirror that shape
    // here so `attachments.files` paths resolve identically across snapshot
    // and flat reads.
    attachments: { files: cascade.attachmentFiles },

    // Traceability — `autoCreatedFrom` is read by the cron (only
    // auto-manage these JOs) and by the backfill idempotency check.
    autoCreatedFrom: AUTO_CREATED_FROM_MARKER,
    autoCreatedFromChildAccountId: childAccountId,
    /** Dev-only audit: which path produced this JO. Doesn't affect
     *  semantics — both paths are byte-identical otherwise. */
    autoCreatedSource: source,
  };

  return {
    jobOrderData,
    assignedRecruiterUids: assignedRecruiters,
    childAccountName: childName,
  };
}

// ─────────────────────────────────────────────────────────────────────
// IO helpers — used by the orchestrator. Not pure; do Firestore reads.
// ─────────────────────────────────────────────────────────────────────

/**
 * Server-side counter allocator for `jobOrderNumber`. Mirrors the
 * client-side `getNextJobOrderNumber` semantics from
 * `src/utils/counters.ts` but uses an admin transaction so concurrent
 * auto-creates (e.g. backfill spawning 50 JOs at once) don't collide.
 *
 * Counter doc: `tenants/{tid}/counters/jobOrderNumber` with shape
 * `{ next: number, padding: 4, ... }`. If the doc doesn't exist yet,
 * seed `next` from the existing JO count + 1 so we don't reuse `0001`
 * on a tenant that has manually-created legacy JOs.
 */
export async function getNextJobOrderSeq(
  db: admin.firestore.Firestore,
  tenantId: string,
): Promise<{ seq: number; formatted: string }> {
  const counterRef = db.doc(`tenants/${tenantId}/counters/jobOrderNumber`);
  const PADDING = 4;

  const seq = await db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    if (snap.exists) {
      const data = snap.data() ?? {};
      const next = typeof data.next === 'number' ? data.next : 1;
      tx.update(counterRef, {
        next: FieldValue.increment(1),
        lastUsed: Date.now(),
        updatedAt: Date.now(),
        updatedBy: SYSTEM_ACTOR,
      });
      return next;
    }

    const existing = await db
      .collection(`tenants/${tenantId}/job_orders`)
      .count()
      .get();
    const seedNext = existing.data().count + 1;
    tx.set(counterRef, {
      id: 'jobOrderNumber',
      tenantId,
      counterId: 'jobOrderNumber',
      next: seedNext + 1,
      prefix: '',
      suffix: '',
      padding: PADDING,
      description: 'Auto-incrementing counter for jobOrderNumber',
      lastUsed: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: SYSTEM_ACTOR,
      updatedBy: SYSTEM_ACTOR,
    });
    return seedNext;
  });

  return { seq, formatted: String(seq).padStart(PADDING, '0') };
}

/**
 * Prefer top-level `companyId` + `companyLocationId` (auto-child pattern).
 * Fall back to the first `associations.locations[]` entry — manual child
 * accounts often only store the worksite ref there.
 */
export function resolveCompanyLocationFromChildAccount(
  child: AccountDoc,
): { companyId: string; locationId: string } | null {
  const topC = trim(child.companyId);
  const topL = trim(child.companyLocationId);
  if (topC && topL) return { companyId: topC, locationId: topL };

  const locs = child.associations?.locations;
  if (!Array.isArray(locs) || locs.length === 0) return null;
  const first = locs[0] as Record<string, unknown> | undefined;
  if (!first || typeof first !== 'object') return null;
  const c = trim(first.companyId);
  const l = trim(first.locationId);
  if (c && l) return { companyId: c, locationId: l };
  return null;
}

/**
 * Hydrate a worksite Address from the CRM company location doc. Returns
 * `null` when the child has no resolvable company/location refs (placeholder JO
 * without worksite — recruiter fills in when they activate).
 *
 * Reads **`tenants/{tenantId}/crm_companies/.../locations/...`** (canonical).
 * Falls back to legacy root `crm_companies/...` if the tenant-scoped doc is missing.
 *
 * Tolerates the legacy nested + flat address variants on the location
 * doc: `address.street/city/...` and bare `street/city/...` fields are
 * both observed in the wild from older imports.
 */
export async function loadWorksiteFromChildLocation(
  db: admin.firestore.Firestore,
  tenantId: string,
  child: AccountDoc,
): Promise<WorksiteHydration | null> {
  const refs = resolveCompanyLocationFromChildAccount(child);
  if (!refs) return null;
  const { companyId, locationId } = refs;

  const tenantScopedPath = `tenants/${tenantId}/crm_companies/${companyId}/locations/${locationId}`;
  let locSnap = await db.doc(tenantScopedPath).get();
  if (!locSnap.exists) {
    const legacyPath = `crm_companies/${companyId}/locations/${locationId}`;
    locSnap = await db.doc(legacyPath).get();
  }
  if (!locSnap.exists) return null;

  const loc = locSnap.data() ?? {};
  const nickname = trim(loc.nickname);
  const name = trim(loc.name);
  const worksiteName = nickname || name || 'Location';

  const addr = (loc.address as Record<string, unknown>) ?? {};
  const street = trim(addr.street ?? loc.street);
  const city = trim(addr.city ?? loc.city);
  const state = trim(addr.state ?? loc.state);
  const zipCode = trim(addr.zipCode ?? addr.zip ?? loc.zipCode ?? loc.zip);
  const country = trim(addr.country ?? loc.country) || 'US';

  return {
    worksiteId: locationId,
    worksiteName,
    worksiteAddress: { street, city, state, zipCode, country },
  };
}

/**
 * Resolve the cascade-driven values needed to seed a gig JO for the
 * given child account. Mostly a wrapper over `loadCascadeChain` +
 * `resolveCascadedField`, plus the **defensive top-level fallback** for
 * `hiringEntityId` and `eVerifyRequired`.
 *
 * **Why the fallback exists** — the cascade loader expects
 * `hiringEntityId` at `orderDefaults.hiringEntityId`, but the
 * JobOrderForm UI + auto-child-account trigger BOTH persist it at the
 * **top-level** (`account.hiringEntityId`). Tracked in the cascade
 * audit; queued for cleanup in R.16.2b. Until that lands, fall back to
 * Child → Parent top-level fields so the auto-JO inherits values
 * recruiters actually see in the UI. Once accounts are migrated, the
 * fallback becomes dead code with no behavioural change.
 */
export async function resolveGigJobOrderCascade(args: {
  db: admin.firestore.Firestore;
  tenantId: string;
  childAccountId: string;
  childAccount: AccountDoc;
  parentAccount: AccountDoc;
}): Promise<ResolvedCascadeValues> {
  const { db, tenantId, childAccountId, childAccount, parentAccount } = args;

  const ctx = createLoaderContext({ db });
  const locRefs = resolveCompanyLocationFromChildAccount(childAccount);
  const preloadedJoData = {
    recruiterAccountId: childAccountId,
    companyId: locRefs?.companyId || trim(childAccount.companyId) || undefined,
    worksiteId: locRefs?.locationId || trim(childAccount.companyLocationId) || undefined,
  };
  const chain = await loadCascadeChain(ctx, {
    tenantId,
    jobOrderId: '__synthetic_auto_gig__',
    preloadedJoData,
  });

  const hiringEntityIdRes = resolveCascadedField('hiringEntityId', chain);
  const eVerifyRes = resolveCascadedField('eVerifyRequired', chain);
  const screeningPkgRes = resolveCascadedField('screeningPackageId', chain);
  const additionalScreeningsRes = resolveCascadedField(
    'additionalScreenings',
    chain,
  );
  const selectedPositionIdsRes = resolveCascadedField(
    'selectedPositionIds',
    chain,
  );
  const positionsRes = resolveCascadedField('positions', chain);
  const flatMarkupRes = resolveCascadedField('pricingFlatMarkupPercent', chain);
  const workersCompCodeRes = resolveCascadedField('workersCompCode', chain);

  // Defensive fallback — see docstring above.
  const cascadeHiringEntityId =
    typeof hiringEntityIdRes.value === 'string' &&
    hiringEntityIdRes.value.trim()
      ? (hiringEntityIdRes.value as string).trim()
      : null;
  const topLevelHiringEntityId =
    trim(childAccount.hiringEntityId as unknown) ||
    trim(parentAccount.hiringEntityId as unknown) ||
    '';
  const hiringEntityId =
    cascadeHiringEntityId ||
    (topLevelHiringEntityId.length > 0 ? topLevelHiringEntityId : null);

  const cascadeEVerify =
    typeof eVerifyRes.value === 'boolean'
      ? (eVerifyRes.value as boolean)
      : undefined;
  const topLevelEVerify =
    typeof childAccount.eVerifyRequired === 'boolean'
      ? (childAccount.eVerifyRequired as boolean)
      : typeof parentAccount.eVerifyRequired === 'boolean'
        ? (parentAccount.eVerifyRequired as boolean)
        : undefined;
  const eVerifyRequired =
    cascadeEVerify !== undefined
      ? cascadeEVerify
      : topLevelEVerify !== undefined
        ? topLevelEVerify
        : false;

  const screeningPackageId =
    typeof screeningPkgRes.value === 'string' && screeningPkgRes.value.trim()
      ? (screeningPkgRes.value as string).trim()
      : null;
  const additionalScreenings = Array.isArray(additionalScreeningsRes.value)
    ? (additionalScreeningsRes.value as unknown[]).filter(
        (v): v is string => typeof v === 'string' && v.trim() !== '',
      )
    : [];
  const selectedPositionIds = Array.isArray(selectedPositionIdsRes.value)
    ? (selectedPositionIdsRes.value as unknown[]).filter(
        (v): v is string => typeof v === 'string' && v.trim() !== '',
      )
    : [];
  const positions = Array.isArray(positionsRes.value)
    ? (positionsRes.value as ResolvedPosition[])
    : [];
  const flatMarkupPercent = asFiniteNumber(flatMarkupRes.value);
  const workersCompCode =
    typeof workersCompCodeRes.value === 'string' &&
    workersCompCodeRes.value.trim()
      ? (workersCompCodeRes.value as string).trim()
      : '';

  const odPkg = mergeOrderDefaultsScreeningPackage(childAccount, parentAccount);
  const dpForName = pickDefaultPosition(selectedPositionIds, positions);
  const posIdForName = trim(dpForName?.screeningPackageId);
  const posNameForName = trim(dpForName?.screeningPackageName);
  const cascadeSidStr = screeningPackageId ?? '';
  let screeningPackageName: string | null = null;
  if (posIdForName) {
    screeningPackageName =
      (posNameForName || (odPkg.id === posIdForName ? odPkg.name : '')).trim() || null;
  } else {
    screeningPackageName = (odPkg.id === cascadeSidStr ? odPkg.name : '').trim() || null;
  }

  // Account-level compliance defaults — child wins, parent fills. Mirrors
  // the client-side merge in `recruiterAccountOrderDefaultsMerge.ts` so a
  // recruiter sees identical resolved values whether they're looking at the
  // Cascading Data tab on the child or at a freshly-spawned auto-JO.
  const childAccountOd = readAccountOrderDetails(childAccount);
  const parentAccountOd = readAccountOrderDetails(parentAccount);
  const accountOrderDetails =
    childAccountOd || parentAccountOd
      ? mergeRecruiterOrderDetails(childAccountOd, parentAccountOd)
      : undefined;

  // Attachments — registry strategy is `'replace'`, child overrides parent
  // outright. (We deliberately do NOT stack the two arrays; that's
  // `union_with_remove` semantics, which the registry doesn't grant for
  // `attachments` in v1.) Empty array when neither side has attachments
  // so the cascade write deterministically clears any stale denorm.
  const childFiles = readAccountAttachmentFiles(childAccount);
  const attachmentFiles = childFiles.length > 0
    ? childFiles
    : readAccountAttachmentFiles(parentAccount);

  return {
    hiringEntityId,
    eVerifyRequired,
    screeningPackageId,
    screeningPackageName,
    additionalScreenings,
    selectedPositionIds,
    positions,
    workersCompCode,
    flatMarkupPercent,
    accountOrderDetails,
    attachmentFiles,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Per-child orchestrator
// ─────────────────────────────────────────────────────────────────────

/**
 * **Per-child orchestrator** — chains the IO helpers + pure builder +
 * Firestore write, with idempotency at the front.
 *
 * Returns:
 *   - `null` when an auto-JO for this child already exists (idempotent
 *     skip — backfill counts these as "already had").
 *   - The new JO meta on a successful write.
 *
 * Throws on unexpected errors; the trigger handler swallows + logs them
 * so a single failure doesn't poison the whole event, and the backfill
 * callable surfaces them per-row in its audit list.
 */
export async function createGigJobOrderForChildAccount(args: {
  tenantId: string;
  childAccountId: string;
  childAccount: AccountDoc;
  parentAccount: AccountDoc;
  source: 'backfill' | 'auto_create_trigger';
  /**
   * Optional Firestore handle. Defaults to `admin.firestore()`. Tests
   * inject a fake (matches the `runSnapshotPassForJo` injection pattern).
   */
  db?: admin.firestore.Firestore;
}): Promise<CreateGigJobOrderResult | null> {
  const { tenantId, childAccountId, childAccount, parentAccount, source } = args;
  const db = args.db ?? admin.firestore();

  // ── Idempotency ────────────────────────────────────────────────────
  // Skip if we already auto-spawned a JO for this child. The
  // `recruiterAccountId + autoCreatedFrom` pair pins the marker to
  // exactly the JO this orchestrator would write.
  const existingAuto = await db
    .collection(`tenants/${tenantId}/job_orders`)
    .where('recruiterAccountId', '==', childAccountId)
    .where('autoCreatedFrom', '==', AUTO_CREATED_FROM_MARKER)
    .limit(1)
    .get();
  if (!existingAuto.empty) {
    return null;
  }

  // ── Resolve cascade ───────────────────────────────────────────────
  const cascade = await resolveGigJobOrderCascade({
    db,
    tenantId,
    childAccountId,
    childAccount,
    parentAccount,
  });

  // ── Hydrate worksite ──────────────────────────────────────────────
  const worksite = await loadWorksiteFromChildLocation(db, tenantId, childAccount);

  // ── Allocate JO seq# transactionally ──────────────────────────────
  const { seq: jobOrderSeq, formatted: jobOrderNumber } =
    await getNextJobOrderSeq(db, tenantId);

  // ── Pure-function build ───────────────────────────────────────────
  const { jobOrderData, assignedRecruiterUids, childAccountName } =
    buildGigJobOrderFromChildAccount({
      tenantId,
      childAccount: { ...childAccount, id: childAccountId } as AccountDoc & {
        id: string;
      },
      parentAccount: {
        ...parentAccount,
        id: trim(childAccount.parentAccountId) || '',
      } as AccountDoc & { id: string },
      cascade,
      worksite,
      jobOrderSeq,
      jobOrderNumber,
      source,
    });

  // ── Snapshot envelope (resolved before the write so we can ship it
  // atomically with the JO doc — see comment block below) ─────────
  //
  // R.16.1's `onJobOrderStatusTransitionSnapshot` only fires on a
  // `draft → non-draft` transition, but auto-JOs are created at
  // `'on_hold'` so they never enter that codepath. Without an explicit
  // capture here, recruiters see a JO whose snapshot envelope is empty
  // until they bounce it through `'draft'` — exactly the symptom that
  // physical requirements / file uploads / customUniformRequirements
  // weren't reaching the JO. Run `resolveSnapshotEnvelope` BEFORE the
  // write with the in-memory JO data as `preloadedJoData` (which causes
  // `loadCascadeChain` to skip its own JO read; see
  // `functions/src/shared/cascade/loaders.ts:204`), then merge the
  // resulting envelope into `jobOrderData.snapshot` so the orchestrator
  // performs exactly one initial write — preserving the "one write per
  // JO create" contract the unit tests assert on.
  //
  // Failures are logged but never propagated — the JO is still usable
  // without a snapshot, and the backfill script can re-stamp
  // idempotently. We do NOT write an audit log entry here: the audit
  // collection is reserved for transition events, and an auto-create
  // isn't a transition.
  const jobOrderRef = db.collection(`tenants/${tenantId}/job_orders`).doc();
  try {
    const loaderCtx = createLoaderContext({ db });
    const { envelope } = await resolveSnapshotEnvelope({
      tenantId,
      jobOrderId: jobOrderRef.id,
      preloadedJoData: jobOrderData,
      loaderCtx,
    });
    jobOrderData.snapshot = stripUndefined({
      ...envelope,
      capturedAt: FieldValue.serverTimestamp(),
      capturedBy: 'auto_create',
      lastPushedAt: null,
    });
  } catch (err) {
    console.warn(
      `[gig-jo.snapshot] resolveSnapshotEnvelope failed for childAccountId=${childAccountId}:`,
      err,
    );
  }

  // ── Write ─────────────────────────────────────────────────────────
  await jobOrderRef.set(stripUndefined(jobOrderData));

  // ── AG.0 — auto-group cascade (post-JO-write, fire-and-log) ───────
  // Run AFTER the JO write so the group write can never roll back the JO. Failures here
  // are logged but never propagated; the cron + backfill paths can re-run the upsert
  // idempotently if it didn't take. The two writes are intentionally not transactional —
  // we'd rather have a JO without a group than a stuck JO write.
  let autoCreatedUserGroupId: string | null = null;
  if (shouldAutoCreateUserGroups(parentAccount as Record<string, unknown>) ||
      shouldAutoCreateUserGroups(childAccount as Record<string, unknown>)) {
    const jobTitleForGroup =
      trim(parentAccount.defaultGigJobTitle) ||
      trim(jobOrderData.jobTitle as unknown) ||
      '';
    if (jobTitleForGroup) {
      try {
        const { groupId } = await ensureAutoUserGroup({
          tenantId,
          childAccountId,
          childAccountName,
          jobTitleId: jobTitleForGroup,
          jobTitleName: jobTitleForGroup,
          nationalAccountId: trim(childAccount.parentAccountId) || null,
          recruiterIds: assignedRecruiterUids,
          createdBy: SYSTEM_ACTOR,
          db,
        });
        autoCreatedUserGroupId = groupId;

        // Stamp the JO with the denorm pointer + union-merge into the existing
        // `autoMessagingUserGroupIds` field that `runJobOrderAutoMessagingForShift`
        // already reads at `jobOrderAutoMessaging.ts:232`. arrayUnion preserves any
        // recruiter-added groups that landed via direct edit.
        await jobOrderRef.update({
          autoCreatedUserGroupId: groupId,
          autoMessagingUserGroupIds: FieldValue.arrayUnion(groupId),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: SYSTEM_ACTOR,
        });
      } catch (err) {
        // Logged via the orchestrator's caller (trigger / backfill audit row).
        // We don't want to throw here — a failed group write should not abort
        // the JO creation, and the next backfill will idempotently retry.
        console.warn(
          `[ag.0] ensureAutoUserGroup failed for childAccountId=${childAccountId} jobTitle=${jobTitleForGroup}:`,
          err,
        );
      }
    }
  }

  return {
    jobOrderId: jobOrderRef.id,
    jobOrderNumber,
    jobOrderSeq,
    assignedRecruiterUids,
    childAccountName,
    autoCreatedUserGroupId,
  };
}

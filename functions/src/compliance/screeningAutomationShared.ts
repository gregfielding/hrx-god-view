/**
 * Server-side screening package resolution + satisfied evaluation.
 * Keep aligned with src/pages/UserProfile/components/backgroundsComplianceModel.ts
 */

import * as admin from 'firebase-admin';

const Timestamp = admin.firestore.Timestamp;

export interface ScreeningPackageMergeResult {
  packageName: string;
  packageId: string;
  nameSource: 'job_order' | 'location_defaults' | 'account' | null;
  idSource: 'job_order' | 'location_defaults' | 'account' | null;
}

function readPackageNameLayer(d: Record<string, unknown> | undefined): string {
  if (!d) return '';
  const top = d.screeningPackageName ?? d.backgroundPackageName ?? d.packageName;
  if (top != null && String(top).trim()) return String(top).trim();
  const def = d.defaults as Record<string, unknown> | undefined;
  if (def) {
    const v = def.screeningPackageName ?? def.backgroundPackageName ?? def.packageName;
    if (v != null && String(v).trim()) return String(v).trim();
  }
  const od = d.orderDefaults as Record<string, unknown> | undefined;
  if (od && typeof od === 'object') {
    const v =
      (od as Record<string, unknown>).screeningPackageName ??
      (od as Record<string, unknown>).backgroundPackageName ??
      (od as Record<string, unknown>).packageName;
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

function readPackageIdLayer(d: Record<string, unknown> | undefined): string {
  if (!d) return '';
  const top = d.screeningPackageId ?? d.packageId ?? d.requestedPackageId;
  if (top != null && String(top).trim()) return String(top).trim();
  const def = d.defaults as Record<string, unknown> | undefined;
  if (def) {
    const v = def.screeningPackageId ?? def.packageId;
    if (v != null && String(v).trim()) return String(v).trim();
  }
  const od = d.orderDefaults as Record<string, unknown> | undefined;
  if (od && typeof od === 'object') {
    const v =
      (od as Record<string, unknown>).screeningPackageId ?? (od as Record<string, unknown>).packageId;
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

export function mergeScreeningPackageFromLayers(
  jobOrder: Record<string, unknown> | undefined,
  locationDefaults: Record<string, unknown> | undefined,
  account: Record<string, unknown> | undefined
): ScreeningPackageMergeResult {
  const jn = readPackageNameLayer(jobOrder);
  const ji = readPackageIdLayer(jobOrder);
  const ln = readPackageNameLayer(locationDefaults);
  const li = readPackageIdLayer(locationDefaults);
  const an = readPackageNameLayer(account);
  const ai = readPackageIdLayer(account);
  const packageName = jn || ln || an;
  const packageId = ji || li || ai;
  return {
    packageName,
    packageId,
    nameSource: jn ? 'job_order' : ln ? 'location_defaults' : an ? 'account' : null,
    idSource: ji ? 'job_order' : li ? 'location_defaults' : ai ? 'account' : null,
  };
}

export function screeningLocationKeyCandidates(
  jobOrderData: Record<string, unknown>,
  accountId: string,
  locationId: string,
  companyId: string
): string[] {
  return [
    typeof jobOrderData.locationKey === 'string' ? jobOrderData.locationKey : '',
    accountId && locationId ? `${accountId}_${locationId}` : '',
    companyId && locationId ? `${companyId}_${locationId}` : '',
  ].filter(Boolean);
}

/**
 * **R.10** — Default number of days a completed background check stays
 * "satisfied" before the daily expiry sweep flips its readiness items to
 * `'expired'`. Overridable per-Account via
 * `RecruiterAccount.orderDefaults.screeningValidityDays`, per-Location via
 * `location_defaults.screeningValidityDays`, and per-JobOrder via
 * top-level `screeningValidityDays`. See
 * `mergeScreeningValidityDaysFromLayers` for precedence.
 *
 * Pre-R.10 this exported as `PLACEHOLDER_SCREENING_VALIDITY_DAYS`. The old
 * name is kept as a deprecated re-export for one cycle so any in-flight
 * branches don't break — new code should import `DEFAULT_SCREENING_VALIDITY_DAYS`.
 */
export const DEFAULT_SCREENING_VALIDITY_DAYS = 365;

/** @deprecated R.10 — use `DEFAULT_SCREENING_VALIDITY_DAYS`. */
export const PLACEHOLDER_SCREENING_VALIDITY_DAYS = DEFAULT_SCREENING_VALIDITY_DAYS;

/**
 * **R.10** — Resolve `screeningValidityDays` from the same JO → Location →
 * Account cascade as `mergeScreeningPackageFromLayers`. Defaults to
 * `DEFAULT_SCREENING_VALIDITY_DAYS` (365) when nothing is set.
 *
 * Precedence (highest first): job_order → location_defaults → account → default.
 *
 * Account / Location read from `orderDefaults.screeningValidityDays` to match
 * how `screeningPackageId` and `screeningPackageName` cascade. JobOrder reads
 * top-level `screeningValidityDays` to match how `screeningPackageId` is
 * exposed on JOs.
 *
 * Validation: any non-finite, non-positive, or non-integer value is ignored
 * and falls through to the next layer. This guards against ops accidents
 * (e.g. `0`, `-30`, `"365"`, `NaN`) silently disabling expiry.
 */
export interface ScreeningValidityDaysMergeResult {
  validityDays: number;
  source: 'job_order' | 'location_defaults' | 'account' | 'default';
}

function readScreeningValidityDaysFromOrderDefaults(
  layer: Record<string, unknown> | undefined,
): number | null {
  if (!layer) return null;
  const od = layer.orderDefaults as Record<string, unknown> | undefined;
  if (!od || typeof od !== 'object') return null;
  return coerceValidityDays(od.screeningValidityDays);
}

function readScreeningValidityDaysTopLevel(
  layer: Record<string, unknown> | undefined,
): number | null {
  if (!layer) return null;
  return coerceValidityDays(layer.screeningValidityDays);
}

function coerceValidityDays(raw: unknown): number | null {
  if (typeof raw !== 'number') return null;
  if (!Number.isFinite(raw)) return null;
  if (raw <= 0) return null;
  if (!Number.isInteger(raw)) return null;
  return raw;
}

export function mergeScreeningValidityDaysFromLayers(
  jobOrder: Record<string, unknown> | undefined,
  locationDefaults: Record<string, unknown> | undefined,
  account: Record<string, unknown> | undefined,
): ScreeningValidityDaysMergeResult {
  const jo = readScreeningValidityDaysTopLevel(jobOrder);
  if (jo != null) return { validityDays: jo, source: 'job_order' };
  const loc = readScreeningValidityDaysFromOrderDefaults(locationDefaults);
  if (loc != null) return { validityDays: loc, source: 'location_defaults' };
  const acc = readScreeningValidityDaysFromOrderDefaults(account);
  if (acc != null) return { validityDays: acc, source: 'account' };
  return { validityDays: DEFAULT_SCREENING_VALIDITY_DAYS, source: 'default' };
}

export type BgLike = {
  orderCompleted?: boolean;
  hrxStatus?: string | null;
  requestedPackageId?: string | number | null;
  requestedPackageName?: string | null;
  updatedAt?: admin.firestore.Timestamp | null;
  createdAt?: admin.firestore.Timestamp | null;
  /** R.10 — `true` once the daily sweep has stamped the check as expired. */
  expired?: boolean | null;
};

// ─────────────────────────────────────────────────────────────────────────
// **R.11** — Screening package drift detection helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * **R.11** — Classification result from `classifyServiceSetDrift`.
 *
 * Drift is decided by comparing the new package's `serviceIds` (from the
 * AccuSource catalog at JO write time) against the in-flight check's
 * stamped `requestedServices`.
 *
 *   - `'less_strict'`: every service in the new package is already covered
 *     by the existing check (`newServiceIds ⊆ oldServiceIds`). Skip — the
 *     existing check already exceeds what's now required. **Per L3.R11:
 *     don't stamp drift; log info only.**
 *   - `'more_strict'`: new package adds at least one service the existing
 *     check doesn't cover. **Stamp drift.**
 *   - `'incomparable'`: service-set comparison was not possible — legacy
 *     check missing `requestedServices`, catalog miss on new package, or
 *     either side is null/empty. **Stamp drift conservatively per L3.R11
 *     fail-safe-in-the-visible-direction policy.**
 *
 * @see docs/READINESS_R11_HANDOFF.md L3.R11
 */
export type ServiceSetDriftKind = 'less_strict' | 'more_strict' | 'incomparable';

export interface ServiceSetDriftResult {
  kind: ServiceSetDriftKind;
  /** Human-readable explanation suitable for logs / audit. */
  reason: string;
  /** Service ids in the new package that the existing check does NOT cover. Non-empty only when `kind === 'more_strict'`. */
  missingFromExisting: string[];
  /** Service ids in the existing check that the new package does NOT include. Informational; non-empty when new is a strict subset. */
  extraInExisting: string[];
}

/**
 * **R.11** — Pure decision unit. Compares the new package's service ids
 * (from the catalog) against the existing check's `requestedServices`.
 *
 * **Known V1 limitation (worth a code comment at the call site):** this
 * compares only `serviceId`, not jurisdictional scope or search depth.
 * Same `serviceId` can mean different counties or scopes. False-positive
 * on jurisdictional change → CSA acknowledges, no automation harm.
 * False-negative on jurisdictional reduction is the mirror case. Track as
 * R.11.2 follow-up if production data shows it matters. See
 * `docs/READINESS_R11_HANDOFF.md` § "Deferred to follow-up".
 *
 * Order-independent (operates on sets). Idempotent. No I/O.
 */
export function classifyServiceSetDrift(
  newServiceIds: ReadonlyArray<string> | null | undefined,
  existingServiceIds: ReadonlyArray<string> | null | undefined,
): ServiceSetDriftResult {
  // Reject null/undefined and empty inputs as incomparable. An empty
  // `existingServiceIds` typically means a legacy check ordered before
  // `requestedServices` was being stamped (or stamping failed); we can't
  // know what the older check covers, so fail-safe to drift detection.
  // An empty `newServiceIds` typically means a catalog miss on the new
  // package id; we can't know what the new package wants either.
  const oldClean = sanitizeServiceIds(existingServiceIds);
  const newClean = sanitizeServiceIds(newServiceIds);

  if (oldClean === null) {
    return {
      kind: 'incomparable',
      reason:
        'Existing check has no requestedServices stamped (likely a pre-stamping legacy order). Cannot determine if older package covers the new package.',
      missingFromExisting: [],
      extraInExisting: [],
    };
  }
  if (newClean === null) {
    return {
      kind: 'incomparable',
      reason:
        'New package has no serviceIds resolvable from the AccuSource catalog (catalog miss or empty package). Cannot compare service sets.',
      missingFromExisting: [],
      extraInExisting: [],
    };
  }

  // Both sides have service-id sets. Compute set difference: services in
  // the new package that the existing check does NOT cover.
  const oldSet = new Set(oldClean);
  const missingFromExisting = newClean.filter((id) => !oldSet.has(id));

  if (missingFromExisting.length === 0) {
    // newServiceIds ⊆ oldServiceIds — existing check covers everything
    // the new package wants. Mirror direction for informational logging:
    // does the existing check have services the new package drops?
    const newSet = new Set(newClean);
    const extraInExisting = oldClean.filter((id) => !newSet.has(id));
    return {
      kind: 'less_strict',
      reason:
        extraInExisting.length === 0
          ? 'Service sets are equal (no drift). Likely a JO re-save with the same package or an equivalent rename.'
          : `New package is a strict subset of existing check (existing covers ${extraInExisting.length} additional service(s) the new package drops). No CSA action required.`,
      missingFromExisting: [],
      extraInExisting,
    };
  }

  // newServiceIds ⊄ oldServiceIds — at least one new service is not
  // covered by the existing check. Real drift.
  return {
    kind: 'more_strict',
    reason: `New package adds ${missingFromExisting.length} service(s) not covered by the existing check: [${missingFromExisting.join(', ')}].`,
    missingFromExisting,
    extraInExisting: [],
  };
}

function sanitizeServiceIds(
  raw: ReadonlyArray<string> | null | undefined,
): string[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw)) return null;
  const trimmed = raw
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter((s) => s.length > 0);
  if (trimmed.length === 0) return null;
  // Dedupe — a poorly-constructed catalog row with duplicate ids
  // shouldn't change the comparison.
  return Array.from(new Set(trimmed));
}

/**
 * **R.11** — Per-trigger memoized reader for the AccuSource catalog
 * package → serviceIds lookup.
 *
 * The catalog lives at the singleton path `integrations_accusource/catalog`
 * (see `integrations/accusource/syncPackageCatalog.ts`
 * `ACCUSOURCE_CATALOG_DOC_PATH`). Shape: `{ packages: Array<{id, serviceIds[], ...}>, ... }`.
 *
 * Reads the catalog doc at most once per trigger invocation. Returns null
 * when the package id is missing from the catalog or when the catalog
 * itself can't be loaded — caller treats null as `'incomparable'` per L3.R11.
 *
 * **Why a class** (not a closure): the cache is bound to the trigger
 * lifecycle, so creating a fresh instance per `onJobOrderWriteDetectScreeningPackageDrift`
 * invocation makes the lifecycle explicit. Across function instances, GC
 * naturally clears state.
 */
export class AccusourceCatalogPackageServiceCache {
  private packagesById: Map<string, string[]> | null = null;
  private loadAttempted = false;
  /** Total catalog reads performed by this cache (0 or 1 in practice). */
  public readsPerformed = 0;

  /** @returns `serviceIds[]` for the package, or `null` when missing/unloadable. */
  async getServiceIdsForPackage(
    fdb: admin.firestore.Firestore,
    packageId: string | null | undefined,
  ): Promise<string[] | null> {
    const pid = typeof packageId === 'string' ? packageId.trim() : '';
    if (!pid) return null;

    if (!this.loadAttempted) {
      this.loadAttempted = true;
      this.readsPerformed++;
      try {
        // String-literal here so the cache file is independent of the
        // accusource integration package's ACCUSOURCE_CATALOG_DOC_PATH
        // export — we don't want a circular import between compliance and
        // integrations/accusource.
        const snap = await fdb.doc('integrations_accusource/catalog').get();
        if (snap.exists) {
          const data = snap.data() as Record<string, unknown> | undefined;
          this.packagesById = buildPackageServiceIdMap(data);
        } else {
          this.packagesById = new Map();
        }
      } catch {
        // Catalog read failure → treat all subsequent lookups as misses
        // (`incomparable`). Conservative per L3.R11.
        this.packagesById = new Map();
      }
    }

    return this.packagesById?.get(pid) ?? null;
  }
}

function buildPackageServiceIdMap(
  catalogData: Record<string, unknown> | undefined,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!catalogData) return out;
  const packages = catalogData.packages;
  if (!Array.isArray(packages)) return out;
  for (const row of packages) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id.trim() : '';
    if (!id) continue;
    const serviceIds = sanitizeServiceIds(r.serviceIds as ReadonlyArray<string> | undefined);
    out.set(id, serviceIds ?? []);
  }
  return out;
}

function timestampToMillis(ts: unknown): number | null {
  if (ts == null) return null;
  if (ts instanceof Timestamp) {
    try {
      return ts.toMillis();
    } catch {
      return null;
    }
  }
  return null;
}

export function screeningEquivalencyKeyFromRecord(r: BgLike): string {
  const id = r.requestedPackageId != null ? String(r.requestedPackageId).trim() : '';
  if (id) return `id:${id}`;
  const name = String(r.requestedPackageName || '').trim().toLowerCase();
  if (name) return `name:${name}`;
  return 'unknown';
}

export function requestedEquivalencyKey(packageId: string, packageName: string): string {
  const pid = String(packageId || '').trim();
  if (pid) return `id:${pid}`;
  const pn = String(packageName || '').trim().toLowerCase();
  if (pn) return `name:${pn}`;
  return 'unknown';
}

export interface ScreeningSatisfiedEvaluation {
  satisfied: boolean;
  equivalencyKey: string;
  expiresAtMs: number | null;
  /** Plain-language reason for operators / disputes (audit trail). */
  decisionDetail: string;
}

export function evaluateScreeningSatisfiedServer(
  r: BgLike,
  opts?: {
    requestedEquivalencyKey?: string;
    enforceEquivalency?: boolean;
    enforceValidityWindow?: boolean;
    /**
     * **R.10** — Resolved validity threshold (in days) from
     * `mergeScreeningValidityDaysFromLayers`. When omitted, falls back to
     * `DEFAULT_SCREENING_VALIDITY_DAYS` (365) — preserves pre-R.10
     * behavior for callers that haven't been updated.
     */
    validityDays?: number;
  }
): ScreeningSatisfiedEvaluation {
  const equivalencyKey = screeningEquivalencyKeyFromRecord(r);
  const completedMs = timestampToMillis(r.updatedAt) ?? timestampToMillis(r.createdAt) ?? null;

  const statusSatisfied =
    !!r.orderCompleted || r.hrxStatus === 'completed' || r.hrxStatus === 'report_ready';

  if (!statusSatisfied) {
    return {
      satisfied: false,
      equivalencyKey,
      expiresAtMs: null,
      decisionDetail: `Not satisfied: order not in a completed state (hrxStatus=${String(r.hrxStatus ?? 'null')}, orderCompleted=${Boolean(r.orderCompleted)}; need completed|report_ready or orderCompleted).`,
    };
  }

  if (opts?.enforceEquivalency && opts.requestedEquivalencyKey) {
    if (equivalencyKey !== opts.requestedEquivalencyKey) {
      return {
        satisfied: false,
        equivalencyKey,
        expiresAtMs: null,
        decisionDetail: `Not satisfied: package equivalency mismatch — existing order key "${equivalencyKey}" does not equal required resolved key "${opts.requestedEquivalencyKey}".`,
      };
    }
  }

  const validityDays = coerceValidityDays(opts?.validityDays) ?? DEFAULT_SCREENING_VALIDITY_DAYS;
  const expiresAtMs =
    completedMs != null ? completedMs + validityDays * 86_400_000 : null;

  if (opts?.enforceValidityWindow && expiresAtMs != null && Date.now() > expiresAtMs) {
    return {
      satisfied: false,
      equivalencyKey,
      expiresAtMs,
      decisionDetail: `Not satisfied: outside validity window of ${validityDays}d (expiresAtMs=${expiresAtMs}).`,
    };
  }

  return {
    satisfied: true,
    equivalencyKey,
    expiresAtMs,
    decisionDetail: `Satisfied: status is complete/report-ready, package key "${equivalencyKey}" matches required "${opts?.requestedEquivalencyKey ?? equivalencyKey}", within ${validityDays}d validity.`,
  };
}

export function packageFingerprint(packageName: string, packageId: string): string {
  return `${String(packageName || '').trim()}|${String(packageId || '').trim()}`;
}

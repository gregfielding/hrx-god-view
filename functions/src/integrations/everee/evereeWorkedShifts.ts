/**
 * Everee Timesheets API — typed wrappers for the worked-shifts surface.
 *
 * **Path prefix**: `/integration/v1/labor/...` (NOT `/api/v2/`). The
 * `evereeRequest` helper is path-agnostic; callers pass the full path.
 *
 * **What lives here vs. what doesn't**:
 *
 *   - **Here**: thin HTTP shape adapters — input/output types, the
 *     `?correction-authorized=true` query toggle, and the endpoint URLs.
 *     No business logic, no Firestore reads, no Cloud Tasks orchestration.
 *   - **Not here**: deciding whether a given entry should be POST vs PUT
 *     (that's idempotency state on `timesheet_entries.everee.workedShiftId`),
 *     composing `fullyClassifiedHours[]` from a `DayBreakdown` (that's
 *     the orchestrator), or invoking the rate-limit retry (transparent
 *     inside `evereeRequest`).
 *
 * **Idempotency** for worked shifts is server-assigned, not
 * client-deterministic. The Everee response includes `workedShiftId`;
 * the orchestrator stores it on `timesheet_entries.everee.workedShiftId`
 * and uses {@link updateWorkedShift} on retry (with
 * `correctionAuthorized: true` when needed).
 *
 * **Bulk vs default path** — the **default path is `createWorkedShift`
 * with `fullyClassifiedHours[]`**, which preserves break detail (CA pay-
 * stub compliance) and maps 1:1 to a `TimesheetEntryV2`. The
 * `bulkUpdateClassifiedHours` endpoint is the fallback for company
 * instances without Fully Classified Shifts enabled, OR for pay-period-
 * aggregated submissions where break detail isn't available. All three
 * C1 instances have Fully Classified Shifts enabled per Everee's
 * 2026-05-07 confirmation, so the default path is what we use.
 *
 * See also: `timesheet-build-plan-addendum-phase4.md` §4 — exact wire
 * shapes the spec is derived from.
 */

import { logger } from 'firebase-functions/v2';

import { evereeRequest } from './evereeHttp';
import type { EvereeEntityConfig } from './evereeConfig';

// ─────────────────────────────────────────────────────────────────────
// Common value types
// ─────────────────────────────────────────────────────────────────────

/**
 * Everee money objects always wrap an amount as a STRING (decimal,
 * never float) plus a 3-letter currency. Storing the amount as string
 * dodges JS float precision artifacts on the wire — the orchestrator
 * formats numeric values via `.toFixed(2)` before construction.
 */
export interface EvereeMoney {
  amount: string;
  currency: 'USD';
}

/**
 * Fully-classified hour segments emitted on the create/update body.
 * Everee's worked-shifts enum collapses FLSA and non-FLSA OT to a
 * single `OVERTIME` value — the split only matters on the bulk
 * fallback endpoint (see {@link BulkClassifiedHoursPerWorker} below).
 */
export interface EvereeFullyClassifiedHoursSegment {
  type: 'REGULAR_TIME' | 'OVERTIME' | 'DOUBLE_TIME';
  startEpochSeconds: number;
  endEpochSeconds: number;
  hourlyPayRate: EvereeMoney;
  grossPayAmount: EvereeMoney;
}

/**
 * Break segment emitted on the create/update body. `segmentConfigCode`
 * is one of Everee's configured break codes — `DEFAULT_UNPAID` covers
 * the standard meal/rest break case; custom codes can be created for
 * paid-break variants but aren't in scope for C1's flow.
 */
export interface EvereeWorkedShiftBreak {
  segmentConfigCode: string;
  breakStartEpochSeconds: number;
  breakEndEpochSeconds: number;
}

// ─────────────────────────────────────────────────────────────────────
// Default path — worked shifts (per-entry)
// ─────────────────────────────────────────────────────────────────────

/**
 * Input shape for {@link createWorkedShift} and {@link updateWorkedShift}.
 *
 * Most fields are mandatory. `displayHourlyPayRate` is what shows on the
 * worker's pay stub (rare to differ from `effectiveHourlyPayRate` —
 * occasional weighted-average cases). `overrideWorkLocationId` overrides
 * the worker's default location for this shift (used when a worker
 * picked up a shift at a different site). `workersCompClassCode` is the
 * cascade-resolved JO-level code; the orchestrator's pre-flight fails
 * fast when this is missing on any entry.
 */
export interface CreateWorkedShiftInput {
  externalWorkerId: string;
  shiftStartEpochSeconds: number;
  shiftEndEpochSeconds: number;
  effectiveHourlyPayRate: EvereeMoney;
  displayHourlyPayRate?: EvereeMoney;
  overrideWorkLocationId?: number;
  workersCompClassCode?: string;
  createBreaks?: EvereeWorkedShiftBreak[];
  /** Required when Fully Classified Shifts is enabled on the instance
   *  (which it is for all C1 instances per 2026-05-07 Everee confirmation).
   *  Without this, Everee re-classifies hours by its own engine, which
   *  diverges from our multistate rules for CA / NY edge cases. */
  fullyClassifiedHours?: EvereeFullyClassifiedHoursSegment[];
  note?: string;
}

/**
 * Server-assigned response after a successful POST. `raw` is preserved
 * for debug: Everee occasionally returns extra fields (audit ids, etc.)
 * we don't strictly need but want to log.
 */
export interface CreateWorkedShiftResult {
  workedShiftId: number;
  raw: unknown;
}

/**
 * Everee serializes `workedShiftId` as a JSON STRING ("4071156"), not a
 * number — confirmed by live probe 2026-08-13 (list items + single GET
 * both carry the string form; every POST since Phase 4 parsed to 0 under
 * the old number-only check). Accepts either form.
 */
export function parseWorkedShiftId(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) {
    const n = Number(v.trim());
    if (n > 0) return n;
  }
  return 0;
}

/**
 * POST a new worked shift. The orchestrator stores the returned
 * `workedShiftId` on `timesheet_entries.everee.workedShiftId` for
 * future PUT idempotency.
 */
export async function createWorkedShift(
  config: EvereeEntityConfig,
  input: CreateWorkedShiftInput,
  opts?: { correctionAuthorized?: boolean },
): Promise<CreateWorkedShiftResult> {
  // `correction-authorized=true` is required when the shift's pay period
  // is already closed/posted on Everee's side. Without it Everee returns:
  //   "This shift can no longer be modified because it is included in a
  //    payment that is already approved, submitted, or paid."
  // (2026-06-05 Cheneana 5/19 case). The flag accepts the POST as a
  // correction into the next pay run.
  const base = '/integration/v1/labor/timesheet/worked-shifts';
  const path = opts?.correctionAuthorized ? `${base}?correction-authorized=true` : base;
  const raw = await evereeRequest<
    { workedShiftId?: number | string; id?: number | string } & Record<string, unknown>
  >(config, 'POST', path, input);
  const workedShiftId = parseWorkedShiftId(raw?.workedShiftId) || parseWorkedShiftId(raw?.id);
  if (!workedShiftId) {
    // A zero id silently breaks every downstream void/revert/PUT-retry —
    // surface the actual body so a future shape change is caught in logs,
    // not months later in a stuck void (2026-08-13 Zaon Cox).
    logger.warn('[createWorkedShift] response had no parseable workedShiftId', { raw });
  }
  return { workedShiftId, raw };
}

/**
 * PUT update for an existing worked shift. Pass `correctionAuthorized:
 * true` when the prior pay run has already been paid — Everee will then
 * accept the change and produce a correction payable in the next run.
 */
export async function updateWorkedShift(
  config: EvereeEntityConfig,
  workedShiftId: number,
  input: CreateWorkedShiftInput,
  opts?: { correctionAuthorized?: boolean },
): Promise<CreateWorkedShiftResult> {
  const base = `/integration/v1/labor/timesheet/worked-shifts/${workedShiftId}`;
  const path = opts?.correctionAuthorized ? `${base}?correction-authorized=true` : base;
  const raw = await evereeRequest<
    { workedShiftId?: number | string; id?: number | string } & Record<string, unknown>
  >(config, 'PUT', path, input);
  const returnedId =
    parseWorkedShiftId(raw?.workedShiftId) || parseWorkedShiftId(raw?.id) || workedShiftId;
  return { workedShiftId: returnedId, raw };
}

/**
 * One item from the worked-shifts LIST endpoint. Only the fields the
 * recovery/backfill matchers read are typed; the wire object is much
 * larger (nested worker, durations, payableDetails, …).
 */
export interface WorkedShiftListItem {
  /** String on the wire — run through {@link parseWorkedShiftId}. */
  workedShiftId?: number | string;
  externalWorkerId?: string;
  /** Everee's own worker id (uuid) — NOT the HRX uid. */
  workerId?: string;
  /** ISO-8601 with the shift's local offset, e.g. "2026-07-20T14:00:00-04:00" —
   *  the leading 10 chars are the shift's local work date. */
  shiftStartAt?: { effectivePunchAt?: string };
  shiftEndAt?: { effectivePunchAt?: string };
  note?: string;
  [key: string]: unknown;
}

export interface ListWorkedShiftsResult {
  items: WorkedShiftListItem[];
  totalItems: number;
  totalPages: number;
  pageNumber: number;
}

/**
 * GET the worked shifts for one worker (paged). Unlike `/payments`, this
 * endpoint DOES honor the `external-worker-id` filter (verified in the
 * 2026-08-13 Zaon Cox repair). Used to recover a shift id when a status
 * doc recorded 0 (pre-parse-fix submissions) — match on local work date
 * plus the note prefix.
 */
export async function listWorkedShifts(
  config: EvereeEntityConfig,
  params: { externalWorkerId: string; pageNumber?: number; pageSize?: number },
): Promise<ListWorkedShiftsResult> {
  const qs = new URLSearchParams({
    'external-worker-id': params.externalWorkerId,
    size: String(params.pageSize ?? 100),
    page: String(params.pageNumber ?? 0),
  });
  const raw = await evereeRequest<Record<string, unknown>>(
    config,
    'GET',
    `/integration/v1/labor/timesheet/worked-shifts?${qs.toString()}`,
  );
  return {
    items: Array.isArray(raw?.items) ? (raw.items as WorkedShiftListItem[]) : [],
    totalItems: Number(raw?.totalItems ?? 0),
    totalPages: Number(raw?.totalPages ?? 0),
    pageNumber: Number(raw?.pageNumber ?? 0),
  };
}

/**
 * DELETE a worked shift. `correctionAuthorized: true` when the prior
 * pay run has already been paid.
 */
export async function deleteWorkedShift(
  config: EvereeEntityConfig,
  workedShiftId: number,
  opts?: { correctionAuthorized?: boolean },
): Promise<void> {
  const base = `/integration/v1/labor/timesheet/worked-shifts/${workedShiftId}`;
  const path = opts?.correctionAuthorized ? `${base}?correction-authorized=true` : base;
  await evereeRequest<void>(config, 'DELETE', path);
}

// ─────────────────────────────────────────────────────────────────────
// Fallback path — classified hours, bulk
// ─────────────────────────────────────────────────────────────────────

/**
 * One classified hours segment within a bulk submission. Exactly ONE
 * of the four hour fields should be set per object — Everee's API
 * doesn't validate that constraint server-side, but mixed entries
 * produce undefined classification on the pay stub.
 *
 * The FLSA / non-FLSA split here is what makes the bulk endpoint
 * different from the default — `fullyClassifiedHours[]` on the default
 * path collapses both to plain `OVERTIME`. The recompute trigger
 * already produces both fields on `TimesheetEntryV2` (TS.1.P2.C), so
 * the wire mapping is just field selection.
 */
export interface BulkClassifiedHoursSegment {
  payRate: EvereeMoney;
  workLocationId?: string;
  workersCompClassCode?: string;
  /** EXACTLY ONE of these four should be set per segment. */
  regularHoursWorked?: string;
  flsaQualifiedOvertimeHoursWorked?: string;
  nonFlsaQualifiedOvertimeHoursWorked?: string;
  doubleTimeHoursWorked?: string;
}

export interface BulkClassifiedHoursPerWorker {
  externalWorkerId: string;
  classifiedHours: BulkClassifiedHoursSegment[];
}

/**
 * Input to {@link bulkUpdateClassifiedHours}. `earningDate` is any date
 * in the pay period — Everee uses it to bucket the submission to the
 * correct period. `correctionPaymentTimeframe` controls how Everee
 * settles a difference vs. previously-submitted hours for the same
 * worker × period.
 */
export interface BulkUpdateClassifiedHoursInput {
  earningDate: string;
  classifiedHoursPerWorker: BulkClassifiedHoursPerWorker[];
  correctionPaymentTimeframe?: 'NEXT_PAYROLL_PAYMENT' | 'IMMEDIATELY' | 'EXTERNALLY_PAID';
}

/**
 * POST a bulk classified-hours payload. Synchronize-by-replace semantics
 * — re-running the same payload yields the same final state (no
 * double-counting). Max 200 workers per call per Everee docs; the
 * orchestrator pages above that.
 *
 * **Used as a fallback only.** Prefer {@link createWorkedShift} on the
 * default path for break-detail compliance. This endpoint is reserved
 * for instances without Fully Classified Shifts enabled.
 */
export async function bulkUpdateClassifiedHours(
  config: EvereeEntityConfig,
  input: BulkUpdateClassifiedHoursInput,
  opts?: { correctionAuthorized?: boolean },
): Promise<unknown> {
  const base = '/integration/v1/labor/classified-hours/bulk';
  const path = opts?.correctionAuthorized ? `${base}?correction-authorized=true` : base;
  return evereeRequest<unknown>(config, 'POST', path, input);
}

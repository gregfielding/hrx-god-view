/**
 * Everee Payables API — typed wrappers for tips, bonuses, penalties,
 * contractor pay, and other non-hourly W-2 amounts.
 *
 * **Path prefix**: `/api/v2/payables/...`. Different surface from the
 * Timesheets API (worked shifts) — hourly W-2 wages do NOT go here;
 * they go through {@link evereeWorkedShifts}.
 *
 * **What goes here vs. worked-shifts:**
 *
 *   - **Payables**: tips, bonuses, CA meal/rest premiums, 1099
 *     contractor gross, reimbursements, mileage, per-diem, holiday/
 *     vacation/sick lump sums.
 *   - **Worked shifts**: hourly W-2 wages (regular / OT / DT — with
 *     classified hour segments). Corrections to hourly hours go
 *     through the Timesheets API's `correction-authorized=true` —
 *     NOT through Payables.
 *
 * **Idempotency via `externalId`.** Every payable carries a deterministic
 * external id we choose (no UUIDs, no timestamps — must reproduce on
 * retry). See addendum §7 for the pattern. Re-running the orchestrator
 * with the same `externalId` is safe — Everee dedupes server-side.
 *
 * **Pay codes** are the standard `earningTypes` enum (see {@link
 * EvereeStandardEarningType}) plus two C1-specific custom codes for
 * CA §226.7 break premiums. The custom codes need provisioning per
 * company instance via {@link evereePayCodes.ensureCustomPayCode}
 * (Slice 3) — confirmed by Everee 2026-05-07 that they should be
 * taxable wage codes, not bonus codes.
 *
 * **The `requestPayablePayout` endpoint is filter-based, not id-based.**
 * Re-calling it with the same filter is safe; Everee dedupes against
 * already-paid externalIds internally. The orchestrator calls it once
 * after all per-entry payables have landed, with
 * `includeWorkersOnRegularPayCycle: false` so staffing workers don't
 * get folded into the regular weekly W-2 run.
 *
 * See also: `timesheet-build-plan-addendum-phase4.md` §5–§7 — exact
 * wire shapes the spec is derived from.
 */

import { evereeRequest } from './evereeHttp';
import type { EvereeEntityConfig } from './evereeConfig';
import type { EvereeMoney } from './evereeWorkedShifts';

// ─────────────────────────────────────────────────────────────────────
// Pay code enum
// ─────────────────────────────────────────────────────────────────────

/**
 * Standard `earningTypes` per Everee docs — present on every company
 * instance by default. No provisioning needed.
 */
export type EvereeStandardEarningType =
  // Hourly W-2 — NOTE: these route through the Timesheets API,
  // not Payables. Listed here for completeness of the enum.
  | 'REGULAR_HOURLY'
  | 'OVERTIME_HOURLY'
  | 'DOUBLE_TIME_HOURLY'
  // 1099 contractor
  | 'CONTRACTOR'
  // Both / either
  | 'BONUS'
  | 'COMMISSION'
  | 'TIPS'
  | 'PER_DIEM'
  | 'REIMBURSEMENT'
  | 'MILEAGE'
  | 'HOLIDAY'
  | 'VACATION'
  | 'SICK'
  | 'ADVANCE'
  | 'SEPARATION'
  | 'EARNINGS_ON_DEMAND';

/**
 * Custom pay codes specific to C1. Provisioned via the one-shot
 * `provisionCustomPayCodes.ts` script (Slice 3) per Everee's
 * 2026-05-07 confirmation: taxable wage codes, not bonus codes, so
 * tax treatment matches the underlying hourly wages they supplement.
 */
export type EvereeCustomEarningType = 'MEAL_PREMIUM' | 'REST_PREMIUM';

export type EvereeEarningType = EvereeStandardEarningType | EvereeCustomEarningType;

// ─────────────────────────────────────────────────────────────────────
// Create / update payable
// ─────────────────────────────────────────────────────────────────────

/**
 * Input shape for {@link createPayable} and the per-item entries of
 * {@link bulkCreatePayables}.
 *
 * `externalId` is the dedup key — deterministic, globally unique within
 * the Everee company instance, reproducible on retry. The orchestrator
 * derives it from `{tenantId}::{assignmentId}::{workDate}::{KIND}`
 * (regular payables) or `{tenantId}::{adjustmentId}` (adjustments).
 *
 * `payableModel: 'PRE_CALCULATED'` is the only mode we use — Everee's
 * other modes auto-derive amount from unit rate / time which isn't
 * applicable to our use cases.
 *
 * `timestamp` is epoch seconds; should correspond to the work date
 * (not the submission time) so pay-stub date columns are accurate.
 */
export interface CreatePayableInput {
  externalId: string;
  externalWorkerId: string;
  label: string;
  type: string;
  payCode: EvereeEarningType;
  timestamp: number;
  amount: EvereeMoney;
  payableModel: 'PRE_CALCULATED';
  workLocationId?: number;
  unitRate?: EvereeMoney;
  unitCount?: number;
}

export interface CreatePayableResult {
  externalId: string;
  paymentStatus?: string;
  raw: unknown;
}

/**
 * POST a single payable. Returns the same `externalId` we sent plus
 * any `paymentStatus` Everee chose to surface synchronously (rare —
 * most status transitions arrive via the
 * `payment-payables.status-changed` webhook).
 */
export async function createPayable(
  config: EvereeEntityConfig,
  input: CreatePayableInput,
): Promise<CreatePayableResult> {
  const raw = await evereeRequest<Record<string, unknown>>(config, 'POST', '/api/v2/payables', input);
  return {
    externalId:
      typeof raw?.externalId === 'string' ? raw.externalId : input.externalId,
    paymentStatus: typeof raw?.paymentStatus === 'string' ? raw.paymentStatus : undefined,
    raw,
  };
}

/**
 * POST many payables atomically. **All-or-nothing** per Everee — if
 * any entry fails validation, none are created. Prefer the bulk
 * endpoint when submitting payables for many workers in one batch
 * (fewer round-trips, fewer rate-limit tokens consumed). Limited to
 * ~200 payables per call per the rate-limit window.
 */
export async function bulkCreatePayables(
  config: EvereeEntityConfig,
  payables: CreatePayableInput[],
): Promise<{ externalIds: string[]; raw: unknown }> {
  const raw = await evereeRequest<Record<string, unknown>>(
    config,
    'POST',
    '/api/v2/payables/bulk',
    { payables },
  );
  const externalIds = Array.isArray(raw?.externalIds)
    ? (raw.externalIds as unknown[]).filter((s): s is string => typeof s === 'string')
    : payables.map((p) => p.externalId);
  return { externalIds, raw };
}

/**
 * PUT update for an existing payable, keyed by `externalId`. Used by
 * the adjustment path when a recruiter retroactively edits a payable
 * before the pay run is paid.
 */
export async function updatePayable(
  config: EvereeEntityConfig,
  externalId: string,
  input: Omit<CreatePayableInput, 'externalId'>,
): Promise<unknown> {
  return evereeRequest<unknown>(
    config,
    'PUT',
    `/api/v2/payables/${encodeURIComponent(externalId)}`,
    input,
  );
}

/**
 * DELETE a payable by externalId. Used by the adjustment path when a
 * recruiter retracts a payable before the pay run is paid. Returns 204
 * on success (no body).
 */
export async function deletePayable(
  config: EvereeEntityConfig,
  externalId: string,
): Promise<void> {
  await evereeRequest<void>(
    config,
    'DELETE',
    `/api/v2/payables/${encodeURIComponent(externalId)}`,
  );
}

/**
 * GET a single payable by externalId. Used by the reconciler cron
 * (Slice 7) to verify state when a webhook may have been dropped.
 */
export async function getPayable(
  config: EvereeEntityConfig,
  externalId: string,
): Promise<unknown> {
  return evereeRequest<unknown>(
    config,
    'GET',
    `/api/v2/payables/${encodeURIComponent(externalId)}`,
  );
}

// ─────────────────────────────────────────────────────────────────────
// List + payment-request
// ─────────────────────────────────────────────────────────────────────

/**
 * Filter shape for {@link listPayables}. All filters are optional.
 * Everee uses kebab-case query params per their docs; the helper
 * translates from camelCase here.
 */
export interface ListPayablesFilter {
  externalIds?: string[];
  workerIds?: string[];
  externalWorkerIds?: string[];
  externalTypes?: string[];
  /** When omitted, Everee defaults to false — staffing pattern. */
  includeWorkersOnRegularPayCycle?: boolean;
  /** Inclusive lower bound, ISO date or epoch seconds per Everee. */
  startTimestamp?: string | number;
  endTimestamp?: string | number;
}

/**
 * GET payables matching filters. Used by the reconciler cron and ad-hoc
 * admin tools; the orchestrator itself doesn't list — it knows what it
 * just submitted.
 */
export async function listPayables(
  config: EvereeEntityConfig,
  filter: ListPayablesFilter = {},
): Promise<unknown> {
  const qs = buildPayablesQuery(filter);
  const path = qs ? `/api/v2/payables?${qs}` : '/api/v2/payables';
  return evereeRequest<unknown>(config, 'GET', path);
}

/**
 * Request payment for a filtered set of payables. Filter-based, not
 * id-based — re-calling is safe; Everee dedupes against already-paid
 * externalIds server-side.
 *
 * Called once at the end of a batch submission with
 * `includeWorkersOnRegularPayCycle: false` (the staffing default).
 */
export interface RequestPayablePayoutResult {
  id: number;
  payableCount: number;
  payableExternalIds: string[];
  createdAt: string;
  raw: unknown;
}

export async function requestPayablePayout(
  config: EvereeEntityConfig,
  filters?: ListPayablesFilter,
): Promise<RequestPayablePayoutResult> {
  const raw = await evereeRequest<Record<string, unknown>>(
    config,
    'POST',
    '/api/v2/payables/payment-request',
    filters ?? {},
  );
  return {
    id: typeof raw?.id === 'number' ? raw.id : 0,
    payableCount: typeof raw?.payableCount === 'number' ? raw.payableCount : 0,
    payableExternalIds: Array.isArray(raw?.payableExternalIds)
      ? (raw.payableExternalIds as unknown[]).filter((s): s is string => typeof s === 'string')
      : [],
    createdAt: typeof raw?.createdAt === 'string' ? raw.createdAt : '',
    raw,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────

function buildPayablesQuery(filter: ListPayablesFilter): string {
  const parts: string[] = [];
  const push = (key: string, value: unknown): void => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      for (const v of value) parts.push(`${key}=${encodeURIComponent(String(v))}`);
    } else {
      parts.push(`${key}=${encodeURIComponent(String(value))}`);
    }
  };
  push('external-ids', filter.externalIds);
  push('worker-ids', filter.workerIds);
  push('external-worker-ids', filter.externalWorkerIds);
  push('external-types', filter.externalTypes);
  push('include-workers-on-regular-pay-cycle', filter.includeWorkersOnRegularPayCycle);
  push('start-timestamp', filter.startTimestamp);
  push('end-timestamp', filter.endTimestamp);
  return parts.join('&');
}

// ─────────────────────────────────────────────────────────────────────
// External ID conventions (documented here for ergonomics — the
// orchestrator constructs the actual values).
// ─────────────────────────────────────────────────────────────────────

/**
 * The shape of every `externalId` used by the orchestrator. Documented
 * here so callers (and code reviewers) can validate without grepping
 * across files. See addendum §7 for the source spec.
 *
 *   Tips             — `{tenantId}::{assignmentId}::{workDate}::TIPS`
 *   Bonus            — `{tenantId}::{assignmentId}::{workDate}::BONUS`
 *   Meal premium     — `{tenantId}::{assignmentId}::{workDate}::MEAL_PREMIUM`
 *   Rest premium     — `{tenantId}::{assignmentId}::{workDate}::REST_PREMIUM`
 *   Contractor gross — `{tenantId}::{assignmentId}::{workDate}::CONTRACTOR`
 *   Adjustment       — `{tenantId}::{adjustmentId}`
 *
 * Deterministic per the addendum rules: no UUIDs, no timestamps, no
 * random. Re-running the orchestrator with the same inputs produces the
 * same externalIds — which is what makes the system idempotent
 * end-to-end.
 */
export type EvereePayableExternalIdKind =
  | 'TIPS'
  | 'BONUS'
  | 'MEAL_PREMIUM'
  | 'REST_PREMIUM'
  | 'CONTRACTOR';

export function buildPayableExternalId(args: {
  tenantId: string;
  assignmentId: string;
  workDate: string;
  kind: EvereePayableExternalIdKind;
}): string {
  return `${args.tenantId}::${args.assignmentId}::${args.workDate}::${args.kind}`;
}

export function buildAdjustmentExternalId(args: {
  tenantId: string;
  adjustmentId: string;
}): string {
  return `${args.tenantId}::${args.adjustmentId}`;
}

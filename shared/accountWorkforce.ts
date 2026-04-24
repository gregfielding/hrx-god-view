/**
 * Canonical Workforce domain model — Phase 1 data contract.
 *
 * An `AccountWorkforce` record is the durable, scope-local relationship between
 * a worker and a customer account. It answers "is this worker part of the
 * workforce for this account, and what's their standing?" independent of any
 * single shift's outcome.
 *
 * See `docs/WORKFORCE_DOMAIN_MODEL.md` §3 for the full contract. Update that
 * doc before widening this type.
 *
 * Runtime-neutral: no firebase imports, no Timestamp. Dates are ISO-8601
 * strings. Callers convert to Firestore Timestamp on write / from Timestamp
 * on read (same pattern as `actionItemOwnership.ts`).
 */

export const ACCOUNT_WORKFORCE_VERSION = 1;

/** Standing relationship state for a (account, worker) pair. */
export type AccountWorkforceStatus = 'active' | 'inactive';

/**
 * Fixed set of deactivation reasons exposed in the "Deactivate for this
 * account" dialog. Recruiters pick one; free-text context goes into
 * `deactivationNotes`. Do not add codes without updating the UI dropdown
 * and any rollup reporting in lockstep.
 */
export type AccountWorkforceDeactivationReason =
  /** Pattern of no-shows. */
  | 'no_show'
  /** Repeated early departures from shifts. */
  | 'left_early_repeat'
  /** Client/account explicitly asked us to remove or replace the worker. */
  | 'client_requested'
  /** Quality-of-work or behavior concerns not captured above. */
  | 'performance'
  /** Punctuality / reliability issues short of outright no-show. */
  | 'attendance'
  /** Violated account or HRX policy. */
  | 'policy'
  /** Worker asked to stop being placed at this account. */
  | 'worker_request'
  /** Fallback — the recruiter's reason didn't fit the above. `deactivationNotes` required. */
  | 'other';

/**
 * Structured safety-net flag written by the assignment trigger when a
 * `pending → confirmed` transition lands on an `inactive` AccountWorkforce
 * doc (see doc §3.4(4)). The primary defense against this state is the
 * ownership/placement gate — this blocker is what surfaces in the Inactive
 * view when that gate fails, so the recruiter can cancel the shift or
 * reactivate the worker.
 *
 * Cleared on reactivation, or when the recruiter resolves it via the
 * Inactive-view row actions.
 */
export type AccountWorkforceBlocker = {
  code: 'CONFIRMED_WHILE_INACTIVE';
  /** Assignment that confirmed while this record was inactive. */
  assignmentId: string;
  /** ISO-8601 timestamp of the confirm. */
  at: string;
};

/**
 * Denormalized engagement class copied from the account's hiring entity
 * at write time. The entity doc is authoritative
 * (`account.hiringEntityId → entity.engagementType`); this field exists
 * purely so queries like "all active 1099 workers across the tenant"
 * don't have to join through entities row by row.
 *
 * C1 Events → 1099. C1 Select and C1 Workforce → W2. A change to an
 * account's hiring entity triggers a backfill pass that rewrites this
 * field across every affected AccountWorkforce doc.
 */
export type AccountWorkforceEngagementType = 'w2' | '1099';

/**
 * Primary shape stored at `tenants/{tid}/account_workforce/{accountId}__{workerId}`.
 *
 * Contract:
 *   - Exactly one doc per (accountId, workerId) pair. Doc id is composite.
 *   - `accountId` is always a child or standalone account — never a
 *     national parent (doc §4.1). Parent views are computed unions.
 *   - `firstConfirmedAt` is stable once written — it records the first
 *     `pending → confirmed` transition this pair ever saw.
 *   - `lastShiftAt` and the `*Shifts` counters are maintained by the
 *     assignment trigger; they're for display, not logic.
 *   - Client code never writes this doc directly — all mutations flow
 *     through the callables / triggers in doc §6.
 */
export type AccountWorkforce = {
  tenantId: string;
  /** Child or standalone recruiter account that owns this workforce relationship. */
  accountId: string;
  /** `users/{uid}` id. */
  workerId: string;

  status: AccountWorkforceStatus;

  /** Denormalized cache from `account.hiringEntityId → entity.engagementType`. See type docs above. */
  engagementType?: AccountWorkforceEngagementType;

  /** ISO-8601. First `pending → confirmed` transition for this pair. Stable once set. */
  firstConfirmedAt: string;

  /** ISO-8601. Most recent shift date (any outcome) for this pair. */
  lastShiftAt?: string;

  /** Completed + left_early + no_show outcomes. Display only. */
  totalShifts?: number;
  /** Completed only. Display only. */
  completedShifts?: number;

  /** ===== Deactivation audit — set when status === 'inactive'. ===== */
  /** ISO-8601. */
  deactivatedAt?: string;
  /** `users/{uid}` — the recruiter who clicked Deactivate. */
  deactivatedBy?: string;
  deactivationReason?: AccountWorkforceDeactivationReason;
  deactivationNotes?: string;

  /** ===== Reactivation audit — set when most recent transition was inactive → active. ===== */
  /** ISO-8601. Cleared again on the next deactivation. */
  reactivatedAt?: string;
  reactivatedBy?: string;
  reactivationNotes?: string;

  /**
   * Structured safety-net flags. Append-only; cleared wholesale on
   * reactivation or when the recruiter resolves them.
   */
  blockers?: AccountWorkforceBlocker[];

  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601. */
  updatedAt: string;
};

/**
 * Deterministic composite id for an AccountWorkforce doc.
 * `${accountId}__${workerId}` — matches the double-underscore convention
 * already used by `entity_employments` and `everee_workers`. Stable,
 * directly addressable without a query.
 */
export function accountWorkforceDocId(accountId: string, workerId: string): string {
  const a = String(accountId || '').trim();
  const w = String(workerId || '').trim();
  if (!a || !w) {
    throw new Error('accountWorkforceDocId: accountId and workerId are required');
  }
  return `${a}__${w}`;
}

/** Split an AccountWorkforce doc id back into its parts. Returns null on malformed input. */
export function parseAccountWorkforceDocId(
  docId: string,
): { accountId: string; workerId: string } | null {
  const s = String(docId || '').trim();
  const idx = s.indexOf('__');
  if (idx <= 0 || idx >= s.length - 2) return null;
  const accountId = s.slice(0, idx).trim();
  const workerId = s.slice(idx + 2).trim();
  if (!accountId || !workerId) return null;
  return { accountId, workerId };
}

/**
 * Input shape for the `setAccountWorkforceStatus` callable. Mirrors doc
 * §6.2 — kept here so both the client and the callable can share the
 * same types without a circular dependency on the admin SDK.
 */
export type SetAccountWorkforceStatusInput = {
  tenantId: string;
  accountId: string;
  workerId: string;
  /** 'active' for reactivation, 'inactive' for deactivation. */
  nextStatus: AccountWorkforceStatus;

  /** Required when `nextStatus === 'inactive'`. */
  deactivationReason?: AccountWorkforceDeactivationReason;
  /** Optional when `nextStatus === 'inactive'`. Required when `reason === 'other'`. */
  deactivationNotes?: string;
  /**
   * Future confirmed assignments for this worker/account that the recruiter
   * chose to cancel as part of the deactivation. The callable transitions
   * each to `cancelled_business` atomically with the status flip.
   * Default UX: checkbox is on; recruiter can opt out.
   */
  cancelFutureAssignmentIds?: string[];

  /** Optional when `nextStatus === 'active'`. */
  reactivationNotes?: string;
};

/** Return shape from `setAccountWorkforceStatus`. */
export type SetAccountWorkforceStatusResult = {
  ok: true;
  accountWorkforceId: string;
  nextStatus: AccountWorkforceStatus;
  /** Number of assignments cancelled as part of the cascade. Zero on reactivation or when checkbox was off. */
  assignmentsCancelled: number;
};

/**
 * Denormalized entry maintained on `users.{uid}.inactiveAtAccounts[]` —
 * Phase 5b. Written by a trigger on `account_workforce` status changes.
 *
 * Purpose: Labor Pool search surfaces a quiet "Inactive at N account(s)"
 * chip on candidate rows. Without this cache, rendering it for a 500-row
 * pool would require 500 cross-collection joins. With it, the chip is a
 * direct field read on the user doc we already have in hand.
 *
 * Staleness: account name is stored at write time. An account rename is
 * rare enough that we live with one-pass lag — a future rename trigger
 * could sweep and rewrite if it ever matters.
 */
export type UserInactiveAtAccountEntry = {
  /** Child or standalone recruiter account id that deactivated this worker. */
  accountId: string;
  /** Human-readable account name at the moment of deactivation. */
  accountName: string;
  reason: AccountWorkforceDeactivationReason;
  /** ISO-8601. */
  deactivatedAt: string;
  /** Recruiter who deactivated. */
  deactivatedBy?: string;
};

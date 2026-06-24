/**
 * **§14b — Gig Job Order status auto-management cron.**
 *
 * Daily job that flips the status of auto-created gig JOs between
 * `'on_hold'` and `'open'` based on shift activity. Recruiters never
 * have to hand-manage the status of an auto-spawned gig JO — the cron
 * keeps it in sync with whether there's actually work scheduled.
 *
 * **Status rules (per Greg's spec, 2026-04-30):**
 *
 *   - `'open'`     ← at least one **active upcoming** shift on the JO
 *   - `'on_hold'`  ← no active upcoming shifts (default state)
 *
 * **"Active upcoming"** in this codebase (cross-checked against
 * `src/utils/shifts/shiftRow.ts:buildActiveRowMeta`):
 *
 *   - `status` is **not** `'cancelled'` or `'closed'`
 *     (i.e. status ∈ `['open', 'filled']`, the canonical Active set)
 *   - AND the shift's date window includes today or later:
 *     - single-day shifts: `shiftDate >= today`
 *     - multi-day shifts:  `(endDate || shiftDate) >= today`
 *
 * Career-mode multi-day shifts (`shiftMode === 'multi'` + JO
 * `jobType === 'career'`) are always Active in the UI, but this cron
 * only manages **gig** JOs so that branch never applies here.
 *
 * **Guards** — only auto-manage JOs that:
 *
 *   1. Have `autoCreatedFrom === 'autoCreateGigJobOrders'` (manual
 *      gig JOs keep their hand-set status — admins set it intentionally).
 *   2. Are NOT in a terminal state (`'cancelled'` / `'completed'` /
 *      `'filled'`). A recruiter who manually marks the JO terminal
 *      shouldn't have the cron fight them.
 *
 * **Concurrency / scaling**: at peak we expect ~50 auto-spawned gig
 * JOs per tenant. With a few dozen tenants that's a few hundred JOs
 * total. Each JO does one shift-subcollection read + one optional JO
 * doc update. Comfortable inside the 540s timeout.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { AUTO_CREATED_FROM_MARKER } from './gigJobOrderFromChildAccount';

if (!admin.apps.length) {
  admin.initializeApp();
}

const FieldValue = admin.firestore.FieldValue;

/**
 * Shift statuses we consider "active" for the cron's rollup. Mirrors
 * the inverse of the `'cancelled' | 'closed'` skip list in
 * `buildActiveRowMeta` — i.e. the statuses the Active dataset on
 * `/shifts` would actually display.
 *
 * Defensive: include common fuzzy variants we've seen on legacy/imported
 * shift docs. The match is `Set.has(status)` so an unknown status drops
 * the shift from the active rollup, which is the safer bias (false
 * `'on_hold'` is recoverable; false `'open'` advertises a JO that has
 * no real work).
 */
const ACTIVE_SHIFT_STATUSES: ReadonlySet<string> = new Set([
  'open',
  'filled',
  // Reasonable forward-compat: the shift types include 'confirmed'
  // semantics in the ApplicationAnswer flow even though the canonical
  // ShiftStatus enum is `'open' | 'closed' | 'filled' | 'cancelled'`.
  // Treating 'confirmed' as Active here is a no-op for current data
  // and a free-pass for the next status enum extension.
  'confirmed',
]);

/** JO statuses we never override — recruiter chose them intentionally. */
const TERMINAL_JO_STATUSES: ReadonlySet<string> = new Set([
  'cancelled',
  'canceled', // legacy spelling — the JobOrder enum uses single-l
  'completed',
  'filled',
]);

const LOG = {
  startedDay: 'gigJobOrderStatusCron: started',
  alreadyRanToday: 'gigJobOrderStatusCron: already ran today, skipping',
  tenantSummary: 'gigJobOrderStatusCron: tenant_summary',
  flipped: 'gig.status.auto_updated',
  finished: 'gigJobOrderStatusCron: finished',
  failed: 'gigJobOrderStatusCron: failed',
} as const;

// ─────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Format a Date as a `YYYY-MM-DD` ISO date string. Cron runs in UTC
 * (per the schedule config), so `today` here is the UTC date — same
 * semantics the gig shift queries use (shift `shiftDate` is a calendar
 * date string with no timezone).
 *
 * Per-tenant local time is on the deferred list — for v1, UTC-day is
 * close enough for daily cron purposes and avoids the per-tenant
 * timezone lookup on every run.
 */
export function todayUtcIso(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Pure decision: does this shift count as "active upcoming" for the
 * status rollup? Mirrors `buildActiveRowMeta` (gig branch) so the
 * cron's view of Active matches what the recruiter sees on `/shifts`.
 *
 * Exported for tests.
 */
export function isShiftActiveUpcoming(
  shift: Record<string, unknown>,
  todayIso: string,
): boolean {
  const status = typeof shift.status === 'string' ? shift.status : '';
  if (!ACTIVE_SHIFT_STATUSES.has(status)) return false;

  const startIso =
    typeof shift.shiftDate === 'string' ? shift.shiftDate : undefined;
  const endIso =
    typeof shift.endDate === 'string' ? shift.endDate : undefined;
  const shiftMode =
    typeof shift.shiftMode === 'string' ? shift.shiftMode : 'single';

  // Open shift = standing/rolling crew over a date range with no fixed daily
  // times. It's "active" while ongoing (no end date) or up through its end
  // date — its START date does NOT gate it (an ongoing open shift that began
  // yesterday must not flip the JO to on_hold).
  if (shift.shiftType === 'open') {
    return !endIso || endIso >= todayIso;
  }

  // Multi-day window: active if window-end >= today.
  // Single-day:       active if startIso >= today.
  // Missing dates:    drop (defensive — a gig JO can't really be
  //                   Active without a date; better to err `on_hold`).
  if (shiftMode === 'multi') {
    const compare = endIso || startIso;
    return Boolean(compare && compare >= todayIso);
  }
  return Boolean(startIso && startIso >= todayIso);
}

/**
 * Pure decision: given the current JO status + whether any active
 * upcoming shift exists, what should the status be after this cron
 * pass? Returns `null` to mean "leave it alone" (terminal status,
 * already-correct status, or unknown current status).
 *
 * Exported for tests.
 */
export function decideTargetStatus(
  currentStatus: unknown,
  hasActiveUpcoming: boolean,
): 'open' | 'on_hold' | null {
  const cur = typeof currentStatus === 'string' ? currentStatus : '';
  if (TERMINAL_JO_STATUSES.has(cur)) return null;
  const target = hasActiveUpcoming ? 'open' : 'on_hold';
  return cur === target ? null : target;
}

// ─────────────────────────────────────────────────────────────────────
// Per-tenant runner — exported for unit tests
// ─────────────────────────────────────────────────────────────────────

export interface RunGigStatusCronTenantSummary {
  tenantId: string;
  joScanned: number;
  joFlipped: number;
  joFlippedToOpen: number;
  joFlippedToOnHold: number;
  joSkippedTerminal: number;
  joSkippedSameStatus: number;
  joFailed: number;
}

/**
 * Run the status flip pass for a single tenant. Splits out from the
 * scheduled wrapper so tests can inject a fake Firestore + run a single
 * tenant in isolation.
 */
export async function runGigStatusCronForTenant(args: {
  db: admin.firestore.Firestore;
  tenantId: string;
  todayIso: string;
}): Promise<RunGigStatusCronTenantSummary> {
  const { db, tenantId, todayIso } = args;

  const summary: RunGigStatusCronTenantSummary = {
    tenantId,
    joScanned: 0,
    joFlipped: 0,
    joFlippedToOpen: 0,
    joFlippedToOnHold: 0,
    joSkippedTerminal: 0,
    joSkippedSameStatus: 0,
    joFailed: 0,
  };

  const gigJosSnap = await db
    .collection(`tenants/${tenantId}/job_orders`)
    .where('jobType', '==', 'gig')
    .where('autoCreatedFrom', '==', AUTO_CREATED_FROM_MARKER)
    .get();

  for (const joDoc of gigJosSnap.docs) {
    summary.joScanned += 1;
    try {
      const jo = joDoc.data();
      const currentStatus = jo.status;

      // We pre-screen on terminal status to avoid an unnecessary shift
      // subcollection read for JOs we can't update anyway.
      if (
        typeof currentStatus === 'string' &&
        TERMINAL_JO_STATUSES.has(currentStatus)
      ) {
        summary.joSkippedTerminal += 1;
        continue;
      }

      // Project doesn't carry a `collectionGroup('shifts')` index
      // (see `useActiveShifts.ts` docstring) — query the JO's own
      // shifts subcollection directly. Cheap: ≤ ~20 shifts per JO in
      // the worst case (one per location-day for a recurring schedule).
      const shiftsSnap = await db
        .collection(`tenants/${tenantId}/job_orders/${joDoc.id}/shifts`)
        .get();
      const hasActiveUpcoming = shiftsSnap.docs.some((shiftDoc) =>
        isShiftActiveUpcoming(shiftDoc.data() ?? {}, todayIso),
      );

      const target = decideTargetStatus(currentStatus, hasActiveUpcoming);
      if (target === null) {
        summary.joSkippedSameStatus += 1;
        continue;
      }

      await joDoc.ref.update({
        status: target,
        statusManagedBy: 'gigJobOrderStatusCron',
        statusManagedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      summary.joFlipped += 1;
      if (target === 'open') summary.joFlippedToOpen += 1;
      else summary.joFlippedToOnHold += 1;

      logger.info(LOG.flipped, {
        tenantId,
        jobOrderId: joDoc.id,
        fromStatus: currentStatus,
        toStatus: target,
        reason: hasActiveUpcoming
          ? 'has_active_upcoming_shift'
          : 'no_active_upcoming_shifts',
      });
    } catch (err) {
      summary.joFailed += 1;
      logger.warn('gigJobOrderStatusCron: jo_failed', {
        tenantId,
        jobOrderId: joDoc.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}

// ─────────────────────────────────────────────────────────────────────
// Scheduled function
// ─────────────────────────────────────────────────────────────────────

/**
 * Daily at 05:00 UTC — early enough that recruiter morning views see
 * up-to-date statuses, late enough that yesterday's late-evening shift
 * cancellations have settled.
 *
 * Per-tenant timezone scheduling is on the deferred list — for v1 a
 * single UTC pass keeps the implementation simple and the per-day
 * idempotency guard tight.
 */
export const gigJobOrderStatusCron = onSchedule(
  {
    schedule: 'every day 05:00',
    timeZone: 'UTC',
    region: 'us-central1',
    maxInstances: 1,
    retryCount: 0,
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const db = admin.firestore();
    const todayIso = todayUtcIso();

    // Idempotency — match the `dailyReconcileExpiredReadiness` pattern.
    // If a manual invocation already ran today the .create() on the
    // unique runId fails, and we silently skip.
    const runId = `gigJobOrderStatusCron_${todayIso}`;
    const runRef = db.collection('function_runs').doc(runId);
    try {
      await runRef.create({
        createdAt: FieldValue.serverTimestamp(),
        type: 'gig_jo_status_auto_manage',
      });
    } catch {
      logger.info(LOG.alreadyRanToday, { runId });
      return;
    }

    const start = Date.now();
    logger.info(LOG.startedDay, { runId, todayIso });

    const tenantsSnap = await db.collection('tenants').get();
    const tenantSummaries: RunGigStatusCronTenantSummary[] = [];

    for (const tenantDoc of tenantsSnap.docs) {
      const tenantId = tenantDoc.id;
      try {
        const tenantSummary = await runGigStatusCronForTenant({
          db,
          tenantId,
          todayIso,
        });
        tenantSummaries.push(tenantSummary);
        logger.info(LOG.tenantSummary, tenantSummary);
      } catch (err) {
        logger.error(LOG.failed, {
          tenantId,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
    }

    const totals = tenantSummaries.reduce(
      (acc, t) => ({
        joScanned: acc.joScanned + t.joScanned,
        joFlipped: acc.joFlipped + t.joFlipped,
        joFlippedToOpen: acc.joFlippedToOpen + t.joFlippedToOpen,
        joFlippedToOnHold: acc.joFlippedToOnHold + t.joFlippedToOnHold,
        joSkippedTerminal: acc.joSkippedTerminal + t.joSkippedTerminal,
        joSkippedSameStatus: acc.joSkippedSameStatus + t.joSkippedSameStatus,
        joFailed: acc.joFailed + t.joFailed,
      }),
      {
        joScanned: 0,
        joFlipped: 0,
        joFlippedToOpen: 0,
        joFlippedToOnHold: 0,
        joSkippedTerminal: 0,
        joSkippedSameStatus: 0,
        joFailed: 0,
      },
    );

    logger.info(LOG.finished, {
      runId,
      todayIso,
      tenantsScanned: tenantsSnap.size,
      durationMs: Date.now() - start,
      ...totals,
    });
  },
);

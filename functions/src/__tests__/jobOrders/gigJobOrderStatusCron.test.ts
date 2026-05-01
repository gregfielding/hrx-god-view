/**
 * **§14b — Gig job order status auto-management cron tests.**
 *
 * Three layers exercised here:
 *   1. `isShiftActiveUpcoming` — pure shift-active decision (date +
 *      status filter — mirrors `buildActiveRowMeta` from `shiftRow.ts`).
 *   2. `decideTargetStatus`     — pure JO-status decision (terminal
 *      guard, same-status no-op, otherwise active → open / inactive →
 *      on_hold).
 *   3. `runGigStatusCronForTenant` — full per-tenant pass: scans only
 *      the auto-marked gig JOs, reads each JO's shifts subcollection,
 *      flips status when needed, and produces a per-tenant summary.
 *
 * The scheduled wrapper (`gigJobOrderStatusCron`) itself is a thin
 * trampoline — fan out across tenants + idempotent run-id guard. We
 * don't unit-test the wrapper directly; the per-tenant runner gets
 * the meaningful coverage.
 */

import { expect } from 'chai';
import * as admin from 'firebase-admin';

import { AUTO_CREATED_FROM_MARKER } from '../../jobOrders/gigJobOrderFromChildAccount';
import {
  decideTargetStatus,
  isShiftActiveUpcoming,
  runGigStatusCronForTenant,
  todayUtcIso,
} from '../../jobOrders/gigJobOrderStatusCron';
import {
  type FakeState,
  installFieldValueStubs,
  makeFakeFirestore,
  newState,
} from './_fakeFirestore';

installFieldValueStubs();

// ─────────────────────────────────────────────────────────────────────
// 1. isShiftActiveUpcoming — pure decision
// ─────────────────────────────────────────────────────────────────────

describe('isShiftActiveUpcoming — pure helper', () => {
  const today = '2026-04-30';
  const tomorrow = '2026-05-01';
  const yesterday = '2026-04-29';

  it('returns true for an open single-day shift today', () => {
    expect(
      isShiftActiveUpcoming({ status: 'open', shiftDate: today }, today),
    ).to.equal(true);
  });

  it('returns true for an open single-day shift tomorrow', () => {
    expect(
      isShiftActiveUpcoming({ status: 'open', shiftDate: tomorrow }, today),
    ).to.equal(true);
  });

  it('returns false for an open single-day shift yesterday', () => {
    expect(
      isShiftActiveUpcoming({ status: 'open', shiftDate: yesterday }, today),
    ).to.equal(false);
  });

  it('returns true for a filled (= still active) single-day shift today', () => {
    expect(
      isShiftActiveUpcoming({ status: 'filled', shiftDate: today }, today),
    ).to.equal(true);
  });

  it('returns false for a cancelled shift even on a future date', () => {
    expect(
      isShiftActiveUpcoming(
        { status: 'cancelled', shiftDate: tomorrow },
        today,
      ),
    ).to.equal(false);
  });

  it('returns false for a closed shift even on a future date', () => {
    expect(
      isShiftActiveUpcoming({ status: 'closed', shiftDate: tomorrow }, today),
    ).to.equal(false);
  });

  it('returns true for a multi-day shift whose endDate is in the future', () => {
    expect(
      isShiftActiveUpcoming(
        {
          status: 'open',
          shiftMode: 'multi',
          shiftDate: yesterday,
          endDate: tomorrow,
        },
        today,
      ),
    ).to.equal(true);
  });

  it('returns false for a multi-day shift whose entire window is in the past', () => {
    expect(
      isShiftActiveUpcoming(
        {
          status: 'open',
          shiftMode: 'multi',
          shiftDate: '2026-04-01',
          endDate: '2026-04-15',
        },
        today,
      ),
    ).to.equal(false);
  });

  it('returns false when shiftDate is missing (defensive — date-less gig is on_hold)', () => {
    expect(isShiftActiveUpcoming({ status: 'open' }, today)).to.equal(false);
  });

  it('returns false for an unknown status (defensive — better false on_hold than false open)', () => {
    expect(
      isShiftActiveUpcoming(
        { status: 'mystery_state', shiftDate: tomorrow },
        today,
      ),
    ).to.equal(false);
  });

  it('treats `confirmed` as active (forward-compat for ApplicationAnswer flow)', () => {
    expect(
      isShiftActiveUpcoming({ status: 'confirmed', shiftDate: today }, today),
    ).to.equal(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. decideTargetStatus — pure decision
// ─────────────────────────────────────────────────────────────────────

describe('decideTargetStatus — pure helper', () => {
  it('returns `open` when on_hold and there is an active shift', () => {
    expect(decideTargetStatus('on_hold', true)).to.equal('open');
  });

  it('returns `on_hold` when open and there are no active shifts', () => {
    expect(decideTargetStatus('open', false)).to.equal('on_hold');
  });

  it('returns null (no flip) when current status matches target', () => {
    expect(decideTargetStatus('open', true)).to.equal(null);
    expect(decideTargetStatus('on_hold', false)).to.equal(null);
  });

  it('returns null (no flip) for terminal status `cancelled`', () => {
    expect(decideTargetStatus('cancelled', true)).to.equal(null);
    expect(decideTargetStatus('cancelled', false)).to.equal(null);
  });

  it('returns null (no flip) for terminal status `completed`', () => {
    expect(decideTargetStatus('completed', true)).to.equal(null);
  });

  it('returns null (no flip) for terminal status `filled`', () => {
    // Recruiter-marked `filled` is intentional — don't fight it.
    expect(decideTargetStatus('filled', false)).to.equal(null);
  });

  it('treats legacy `canceled` (single-l) as terminal too', () => {
    expect(decideTargetStatus('canceled', true)).to.equal(null);
  });

  it('flips a JO sitting in a recruiter-set transient status (e.g. `interviewing`)', () => {
    // For a JO that's not auto-managed but somehow has the marker
    // (e.g. a recruiter copied a JO and forgot to clear), the cron
    // won't flip terminal but WILL flip non-terminal. This is the
    // safer choice — leaving an unexpected status would create
    // recruiter confusion. Marker-based gating happens upstream of
    // this helper.
    expect(decideTargetStatus('interviewing', false)).to.equal('on_hold');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. todayUtcIso — pure date stamp
// ─────────────────────────────────────────────────────────────────────

describe('todayUtcIso', () => {
  it('formats a Date as YYYY-MM-DD in UTC', () => {
    const d = new Date(Date.UTC(2026, 3, 30, 5, 0, 0));
    expect(todayUtcIso(d)).to.equal('2026-04-30');
  });

  it('does not slip a day for late-evening UTC', () => {
    const d = new Date(Date.UTC(2026, 3, 30, 23, 59, 59));
    expect(todayUtcIso(d)).to.equal('2026-04-30');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4. runGigStatusCronForTenant — full per-tenant pass
// ─────────────────────────────────────────────────────────────────────

const TODAY = '2026-04-30';
const TOMORROW = '2026-05-01';
const YESTERDAY = '2026-04-29';

interface GigJoSeed {
  id: string;
  status: string;
  autoCreatedFrom?: string;
  jobType?: string;
  shifts?: Array<{ id: string; status: string; shiftDate: string; shiftMode?: string; endDate?: string }>;
}

function seedTenantGigJos(
  state: FakeState,
  tenantId: string,
  jos: GigJoSeed[],
): void {
  for (const jo of jos) {
    state.store.set(`tenants/${tenantId}/job_orders/${jo.id}`, {
      jobType: jo.jobType ?? 'gig',
      status: jo.status,
      autoCreatedFrom: jo.autoCreatedFrom,
    });
    for (const s of jo.shifts ?? []) {
      state.store.set(
        `tenants/${tenantId}/job_orders/${jo.id}/shifts/${s.id}`,
        {
          status: s.status,
          shiftDate: s.shiftDate,
          shiftMode: s.shiftMode,
          endDate: s.endDate,
        },
      );
    }
  }
}

describe('runGigStatusCronForTenant', () => {
  it('flips on_hold → open when an active upcoming shift exists', async () => {
    const state = newState();
    seedTenantGigJos(state, 't1', [
      {
        id: 'jo1',
        status: 'on_hold',
        autoCreatedFrom: AUTO_CREATED_FROM_MARKER,
        shifts: [
          { id: 's1', status: 'open', shiftDate: TOMORROW },
        ],
      },
    ]);
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const summary = await runGigStatusCronForTenant({
      db: fdb,
      tenantId: 't1',
      todayIso: TODAY,
    });

    expect(summary.joScanned).to.equal(1);
    expect(summary.joFlipped).to.equal(1);
    expect(summary.joFlippedToOpen).to.equal(1);
    expect(summary.joFlippedToOnHold).to.equal(0);

    const updated = state.store.get('tenants/t1/job_orders/jo1') as
      | Record<string, unknown>
      | undefined;
    expect(updated?.status).to.equal('open');
    expect(updated?.statusManagedBy).to.equal('gigJobOrderStatusCron');
  });

  it('flips open → on_hold when all shifts are in the past or cancelled', async () => {
    const state = newState();
    seedTenantGigJos(state, 't1', [
      {
        id: 'jo1',
        status: 'open',
        autoCreatedFrom: AUTO_CREATED_FROM_MARKER,
        shifts: [
          { id: 's_past', status: 'open', shiftDate: YESTERDAY },
          { id: 's_cancelled', status: 'cancelled', shiftDate: TOMORROW },
        ],
      },
    ]);
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const summary = await runGigStatusCronForTenant({
      db: fdb,
      tenantId: 't1',
      todayIso: TODAY,
    });

    expect(summary.joFlipped).to.equal(1);
    expect(summary.joFlippedToOnHold).to.equal(1);
    const updated = state.store.get('tenants/t1/job_orders/jo1') as
      | Record<string, unknown>
      | undefined;
    expect(updated?.status).to.equal('on_hold');
  });

  it('skips JOs already in the right state (saves a write)', async () => {
    const state = newState();
    seedTenantGigJos(state, 't1', [
      {
        id: 'jo_open_correct',
        status: 'open',
        autoCreatedFrom: AUTO_CREATED_FROM_MARKER,
        shifts: [{ id: 's1', status: 'open', shiftDate: TOMORROW }],
      },
      {
        id: 'jo_hold_correct',
        status: 'on_hold',
        autoCreatedFrom: AUTO_CREATED_FROM_MARKER,
        shifts: [],
      },
    ]);
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const summary = await runGigStatusCronForTenant({
      db: fdb,
      tenantId: 't1',
      todayIso: TODAY,
    });

    expect(summary.joScanned).to.equal(2);
    expect(summary.joFlipped).to.equal(0);
    expect(summary.joSkippedSameStatus).to.equal(2);
    expect(state.updates.filter((u) => u.path.includes('/job_orders/'))).to.have.lengthOf(0);
  });

  it('does NOT touch terminal status (cancelled / completed / filled)', async () => {
    const state = newState();
    seedTenantGigJos(state, 't1', [
      {
        id: 'jo_cancelled',
        status: 'cancelled',
        autoCreatedFrom: AUTO_CREATED_FROM_MARKER,
        shifts: [{ id: 's1', status: 'open', shiftDate: TOMORROW }],
      },
      {
        id: 'jo_completed',
        status: 'completed',
        autoCreatedFrom: AUTO_CREATED_FROM_MARKER,
        shifts: [],
      },
      {
        id: 'jo_filled',
        status: 'filled',
        autoCreatedFrom: AUTO_CREATED_FROM_MARKER,
        shifts: [],
      },
    ]);
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const summary = await runGigStatusCronForTenant({
      db: fdb,
      tenantId: 't1',
      todayIso: TODAY,
    });

    expect(summary.joScanned).to.equal(3);
    expect(summary.joFlipped).to.equal(0);
    expect(summary.joSkippedTerminal).to.equal(3);
    // Statuses unchanged.
    expect(
      (state.store.get('tenants/t1/job_orders/jo_cancelled') as { status: string })
        .status,
    ).to.equal('cancelled');
  });

  it('does NOT touch JOs without the autoCreatedFrom marker (manual gig JOs)', async () => {
    const state = newState();
    seedTenantGigJos(state, 't1', [
      // Manually-created gig JO — no marker. Cron must skip.
      {
        id: 'jo_manual',
        status: 'on_hold',
        // autoCreatedFrom omitted intentionally
        shifts: [{ id: 's1', status: 'open', shiftDate: TOMORROW }],
      },
      // Auto JO — should be touched.
      {
        id: 'jo_auto',
        status: 'on_hold',
        autoCreatedFrom: AUTO_CREATED_FROM_MARKER,
        shifts: [{ id: 's1', status: 'open', shiftDate: TOMORROW }],
      },
    ]);
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const summary = await runGigStatusCronForTenant({
      db: fdb,
      tenantId: 't1',
      todayIso: TODAY,
    });

    // The Firestore query filters on `autoCreatedFrom === marker`, so
    // jo_manual is invisible to the cron entirely.
    expect(summary.joScanned).to.equal(1);
    expect(summary.joFlipped).to.equal(1);
    expect(
      (state.store.get('tenants/t1/job_orders/jo_manual') as { status: string })
        .status,
    ).to.equal(
      'on_hold',
      'manual JO must keep its hand-set status',
    );
    expect(
      (state.store.get('tenants/t1/job_orders/jo_auto') as { status: string })
        .status,
    ).to.equal('open');
  });

  it('does NOT touch career JOs even with the marker (cron is gig-only)', async () => {
    const state = newState();
    seedTenantGigJos(state, 't1', [
      {
        id: 'jo_career',
        status: 'on_hold',
        jobType: 'career',
        autoCreatedFrom: AUTO_CREATED_FROM_MARKER,
        shifts: [{ id: 's1', status: 'open', shiftDate: TOMORROW }],
      },
    ]);
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const summary = await runGigStatusCronForTenant({
      db: fdb,
      tenantId: 't1',
      todayIso: TODAY,
    });

    expect(summary.joScanned).to.equal(0, 'career JO filtered out by jobType==gig');
    expect(
      (state.store.get('tenants/t1/job_orders/jo_career') as { status: string })
        .status,
    ).to.equal('on_hold');
  });

  it('handles a tenant with no auto-created gig JOs (no work, no failures)', async () => {
    const state = newState();
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    const summary = await runGigStatusCronForTenant({
      db: fdb,
      tenantId: 't1',
      todayIso: TODAY,
    });
    expect(summary.joScanned).to.equal(0);
    expect(summary.joFlipped).to.equal(0);
    expect(summary.joFailed).to.equal(0);
  });

  it('full lifecycle — JO with no shifts → adds upcoming → cron flips → cancels → cron flips back', async () => {
    const state = newState();
    seedTenantGigJos(state, 't1', [
      {
        id: 'jo_lifecycle',
        status: 'on_hold',
        autoCreatedFrom: AUTO_CREATED_FROM_MARKER,
        shifts: [],
      },
    ]);
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    // 1) No shifts → should stay on_hold (no flip).
    let summary = await runGigStatusCronForTenant({
      db: fdb,
      tenantId: 't1',
      todayIso: TODAY,
    });
    expect(summary.joFlipped).to.equal(0);
    expect(
      (state.store.get('tenants/t1/job_orders/jo_lifecycle') as { status: string }).status,
    ).to.equal('on_hold');

    // 2) Add an upcoming open shift → next pass flips on_hold → open.
    state.store.set('tenants/t1/job_orders/jo_lifecycle/shifts/s_new', {
      status: 'open',
      shiftDate: TOMORROW,
    });
    summary = await runGigStatusCronForTenant({
      db: fdb,
      tenantId: 't1',
      todayIso: TODAY,
    });
    expect(summary.joFlippedToOpen).to.equal(1);
    expect(
      (state.store.get('tenants/t1/job_orders/jo_lifecycle') as { status: string }).status,
    ).to.equal('open');

    // 3) Cancel that shift → next pass flips open → on_hold.
    state.store.set('tenants/t1/job_orders/jo_lifecycle/shifts/s_new', {
      status: 'cancelled',
      shiftDate: TOMORROW,
    });
    summary = await runGigStatusCronForTenant({
      db: fdb,
      tenantId: 't1',
      todayIso: TODAY,
    });
    expect(summary.joFlippedToOnHold).to.equal(1);
    expect(
      (state.store.get('tenants/t1/job_orders/jo_lifecycle') as { status: string }).status,
    ).to.equal('on_hold');
  });
});

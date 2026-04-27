/**
 * Phase C.2 unit tests for `decideReconcileAction`.
 *
 * The pure status-decision logic that drives the daily reconciler. The
 * Firestore I/O orchestration (`runReconcilePass`) is covered by emulator
 * integration tests; this file pins the per-item decision contract.
 *
 * Mocha + Chai per `functions/package.json` test script.
 */

import { expect } from 'chai';
import {
  decideReconcileAction,
  decideBackgroundCheckExpiryAction,
  runBackgroundCheckExpiryPass,
} from '../../readiness/dailyReconcileExpiredReadiness';
import type { AssignmentReadinessItem } from '../../shared/assignmentReadinessItemV1';

const NOW = Date.UTC(2026, 3, 26); // 2026-04-26 midnight UTC
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function item(
  status: AssignmentReadinessItem['status'],
  expiresAtMs?: number,
): Pick<AssignmentReadinessItem, 'status' | 'expiresAtMs'> {
  return { status, ...(expiresAtMs !== undefined ? { expiresAtMs } : {}) };
}

describe('decideReconcileAction — flip cases', () => {
  it('flips a complete_pass item whose expiresAtMs is in the past', () => {
    const a = decideReconcileAction(item('complete_pass', NOW - DAY), NOW);
    expect(a).to.deep.equal({ kind: 'flip' });
  });

  it('flips even a barely-expired item (1 ms past nowMs)', () => {
    const a = decideReconcileAction(item('complete_pass', NOW - 1), NOW);
    expect(a).to.deep.equal({ kind: 'flip' });
  });
});

describe('decideReconcileAction — boundary alignment with matchLicenses', () => {
  // matchLicenses semantics: today === expirationDate is still valid.
  // Stamping helper: expiresAtMs = start of day AFTER expirationDate.
  // Reconciler: strict `<` against nowMs.
  //
  // Combined: a license that expired '2026-04-25' has expiresAtMs =
  // midnight UTC 4/26. At nowMs = midnight 4/26, it should NOT flip yet
  // (it just became invalid; reconciler runs at 02:00 ET so we'll catch it
  // in the same UTC day, but the boundary itself is exclusive).
  it('does NOT flip when nowMs === expiresAtMs (just-expired boundary)', () => {
    const a = decideReconcileAction(item('complete_pass', NOW), NOW);
    expect(a).to.deep.equal({ kind: 'skip', reason: 'missing_or_future_expiry' });
  });

  it('does NOT flip when expiresAtMs is in the future', () => {
    const a = decideReconcileAction(item('complete_pass', NOW + DAY), NOW);
    expect(a).to.deep.equal({ kind: 'skip', reason: 'missing_or_future_expiry' });
  });
});

describe('decideReconcileAction — race condition skip', () => {
  it('skips an item whose status is no longer complete_pass', () => {
    // Another trigger fired between the candidate query and our read.
    const a = decideReconcileAction(item('expired', NOW - DAY), NOW);
    expect(a).to.deep.equal({ kind: 'skip', reason: 'race_condition_status_moved' });
  });

  it('skips a complete_fail item even if expiresAtMs is past', () => {
    const a = decideReconcileAction(item('complete_fail', NOW - DAY), NOW);
    expect(a).to.deep.equal({ kind: 'skip', reason: 'race_condition_status_moved' });
  });

  it('skips an incomplete item', () => {
    const a = decideReconcileAction(item('incomplete', NOW - DAY), NOW);
    expect(a).to.deep.equal({ kind: 'skip', reason: 'race_condition_status_moved' });
  });
});

describe('decideReconcileAction — defensive / missing-expiry skip', () => {
  it('skips when expiresAtMs is undefined (defensive — query SHOULD filter these)', () => {
    const a = decideReconcileAction(item('complete_pass'), NOW);
    expect(a).to.deep.equal({ kind: 'skip', reason: 'missing_or_future_expiry' });
  });

  it('skips when expiresAtMs is 0', () => {
    const a = decideReconcileAction(item('complete_pass', 0), NOW);
    expect(a).to.deep.equal({ kind: 'skip', reason: 'missing_or_future_expiry' });
  });

  it('skips when expiresAtMs is negative', () => {
    const a = decideReconcileAction(item('complete_pass', -1), NOW);
    expect(a).to.deep.equal({ kind: 'skip', reason: 'missing_or_future_expiry' });
  });
});

describe('decideReconcileAction — race precedence', () => {
  it('race-condition skip wins over missing-expiry skip', () => {
    // Both checks would trigger; status check runs first by design.
    const a = decideReconcileAction(item('expired'), NOW);
    expect(a.kind).to.equal('skip');
    if (a.kind === 'skip') {
      expect(a.reason).to.equal('race_condition_status_moved');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// R.10 — orchestrator wiring smoke (deep semantics live in
// `backgroundCheckExpiryPass.test.ts`).
// ─────────────────────────────────────────────────────────────────────────

describe('R.10 wiring — orchestrator exports both passes', () => {
  it('exports decideBackgroundCheckExpiryAction as a callable function', () => {
    expect(typeof decideBackgroundCheckExpiryAction).to.equal('function');
  });

  it('exports runBackgroundCheckExpiryPass as a callable function', () => {
    expect(typeof runBackgroundCheckExpiryPass).to.equal('function');
  });

  it('decideBackgroundCheckExpiryAction is independent from decideReconcileAction', () => {
    // Independence check — the two passes share infrastructure (cron,
    // idempotency guard) but not query logic. Their decision functions
    // operate on different shapes and should not be confused.
    expect(decideBackgroundCheckExpiryAction).to.not.equal(decideReconcileAction);
  });
});

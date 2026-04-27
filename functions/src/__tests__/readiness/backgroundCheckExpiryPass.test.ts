/**
 * R.10 — Pure-logic unit tests for `decideBackgroundCheckExpiryAction`.
 *
 * The pure decision unit that drives `runBackgroundCheckExpiryPass`. The
 * I/O orchestration (Firestore reads, cascade resolution, batch writes) is
 * covered separately by the C.2 integration smoke + manual staging
 * verification per the R.10 handoff verification gate. This file pins the
 * per-check decision contract so future changes to the cascade/sweep
 * plumbing can't silently shift the boundary semantics.
 *
 * Mocha + Chai per `functions/package.json` test script.
 *
 * @see docs/READINESS_R10_HANDOFF.md L1.R10
 */

import { expect } from 'chai';
import {
  decideBackgroundCheckExpiryAction,
  type DecideBackgroundCheckExpiryArgs,
} from '../../readiness/dailyReconcileExpiredReadiness';
import { mergeScreeningValidityDaysFromLayers } from '../../compliance/screeningAutomationShared';

const NOW = Date.UTC(2026, 3, 27); // 2026-04-27 midnight UTC
const DAY = 24 * 3_600_000;

function args(over: Partial<DecideBackgroundCheckExpiryArgs>): DecideBackgroundCheckExpiryArgs {
  return {
    hrxStatus: 'completed',
    orderCompleted: true,
    completedMs: NOW - 30 * DAY,
    validityDays: 365,
    nowMs: NOW,
    ...over,
  };
}

describe('decideBackgroundCheckExpiryAction — fresh check, within validity', () => {
  it('skips a check completed 30 days ago with default 365d validity', () => {
    const a = decideBackgroundCheckExpiryAction(args({ completedMs: NOW - 30 * DAY }));
    expect(a.kind).to.equal('skip');
    if (a.kind === 'skip') {
      expect(a.reason).to.equal('within_validity');
      expect(a.expiresAtMs).to.equal(NOW - 30 * DAY + 365 * DAY);
    }
  });

  it('skips a check completed exactly validityDays-1 ago (last day of validity)', () => {
    const a = decideBackgroundCheckExpiryAction(args({ completedMs: NOW - 364 * DAY }));
    expect(a.kind).to.equal('skip');
    if (a.kind === 'skip') {
      expect(a.reason).to.equal('within_validity');
    }
  });

  it('skips at the boundary: nowMs === expiresAtMs (just-becoming-invalid)', () => {
    // Aligns with `decideReconcileAction`: `expiresAtMs >= nowMs` is "still valid".
    const a = decideBackgroundCheckExpiryAction(args({ completedMs: NOW - 365 * DAY }));
    expect(a.kind).to.equal('skip');
    if (a.kind === 'skip') {
      expect(a.reason).to.equal('within_validity');
    }
  });
});

describe('decideBackgroundCheckExpiryAction — old check, expires', () => {
  it('expires a check completed 400d ago with default 365d validity', () => {
    const a = decideBackgroundCheckExpiryAction(args({ completedMs: NOW - 400 * DAY }));
    expect(a.kind).to.equal('expire');
    if (a.kind === 'expire') {
      expect(a.appliedValidityDays).to.equal(365);
      expect(a.expiresAtMs).to.equal(NOW - 400 * DAY + 365 * DAY);
      expect(a.expiresAtMs).to.be.lessThan(NOW);
    }
  });

  it('expires a check 1ms past its threshold (smallest-possible flip)', () => {
    const a = decideBackgroundCheckExpiryAction(
      args({ completedMs: NOW - 365 * DAY - 1 }),
    );
    expect(a.kind).to.equal('expire');
  });

  it('stamps appliedValidityDays from the args (audit trail)', () => {
    const a = decideBackgroundCheckExpiryAction(
      args({ completedMs: NOW - 200 * DAY, validityDays: 180 }),
    );
    expect(a.kind).to.equal('expire');
    if (a.kind === 'expire') {
      expect(a.appliedValidityDays).to.equal(180);
    }
  });
});

describe('decideBackgroundCheckExpiryAction — policy change semantics', () => {
  it('tighten 365 → 180 expires checks past 180d immediately on next sweep', () => {
    // Check completed 200 days ago. Was within 365d, now past 180d → expire.
    const a = decideBackgroundCheckExpiryAction(
      args({ completedMs: NOW - 200 * DAY, validityDays: 180 }),
    );
    expect(a.kind).to.equal('expire');
    if (a.kind === 'expire') {
      expect(a.appliedValidityDays).to.equal(180);
    }
  });

  it('loosen 365 → 730 keeps a 400d-old check valid (NOT expire)', () => {
    // Operator extends policy. A check that was about to expire stays valid.
    const a = decideBackgroundCheckExpiryAction(
      args({ completedMs: NOW - 400 * DAY, validityDays: 730 }),
    );
    expect(a.kind).to.equal('skip');
    if (a.kind === 'skip') {
      expect(a.reason).to.equal('within_validity');
    }
  });

  it('non-365 default still expires correctly (sanity for non-default values)', () => {
    const a = decideBackgroundCheckExpiryAction(
      args({ completedMs: NOW - 100 * DAY, validityDays: 90 }),
    );
    expect(a.kind).to.equal('expire');
    if (a.kind === 'expire') {
      expect(a.appliedValidityDays).to.equal(90);
    }
  });
});

describe('decideBackgroundCheckExpiryAction — non-completed checks', () => {
  it('skips when hrxStatus is in_progress and orderCompleted is null', () => {
    const a = decideBackgroundCheckExpiryAction(
      args({ hrxStatus: 'in_progress', orderCompleted: null }),
    );
    expect(a.kind).to.equal('skip');
    if (a.kind === 'skip') {
      expect(a.reason).to.equal('not_completed');
    }
  });

  it('skips when hrxStatus is queued (not yet ordered)', () => {
    const a = decideBackgroundCheckExpiryAction(
      args({ hrxStatus: 'queued', orderCompleted: null }),
    );
    expect(a.kind).to.equal('skip');
    if (a.kind === 'skip') {
      expect(a.reason).to.equal('not_completed');
    }
  });

  it('treats orderCompleted=true as completed even without hrxStatus', () => {
    const a = decideBackgroundCheckExpiryAction(
      args({ hrxStatus: null, orderCompleted: true, completedMs: NOW - 400 * DAY }),
    );
    expect(a.kind).to.equal('expire');
  });

  it('treats hrxStatus=report_ready as completed even without orderCompleted', () => {
    const a = decideBackgroundCheckExpiryAction(
      args({ hrxStatus: 'report_ready', orderCompleted: null, completedMs: NOW - 400 * DAY }),
    );
    expect(a.kind).to.equal('expire');
  });
});

describe('decideBackgroundCheckExpiryAction — defensive / missing data', () => {
  it('skips when completedMs is null', () => {
    const a = decideBackgroundCheckExpiryAction(args({ completedMs: null }));
    expect(a.kind).to.equal('skip');
    if (a.kind === 'skip') {
      expect(a.reason).to.equal('missing_completed_at');
    }
  });

  it('skips when completedMs is 0 (epoch — almost certainly bad data)', () => {
    const a = decideBackgroundCheckExpiryAction(args({ completedMs: 0 }));
    expect(a.kind).to.equal('skip');
    if (a.kind === 'skip') {
      expect(a.reason).to.equal('missing_completed_at');
    }
  });

  it('skips when completedMs is negative', () => {
    const a = decideBackgroundCheckExpiryAction(args({ completedMs: -1 }));
    expect(a.kind).to.equal('skip');
    if (a.kind === 'skip') {
      expect(a.reason).to.equal('missing_completed_at');
    }
  });

  it('falls back to default when validityDays is invalid (0)', () => {
    // Defensive coercion — bad data shouldn't disable expiry; should use default.
    const a = decideBackgroundCheckExpiryAction(
      args({ completedMs: NOW - 400 * DAY, validityDays: 0 }),
    );
    expect(a.kind).to.equal('expire');
    if (a.kind === 'expire') {
      expect(a.appliedValidityDays).to.equal(365);
    }
  });

  it('falls back to default when validityDays is non-integer', () => {
    const a = decideBackgroundCheckExpiryAction(
      args({ completedMs: NOW - 400 * DAY, validityDays: 365.5 }),
    );
    expect(a.kind).to.equal('expire');
    if (a.kind === 'expire') {
      expect(a.appliedValidityDays).to.equal(365);
    }
  });
});

describe('decideBackgroundCheckExpiryAction — race precedence (status before timestamp)', () => {
  it('skip_not_completed wins when status check fails AND completedMs is null', () => {
    const a = decideBackgroundCheckExpiryAction(
      args({ hrxStatus: 'in_progress', orderCompleted: null, completedMs: null }),
    );
    expect(a.kind).to.equal('skip');
    if (a.kind === 'skip') {
      expect(a.reason).to.equal('not_completed');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Cascade merge — validates L4.R10 precedence (JO → Loc → Account → default)
// ─────────────────────────────────────────────────────────────────────────

describe('mergeScreeningValidityDaysFromLayers — precedence', () => {
  it('returns default 365 when all layers are undefined', () => {
    const r = mergeScreeningValidityDaysFromLayers(undefined, undefined, undefined);
    expect(r).to.deep.equal({ validityDays: 365, source: 'default' });
  });

  it('returns default when layers exist but none set screeningValidityDays', () => {
    const r = mergeScreeningValidityDaysFromLayers({}, {}, {});
    expect(r).to.deep.equal({ validityDays: 365, source: 'default' });
  });

  it('account orderDefaults beats default', () => {
    const r = mergeScreeningValidityDaysFromLayers(
      undefined,
      undefined,
      { orderDefaults: { screeningValidityDays: 180 } },
    );
    expect(r).to.deep.equal({ validityDays: 180, source: 'account' });
  });

  it('location orderDefaults beats account', () => {
    const r = mergeScreeningValidityDaysFromLayers(
      undefined,
      { orderDefaults: { screeningValidityDays: 120 } },
      { orderDefaults: { screeningValidityDays: 180 } },
    );
    expect(r).to.deep.equal({ validityDays: 120, source: 'location_defaults' });
  });

  it('jobOrder top-level beats both', () => {
    const r = mergeScreeningValidityDaysFromLayers(
      { screeningValidityDays: 90 },
      { orderDefaults: { screeningValidityDays: 120 } },
      { orderDefaults: { screeningValidityDays: 180 } },
    );
    expect(r).to.deep.equal({ validityDays: 90, source: 'job_order' });
  });

  it('rejects invalid values and falls through (account 0 → default)', () => {
    const r = mergeScreeningValidityDaysFromLayers(
      undefined,
      undefined,
      { orderDefaults: { screeningValidityDays: 0 } },
    );
    expect(r).to.deep.equal({ validityDays: 365, source: 'default' });
  });

  it('rejects negative values and falls through', () => {
    const r = mergeScreeningValidityDaysFromLayers(
      { screeningValidityDays: -30 },
      undefined,
      { orderDefaults: { screeningValidityDays: 180 } },
    );
    expect(r).to.deep.equal({ validityDays: 180, source: 'account' });
  });

  it('rejects non-integer values', () => {
    const r = mergeScreeningValidityDaysFromLayers(
      { screeningValidityDays: 365.5 as unknown as number },
      undefined,
      { orderDefaults: { screeningValidityDays: 200 } },
    );
    expect(r).to.deep.equal({ validityDays: 200, source: 'account' });
  });

  it('rejects string values (e.g., "365")', () => {
    const r = mergeScreeningValidityDaysFromLayers(
      undefined,
      undefined,
      { orderDefaults: { screeningValidityDays: '365' as unknown as number } },
    );
    expect(r).to.deep.equal({ validityDays: 365, source: 'default' });
  });

  it('respects valid 1-day minimum (no special lower bound)', () => {
    // Edge: an aggressive policy of 1-day re-screening.
    const r = mergeScreeningValidityDaysFromLayers(
      { screeningValidityDays: 1 },
      undefined,
      undefined,
    );
    expect(r).to.deep.equal({ validityDays: 1, source: 'job_order' });
  });
});

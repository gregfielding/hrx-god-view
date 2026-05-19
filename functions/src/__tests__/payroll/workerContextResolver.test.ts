/**
 * **Slice 6b unit tests — pure helpers from workerContextResolver.**
 *
 * Pure-function tests: workerKind mapping, TZ resolution, epoch
 * conversion. The Firestore-touching helpers (`resolveExternalWorkerId`)
 * are exercised in the integration tests once 6b's orchestrator wires
 * everything together; here we cover the pieces that don't need a
 * Firestore mock.
 */

import { expect } from 'chai';

import {
  FALLBACK_TZ,
  STATE_TZ_MAP,
  pickEvereeWorkerIdFromMap,
  resolveWorksiteTz,
  tzOffsetMinutesAt,
  workToEpochSeconds,
  workerKindFromEntityWorkerType,
} from '../../payroll/workerContextResolver';

// ─────────────────────────────────────────────────────────────────────
// workerKindFromEntityWorkerType
// ─────────────────────────────────────────────────────────────────────

describe('workerKindFromEntityWorkerType', () => {
  it('1099 → contractor', () => {
    expect(workerKindFromEntityWorkerType('1099')).to.equal('contractor');
  });

  it('W2 → w2', () => {
    expect(workerKindFromEntityWorkerType('W2')).to.equal('w2');
  });

  it('mixed defaults to w2 (C1 historical pattern)', () => {
    expect(workerKindFromEntityWorkerType('mixed')).to.equal('w2');
  });

  it('undefined / empty / unknown → w2 (safe default)', () => {
    expect(workerKindFromEntityWorkerType(undefined)).to.equal('w2');
    expect(workerKindFromEntityWorkerType('')).to.equal('w2');
    expect(workerKindFromEntityWorkerType('weird')).to.equal('w2');
  });
});

// ─────────────────────────────────────────────────────────────────────
// pickEvereeWorkerIdFromMap
// ─────────────────────────────────────────────────────────────────────

describe('pickEvereeWorkerIdFromMap', () => {
  it('returns the worker id when tenant id matches as string', () => {
    expect(pickEvereeWorkerIdFromMap({ '3133': 'wid-abc' }, '3133')).to.equal('wid-abc');
  });

  it('returns the worker id when tenant id matches numerically', () => {
    // Some stored maps key by number; pickEvereeWorkerIdFromMap should
    // handle both.
    expect(pickEvereeWorkerIdFromMap({ '3133': 'wid-abc' }, ' 3133 ')).to.equal('wid-abc');
  });

  it('returns empty string when no match', () => {
    expect(pickEvereeWorkerIdFromMap({ '3138': 'wid-events' }, '3133')).to.equal('');
  });

  it('returns empty string for empty / missing map', () => {
    expect(pickEvereeWorkerIdFromMap({}, '3133')).to.equal('');
  });

  it('ignores non-string values', () => {
    expect(pickEvereeWorkerIdFromMap({ '3133': 42 as unknown as string }, '3133')).to.equal('');
  });
});

// ─────────────────────────────────────────────────────────────────────
// resolveWorksiteTz
// ─────────────────────────────────────────────────────────────────────

describe('resolveWorksiteTz', () => {
  it('CA → America/Los_Angeles', () => {
    expect(resolveWorksiteTz('CA', undefined)).to.equal('America/Los_Angeles');
  });

  it('falls back to assignment state when entry state is missing', () => {
    expect(resolveWorksiteTz(undefined, 'TX')).to.equal('America/Chicago');
  });

  it('uppercases lowercase state codes', () => {
    expect(resolveWorksiteTz('ny', undefined)).to.equal('America/New_York');
  });

  it('returns FALLBACK_TZ for unmapped state', () => {
    expect(resolveWorksiteTz('XX', undefined)).to.equal(FALLBACK_TZ);
  });

  it('returns FALLBACK_TZ when both inputs missing', () => {
    expect(resolveWorksiteTz(undefined, undefined)).to.equal(FALLBACK_TZ);
  });

  it('STATE_TZ_MAP covers all 50 states + DC + 5 territories', () => {
    const required = [
      'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL',
      'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME',
      'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH',
      'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI',
      'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI',
      'WY', 'PR', 'GU', 'VI', 'AS', 'MP',
    ];
    for (const code of required) {
      expect(STATE_TZ_MAP[code]).to.be.a('string');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// tzOffsetMinutesAt + workToEpochSeconds
// ─────────────────────────────────────────────────────────────────────

describe('tzOffsetMinutesAt', () => {
  it('UTC is always 0', () => {
    expect(tzOffsetMinutesAt(Date.UTC(2026, 5, 1, 12), 'UTC')).to.equal(0);
  });

  it('America/New_York is -300 (EST) in January', () => {
    // 2026-01-15 12:00 UTC → 07:00 EST → offset -5h = -300min
    expect(tzOffsetMinutesAt(Date.UTC(2026, 0, 15, 12), 'America/New_York')).to.equal(-300);
  });

  it('America/New_York is -240 (EDT) in July', () => {
    expect(tzOffsetMinutesAt(Date.UTC(2026, 6, 15, 12), 'America/New_York')).to.equal(-240);
  });

  it('America/Los_Angeles is -480 (PST) in January', () => {
    expect(tzOffsetMinutesAt(Date.UTC(2026, 0, 15, 12), 'America/Los_Angeles')).to.equal(-480);
  });

  it('America/Phoenix is always -420 (no DST)', () => {
    expect(tzOffsetMinutesAt(Date.UTC(2026, 0, 15, 12), 'America/Phoenix')).to.equal(-420);
    expect(tzOffsetMinutesAt(Date.UTC(2026, 6, 15, 12), 'America/Phoenix')).to.equal(-420);
  });
});

describe('workToEpochSeconds', () => {
  it('CA worksite, 9am on 2026-05-19 (PDT) → correct UTC epoch', () => {
    // PDT = UTC-7. 9:00 PDT on 2026-05-19 == 16:00 UTC == Date.UTC(2026, 4, 19, 16, 0)
    const epoch = workToEpochSeconds('2026-05-19', '09:00', 'America/Los_Angeles');
    expect(epoch).to.equal(Math.floor(Date.UTC(2026, 4, 19, 16, 0) / 1000));
  });

  it('NY worksite, 8am on 2026-01-15 (EST) → correct UTC epoch', () => {
    // EST = UTC-5. 8:00 EST on 2026-01-15 == 13:00 UTC
    const epoch = workToEpochSeconds('2026-01-15', '08:00', 'America/New_York');
    expect(epoch).to.equal(Math.floor(Date.UTC(2026, 0, 15, 13, 0) / 1000));
  });

  it('CA worksite, 9am on 2026-01-15 (PST) → correct UTC epoch (winter)', () => {
    // PST = UTC-8. 9:00 PST == 17:00 UTC
    const epoch = workToEpochSeconds('2026-01-15', '09:00', 'America/Los_Angeles');
    expect(epoch).to.equal(Math.floor(Date.UTC(2026, 0, 15, 17, 0) / 1000));
  });

  it('AZ worksite (no DST) — same offset summer and winter', () => {
    const winter = workToEpochSeconds('2026-01-15', '09:00', 'America/Phoenix');
    const summer = workToEpochSeconds('2026-07-15', '09:00', 'America/Phoenix');
    // Both are MST (UTC-7): 9:00 → 16:00 UTC
    expect(winter).to.equal(Math.floor(Date.UTC(2026, 0, 15, 16, 0) / 1000));
    expect(summer).to.equal(Math.floor(Date.UTC(2026, 6, 15, 16, 0) / 1000));
  });

  it('UTC TZ identity: same wall-clock returns same epoch', () => {
    const epoch = workToEpochSeconds('2026-05-19', '12:00', 'UTC');
    expect(epoch).to.equal(Math.floor(Date.UTC(2026, 4, 19, 12, 0) / 1000));
  });

  it('handles HH:mm with leading zero hour', () => {
    const epoch = workToEpochSeconds('2026-05-19', '08:30', 'America/Los_Angeles');
    // 08:30 PDT == 15:30 UTC
    expect(epoch).to.equal(Math.floor(Date.UTC(2026, 4, 19, 15, 30) / 1000));
  });

  it('throws on malformed inputs', () => {
    expect(() => workToEpochSeconds('not-a-date', '12:00', 'UTC')).to.throw(/bad inputs/);
    expect(() => workToEpochSeconds('2026-05-19', 'notatime', 'UTC')).to.throw(/bad inputs/);
  });
});

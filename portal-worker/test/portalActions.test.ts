import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildPortalActionId,
  defaultPortalActionKeyParts,
  nextStatusAfterError,
  portalActionRetryDelayMs,
  portalSyncBucket,
  providerForAction,
  sanitizePortalActionIdPart,
} from '../../shared/portalActions.ts';
import { withinSyncHours, type WorkerConfig } from '../src/config.ts';
import { classifyError, PortalActionFailure } from '../src/errors.ts';
import { hashPageText, normalizePageText } from '../src/syncState.ts';

describe('sync actions', () => {
  it('buckets full passes into 15-minute windows', () => {
    const t = Date.UTC(2026, 8, 7, 1, 17, 42);
    assert.equal(portalSyncBucket(t), '2026-09-07T01-15');
    assert.equal(portalSyncBucket(t + 13 * 60_000), '2026-09-07T01-30');
  });

  it('keys targeted syncs on their posting set and full passes on the bucket', () => {
    assert.deepEqual(defaultPortalActionKeyParts('fieldglass_sync', { postingIds: ['SDXOJP2', 'SDXOJP1'] }), ['targeted', 'SDXOJP1+SDXOJP2']);
    const full = defaultPortalActionKeyParts('fieldglass_sync', {});
    assert.equal(full[0], 'full');
    assert.match(String(full[1]), /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}$/);
    assert.equal(providerForAction('fieldglass_sync'), 'fieldglass');
    assert.equal(providerForAction('indeed_flex_sync'), 'indeed_flex');
  });

  it('hashes page text ignoring whitespace and clock lines', () => {
    const a = 'Job Posting  SDXOJP1\n\n  Rate: $18.00\n10:32 AM\n';
    const b = 'Job Posting SDXOJP1\nRate: $18.00\n11:05 AM';
    assert.equal(normalizePageText(a), 'Job Posting SDXOJP1\nRate: $18.00');
    assert.equal(hashPageText(a), hashPageText(b));
    assert.notEqual(hashPageText(a), hashPageText(a.replace('$18.00', '$19.00')));
  });

  it('respects the local sync-hours window', () => {
    const cfg = { syncHours: { start: 6, end: 21 }, syncTimezone: 'America/Chicago' } as WorkerConfig;
    // 2026-09-07 12:00Z = 07:00 CDT (inside); 2026-09-07 03:00Z = 22:00 CDT the day before (outside)
    assert.equal(withinSyncHours(cfg, new Date(Date.UTC(2026, 8, 7, 12, 0))), true);
    assert.equal(withinSyncHours(cfg, new Date(Date.UTC(2026, 8, 7, 3, 0))), false);
  });
});

describe('portal action ids', () => {
  it('builds a deterministic, Firestore-safe id', () => {
    const id = buildPortalActionId('indeed_flex', 'book_worker', ['530960', 'XN7lks/abc', undefined, '']);
    assert.equal(id, 'indeed_flex__book_worker__530960__XN7lks-abc');
  });

  it('sanitizes slashes and whitespace but keeps emails readable', () => {
    assert.equal(sanitizePortalActionIdPart(' a/b c '), 'a-b-c');
    assert.equal(sanitizePortalActionIdPart('jane.doe+x@example.com'), 'jane.doe+x@example.com');
  });

  it('derives the same natural key regardless of shift id order', () => {
    const a = defaultPortalActionKeyParts('book_worker', { flexJobId: '1', flexWorkerId: 'w', flexShiftIds: ['b', 'a'] });
    const b = defaultPortalActionKeyParts('book_worker', { flexJobId: '1', flexWorkerId: 'w', flexShiftIds: ['a', 'b'] });
    assert.deepEqual(a, b);
  });

  it('keys candidate submissions by job-seeker id, then email, then name', () => {
    assert.deepEqual(
      defaultPortalActionKeyParts('submit_candidate', {
        postingId: 'SDXOJP1',
        candidate: { firstName: 'A', lastName: 'B', email: 'a@b.c' },
      }),
      ['SDXOJP1', 'a@b.c'],
    );
    assert.deepEqual(
      defaultPortalActionKeyParts('submit_candidate', { postingId: 'SDXOJP1', candidate: { firstName: 'A', lastName: 'B' } }),
      ['SDXOJP1', 'A-B'],
    );
  });
});

describe('provider inference', () => {
  it('infers provider from action and rejects mismatches', () => {
    assert.equal(providerForAction('book_worker'), 'indeed_flex');
    assert.equal(providerForAction('submit_candidate'), 'fieldglass');
    assert.throws(() => providerForAction('book_worker', 'fieldglass'));
    assert.throws(() => providerForAction('smoke_test'));
    assert.equal(providerForAction('smoke_test', 'fieldglass'), 'fieldglass');
  });
});

describe('retry policy', () => {
  it('backs off 5m, 10m, 20m, 40m, capped at 60m', () => {
    const m = 60_000;
    assert.equal(portalActionRetryDelayMs(1), 5 * m);
    assert.equal(portalActionRetryDelayMs(2), 10 * m);
    assert.equal(portalActionRetryDelayMs(3), 20 * m);
    assert.equal(portalActionRetryDelayMs(4), 40 * m);
    assert.equal(portalActionRetryDelayMs(5), 60 * m);
    assert.equal(portalActionRetryDelayMs(9), 60 * m);
  });

  it('retries transient errors until attempts run out, then escalates', () => {
    assert.equal(nextStatusAfterError('TIMEOUT', 1, 3), 'pending');
    assert.equal(nextStatusAfterError('TIMEOUT', 3, 3), 'needs_human');
    assert.equal(nextStatusAfterError('LEASE_EXPIRED', 2, 3), 'pending');
  });

  it('never retries login failures or unimplemented actions', () => {
    assert.equal(nextStatusAfterError('LOGIN_FAILED', 1, 3), 'needs_human');
    assert.equal(nextStatusAfterError('NOT_IMPLEMENTED', 1, 3), 'needs_human');
  });

  it('marks bad payloads and portal refusals as failed, not human work', () => {
    assert.equal(nextStatusAfterError('INVALID_PAYLOAD', 1, 3), 'failed');
    assert.equal(nextStatusAfterError('PORTAL_REJECTED', 1, 3), 'failed');
  });
});

describe('error classification', () => {
  it('passes explicit failures through', () => {
    assert.equal(classifyError(new PortalActionFailure('LOGIN_REQUIRED', 'x')).code, 'LOGIN_REQUIRED');
  });

  it('maps playwright timeouts, crashes and missing selectors', () => {
    const t = new Error('Timeout 30000ms exceeded.');
    t.name = 'TimeoutError';
    assert.equal(classifyError(t).code, 'TIMEOUT');
    assert.equal(classifyError(new Error('Target page, context or browser has been closed')).code, 'BROWSER_CRASH');
    assert.equal(classifyError(new Error('strict mode violation: locator resolved to 2 elements')).code, 'SELECTOR_MISSING');
    assert.equal(classifyError(new Error('something else')).code, 'UNKNOWN');
  });
});

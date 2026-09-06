import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildPortalActionId,
  defaultPortalActionKeyParts,
  nextStatusAfterError,
  portalActionRetryDelayMs,
  providerForAction,
  sanitizePortalActionIdPart,
} from '../../shared/portalActions.ts';
import { classifyError, PortalActionFailure } from '../src/errors.ts';

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

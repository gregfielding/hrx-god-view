/**
 * `evereeHttp` rate-limit handling — unit tests (TS.1.P4 Slice 1).
 *
 * Covers the `computeRateLimitWaitMs` pure helper, which encodes the
 * decision matrix for "do we retry in-process, or bubble up to Cloud
 * Tasks?":
 *
 *   - Missing / malformed `RateLimit-Reset`             → null (no in-process retry)
 *   - Suggested wait > RATE_LIMIT_MAX_WAIT_MS           → null
 *   - Reset is in the past (clock skew)                 → minimum floor (re-fire promptly)
 *   - Normal case                                       → bounded ms
 *
 * The full `evereeRequest` integration with `fetch` is exercised
 * indirectly via the existing per-feature Everee tests and end-to-end
 * staging runs; this file isolates the headers-only decision so the
 * regression surface is small + fast.
 */

import { expect } from 'chai';

import {
  RATE_LIMIT_MAX_WAIT_MS,
  computeRateLimitWaitMs,
} from '../../integrations/everee/evereeHttp';

function mockResponse(headers: Record<string, string> = {}): Response {
  return new Response(null, { status: 429, headers });
}

describe('computeRateLimitWaitMs', () => {
  it('returns null when no RateLimit-Reset header is present', () => {
    const res = mockResponse({});
    expect(computeRateLimitWaitMs(res)).to.equal(null);
  });

  it('returns null when RateLimit-Reset is non-numeric', () => {
    const res = mockResponse({ 'RateLimit-Reset': 'not-a-number' });
    expect(computeRateLimitWaitMs(res)).to.equal(null);
  });

  it('returns null when RateLimit-Reset is zero or negative', () => {
    expect(computeRateLimitWaitMs(mockResponse({ 'RateLimit-Reset': '0' }))).to.equal(null);
    expect(computeRateLimitWaitMs(mockResponse({ 'RateLimit-Reset': '-100' }))).to.equal(null);
  });

  it('returns null when the suggested wait exceeds the max cap', () => {
    const now = 1_700_000_000_000;
    // Reset is 60s in the future — exceeds the 30s in-process cap.
    const resetEpochSec = Math.floor((now + 60_000) / 1000);
    const res = mockResponse({ 'RateLimit-Reset': String(resetEpochSec) });
    expect(computeRateLimitWaitMs(res, now)).to.equal(null);
  });

  it('returns at least the minimum floor when the reset is in the past', () => {
    const now = 1_700_000_000_000;
    const resetEpochSec = Math.floor((now - 5_000) / 1000); // 5s in the past
    const res = mockResponse({ 'RateLimit-Reset': String(resetEpochSec) });
    const result = computeRateLimitWaitMs(res, now);
    expect(result).to.be.a('number');
    expect(result as number).to.be.at.least(1);
    expect(result as number).to.be.at.most(RATE_LIMIT_MAX_WAIT_MS);
  });

  it('returns a bounded ms value for a normal in-window reset', () => {
    const now = 1_700_000_000_000;
    const resetEpochSec = Math.floor((now + 2_000) / 1000); // 2s in the future
    const res = mockResponse({ 'RateLimit-Reset': String(resetEpochSec) });
    const result = computeRateLimitWaitMs(res, now);
    expect(result).to.be.a('number');
    // 2000ms base + up to 1000ms jitter, lower-bounded by the floor.
    expect(result as number).to.be.at.least(2_000);
    expect(result as number).to.be.at.most(3_000);
  });

  it('reads the header case-insensitively', () => {
    const now = 1_700_000_000_000;
    const resetEpochSec = Math.floor((now + 1_500) / 1000);
    // RateLimit-Reset (canonical) vs ratelimit-reset (alternate case)
    const upper = computeRateLimitWaitMs(
      mockResponse({ 'RateLimit-Reset': String(resetEpochSec) }),
      now,
    );
    const lower = computeRateLimitWaitMs(
      mockResponse({ 'ratelimit-reset': String(resetEpochSec) }),
      now,
    );
    expect(upper).to.be.a('number');
    expect(lower).to.be.a('number');
  });

  it('applies jitter (varies across calls)', () => {
    const now = 1_700_000_000_000;
    const resetEpochSec = Math.floor((now + 2_000) / 1000);
    const res = mockResponse({ 'RateLimit-Reset': String(resetEpochSec) });
    const samples = new Set<number>();
    for (let i = 0; i < 20; i += 1) samples.add(computeRateLimitWaitMs(res, now) as number);
    // 20 samples drawing from [2000, 3000] should produce more than one
    // unique value with overwhelming probability. If this ever flakes,
    // the jitter is broken — not the test.
    expect(samples.size).to.be.greaterThan(1);
  });

  it('exports a sane MAX_WAIT_MS cap', () => {
    expect(RATE_LIMIT_MAX_WAIT_MS).to.be.a('number');
    expect(RATE_LIMIT_MAX_WAIT_MS).to.be.at.least(1_000);
    expect(RATE_LIMIT_MAX_WAIT_MS).to.be.at.most(120_000);
  });
});

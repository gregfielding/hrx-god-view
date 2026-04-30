/**
 * WH.1 — Everee webhook signature verification.
 *
 * Pins the **canonical** Everee signing spec
 * (https://developer.everee.com/docs/authenticating-events) so the
 * three-bug regression that produced months of 401 storms can't recur:
 *
 *   1. Header is `x-everee-webhook-signature`, value is comma-separated
 *      `v1=<hex>` entries — never bare hex, never `sha256=…`, never
 *      base64.
 *   2. Tenant id comes from the envelope's `companyId` (numeric), not
 *      `tenantId` — the previous wrong-field read silently fell back to
 *      the global secret and 401'd every event.
 *   3. Signed message is `${timestamp}.${rawBody}` where the timestamp
 *      is the value of the `x-everee-webhook-timestamp` header (epoch
 *      seconds), NOT the in-body `timestamp` field.
 *
 * Each test brackets `process.env` mutation with restore in `afterEach`
 * so cross-test pollution can't make a flake masquerade as a regression.
 */

import * as crypto from 'crypto';
import { expect } from 'chai';

import {
  isWebhookTimestampWithinTolerance,
  pickEvereeTenantIdFromEnvelope,
  verifySignature,
} from '../../integrations/everee/evereeWebhook';

const SECRET_3133 = 'super-secret-test-key-for-3133';
const SECRET_3138 = 'super-secret-test-key-for-3138';
const SECRET_GLOBAL = 'super-secret-fallback-key';

const ENV_KEYS = [
  'EVEREE_WEBHOOK_SECRET',
  'EVEREE_WEBHOOK_SECRET_3133',
  'EVEREE_WEBHOOK_SECRET_3138',
] as const;

function snapshotEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) snap[k] = process.env[k];
  return snap;
}

function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const k of ENV_KEYS) {
    if (snap[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = snap[k];
    }
  }
}

/** Compute the canonical Everee signature for a fixed input. */
function signMessage(secret: string, timestamp: string, body: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
}

describe('WH.1 — verifySignature (canonical Everee spec)', () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = snapshotEnv();
    // Wipe any inherited values so each case sets exactly what it needs.
    for (const k of ENV_KEYS) delete process.env[k];
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  // The "happy path" pinning test — the diagnostic from the production
  // 401 storm showed the header arrived as `v1=<64 hex chars>` (length
  // 67). This case lights up the entire correct-spec implementation.
  it('happy path: matches a real v1=<hex> signature against the tenant secret', () => {
    process.env.EVEREE_WEBHOOK_SECRET_3133 = SECRET_3133;

    const timestamp = '1777563469';
    const body =
      '{"id":"c6eabe86-3b2a-4a0f-9cf1-9cc990f5074b","companyId":3133,"version":"1","type":"worker.onboarding-completed","timestamp":1777563469,"data":{}}';
    const sig = signMessage(SECRET_3133, timestamp, body);

    expect(verifySignature(body, `v1=${sig}`, timestamp, '3133')).to.equal(true);
  });

  it('multi-signature header: matches when the FIRST candidate is correct', () => {
    process.env.EVEREE_WEBHOOK_SECRET_3133 = SECRET_3133;
    const timestamp = '1777563469';
    const body = '{"id":"x","companyId":3133}';
    const correct = signMessage(SECRET_3133, timestamp, body);
    const bogus = 'a'.repeat(64);

    expect(
      verifySignature(body, `v1=${correct},v1=${bogus}`, timestamp, '3133'),
    ).to.equal(true);
  });

  it('multi-signature header: matches when only the SECOND candidate is correct (rotation)', () => {
    // This is the rotation case — Everee's spec explicitly supports
    // multiple concurrent signing keys. We must accept either one.
    process.env.EVEREE_WEBHOOK_SECRET_3133 = SECRET_3133;
    const timestamp = '1777563469';
    const body = '{"id":"x","companyId":3133}';
    const correct = signMessage(SECRET_3133, timestamp, body);
    const bogus = 'b'.repeat(64);

    expect(
      verifySignature(body, `v1=${bogus},v1=${correct}`, timestamp, '3133'),
    ).to.equal(true);
  });

  it('all-wrong: rejects when no candidate signature matches', () => {
    process.env.EVEREE_WEBHOOK_SECRET_3133 = SECRET_3133;
    const timestamp = '1777563469';
    const body = '{"id":"x","companyId":3133}';

    expect(
      verifySignature(
        body,
        `v1=${'a'.repeat(64)},v1=${'b'.repeat(64)}`,
        timestamp,
        '3133',
      ),
    ).to.equal(false);
  });

  it('rejects non-v1 signature versions even if their digest happens to match', () => {
    // If Everee ever ships a v2 we must opt in — silently accepting a
    // v2 with our v1 algorithm is exactly the kind of latent failure
    // mode the canonical spec calls out.
    process.env.EVEREE_WEBHOOK_SECRET_3133 = SECRET_3133;
    const timestamp = '1777563469';
    const body = '{"id":"x","companyId":3133}';
    const correct = signMessage(SECRET_3133, timestamp, body);

    expect(
      verifySignature(body, `v2=${correct}`, timestamp, '3133'),
    ).to.equal(false);
  });

  it('rejects when only non-v1 versions are present alongside garbage v1 entries', () => {
    process.env.EVEREE_WEBHOOK_SECRET_3133 = SECRET_3133;
    const timestamp = '1777563469';
    const body = '{"id":"x"}';
    const sig = signMessage(SECRET_3133, timestamp, body);

    expect(
      verifySignature(body, `v2=${sig},v1=zzzz`, timestamp, '3133'),
    ).to.equal(false);
  });

  it('rejects when the timestamp header is missing (signed message is undefined)', () => {
    process.env.EVEREE_WEBHOOK_SECRET_3133 = SECRET_3133;
    const body = '{"id":"x"}';
    const sig = signMessage(SECRET_3133, '1777563469', body);
    expect(verifySignature(body, `v1=${sig}`, null, '3133')).to.equal(false);
    expect(verifySignature(body, `v1=${sig}`, '', '3133')).to.equal(false);
  });

  it('rejects when the signature header is missing', () => {
    process.env.EVEREE_WEBHOOK_SECRET_3133 = SECRET_3133;
    expect(verifySignature('{}', null, '1777563469', '3133')).to.equal(false);
    expect(verifySignature('{}', '', '1777563469', '3133')).to.equal(false);
  });

  it('rejects when no secret is deployed for the tenant AND no global fallback exists', () => {
    // This was Bug 3 — the secrets weren't deployed at all, so
    // verifySignature falls through to "no secret → false" instead of
    // signing with an empty string and comparing. The previous
    // implementation got that part right; pin it so we don't regress.
    const timestamp = '1777563469';
    const body = '{"id":"x"}';
    expect(
      verifySignature(body, `v1=${'a'.repeat(64)}`, timestamp, '3133'),
    ).to.equal(false);
  });

  it('does NOT cross tenants: tenant 3138 secret cannot validate a tenant 3133 signature', () => {
    // Belt-and-suspenders against a future regression where the
    // selector accidentally collapses to "any per-tenant secret".
    process.env.EVEREE_WEBHOOK_SECRET_3133 = SECRET_3133;
    process.env.EVEREE_WEBHOOK_SECRET_3138 = SECRET_3138;
    const timestamp = '1777563469';
    const body = '{"id":"x","companyId":3133}';
    const sig3133 = signMessage(SECRET_3133, timestamp, body);

    // Sig was made with 3133's key but we're claiming 3138 — must reject.
    expect(verifySignature(body, `v1=${sig3133}`, timestamp, '3138')).to.equal(false);
  });

  it('falls back to the global secret only when no tenant-scoped secret is present', () => {
    process.env.EVEREE_WEBHOOK_SECRET = SECRET_GLOBAL;
    const timestamp = '1777563469';
    const body = '{"id":"x"}';
    const sig = signMessage(SECRET_GLOBAL, timestamp, body);

    // No tenant id → use global.
    expect(verifySignature(body, `v1=${sig}`, timestamp, null)).to.equal(true);
    // Tenant id present but no per-tenant secret defined → still falls
    // back to global (the env var lookup misses, the code defaults to
    // the global). This is the documented pilot path for entities that
    // share Everee's global signing key.
    expect(verifySignature(body, `v1=${sig}`, timestamp, '9999')).to.equal(true);
  });

  it('prefers the tenant-scoped secret over the global fallback when both exist', () => {
    process.env.EVEREE_WEBHOOK_SECRET = SECRET_GLOBAL;
    process.env.EVEREE_WEBHOOK_SECRET_3133 = SECRET_3133;
    const timestamp = '1777563469';
    const body = '{"id":"x"}';
    const sigTenant = signMessage(SECRET_3133, timestamp, body);
    const sigGlobal = signMessage(SECRET_GLOBAL, timestamp, body);

    expect(verifySignature(body, `v1=${sigTenant}`, timestamp, '3133')).to.equal(true);
    // The global signature must NOT be accepted for 3133 — if both keys
    // are valid concurrently, Everee will send both as `v1=` entries
    // already. The code does NOT silently widen the secret pool.
    expect(verifySignature(body, `v1=${sigGlobal}`, timestamp, '3133')).to.equal(false);
  });

  it('rejects malformed v1= entries (non-hex, odd length, empty) without throwing', () => {
    process.env.EVEREE_WEBHOOK_SECRET_3133 = SECRET_3133;
    const timestamp = '1777563469';
    const body = '{"id":"x"}';
    const correct = signMessage(SECRET_3133, timestamp, body);

    // Non-hex chars and odd-length entries must be silently filtered;
    // a real correct entry alongside them must still match.
    expect(
      verifySignature(
        body,
        `v1=zzz,v1=123,v1=,v1=${correct}`,
        timestamp,
        '3133',
      ),
    ).to.equal(true);

    // Same set without the correct entry — must return false.
    expect(
      verifySignature(body, 'v1=zzz,v1=123,v1=', timestamp, '3133'),
    ).to.equal(false);
  });

  it('signed payload uses the HEADER timestamp, NOT the in-body timestamp', () => {
    // Concrete pin against the easiest mistake to make — Everee's body
    // also carries a `timestamp` field, but the signature is over the
    // HEADER timestamp. Pin both behaviors.
    process.env.EVEREE_WEBHOOK_SECRET_3133 = SECRET_3133;
    const headerTimestamp = '1777563469';
    const inBodyTimestamp = '9999999999';
    const body = `{"id":"x","companyId":3133,"timestamp":${inBodyTimestamp}}`;

    const sigUsingHeader = signMessage(SECRET_3133, headerTimestamp, body);
    const sigUsingBody = signMessage(SECRET_3133, inBodyTimestamp, body);

    expect(
      verifySignature(body, `v1=${sigUsingHeader}`, headerTimestamp, '3133'),
    ).to.equal(true);
    expect(
      verifySignature(body, `v1=${sigUsingBody}`, headerTimestamp, '3133'),
    ).to.equal(false);
  });
});

describe('WH.1 — pickEvereeTenantIdFromEnvelope (Bug 1: companyId field)', () => {
  it('extracts companyId from the root of an Everee canonical envelope', () => {
    // Everee sends `companyId` as a number per the events-overview
    // spec; we coerce to string for the env-var lookup
    // (`EVEREE_WEBHOOK_SECRET_${id}`).
    expect(
      pickEvereeTenantIdFromEnvelope({
        id: 'evt_1',
        type: 'worker.onboarding-completed',
        companyId: 3133,
      }),
    ).to.equal('3133');
  });

  it('still accepts the legacy tenantId field (pilot envelopes)', () => {
    // A handful of pre-canonical pilot envelopes used `tenantId`;
    // accepting it during back-fills is cheap insurance.
    expect(
      pickEvereeTenantIdFromEnvelope({
        id: 'evt_1',
        type: 'worker.onboarding-completed',
        tenantId: '3133',
      }),
    ).to.equal('3133');
  });

  it('prefers the canonical companyId over a legacy tenantId when both are present', () => {
    // Defensive ordering — if Everee ever sends both during a deprecation
    // window, the canonical field wins. Otherwise we'd silently route to
    // whatever the legacy value points at.
    expect(
      pickEvereeTenantIdFromEnvelope({
        id: 'evt_1',
        type: 'worker.onboarding-completed',
        companyId: 3133,
        tenantId: '9999',
      }),
    ).to.equal('3133');
  });

  it('returns null when no recognizable tenant id is present', () => {
    expect(
      pickEvereeTenantIdFromEnvelope({
        id: 'evt_1',
        type: 'worker.onboarding-completed',
      }),
    ).to.equal(null);
  });

  it('rejects non-finite numeric ids and empty strings', () => {
    expect(
      pickEvereeTenantIdFromEnvelope({
        id: 'evt_1',
        companyId: NaN,
        tenantId: '   ',
      }),
    ).to.equal(null);
  });
});

describe('WH.1 — isWebhookTimestampWithinTolerance (replay-protection)', () => {
  // The replay-protection window matches Everee's "Securing your handler"
  // recommendation (≤ 2 minutes). These tests exercise both directions of
  // skew so a bogus negative-skew check (clocks behind Everee) doesn't
  // silently regress to "always accept".

  it('accepts timestamps within ±tolerance of now', () => {
    const now = 1_777_700_000;
    expect(isWebhookTimestampWithinTolerance(String(now), now, 120)).to.equal(true);
    expect(isWebhookTimestampWithinTolerance(String(now - 60), now, 120)).to.equal(true);
    expect(isWebhookTimestampWithinTolerance(String(now + 60), now, 120)).to.equal(true);
  });

  it('rejects timestamps older than tolerance', () => {
    const now = 1_777_700_000;
    expect(isWebhookTimestampWithinTolerance(String(now - 121), now, 120)).to.equal(false);
  });

  it('rejects timestamps further into the future than tolerance', () => {
    const now = 1_777_700_000;
    expect(isWebhookTimestampWithinTolerance(String(now + 121), now, 120)).to.equal(false);
  });

  it('rejects when the timestamp is missing or malformed', () => {
    const now = 1_777_700_000;
    expect(isWebhookTimestampWithinTolerance(null, now, 120)).to.equal(false);
    expect(isWebhookTimestampWithinTolerance('', now, 120)).to.equal(false);
    expect(isWebhookTimestampWithinTolerance('not-a-number', now, 120)).to.equal(false);
  });
});

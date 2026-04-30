/**
 * `canonicalEvereeOrigin` — origin-canonicalization helper.
 *
 * The pinned cases below are not theoretical: Everee's session-create API has
 * been observed returning `'https://app.everee.com/'` (with trailing slash)
 * for some tenants, while `MessageEvent.origin` is **never** trailing-slashed
 * per RFC 6454. Without canonicalization on the host side, every postMessage
 * from the iframe was rejected and the embed stalled at the loading spinner
 * (no visible error toast, no recovery path). These tests guarantee anyone
 * who removes the canonicalizer in the future gets a red CI.
 */

import { canonicalEvereeOrigin } from '../hostMessageBridge';

describe('canonicalEvereeOrigin', () => {
  it('strips a trailing slash (the original outage)', () => {
    expect(canonicalEvereeOrigin('https://app.everee.com/')).toBe('https://app.everee.com');
  });

  it('passes through an already-canonical origin unchanged', () => {
    expect(canonicalEvereeOrigin('https://app.everee.com')).toBe('https://app.everee.com');
  });

  it('produces the same canonical form for slashed and unslashed inputs', () => {
    expect(canonicalEvereeOrigin('https://app.everee.com/')).toBe(
      canonicalEvereeOrigin('https://app.everee.com'),
    );
  });

  it('strips path/query/hash and keeps only the origin', () => {
    expect(canonicalEvereeOrigin('https://app.everee.com/embedded')).toBe(
      'https://app.everee.com',
    );
    expect(canonicalEvereeOrigin('https://app.everee.com/embedded/')).toBe(
      'https://app.everee.com',
    );
    expect(canonicalEvereeOrigin('https://app.everee.com/embedded?token=abc')).toBe(
      'https://app.everee.com',
    );
    expect(canonicalEvereeOrigin('https://app.everee.com/embedded#section')).toBe(
      'https://app.everee.com',
    );
  });

  it('strips default ports (443 for https, 80 for http)', () => {
    expect(canonicalEvereeOrigin('https://app.everee.com:443/')).toBe('https://app.everee.com');
    expect(canonicalEvereeOrigin('http://app.everee.com:80/')).toBe('http://app.everee.com');
  });

  it('preserves non-default ports', () => {
    expect(canonicalEvereeOrigin('https://app.everee.com:8443/')).toBe(
      'https://app.everee.com:8443',
    );
  });

  it('trims surrounding whitespace before parsing', () => {
    expect(canonicalEvereeOrigin('   https://app.everee.com/   ')).toBe('https://app.everee.com');
  });

  it('returns empty string for empty / whitespace-only / null / undefined', () => {
    expect(canonicalEvereeOrigin(undefined)).toBe('');
    expect(canonicalEvereeOrigin(null)).toBe('');
    expect(canonicalEvereeOrigin('')).toBe('');
    expect(canonicalEvereeOrigin('   ')).toBe('');
    expect(canonicalEvereeOrigin('\n\t')).toBe('');
  });

  it('returns empty string for unparseable inputs (invalid URL, non-string)', () => {
    expect(canonicalEvereeOrigin('not a url')).toBe('');
    expect(canonicalEvereeOrigin('app.everee.com')).toBe(''); // missing scheme
    expect(canonicalEvereeOrigin(123)).toBe('');
    expect(canonicalEvereeOrigin({})).toBe('');
    expect(canonicalEvereeOrigin([])).toBe('');
  });
});

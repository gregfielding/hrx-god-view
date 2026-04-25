/**
 * Phase C.1b unit tests for the `licensesFieldChanged` short-circuit detector.
 *
 * The trigger fires on every `users/{uid}` write (avatar updates, phone
 * verification, etc.). Most of those don't touch licenses. This detector is
 * the cheap exit that prevents the expensive multi-tenant fan-out from
 * running unnecessarily.
 *
 * The trigger's I/O paths (`recomputeMatchItemsForWorker` + tenant fan-out)
 * are exercised end-to-end in the emulator / production logs; a unit test
 * here would mostly be admin-SDK mock theater.
 *
 * Mocha + Chai per `functions/package.json` test script.
 */

import { expect } from 'chai';
import { licensesFieldChanged } from '../../readiness/onUserLicensesChangeRefreshAssignments';

const cdlA = {
  schemaVersion: 1,
  licenseClass: 'CDL Class A',
  endorsements: ['H'],
  expirationDate: '2028-06-15',
};

const forklift = {
  schemaVersion: 1,
  licenseClass: 'Forklift',
};

describe('licensesFieldChanged — short-circuit', () => {
  it('returns false when both sides have no licenses', () => {
    expect(licensesFieldChanged({}, {})).to.be.false;
    expect(licensesFieldChanged({ licenses: [] }, {})).to.be.false;
    expect(licensesFieldChanged({}, { licenses: [] })).to.be.false;
    expect(licensesFieldChanged({ licenses: [] }, { licenses: [] })).to.be.false;
  });

  it('returns false when before/after have the same licenses (same order)', () => {
    expect(
      licensesFieldChanged({ licenses: [cdlA, forklift] }, { licenses: [cdlA, forklift] }),
    ).to.be.false;
  });

  it('returns false when licenses are reordered (sort-normalized)', () => {
    expect(
      licensesFieldChanged({ licenses: [cdlA, forklift] }, { licenses: [forklift, cdlA] }),
    ).to.be.false;
  });

  it('returns false when the user doc is null on both sides', () => {
    expect(licensesFieldChanged(null, null)).to.be.false;
  });

  it('returns true when a license is added', () => {
    expect(
      licensesFieldChanged({ licenses: [cdlA] }, { licenses: [cdlA, forklift] }),
    ).to.be.true;
  });

  it('returns true when a license is removed', () => {
    expect(
      licensesFieldChanged({ licenses: [cdlA, forklift] }, { licenses: [cdlA] }),
    ).to.be.true;
  });

  it('returns true when a license endorsement set changes', () => {
    const cdlAWithMore = { ...cdlA, endorsements: ['H', 'X'] };
    expect(
      licensesFieldChanged({ licenses: [cdlA] }, { licenses: [cdlAWithMore] }),
    ).to.be.true;
  });

  it('returns true when expirationDate changes (renewal)', () => {
    const renewed = { ...cdlA, expirationDate: '2030-06-15' };
    expect(
      licensesFieldChanged({ licenses: [cdlA] }, { licenses: [renewed] }),
    ).to.be.true;
  });

  it('returns true when first license is added (empty → non-empty)', () => {
    expect(licensesFieldChanged({}, { licenses: [cdlA] })).to.be.true;
    expect(licensesFieldChanged({ licenses: [] }, { licenses: [cdlA] })).to.be.true;
  });

  it('returns true when last license is removed (non-empty → empty)', () => {
    expect(licensesFieldChanged({ licenses: [cdlA] }, {})).to.be.true;
  });

  it('ignores unrelated user fields (avatar, phone, etc.)', () => {
    expect(
      licensesFieldChanged(
        { profilePhotoUrl: 'a.jpg', licenses: [cdlA] },
        { profilePhotoUrl: 'b.jpg', licenses: [cdlA] },
      ),
    ).to.be.false;
  });

  it('drops malformed license entries (no licenseClass) before comparing', () => {
    expect(
      licensesFieldChanged(
        { licenses: [cdlA, { foo: 'bar' }] },
        { licenses: [cdlA] },
      ),
    ).to.be.false;
  });

  it('returns true when before is null but after has licenses (worker created)', () => {
    expect(licensesFieldChanged(null, { licenses: [cdlA] })).to.be.true;
  });
});

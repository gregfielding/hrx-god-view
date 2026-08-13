/**
 * Pin the worked-shift id parser against Everee's actual wire form.
 *
 * Everee serializes `workedShiftId` as a JSON STRING ("4071156") — the
 * original number-only check parsed every POST response to 0, which
 * cascaded into: status docs + entries storing 0, void/revert throwing
 * "No Everee worked-shift id recorded", and grid retries POSTing
 * duplicate shifts instead of PUTting (2026-08-13 Zaon Cox). These tests
 * keep both wire forms accepted and garbage rejected.
 */

import { expect } from 'chai';

import { parseWorkedShiftId } from '../../integrations/everee/evereeWorkedShifts';

describe('parseWorkedShiftId', () => {
  it('accepts the string form Everee actually sends', () => {
    expect(parseWorkedShiftId('4071156')).to.equal(4071156);
    expect(parseWorkedShiftId(' 4099069 ')).to.equal(4099069);
  });

  it('accepts a plain number', () => {
    expect(parseWorkedShiftId(4071156)).to.equal(4071156);
  });

  it('returns 0 for zero, negatives, and non-ids', () => {
    expect(parseWorkedShiftId(0)).to.equal(0);
    expect(parseWorkedShiftId('0')).to.equal(0);
    expect(parseWorkedShiftId(-5)).to.equal(0);
    expect(parseWorkedShiftId('-5')).to.equal(0);
    expect(parseWorkedShiftId('12.5')).to.equal(0);
    expect(parseWorkedShiftId('4071156x')).to.equal(0);
    expect(parseWorkedShiftId('')).to.equal(0);
    expect(parseWorkedShiftId(null)).to.equal(0);
    expect(parseWorkedShiftId(undefined)).to.equal(0);
    expect(parseWorkedShiftId(NaN)).to.equal(0);
    expect(parseWorkedShiftId({ workedShiftId: '4071156' })).to.equal(0);
  });
});

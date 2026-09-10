/**
 * AI hiring monitor (2026-09-10, Illinois) — pure selection-rate math. No Firestore.
 */
import { expect } from 'chai';

import {
  ageBandFromDob,
  computeSelectionRates,
  isIllinoisPosting,
  postingStateCode,
} from '../../compliance/aiHiringMonitor';
import type { MonitorApplicant } from '../../compliance/aiHiringMonitor';

const applicant = (over: Partial<MonitorApplicant> = {}): MonitorApplicant => ({
  raceEthnicity: null,
  sex: null,
  ageBand: null,
  promoted: false,
  hired: false,
  ...over,
});
const many = (n: number, over: Partial<MonitorApplicant>) => Array.from({ length: n }, () => applicant(over));

describe('aiHiringMonitor — computeSelectionRates', () => {
  it('computes rates and flags a group below four-fifths of the best group', () => {
    const rows = [
      ...many(6, { sex: 'male', hired: true }),
      ...many(4, { sex: 'male' }), // male hire rate 0.6
      ...many(3, { sex: 'female', hired: true }),
      ...many(7, { sex: 'female' }), // female hire rate 0.3 → ratio 0.5
    ];
    const r = computeSelectionRates(rows, (a) => a.sex);
    const male = r.groups.find((g) => g.group === 'male')!;
    const female = r.groups.find((g) => g.group === 'female')!;
    expect(male.hireRate).to.equal(0.6);
    expect(male.hireImpactRatio).to.equal(1);
    expect(male.flag).to.equal('ok');
    expect(female.hireRate).to.equal(0.3);
    expect(female.hireImpactRatio).to.equal(0.5);
    expect(female.flag).to.equal('below_four_fifths');
  });

  it('never compares groups under the minimum size, declined, or unanswered applicants', () => {
    const rows = [
      ...many(10, { raceEthnicity: 'white', promoted: true }),
      ...many(2, { raceEthnicity: 'asian' }),
      ...many(3, { raceEthnicity: 'decline' }),
      ...many(4, {}),
    ];
    const r = computeSelectionRates(rows, (a) => a.raceEthnicity);
    const asian = r.groups.find((g) => g.group === 'asian')!;
    expect(asian.flag).to.equal('too_few');
    expect(asian.promotionImpactRatio).to.equal(null);
    expect(r.declined).to.equal(3);
    expect(r.unanswered).to.equal(4);
    expect(r.groups.map((g) => g.group)).to.not.include('decline');
  });

  it('leaves impact ratios empty when no comparable group has any selections', () => {
    const r = computeSelectionRates([...many(5, { sex: 'male' }), ...many(5, { sex: 'female' })], (a) => a.sex);
    expect(r.groups.every((g) => g.hireImpactRatio === null && g.flag === 'ok')).to.equal(true);
  });
});

describe('aiHiringMonitor — helpers', () => {
  it('bands age at 40 from a date of birth, respecting the birthday', () => {
    const now = new Date('2026-09-10T12:00:00Z');
    expect(ageBandFromDob('1986-09-10', now)).to.equal('40_plus');
    expect(ageBandFromDob('1986-12-31', now)).to.equal('under_40');
    expect(ageBandFromDob('not a date', now)).to.equal(null);
    expect(ageBandFromDob(undefined, now)).to.equal(null);
  });

  it('recognizes Illinois postings from the top-level state or the worksite address', () => {
    expect(isIllinoisPosting({ state: 'IL' })).to.equal(true);
    expect(isIllinoisPosting({ worksiteAddress: { state: 'Illinois' } })).to.equal(true);
    expect(isIllinoisPosting({ state: 'il ' })).to.equal(true);
    expect(isIllinoisPosting({ state: 'IN' })).to.equal(false);
    expect(postingStateCode({})).to.equal('');
  });
});

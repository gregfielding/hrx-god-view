/**
 * PI-4 — shift dressing resolution (pure module, no Firestore).
 * Fixtures mirror real prod data: Domino's CO inbox JO carries
 * gigPositions [{Warehouse Associate 23/31.74}, {Production Associate
 * 22/30.36}]; CORT child accounts carry cascade pricing with
 * flatMarkupPercent 38 and zero-rate position stubs.
 */

import { expect } from 'chai';

import {
  matchPosition,
  resolveShiftDressing,
} from '../../../integrations/indeedFlex/shiftDressing';

const DOMINOS_JO_POSITIONS = [
  { jobTitle: 'Warehouse Associate', payRate: '23', billRate: '31.74' },
  { jobTitle: 'Production Associate', payRate: '22', billRate: '30.36' },
];

describe('shiftDressing — matchPosition', () => {
  it("shared-token match: Indeed's 'Warehouse Operative' finds 'Warehouse Associate'", () => {
    const hit = matchPosition('Warehouse Operative', DOMINOS_JO_POSITIONS);
    expect(hit?.jobTitle).to.equal('Warehouse Associate');
  });

  it('no confident match when a token is shared by several positions', () => {
    const hit = matchPosition('Associate', DOMINOS_JO_POSITIONS);
    expect(hit).to.equal(null); // 'associate' is in both — ambiguous
  });
});

describe('shiftDressing — resolveShiftDressing', () => {
  it('JO position supplies pay AND its own bill when pay is unchanged', () => {
    const d = resolveShiftDressing({
      roleName: 'Warehouse Operative',
      joGigPositions: DOMINOS_JO_POSITIONS,
    });
    expect(d.payRate).to.equal(23);
    expect(d.billRate).to.equal(31.74);
    expect(d.paySource).to.equal('jo_position');
  });

  it('email pay wins and bill is re-derived from the markup, not the stale position bill', () => {
    const d = resolveShiftDressing({
      roleName: 'Warehouse Operative',
      emailPayRate: 25,
      joGigPositions: [
        { jobTitle: 'Warehouse Associate', payRate: '23', billRate: '31.74', markupPercent: 38 },
      ],
    });
    expect(d.payRate).to.equal(25);
    expect(d.billRate).to.equal(34.5); // 25 × 1.38 — NOT 31.74
    expect(d.paySource).to.equal('email');
  });

  it('falls through to account pricing + flat markup when the JO has no positions', () => {
    const d = resolveShiftDressing({
      roleName: 'Event Crew',
      emailPayRate: 20,
      joGigPositions: [],
      accountPricing: { flatMarkupPercent: 38, positions: [] },
    });
    expect(d.payRate).to.equal(20);
    expect(d.billRate).to.equal(27.6); // 20 × 1.38
  });

  it('resolves nothing when there is no rate anywhere — never invents numbers', () => {
    const d = resolveShiftDressing({
      roleName: 'Event Crew',
      joGigPositions: [],
      accountPricing: { flatMarkupPercent: 38, positions: [] },
    });
    expect(d.payRate).to.equal(undefined);
    expect(d.billRate).to.equal(undefined);
  });

  it('wcCode comes from the matched position', () => {
    const d = resolveShiftDressing({
      roleName: 'Warehouse Operative',
      joGigPositions: [
        { jobTitle: 'Warehouse Associate', payRate: 23, billRate: 31.74, workersCompCode: '8292' },
      ],
    });
    expect(d.wcCode).to.equal('8292');
  });
});

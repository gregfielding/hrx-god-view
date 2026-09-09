/**
 * Jobs-board per-position shift pairing (2026-09-09). Fixtures mirror prod:
 * OnTrac JO #501 (one position, Flex-named shifts) and Domino's #41 (two
 * positions, one Warehouse Associate shift).
 *
 * @see shared/jobOrder/matchPositionTitle.ts
 */
import { matchPosition, shiftBelongsToPosition } from '../jobOrder/matchPositionTitle';

const ONTRAC = [{ jobTitle: 'Package Handler (Warehouse Operative)' }];
const DOMINOS = [{ jobTitle: 'Warehouse Associate' }, { jobTitle: 'Production Associate' }];
const SLAMMERS = [{ jobTitle: 'Dishwashers' }, { jobTitle: 'Food Preparation Workers' }, { jobTitle: 'Cashier' }];

describe('shiftBelongsToPosition', () => {
  it('posting without a position sees every shift', () => {
    expect(shiftBelongsToPosition({ shiftJobTitle: 'Anything', positionJobTitle: '', gigPositions: DOMINOS })).toBe(true);
  });

  it('exact title (case/space-insensitive) pairs', () => {
    expect(shiftBelongsToPosition({ shiftJobTitle: ' warehouse associate ', positionJobTitle: 'Warehouse Associate', gigPositions: DOMINOS })).toBe(true);
  });

  it('single-position JO: a Flex-named shift still belongs (OnTrac #501)', () => {
    expect(shiftBelongsToPosition({ shiftJobTitle: 'Warehouse Operative', positionJobTitle: 'Package Handler (Warehouse Operative)', gigPositions: ONTRAC })).toBe(true);
  });

  it('single-position JO: even an unrelated title belongs', () => {
    expect(shiftBelongsToPosition({ shiftJobTitle: 'Forklift', positionJobTitle: 'Warehouse Associate', gigPositions: [{ jobTitle: 'Warehouse Associate' }] })).toBe(true);
  });

  it('untitled shift shows on every position posting (Slammers #188)', () => {
    for (const p of SLAMMERS) {
      expect(shiftBelongsToPosition({ shiftJobTitle: '', positionJobTitle: p.jobTitle, gigPositions: SLAMMERS })).toBe(true);
    }
  });

  it("multi-position JO: a shift for another position stays hidden (Domino's #41)", () => {
    expect(shiftBelongsToPosition({ shiftJobTitle: 'Warehouse Associate', positionJobTitle: 'Production Associate', gigPositions: DOMINOS })).toBe(false);
    expect(shiftBelongsToPosition({ shiftJobTitle: 'Warehouse Associate', positionJobTitle: 'Warehouse Associate', gigPositions: DOMINOS })).toBe(true);
  });

  it('multi-position JO: loose resolution pairs a Flex name with the unique containing position', () => {
    const positions = [{ jobTitle: 'Package Handler (Warehouse Operative)' }, { jobTitle: 'Forklift Operator' }];
    expect(shiftBelongsToPosition({ shiftJobTitle: 'Warehouse Operative', positionJobTitle: 'Package Handler (Warehouse Operative)', gigPositions: positions })).toBe(true);
    expect(shiftBelongsToPosition({ shiftJobTitle: 'Warehouse Operative', positionJobTitle: 'Forklift Operator', gigPositions: positions })).toBe(false);
  });

  it('multi-position JO: an ambiguous title resolves to nothing and is hidden from all', () => {
    expect(shiftBelongsToPosition({ shiftJobTitle: 'Associate', positionJobTitle: 'Warehouse Associate', gigPositions: DOMINOS })).toBe(false);
  });
});

describe('matchPosition', () => {
  it('exact beats containment', () => {
    expect(matchPosition('Warehouse Associate', DOMINOS)?.jobTitle).toBe('Warehouse Associate');
  });
  it('returns null on ambiguity', () => {
    expect(matchPosition('Associate', DOMINOS)).toBeNull();
  });
});

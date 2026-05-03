import {
  mergeParentAndChildPricingPositions,
  mergeNationalTemplateWithChildVenueRow,
  extractAccountPricingPositions,
} from '../accountPricingForJobOrder';

describe('accountPricingForJobOrder', () => {
  describe('mergeParentAndChildPricingPositions', () => {
    it('overlays child pay rates onto national template rows by title', () => {
      const parent = [
        {
          jobTitle: 'Event Worker',
          payRate: 0,
          billRate: 0,
          markupPercent: null,
          jobDescriptionFromClient: 'National JD',
        },
      ];
      const child = [
        {
          jobTitle: 'Event Worker',
          payRate: 18,
          billRate: 22.5,
          markupPercent: 25,
          jobDescriptionFromClient: null,
        },
      ];
      const merged = mergeParentAndChildPricingPositions(parent, child);
      expect(merged).toHaveLength(1);
      expect(merged[0].jobTitle).toBe('Event Worker');
      expect(merged[0].payRate).toBe(18);
      expect(merged[0].jobDescriptionFromClient).toBe('National JD');
    });

    it('appends child-only titles after national templates', () => {
      const parent = [{ jobTitle: 'A', payRate: 10, billRate: 12, markupPercent: null }];
      const child = [
        { jobTitle: 'A', payRate: 11, billRate: 13, markupPercent: null },
        { jobTitle: 'Venue Only', payRate: 20, billRate: 25, markupPercent: null },
      ];
      const merged = mergeParentAndChildPricingPositions(parent, child);
      expect(merged.map((m) => m.jobTitle)).toEqual(['A', 'Venue Only']);
    });

    it('does not wipe child WC when national row carries empty WC fields', () => {
      const parent = [
        {
          jobTitle: 'Warehouse Associate',
          payRate: 15,
          billRate: 18,
          markupPercent: 20,
          workersCompCode: '',
          workersCompRate: null,
          jobDescriptionFromClient: 'National JD update',
        },
      ];
      const child = [
        {
          jobTitle: 'Warehouse Associate',
          payRate: 18,
          billRate: 24,
          markupPercent: 38,
          workersCompCode: '8044',
          workersCompRate: 2.25,
        },
      ];
      const merged = mergeParentAndChildPricingPositions(parent, child);
      expect(merged).toHaveLength(1);
      expect(merged[0].workersCompCode).toBe('8044');
      expect(merged[0].workersCompRate).toBe(2.25);
      expect(merged[0].jobDescriptionFromClient).toBe('National JD update');
    });
  });

  describe('mergeNationalTemplateWithChildVenueRow', () => {
    it('treats national empty WC code as absent when child omits WC fields', () => {
      const nat = {
        jobTitle: 'Warehouse Associate',
        payRate: 15,
        billRate: 18,
        markupPercent: null,
        workersCompCode: '',
        workersCompRate: undefined,
      };
      const child = {
        jobTitle: 'Warehouse Associate',
        payRate: 18,
        billRate: 22,
        markupPercent: 25,
      };
      const m = mergeNationalTemplateWithChildVenueRow(nat, child);
      expect(m.workersCompCode).toBeUndefined();
      expect(m.payRate).toBe(18);
    });
  });

  describe('extractAccountPricingPositions', () => {
    it('returns empty when positions missing', () => {
      expect(extractAccountPricingPositions({})).toEqual([]);
    });
  });
});

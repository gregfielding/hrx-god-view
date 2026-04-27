import { mergeAssignmentScreeningFromJobOrder } from '../assignmentScreeningSignals';

describe('mergeAssignmentScreeningFromJobOrder', () => {
  it('turns on background when job order has packages only', () => {
    const out = mergeAssignmentScreeningFromJobOrder(
      {},
      { backgroundCheckPackages: [{ title: 'Basic', description: '' }] }
    );
    expect(out.showBackgroundChecks).toBe(true);
    expect(out.drugScreenRequired).toBe(false);
  });

  it('turns on drug when job order has panels only', () => {
    const out = mergeAssignmentScreeningFromJobOrder({}, { drugScreeningPanels: ['4-Panel'] });
    expect(out.drugScreenRequired).toBe(true);
    expect(out.showBackgroundChecks).toBe(false);
  });

  it('respects assignment flags without job order', () => {
    expect(
      mergeAssignmentScreeningFromJobOrder({ backgroundCheckRequired: true }, null).showBackgroundChecks
    ).toBe(true);
    expect(mergeAssignmentScreeningFromJobOrder({ showDrugScreening: true }, null).drugScreenRequired).toBe(true);
  });
});

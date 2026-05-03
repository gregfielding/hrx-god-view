import { expect } from 'chai';

import {
  buildChildCascadePatch,
  isBlankDefaultString,
  mergeBillingDefaultsFillEmpty,
  mergeOrderDefaultsFillEmpty,
  mergeRulesDefaultsFillEmpty,
} from '../../accounts/nationalChildCascadeMerge';

describe('nationalChildCascadeMerge', () => {
  it('fills empty child screening package from parent', () => {
    const patch = buildChildCascadePatch({
      child: { orderDefaults: {} },
      parent: {
        orderDefaults: {
          screeningPackageId: 'pkg1',
          screeningPackageName: 'Standard',
        },
      },
    });
    expect(patch?.orderDefaults?.screeningPackageId).to.equal('pkg1');
  });

  it('does not overwrite child screening package when set', () => {
    const patch = buildChildCascadePatch({
      child: {
        orderDefaults: {
          screeningPackageId: 'childPkg',
          screeningPackageName: 'Child',
        },
      },
      parent: {
        orderDefaults: {
          screeningPackageId: 'pkg1',
          screeningPackageName: 'Standard',
        },
      },
    });
    expect(patch).to.equal(null);
  });

  it('fills empty orderDetails arrays only', () => {
    const merged = mergeOrderDefaultsFillEmpty(
      { orderDetails: {} },
      {
        orderDetails: {
          additionalScreenings: ['Drug'],
          physicalRequirements: ['Standing'],
        },
      },
    );
    expect(merged?.orderDetails).to.deep.include({
      additionalScreenings: ['Drug'],
      physicalRequirements: ['Standing'],
    });
  });

  it('does not overwrite non-empty additionalScreenings on child', () => {
    const merged = mergeOrderDefaultsFillEmpty(
      {
        orderDetails: {
          additionalScreenings: ['Existing'],
        },
      },
      {
        orderDetails: {
          additionalScreenings: ['Drug'],
        },
      },
    );
    expect((merged?.orderDetails as any)?.additionalScreenings).to.deep.equal(['Existing']);
  });

  it('fills hiring entity on child when empty', () => {
    const patch = buildChildCascadePatch({
      child: {},
      parent: { hiringEntityId: 'he_national' },
    });
    expect(patch?.hiringEntityId).to.equal('he_national');
  });

  it('fills staff instruction text when child section empty', () => {
    const merged = mergeOrderDefaultsFillEmpty(
      {},
      {
        staffInstructions: {
          firstDay: { text: 'Bring ID', files: [] },
        },
      },
    );
    expect((merged?.staffInstructions as any)?.firstDay?.text).to.equal('Bring ID');
  });

  it('does not patch orderDefaults when parent and child both empty', () => {
    const patch = buildChildCascadePatch({
      child: {},
      parent: { orderDefaults: {} },
    });
    expect(patch).to.equal(null);
  });

  it('fills default gig title when child missing', () => {
    const patch = buildChildCascadePatch({
      child: {},
      parent: { defaultGigJobTitle: 'Warehouse Associate' },
    });
    expect(patch?.defaultGigJobTitle).to.equal('Warehouse Associate');
  });

  it('fills empty billing string fields from parent', () => {
    const merged = mergeBillingDefaultsFillEmpty(
      { paymentTerms: '', invoiceFrequency: '' },
      { paymentTerms: 'Net 30', invoiceFrequency: 'monthly' },
    );
    expect(merged?.paymentTerms).to.equal('Net 30');
    expect(merged?.invoiceFrequency).to.equal('monthly');
  });

  it('does not overwrite existing child poRequired false', () => {
    const patch = buildChildCascadePatch({
      child: { defaults: { billing: { poRequired: false } } },
      parent: { defaults: { billing: { poRequired: true } } },
    });
    expect(patch).to.equal(null);
  });

  it('fills sendInvoicesTo when child empty', () => {
    const patch = buildChildCascadePatch({
      child: {},
      parent: { defaults: { billing: { sendInvoicesTo: ['c1', 'c2'] } } },
    });
    expect((patch?.defaults as any)?.billing?.sendInvoicesTo).to.deep.equal(['c1', 'c2']);
  });

  it('fills empty rules text fields from parent', () => {
    const merged = mergeRulesDefaultsFillEmpty(
      { attendancePolicy: '', disciplinePolicy: '' },
      { attendancePolicy: 'Standard', disciplinePolicy: 'Progressive' },
    );
    expect(merged?.attendancePolicy).to.equal('Standard');
    expect(merged?.disciplinePolicy).to.equal('Progressive');
  });

  it('fills disciplinePolicy when child value is only zero-width / BOM characters', () => {
    const merged = mergeRulesDefaultsFillEmpty(
      { disciplinePolicy: '\u200b\u200b' },
      { disciplinePolicy: 'National discipline text' },
    );
    expect(merged?.disciplinePolicy).to.equal('National discipline text');
    expect(isBlankDefaultString('\u200b')).to.equal(true);
    expect(isBlankDefaultString('\u00a0')).to.equal(true);
  });

  it('does not overwrite child rules booleans when already set', () => {
    const patch = buildChildCascadePatch({
      child: { defaults: { rules: { replacingExistingAgency: false } } },
      parent: { defaults: { rules: { replacingExistingAgency: true } } },
    });
    expect(patch).to.equal(null);
  });

  it('fills rules from parent when child missing keys', () => {
    const patch = buildChildCascadePatch({
      child: {},
      parent: {
        defaults: {
          rules: {
            replacingExistingAgency: true,
            attendancePolicy: 'Strict',
          },
        },
      },
    });
    const rules = (patch?.defaults as any)?.rules;
    expect(rules?.replacingExistingAgency).to.equal(true);
    expect(rules?.attendancePolicy).to.equal('Strict');
  });

  it('backfills accountType:child on legacy auto-created children with parentAccountId set', () => {
    const patch = buildChildCascadePatch({
      child: { parentAccountId: 'nat1' },
      parent: { defaults: { rules: { disciplinePolicy: 'Strict' } } },
    });
    expect(patch?.accountType).to.equal('child');
  });

  it('does not touch accountType when child already has it set', () => {
    const patch = buildChildCascadePatch({
      child: { accountType: 'child', parentAccountId: 'nat1', defaults: { rules: { disciplinePolicy: '' } } },
      parent: { defaults: { rules: { disciplinePolicy: 'Strict' } } },
    });
    expect(patch?.accountType).to.equal(undefined);
  });
});

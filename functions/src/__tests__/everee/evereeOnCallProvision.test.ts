/**
 * Everee on-call helpers — address extraction + worker-type resolution.
 */

import { expect } from 'chai';

import { extractEvereeHomeAddressFromUserDoc } from '../../integrations/everee/evereeUserAddress';
import { resolveEvereeWorkerTypeForOnCall } from '../../integrations/everee/evereeEntityWorkerType';

describe('Everee on-call provision helpers', () => {
  it('extractEvereeHomeAddressFromUserDoc returns null when incomplete', () => {
    expect(extractEvereeHomeAddressFromUserDoc(undefined)).to.equal(null);
    expect(extractEvereeHomeAddressFromUserDoc({ addressInfo: {} })).to.equal(null);
  });

  it('extractEvereeHomeAddressFromUserDoc maps addressInfo to Everee shape', () => {
    const addr = extractEvereeHomeAddressFromUserDoc({
      addressInfo: {
        streetAddress: '100 Main St',
        city: 'Austin',
        state: 'TX',
        zip: '78701',
      },
    });
    expect(addr).to.deep.equal({
      line1: '100 Main St',
      city: 'Austin',
      state: 'TX',
      postalCode: '78701',
    });
  });

  it('resolveEvereeWorkerTypeForOnCall uses c1_events_llc → contractor', () => {
    expect(resolveEvereeWorkerTypeForOnCall('c1_events_llc', {})).to.equal('contractor');
  });

  it('resolveEvereeWorkerTypeForOnCall defaults to employee for other entities', () => {
    expect(resolveEvereeWorkerTypeForOnCall('c1_select_llc', {})).to.equal('employee');
  });

  it('resolveEvereeWorkerTypeForOnCall respects entity doc overrides', () => {
    expect(resolveEvereeWorkerTypeForOnCall('custom_ent', { evereeWorkerKind: 'contractor' })).to.equal(
      'contractor',
    );
    expect(resolveEvereeWorkerTypeForOnCall('custom_ent', { payrollWorkerClassification: 'w2' })).to.equal(
      'employee',
    );
  });
});

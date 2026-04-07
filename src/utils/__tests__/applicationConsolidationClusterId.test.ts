import {
  fingerprintForConsolidationDoc,
  makeConsolidationClusterId,
} from '../applicationConsolidationClusterId';

describe('applicationConsolidationClusterId', () => {
  it('is deterministic for sorted fingerprints regardless of input order', () => {
    const a = makeConsolidationClusterId('t1', 'jo1', [
      fingerprintForConsolidationDoc('nested', 'n1'),
      fingerprintForConsolidationDoc('tenant', 'a2'),
    ]);
    const b = makeConsolidationClusterId('t1', 'jo1', [
      fingerprintForConsolidationDoc('tenant', 'a2'),
      fingerprintForConsolidationDoc('nested', 'n1'),
    ]);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  it('changes when tenantId, jobOrderId, or membership changes', () => {
    const base = [
      fingerprintForConsolidationDoc('nested', 'n1'),
      fingerprintForConsolidationDoc('tenant', 'a2'),
    ];
    const c0 = makeConsolidationClusterId('t1', 'jo1', base);
    expect(makeConsolidationClusterId('t2', 'jo1', base)).not.toBe(c0);
    expect(makeConsolidationClusterId('t1', 'jo2', base)).not.toBe(c0);
    expect(
      makeConsolidationClusterId('t1', 'jo1', [
        ...base,
        fingerprintForConsolidationDoc('tenant', 'a3'),
      ]),
    ).not.toBe(c0);
  });
});

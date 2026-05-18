/**
 * `buildEvereeWorkLocationDocId` unit tests (TS.1.P4 Slice 3).
 *
 * Pure helper. Format is load-bearing for cache lookup correctness —
 * the same HRX worksite has a different Everee numeric id in each
 * company instance, so the cache MUST be scoped by Everee tenant id.
 * Drift in the format silently breaks the cache.
 */

import { expect } from 'chai';

import { buildEvereeWorkLocationDocId } from '../../integrations/everee/evereeWorkLocations';

describe('buildEvereeWorkLocationDocId', () => {
  it('produces the spec-pinned format', () => {
    expect(buildEvereeWorkLocationDocId('3133', 'worksite-123')).to.equal('3133__worksite-123');
  });

  it('produces distinct ids per Everee tenant for the same worksite', () => {
    const select = buildEvereeWorkLocationDocId('3133', 'worksite-123');
    const events = buildEvereeWorkLocationDocId('3138', 'worksite-123');
    expect(select).to.not.equal(events);
  });

  it('produces distinct ids per worksite for the same Everee tenant', () => {
    const a = buildEvereeWorkLocationDocId('3133', 'worksite-a');
    const b = buildEvereeWorkLocationDocId('3133', 'worksite-b');
    expect(a).to.not.equal(b);
  });

  it('is fully deterministic — same input → same output', () => {
    expect(buildEvereeWorkLocationDocId('3133', 'wid')).to.equal(
      buildEvereeWorkLocationDocId('3133', 'wid'),
    );
  });

  it('matches the {evereeTenantId}__{worksiteId} pattern visually', () => {
    const id = buildEvereeWorkLocationDocId('9999', 'CRM-LOC-007');
    expect(id.split('__')).to.deep.equal(['9999', 'CRM-LOC-007']);
  });
});

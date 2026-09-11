/**
 * claim_prepare (step 5, 2026-09-11) — mapping the readiness gate to the response.
 */
import { expect } from 'chai';
import { HttpsError } from 'firebase-functions/v2/https';

import { claimPrepareResultFrom } from '../../claims/claimReadiness';
import { claimError } from '../../claims/claimShiftPolicy';

describe('claimPrepareResultFrom', () => {
  it('a passed gate is ready', () => {
    expect(claimPrepareResultFrom({ passed: true, entityId: 'c1_events_llc' })).to.deep.equal({
      success: true,
      ready: true,
      stage: 'ready',
      entityId: 'c1_events_llc',
    });
  });

  it('setup_required becomes a not-ready response carrying stage + entity', () => {
    const started = claimPrepareResultFrom({
      passed: false,
      error: claimError('setup_required', 'x', { entityId: 'c1_events_llc', stage: 'started' }),
    });
    expect(started).to.deep.equal({ success: true, ready: false, stage: 'started', entityId: 'c1_events_llc' });
    const inProgress = claimPrepareResultFrom({ passed: false, error: claimError('setup_required', 'x', { stage: 'in_progress' }) });
    expect(inProgress.stage).to.equal('in_progress');
    expect(inProgress.entityId).to.equal(null);
  });

  it('every other refusal is rethrown unchanged', () => {
    const notHired = claimError('ineligible', 'x', { reason: 'not_hired' });
    expect(() => claimPrepareResultFrom({ passed: false, error: notHired })).to.throw(HttpsError);
    const boom = new Error('boom');
    expect(() => claimPrepareResultFrom({ passed: false, error: boom })).to.throw('boom');
  });
});

import { decideFlexAutoAccept, type FlexAutoAcceptCandidate } from '../../../integrations/indeedFlex/flexAutoAccept';

const TODAY = '2026-09-07';
const ACCT = 'autoLoc_c8063316925cd9db434ca0c2e80293d1';

function row(over: Partial<FlexAutoAcceptCandidate> = {}): FlexAutoAcceptCandidate {
  return {
    requestId: 'req1',
    eventType: 'new_request',
    status: 'needs_review',
    matchConfidence: 'exact',
    matchedAccountId: ACCT,
    matchedAccountName: 'OnTrac Denver',
    event: { jobId: '545618', headcount: 7, workDate: '2026-09-09' },
    ...over,
  };
}

describe('decideFlexAutoAccept', () => {
  it('is OFF unless app_config/indeed_flex.autoAcceptNewRequests is true', () => {
    expect(decideFlexAutoAccept(null, row(), TODAY)).toMatchObject({ accept: false });
    expect(decideFlexAutoAccept({}, row(), TODAY)).toMatchObject({ accept: false });
    expect(decideFlexAutoAccept({ autoAcceptNewRequests: false }, row(), TODAY)).toMatchObject({ accept: false });
  });

  it('accepts an exact-matched, future, numeric-job-id new_request with its headcount', () => {
    expect(decideFlexAutoAccept({ autoAcceptNewRequests: true }, row(), TODAY)).toEqual({
      accept: true,
      dryRun: false,
      flexJobId: '545618',
      headcount: 7,
    });
  });

  it('honours dry-run', () => {
    expect(decideFlexAutoAccept({ autoAcceptNewRequests: true, autoAcceptDryRun: true }, row(), TODAY)).toMatchObject({
      accept: true,
      dryRun: true,
    });
  });

  it('only fires for exact new_request rows that are still undecided', () => {
    const on = { autoAcceptNewRequests: true };
    expect(decideFlexAutoAccept(on, row({ eventType: 'change_time' }), TODAY).accept).toBe(false);
    expect(decideFlexAutoAccept(on, row({ matchConfidence: 'fuzzy' }), TODAY).accept).toBe(false);
    expect(decideFlexAutoAccept(on, row({ matchConfidence: 'none' }), TODAY).accept).toBe(false);
    expect(decideFlexAutoAccept(on, row({ status: 'applied' }), TODAY).accept).toBe(false);
    expect(decideFlexAutoAccept(on, row({ matchedAccountId: '' }), TODAY).accept).toBe(false);
  });

  it('skips stale requests (shift already ended) and non-numeric job ids', () => {
    const on = { autoAcceptNewRequests: true };
    expect(decideFlexAutoAccept(on, row({ event: { jobId: '1', workDate: '2026-09-06' } }), TODAY)).toMatchObject({
      accept: false,
      reason: expect.stringContaining('stale'),
    });
    // Multi-day: endDate governs.
    expect(
      decideFlexAutoAccept(on, row({ event: { jobId: '1', workDate: '2026-09-01', endDate: '2026-09-30' } }), TODAY).accept,
    ).toBe(true);
    expect(decideFlexAutoAccept(on, row({ event: { jobId: '', workDate: '2026-09-09' } }), TODAY).accept).toBe(false);
  });

  it('applies allow / exclude lists and the headcount ceiling', () => {
    expect(decideFlexAutoAccept({ autoAcceptNewRequests: true, autoAcceptAccountIds: ['other'] }, row(), TODAY).accept).toBe(false);
    expect(decideFlexAutoAccept({ autoAcceptNewRequests: true, autoAcceptAccountIds: [ACCT] }, row(), TODAY).accept).toBe(true);
    expect(decideFlexAutoAccept({ autoAcceptNewRequests: true, autoAcceptExcludeAccountIds: [ACCT] }, row(), TODAY).accept).toBe(false);
    expect(decideFlexAutoAccept({ autoAcceptNewRequests: true, autoAcceptMaxHeadcount: 5 }, row(), TODAY).accept).toBe(false);
    expect(decideFlexAutoAccept({ autoAcceptNewRequests: true, autoAcceptMaxHeadcount: 7 }, row(), TODAY).accept).toBe(true);
  });

  it('passes a null headcount through when the email had none (portal default = requested)', () => {
    expect(decideFlexAutoAccept({ autoAcceptNewRequests: true }, row({ event: { jobId: '9', workDate: '2026-09-09' } }), TODAY)).toMatchObject({
      accept: true,
      headcount: null,
    });
  });
});

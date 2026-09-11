import { applyLiveSignals, backgroundIsRelevant, readLiveSignals, type StepLike } from '../../natalie/onboardingLiveSignals';

/** Greg's real C1 Events mirror (read 2026-09-11): 1099 — no I-9, no W-4; W-9 + DD + handbook + policies done. */
const eventsMirror = {
  directDepositReady: true,
  directDepositVerifiedAt: { seconds: 1777494983 },
  i9SignedAt: null,
  i9Applicable: false,
  w4SignedAt: null,
  w4Applicable: false,
  w9SignedAt: { seconds: 1777494710 },
  w9Applicable: true,
  handbookSignedAt: { seconds: 1777495584 },
  policiesSignedCount: 2,
  onboardingComplete: true,
  onboardingStatus: 'COMPLETE',
};
/** The stale snapshot that texted him anyway. */
const staleSteps: StepLike[] = [
  { key: 'work_authorization', label: 'work authorization declaration', status: 'complete', actor: 'worker' },
  { key: 'i9', label: 'I-9 (your section)', status: 'missing', actor: 'worker' },
  { key: 'payroll_setup', label: 'Everee payroll setup (direct deposit)', status: 'in_progress', actor: 'worker' },
  { key: 'tax_form', label: 'tax forms (W-4)', status: 'missing', actor: 'worker' },
  { key: 'handbook', label: 'handbook signature', status: 'missing', actor: 'worker' },
  { key: 'policies', label: 'policies acknowledgment', status: 'missing', actor: 'worker' },
];
const statuses = (steps: StepLike[]) => Object.fromEntries(steps.map((s) => [s.key, s.status]));

describe('readLiveSignals', () => {
  it('reads a completed C1 Events (1099) worker out of the Everee mirror', () => {
    const live = readLiveSignals({ evereeMirror: eventsMirror });
    expect(live).toMatchObject({ i9Applicable: false, w4Applicable: false, payrollComplete: true, taxDone: true, handbookDone: true, policiesDone: true, onboardingComplete: true });
    expect(live.reasons).toContain('everee onboarding complete');
  });
  it('falls back to the employment row and the payroll account', () => {
    expect(readLiveSignals({ employment: { evereeOnboardingStatus: 'complete', taxIdentityStatus: 'complete' } })).toMatchObject({ payrollComplete: true, taxDone: true });
    expect(readLiveSignals({ payrollAccount: { payrollStatus: 'complete', taxFormStatus: 'submitted' } })).toMatchObject({ payrollComplete: true, taxDone: true });
  });
  it('a worker who has genuinely done nothing stays not-done, and I-9 stays applicable by default', () => {
    const live = readLiveSignals({ payrollAccount: { payrollStatus: 'invite_sent' }, employment: { status: 'onboarding' } });
    expect(live).toMatchObject({ payrollComplete: false, taxDone: false, i9Done: false, handbookDone: false, policiesDone: false, i9Applicable: true, inviteSent: true });
  });
});

describe('applyLiveSignals', () => {
  it("the stale snapshot that texted Greg is corrected: nothing left, and no I-9 for a 1099 worker", () => {
    const merged = applyLiveSignals(staleSteps, readLiveSignals({ evereeMirror: eventsMirror }));
    expect(statuses(merged)).toEqual({
      work_authorization: 'complete', i9: 'not_applicable', payroll_setup: 'complete', tax_form: 'complete', handbook: 'complete', policies: 'complete',
    });
    expect(merged.filter((s) => s.status !== 'complete' && s.status !== 'not_applicable')).toHaveLength(0);
  });
  it('only upgrades — a worker who still owes steps keeps owing them', () => {
    const live = readLiveSignals({ payrollAccount: { payrollStatus: 'invite_sent' } });
    const merged = applyLiveSignals(staleSteps, live);
    expect(statuses(merged)).toMatchObject({ i9: 'missing', tax_form: 'missing', handbook: 'missing', policies: 'missing' });
    // payroll invite is out: in progress, not "missing"
    expect(merged.find((s) => s.key === 'payroll_setup')!.status).toBe('in_progress');
  });
  it('never downgrades a completed step', () => {
    const merged = applyLiveSignals([{ key: 'handbook', label: 'handbook signature', status: 'complete', actor: 'worker' }], readLiveSignals({}));
    expect(merged[0].status).toBe('complete');
  });
});

describe('backgroundIsRelevant', () => {
  const started = new Date('2026-09-11T21:31:00Z');
  it("ignores a stale awaiting_applicant order from another job (Greg's June CORT Basic)", () => {
    expect(backgroundIsRelevant({ hrxStatus: 'awaiting_applicant', createdAt: new Date('2026-06-15T00:00:00Z'), jobOrderId: 'cortJo' }, { jobOrderId: '83CDmnfXxGR5KWCReXpu', startedAt: started })).toBe(false);
  });
  it('keeps the order made for this hire', () => {
    expect(backgroundIsRelevant({ hrxStatus: 'awaiting_applicant', createdAt: new Date('2026-09-11T21:32:00Z'), jobOrderId: '83CDmnfXxGR5KWCReXpu' }, { jobOrderId: '83CDmnfXxGR5KWCReXpu', startedAt: started })).toBe(true);
  });
  it('never chases errored or canceled orders, and reports ones already moving', () => {
    expect(backgroundIsRelevant({ hrxStatus: 'error', createdAt: new Date(), jobOrderId: null }, { jobOrderId: null, startedAt: started })).toBe(false);
    expect(backgroundIsRelevant({ hrxStatus: 'canceled', createdAt: new Date(), jobOrderId: null }, { jobOrderId: null, startedAt: started })).toBe(false);
    expect(backgroundIsRelevant({ hrxStatus: 'report_ready', createdAt: new Date('2026-01-01T00:00:00Z'), jobOrderId: 'other' }, { jobOrderId: 'x', startedAt: started })).toBe(true);
  });
  it('no check at all is not claimable', () => {
    expect(backgroundIsRelevant(null, { jobOrderId: null, startedAt: started })).toBe(false);
  });
});

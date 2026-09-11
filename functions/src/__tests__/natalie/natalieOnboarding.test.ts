import { composeCheckpointText, drugFromCheck, firstCheckpointFor, stepsWithoutAssignment, type OnboardingSnapshot } from '../../natalie/natalieOnboarding';

describe('firstCheckpointFor (1h check added 2026-09-11)', () => {
  const now = Date.parse('2026-09-11T20:00:00Z');
  const hoursAgo = (h: number) => new Date(now - h * 3600_000);
  it('a fresh start gets the 1h check', () => expect(firstCheckpointFor(hoursAgo(0.1), now)).toBe('h1'));
  it('late enrollments skip ahead instead of texting back to back', () => {
    expect(firstCheckpointFor(hoursAgo(8), now)).toBe('h24');
    expect(firstCheckpointFor(hoursAgo(40), now)).toBe('h72');
    expect(firstCheckpointFor(hoursAgo(24 * 6.5), now)).toBe('d7');
  });
});

describe('stepsWithoutAssignment (hiring-plan hires have no assignment readiness)', () => {
  const status = (steps: ReturnType<typeof stepsWithoutAssignment>) => Object.fromEntries(steps.map((x) => [x.key, `${x.status}/${x.actor}`]));
  it('a brand-new hire owes everything and payroll is a recruiter item until the invite goes out', () => {
    expect(status(stepsWithoutAssignment({ user: {}, payrollAccount: null, evereeMirror: null, employment: null }))).toEqual({
      work_authorization: 'missing/worker', i9: 'missing/worker', payroll_setup: 'missing/recruiter', tax_form: 'missing/worker',
    });
  });
  it('invite sent → payroll in progress on the worker; Everee mirror stamps complete the rest', () => {
    const invited = stepsWithoutAssignment({ user: {}, payrollAccount: { payrollStatus: 'invite_sent' }, evereeMirror: null, employment: null });
    expect(status(invited).payroll_setup).toBe('in_progress/worker');
    const done = stepsWithoutAssignment({
      user: { workEligibilityAttestation: { authorizedToWorkUS: true } },
      payrollAccount: { payrollStatus: 'invite_sent' },
      evereeMirror: { directDepositReady: true, i9SignedAt: { seconds: 1 }, w4SignedAt: null },
      employment: { taxIdentityStatus: 'complete' },
    });
    expect(done.every((x) => x.status === 'complete')).toBe(true);
  });
});

const base = (over: Partial<OnboardingSnapshot> = {}): OnboardingSnapshot => ({
  assignmentId: 'a1', hiringEntityId: 'c1_select_llc', entityLabel: 'C1 Select', steps: [], workerTodo: [], recruiterTodo: [],
  background: null, drug: { ordered: false, name: '', lab: '', status: 'none' }, everee: { inviteSent: false, complete: false }, allWorkerDone: true, ...over,
});

describe('drugFromCheck', () => {
  const check = (status: string, extra: Record<string, unknown> = {}) => ({ providerServiceOrderStatus: { '1': { serviceName: 'Quest Drug Screen', status, labName: 'Quest' }, '2': { serviceName: 'County Criminal', status: 'Completed' } }, ...extra });
  it('reads "Collection is pending" as not collected', () => expect(drugFromCheck(check('Collection is pending')).status).toBe('pending'));
  it('reads "In Progress" as not collected', () => expect(drugFromCheck(check('In Progress')).status).toBe('pending'));
  it('reads "Collection is complete" as collected, not completed', () => expect(drugFromCheck(check('Collection is complete')).status).toBe('collected'));
  it('reads Completed / drugReportReady as completed', () => {
    expect(drugFromCheck(check('Completed')).status).toBe('completed');
    expect(drugFromCheck(check('Collection is pending', { drugReportReady: true })).status).toBe('completed');
  });
  it('ignores TB lines and background-only orders', () => {
    expect(drugFromCheck({ providerServiceOrderStatus: { '1': { serviceName: 'TB/PPD Skin Test Step 1', status: 'In Progress' } } }).ordered).toBe(false);
    expect(drugFromCheck({ providerServiceOrderStatus: { '1': { serviceName: 'CrimNet', status: 'Completed' } } }).ordered).toBe(false);
  });
});

describe('composeCheckpointText', () => {
  it('mentions the drug screen as a separate second step once the form is done', () => {
    const t = composeCheckpointText({ firstName: 'Ana', jobTitle: 'Warehouse Associate' }, base({ allWorkerDone: false, workerTodo: ['drug screen at Quest (separate step after the form)'], background: { ordered: true, checkId: 'x', packageName: 'CORT Rapid', formDone: true, portalLink: 'https://a', hrxStatus: 'awaiting_applicant', failed: false }, drug: { ordered: true, name: 'Quest Drug Screen', lab: 'Quest', status: 'pending' } }), 'h24');
    expect(t).toMatch(/separate second step/);
    expect(t).toMatch(/Quest/);
    expect(t).not.toMatch(/https:\/\/a/);
    expect(t.endsWith('— Natalie, C1 Staffing')).toBe(true);
  });
  it('sends the AccuSource link when the form is not started and lists Everee items', () => {
    const t = composeCheckpointText({ firstName: 'Ana', jobTitle: 'Warehouse Associate' }, base({ allWorkerDone: false, workerTodo: ['tax forms (W-4)', 'Everee payroll setup (direct deposit)', 'AccuSource background form (CORT Rapid)'], everee: { inviteSent: true, complete: false }, background: { ordered: true, checkId: 'x', packageName: 'CORT Rapid', formDone: false, portalLink: 'https://accusource.example/form', hrxStatus: 'awaiting_applicant', failed: false } }), 'h72');
    expect(t).toMatch(/your Everee onboarding \(tax forms and direct deposit\)/);
    expect(t).toMatch(/https:\/\/accusource.example\/form/);
    expect(t).toMatch(/resend it/);
    expect(t.length).toBeLessThan(600);
  });
});

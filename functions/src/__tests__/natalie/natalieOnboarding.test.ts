import { composeCheckpointText, drugFromCheck, type OnboardingSnapshot } from '../../natalie/natalieOnboarding';

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

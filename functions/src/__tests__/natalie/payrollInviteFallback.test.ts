import { payrollLinkText, resendPayrollInviteOrTextLink } from '../../natalie/payrollInviteFallback';

/**
 * Greg 2026-09-11: Marco told a worker "sending your Everee link now" and nothing was sent — the
 * legacy resend can only skip for the Everee entities (no payroll URL configured).
 */
describe('payrollLinkText', () => {
  it('carries the link and the persona signature', () => {
    const t = payrollLinkText('Pattie', 'https://hrxone.com/c1/workers/earnings/3138', { persona: 'marco' });
    expect(t).toMatch(/https:\/\/hrxone\.com\/c1\/workers\/earnings\/3138/);
    expect(t).toMatch(/direct deposit and tax form/);
    expect(t.endsWith('— Marco, C1 Staffing')).toBe(true);
  });

  it('has Spanish copy', () => {
    const t = payrollLinkText('Ana', 'https://hrxone.com/c1/workers/earnings/3138', { persona: 'marco', lang: 'es' });
    expect(t).toMatch(/Hola Ana/);
    expect(t).toMatch(/depósito directo/);
  });

  it('handles a missing first name', () => {
    expect(payrollLinkText('', 'https://x/y', { persona: 'natalie' })).toMatch(/^Hi there,/);
  });
});

describe('resendPayrollInviteOrTextLink', () => {
  const entityDoc = (data: Record<string, unknown> | null) => ({
    get: async () => ({ data: () => data }),
  });
  const db = (entity: Record<string, unknown> | null) => ({ doc: () => entityDoc(entity) }) as never;

  afterEach(() => jest.resetModules());

  const mockResend = (result: unknown) => {
    jest.doMock('../../messaging/payrollInviteResend', () => ({
      runPayrollOnboardingInviteResend: async () => result,
    }));
  };

  it('texts the payroll link when the invite skips, and names the skip reason', async () => {
    mockResend({ ok: false, skipReason: 'payroll_not_applicable_or_no_url' });
    const sent: Array<{ text: string; type: string }> = [];
    const r = await resendPayrollInviteOrTextLink({
      db: db({ evereeTenantId: '3138' }),
      tenantId: 't1',
      userId: 'u1',
      hiringEntityId: 'c1_events_llc',
      firstName: 'Pattie',
      persona: 'marco',
      sendSms: async (text, type) => {
        sent.push({ text, type });
        return { success: true };
      },
    });
    expect(r.invited).toBe(false);
    expect(r.textedLink).toBe(true);
    expect(sent[0].type).toBe('marco_payroll_link');
    expect(sent[0].text).toMatch(/earnings\/3138/);
    expect(r.note).toMatch(/payroll_not_applicable_or_no_url/);
  });

  it('sends nothing extra when the real invite goes out', async () => {
    mockResend({ ok: true });
    let texts = 0;
    const r = await resendPayrollInviteOrTextLink({
      db: db({ evereeTenantId: '3138' }),
      tenantId: 't1',
      userId: 'u1',
      hiringEntityId: 'c1_events_llc',
      firstName: 'Pattie',
      persona: 'marco',
      sendSms: async () => {
        texts += 1;
        return { success: true };
      },
    });
    expect(r.invited).toBe(true);
    expect(r.textedLink).toBe(false);
    expect(texts).toBe(0);
  });

  it('sends no second text when the message that just went out already has the link', async () => {
    mockResend({ ok: false, skipReason: 'payroll_not_applicable_or_no_url' });
    let texts = 0;
    const r = await resendPayrollInviteOrTextLink({
      db: db({ evereeTenantId: '3138' }),
      tenantId: 't1',
      userId: 'u1',
      hiringEntityId: 'c1_events_llc',
      firstName: 'Pattie',
      persona: 'marco',
      textLinkWhenSkipped: false,
      sendSms: async () => {
        texts += 1;
        return { success: true };
      },
    });
    expect(texts).toBe(0);
    expect(r.textedLink).toBe(false);
    expect(r.note).toMatch(/payroll_not_applicable_or_no_url/);
  });

  it('asks for a recruiter when the entity has no payroll URL', async () => {
    mockResend({ ok: false, skipReason: 'payroll_not_applicable_or_no_url' });
    const r = await resendPayrollInviteOrTextLink({
      db: db({}),
      tenantId: 't1',
      userId: 'u1',
      hiringEntityId: 'c1_select_llc',
      firstName: 'Ana',
      persona: 'natalie',
      sendSms: async () => ({ success: true }),
    });
    expect(r.textedLink).toBe(false);
    expect(r.note).toMatch(/no payroll URL on file/);
  });
});

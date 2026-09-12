import {
  payrollLinkText,
  reminderVariantForEntityKey,
  resendPayrollInviteOrTextLink,
  signAsPersona,
} from '../../natalie/payrollInviteFallback';

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

  /** The recruiter Resend button's own link resolver — stubbed so no Firestore/Everee read is needed.
   *  The copy builder it feeds (`buildOnboardingReminderSmsBody`) stays REAL: the whole point of
   *  option 1 is that workers get that exact wording. */
  const mockOnboardingLink = (link: string) => {
    jest.doMock('../../integrations/everee/resolveWorkerOnboardingLink', () => ({
      resolveWorkerOnboardingLink: async () => ({ link, isEvereeDirect: link.includes('/earnings/'), evereeTenantId: null }),
    }));
  };

  it("sends the recruiter's own onboarding SMS when the invite skips, and names the skip reason", async () => {
    mockResend({ ok: false, skipReason: 'payroll_not_applicable_or_no_url' });
    mockOnboardingLink('https://hrxone.com/c1/workers/earnings/3138');
    const sent: Array<{ text: string; type: string }> = [];
    const r = await resendPayrollInviteOrTextLink({
      db: db({ entityKey: 'events', evereeTenantId: '3138' }),
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
    // 1099 copy: W-9, never an I-9, and signed by the persona who promised it in the thread.
    expect(sent[0].text).toMatch(/independent contractor \(1099\)/);
    expect(sent[0].text).toMatch(/W-9/);
    expect(sent[0].text).not.toMatch(/I-9/);
    expect(sent[0].text.endsWith('— Marco, C1 Staffing')).toBe(true);
    expect(r.note).toMatch(/payroll_not_applicable_or_no_url/);
    expect(r.note).toMatch(/events copy/);
  });

  it('a W-2 entity gets the standard I-9 + W-4 copy, in the worker language', async () => {
    mockResend({ ok: false, skipReason: 'payroll_not_applicable_or_no_url' });
    mockOnboardingLink('https://hrxone.com/c1/workers/earnings/3133');
    const sent: string[] = [];
    const r = await resendPayrollInviteOrTextLink({
      db: db({ entityKey: 'select', evereeTenantId: '3133' }),
      tenantId: 't1',
      userId: 'u1',
      hiringEntityId: 'c1_select_llc',
      firstName: 'Ana',
      persona: 'natalie',
      lang: 'es',
      sendSms: async (text) => {
        sent.push(text);
        return { success: true };
      },
    });
    expect(r.textedLink).toBe(true);
    expect(sent[0]).toMatch(/empleado\(a\) W-2/);
    expect(sent[0]).toMatch(/I-9/);
    expect(sent[0].endsWith('— Natalie, C1 Staffing')).toBe(true);
    expect(r.note).toMatch(/standard copy/);
  });

  it('an entity doc with only a name still picks the right copy', async () => {
    mockResend({ ok: false, skipReason: 'payroll_not_applicable_or_no_url' });
    mockOnboardingLink('https://hrxone.com/c1/workers/earnings/3138');
    const sent: string[] = [];
    await resendPayrollInviteOrTextLink({
      db: db({ name: 'C1 Events LLC' }),
      tenantId: 't1',
      userId: 'u1',
      hiringEntityId: 'c1_events_llc',
      firstName: 'Pattie',
      persona: 'marco',
      sendSms: async (text) => {
        sent.push(text);
        return { success: true };
      },
    });
    expect(sent[0]).toMatch(/independent contractor \(1099\)/);
  });

  it('falls back to the entity payroll page when no onboarding link can be resolved', async () => {
    mockResend({ ok: false, skipReason: 'payroll_not_applicable_or_no_url' });
    mockOnboardingLink('');
    const sent: string[] = [];
    const r = await resendPayrollInviteOrTextLink({
      db: db({ entityKey: 'events', evereeTenantId: '3138' }),
      tenantId: 't1',
      userId: 'u1',
      hiringEntityId: 'c1_events_llc',
      firstName: 'Pattie',
      persona: 'marco',
      sendSms: async (text) => {
        sent.push(text);
        return { success: true };
      },
    });
    expect(r.textedLink).toBe(true);
    expect(sent[0]).toMatch(/payroll setup link \(direct deposit and tax form\)/);
    expect(sent[0]).toMatch(/earnings\/3138/);
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

  it('asks for a recruiter when there is no link to send at all', async () => {
    mockResend({ ok: false, skipReason: 'payroll_not_applicable_or_no_url' });
    mockOnboardingLink('');
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

describe('pure pieces of the recruiter-copy fallback', () => {
  it('only the events entity key gets contractor copy', () => {
    expect(reminderVariantForEntityKey('events')).toBe('events');
    expect(reminderVariantForEntityKey('EVENTS')).toBe('events');
    for (const k of ['select', 'workforce', '', 'event_staff']) {
      expect(reminderVariantForEntityKey(k)).toBe('standard');
    }
  });

  it('signAsPersona appends once, in the worker language, and leaves empty text alone', () => {
    const signed = signAsPersona('Finish your W-9.', 'marco');
    expect(signed).toBe('Finish your W-9.\n— Marco, C1 Staffing');
    expect(signAsPersona(signed, 'marco')).toBe(signed);
    expect(signAsPersona('Completa tu W-9.', 'natalie', 'es').endsWith('— Natalie, C1 Staffing')).toBe(true);
    expect(signAsPersona('   ', 'marco')).toBe('');
  });
});

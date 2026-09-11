import { buildMimeMessage } from '../mimeHeaders';
import {
  DEFAULT_CONTACT_TZ,
  SODEXO_COMPANY_ID,
  SODEXO_PARENT_ACCOUNT_ID,
  type MailSummary,
  classifyReplyState,
  contactBlockReason,
  contactTimeZone,
  emptyPlaceholders,
  followUpDueAt,
  followUpSubject,
  formatStartDate,
  introTemplateVars,
  isCandidateInMind,
  isInternalEmail,
  isSodexoJobOrder,
  isWithinSendWindow,
  newlyAddedContacts,
  nextSendTime,
  normalizeEmail,
  renderTemplate,
  toMillis,
} from '../sodexoContactIntroRules';

const withContacts = (contacts: unknown[], extra: Record<string, unknown> = {}) => ({
  companyId: SODEXO_COMPANY_ID,
  deal: { associations: { contacts } },
  ...extra,
});
const hm = (id: string, email: string, firstName = 'Sarah') => ({
  id,
  snapshot: { fullName: `${firstName} Plamondon`, firstName, lastName: 'Plamondon', email, phone: '', title: 'Hiring Manager' },
});
const utc = (iso: string) => new Date(iso).getTime();
const iso = (ms: number) => new Date(ms).toISOString();

describe('isSodexoJobOrder', () => {
  it('matches on company id, parent account id, or Sodexo company/parent name', () => {
    expect(isSodexoJobOrder({ companyId: SODEXO_COMPANY_ID })).toBe(true);
    expect(isSodexoJobOrder({ parentAccountId: SODEXO_PARENT_ACCOUNT_ID })).toBe(true);
    expect(isSodexoJobOrder({ companyName: 'Sodexo' })).toBe(true);
    expect(isSodexoJobOrder({ parentAccountName: 'Sodexo, Inc.' })).toBe(true);
  });
  it('flags candidate-in-mind Fieldglass orders', () => {
    expect(isCandidateInMind({ fieldglass: { postingId: 'SDXOJP1', candidateInMind: true } })).toBe(true);
    expect(isCandidateInMind({ fieldglass: { postingId: 'SDXOJP1' } })).toBe(false);
    expect(isCandidateInMind({})).toBe(false);
  });
  it('ignores other clients and child-account names', () => {
    expect(isSodexoJobOrder({ companyName: 'Indeed Flex', accountName: 'Sodexo-ish site' })).toBe(false);
    expect(isSodexoJobOrder(null)).toBe(false);
  });
});

describe('newlyAddedContacts', () => {
  it('treats every contact as new on JO creation', () => {
    const added = newlyAddedContacts(null, withContacts([hm('c1', 'Sarah@Sodexo.com')]));
    expect(added).toEqual([{ id: 'c1', email: 'sarah@sodexo.com', firstName: 'Sarah', fullName: 'Sarah Plamondon' }]);
  });
  it('detects the Fieldglass attach (update after create)', () => {
    expect(newlyAddedContacts(withContacts([]), withContacts([hm('c1', 'a@sodexo.com')]))).toHaveLength(1);
  });
  it('does not re-fire for unrelated writes or snapshot edits of an existing contact', () => {
    const before = withContacts([hm('c1', 'a@sodexo.com')]);
    expect(newlyAddedContacts(before, withContacts([hm('c1', 'a@sodexo.com')], { status: 'filled' }))).toEqual([]);
    expect(newlyAddedContacts(before, withContacts([hm('c1', 'new-address@sodexo.com')]))).toEqual([]);
  });
  it('returns only the added contact when one is appended', () => {
    const before = withContacts([hm('c1', 'a@sodexo.com')]);
    const after = withContacts([hm('c1', 'a@sodexo.com'), hm('c2', 'b@sodexo.com', 'Bo')]);
    expect(newlyAddedContacts(before, after).map((c) => c.id)).toEqual(['c2']);
  });
  it('tolerates legacy bare-id entries and dedupes', () => {
    expect(newlyAddedContacts(null, withContacts(['c9', 'c9', ' ']))).toEqual([{ id: 'c9', email: '', firstName: '', fullName: '' }]);
  });
  it('handles JOs with no deal object', () => {
    expect(newlyAddedContacts(null, { companyId: SODEXO_COMPANY_ID })).toEqual([]);
  });
});

describe('email checks', () => {
  it('normalizes and rejects junk', () => {
    expect(normalizeEmail('  Jane.Doe@Sodexo.COM ')).toBe('jane.doe@sodexo.com');
    expect(normalizeEmail('Jane Doe <jane@sodexo.com>')).toBe('');
    expect(normalizeEmail('not-an-email')).toBe('');
    expect(normalizeEmail(undefined)).toBe('');
  });
  it('flags internal domains', () => {
    expect(isInternalEmail('d.waltermyer@c1staffing.com')).toBe(true);
    expect(isInternalEmail('ops@mail.hrxone.com')).toBe(true);
    expect(isInternalEmail('jane@sodexo.com')).toBe(false);
  });
});

describe('contactBlockReason', () => {
  it('blocks bounced, opted-out, and do-not-contact contacts', () => {
    expect(contactBlockReason({ emailBounced: true })).toBe('email_bounced');
    expect(contactBlockReason({ sodexoOutreach: { optedOut: true } })).toBe('opted_out');
    expect(contactBlockReason({ crmReengagement: { optedOut: true } })).toBe('opted_out');
    expect(contactBlockReason({ doNotContact: true })).toBe('do_not_contact');
  });
  it('clears normal and missing contacts', () => {
    expect(contactBlockReason({ email: 'a@sodexo.com', sodexoOutreach: { touch1SentAt: 1 } })).toBeNull();
    expect(contactBlockReason(null)).toBeNull();
  });
});

describe('send window (contact-local 8 AM–6 PM)', () => {
  const ET = 'America/New_York';
  it('resolves the timezone from the worksite state, defaulting to Pacific', () => {
    expect(contactTimeZone({ worksiteAddress: { state: 'nc' } })).toBe('America/New_York');
    expect(contactTimeZone({ worksiteAddress: { state: 'TX' } })).toBe('America/Chicago');
    expect(contactTimeZone({})).toBe(DEFAULT_CONTACT_TZ);
  });
  it('sends immediately during the day', () => {
    const tenAmEt = utc('2026-09-11T14:00:00Z');
    expect(isWithinSendWindow(tenAmEt, ET)).toBe(true);
    expect(nextSendTime(tenAmEt, ET)).toBe(tenAmEt);
  });
  it('holds a late-evening order until 8 AM the next morning', () => {
    expect(iso(nextSendTime(utc('2026-09-11T02:00:00Z'), ET))).toBe('2026-09-11T12:00:00.000Z'); // 10 PM → 8 AM EDT
    expect(iso(nextSendTime(utc('2026-09-11T23:30:00Z'), ET))).toBe('2026-09-12T12:00:00.000Z'); // 7:30 PM → next day
  });
  it('holds an early-morning order until 8 AM the same day', () => {
    expect(iso(nextSendTime(utc('2026-09-11T09:00:00Z'), ET))).toBe('2026-09-11T12:00:00.000Z'); // 5 AM EDT
  });
  it('handles the DST change and other zones', () => {
    // Sat Oct 31 11 PM EDT → Sun Nov 1 8 AM EST (clocks fell back at 2 AM).
    expect(iso(nextSendTime(utc('2026-11-01T03:00:00Z'), ET))).toBe('2026-11-01T13:00:00.000Z');
    // 6:15 AM Pacific → 8 AM PDT.
    expect(iso(nextSendTime(utc('2026-09-11T13:15:00Z'), 'America/Los_Angeles'))).toBe('2026-09-11T15:00:00.000Z');
  });
  it('schedules the follow-up 48h later, pushed into the window when needed', () => {
    const tenAmEt = utc('2026-09-11T14:00:00Z');
    expect(iso(followUpDueAt(tenAmEt, ET))).toBe('2026-09-13T14:00:00.000Z');
    const fiveFiftyPmEt = utc('2026-09-11T21:50:00Z');
    expect(iso(followUpDueAt(fiveFiftyPmEt, ET))).toBe('2026-09-13T21:50:00.000Z');
    const sixFifteenPmEt = utc('2026-09-11T22:15:00Z');
    expect(iso(followUpDueAt(sixFifteenPmEt, ET))).toBe('2026-09-14T12:00:00.000Z');
  });
});

describe('classifyReplyState', () => {
  const since = utc('2026-09-11T14:00:00Z');
  const msg = (over: Partial<MailSummary>): MailSummary => ({
    id: 'm2',
    from: 'Sarah Plamondon <sarah@sodexo.com>',
    to: 'd.waltermyer@c1staffing.com',
    internalDateMs: since + 3600e3,
    autoReply: false,
    ...over,
  });
  const ctx = { selfEmail: 'd.waltermyer@c1staffing.com', ourMessageIds: ['m1'], sinceMs: since };

  it('is none when only our intro is in the thread', () => {
    expect(classifyReplyState([msg({ id: 'm1', from: 'Deborah Waltermyer <d.waltermyer@c1staffing.com>' })], ctx)).toBe('none');
  });
  it('detects a human reply (contact or a colleague on the thread)', () => {
    expect(classifyReplyState([msg({})], ctx)).toBe('replied');
    expect(classifyReplyState([msg({ from: 'Tom <tom@sodexo.com>' })], ctx)).toBe('replied');
  });
  it('ignores out-of-office auto-replies', () => {
    expect(classifyReplyState([msg({ autoReply: true })], ctx)).toBe('none');
  });
  it('detects bounces', () => {
    expect(classifyReplyState([msg({ from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>' })], ctx)).toBe('bounced');
  });
  it('detects Deborah writing them herself', () => {
    expect(classifyReplyState([msg({ id: 'm3', from: 'Deborah Waltermyer <d.waltermyer@c1staffing.com>' })], ctx)).toBe('deborah_engaged');
  });
  it('lets a human reply win over everything else, and ignores older mail', () => {
    const all = [msg({ id: 'm3', from: 'd.waltermyer@c1staffing.com' }), msg({ id: 'm4', from: 'postmaster@x.com' }), msg({ id: 'm5' })];
    expect(classifyReplyState(all, ctx)).toBe('replied');
    expect(classifyReplyState([msg({ internalDateMs: since - 86400e3 })], ctx)).toBe('none');
  });
});

describe('template', () => {
  const jo = {
    jobTitle: 'Cook - Grill',
    worksiteName: 'UNC Rockingham',
    worksiteAddress: { city: 'Wentworth', state: 'NC' },
    startDate: '2026-09-15',
    poNumber: 'SDXOJP00189230',
    jobOrderNumber: 415,
    workersNeeded: 3,
  };
  it('builds merge fields from the JO and contact', () => {
    expect(introTemplateVars(jo, { fullName: 'Sarah Plamondon' })).toEqual({
      firstName: 'Sarah',
      fullName: 'Sarah Plamondon',
      jobTitle: 'Cook - Grill',
      siteName: 'UNC Rockingham',
      city: 'Wentworth',
      state: 'NC',
      startDate: 'September 15',
      poNumber: 'SDXOJP00189230',
      jobOrderNumber: '415',
      headcount: '3',
    });
  });
  it('falls back to "there" with no name', () => {
    expect(introTemplateVars({}, {}).firstName).toBe('there');
  });
  it('renders known fields and blanks unknown ones', () => {
    expect(renderTemplate('Hi {{firstName}} — {{ jobTitle }} at {{siteName}}{{nope}}', { firstName: 'Sarah', jobTitle: 'Cook', siteName: 'UNC' })).toBe(
      'Hi Sarah — Cook at UNC',
    );
  });
  it('formats start dates without timezone drift', () => {
    expect(formatStartDate('2026-01-01')).toBe('January 1');
    expect(formatStartDate('')).toBe('');
  });
  it('reports merge fields that would render blank', () => {
    const vars = introTemplateVars({ jobTitle: 'Cook' }, {});
    expect(emptyPlaceholders('Your {{jobTitle}} order – {{poNumber}} {{ poNumber }} Hi {{firstName}}', vars)).toEqual(['poNumber']);
    expect(emptyPlaceholders('Hi {{firstName}}', vars)).toEqual([]);
  });
  it('threads the follow-up subject', () => {
    expect(followUpSubject('Staffing for UNC Rockingham')).toBe('Re: Staffing for UNC Rockingham');
    expect(followUpSubject('RE: already a reply')).toBe('RE: already a reply');
    expect(followUpSubject('Intro', 'Quick follow-up')).toBe('Quick follow-up');
  });
});

describe('buildMimeMessage threading headers', () => {
  const decode = (raw: string) => Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  it('adds In-Reply-To / References when given, and strips header injection', () => {
    const msg = decode(
      buildMimeMessage({ to: 'a@sodexo.com', subject: 'Re: Hi', body: 'x', inReplyTo: '<abc@mail.gmail.com>', references: '<abc@mail.gmail.com>\r\nBcc: evil@x.com' }),
    );
    expect(msg).toContain('\r\nIn-Reply-To: <abc@mail.gmail.com>\r\n');
    expect(msg).toContain('\r\nReferences: <abc@mail.gmail.com> Bcc: evil@x.com\r\n');
    expect(msg).not.toMatch(/\r\nBcc:/);
  });
  it('omits them otherwise', () => {
    expect(decode(buildMimeMessage({ to: 'a@sodexo.com', subject: 'Hi', body: 'x' }))).not.toContain('In-Reply-To');
  });
});

describe('toMillis', () => {
  it('reads Timestamps, Dates, ISO strings, and raw seconds objects', () => {
    expect(toMillis({ toMillis: () => 42 })).toBe(42);
    expect(toMillis(new Date(1000))).toBe(1000);
    expect(toMillis('1970-01-01T00:00:02Z')).toBe(2000);
    expect(toMillis({ _seconds: 3 })).toBe(3000);
    expect(toMillis(null)).toBeNull();
    expect(toMillis('garbage')).toBeNull();
  });
});

import { emailTurn, normalizeUsPhone, personaForNumber, staffFromUser, toEmailText, toSmsText } from '../../natalie/personaConversations';

const T = 'BCiP2bQ9CgVOCTfV6MhD';

describe('normalizeUsPhone', () => {
  it('handles the formats staff phones are stored in', () => {
    expect(normalizeUsPhone('(512) 555-0100')).toBe('+15125550100');
    expect(normalizeUsPhone('15125550100')).toBe('+15125550100');
    expect(normalizeUsPhone('+1 512 555 0100')).toBe('+15125550100');
    expect(normalizeUsPhone('555')).toBe('');
    expect(normalizeUsPhone(undefined)).toBe('');
  });
});

describe('staffFromUser (who may talk to the personas)', () => {
  const rosa = { email: 'r.govea@c1staffing.com', firstName: 'Rosa', lastName: 'Govea', phone: '(512) 555-8900', tenantIds: { [T]: { securityLevel: '7', status: 'active' } }, integrations: { slack: { slackUserId: 'U07KRMRKT1R' } } };
  it('C1 staff at level 5+ with a c1staffing.com email', () => {
    expect(staffFromUser('rosa', rosa, T)).toEqual({ uid: 'rosa', name: 'Rosa Govea', firstName: 'Rosa', email: 'r.govea@c1staffing.com', phoneE164: '+15125558900', slackUserId: 'U07KRMRKT1R' });
    expect(staffFromUser('mark', { email: 'MK@c1staffing.com', firstName: 'Mark', tenantIds: { [T]: { securityLevel: 7 } } }, T)?.email).toBe('mk@c1staffing.com');
  });
  it('never client contacts, bookkeepers, personas, workers, or inactive staff', () => {
    expect(staffFromUser('rocco', { ...rosa, email: 'rocco@venuesmartllc.com' }, T)).toBeNull();
    expect(staffFromUser('tab', { ...rosa, email: 'tabitha@bandwidthbookkeeping.com' }, T)).toBeNull();
    expect(staffFromUser('natalie', { ...rosa, email: 'n.brooks@c1staffing.com', isAutomationPersona: true }, T)).toBeNull();
    expect(staffFromUser('worker', { ...rosa, tenantIds: { [T]: { securityLevel: '4' } } }, T)).toBeNull();
    expect(staffFromUser('gone', { ...rosa, tenantIds: { [T]: { securityLevel: '7', status: 'inactive' } } }, T)).toBeNull();
  });
});

describe('personaForNumber', () => {
  it('the number that was texted picks the persona', () => {
    expect(personaForNumber('+17372646753')).toBe('marco');
    expect(personaForNumber('(312) 663-8247')).toBe('natalie');
    expect(personaForNumber('+18888058650')).toBeNull();
  });
});

describe('toSmsText / toEmailText', () => {
  it('turns Slack mrkdwn into plain text without breaking URLs', () => {
    expect(toSmsText('*Ana* is set • <https://hrxone.com/users/abc|profile> and https://time.indeed.com/qr?source_flow=worker_link')).toBe('Ana is set • profile: https://hrxone.com/users/abc and https://time.indeed.com/qr?source_flow=worker_link');
    expect(toSmsText('that is _really_ late')).toBe('that is really late');
  });
  it('clamps long texts', () => {
    const t = toSmsText('x'.repeat(2000));
    expect(t.length).toBe(1200);
    expect(t.endsWith('…')).toBe(true);
  });
  it('email body', () => {
    expect(toEmailText('Hi Rosa, <https://hrxone.com/assignments/1|open it>')).toBe('Hi Rosa, open it: https://hrxone.com/assignments/1');
    expect(toEmailText('   ')).toBe('Got it.');
  });
});

describe('emailTurn', () => {
  const helpers = { header: (m: any, n: string) => (m.payload.headers.find((h: any) => h.name === n)?.value ?? ''), body: (m: any) => m.snippet };
  it("the persona's own messages are assistant turns", () => {
    const mine = { internalDate: '1757600000000', snippet: 'On it', payload: { headers: [{ name: 'From', value: 'Marco Gomez <m.gomez@c1staffing.com>' }] } };
    const hers = { internalDate: '1757600100000', snippet: 'Thanks!', payload: { headers: [{ name: 'From', value: '"Rosa Govea" <r.govea@c1staffing.com>' }] } };
    expect(emailTurn(mine as never, 'm.gomez@c1staffing.com', 'marco', helpers)).toMatchObject({ role: 'assistant', by: 'marco', byName: 'Marco', text: 'On it' });
    expect(emailTurn(hers as never, 'm.gomez@c1staffing.com', 'marco', helpers)).toMatchObject({ role: 'user', byName: 'Rosa', text: 'Thanks!' });
  });
});

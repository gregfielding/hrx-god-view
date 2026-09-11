import { classifySender, describeShift, emailsInText, matchNameAmongAccounts, parseWorkerDecision, phoneFormatVariants, recentReplyCount, workerSmsSystemPrompt } from '../../natalie/personaWorkerSms';

const T = 'BCiP2bQ9CgVOCTfV6MhD';

describe('classifySender (personal data only for exactly one tenant member)', () => {
  const worker = { id: 'u1', data: { firstName: 'Ana', tenantIds: { [T]: { securityLevel: '4' } } } };
  it('one matching worker in this tenant is identified', () => {
    expect(classifySender([worker], T)).toMatchObject({ kind: 'worker', uid: 'u1' });
    expect(classifySender([{ id: 'u2', data: { tenantId: T } }], T)).toMatchObject({ kind: 'worker', uid: 'u2' });
  });
  it('no match, a shared number, or another tenant stays anonymous', () => {
    expect(classifySender([], T)).toEqual({ kind: 'unknown' });
    expect(classifySender([worker, { id: 'u3', data: { tenantIds: { [T]: {} } } }], T)).toEqual({ kind: 'ambiguous', count: 2 });
    expect(classifySender([{ id: 'x', data: { tenantIds: { otherTenant: {} } } }], T)).toEqual({ kind: 'unknown' });
  });
  it('persona accounts never count as the texter', () => {
    expect(classifySender([{ id: 'marco', data: { isAutomationPersona: true, tenantIds: { [T]: {} } } }, worker], T)).toMatchObject({ kind: 'worker', uid: 'u1' });
  });
});

describe('recentReplyCount', () => {
  it('counts replies in the last hour only', () => {
    const now = Date.parse('2026-09-11T22:00:00Z');
    expect(recentReplyCount([now - 10 * 60_000, now - 59 * 60_000, now - 61 * 60_000], now)).toBe(2);
    expect(recentReplyCount([], now)).toBe(0);
  });
});

describe('describeShift (times only when really known)', () => {
  it('uses HH:MM strings as local times', () => {
    expect(describeShift({ jobTitle: 'Usher', worksiteName: 'COTA', worksiteAddress: { city: 'Austin', state: 'TX' }, startDate: '2026-09-13', startTime: '17:30', endTime: '23:00', status: 'confirmed', payRate: 18, hiringEntityId: 'c1_events_llc' }).line)
      .toBe('2026-09-13 17:30–23:00 (local): Usher at COTA — Austin, TX — status confirmed, pay $18.00/hr, C1 Events (1099 contractor)');
  });
  it('formats a Timestamp in the worksite time zone, and omits the time when the zone is unknown', () => {
    const ts = { toDate: () => new Date('2026-09-13T22:30:00Z') };
    expect(describeShift({ jobTitle: 'Picker', worksiteAddress: { state: 'CO' }, startTime: ts, status: 'confirmed' }).line).toContain('2026-09-13 4:30 PM (local): Picker');
    expect(describeShift({ jobTitle: 'Picker', startTime: ts, status: 'confirmed' }).line).toMatch(/^2026-09-13: Picker/);
  });
});

describe('parseWorkerDecision', () => {
  it('enforces the signature and whitelists actions', () => {
    const d = parseWorkerDecision('{"reply":"Your shift is Sat at 5:30 PM.","intent":"schedule","actions":["escalate","place_worker"],"note":"x"}', 'marco', 'en', 'Ana');
    expect(d.reply).toBe('Your shift is Sat at 5:30 PM. — Marco, C1 Staffing');
    expect(d.actions).toEqual(['escalate']);
  });
  it('bad model output → a safe fallback in their language that flags a human', () => {
    const d = parseWorkerDecision('not json', 'natalie', 'es', 'Ana');
    expect(d.reply).toBe('Gracias Ana, recibí tu mensaje. Alguien del equipo te contactará pronto. — Natalie, C1 Staffing');
    expect(d.actions).toContain('escalate');
  });
});

describe('workerSmsSystemPrompt guardrails', () => {
  it.each(['natalie', 'marco'] as const)('%s', (persona) => {
    const p = workerSmsSystemPrompt(persona);
    expect(p).toContain('could not be identified, do not reveal');
    expect(p).toContain("don't deny it");
    expect(p).toContain('Never make or promise hiring decisions');
    expect(p).toContain(persona === 'marco' ? "Rosa's team" : 'a recruiter');
  });
});

describe('identifying a texter', () => {
  it('phoneFormatVariants covers how users.phone is stored', () => {
    const v = phoneFormatVariants('+15125558900');
    expect(v).toEqual(expect.arrayContaining(['+15125558900', '5125558900', '(512) 555-8900', '512-555-8900', '512.555.8900']));
    expect(v.length).toBeLessThanOrEqual(30); // Firestore 'in' limit
    expect(phoneFormatVariants('555')).toEqual([]);
  });
  it('matchNameAmongAccounts picks the one account on a shared number whose full name was texted', () => {
    const accounts = [
      { id: 'ana', data: { firstName: 'Ana', lastName: 'Ibarra' } },
      { id: 'jose', data: { firstName: 'José', lastName: 'Ibarra' } },
    ];
    expect(matchNameAmongAccounts(['hola soy jose ibarra'], accounts)).toBe('jose');
    expect(matchNameAmongAccounts(['This is Ana Ibarra, when is my shift?'], accounts)).toBe('ana');
    expect(matchNameAmongAccounts(['this is Ibarra'], accounts)).toBeNull();
    expect(matchNameAmongAccounts(['Ana and José Ibarra here'], accounts)).toBeNull();
  });
  it('emailsInText', () => {
    expect(emailsInText('I applied with Ana.Ibarra@Gmail.com and ana@yahoo.com')).toEqual(['ana.ibarra@gmail.com', 'ana@yahoo.com']);
    expect(emailsInText('no email here')).toEqual([]);
  });
});

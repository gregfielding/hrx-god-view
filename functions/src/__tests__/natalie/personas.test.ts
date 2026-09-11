jest.mock('firebase-admin', () => ({ apps: [{}], initializeApp: jest.fn(), firestore: () => ({ doc: jest.fn() }) }));

import { effectivePersona, personaForMessageType, scopePersona, workerLanguage } from '../../natalie/personas';

describe('scopePersona (Marco = C1 Events minus Oakland Arena)', () => {
  it('Venue Smart and the other C1 Events caterers belong to Marco', () => {
    expect(scopePersona({ hiringEntityId: 'c1_events_llc', accountId: 'NHc6r1yOVUK6aOqt0EQH', locationId: 'kKCtMbjQajDKKP9n7d4k' })).toBe('marco');
    expect(scopePersona({ hiringEntityId: 'c1_events_llc', accountId: 'F4u0eLZVwguXfwffOuJa' })).toBe('marco');
    expect(scopePersona({ entityId: 'c1_events_llc', companyId: 'KFKxtXFRap3u3JpZrrTT' })).toBe('marco');
  });
  it('Oakland Arena stays with Natalie by location or by either Legends account id', () => {
    expect(scopePersona({ hiringEntityId: 'c1_events_llc', accountId: 'somethingElse', locationId: 'QGNUkDRD4jMej6RArOO4' })).toBe('natalie');
    expect(scopePersona({ hiringEntityId: 'c1_events_llc', locationIds: ['x', 'QGNUkDRD4jMej6RArOO4'] })).toBe('natalie');
    expect(scopePersona({ hiringEntityId: 'c1_events_llc', accountId: 'pioetKgJXPu19zk2K7Y6' })).toBe('natalie');
    expect(scopePersona({ hiringEntityId: 'c1_events_llc', recruiterAccountId: 'uhb5hq4ddyLWtSeJP9Te' })).toBe('natalie');
  });
  it('everything that is not C1 Events is Natalie (Select, Workforce, missing entity)', () => {
    expect(scopePersona({ hiringEntityId: 'c1_select_llc', accountId: 'NHc6r1yOVUK6aOqt0EQH' })).toBe('natalie');
    expect(scopePersona({ accountId: 'NHc6r1yOVUK6aOqt0EQH' })).toBe('natalie');
    expect(scopePersona(null)).toBe('natalie');
  });
});

describe('effectivePersona', () => {
  it('Marco only takes his scope while switched on', () => {
    expect(effectivePersona('marco', { marcoEnabled: true })).toBe('marco');
    expect(effectivePersona('marco', { marcoEnabled: false })).toBe('natalie');
    expect(effectivePersona('natalie', { marcoEnabled: true })).toBe('natalie');
  });
});

describe('personaForMessageType', () => {
  it('routes by prefix, ordinary system SMS has no persona', () => {
    expect(personaForMessageType('natalie_onboarding_24h')).toBe('natalie');
    expect(personaForMessageType('marco_offer')).toBe('marco');
    expect(personaForMessageType('assignment_late_checkin_15m')).toBeNull();
    expect(personaForMessageType(undefined)).toBeNull();
  });
});

describe('workerLanguage', () => {
  it('Spanish only when the profile says so', () => {
    expect(workerLanguage({ preferredLanguage: 'es' })).toBe('es');
    expect(workerLanguage({ preferredLanguage: 'Spanish' })).toBe('es');
    expect(workerLanguage({ languagePreference: 'Español' })).toBe('es');
    expect(workerLanguage({ preferredLanguage: 'en' })).toBe('en');
    expect(workerLanguage({})).toBe('en');
  });
});

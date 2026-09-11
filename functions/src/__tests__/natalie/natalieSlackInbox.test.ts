jest.mock('firebase-admin', () => {
  const firestore = () => ({ collection: jest.fn(), doc: jest.fn(), collectionGroup: jest.fn() });
  (firestore as any).FieldValue = { serverTimestamp: () => 'ts', arrayUnion: (...a: unknown[]) => a };
  (firestore as any).Timestamp = { fromMillis: (n: number) => ({ n }) };
  return { apps: [{}], initializeApp: jest.fn(), firestore };
});
jest.mock('firebase-functions/v2', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (_o: unknown, fn: unknown) => fn }));
// natalieFill imports jobOrderAutoMessaging(+Radius), which define onCall functions — the real
// onCall breaks against the fake admin above, so stub the https module too.
jest.mock('firebase-functions/v2/https', () => ({
  onCall: (_o: unknown, fn: unknown) => fn,
  onRequest: (_o: unknown, fn: unknown) => fn,
  HttpsError: class HttpsError extends Error { constructor(public code: string, message?: string) { super(message); } },
}));
jest.mock('firebase-functions/params', () => ({ defineSecret: (name: string) => ({ name, value: () => '' }), defineString: (name: string) => ({ name, value: () => '' }) }));
jest.mock('googleapis', () => ({ google: { auth: { OAuth2: class {} }, gmail: () => ({}) } }));
jest.mock('@anthropic-ai/sdk', () => ({ __esModule: true, default: class {} }));

import { cleanText, shouldAnswer, NATALIE_SLACK_USER_ID } from '../../natalie/natalieSlackInbox';

const N = NATALIE_SLACK_USER_ID;

describe('shouldAnswer', () => {
  it('answers @mentions in channels from humans only', () => {
    expect(shouldAnswer({ type: 'message', user: 'U1', text: `<@${N}> what is up with Maria?`, ts: '1' }, { isDm: false, natalieId: N })).toBe(true);
    expect(shouldAnswer({ type: 'message', user: 'U1', text: 'no mention here', ts: '1' }, { isDm: false, natalieId: N })).toBe(false);
    expect(shouldAnswer({ type: 'message', user: N, text: `<@${N}> talking to myself`, ts: '1' }, { isDm: false, natalieId: N })).toBe(false);
    expect(shouldAnswer({ type: 'message', bot_id: 'B1', user: 'U1', text: `<@${N}> hi`, ts: '1' }, { isDm: false, natalieId: N })).toBe(false);
  });
  it('answers any human DM, ignores joins and edits', () => {
    expect(shouldAnswer({ type: 'message', user: 'U1', text: 'hi Natalie', ts: '1' }, { isDm: true, natalieId: N })).toBe(true);
    expect(shouldAnswer({ type: 'message', subtype: 'channel_join', user: 'U1', text: 'joined', ts: '1' }, { isDm: true, natalieId: N })).toBe(false);
    expect(shouldAnswer({ type: 'message', subtype: 'message_changed', user: 'U1', text: 'x', ts: '1' }, { isDm: true, natalieId: N })).toBe(false);
  });
});

describe('cleanText', () => {
  it('strips the mention and unescapes Slack markup', () => {
    expect(cleanText(`<@${N}> is the Fieldglass sync current &amp; when did it run?`, N)).toBe('is the Fieldglass sync current & when did it run?');
    expect(cleanText('see <https://hrxone.com/users/abc|Maria> and <@U2>', N)).toBe('see Maria (https://hrxone.com/users/abc) and @U2');
  });
});

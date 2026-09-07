jest.mock('firebase-admin', () => {
  const firestore = () => ({ collection: jest.fn(), doc: jest.fn(), runTransaction: jest.fn() });
  (firestore as any).FieldValue = { serverTimestamp: () => 'ts', increment: (n: number) => n };
  return { apps: [{}], initializeApp: jest.fn(), firestore };
});
jest.mock('firebase-functions/v2', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

import { isPermanentSmsFailure, PERMANENT_SMS_ERROR_CODES } from '../../messaging/smsDeliveryAlerts';

describe('isPermanentSmsFailure', () => {
  it('never flags a successful send', () => {
    expect(isPermanentSmsFailure({ success: true, status: 'queued' })).toBe(false);
  });

  it('flags Twilio invalid / not-mobile / unsubscribed codes', () => {
    for (const code of ['21211', '21614', '21610', '21617', '30006']) {
      expect(PERMANENT_SMS_ERROR_CODES.has(code)).toBe(true);
      expect(isPermanentSmsFailure({ success: false, status: 'failed', errorCode: code })).toBe(true);
    }
  });

  it('flags HRX-side refusals (skipped: opt-out, blocked, phoneInvalid)', () => {
    expect(isPermanentSmsFailure({ success: false, status: 'skipped', errorCode: 'OPTED_OUT' })).toBe(true);
    expect(isPermanentSmsFailure({ success: false, status: 'skipped', error: 'blocked' })).toBe(true);
    expect(isPermanentSmsFailure({ success: false, status: 'failed', errorCode: 'PHONE_INVALID' })).toBe(true);
  });

  it('falls back to the legacy error text when no code is present', () => {
    expect(isPermanentSmsFailure({ success: false, status: 'failed', error: 'Invalid phone number format or not SMS capable' })).toBe(true);
  });

  it('treats transient / config failures as retryable', () => {
    expect(isPermanentSmsFailure({ success: false, status: 'failed', errorCode: '30034' })).toBe(false); // A2P registration
    expect(isPermanentSmsFailure({ success: false, status: 'failed', error: 'Twilio messaging configuration is missing' })).toBe(false);
    expect(isPermanentSmsFailure({ success: false, status: 'failed', errorCode: '20429' })).toBe(false); // rate limit
    expect(isPermanentSmsFailure(null)).toBe(false);
  });
});

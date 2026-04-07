/**
 * QA coverage: compliance expiration helpers.
 * See docs/WORKFORCE_SYSTEM_POLISH_QA.md — expiration feeds into readiness and UI alerts.
 */
import {
  isExpired,
  isExpiringSoon,
  getExpirationState,
  hasExpiredCompliance,
  hasExpiringSoonCompliance,
  DEFAULT_EXPIRING_SOON_DAYS,
} from '../complianceExpiration';

const yesterday = new Date();
yesterday.setDate(yesterday.getDate() - 1);
const tenDaysFromNow = new Date();
tenDaysFromNow.setDate(tenDaysFromNow.getDate() + 10);
const fortyDaysFromNow = new Date();
fortyDaysFromNow.setDate(fortyDaysFromNow.getDate() + 40);

describe('complianceExpiration', () => {
  describe('isExpired', () => {
    it('returns true when status is expired', () => {
      expect(isExpired({ status: 'expired', type: 'drivers_license', expiresAt: null })).toBe(true);
    });
    it('returns true when type has expiration and expiresAt is in the past', () => {
      expect(isExpired({ status: 'complete', type: 'work_permit', expiresAt: yesterday.toISOString() })).toBe(true);
    });
    it('returns false when type has no expiration', () => {
      expect(isExpired({ status: 'complete', type: 'i9', expiresAt: yesterday.toISOString() })).toBe(false);
    });
    it('returns false when expiresAt is in the future', () => {
      expect(isExpired({ status: 'complete', type: 'drivers_license', expiresAt: fortyDaysFromNow.toISOString() })).toBe(false);
    });
  });

  describe('isExpiringSoon', () => {
    it('returns false when already expired', () => {
      expect(isExpiringSoon({ status: 'expired', type: 'drivers_license', expiresAt: yesterday.toISOString() })).toBe(false);
    });
    it('returns true when expires within default 30 days', () => {
      expect(isExpiringSoon({ status: 'complete', type: 'drivers_license', expiresAt: tenDaysFromNow.toISOString() })).toBe(true);
    });
    it('returns false when expires beyond 30 days', () => {
      expect(isExpiringSoon({ status: 'complete', type: 'drivers_license', expiresAt: fortyDaysFromNow.toISOString() })).toBe(false);
    });
    it('respects custom thresholdDays', () => {
      expect(isExpiringSoon({ status: 'complete', type: 'drivers_license', expiresAt: fortyDaysFromNow.toISOString() }, 60)).toBe(true);
    });
  });

  describe('getExpirationState', () => {
    it('returns expired when past', () => {
      expect(getExpirationState({ status: 'complete', type: 'work_permit', expiresAt: yesterday.toISOString() })).toBe('expired');
    });
    it('returns expiring_soon when within 30 days', () => {
      expect(getExpirationState({ status: 'complete', type: 'drivers_license', expiresAt: tenDaysFromNow.toISOString() })).toBe('expiring_soon');
    });
    it('returns ok when beyond 30 days', () => {
      expect(getExpirationState({ status: 'complete', type: 'drivers_license', expiresAt: fortyDaysFromNow.toISOString() })).toBe('ok');
    });
  });

  describe('hasExpiredCompliance', () => {
    it('returns true when any item with expiration is expired', () => {
      const items = [
        { status: 'complete' as const, type: 'i9', expiresAt: null },
        { status: 'complete' as const, type: 'work_permit', expiresAt: yesterday.toISOString() },
      ];
      expect(hasExpiredCompliance(items)).toBe(true);
    });
    it('returns false when no expiring-type items are expired', () => {
      const items = [
        { status: 'complete' as const, type: 'i9', expiresAt: null },
        { status: 'complete' as const, type: 'drivers_license', expiresAt: fortyDaysFromNow.toISOString() },
      ];
      expect(hasExpiredCompliance(items)).toBe(false);
    });
  });

  describe('hasExpiringSoonCompliance', () => {
    it('returns true when any item is expiring within threshold', () => {
      const items = [
        { status: 'complete' as const, type: 'drivers_license', expiresAt: tenDaysFromNow.toISOString() },
      ];
      expect(hasExpiringSoonCompliance(items)).toBe(true);
    });
    it('returns false when no items expiring soon', () => {
      const items = [
        { status: 'complete' as const, type: 'drivers_license', expiresAt: fortyDaysFromNow.toISOString() },
      ];
      expect(hasExpiringSoonCompliance(items)).toBe(false);
    });
  });

  it('DEFAULT_EXPIRING_SOON_DAYS is 30', () => {
    expect(DEFAULT_EXPIRING_SOON_DAYS).toBe(30);
  });
});

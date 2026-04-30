import {
  isOnboardingCallTask,
  isOpenTask,
  isPendingOnboardingCallTask,
  resolveWorkerUidFromTask,
} from '../csaOnboardingCallTaskFilter';

describe('csaOnboardingCallTaskFilter — RD.1 Section 3 predicates', () => {
  describe('isOpenTask', () => {
    it('treats scheduled / upcoming / due / overdue as open', () => {
      expect(isOpenTask({ status: 'scheduled' })).toBe(true);
      expect(isOpenTask({ status: 'upcoming' })).toBe(true);
      expect(isOpenTask({ status: 'due' })).toBe(true);
      expect(isOpenTask({ status: 'overdue' })).toBe(true);
    });

    it('treats completed / cancelled / dismissed as terminal', () => {
      expect(isOpenTask({ status: 'completed' })).toBe(false);
      expect(isOpenTask({ status: 'cancelled' })).toBe(false);
      expect(isOpenTask({ status: 'dismissed' })).toBe(false);
    });
  });

  describe('isOnboardingCallTask', () => {
    it('matches when type === "onboarding"', () => {
      expect(
        isOnboardingCallTask({ type: 'onboarding', category: 'general' }),
      ).toBe(true);
    });

    it('matches when category === "onboarding" even with non-onboarding type', () => {
      expect(
        isOnboardingCallTask({ type: 'phone_call', category: 'onboarding' }),
      ).toBe(true);
      expect(
        isOnboardingCallTask({ type: 'follow_up', category: 'onboarding' }),
      ).toBe(true);
    });

    it('does not match unrelated tasks', () => {
      expect(
        isOnboardingCallTask({ type: 'email', category: 'follow_up' }),
      ).toBe(false);
      expect(
        isOnboardingCallTask({ type: 'phone_call', category: 'prospecting' }),
      ).toBe(false);
    });
  });

  describe('isPendingOnboardingCallTask (composed predicate)', () => {
    it('keeps open onboarding tasks', () => {
      expect(
        isPendingOnboardingCallTask({
          status: 'upcoming',
          type: 'phone_call',
          category: 'onboarding',
        }),
      ).toBe(true);
    });

    it('drops completed onboarding tasks (live-listener semantics)', () => {
      // This is the heart of the "row disappears after Complete" UX —
      // when TaskDetailsDialog flips status to 'completed', the next
      // snapshot tick filters the row out.
      expect(
        isPendingOnboardingCallTask({
          status: 'completed',
          type: 'phone_call',
          category: 'onboarding',
        }),
      ).toBe(false);
    });

    it('drops open non-onboarding tasks (scope guarantee)', () => {
      expect(
        isPendingOnboardingCallTask({
          status: 'overdue',
          type: 'email',
          category: 'follow_up',
        }),
      ).toBe(false);
    });

    it('drops dismissed onboarding tasks (CSA explicitly skipped)', () => {
      expect(
        isPendingOnboardingCallTask({
          status: 'dismissed',
          type: 'onboarding',
          category: 'general',
        }),
      ).toBe(false);
    });
  });

  describe('resolveWorkerUidFromTask', () => {
    it('prefers associations.users[0]', () => {
      expect(
        resolveWorkerUidFromTask({
          associations: {
            users: ['user-canonical'],
            salespeople: ['user-legacy'],
          },
          userId: 'user-top-level',
        }),
      ).toBe('user-canonical');
    });

    it('falls back to associations.salespeople[0] when users is empty', () => {
      expect(
        resolveWorkerUidFromTask({
          associations: { users: [], salespeople: ['user-legacy'] },
          userId: 'user-top-level',
        }),
      ).toBe('user-legacy');
    });

    it('falls back to top-level userId when associations are empty', () => {
      expect(
        resolveWorkerUidFromTask({ associations: {}, userId: 'user-top-level' }),
      ).toBe('user-top-level');
    });

    it('falls back to top-level workerId when userId is missing too', () => {
      expect(resolveWorkerUidFromTask({ workerId: 'user-worker-field' })).toBe(
        'user-worker-field',
      );
    });

    it('returns null when no convention surfaces a uid', () => {
      expect(resolveWorkerUidFromTask({})).toBeNull();
      expect(resolveWorkerUidFromTask({ associations: { users: [] } })).toBeNull();
      expect(resolveWorkerUidFromTask({ associations: { salespeople: [''] } })).toBeNull();
    });
  });
});

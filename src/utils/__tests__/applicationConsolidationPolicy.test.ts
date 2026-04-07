import {
  normalizeConsolidationEmail,
  suggestWinnerLosersForPair,
  classifyPairMerge,
  type CandidateDocIdentity,
} from '../applicationConsolidationPolicy';

const base = (id: string, patch: Partial<CandidateDocIdentity> = {}): CandidateDocIdentity => ({
  docId: id,
  createdAtMs: 1000,
  ...patch,
});

describe('applicationConsolidationPolicy', () => {
  describe('normalizeConsolidationEmail', () => {
    it('lowercases and trims', () => {
      expect(normalizeConsolidationEmail('  Foo@BAR.com ')).toBe('foo@bar.com');
    });
    it('returns null for empty or missing @', () => {
      expect(normalizeConsolidationEmail('')).toBe(null);
      expect(normalizeConsolidationEmail('not-an-email')).toBe(null);
    });
  });

  describe('suggestWinnerLosersForPair', () => {
    it('picks newer createdAt as winner', () => {
      expect(
        suggestWinnerLosersForPair(base('a', { createdAtMs: 1 }), base('b', { createdAtMs: 2 })),
      ).toEqual({ suggestedWinnerId: 'b', suggestedLoserIds: ['a'] });
    });
    it('tie-breaker prefers lexicographically larger docId', () => {
      expect(
        suggestWinnerLosersForPair(base('a', { createdAtMs: 5 }), base('b', { createdAtMs: 5 })),
      ).toEqual({ suggestedWinnerId: 'b', suggestedLoserIds: ['a'] });
    });
    it('tenant storage wins over nested even when nested is newer', () => {
      expect(
        suggestWinnerLosersForPair(
          base('tenantDoc', { storage: 'tenant', createdAtMs: 1 }),
          base('nestedDoc', { storage: 'nested', createdAtMs: 999 }),
        ),
      ).toEqual({ suggestedWinnerId: 'tenantDoc', suggestedLoserIds: ['nestedDoc'] });
    });
    it('within same storage, createdAt still decides', () => {
      expect(
        suggestWinnerLosersForPair(
          base('older', { storage: 'tenant', createdAtMs: 1 }),
          base('newer', { storage: 'tenant', createdAtMs: 2 }),
        ),
      ).toEqual({ suggestedWinnerId: 'newer', suggestedLoserIds: ['older'] });
    });
  });

  describe('classifyPairMerge', () => {
    const jo = 'jobOrder1';

    it('auto_merge on same userId + jobOrderId', () => {
      const r = classifyPairMerge(
        jo,
        base('t1', { userId: 'uid1', createdAtMs: 10 }),
        base('t2', { userId: 'uid1', createdAtMs: 20 }),
      );
      expect(r.outcome).toBe('auto_merge');
      if (r.outcome === 'auto_merge') {
        expect(r.basis).toBe('userId_jobOrderId');
        expect(r.suggestedWinnerId).toBe('t2');
        expect(r.suggestedLoserIds).toEqual(['t1']);
      }
    });

    it('auto_merge prefers tenant over nested when both storages set', () => {
      const r = classifyPairMerge(
        jo,
        base('nestedId', { storage: 'nested', userId: 'uid1', createdAtMs: 100 }),
        base('tenantId', { storage: 'tenant', userId: 'uid1', createdAtMs: 1 }),
      );
      expect(r.outcome).toBe('auto_merge');
      if (r.outcome === 'auto_merge') {
        expect(r.suggestedWinnerId).toBe('tenantId');
        expect(r.suggestedLoserIds).toEqual(['nestedId']);
      }
    });

    it('requires_review when userIds conflict', () => {
      const r = classifyPairMerge(
        jo,
        base('a', { userId: 'u1' }),
        base('b', { userId: 'u2' }),
      );
      expect(r.outcome).toBe('requires_review');
      if (r.outcome === 'requires_review') expect(r.reason).toBe('conflicting_user_ids');
    });

    it('requires_review when one side has userId and other does not', () => {
      const r = classifyPairMerge(jo, base('a', { userId: 'u1' }), base('b', {}));
      expect(r.outcome).toBe('requires_review');
      if (r.outcome === 'requires_review') expect(r.reason).toBe('asymmetric_or_missing_user_id');
    });

    it('email fallback auto_merge only with flag and both userIds empty', () => {
      const email = 'same@example.com';
      const off = classifyPairMerge(
        jo,
        base('a', { emailRaw: email }),
        base('b', { emailRaw: email }),
        { allowEmailFallbackMerge: false },
      );
      expect(off.outcome).toBe('requires_review');

      const on = classifyPairMerge(
        jo,
        base('a', { emailRaw: email }),
        base('b', { emailRaw: email }),
        { allowEmailFallbackMerge: true },
      );
      expect(on.outcome).toBe('auto_merge');
      if (on.outcome === 'auto_merge') expect(on.basis).toBe('email_jobOrderId');
    });

    it('does not use email fallback if either userId is set', () => {
      const r = classifyPairMerge(
        jo,
        base('a', { userId: 'u1', emailRaw: 'x@y.com' }),
        base('b', { emailRaw: 'x@y.com' }),
        { allowEmailFallbackMerge: true },
      );
      expect(r.outcome).toBe('requires_review');
    });

    it('weakSignal forces requires_review', () => {
      const r = classifyPairMerge(
        jo,
        base('a', { userId: 'same', candidateFirstName: 'A' }),
        base('b', { userId: 'same', candidateFirstName: 'B' }),
        { weakSignal: 'fuzzy' },
      );
      expect(r.outcome).toBe('requires_review');
      if (r.outcome === 'requires_review') expect(r.reason).toBe('weak_signal_fuzzy');
    });

    it('name-only match without email goes to review', () => {
      const r = classifyPairMerge(
        jo,
        base('a', { candidateFirstName: 'Jane', candidateLastName: 'Doe' }),
        base('b', { candidateFirstName: 'Jane', candidateLastName: 'Doe' }),
      );
      expect(r.outcome).toBe('requires_review');
      if (r.outcome === 'requires_review') expect(r.reason).toBe('name_only_insufficient');
    });

    it('phone-only match without email goes to review', () => {
      const r = classifyPairMerge(
        jo,
        base('a', { phoneRaw: '+15551234567' }),
        base('b', { phoneRaw: '+15551234567' }),
      );
      expect(r.outcome).toBe('requires_review');
      if (r.outcome === 'requires_review') expect(r.reason).toBe('phone_only_insufficient');
    });
  });
});

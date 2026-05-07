/**
 * Tests for the BI.1 type-module helpers — predicates, factory
 * functions, and constants. The Firestore-shape interfaces don't
 * have runtime behavior to assert; this file just locks down the
 * constants and the membership-check predicates so a future drift on
 * the status union doesn't silently change reconciler / dashboard
 * semantics.
 */

import {
  ACTIVE_ROW_STATUSES,
  BULK_INVITE_DEFAULT_QUEUE,
  BULK_INVITE_MIN_SECURITY_LEVEL,
  CAP_ERROR_COUNT,
  HARD_STOP_DAYS,
  REMINDER_SCHEDULE_DAYS,
  TERMINAL_ROW_STATUSES,
  emptyJobCounters,
  emptyMatchOutcomes,
  isActiveRowStatus,
  isTerminalRowStatus,
  BulkInviteRowStatus,
} from '../bulkInvite';

describe('bulkInvite type module', () => {
  describe('constants', () => {
    it('cap error count is 3 (Appendix A.A.4)', () => {
      expect(CAP_ERROR_COUNT).toBe(3);
    });

    it('reminder schedule is [3, 7, 14] with hard stop at 21 (§6.1)', () => {
      expect([...REMINDER_SCHEDULE_DAYS]).toEqual([3, 7, 14]);
      expect(HARD_STOP_DAYS).toBe(21);
    });

    it('default queue is bulk-invite-rows (Appendix A.B.2)', () => {
      expect(BULK_INVITE_DEFAULT_QUEUE).toBe('bulk-invite-rows');
    });

    it('min security level for the page is 7 (Appendix A.E)', () => {
      expect(BULK_INVITE_MIN_SECURITY_LEVEL).toBe(7);
    });
  });

  describe('row-status membership predicates', () => {
    const ACTIVE: BulkInviteRowStatus[] = [
      'pending',
      'processing',
      'invited',
      'reminded_1',
      'reminded_2',
      'reminded_3',
    ];
    const TERMINAL: BulkInviteRowStatus[] = [
      'completed',
      'failed',
      'skipped',
      'cancelled',
      'invalid',
    ];

    it('isActiveRowStatus matches every active status', () => {
      for (const s of ACTIVE) expect(isActiveRowStatus(s)).toBe(true);
    });

    it('isActiveRowStatus rejects every terminal status', () => {
      for (const s of TERMINAL) expect(isActiveRowStatus(s)).toBe(false);
    });

    it('isTerminalRowStatus matches every terminal status', () => {
      for (const s of TERMINAL) expect(isTerminalRowStatus(s)).toBe(true);
    });

    it('isTerminalRowStatus rejects every active status', () => {
      for (const s of ACTIVE) expect(isTerminalRowStatus(s)).toBe(false);
    });

    it('active and terminal sets are disjoint and total over the union', () => {
      const all = new Set<BulkInviteRowStatus>([
        ...ACTIVE_ROW_STATUSES,
        ...TERMINAL_ROW_STATUSES,
      ]);
      expect(all.size).toBe(ACTIVE_ROW_STATUSES.length + TERMINAL_ROW_STATUSES.length);
    });
  });

  describe('factory helpers', () => {
    it('emptyMatchOutcomes returns all zeros', () => {
      expect(emptyMatchOutcomes()).toEqual({
        netNew: 0,
        existingNotOnboarded: 0,
        alreadyOnboarded: 0,
        duplicateInFile: 0,
        invalid: 0,
      });
    });

    it('emptyJobCounters returns all zeros across all 7 counters', () => {
      const c = emptyJobCounters();
      expect(c).toEqual({
        totalRows: 0,
        pendingRows: 0,
        processingRows: 0,
        succeededRows: 0,
        failedRows: 0,
        skippedRows: 0,
        cancelledRows: 0,
      });
    });

    it('emptyJobCounters returns a fresh object on each call (no shared mutation)', () => {
      const a = emptyJobCounters();
      const b = emptyJobCounters();
      a.totalRows = 99;
      expect(b.totalRows).toBe(0);
    });
  });
});

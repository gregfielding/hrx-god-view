/**
 * Claim release — what happens to the APPLICATION when a claimed assignment
 * is cancelled (Greg, 2026-09-06, after the first production claim).
 *
 * Manual placements keep today's behavior: cancel reverts the application to
 * "submitted" so the worker stays in the recruiter's pool and can be moved.
 * A claim is different — the worker grabbed one shift-day, they never applied
 * to the job order — so leaving them as a "Shift Requested" applicant misleads
 * both sides. On cancel (recruiter red X OR worker self-cancel) the claim is
 * released:
 *   - the application the claim CREATED is deleted outright;
 *   - an application that pre-existed (worker had applied to other days /
 *     shifts on the JO) just loses this shift-day; if nothing is left it is
 *     withdrawn, never left as a live "submitted" request for a day the
 *     worker no longer holds.
 * The ASSIGNMENT doc is kept (status cancelled / worker-cancelled) as the
 * audit trail Friday's cancel-policy work needs — nothing on the board or in
 * the pool reads it, so to both sides it looks like the claim never happened.
 * Pure — no Firestore — so mocha covers every branch.
 */

export interface ClaimReleaseApplication {
  source?: unknown;
  status?: unknown;
  shiftId?: unknown;
  shiftIds?: unknown;
  applyDate?: unknown;
  applyDates?: unknown;
  workerClaimConfirmation?: unknown;
}

export type ClaimReleasePlan =
  | { action: 'delete'; reason: 'created_by_claim' | 'only_this_claim' }
  | {
      action: 'update';
      patch: {
        shiftIds?: string[];
        shiftId?: string | null;
        applyDates?: string[];
        applyDate?: string | null;
        status?: 'withdrawn';
      };
      reason: 'other_days_remain' | 'other_shifts_remain' | 'nothing_left';
    }
  | { action: 'none'; reason: 'no_application' };

function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x ?? '').trim()).filter(Boolean);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Decide how to release `shiftId` / `dayKey` from the application a claimed
 * assignment is linked to.
 */
export function planClaimRelease(args: {
  application: ClaimReleaseApplication | null | undefined;
  shiftId: string;
  dayKey: string;
}): ClaimReleasePlan {
  const { application, shiftId, dayKey } = args;
  if (!application) return { action: 'none', reason: 'no_application' };

  // Created by the claim itself (claimShift stamps source 'claim'; older
  // claim-created docs carry workerClaimConfirmation with nothing else).
  if (str(application.source) === 'claim') return { action: 'delete', reason: 'created_by_claim' };

  const shiftIds = Array.from(new Set([...strList(application.shiftIds), ...(str(application.shiftId) ? [str(application.shiftId)] : [])]));
  const days = Array.from(new Set([...strList(application.applyDates), ...(str(application.applyDate) ? [str(application.applyDate)] : [])]));

  const otherShifts = shiftIds.filter((s) => s !== shiftId);
  const otherDays = dayKey ? days.filter((d) => d !== dayKey) : days;

  if (application.workerClaimConfirmation && otherShifts.length === 0 && otherDays.length === 0) {
    return { action: 'delete', reason: 'only_this_claim' };
  }

  if (otherDays.length > 0 && days.length > 0) {
    // Same shift, other days still requested → drop just this day.
    return {
      action: 'update',
      patch: { applyDates: otherDays, applyDate: otherDays[0] },
      reason: 'other_days_remain',
    };
  }
  if (otherShifts.length > 0) {
    return {
      action: 'update',
      patch: {
        shiftIds: otherShifts,
        shiftId: otherShifts.length === 1 ? otherShifts[0] : null,
        ...(days.length > 0 ? { applyDates: otherDays, applyDate: otherDays[0] ?? null } : {}),
      },
      reason: 'other_shifts_remain',
    };
  }
  return {
    action: 'update',
    patch: { status: 'withdrawn', applyDates: [], applyDate: null },
    reason: 'nothing_left',
  };
}

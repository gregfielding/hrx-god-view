/**
 * Assignment outcome vocabulary — Phase 4 of `docs/WORKFORCE_DOMAIN_MODEL.md`.
 *
 * An assignment's `status` carries the whole lifecycle (pending → confirmed
 * → [active during shift] → terminal outcome). These types cover the
 * terminal outcome side: what a recruiter marks after (or during) a shift.
 *
 * Hours-worked capture is intentionally NOT part of this contract — that
 * moves onto timesheet docs in Phase 6. Writing outcome here and writing
 * hours later are separate actions.
 *
 * Runtime-neutral: no firebase imports, no Timestamp. Dates are ISO-8601
 * strings. Callers convert to Firestore Timestamp on write.
 */

/**
 * Terminal outcome statuses a recruiter can mark on an assignment.
 * Intentionally parallel to the doc §2.1 `AssignmentStatus` union —
 * kept separate so we can reference "just the outcome set" without the
 * earlier lifecycle states.
 */
export type AssignmentOutcomeStatus =
  | 'completed'          // worker finished the shift as expected
  | 'no_show'            // worker did not arrive
  | 'left_early'         // worker arrived but left before the scheduled end
  | 'cancelled_business' // account / HRX cancelled (no fault of worker)
  | 'cancelled_worker';  // worker withdrew before or at shift start

/**
 * Entry appended to `assignment.outcomeHistory` every time an outcome is
 * set, changed, or undone. Append-only; the most recent entry describes
 * the current state. Payroll / audit reads this array rather than
 * relying on a single `outcomeAt` timestamp that gets overwritten.
 */
export type AssignmentOutcomeHistoryEntry = {
  /** ISO-8601. */
  at: string;
  /** `users/{uid}` of the recruiter (or 'system' if auto-written). */
  actorUid: string;
  /** What just happened. */
  action: 'set' | 'changed' | 'undone';
  /** Prior status. Always a string; omitted when the doc had no prior status (shouldn't happen in practice). */
  fromStatus?: string;
  /**
   * New status. For `set` / `changed`, this is an outcome code.
   * For `undone`, this is the status we reverted TO (usually `confirmed`).
   */
  toStatus: string;
  /** Optional note captured in the dialog. */
  notes?: string;
};

/**
 * Input for the `setAssignmentOutcome` callable.
 *
 * Two modes:
 *   - Set / change outcome: `outcomeStatus` is one of the union members.
 *     `notes` is optional (UI can require it per-reason client-side).
 *   - Undo: `outcomeStatus === null`. Reverts status to `confirmed`,
 *     clears outcome fields, appends an `undone` history entry. The
 *     assignment trigger decrements any AccountWorkforce counters that
 *     were bumped at outcome time.
 */
export type SetAssignmentOutcomeInput = {
  tenantId: string;
  assignmentId: string;
  outcomeStatus: AssignmentOutcomeStatus | null;
  notes?: string;
};

export type SetAssignmentOutcomeResult = {
  ok: true;
  assignmentId: string;
  /** Status the assignment ended up on after the write (outcome code or `confirmed` for undo). */
  status: string;
};

/**
 * Canonical display labels for the outcome menu + inactive view. Keep in
 * lockstep with the status union above.
 */
export const ASSIGNMENT_OUTCOME_LABELS: Record<AssignmentOutcomeStatus, string> = {
  completed: 'Completed',
  no_show: 'No-show',
  left_early: 'Left early',
  cancelled_business: 'Cancelled (business)',
  cancelled_worker: 'Cancelled (worker)',
};

/**
 * Which terminal outcomes count as "shift was worked" and should bump
 * `AccountWorkforce.totalShifts`. Cancellations don't (no shift happened).
 * Must mirror `TERMINAL_OUTCOME_STATUSES` in the workforce trigger — the
 * trigger imports this set to stay aligned.
 */
export const WORKED_OUTCOME_STATUSES: ReadonlyArray<AssignmentOutcomeStatus> = [
  'completed',
  'no_show',
  'left_early',
] as const;

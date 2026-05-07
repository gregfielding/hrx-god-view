/**
 * Bulk Invite types — `/users/bulk-import` (BI.1).
 *
 * Source of truth for the BulkInviteJob + BulkInviteRow Firestore docs
 * stored under `tenants/{t}/bulk_invite_jobs/{jobId}` and
 * `tenants/{t}/bulk_invite_jobs/{jobId}/rows/{rowId}`.
 *
 * Reflects all approved amendments to BULK_INVITE_PLAN.md (Appendix A,
 * 2026-05-07). Implementation must follow the amended spec — the
 * original plan §2 has been superseded for the fields listed here.
 *
 * Phase 1 (this file) formalizes the types only. Persistence,
 * callables, processor logic, and reconciler arrive in P2/P3/P4. Until
 * those phases land, no code reads or writes documents at these paths
 * — but the types stay aligned with the plan so P2/P3/P4 can import
 * them without divergence.
 *
 * Audit:
 *   - A.1: SSN last-4 fields removed entirely from BulkInviteRow.
 *   - A.2: nextReminderDueAt added to BulkInviteRow.
 *   - A.3: lastEvereeProvisionWarning + evereeProvisionedAt added.
 *   - A.4: errorCount cap is documented next to the field; the
 *          constant CAP_ERROR_COUNT lives next to the processor (P3).
 *   - B.1: Counter fields are present on BulkInviteJob but populated
 *          by `bulkInviteJobReconciler` (P3 cron). Row processors do
 *          NOT increment them transactionally — see warning below.
 *   - B.2: queueName added to BulkInviteJob.
 *   - B.3: uploadedBySecurityLevel added to BulkInviteJob.
 *   - C.1: User-doc additions live in `src/types/migration/userMigrationFields.ts`.
 *   - E:   Permission gate (sec >= 7) enforced by `firestore.rules`
 *          and the route, not by these types.
 */

import type { Timestamp } from 'firebase/firestore';

/* -------------------------------------------------------------------------
 * Constants
 * ------------------------------------------------------------------------- */

/**
 * Per-row retry cap. The row processor (P3) increments
 * `BulkInviteRow.errorCount` on each failed task attempt. When
 * `errorCount` reaches this value the row transitions to `'failed'`
 * and the recruiter retries manually via the dashboard. Cloud Tasks
 * also has its own retry policy upstream (3 attempts, exp backoff);
 * this constant is the additional guard inside the processor for
 * deterministic-failure cases that should NOT retry forever.
 */
export const CAP_ERROR_COUNT = 3;

/**
 * Default Cloud Tasks queue for row tasks. Stored on each
 * `BulkInviteJob.queueName` at upload time so that "retry failed
 * rows" runs against the same queue + so a deploy that renamed the
 * queue fails loud. Per Appendix B Q1, this queue must be provisioned
 * separately from `default` to isolate concurrency caps from
 * translation/everify/etc.
 */
export const BULK_INVITE_DEFAULT_QUEUE = 'bulk-invite-rows';

/**
 * Reminder cadence in days from `invitedAt`. Hard stop at 21 days.
 * The processor stamps `nextReminderDueAt = invitedAt + 3d` on the
 * `pending → invited` flip; the reminder cron walks forward through
 * the schedule and updates `nextReminderDueAt` after each step.
 */
export const REMINDER_SCHEDULE_DAYS: readonly number[] = [3, 7, 14] as const;
export const HARD_STOP_DAYS = 21;

/**
 * Minimum security level allowed to access `/users/bulk-import` and
 * to operate any bulk_invite_jobs callable. Enforced by route +
 * `firestore.rules` (sec-7 gate per Appendix A.E).
 */
export const BULK_INVITE_MIN_SECURITY_LEVEL = 7;

/* -------------------------------------------------------------------------
 * BulkInviteJob — `tenants/{t}/bulk_invite_jobs/{jobId}`
 * ------------------------------------------------------------------------- */

/**
 * Job-level status state machine. See BULK_INVITE_PLAN.md §2.1 for
 * the original transition diagram; counters move per Appendix A.B.1.
 */
export type BulkInviteJobStatus =
  | 'parsing' // CSV parse in progress
  | 'preview' // parsed, awaiting recruiter confirm
  | 'queued' // confirmed, tasks enqueued
  | 'processing' // tasks running
  | 'cancelling' // recruiter hit cancel; queue draining
  | 'cancelled' // queue drained, no further work
  | 'complete' // all rows terminal
  | 'failed'; // file-level failure (parse error, schema mismatch)

export type BulkInviteSource = 'tempworks_migration' | 'manual_csv' | 'other';

/**
 * Match outcome counts captured at preview time. Distinct from the
 * row-status counters below; these never change after preview.
 */
export interface BulkInviteMatchOutcomeTotals {
  netNew: number;
  existingNotOnboarded: number;
  alreadyOnboarded: number;
  duplicateInFile: number;
  invalid: number;
}

export interface BulkInviteJob {
  id: string;
  tenantId: string;
  hiringEntityId: string;
  /** Denormalized from `tenants/{t}/entities/{entityId}` for dashboard rendering. */
  hiringEntityName: string;

  source: BulkInviteSource;
  fileName: string;
  /** sha256 of uploaded bytes; future dedup-on-upload check. */
  fileChecksum: string;

  uploadedBy: string;
  uploadedAt: Timestamp;
  /**
   * Effective security level of the uploader at upload time
   * (Appendix A.B.3). Captured so future gate-tightening doesn't lose
   * historical visibility into who could run bulk imports.
   */
  uploadedBySecurityLevel: number;

  status: BulkInviteJobStatus;

  /**
   * Row-status counters. IMPORTANT (Appendix A.B.1): these are
   * computed by `bulkInviteJobReconciler` (1-min cron, P3) from a
   * counted query of the rows subcollection. The per-row processor
   * does NOT increment these transactionally — at 10 in-flight × ~5s
   * per row = 2 writes/sec on the same job doc, right at Firestore's
   * single-doc soft limit. Eventual consistency with ~60s lag is
   * acceptable for a multi-hour run; "retry failed rows" stays
   * trivially correct because counters re-derive themselves.
   */
  totalRows: number;
  pendingRows: number;
  processingRows: number;
  succeededRows: number;
  failedRows: number;
  skippedRows: number;
  cancelledRows: number;

  /** Set by the parser at preview time; never changes. */
  matchOutcomes: BulkInviteMatchOutcomeTotals;

  /** Hardcoded today (`'tempworks_migration_v1'`); Firestore-backed when M.1 lands. */
  sequenceId: string;
  /** Optional override of the first message body. */
  customMessageOverride?: string;

  /**
   * Reminder cadence in days from `invitedAt`. Defaults to
   * `REMINDER_SCHEDULE_DAYS`. Persisted on the job (not derived from
   * the constant) so a job's cadence is immutable across rolling
   * code changes that touch the default.
   */
  reminderSchedule: number[];

  /**
   * Cloud Tasks queue used for this job's row tasks (Appendix A.B.2).
   * Defaults to `BULK_INVITE_DEFAULT_QUEUE`. Recorded so retry-failed
   * uses the same queue + bad deploys (queue renamed/unprovisioned)
   * fail loud rather than silently land in the wrong queue.
   */
  queueName?: string;

  createdAt: Timestamp;
  updatedAt: Timestamp;
  cancelledAt?: Timestamp;
  cancelledBy?: string;
  completedAt?: Timestamp;
}

/* -------------------------------------------------------------------------
 * BulkInviteRow — `tenants/{t}/bulk_invite_jobs/{jobId}/rows/{rowId}`
 * ------------------------------------------------------------------------- */

/**
 * Per-row processor state. Status flips happen in two layers:
 *   1. Match phase (parser) → 'pending' (queue) | 'skipped' (already-onboarded /
 *      duplicate-in-file) | 'invalid' (parse fail).
 *   2. Execution phase (processor + reminder cron + webhook) →
 *      'processing' → 'invited' → 'reminded_*' → 'completed' / 'failed'.
 *      Soft-cancel routes processor branches to 'cancelled'.
 */
export type BulkInviteRowStatus =
  | 'pending' // queued, awaiting processor
  | 'processing' // task running
  | 'invited' // first message sent
  | 'reminded_1'
  | 'reminded_2'
  | 'reminded_3'
  | 'completed' // Everee onboarding done
  | 'failed' // terminal failure (errorCount >= CAP_ERROR_COUNT or hard-stop)
  | 'skipped' // already onboarded for this entity, or duplicate-in-file
  | 'cancelled' // job cancelled before processing reached this row
  | 'invalid'; // parser-level row reject

export type BulkInviteMatchOutcome =
  | 'net_new'
  | 'existing_not_onboarded'
  | 'already_onboarded'
  | 'duplicate_in_file'
  | 'invalid';

export type BulkInviteMatchedBy = 'email_and_phone' | 'email_only' | 'phone_only';

/**
 * Raw inputs from the source CSV (lossless). Only fields actually
 * present in the Tempworks export are typed here; future migration
 * sources will extend this shape additively.
 *
 * Note: SSN last-4 was removed from this shape per Appendix A.A.1.
 * Match logic uses email + phone only; do not reintroduce plaintext
 * SSN fields without a hashing strategy.
 */
export interface BulkInviteRawRow {
  lastName: string;
  firstName: string;
  middleName?: string;
  tempworksEmployeeId: string;
  cellPhone?: string;
  phone?: string;
  officePhone?: string;
  email?: string;
}

export interface BulkInviteNormalizedRow {
  /** Lowercased email. */
  email: string;
  /** Digits-only, leading-1 dropped if 11 digits. */
  phoneCanonical: string;
}

export interface BulkInviteRow {
  id: string;
  tenantId: string;
  jobId: string;
  /** Index in the source CSV for traceability when the recruiter exports a failure list. */
  rowIndex: number;

  rawRow: BulkInviteRawRow;
  normalized: BulkInviteNormalizedRow;

  matchOutcome: BulkInviteMatchOutcome;
  /** UID of the existing HRX user this row matched to, when applicable. */
  matchedUserId?: string;
  matchedBy?: BulkInviteMatchedBy;
  /**
   * When `matchOutcome === 'duplicate_in_file'`, points at the first
   * row with the same normalized email/phone. The first occurrence
   * processes; later rows skip.
   */
  duplicateOfRowId?: string;

  status: BulkInviteRowStatus;

  invitedAt?: Timestamp;
  lastReminderAt?: Timestamp;
  /**
   * When the reminder cron should next consider this row (Appendix
   * A.A.2). Set by the processor on the `pending → invited` flip
   * (`invitedAt + 3d`); updated by the cron after each step. Set to
   * `null` (or omitted) once the row reaches a terminal state so the
   * cron's `where nextReminderDueAt <= now` query falls past it.
   */
  nextReminderDueAt?: Timestamp | null;
  completedAt?: Timestamp;

  /** Everee's internal worker UUID. Captured by the processor when provisioning succeeds. */
  evereeWorkerId?: string;
  /**
   * `runStartOnCallEmploymentFlow` returns
   * `evereeProvisionWarning?: string | null` separately from hard
   * errors. When that's set, on-call employment succeeded (the row
   * still reaches `'invited'`) but Everee provisioning didn't —
   * recruiter may need to re-sync from the Employment tab. The
   * dashboard surfaces this as "X invited (Y with Everee retry
   * needed)" without flipping rows red. (Appendix A.A.3.)
   */
  lastEvereeProvisionWarning?: string;
  evereeProvisionedAt?: Timestamp;

  /** Set when the row terminally fails (e.g. 3rd retry). */
  errorMessage?: string;
  /**
   * Increments on each task retry inside the processor. When it
   * reaches `CAP_ERROR_COUNT` the row → `'failed'`. Defaults to 0;
   * never decremented. (Appendix A.A.4.)
   */
  errorCount: number;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/* -------------------------------------------------------------------------
 * Default factories
 *
 * Used by the page shell + future P2 callable to seed values without
 * scattering literals. `createdAt` / `updatedAt` are stamped at write
 * time so they're not present here.
 * ------------------------------------------------------------------------- */

export function emptyMatchOutcomes(): BulkInviteMatchOutcomeTotals {
  return {
    netNew: 0,
    existingNotOnboarded: 0,
    alreadyOnboarded: 0,
    duplicateInFile: 0,
    invalid: 0,
  };
}

/**
 * Initial counter state for a fresh job (matches Firestore writes
 * during `parsing` / `preview` phases). All zero — counters are
 * populated by the reconciler once rows exist.
 */
export function emptyJobCounters(): Pick<
  BulkInviteJob,
  | 'totalRows'
  | 'pendingRows'
  | 'processingRows'
  | 'succeededRows'
  | 'failedRows'
  | 'skippedRows'
  | 'cancelledRows'
> {
  return {
    totalRows: 0,
    pendingRows: 0,
    processingRows: 0,
    succeededRows: 0,
    failedRows: 0,
    skippedRows: 0,
    cancelledRows: 0,
  };
}

/**
 * Terminal states for a `BulkInviteRow.status`. Used by the
 * reconciler (P3) to decide which rows count toward `succeededRows`
 * vs `failedRows` vs `skippedRows` vs `cancelledRows`, and by the UI
 * to grey out per-row actions.
 */
export const TERMINAL_ROW_STATUSES: readonly BulkInviteRowStatus[] = [
  'completed',
  'failed',
  'skipped',
  'cancelled',
  'invalid',
] as const;

export function isTerminalRowStatus(status: BulkInviteRowStatus): boolean {
  return (TERMINAL_ROW_STATUSES as readonly string[]).includes(status);
}

/**
 * Active states — rows that may still consume processor work or
 * receive reminders. Complement of `TERMINAL_ROW_STATUSES`.
 */
export const ACTIVE_ROW_STATUSES: readonly BulkInviteRowStatus[] = [
  'pending',
  'processing',
  'invited',
  'reminded_1',
  'reminded_2',
  'reminded_3',
] as const;

export function isActiveRowStatus(status: BulkInviteRowStatus): boolean {
  return (ACTIVE_ROW_STATUSES as readonly string[]).includes(status);
}

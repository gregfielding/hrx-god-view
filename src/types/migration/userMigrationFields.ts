/**
 * User-doc migration fields — additive optional fields stamped on
 * `users/{uid}` when a user is created or touched by a bulk-migration
 * pipeline (BI.1 today; future migration sources additive).
 *
 * Per BULK_INVITE_PLAN.md Appendix A.C.1 these live in their own
 * module rather than extending a canonical `User` interface, because
 * the codebase currently doesn't have a single source-of-truth User
 * type — user-shape consumers all inline their reads. Keeping the
 * migration fields isolated here means:
 *   1. P3 can import them at the one site that writes them (the row
 *      processor in `functions/src/bulkInvite/bulkInviteRowProcessor.ts`).
 *   2. Future "which workers came in via migration?" reporting can
 *      import the same module from the read side.
 *   3. If/when a canonical User interface is introduced, the
 *      migration fields can be folded in by extending or intersecting
 *      `UserMigrationFields` — no breaking change here.
 *
 * Constraints (from the plan):
 *   - Only BI.1 jobs running with `source: 'tempworks_migration'` set
 *     `migrationSource: 'tempworks_bulk_invite'`. Other paths leave
 *     the field unset until those code paths are written.
 *   - `migratedAt` is set ONLY on the user's first touch by any
 *     bulk-invite job (never reset on subsequent runs).
 *   - No backfill of existing users — out of scope for BI.1.
 *   - On match, the bulk-invite processor pushes the new
 *     Tempworks employee ID onto `tempworksEmployeeIds` only if not
 *     already present (set semantics, latest first).
 */

import type { Timestamp } from 'firebase/firestore';

export type UserMigrationSource =
  | 'tempworks_bulk_invite'
  | 'manual_csv'
  | 'other';

/**
 * The optional, additive fields the BI.1 row processor writes onto
 * existing or newly-created `users/{uid}` documents. All fields are
 * optional from the user-doc shape's perspective: existing users
 * created via the recruiter / apply flow have none of these set.
 */
export interface UserMigrationFields {
  /**
   * Historical Tempworks IDs for this worker. Latest first; the row
   * processor pushes a new ID only if it isn't already in the array
   * (the same person can have multiple IDs over time when their
   * Tempworks record is reactivated). Used as an audit trail — never
   * the primary linkage key for matching.
   */
  tempworksEmployeeIds?: string[];

  /**
   * Pipeline that first migrated this user into HRX. Set ONLY by the
   * BI.1 processor today (value `'tempworks_bulk_invite'`). Other
   * values reserved for future migration paths; do not write them
   * until those paths exist.
   */
  migrationSource?: UserMigrationSource;

  /**
   * First time any bulk-invite job touched this user. Stamped on
   * net-new user creation OR the first time an existing user was
   * matched into a bulk_invite_job. Never overwritten on subsequent
   * runs — keeps the "when did they enter the migration funnel?"
   * answer stable.
   */
  migratedAt?: Timestamp;
}

/**
 * Helper for the P3 row processor: produce the additive write patch
 * for a user during a bulk-invite run. Pass the existing user doc
 * (or null for net-new). Returns `null` when nothing should be
 * written (existing user, IDs already present, fields already set).
 *
 * Lives next to the type so the field-write semantics stay tight to
 * the schema contract. The row processor wires this to `update()` /
 * `set()` calls; this helper is responsible for never overwriting
 * `migrationSource` or `migratedAt` once they're set, and for
 * computing the deduped `tempworksEmployeeIds` array.
 */
export function buildUserMigrationFieldsPatch(args: {
  existingFields: UserMigrationFields | null | undefined;
  newTempworksEmployeeId: string;
  source: UserMigrationSource;
  /** Server-stamped timestamp; passed in by the caller for testability. */
  now: Timestamp;
}): Partial<UserMigrationFields> | null {
  const existing = args.existingFields ?? {};
  const patch: Partial<UserMigrationFields> = {};

  const newId = args.newTempworksEmployeeId.trim();
  if (newId) {
    const existingIds = existing.tempworksEmployeeIds ?? [];
    if (!existingIds.includes(newId)) {
      patch.tempworksEmployeeIds = [newId, ...existingIds];
    }
  }

  if (!existing.migrationSource) {
    patch.migrationSource = args.source;
  }

  if (!existing.migratedAt) {
    patch.migratedAt = args.now;
  }

  return Object.keys(patch).length === 0 ? null : patch;
}

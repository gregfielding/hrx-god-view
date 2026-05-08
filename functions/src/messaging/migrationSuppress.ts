/**
 * Migration-aware messaging suppression — single source of truth.
 *
 * **Why this exists**: bulk-migration tooling (BI.0 Tempworks emergency
 * import, BI.1 phased Bulk Invite, future migrations) creates or
 * touches user docs at scale. The messaging triggers and schedulers
 * that fire on user-create or run on a cadence (apply-wizard reminder,
 * auto interview invite, welcome SMS) treat new / updated user docs
 * as standalone product-flow events and would otherwise fan out
 * worker-facing SMS in the middle of a controlled migration. That's
 * how an unrelated 4-SMS scheduler tick during the BI.0 emergency
 * window looked like collateral damage from the script (turned out
 * coincidence after phoneLast4 + userId cross-checks, but the
 * architectural risk is real for future bigger runs).
 *
 * **Contract**: when a user doc carries a `migrationSource` matching
 * one of the active-migration prefixes, every messaging trigger and
 * scheduler should refuse to send. The migration tool is responsible
 * for its own curated mass-send (rate-limited, contextual copy)
 * after the bulk operation completes.
 *
 * **Recognized prefixes**:
 *   - `tempworks_*` — BI.0 emergency Tempworks → HRX → Everee
 *     migration (e.g. `tempworks_emergency_2026-05-07`,
 *     `tempworks_bulk_invite`).
 *   - `bi1_*` — BI.1 phased Bulk Invite tool's eventual messaging
 *     engine. Forward-compat: when BI.1 P3 lands, the same gate
 *     fires for any user doc tagged with this prefix.
 *
 * Anything else (`manual_csv`, `other`, unset) falls through and the
 * messaging trigger / scheduler proceeds normally.
 *
 * **Why not query-filter the schedulers** (`where migrationSource not-in
 * ['tempworks_*', 'bi1_*']`): Firestore doesn't support prefix-NOT-IN
 * queries, would require a composite index per prefix variant, and
 * silently filtering out rows hides the suppression count from
 * operators. In-loop skip + counter + audit row keeps the index
 * requirements unchanged AND gives operators visibility into how
 * many docs are being suppressed each tick.
 *
 * **Test contract**: see `__tests__/messaging/migrationSuppress.test.ts`.
 */

/**
 * Returns true when the user doc indicates the user is in the middle
 * of an active bulk migration whose tooling will handle messaging
 * separately. Synchronous; safe to call inside hot loops.
 *
 * Tolerates non-string `migrationSource` values defensively (Firestore
 * occasionally surfaces unexpected types when schemas drift); anything
 * non-string is treated as "no migration".
 */
export function userIsInActiveMigration(
  data: Record<string, unknown> | null | undefined,
): boolean {
  if (!data) return false;
  const raw = data.migrationSource;
  if (typeof raw !== 'string') return false;
  const src = raw.trim();
  if (!src) return false;
  return /^tempworks_/.test(src) || /^bi1_/.test(src);
}

/**
 * Standard Firestore patch for clearing the apply-wizard reminder
 * pending flag when suppressed by an active migration. Marks the
 * doc with an explicit abort reason so the audit trail is honest
 * about WHY the SMS was never sent (vs. silently disappearing).
 *
 * Use as the value side of `docSnap.ref.update(buildApplyWizardSuppressionPatch())`.
 *
 * IMPORTANT: this patch does NOT include `updatedAt: serverTimestamp()`
 * — callers must add that themselves to match their existing pattern.
 * The reason: the apply-wizard scheduler updates a stack of fields per
 * row and we don't want to fight ordering.
 */
export const APPLY_WIZARD_SUPPRESSION_REASON = 'active_migration';

/**
 * Standard Firestore patch fragment for clearing the auto-interview
 * invite scheduling when suppressed by an active migration. Same
 * audit-trail-honesty rationale as the apply-wizard variant.
 */
export const AUTO_INTERVIEW_SUPPRESSION_OUTCOME = 'skipped_active_migration';

/**
 * Audit field appended to dispatch logs / loggers so a grep for
 * `migration_suppression` pulls every related entry. Keep stable
 * across the trigger families so dashboards can pivot on it.
 */
export const MIGRATION_SUPPRESSION_LOG_TAG = 'migration_suppression';

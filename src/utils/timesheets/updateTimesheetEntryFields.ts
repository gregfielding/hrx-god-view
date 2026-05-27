/**
 * Client-side write path for inline cell edits on `TimesheetEntryV2`.
 *
 * **Why a direct client write (not a callable).** Save-on-blur fires
 * frequently (every cell commit), and a callable round-trip adds
 * 100-300ms per save plus a CORS preflight on cold starts. The
 * `firestore.rules` `allow update` clause for `timesheet_entries`
 * (added in P3.A) makes a direct write safe by enforcing:
 *   1. Caller is recruiter band (HRX or sec >= 5 on the tenant).
 *   2. Entry status is editable (not `sent_to_everee` or `paid`).
 *   3. `affectedKeys` ⊆ {actualStartTime, actualEndTime, breaks, tips,
 *      bonusAmount, notes, updatedAt, updatedBy}.
 *
 * The client cannot bump status, mutate computed fields, change rates,
 * or stamp Everee response data — those go through callables.
 *
 * **Validation lives BEFORE this function fires.** Cells call the
 * `entryValidation.ts` validators on blur; only after `{ ok: true }`
 * do they invoke `updateTimesheetEntryFields`. Garbage never reaches
 * Firestore (and therefore never reaches the recompute trigger).
 *
 * **Mutual exclusion of writes.** Saves to the same entry from
 * different cells in quick succession are NOT serialized here —
 * Firestore's last-write-wins is fine because:
 *   1. The cells write disjoint key sets (TimeCell writes
 *      actualStartTime; NumberCell writes tips). No conflict.
 *   2. If a recruiter Cmd+Z's a save mid-flight, the second write
 *      lands cleanly with the prior value.
 *
 * **Recompute trigger.** Every successful write here ALSO advances
 * `updatedAt` (server timestamp). The trigger's Tier-1 gate compares
 * `before.actualStartTime !== after.actualStartTime` etc.; if any of
 * `[actualStartTime, actualEndTime, breaks]` changed, the trigger
 * recomputes. Notes/tips/bonus changes alone exit at Tier-1.
 */

import {
  doc,
  serverTimestamp,
  updateDoc,
  type FieldValue,
} from 'firebase/firestore';

import { db } from '../../firebase';
import type { TimesheetBreak } from '../../types/recruiter/timesheet';

/* -------------------------------------------------------------------------
 * Public types
 * ------------------------------------------------------------------------- */

/**
 * Editable fields on `TimesheetEntryV2` from the recruiter grid. Mirror
 * 1:1 of the Firestore rule's allowlist — if you add a field here,
 * update `firestore.rules` AND the `affectedKeys().hasOnly([...])`
 * check inside it. Lockstep is essential: a missed rule update will
 * cause silent permission-denied errors on save; a missed type update
 * here means new fields can't be written from the grid.
 */
export interface TimesheetEntryEditablePatch {
  actualStartTime?: string | null;
  actualEndTime?: string | null;
  breaks?: TimesheetBreak[];
  /**
   * Manual total-hours override (decimal hours). Used when the client
   * reports a single total without start/end. The recompute trigger
   * honors this only when actualStartTime AND actualEndTime are both
   * null/empty — see TimesheetEntryV2.actualHoursOverride.
   * `null` clears the override.
   */
  actualHoursOverride?: number | null;
  tips?: number;
  bonusAmount?: number;
  notes?: string;
}

export interface UpdateTimesheetEntryFieldsArgs {
  tenantId: string;
  entryId: string;
  patch: TimesheetEntryEditablePatch;
  /** UID of the caller. Stamped onto `updatedBy` so audit logs can
   *  attribute the edit. The caller (a hook with access to AuthContext)
   *  always knows this; we don't pull it from `auth.currentUser` here
   *  because that would couple this helper to Firebase Auth singletons
   *  and break easy testing. */
  actorUid: string;
}

/* -------------------------------------------------------------------------
 * Wire-shape helpers
 * ------------------------------------------------------------------------- */

/**
 * Convert the editable patch to the exact Firestore wire shape:
 *   - `actualStartTime: null` is sent as `null` (clears the field).
 *   - `notes: ''` is sent as `''` (clears, doesn't delete).
 *   - `breaks: []` is sent as an empty array (replaces, doesn't merge).
 *   - undefined fields are dropped — we never send them.
 *
 * `updatedAt` and `updatedBy` are ALWAYS appended. The rule's
 * `affectedKeys().hasOnly([...])` check requires them to be present
 * in the allowlist; we enforce on the client side that they're
 * always sent on every patch.
 */
function buildWirePatch(
  patch: TimesheetEntryEditablePatch,
  actorUid: string,
): Record<string, unknown> & { updatedAt: FieldValue; updatedBy: string } {
  const out: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  };

  if (patch.actualStartTime !== undefined) {
    out.actualStartTime = patch.actualStartTime;
  }
  if (patch.actualEndTime !== undefined) {
    out.actualEndTime = patch.actualEndTime;
  }
  if (patch.breaks !== undefined) {
    out.breaks = patch.breaks;
  }
  if (patch.actualHoursOverride !== undefined) {
    out.actualHoursOverride = patch.actualHoursOverride;
  }
  if (patch.tips !== undefined) {
    out.tips = patch.tips;
  }
  if (patch.bonusAmount !== undefined) {
    out.bonusAmount = patch.bonusAmount;
  }
  if (patch.notes !== undefined) {
    out.notes = patch.notes;
  }

  return out as Record<string, unknown> & {
    updatedAt: FieldValue;
    updatedBy: string;
  };
}

/* -------------------------------------------------------------------------
 * Main entrypoint
 * ------------------------------------------------------------------------- */

/**
 * Apply an inline-edit patch to a single `TimesheetEntryV2` document.
 *
 * Throws on:
 *   - Missing tenantId / entryId / actorUid (programming error).
 *   - Empty patch (no editable fields supplied — caller bug).
 *   - Firestore rejection (permission-denied, not-found, etc.) —
 *     surfaced as the underlying `FirebaseError` so the cell chrome
 *     can read `.code` to render a specific message
 *     ("permission-denied" → "Lost edit access; reload" vs
 *     "unavailable" → "Connection issue, retrying...").
 *
 * **Idempotency.** Multiple calls with identical patches are
 * idempotent at the Firestore level (same end state) but each one
 * advances `updatedAt`. The Tier-1 gate on the recompute trigger
 * de-duplicates "no-op" writes by comparing values, so identical
 * patches don't trigger redundant recomputes either.
 */
export async function updateTimesheetEntryFields(
  args: UpdateTimesheetEntryFieldsArgs,
): Promise<void> {
  const { tenantId, entryId, patch, actorUid } = args;

  if (!tenantId) throw new Error('updateTimesheetEntryFields: tenantId required');
  if (!entryId) throw new Error('updateTimesheetEntryFields: entryId required');
  if (!actorUid) throw new Error('updateTimesheetEntryFields: actorUid required');

  const editableKeys = Object.keys(patch).filter(
    (k) => (patch as Record<string, unknown>)[k] !== undefined,
  );
  if (editableKeys.length === 0) {
    throw new Error(
      'updateTimesheetEntryFields: empty patch — no editable fields supplied',
    );
  }

  const wirePatch = buildWirePatch(patch, actorUid);
  const ref = doc(db, 'tenants', tenantId, 'timesheet_entries', entryId);
  await updateDoc(ref, wirePatch);
}

/* -------------------------------------------------------------------------
 * Test-only export
 *
 * Exposes `buildWirePatch` for unit tests without polluting the
 * public surface. Tests can verify the wire shape (incl. that
 * undefined fields are dropped, null values are kept, etc.) without
 * needing a Firebase mock.
 * ------------------------------------------------------------------------- */

export const __test__ = {
  buildWirePatch,
};

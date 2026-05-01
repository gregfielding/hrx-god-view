/**
 * **Hiring Entity sync — National → Children + their Job Orders.**
 *
 * One-shot callable that propagates a National Account's `hiringEntityId`
 * down to every child account under it AND every job order owned by
 * those children (plus any JOs directly under the National itself).
 *
 * **Fill-empty semantics** (Greg, 2026-04-30):
 *   - Children with NO `hiringEntityId` set → take the National's.
 *   - Children that already carry a hiring entity id → skipped, kept as-is.
 *   - Same rule for JOs.
 *
 * Rationale: a recruiter who has explicitly set a different hiring
 * entity on a sub-account or JO did so for a reason (special-case
 * payroll provider, transitional EOR, etc.); silently overwriting that
 * is a footgun. The button still fixes the common case — newly-imported
 * children + cascade-spawned JOs that landed without a hiring entity
 * because the National didn't have one set when the child/JO was
 * created.
 *
 * Status filter: none. Greg's call — back-office invoicing / payroll
 * fixes sometimes touch closed work, and skipping them would force a
 * separate manual editing step. The audit log records every touched
 * doc so a follow-up reversal is straightforward if needed.
 *
 * Inputs (callable data):
 *   - tenantId: string             (required)
 *   - nationalAccountId: string    (required, must be `accountType === 'national'`
 *                                   AND must have `hiringEntityId` set)
 *
 * Output:
 *   - summary: per-bucket counts.
 *   - audit:   per-doc outcomes (clamped at 1000 to keep payload small).
 *
 * Permissioning matches the existing tenant-staff backfill pattern.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

if (!admin.apps.length) {
  admin.initializeApp();
}

const FieldValue = admin.firestore.FieldValue;

// ─────────────────────────────────────────────────────────────────────
// Permission helper — same shape as the §14b backfill callable.
// ─────────────────────────────────────────────────────────────────────

interface AuthContext {
  uid: string;
  token: Record<string, unknown>;
}

function assertTenantStaff(
  auth: AuthContext | undefined,
  tenantId: string,
): void {
  if (!auth) throw new HttpsError('unauthenticated', 'Authentication required');
  if (auth.token.hrx === true) return;
  const roles = auth.token.roles as
    | Record<string, { role?: string }>
    | undefined;
  const role = roles?.[tenantId]?.role;
  if (role && ['Recruiter', 'Manager', 'Admin'].includes(role)) return;
  throw new HttpsError(
    'permission-denied',
    'Recruiter or Manager access required for this tenant',
  );
}

// ─────────────────────────────────────────────────────────────────────
// Result shapes
// ─────────────────────────────────────────────────────────────────────

export interface SyncHiringEntityAuditEntry {
  kind: 'child_account' | 'job_order';
  docId: string;
  /** Child name or JO `jobOrderName` for context. */
  displayName: string;
  action: 'updated' | 'skipped_existing' | 'skipped_same_value' | 'failed';
  previousHiringEntityId: string | null;
  reason?: string;
}

export interface SyncHiringEntityResult {
  summary: {
    nationalHiringEntityId: string;
    childAccountsScanned: number;
    childAccountsUpdated: number;
    childAccountsSkipped: number;
    childAccountsFailed: number;
    jobOrdersScanned: number;
    jobOrdersUpdated: number;
    jobOrdersSkipped: number;
    jobOrdersFailed: number;
  };
  /** Per-doc outcomes. Clamped at 1000 entries (older drop first). */
  audit: SyncHiringEntityAuditEntry[];
}

const MAX_AUDIT_ENTRIES = 1000;

const SYSTEM_ACTOR = 'system_sync_hiring_entity';

// ─────────────────────────────────────────────────────────────────────
// Pure decision unit — exported for unit tests
// ─────────────────────────────────────────────────────────────────────

export type SyncHiringEntityDecision =
  | { kind: 'update'; previous: null }
  | { kind: 'skip_existing'; previous: string }
  | { kind: 'skip_same_value'; previous: string };

/**
 * Pure: should we update this doc's `hiringEntityId` to the National's
 * value? Encodes the fill-empty policy in one place so both child + JO
 * loops behave identically and tests can pin the rule.
 *
 * Rules:
 *   - Empty / null / blank current → `update`.
 *   - Same value already → `skip_same_value` (counts toward "skipped"
 *     but doesn't trigger a write — saves a Firestore op).
 *   - Different non-empty value → `skip_existing` (preserve manual edit).
 */
export function decideHiringEntitySyncForDoc(args: {
  currentValue: unknown;
  nationalHiringEntityId: string;
}): SyncHiringEntityDecision {
  const { currentValue, nationalHiringEntityId } = args;
  const trimmed =
    typeof currentValue === 'string' ? currentValue.trim() : '';
  if (trimmed === '') {
    return { kind: 'update', previous: null };
  }
  if (trimmed === nationalHiringEntityId) {
    return { kind: 'skip_same_value', previous: trimmed };
  }
  return { kind: 'skip_existing', previous: trimmed };
}

// ─────────────────────────────────────────────────────────────────────
// Core runner — split out so tests can drive it with a fake Firestore.
// ─────────────────────────────────────────────────────────────────────

export async function runSyncHiringEntityFromNationalAccount(args: {
  db: admin.firestore.Firestore;
  tenantId: string;
  nationalAccountId: string;
}): Promise<SyncHiringEntityResult> {
  const { db, tenantId, nationalAccountId } = args;

  // ── Load + validate the National ──────────────────────────────────
  const parentRef = db.doc(`tenants/${tenantId}/accounts/${nationalAccountId}`);
  const parentSnap = await parentRef.get();
  if (!parentSnap.exists) {
    throw new HttpsError('not-found', 'National account not found');
  }
  const parent = parentSnap.data() ?? {};
  if (parent.accountType !== 'national') {
    throw new HttpsError(
      'failed-precondition',
      'Account must be a National Account',
    );
  }
  const nationalHiringEntityId =
    typeof parent.hiringEntityId === 'string' ? parent.hiringEntityId.trim() : '';
  if (!nationalHiringEntityId) {
    throw new HttpsError(
      'failed-precondition',
      'National account has no hiring entity set — set one before syncing',
    );
  }

  const summary: SyncHiringEntityResult['summary'] = {
    nationalHiringEntityId,
    childAccountsScanned: 0,
    childAccountsUpdated: 0,
    childAccountsSkipped: 0,
    childAccountsFailed: 0,
    jobOrdersScanned: 0,
    jobOrdersUpdated: 0,
    jobOrdersSkipped: 0,
    jobOrdersFailed: 0,
  };

  const audit: SyncHiringEntityAuditEntry[] = [];
  const pushAudit = (entry: SyncHiringEntityAuditEntry): void => {
    audit.push(entry);
    if (audit.length > MAX_AUDIT_ENTRIES) audit.shift();
  };

  const stamp = (): Record<string, unknown> => ({
    hiringEntityId: nationalHiringEntityId,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: SYSTEM_ACTOR,
    hiringEntityIdSyncedFrom: nationalAccountId,
    hiringEntityIdSyncedAt: FieldValue.serverTimestamp(),
  });

  // ── Pass 1: child accounts ────────────────────────────────────────
  const childrenSnap = await db
    .collection(`tenants/${tenantId}/accounts`)
    .where('parentAccountId', '==', nationalAccountId)
    .where('accountType', '==', 'child')
    .get();

  const childIds: string[] = [];

  for (const childDoc of childrenSnap.docs) {
    summary.childAccountsScanned += 1;
    const child = childDoc.data() ?? {};
    childIds.push(childDoc.id);
    const childName =
      typeof child.name === 'string' && child.name.trim()
        ? child.name.trim()
        : childDoc.id;

    try {
      const decision = decideHiringEntitySyncForDoc({
        currentValue: child.hiringEntityId,
        nationalHiringEntityId,
      });
      if (decision.kind === 'update') {
        await childDoc.ref.update(stamp());
        summary.childAccountsUpdated += 1;
        pushAudit({
          kind: 'child_account',
          docId: childDoc.id,
          displayName: childName,
          action: 'updated',
          previousHiringEntityId: decision.previous,
        });
      } else {
        summary.childAccountsSkipped += 1;
        pushAudit({
          kind: 'child_account',
          docId: childDoc.id,
          displayName: childName,
          action:
            decision.kind === 'skip_same_value'
              ? 'skipped_same_value'
              : 'skipped_existing',
          previousHiringEntityId: decision.previous,
          reason:
            decision.kind === 'skip_same_value'
              ? 'already_matches_national'
              : 'has_custom_value',
        });
      }
    } catch (err) {
      summary.childAccountsFailed += 1;
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn('syncHiringEntity: child_failed', {
        tenantId,
        nationalAccountId,
        childAccountId: childDoc.id,
        error: reason,
      });
      pushAudit({
        kind: 'child_account',
        docId: childDoc.id,
        displayName: childName,
        action: 'failed',
        previousHiringEntityId: null,
        reason,
      });
    }
  }

  // ── Pass 2: job orders ────────────────────────────────────────────
  // Iterate per-account because Firestore `in` queries cap at 10 ids
  // and we don't have collectionGroup indexing here. Per-child query
  // is bounded at ≤ 50 children per national in practice, plus one
  // for direct-under-national. JO doc shape uses `recruiterAccountId`
  // as the owning account id (for both Child Accounts and direct
  // National-owned JOs).
  const accountIdsForJoQuery = [...childIds, nationalAccountId];

  for (const ownerId of accountIdsForJoQuery) {
    const jobOrdersSnap = await db
      .collection(`tenants/${tenantId}/job_orders`)
      .where('recruiterAccountId', '==', ownerId)
      .get();

    for (const joDoc of jobOrdersSnap.docs) {
      summary.jobOrdersScanned += 1;
      const jo = joDoc.data() ?? {};
      const joName =
        typeof jo.jobOrderName === 'string' && jo.jobOrderName.trim()
          ? jo.jobOrderName.trim()
          : typeof jo.jobOrderNumber === 'string'
            ? `JO #${jo.jobOrderNumber}`
            : joDoc.id;

      try {
        const decision = decideHiringEntitySyncForDoc({
          currentValue: jo.hiringEntityId,
          nationalHiringEntityId,
        });
        if (decision.kind === 'update') {
          await joDoc.ref.update(stamp());
          summary.jobOrdersUpdated += 1;
          pushAudit({
            kind: 'job_order',
            docId: joDoc.id,
            displayName: joName,
            action: 'updated',
            previousHiringEntityId: decision.previous,
          });
        } else {
          summary.jobOrdersSkipped += 1;
          pushAudit({
            kind: 'job_order',
            docId: joDoc.id,
            displayName: joName,
            action:
              decision.kind === 'skip_same_value'
                ? 'skipped_same_value'
                : 'skipped_existing',
            previousHiringEntityId: decision.previous,
            reason:
              decision.kind === 'skip_same_value'
                ? 'already_matches_national'
                : 'has_custom_value',
          });
        }
      } catch (err) {
        summary.jobOrdersFailed += 1;
        const reason = err instanceof Error ? err.message : String(err);
        logger.warn('syncHiringEntity: job_order_failed', {
          tenantId,
          nationalAccountId,
          jobOrderId: joDoc.id,
          error: reason,
        });
        pushAudit({
          kind: 'job_order',
          docId: joDoc.id,
          displayName: joName,
          action: 'failed',
          previousHiringEntityId: null,
          reason,
        });
      }
    }
  }

  return { summary, audit };
}

// ─────────────────────────────────────────────────────────────────────
// Callable entry point
// ─────────────────────────────────────────────────────────────────────

export const syncHiringEntityFromNationalAccount = onCall(
  {
    region: 'us-central1',
    memory: '512MiB',
    // 540s ceiling — same as the §14b backfill. Iterating per-child JO
    // queries can take a while on a large national; this leaves headroom.
    timeoutSeconds: 540,
  },
  async (request) => {
    const data = (request.data || {}) as {
      tenantId?: string;
      nationalAccountId?: string;
    };
    const tenantId = data.tenantId?.trim() || '';
    const nationalAccountId = data.nationalAccountId?.trim() || '';
    if (!tenantId || !nationalAccountId) {
      throw new HttpsError(
        'invalid-argument',
        'tenantId and nationalAccountId are required',
      );
    }
    assertTenantStaff(request.auth as AuthContext | undefined, tenantId);

    const db = admin.firestore();
    const result = await runSyncHiringEntityFromNationalAccount({
      db,
      tenantId,
      nationalAccountId,
    });

    logger.info('syncHiringEntity: done', {
      tenantId,
      nationalAccountId,
      uid: request.auth?.uid,
      ...result.summary,
    });

    return result;
  },
);

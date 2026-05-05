/**
 * **AG.1 backfill — attach existing auto-groups to JOs that are missing them.**
 *
 * Companion to `onJobOrderCreatedAttachAutoUserGroup` (the going-forward AG.1
 * trigger). This callable is the recovery path for tenants that:
 *
 *   - Had JOs created **before** the AG.0 / AG.1 features shipped.
 *   - Had a transient AG.1 trigger failure (Firestore hiccup, downstream
 *     timeout) that left some JOs without `autoCreatedUserGroupId` even though
 *     an auto-group exists for the child.
 *   - Had a National Account that flipped on `autoCreateUserGroups` after
 *     children + JOs were already in place — combine this with running
 *     `backfillGigJobOrdersForNationalAccount` first (which creates the missing
 *     groups), then this callable to wire them onto every JO.
 *
 * **Idempotent:** running twice attaches nothing the second pass — the AG.1
 * skip rule (`autoCreatedUserGroupId` already set) covers it. Recruiters can
 * re-run safely after edits.
 *
 * **Scope cases:**
 *
 *   - `nationalAccountId` set → walks children of that National only (fast).
 *   - `nationalAccountId` empty → walks every JO in the tenant. Slower but
 *     covers stand-alone children and orphaned JOs. The 540s callable timeout
 *     is the practical ceiling (~thousands of JOs OK; tens of thousands push
 *     toward needing pagination — defer that until it bites).
 *
 * **Permissioning** mirrors `backfillGigJobOrdersForNationalAccount`: HRX
 * staff OR a Recruiter / Manager / Admin scoped to this tenant.
 *
 * Output `summary` counters and a per-JO `audit` list (clamped at 500 entries
 * to keep the callable response under the Cloud Functions 10MB limit).
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { lookupAutoUserGroupsForChild } from '../userGroups/ensureAutoUserGroup';

if (!admin.apps.length) {
  admin.initializeApp();
}

const SYSTEM_ACTOR = 'system_auto_user_group';
const MAX_AUDIT_ENTRIES = 500;

// ─────────────────────────────────────────────────────────────────────
// Permission helper — duplicated rather than imported because the
// existing AG.0 backfill already has its own copy and the function is
// trivial. Keeping local prevents accidental coupling.
// ─────────────────────────────────────────────────────────────────────

interface AuthContext {
  uid: string;
  token: Record<string, unknown>;
}

function assertTenantStaff(auth: AuthContext | undefined, tenantId: string): void {
  if (!auth) throw new HttpsError('unauthenticated', 'Authentication required');
  if (auth.token.hrx === true) return;
  const roles = auth.token.roles as Record<string, { role?: string }> | undefined;
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

export type BackfillAutoUserGroupAuditAction =
  | 'attached'
  | 'skipped_already_set'
  | 'skipped_no_recruiter_account_id'
  | 'skipped_no_auto_group'
  | 'failed';

export interface BackfillAutoUserGroupAuditEntry {
  jobOrderId: string;
  jobOrderNumber?: string;
  recruiterAccountId?: string;
  action: BackfillAutoUserGroupAuditAction;
  attachedGroupId?: string;
  reason?: string;
}

export interface BackfillAutoUserGroupAttachmentsResult {
  summary: {
    scanned: number;
    attached: number;
    alreadyAttached: number;
    noRecruiterAccount: number;
    noGroupForChild: number;
    failed: number;
  };
  /** Per-JO outcomes. Clamped at 500 — older entries dropped first. */
  audit: BackfillAutoUserGroupAuditEntry[];
}

// ─────────────────────────────────────────────────────────────────────
// Core logic — split out so tests can inject a fake Firestore.
// ─────────────────────────────────────────────────────────────────────

export async function runBackfillAutoUserGroupAttachments(args: {
  db: admin.firestore.Firestore;
  tenantId: string;
  /** When set, scope the scan to JOs whose `recruiterAccountId` is a child of this National. */
  nationalAccountId?: string | null;
}): Promise<BackfillAutoUserGroupAttachmentsResult> {
  const { db, tenantId } = args;
  const nationalAccountId = (args.nationalAccountId || '').trim() || null;

  // Build the child-id filter set when scoping by National. Empty filter set =
  // fall back to "scan every JO in tenant" (no `where('recruiterAccountId', 'in', ...)`).
  let childAccountIdFilter: Set<string> | null = null;
  if (nationalAccountId) {
    const parentSnap = await db.doc(`tenants/${tenantId}/accounts/${nationalAccountId}`).get();
    if (!parentSnap.exists) {
      throw new HttpsError('not-found', 'National account not found');
    }
    if (parentSnap.data()?.accountType !== 'national') {
      throw new HttpsError('failed-precondition', 'Account must be a National Account');
    }
    const childrenSnap = await db
      .collection(`tenants/${tenantId}/accounts`)
      .where('parentAccountId', '==', nationalAccountId)
      .get();
    childAccountIdFilter = new Set(childrenSnap.docs.map((d) => d.id));
    if (childAccountIdFilter.size === 0) {
      // National has no children yet — backfill is a no-op.
      return {
        summary: {
          scanned: 0,
          attached: 0,
          alreadyAttached: 0,
          noRecruiterAccount: 0,
          noGroupForChild: 0,
          failed: 0,
        },
        audit: [],
      };
    }
  }

  // Pull every JO in the tenant. We don't `where()` on `autoCreatedUserGroupId`
  // because Firestore can't query "field is null/missing"; the in-loop skip is
  // simpler than a sentinel-value migration. The `where('recruiterAccountId', 'in', ...)`
  // approach has a 30-element cap, so when scoping by national we filter
  // in-process instead — fine since `childrenSnap.size` is typically small enough
  // that the extra reads don't hurt.
  const jobOrdersSnap = await db.collection(`tenants/${tenantId}/job_orders`).get();

  const result: BackfillAutoUserGroupAttachmentsResult = {
    summary: {
      scanned: 0,
      attached: 0,
      alreadyAttached: 0,
      noRecruiterAccount: 0,
      noGroupForChild: 0,
      failed: 0,
    },
    audit: [],
  };

  const pushAudit = (entry: BackfillAutoUserGroupAuditEntry): void => {
    result.audit.push(entry);
    if (result.audit.length > MAX_AUDIT_ENTRIES) result.audit.shift();
  };

  // Cache child → group ids per pass so a tenant with 50 JOs all under one child
  // does one Firestore lookup, not 50.
  const childGroupCache = new Map<string, string[]>();

  for (const jobOrderDoc of jobOrdersSnap.docs) {
    const jobOrderId = jobOrderDoc.id;
    const data = jobOrderDoc.data() as Record<string, unknown>;
    const recruiterAccountId =
      typeof data.recruiterAccountId === 'string' ? data.recruiterAccountId.trim() : '';

    // National scoping filter — applied first so we don't even count JOs
    // outside the requested scope toward `scanned`.
    if (childAccountIdFilter && (!recruiterAccountId || !childAccountIdFilter.has(recruiterAccountId))) {
      continue;
    }

    result.summary.scanned += 1;
    const jobOrderNumber =
      typeof data.jobOrderNumber === 'string' ? data.jobOrderNumber : undefined;

    const alreadyAttached =
      typeof data.autoCreatedUserGroupId === 'string' &&
      data.autoCreatedUserGroupId.trim() !== '';
    if (alreadyAttached) {
      result.summary.alreadyAttached += 1;
      pushAudit({
        jobOrderId,
        jobOrderNumber,
        recruiterAccountId: recruiterAccountId || undefined,
        action: 'skipped_already_set',
        attachedGroupId: data.autoCreatedUserGroupId as string,
      });
      continue;
    }

    if (!recruiterAccountId) {
      result.summary.noRecruiterAccount += 1;
      pushAudit({
        jobOrderId,
        jobOrderNumber,
        action: 'skipped_no_recruiter_account_id',
      });
      continue;
    }

    let groupIds = childGroupCache.get(recruiterAccountId);
    if (!groupIds) {
      try {
        groupIds = await lookupAutoUserGroupsForChild({
          db,
          tenantId,
          childAccountId: recruiterAccountId,
        });
        childGroupCache.set(recruiterAccountId, groupIds);
      } catch (err) {
        result.summary.failed += 1;
        const reason = err instanceof Error ? err.message : String(err);
        logger.warn('backfillAutoUserGroupAttachments: lookup_failed', {
          tenantId,
          jobOrderId,
          recruiterAccountId,
          error: reason,
        });
        pushAudit({
          jobOrderId,
          jobOrderNumber,
          recruiterAccountId,
          action: 'failed',
          reason: `lookup_failed: ${reason}`,
        });
        continue;
      }
    }

    if (groupIds.length === 0) {
      result.summary.noGroupForChild += 1;
      pushAudit({
        jobOrderId,
        jobOrderNumber,
        recruiterAccountId,
        action: 'skipped_no_auto_group',
        reason: 'no_auto_group_exists_for_child',
      });
      continue;
    }

    const primaryGroupId = groupIds[0];
    try {
      await jobOrderDoc.ref.update({
        autoCreatedUserGroupId: primaryGroupId,
        autoMessagingUserGroupIds: admin.firestore.FieldValue.arrayUnion(...groupIds),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: SYSTEM_ACTOR,
      });
      result.summary.attached += 1;
      pushAudit({
        jobOrderId,
        jobOrderNumber,
        recruiterAccountId,
        action: 'attached',
        attachedGroupId: primaryGroupId,
      });
    } catch (err) {
      result.summary.failed += 1;
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn('backfillAutoUserGroupAttachments: update_failed', {
        tenantId,
        jobOrderId,
        recruiterAccountId,
        error: reason,
      });
      pushAudit({
        jobOrderId,
        jobOrderNumber,
        recruiterAccountId,
        action: 'failed',
        reason: `update_failed: ${reason}`,
      });
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────
// Callable entry point
// ─────────────────────────────────────────────────────────────────────

export const backfillAutoUserGroupAttachments = onCall(
  {
    region: 'us-central1',
    memory: '512MiB',
    // Same 540s ceiling as `backfillGigJobOrdersForNationalAccount` — a tenant
    // with thousands of JOs spread across many children will still complete in
    // one call thanks to the per-child group lookup cache. Tenants beyond ~10k
    // JOs may need pagination; defer until requested.
    timeoutSeconds: 540,
  },
  async (request) => {
    const data = (request.data || {}) as {
      tenantId?: string;
      nationalAccountId?: string | null;
    };
    const tenantId = (data.tenantId || '').trim();
    const nationalAccountId = (data.nationalAccountId || '').trim() || null;
    if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required');
    }
    assertTenantStaff(request.auth as AuthContext | undefined, tenantId);

    const db = admin.firestore();
    const result = await runBackfillAutoUserGroupAttachments({
      db,
      tenantId,
      nationalAccountId,
    });

    logger.info('backfillAutoUserGroupAttachments: done', {
      tenantId,
      nationalAccountId,
      uid: request.auth?.uid,
      ...result.summary,
    });

    return result;
  },
);

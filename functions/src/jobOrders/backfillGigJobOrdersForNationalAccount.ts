/**
 * **§14b — Backfill gig job orders for a national account.**
 *
 * One-shot callable that scans every child account under the given
 * National Account and creates a draft Gig JO for any that don't have
 * one yet. Companion to the `onChildAccountCreatedAutoCreateGigJobOrder`
 * trigger — same shared helper, same field mapping — so a recruiter
 * can't tell the difference between a JO spawned today by automation
 * and a JO spawned by yesterday's backfill click.
 *
 * **Idempotent:** running twice doesn't double-create. The second run
 * sees the previously-spawned auto-JOs (matched on
 * `recruiterAccountId + autoCreatedFrom === 'autoCreateGigJobOrders'`)
 * and counts them as `alreadyHad`.
 *
 * **Manual children included.** Unlike the trigger, the backfill does
 * NOT skip children that lack `autoCreatedFromCompanyLocation: true`.
 * Greg's spec is "scan ALL child accounts under this national" —
 * backfilling is the recovery path for an org where the toggle was
 * flipped late, and we'd betray that intent by skipping legitimate
 * manually-created children. (The trigger does skip them — that's the
 * right call for going-forward auto-create where the recruiter is
 * already in a JO flow.)
 *
 * Inputs (callable data):
 *   - tenantId: string             (required)
 *   - nationalAccountId: string    (required, must be `accountType === 'national'`)
 *
 * Output:
 *   - summary: { created, alreadyHad, skipped, totalChildAccounts }
 *   - audit:   per-child outcome list (clamped at 500 entries to keep the
 *             callable response under the Cloud Functions 10MB limit)
 *
 * Permissioning matches `backfillNationalAccountChildAccountsCallable`:
 *   HRX staff OR a Recruiter/Manager/Admin scoped to this tenant.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import {
  type AccountDoc,
  createGigJobOrderForChildAccount,
} from './gigJobOrderFromChildAccount';

if (!admin.apps.length) {
  admin.initializeApp();
}

// ─────────────────────────────────────────────────────────────────────
// Permission helper — mirrors the existing
// `backfillNationalAccountChildAccountsCallable` shape so recruiters
// don't need a different role to run the gig backfill.
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

export interface BackfillGigJobOrdersAuditEntry {
  childAccountId: string;
  childAccountName: string;
  action: 'created' | 'skipped_existing' | 'failed';
  jobOrderId?: string;
  jobOrderNumber?: string;
  reason?: string;
}

export interface BackfillGigJobOrdersResult {
  summary: {
    created: number;
    alreadyHad: number;
    skipped: number;
    totalChildAccounts: number;
  };
  /** Per-child outcomes. Clamped at 500 — older entries dropped first. */
  audit: BackfillGigJobOrdersAuditEntry[];
}

const MAX_AUDIT_ENTRIES = 500;

// ─────────────────────────────────────────────────────────────────────
// Core logic — split out from the callable entry point so tests can
// invoke it with an injected fake Firestore.
// ─────────────────────────────────────────────────────────────────────

export async function runBackfillGigJobOrdersForNationalAccount(args: {
  db: admin.firestore.Firestore;
  tenantId: string;
  nationalAccountId: string;
  /** Test seam — overrides the per-child orchestrator. */
  createForChild?: typeof createGigJobOrderForChildAccount;
}): Promise<BackfillGigJobOrdersResult> {
  const { db, tenantId, nationalAccountId } = args;
  const createForChild = args.createForChild ?? createGigJobOrderForChildAccount;

  const parentRef = db.doc(`tenants/${tenantId}/accounts/${nationalAccountId}`);
  const parentSnap = await parentRef.get();
  if (!parentSnap.exists) {
    throw new HttpsError('not-found', 'National account not found');
  }
  const parent = parentSnap.data() as AccountDoc;
  if (parent.accountType !== 'national') {
    throw new HttpsError(
      'failed-precondition',
      'Account must be a National Account',
    );
  }

  const childrenSnap = await db
    .collection(`tenants/${tenantId}/accounts`)
    .where('parentAccountId', '==', nationalAccountId)
    .where('accountType', '==', 'child')
    .get();

  let created = 0;
  let alreadyHad = 0;
  let skipped = 0;
  const audit: BackfillGigJobOrdersAuditEntry[] = [];
  const pushAudit = (entry: BackfillGigJobOrdersAuditEntry): void => {
    audit.push(entry);
    if (audit.length > MAX_AUDIT_ENTRIES) audit.shift();
  };

  for (const childDoc of childrenSnap.docs) {
    const child = childDoc.data() as AccountDoc;
    const childName =
      typeof child.name === 'string' && child.name.trim()
        ? child.name.trim()
        : childDoc.id;

    try {
      // The shared orchestrator does its own idempotency check
      // (existing JO with `autoCreatedFrom` marker → returns null).
      // Backfill counts those as `alreadyHad`.
      const result = await createForChild({
        tenantId,
        childAccountId: childDoc.id,
        childAccount: child,
        parentAccount: parent,
        source: 'backfill',
        db,
      });

      if (result === null) {
        alreadyHad += 1;
        pushAudit({
          childAccountId: childDoc.id,
          childAccountName: childName,
          action: 'skipped_existing',
          reason: 'auto_jo_already_present',
        });
        continue;
      }

      created += 1;
      pushAudit({
        childAccountId: childDoc.id,
        childAccountName: childName,
        action: 'created',
        jobOrderId: result.jobOrderId,
        jobOrderNumber: result.jobOrderNumber,
      });
    } catch (err) {
      skipped += 1;
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn('backfillGigJobOrders: child_failed', {
        tenantId,
        nationalAccountId,
        childAccountId: childDoc.id,
        error: reason,
      });
      pushAudit({
        childAccountId: childDoc.id,
        childAccountName: childName,
        action: 'failed',
        reason,
      });
    }
  }

  return {
    summary: {
      created,
      alreadyHad,
      skipped,
      totalChildAccounts: childrenSnap.size,
    },
    audit,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Callable entry point
// ─────────────────────────────────────────────────────────────────────

export const backfillGigJobOrdersForNationalAccount = onCall(
  {
    region: 'us-central1',
    memory: '512MiB',
    // 540s ceiling — backfill might walk 100+ children with cascade reads
    // each. We've seen the auto-create trigger run ~1.5s end-to-end per
    // child; 540s leaves headroom for ~300 children without timing out.
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
    assertTenantStaff(
      request.auth as AuthContext | undefined,
      tenantId,
    );

    const db = admin.firestore();
    const result = await runBackfillGigJobOrdersForNationalAccount({
      db,
      tenantId,
      nationalAccountId,
    });

    logger.info('backfillGigJobOrders: done', {
      tenantId,
      nationalAccountId,
      created: result.summary.created,
      alreadyHad: result.summary.alreadyHad,
      skipped: result.summary.skipped,
      totalChildAccounts: result.summary.totalChildAccounts,
      uid: request.auth?.uid,
    });

    return result;
  },
);

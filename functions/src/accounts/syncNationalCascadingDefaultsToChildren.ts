/**
 * One-shot callable: copy national account cascading defaults onto child
 * accounts using fill-empty semantics only (never overwrites existing child
 * values). Child documents only — does not push to job orders.
 *
 * Auth: same as Push-to-Active (security level 7 on the tenant).
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { gateTenantStaffMinLevel } from '../jobOrders/pushToActive';
import { buildChildCascadePatch } from './nationalChildCascadeMerge';

if (!admin.apps.length) {
  admin.initializeApp();
}

const FieldValue = admin.firestore.FieldValue;

const SYSTEM_ACTOR = 'system_sync_national_cascade';
const MAX_AUDIT = 500;

export interface SyncNationalCascadeAuditEntry {
  childAccountId: string;
  displayName: string;
  action: 'updated' | 'skipped_unchanged' | 'failed';
  reason?: string;
}

export interface SyncNationalCascadingDefaultsResult {
  summary: {
    nationalAccountId: string;
    childAccountsScanned: number;
    childAccountsUpdated: number;
    childAccountsSkippedUnchanged: number;
    childAccountsFailed: number;
  };
  audit: SyncNationalCascadeAuditEntry[];
}

export async function runSyncNationalCascadingDefaultsToChildren(args: {
  db: admin.firestore.Firestore;
  tenantId: string;
  nationalAccountId: string;
}): Promise<SyncNationalCascadingDefaultsResult> {
  const { db, tenantId, nationalAccountId } = args;

  const parentRef = db.doc(`tenants/${tenantId}/accounts/${nationalAccountId}`);
  const parentSnap = await parentRef.get();
  if (!parentSnap.exists) {
    throw new HttpsError('not-found', 'National account not found');
  }
  const parent = parentSnap.data() ?? {};
  if (parent.accountType !== 'national') {
    throw new HttpsError(
      'failed-precondition',
      'Account must be a national account',
    );
  }

  const summary: SyncNationalCascadingDefaultsResult['summary'] = {
    nationalAccountId,
    childAccountsScanned: 0,
    childAccountsUpdated: 0,
    childAccountsSkippedUnchanged: 0,
    childAccountsFailed: 0,
  };

  const audit: SyncNationalCascadeAuditEntry[] = [];
  const pushAudit = (entry: SyncNationalCascadeAuditEntry): void => {
    audit.push(entry);
    if (audit.length > MAX_AUDIT) audit.shift();
  };

  /**
   * Include legacy auto-created children that pre-date the `accountType: 'child'`
   * stamp (`autoChildAccountFromCompanyLocation.ts:251`). Matching on
   * `parentAccountId` alone is safe — the national parent itself can never
   * appear here because its own `parentAccountId` is unset.
   */
  const childrenSnap = await db
    .collection(`tenants/${tenantId}/accounts`)
    .where('parentAccountId', '==', nationalAccountId)
    .get();

  for (const childDoc of childrenSnap.docs) {
    const child = childDoc.data() ?? {};
    if (child.accountType === 'national') continue;

    summary.childAccountsScanned += 1;
    const childName =
      typeof child.name === 'string' && child.name.trim()
        ? child.name.trim()
        : childDoc.id;

    try {
      const patch = buildChildCascadePatch({ child, parent });
      if (!patch) {
        summary.childAccountsSkippedUnchanged += 1;
        pushAudit({
          childAccountId: childDoc.id,
          displayName: childName,
          action: 'skipped_unchanged',
        });
        continue;
      }

      await childDoc.ref.update({
        ...patch,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: SYSTEM_ACTOR,
        cascadingFilledFromNationalAt: FieldValue.serverTimestamp(),
        cascadingFilledFromNationalId: nationalAccountId,
      });
      summary.childAccountsUpdated += 1;
      pushAudit({
        childAccountId: childDoc.id,
        displayName: childName,
        action: 'updated',
      });
    } catch (err) {
      summary.childAccountsFailed += 1;
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn('syncNationalCascadingDefaults: child_failed', {
        tenantId,
        nationalAccountId,
        childAccountId: childDoc.id,
        error: reason,
      });
      pushAudit({
        childAccountId: childDoc.id,
        displayName: childName,
        action: 'failed',
        reason,
      });
    }
  }

  return { summary, audit };
}

export const syncNationalCascadingDefaultsToChildrenCallable = onCall(
  {
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 300,
    cors: true,
    invoker: 'public',
  },
  async (request): Promise<SyncNationalCascadingDefaultsResult> => {
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
    await gateTenantStaffMinLevel(
      request,
      tenantId,
      5,
      'Insufficient permissions. National → child cascade sync requires security level 5+ on the requested tenant.',
    );

    const db = admin.firestore();
    const result = await runSyncNationalCascadingDefaultsToChildren({
      db,
      tenantId,
      nationalAccountId,
    });

    logger.info('syncNationalCascadingDefaults: done', {
      tenantId,
      nationalAccountId,
      uid: request.auth?.uid,
      ...result.summary,
    });

    return result;
  },
);

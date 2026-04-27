/**
 * Workforce denormalization trigger — when an account's `hiringEntityId`
 * changes, rewrite `engagementType` on every `account_workforce` doc for
 * that account.
 *
 * Phase 2 of `docs/WORKFORCE_DOMAIN_MODEL.md`. The engagementType field
 * on AccountWorkforce is a cache of `account.hiringEntityId →
 * entity.engagementType` (§3.1, §10). It's cheap when the entity stays
 * fixed; this trigger is what keeps it honest when an account gets moved
 * between C1 Events (1099) and C1 Select / C1 Workforce (W2).
 *
 * Rare event (clients don't typically swap employer-of-record), so the
 * cost of the scan is acceptable. If an account has thousands of
 * AccountWorkforce docs we still batch in groups of 400.
 *
 * @see docs/WORKFORCE_DOMAIN_MODEL.md §3.1, §6 (triggers), §10
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

import type { AccountWorkforceEngagementType } from '../shared/accountWorkforce';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

function readHiringEntityId(data: Record<string, unknown> | null | undefined): string | null {
  if (!data) return null;
  const raw = data.hiringEntityId;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

async function resolveEntityEngagementType(
  tenantId: string,
  entityId: string,
): Promise<AccountWorkforceEngagementType | null> {
  try {
    const snap = await db.doc(`tenants/${tenantId}/entities/${entityId}`).get();
    if (!snap.exists) return null;
    const data = snap.data() as Record<string, unknown>;
    const raw = String(data?.engagementType || '').toLowerCase().trim();
    if (raw === 'w2') return 'w2';
    if (raw === '1099') return '1099';
    return null;
  } catch (err) {
    logger.warn('workforce-engagement-trigger: entity lookup failed', {
      tenantId,
      entityId,
      error: (err as Error).message,
    });
    return null;
  }
}

export const onAccountHiringEntityChangeBackfillWorkforceEngagementType = onDocumentWritten(
  {
    document: 'tenants/{tenantId}/accounts/{accountId}',
    region: 'us-central1',
    maxInstances: 2,
    retry: false,
  },
  async (event) => {
    const tenantId = String(event.params.tenantId);
    const accountId = String(event.params.accountId);

    const beforeData = event.data?.before?.exists
      ? ((event.data.before.data() ?? {}) as Record<string, unknown>)
      : null;
    const afterData = event.data?.after?.exists
      ? ((event.data.after.data() ?? {}) as Record<string, unknown>)
      : null;

    // Account deleted — don't touch AccountWorkforce. Those docs stay as
    // historical records; the recruiter can clean them up if needed.
    if (!afterData) return;

    const beforeEntityId = readHiringEntityId(beforeData);
    const afterEntityId = readHiringEntityId(afterData);

    // Only fire when hiringEntityId actually changed. Saves every unrelated
    // account edit (name, address, etc.) from triggering a scan.
    if (beforeEntityId === afterEntityId) return;

    // Resolve new engagementType. If it's unresolvable (entity missing /
    // malformed), we CLEAR the field rather than leaving the stale value in
    // place. Better a missing cache than a wrong one.
    const nextEngagementType = afterEntityId
      ? await resolveEntityEngagementType(tenantId, afterEntityId)
      : null;

    const workforceCol = db.collection(`tenants/${tenantId}/account_workforce`);
    const snap = await workforceCol.where('accountId', '==', accountId).get();
    if (snap.empty) {
      logger.info('workforce-engagement-trigger: no AccountWorkforce docs to update', {
        tenantId,
        accountId,
        beforeEntityId,
        afterEntityId,
      });
      return;
    }

    const now = admin.firestore.Timestamp.now();
    const CHUNK = 400;
    let written = 0;
    for (let i = 0; i < snap.docs.length; i += CHUNK) {
      const batch = db.batch();
      const slice = snap.docs.slice(i, i + CHUNK);
      for (const d of slice) {
        const patch: Record<string, unknown> = { updatedAt: now };
        if (nextEngagementType) {
          patch.engagementType = nextEngagementType;
        } else {
          patch.engagementType = admin.firestore.FieldValue.delete();
        }
        batch.set(d.ref, patch, { merge: true });
      }
      await batch.commit();
      written += slice.length;
    }
    logger.info('workforce-engagement-trigger: rewrote engagementType', {
      tenantId,
      accountId,
      beforeEntityId,
      afterEntityId,
      nextEngagementType,
      docsUpdated: written,
    });
  },
);

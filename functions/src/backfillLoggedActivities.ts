import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Backfill/normalize tasks created via Log Activity so Contact Activity queries match.
 * - Targets tenants/{tenantId}/tasks with tags array-contains 'logged-activity'
 * - Optional startDate to scope recent docs (default: 30 days)
 * - Normalizes associations.* arrays to be arrays of string IDs (not objects)
 */
export const backfillLoggedActivities = onCall({ timeoutSeconds: 300, memory: '512MiB' }, async (request) => {
  try {
    const { tenantId, startDate, limit = 1000 } = request.data || {};
    if (!tenantId || typeof tenantId !== 'string') {
      throw new HttpsError('invalid-argument', 'tenantId is required');
    }

    const cutoff = startDate
      ? new Date(startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const tasksRef = db.collection('tenants').doc(tenantId).collection('tasks');

    // Query only by tag to avoid composite index requirements; filter by date client-side
    const snapshot = await tasksRef
      .where('tags', 'array-contains', 'logged-activity')
      .limit(Math.min(Number(limit) || 1000, 3000))
      .get();

    let scanned = 0;
    let updated = 0;
    let skipped = 0;

    const toIds = (arr: any): string[] => {
      if (!Array.isArray(arr)) return [];
      return arr
        .map((v) => (typeof v === 'string' ? v : v?.id))
        .filter((v) => typeof v === 'string' && v.trim().length > 0);
    };

    const batches: FirebaseFirestore.WriteBatch[] = [];
    let batch = db.batch();
    let opsInBatch = 0;

    for (const docSnap of snapshot.docs) {
      scanned++;
      const data = docSnap.data() as any;

      // Optional: skip if older than cutoff
      try {
        const createdAt = data?.createdAt?.toDate?.() || (data?.createdAt ? new Date(data.createdAt) : null);
        if (createdAt && createdAt < cutoff) {
          skipped++;
          continue;
        }
      } catch {}
      const associations = data?.associations || {};

      const normalized = {
        companies: toIds(associations.companies),
        contacts: toIds(associations.contacts),
        deals: toIds(associations.deals),
        salespeople: toIds(associations.salespeople)
      };

      const needsUpdate =
        JSON.stringify(associations?.companies || []) !== JSON.stringify(normalized.companies) ||
        JSON.stringify(associations?.contacts || []) !== JSON.stringify(normalized.contacts) ||
        JSON.stringify(associations?.deals || []) !== JSON.stringify(normalized.deals) ||
        JSON.stringify(associations?.salespeople || []) !== JSON.stringify(normalized.salespeople);

      if (!needsUpdate) {
        skipped++;
        continue;
      }

      batch.update(docSnap.ref, {
        associations: normalized,
        _normalizedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      updated++;
      opsInBatch++;

      if (opsInBatch >= 400) {
        batches.push(batch);
        batch = db.batch();
        opsInBatch = 0;
      }
    }

    if (opsInBatch > 0) batches.push(batch);

    for (const b of batches) {
      await b.commit();
    }

    return { success: true, tenantId, scanned, updated, skipped };
  } catch (error: any) {
    console.error('backfillLoggedActivities failed:', error);
    throw new HttpsError('internal', error?.message || 'Unknown error');
  }
});



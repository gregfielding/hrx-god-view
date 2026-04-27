/**
 * Phase C — when `users/{uid}.licenses` changes, refresh `license_match`
 * (and the rest of the Phase B match items, opportunistically) on every
 * active assignment this worker has, across every tenant they belong to.
 *
 * Closes part of matrix §6 hole #7 — "AssignmentReadiness snapshot is built
 * once and never refreshed". This trigger handles the worker-records-change
 * path; Phase C.2 handles the time-passes path (daily reconciler).
 *
 * **Short-circuit:** fires on every `users/{uid}` write, so the first thing
 * we do is compare `before.licenses` vs `after.licenses`. Most user-doc
 * writes don't touch licenses (avatar updates, phone changes, etc.) and
 * exit immediately.
 *
 * **Multi-tenant fan-out:** uses the same `entity_employments` collection-
 * group pattern as `onUserFieldChangeUpdateReadiness` to find every tenant
 * the worker is associated with. Per tenant, calls
 * `recomputeMatchItemsForWorker` which re-runs ALL 5 wired matchers (not
 * just licenses) — the cost is dominated by the per-assignment Firestore
 * round-trips, not the matcher math.
 *
 * @see assignmentMatchRefreshHelpers.ts
 * @see docs/READINESS_EXECUTION_MATRIX.md §7 Phase C
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

import { recomputeMatchItemsForWorker } from './assignmentMatchRefreshHelpers';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

export const onUserLicensesChangeRefreshAssignments = onDocumentWritten(
  {
    document: 'users/{uid}',
    region: 'us-central1',
    maxInstances: 10,
    memory: '512MiB',
    retry: false,
  },
  async (event) => {
    const uid = String(event.params.uid);

    const beforeData = event.data?.before?.exists
      ? ((event.data.before.data() ?? {}) as Record<string, unknown>)
      : null;
    const afterData = event.data?.after?.exists
      ? ((event.data.after.data() ?? {}) as Record<string, unknown>)
      : null;

    if (!afterData) return; // user deleted — refresh isn't meaningful

    if (!licensesFieldChanged(beforeData, afterData)) {
      return;
    }

    const tenantIds = await loadTenantsForWorker(uid);
    if (tenantIds.length === 0) {
      logger.debug('onUserLicensesChangeRefreshAssignments: no tenant employments', { uid });
      return;
    }

    const todayMs = Date.now();
    const todayISO = new Date(todayMs).toISOString().slice(0, 10);

    // Fan out per tenant (in parallel — each call is bounded). Each call is
    // best-effort: log + continue on failure so one tenant's hiccup doesn't
    // block the others.
    const results = await Promise.allSettled(
      tenantIds.map((tenantId) =>
        recomputeMatchItemsForWorker({
          db,
          tenantId,
          workerUid: uid,
          todayISO,
          todayMs,
        }),
      ),
    );

    let totalScanned = 0;
    let totalUpdated = 0;
    let totalUnchanged = 0;
    let totalMissing = 0;
    let failures = 0;

    results.forEach((r, idx) => {
      if (r.status === 'fulfilled') {
        totalScanned += r.value.assignmentsScanned;
        totalUpdated += r.value.itemsUpdated;
        totalUnchanged += r.value.itemsUnchanged;
        totalMissing += r.value.itemsMissingForExpectedSpec;
      } else {
        failures++;
        logger.error('onUserLicensesChangeRefreshAssignments: refresh failed for tenant', {
          uid,
          tenantId: tenantIds[idx],
          err: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    });

    logger.info('onUserLicensesChangeRefreshAssignments: done', {
      uid,
      tenantsScanned: tenantIds.length,
      tenantFailures: failures,
      assignmentsScanned: totalScanned,
      itemsUpdated: totalUpdated,
      itemsUnchanged: totalUnchanged,
      itemsMissingForExpectedSpec: totalMissing,
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * Detect whether the `licenses` field actually changed between before/after.
 * Cheap deep-compare on the JSON-serialized representation. Treats absent
 * + empty-array as the same.
 */
export function licensesFieldChanged(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): boolean {
  const a = normalizeLicensesField(before?.licenses);
  const b = normalizeLicensesField(after?.licenses);
  return JSON.stringify(a) !== JSON.stringify(b);
}

function normalizeLicensesField(v: unknown): unknown {
  if (!Array.isArray(v) || v.length === 0) return [];
  // Sort by licenseClass so reordering doesn't trigger a refresh.
  return [...v]
    .filter((e) => e && typeof e === 'object' && typeof (e as { licenseClass?: unknown }).licenseClass === 'string')
    .sort((x, y) => {
      const xc = String((x as { licenseClass: string }).licenseClass).toLowerCase();
      const yc = String((y as { licenseClass: string }).licenseClass).toLowerCase();
      return xc < yc ? -1 : xc > yc ? 1 : 0;
    });
}

/**
 * Find every tenant this worker has an entity_employments doc under.
 * Mirror of the pattern in onUserFieldChangeUpdateReadiness.ts but returns
 * unique tenant ids only (entity granularity isn't needed for assignment
 * refresh — we query per tenant, not per entity).
 */
async function loadTenantsForWorker(workerUid: string): Promise<string[]> {
  const cg = db.collectionGroup('entity_employments');
  const [byUserId, byCandidateId] = await Promise.all([
    cg.where('userId', '==', workerUid).get(),
    cg.where('candidateId', '==', workerUid).get(),
  ]);

  const tenants = new Set<string>();
  for (const snap of [byUserId, byCandidateId]) {
    for (const doc of snap.docs) {
      const data = doc.data() as Record<string, unknown>;
      const tenantId =
        typeof data.tenantId === 'string' && data.tenantId.trim().length > 0
          ? data.tenantId.trim()
          : doc.ref.path.split('/')[1] ?? '';
      if (tenantId) tenants.add(tenantId);
    }
  }
  return Array.from(tenants);
}

/**
 * Worker dashboard action items V1 — recompute helper.
 *
 * Composes loader + pure model + Firestore write. Idempotent: if the
 * `inputsHash` matches what's already on the user doc, we skip the write.
 *
 * Triggers in `workerDashboardActionItemsTriggers.ts` call this in their
 * fan-out. The recruiter-facing callable also uses it for explicit "force
 * refresh".
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { isC1WorkerScope, C1_TENANT_ID } from './c1WorkerScope';
import {
  loadWorkerDashboardActionItemsContext,
} from './workerDashboardActionItemsLoadContext';
import { buildWorkerDashboardActionItemsSnapshot } from './workerDashboardActionItemsModel';
import type { WorkerDashboardActionItemsSnapshotV1 } from './workerDashboardActionItemsTypes';

export interface RecomputeResult {
  wrote: boolean;
  /** True when the user doc doesn't exist or isn't in C1 worker scope. */
  outOfScope: boolean;
  snapshot: WorkerDashboardActionItemsSnapshotV1 | null;
  diagnostics: {
    inputsHash: string;
    itemCount: number;
    pendingAssignmentCount: number;
    backgroundCheckCount: number;
    everifyCaseCount: number;
    applicationsCount: number;
    interviewsCount: number;
    prescreenSuppressedByFreshness: boolean;
  } | null;
}

/**
 * Resolve the tenant the snapshot should be computed under.
 *
 * Today the worker home is single-tenant (C1). `activeTenantId` (when set)
 * trumps the global default; otherwise we fall back to `tenantId` and
 * finally to `C1_TENANT_ID` to match the dashboard's behaviour.
 *
 * If a worker has multiple tenants in `tenantIds[]`, we still write a
 * single snapshot under the resolved tenant (matches the brief's "discuss
 * with Greg before going down that path" guidance for the byTenant variant).
 */
export function resolveWorkerDashboardSnapshotTenantId(
  userDoc: Record<string, unknown> | null,
): string {
  if (!userDoc) return C1_TENANT_ID;
  const active = String(userDoc.activeTenantId || '').trim();
  if (active) return active;
  const tid = String(userDoc.tenantId || '').trim();
  if (tid) return tid;
  return C1_TENANT_ID;
}

export interface RecomputeOptions {
  /** Override the resolved tenant (used by the callable for explicit refresh). */
  tenantId?: string;
  /** Optional Auth photo URL fallback. */
  authAvatarUrl?: string | null;
  /** Caller for logs. */
  reason: string;
  /** Skip the C1 worker-scope gate. Used by the callable so admins can refresh any tenant. */
  skipScopeGate?: boolean;
}

const SNAPSHOT_FIELD = 'workerDashboardActionItemsV1';

export async function recomputeWorkerDashboardActionItemsForUser(
  db: admin.firestore.Firestore,
  uid: string,
  options: RecomputeOptions,
): Promise<RecomputeResult> {
  if (!uid) throw new Error('recomputeWorkerDashboardActionItemsForUser: uid required');

  const userRef = db.doc(`users/${uid}`);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    logger.debug('workerDashboardActionItemsV1: user doc missing — skip', {
      uid,
      reason: options.reason,
    });
    return { wrote: false, outOfScope: true, snapshot: null, diagnostics: null };
  }
  const userDoc = userSnap.data() as Record<string, unknown>;
  if (!options.skipScopeGate && !isC1WorkerScope(userDoc)) {
    logger.debug('workerDashboardActionItemsV1: user not in C1 worker scope — skip', {
      uid,
      reason: options.reason,
    });
    return { wrote: false, outOfScope: true, snapshot: null, diagnostics: null };
  }

  const tenantId =
    options.tenantId && options.tenantId.trim()
      ? options.tenantId.trim()
      : resolveWorkerDashboardSnapshotTenantId(userDoc);

  const ctx = await loadWorkerDashboardActionItemsContext(db, uid, tenantId, {
    authAvatarUrl: options.authAvatarUrl ?? null,
  });
  const built = buildWorkerDashboardActionItemsSnapshot(ctx.modelInput);

  const existingHash = readExistingInputsHash(userDoc);
  const diagnostics = {
    inputsHash: built.inputsHash,
    itemCount: built.items.length,
    pendingAssignmentCount: ctx.diagnostics.pendingAssignmentCount,
    backgroundCheckCount: ctx.diagnostics.backgroundCheckCount,
    everifyCaseCount: ctx.diagnostics.everifyCaseCount,
    applicationsCount: ctx.diagnostics.applicationsCount,
    interviewsCount: ctx.diagnostics.interviewsCount,
    prescreenSuppressedByFreshness: ctx.diagnostics.prescreenSuppressedByFreshness,
  };

  if (existingHash && existingHash === built.inputsHash) {
    logger.debug('workerDashboardActionItemsV1: hash unchanged — skip write', {
      uid,
      tenantId,
      reason: options.reason,
      ...diagnostics,
    });
    const snapshot: WorkerDashboardActionItemsSnapshotV1 = {
      ...built,
      // Preserve whatever timestamp is already on the doc; we don't write so
      // there's no fresh server timestamp to return.
      updatedAt: readExistingUpdatedAt(userDoc),
    };
    return { wrote: false, outOfScope: false, snapshot, diagnostics };
  }

  const writePayload: WorkerDashboardActionItemsSnapshotV1 = {
    sourceVersion: built.sourceVersion,
    items: built.items,
    inputsHash: built.inputsHash,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await userRef.set({ [SNAPSHOT_FIELD]: writePayload }, { merge: true });
  logger.info('workerDashboardActionItemsV1: snapshot written', {
    uid,
    tenantId,
    reason: options.reason,
    ...diagnostics,
  });

  return { wrote: true, outOfScope: false, snapshot: writePayload, diagnostics };
}

function readExistingInputsHash(userDoc: Record<string, unknown>): string | null {
  const v = userDoc[SNAPSHOT_FIELD];
  if (!v || typeof v !== 'object') return null;
  const hash = (v as Record<string, unknown>).inputsHash;
  return typeof hash === 'string' && hash ? hash : null;
}

function readExistingUpdatedAt(userDoc: Record<string, unknown>): admin.firestore.Timestamp {
  const v = userDoc[SNAPSHOT_FIELD];
  if (v && typeof v === 'object') {
    const t = (v as Record<string, unknown>).updatedAt;
    if (t instanceof admin.firestore.Timestamp) return t;
  }
  // Fall back to "now" — never written today; only used in the skip-write
  // diagnostic return where the value isn't observed by Firestore.
  return admin.firestore.Timestamp.now();
}

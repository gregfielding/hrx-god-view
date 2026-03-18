import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import {
  buildHomeSnapshotV1,
  buildHomeSnapshotWritePayload,
  extractReadinessSignals,
} from './homeSnapshotModel';

if (!admin.apps.length) admin.initializeApp();

const C1_TENANT_ID = 'BCiP2bQ9CgVOCTfV6MhD';

function normalizeSecurityLevel(value: unknown): number | null {
  const n = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function isWorkerSecurityLevel(level: number | null): boolean {
  return level === null || level <= 4;
}

function isC1WorkerScope(userDoc: Record<string, unknown>): boolean {
  const activeTenantId = String(userDoc.activeTenantId || '').trim();
  const tenantId = String(userDoc.tenantId || '').trim();
  const tenantIds = (userDoc.tenantIds as Record<string, unknown> | undefined) || {};
  const inC1 = activeTenantId === C1_TENANT_ID || tenantId === C1_TENANT_ID || tenantIds[C1_TENANT_ID] != null;
  if (!inC1) return false;

  const directSecurity = normalizeSecurityLevel(userDoc.securityLevel);
  const tenantSecurity = normalizeSecurityLevel(
    (tenantIds[C1_TENANT_ID] as Record<string, unknown> | undefined)?.securityLevel,
  );
  const resolved = tenantSecurity ?? directSecurity;
  return isWorkerSecurityLevel(resolved);
}

function signalsChanged(
  beforeDoc: Record<string, unknown> | null,
  afterDoc: Record<string, unknown>,
): boolean {
  const afterSignals = extractReadinessSignals(afterDoc);
  if (!beforeDoc) return true;
  const beforeSignals = extractReadinessSignals(beforeDoc);
  return JSON.stringify(beforeSignals) !== JSON.stringify(afterSignals);
}

export const syncC1WorkerHomeReadinessSnapshot = onDocumentWritten(
  {
    document: 'users/{uid}',
    region: 'us-central1',
    maxInstances: 1,
    retry: false,
  },
  async (event) => {
    const before = event.data?.before?.exists ? (event.data.before.data() as Record<string, unknown>) : null;
    const after = event.data?.after?.exists ? (event.data.after.data() as Record<string, unknown>) : null;
    const afterRef = event.data?.after?.ref;
    const uid = event.params.uid as string;

    if (!after || !afterRef) return;
    if (!isC1WorkerScope(after)) return;
    if (!signalsChanged(before, after)) return;

    try {
      const snapshot = buildHomeSnapshotV1(after);
      await afterRef.set(
        buildHomeSnapshotWritePayload(snapshot, 'worker_domain_changed'),
        { merge: true },
      );
      logger.info('synced C1 worker home readiness snapshot', {
        uid,
        readinessPercent: snapshot.scoring.readinessPercent,
        completedCount: snapshot.scoring.completedCount,
        requiredCount: snapshot.scoring.requiredCount,
      });
    } catch (error) {
      logger.error('failed to sync C1 worker home readiness snapshot', {
        uid,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
);

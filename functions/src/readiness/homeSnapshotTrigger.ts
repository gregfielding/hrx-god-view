import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { isC1WorkerScope } from './c1WorkerScope';
import {
  buildHomeSnapshotV1,
  buildHomeSnapshotWritePayload,
  extractReadinessSignals,
} from './homeSnapshotModel';

if (!admin.apps.length) admin.initializeApp();

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

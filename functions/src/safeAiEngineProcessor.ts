import * as admin from 'firebase-admin';
import { createSafeFirestoreTrigger, SafeFunctionUtils, CostTracker } from './utils/safeFunctionTemplate';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const SAFE_CONFIG = {
  MAX_EXECUTION_TIME_MS: 55_000,
  TAG: 'processAILog@v3',
  LOCK_TTL_MS: 60_000, // one minute
  // EMERGENCY: Aggressive cost containment
  ENABLED: false, // TEMPORARILY DISABLED
  SAMPLING_RATE: 0.001, // 0.1% sampling (only 1 in 1000 events)
  MAX_ENGINES_TO_PROCESS: 0 // Process no engines
};

function getEnginesFor(logData: any): string[] {
  // Conservative: pick minimal engines based on eventType
  const type = (logData?.eventType || '').toString();
  if (!type) return [];
  if (type.startsWith('deal.') || type.startsWith('task.')) return ['summary'];
  return [];
}

async function withLock(docRef: admin.firestore.DocumentReference, fn: () => Promise<void>): Promise<boolean> {
  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) return false;
    const data: any = snap.data() || {};

    // If already processed, or hard lock present and recent, skip
    if (data.processed === true) return false;
    const lockedAt: admin.firestore.Timestamp | null = data._processingAt || null;
    if (data._processingBy && lockedAt && Date.now() - lockedAt.toMillis() < SAFE_CONFIG.LOCK_TTL_MS) {
      return false;
    }

    tx.update(docRef, {
      _processingBy: SAFE_CONFIG.TAG,
      _processingAt: admin.firestore.FieldValue.serverTimestamp(),
      processingStartedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return true;
  }).then(async (acquired) => {
    if (!acquired) return false;
    try {
      await fn();
      await docRef.update({
        processed: true,
        processingCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
        _processingBy: admin.firestore.FieldValue.delete(),
        _processingAt: admin.firestore.FieldValue.delete(),
      });
      return true;
    } catch (err) {
      console.error('processAILog failed:', err);
      await docRef.update({ _processingBy: admin.firestore.FieldValue.delete(), _processingAt: admin.firestore.FieldValue.delete() });
      return false;
    }
  });
}

const safeTrigger = createSafeFirestoreTrigger(
  async (event) => {
    // EMERGENCY: Function is temporarily disabled
    if (!SAFE_CONFIG.ENABLED) {
      console.log('processAILog disabled for cost containment');
      return;
    }

    // Apply aggressive sampling
    if (Math.random() > SAFE_CONFIG.SAMPLING_RATE) {
      console.log('processAILog skipped due to sampling');
      return;
    }

    SafeFunctionUtils.resetCounters();
    CostTracker.reset();

    const logId = event.params.logId as string;
    const logData = event.data?.data();
    if (!logData) return;

    const docRef = db.collection('ai_logs').doc(logId);

    // Skip non-relevant/self writes
    if (logData.sourceModule === 'FirestoreTrigger') return;
    if (logData.processed === true) return;

    // Acquire lock and process minimally with strict limits
    await withLock(docRef, async () => {
      const engines = getEnginesFor(logData).slice(0, SAFE_CONFIG.MAX_ENGINES_TO_PROCESS); // Process no engines
      const results: any[] = [];
      for (const engine of engines) {
        try {
          SafeFunctionUtils.checkSafetyLimits();
          CostTracker.trackOperation(`engine_${engine}`, 0.0005);
          // Minimal placeholder processing to avoid costly work
          results.push({ engine, success: true, processedAt: new Date().toISOString(), note: 'lightweight-safe' });
        } catch (e) {
          results.push({ engine, success: false, error: (e as any)?.message || 'error' });
        }
      }

      await docRef.update({
        engineTouched: engines,
        processingResults: admin.firestore.FieldValue.arrayUnion(...results),
        errors: results.filter(r => !r.success).map(r => r.error),
      });
    });
  },
  {
    timeoutSeconds: Math.floor(SAFE_CONFIG.MAX_EXECUTION_TIME_MS / 1000),
    memory: '256MiB',
    maxInstances: 2,
  }
);

export const processAILog = safeTrigger.onDocumentCreated('ai_logs/{logId}');



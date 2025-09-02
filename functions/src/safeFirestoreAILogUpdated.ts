import * as admin from 'firebase-admin';
import { createSafeFirestoreTrigger, SafeFunctionUtils, CostTracker, onlyIgnoredFieldsChanged } from './utils/safeFunctionTemplate';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const SAFE_CONFIG = {
  MAX_EXECUTION_TIME_MS: 55_000,
  TAG: 'firestoreLogAILogUpdated@v2',
  IGNORE_FIELDS: ['processingStartedAt', 'processingCompletedAt', 'engineTouched', 'errors', 'latencyMs', '_processingBy', '_processingAt', 'updatedAt', 'lastUpdated'],
};

const safeTrigger = createSafeFirestoreTrigger(
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after) return;

    // Skip self and meta updates
    if (after.sourceModule === 'FirestoreTrigger') return;
    if (onlyIgnoredFieldsChanged(before, after, SAFE_CONFIG.IGNORE_FIELDS)) return;

    // No-op by design: we do NOT meta-log here to avoid fan-out; left as a placeholder for future selective logging
    CostTracker.trackOperation('ai_log_updated_ignored', 0.0);
  },
  {
    timeoutSeconds: Math.floor(SAFE_CONFIG.MAX_EXECUTION_TIME_MS / 1000),
    memory: '256MiB',
    maxInstances: 2,
  }
);

// Not exported yet; wire into index only when needed
export const firestoreLogAILogUpdated = safeTrigger.onDocumentUpdated('ai_logs/{logId}');



import * as admin from 'firebase-admin';

const db = admin.firestore();

/** Mirrors client activityLogs shape (users/{uid}/activityLogs). */
export async function writeWorkerActivityLog(params: {
  userId: string;
  action: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.collection('users').doc(params.userId).collection('activityLogs').add({
    action: params.action,
    actionType: 'other',
    description: params.description,
    severity: params.severity,
    source: 'system',
    ...(params.metadata ? { metadata: params.metadata } : {}),
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

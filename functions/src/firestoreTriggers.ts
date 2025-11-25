import * as admin from 'firebase-admin';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { logger } from './utils/logger';

// Legacy triggers were used to mirror AI log events. Firestore logging has been disabled, so
// this file now only contains the simple test trigger for users plus a helper logger.

defaultExport();

export const testUserUpdate = onDocumentUpdated('users/{userId}', async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();
  const userId = event.params.userId;
  
  if (!beforeData || !afterData) return;
  
  try {
    await admin.firestore().collection('test_logs').add({
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      userId,
      action: 'user_updated',
      changedFields: Object.keys(afterData).filter(key =>
        JSON.stringify(beforeData[key]) !== JSON.stringify(afterData[key])
      ),
      beforeData,
      afterData
    });
  } catch (error) {
    logger.error('testUserUpdate logging error', {
      context: 'firestoreTriggers.testUserUpdate',
      error
    });
  }
});

function defaultExport() {
  logger.info('firestoreTriggers module initialized with legacy AI logging disabled.');
}

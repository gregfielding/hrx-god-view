/**
 * Backfill Slack Conversation Settings
 * 
 * Phase 5: One-time migration script to add slackSettings to existing conversations
 * that have slackLink but no slackSettings.
 */

import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const DEFAULT_TENANT_ID = 'BCiP2bQ9CgVOCTfV6MhD'; // C1 Staffing tenant ID

/**
 * Backfill slackSettings for a specific tenant
 */
export async function backfillSlackConversationSettingsForTenant(tenantId: string): Promise<void> {
  const now = admin.firestore.Timestamp.now();
  const BATCH_LIMIT = 400;

  async function processCollection(collectionName: 'internalDMs' | 'internalChannels') {
    const snap = await db
      .collection('tenants')
      .doc(tenantId)
      .collection(collectionName)
      .get();

    let count = 0;
    let batch = db.batch();

    for (const doc of snap.docs) {
      const data = doc.data();

      // Only update conversations that have a slackLink but no slackSettings
      if (!data.slackLink || data.slackSettings) {
        continue;
      }

      const ref = doc.ref;
      batch.update(ref, {
        slackSettings: {
          mode: 'manual',
          autoThreadReplies: true,
          defaultThreadTs: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      count++;

      if (count >= BATCH_LIMIT) {
        await batch.commit();
        console.log(`Committed batch of ${count} for ${collectionName}`);
        count = 0;
        batch = db.batch();
      }
    }

    if (count > 0) {
      await batch.commit();
      console.log(`Committed final batch of ${count} for ${collectionName}`);
    }

    console.log(`Backfill complete for ${collectionName}`);
  }

  await processCollection('internalDMs');
  await processCollection('internalChannels');

  console.log(`Backfill complete for tenant ${tenantId}`);
}

// Run if called directly
if (require.main === module) {
  const tenantId = process.argv[2] || DEFAULT_TENANT_ID;
  
  backfillSlackConversationSettingsForTenant(tenantId)
    .then(() => {
      console.log('Slack conversation settings backfill complete.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Slack conversation settings backfill ERROR', err);
      process.exit(1);
    });
}




import * as dotenv from 'dotenv';

// Load environment variables (for OPENAI_API_KEY) - must be first!
dotenv.config();

import * as admin from 'firebase-admin';
import { getTraitsAndTags } from './src/utils/openaiHelper';

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

async function batchTagMotivations() {
  const motivationsRef = db.collection('motivations');
  const snapshot = await motivationsRef.where('isActive', '==', true).get();
  let updated = 0;
  let skipped = 0;
  let errors: string[] = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();
    if ((data.traits && data.traits.length > 0) && (data.tags && data.tags.length > 0)) {
      skipped++;
      continue;
    }
    try {
      const { traits, tags } = await getTraitsAndTags(data.text || data.quote || '');
      await doc.ref.update({ traits, tags });
      updated++;
      console.log(`Updated: ${doc.id} | Traits: ${traits.join(', ')} | Tags: ${tags.join(', ')}`);
    } catch (err: any) {
      errors.push(`Doc ${doc.id}: ${err.message}`);
      console.error(`Error updating ${doc.id}:`, err.message);
    }
  }

  console.log(`\nBatch tagging complete. Updated: ${updated}, Skipped: ${skipped}, Errors: ${errors.length}`);
  if (errors.length > 0) {
    console.log('Errors:', errors);
  }
}

batchTagMotivations().then(() => process.exit(0)); 
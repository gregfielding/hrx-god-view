import * as admin from 'firebase-admin';

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

async function migrateHelpDrafts() {
  const snapshot = await db.collection('help_topics').get();
  let updated = 0;
  for (const doc of snapshot.docs) {
    const data = doc.data();
    // Only migrate if 'content' exists and 'body' is missing
    if (data.content && !data.body) {
      const body = data.content;
      const summary = data.content.replace(/^#+\s.*\n/gm, '').replace(/\n+/g, ' ').trim().slice(0, 200);
      await doc.ref.update({
        body,
        summary,
        content: admin.firestore.FieldValue.delete(),
      });
      updated++;
      console.log(`Migrated draft: ${doc.id}`);
    }
  }
  console.log(`Migration complete. Updated ${updated} drafts.`);
}

migrateHelpDrafts().then(() => process.exit(0)); 
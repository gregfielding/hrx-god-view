// deleteAllAILogs.js
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

async function deleteAllAILogs() {
  const snapshot = await db.collection('ai_logs').get();
  if (snapshot.empty) {
    console.log('No logs to delete.');
    return;
  }
  console.log(`Found ${snapshot.size} logs. Deleting...`);
  const batchSize = 500;
  let deleted = 0;
  const docs = snapshot.docs;
  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = db.batch();
    docs.slice(i, i + batchSize).forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    deleted += Math.min(batchSize, docs.length - i);
    console.log(`Deleted ${deleted}/${docs.length}`);
  }
  console.log('All ai_logs deleted!');
}

deleteAllAILogs().catch(err => {
  console.error('Error deleting ai_logs:', err);
  process.exit(1);
}); 
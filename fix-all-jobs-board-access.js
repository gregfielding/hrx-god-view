const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
const serviceAccount = require('./service-account-key.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'hrx1-d3beb'
});

const db = admin.firestore();

async function fixAllJobsBoardAccess() {
  try {
    console.log('🔧 Fixing Jobs Board access for all users from public jobs board...');
    
    // Find all users who signed up from public jobs board but don't have jobsBoard enabled
    const usersSnapshot = await db.collection('users')
      .where('source', '==', 'public_jobs_board')
      .where('jobsBoard', '==', false)
      .get();
    
    if (usersSnapshot.empty) {
      console.log('✅ No users found with jobsBoard: false from public_jobs_board');
      return;
    }
    
    console.log(`📊 Found ${usersSnapshot.size} users to update`);
    
    const batch = db.batch();
    let updateCount = 0;
    
    usersSnapshot.forEach((doc) => {
      const userRef = db.collection('users').doc(doc.id);
      batch.update(userRef, {
        jobsBoard: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      updateCount++;
    });
    
    await batch.commit();
    
    console.log(`✅ Successfully updated ${updateCount} users to have Jobs Board access`);
    console.log('🎉 All users from public jobs board should now see the Jobs Board menu!');
    
  } catch (error) {
    console.error('❌ Error updating users:', error);
  }
}

// Run the fix
fixAllJobsBoardAccess();

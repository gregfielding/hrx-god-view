const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
// You'll need to download your service account key from Firebase Console
// and place it in the project root as 'service-account-key.json'
const serviceAccount = require('./service-account-key.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'hrx1-d3beb'
});

const db = admin.firestore();

async function fixJobsBoardAccess() {
  try {
    console.log('🔧 Fixing Jobs Board access for existing users...');
    
    // Update the specific user who can't see Jobs Board
    const userId = '5hqNE0ngmGOEa2jA0QSTdJMfBln1';
    const userRef = db.collection('users').doc(userId);
    
    await userRef.update({
      jobsBoard: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log('✅ Successfully updated user jobsBoard field to true');
    console.log('🎉 The Jobs Board menu item should now appear for this user!');
    
  } catch (error) {
    console.error('❌ Error updating user:', error);
  }
}

// Run the fix
fixJobsBoardAccess();

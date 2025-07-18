const admin = require('firebase-admin');

// Initialize Firebase Admin
const serviceAccount = require('./firebase copy.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function updateUserUid() {
  try {
    console.log('🔍 Searching for your user document...');
    
    // Get your email from the command line arguments
    const email = process.argv[2];
    if (!email) {
      console.error('❌ Please provide your email as an argument:');
      console.error('   node updateUserUid.js your-email@example.com');
      return;
    }

    console.log(`📧 Looking for user with email: ${email}`);
    
    // Find the user document by email
    const usersRef = db.collection('users');
    const snapshot = await usersRef.where('email', '==', email).get();
    
    if (snapshot.empty) {
      console.error('❌ No user found with that email address');
      return;
    }

    const userDoc = snapshot.docs[0];
    const oldUid = userDoc.id;
    const userData = userDoc.data();
    
    console.log(`✅ Found user document:`);
    console.log(`   Old UID: ${oldUid}`);
    console.log(`   Email: ${userData.email}`);
    console.log(`   Name: ${userData.firstName} ${userData.lastName}`);
    console.log(`   Role: ${userData.role}`);
    
    // Get your new UID from Firebase Auth
    console.log('🔍 Looking up your new UID in Firebase Auth...');
    const userRecord = await admin.auth().getUserByEmail(email);
    const newUid = userRecord.uid;
    
    console.log(`✅ Found new UID: ${newUid}`);
    
    if (oldUid === newUid) {
      console.log('✅ UIDs match! No update needed.');
      return;
    }
    
    console.log('⚠️  UIDs are different. Updating user document...');
    
    // Create new document with new UID
    await db.collection('users').doc(newUid).set({
      ...userData,
      uid: newUid, // Update the uid field
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log(`✅ Created new user document with UID: ${newUid}`);
    
    // Delete old document
    await db.collection('users').doc(oldUid).delete();
    console.log(`🗑️  Deleted old user document with UID: ${oldUid}`);
    
    console.log('🎉 User document successfully updated!');
    console.log(`   New UID: ${newUid}`);
    console.log('   You can now log in with your new Firebase Auth account.');
    
  } catch (error) {
    console.error('❌ Error updating user UID:', error);
  }
}

// Run the script
updateUserUid().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
}); 
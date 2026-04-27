const { initializeApp } = require('firebase/app');
const { getFirestore, doc, updateDoc } = require('firebase/firestore');

// Your Firebase config
const firebaseConfig = {
  apiKey: 'AIzaSyBQA9bc25_7ncjvY75nAtIUv47C3w5jl6c',
  authDomain: 'hrx1-d3beb.firebaseapp.com',
  projectId: 'hrx1-d3beb',
  storageBucket: 'hrx1-d3beb.firebasestorage.app',
  messagingSenderId: '143752240496',
  appId: '1:143752240496:web:e0b584983d4b04cb3983b5',
  measurementId: 'G-LL20QKNT0W'
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function fixJobsBoardAccess() {
  try {
    console.log('🔧 Fixing Jobs Board access for existing users...');
    
    // Update the specific user who can't see Jobs Board
    const userId = '5hqNE0ngmGOEa2jA0QSTdJMfBln1';
    const userRef = doc(db, 'users', userId);
    
    await updateDoc(userRef, {
      jobsBoard: true,
      updatedAt: new Date()
    });
    
    console.log('✅ Successfully updated user jobsBoard field to true');
    console.log('🎉 The Jobs Board menu item should now appear for this user!');
    
  } catch (error) {
    console.error('❌ Error updating user:', error);
    
    if (error.code === 'permission-denied') {
      console.log('💡 Permission denied. You may need to:');
      console.log('   1. Run this script with Firebase Admin SDK');
      console.log('   2. Or manually update in Firebase Console');
      console.log('   3. Or update Firestore security rules');
    }
  }
}

// Run the fix
fixJobsBoardAccess();

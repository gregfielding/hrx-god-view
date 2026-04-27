// Simple script to update user's jobsBoard field
// This uses the client SDK and should work if you're logged in

const { initializeApp } = require('firebase/app');
const { getFirestore, doc, updateDoc } = require('firebase/firestore');

const firebaseConfig = {
  apiKey: 'AIzaSyBQA9bc25_7ncjvY75nAtIUv47C3w5jl6c',
  authDomain: 'hrx1-d3beb.firebaseapp.com',
  projectId: 'hrx1-d3beb',
  storageBucket: 'hrx1-d3beb.firebasestorage.app',
  messagingSenderId: '143752240496',
  appId: '1:143752240496:web:e0b584983d4b04cb3983b5',
  measurementId: 'G-LL20QKNT0W'
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function fixUserJobsBoard() {
  try {
    console.log('🔧 Attempting to fix Jobs Board access...');
    console.log('💡 This script will try to update the user document directly');
    console.log('   If it fails, you can manually update in Firebase Console');
    
    // Try to update the user document
    const userId = '5hqNE0ngmGOEa2jA0QSTdJMfBln1';
    const userRef = doc(db, 'users', userId);
    
    await updateDoc(userRef, {
      jobsBoard: true,
      updatedAt: new Date()
    });
    
    console.log('✅ Successfully updated user jobsBoard field to true');
    console.log('🎉 The Jobs Board menu item should now appear!');
    
  } catch (error) {
    console.error('❌ Error updating user:', error);
    
    if (error.code === 'permission-denied') {
      console.log('\n💡 Manual Fix Required:');
      console.log('1. Go to https://console.firebase.google.com/');
      console.log('2. Select project: hrx1-d3beb');
      console.log('3. Navigate to Firestore Database');
      console.log('4. Find collection: users');
      console.log('5. Find document: 5hqNE0ngmGOEa2jA0QSTdJMfBln1');
      console.log('6. Edit the document and change jobsBoard from false to true');
      console.log('7. Save the changes');
      console.log('\n🎉 After this change, refresh your app and the Jobs Board menu should appear!');
    }
  }
}

// Run the fix
fixUserJobsBoard();

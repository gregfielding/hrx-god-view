// Script to fix workEligibility for users who have DOB and phoneVerified but workEligibility is false
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, updateDoc, getDoc } = require('firebase/firestore');

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

async function fixWorkEligibility() {
  try {
    console.log('🔧 Fixing workEligibility for user...');
    
    const userId = '5hqNE0ngmGOEa2jA0QSTdJMfBln1';
    const userRef = doc(db, 'users', userId);
    
    // First, let's check the current user data
    const userDoc = await getDoc(userRef);
    if (!userDoc.exists()) {
      console.log('❌ User document not found');
      return;
    }
    
    const userData = userDoc.data();
    console.log('📊 Current user data:');
    console.log('  dob:', userData.dob);
    console.log('  phoneVerified:', userData.phoneVerified);
    console.log('  workEligibility:', userData.workEligibility);
    
    // Check if both DOB and phoneVerified are true
    const hasValidDob = userData.dob && /^\d{4}-\d{2}-\d{2}$/.test(userData.dob);
    const hasValidPhone = userData.phoneVerified === true;
    
    if (hasValidDob && hasValidPhone && userData.workEligibility !== true) {
      console.log('✅ User has valid DOB and phone verification, fixing workEligibility...');
      
      await updateDoc(userRef, {
        workEligibility: true,
        updatedAt: new Date()
      });
      
      console.log('🎉 Successfully updated workEligibility to true!');
      console.log('🚀 User should now be able to apply to jobs without verification modal.');
    } else if (userData.workEligibility === true) {
      console.log('✅ User already has workEligibility: true');
    } else {
      console.log('❌ User missing required fields:');
      console.log('  Valid DOB:', hasValidDob);
      console.log('  Valid Phone:', hasValidPhone);
    }
    
  } catch (error) {
    console.error('❌ Error fixing workEligibility:', error);
    
    if (error.code === 'permission-denied') {
      console.log('\n💡 Manual Fix Required:');
      console.log('1. Go to https://console.firebase.google.com/');
      console.log('2. Select project: hrx1-d3beb');
      console.log('3. Navigate to Firestore Database');
      console.log('4. Find collection: users');
      console.log('5. Find document: 5hqNE0ngmGOEa2jA0QSTdJMfBln1');
      console.log('6. Edit the document and change workEligibility from false to true');
      console.log('7. Save the changes');
      console.log('\n🎉 After this change, the user should be able to apply to jobs!');
    }
  }
}

// Run the fix
fixWorkEligibility();

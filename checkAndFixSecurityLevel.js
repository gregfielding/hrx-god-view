const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc, updateDoc } = require('firebase/firestore');
const { getAuth, signInWithEmailAndPassword } = require('firebase/auth');

// Initialize Firebase Client
const firebaseConfig = {
  apiKey: 'AIzaSyBQA9bc25_7ncjvY75nAtIUv47C3w5jl6c',
  authDomain: 'hrx1-d3beb.firebaseapp.com',
  projectId: 'hrx1-d3beb',
  storageBucket: 'hrx1-d3beb.firebasestorage.app',
  messagingSenderId: '143752240496',
  appId: '1:143752240496:web:e0b584983d4b04cb3983b5',
  measurementId: 'G-LL20QKNT0W',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

async function checkAndFixSecurityLevel() {
  console.log('🔍 Checking and fixing security level...\n');

  // You can modify these credentials or use the sign-in flow
  const email = 'g.fielding@c1staffing.com'; // Replace with your email
  const password = 'your-password'; // Replace with your password

  try {
    // 1. Sign in
    console.log('1️⃣ Signing in...');
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    console.log(`   ✅ Signed in as: ${user.email}`);

    // 2. Check current security level
    console.log('\n2️⃣ Checking current security level...');
    const userRef = doc(db, 'users', user.uid);
    const userDoc = await getDoc(userRef);
    
    if (userDoc.exists()) {
      const userData = userDoc.data();
      const currentSecurityLevel = userData.securityLevel || '0';
      console.log(`   Current security level: ${currentSecurityLevel}`);
      console.log(`   User tenantId: ${userData.tenantId || 'N/A'}`);
      console.log(`   User role: ${userData.role || 'N/A'}`);
      
      // 3. Check if security level needs to be updated
      const securityLevels = {
        '0': 'Suspended',
        '1': 'Dismissed', 
        '2': 'Applicant',
        '3': 'Flex',
        '4': 'Hired Staff',
        '5': 'Worker',
        '6': 'Manager',
        '7': 'Admin'
      };
      
      console.log(`   Current level name: ${securityLevels[currentSecurityLevel] || 'Unknown'}`);
      
      // LocationDetails requires security level 4 or higher
      if (parseInt(currentSecurityLevel) < 4) {
        console.log('\n3️⃣ Security level needs to be updated...');
        console.log(`   Required: 4 (Hired Staff) or higher`);
        console.log(`   Current: ${currentSecurityLevel} (${securityLevels[currentSecurityLevel]})`);
        
        // Update to security level 5 (Worker) which is appropriate for admin access
        const updateData = {
          securityLevel: '5',
          updatedAt: new Date()
        };
        
        await updateDoc(userRef, updateData);
        console.log('   ✅ Security level updated to 5 (Worker)');
        
        // Verify the update
        const updatedDoc = await getDoc(userRef);
        if (updatedDoc.exists()) {
          const updatedData = updatedDoc.data();
          console.log(`   Verified new security level: ${updatedData.securityLevel}`);
        }
        
      } else {
        console.log('\n3️⃣ Security level is sufficient');
        console.log(`   ✅ You have security level ${currentSecurityLevel} (${securityLevels[currentSecurityLevel]})`);
        console.log(`   ✅ This meets the requirement for LocationDetails (level 4+)`);
      }
      
    } else {
      console.log('   ❌ User document not found');
    }

    console.log('\n✅ Check complete! You should now be able to access LocationDetails.');

  } catch (error) {
    console.error('❌ Operation failed:', error.message);
    
    if (error.code === 'auth/user-not-found') {
      console.log('💡 User not found. Make sure the email is correct.');
    } else if (error.code === 'auth/wrong-password') {
      console.log('💡 Wrong password. Please check your credentials.');
    } else if (error.code === 'auth/invalid-email') {
      console.log('💡 Invalid email format.');
    } else if (error.code === 'auth/too-many-requests') {
      console.log('💡 Too many failed attempts. Try again later.');
    }
  }
}

// Instructions for manual setup
console.log('📋 Security Level Fix Instructions:');
console.log('1. Replace the email and password in this script with your credentials');
console.log('2. Run: node checkAndFixSecurityLevel.js');
console.log('3. Or manually update your user document in Firestore:');
console.log('   - Collection: users');
console.log('   - Document: your-user-id');
console.log('   - Update field: securityLevel: "5"');
console.log('   - This will give you Worker level access (sufficient for CRM)\n');

// Uncomment the line below to run the fix
// checkAndFixSecurityLevel();

console.log('💡 To run the security level fix, uncomment the last line in this script and update your credentials.'); 
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, updateDoc } = require('firebase/firestore');
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

async function setupSalesperson() {
  console.log('🔧 Setting up user as salesperson...\n');

  // You can modify these credentials or use the sign-in flow
  const email = 'g.fielding@c1staffing.com'; // Replace with your email
  const password = 'your-password'; // Replace with your password

  try {
    // 1. Sign in
    console.log('1️⃣ Signing in...');
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    console.log(`   ✅ Signed in as: ${user.email}`);

    // 2. Update user document to add crm_sales flag
    console.log('\n2️⃣ Updating user permissions...');
    const userRef = doc(db, 'users', user.uid);
    
    const updateData = {
      crm_sales: true,
      securityLevel: '5', // Ensure high security level
      updatedAt: new Date()
    };

    await updateDoc(userRef, updateData);
    console.log('   ✅ User updated with crm_sales: true');

    // 3. Verify the update
    console.log('\n3️⃣ Verifying update...');
    const { getDoc } = require('firebase/firestore');
    const userDoc = await getDoc(userRef);
    if (userDoc.exists()) {
      const userData = userDoc.data();
      console.log(`   crm_sales: ${userData.crm_sales}`);
      console.log(`   securityLevel: ${userData.securityLevel}`);
      console.log(`   tenantId: ${userData.tenantId}`);
    }

    console.log('\n✅ Setup complete! You should now have CRM access.');

  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    
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
console.log('📋 Manual Setup Instructions:');
console.log('1. Replace the email and password in this script with your credentials');
console.log('2. Run: node setupSalesperson.js');
console.log('3. Or manually update your user document in Firestore:');
console.log('   - Collection: users');
console.log('   - Document: your-user-id');
console.log('   - Add field: crm_sales: true');
console.log('   - Ensure securityLevel is "5" or higher\n');

// Uncomment the line below to run the setup
// setupSalesperson();

console.log('💡 To run the setup, uncomment the last line in this script and update your credentials.'); 
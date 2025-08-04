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

async function checkAndFixUserPermissions() {
  try {
    // Sign in with your credentials
    const email = 'g.fielding@c1staffing.com'; // Replace with your email
    const password = 'your-password'; // Replace with your password
    
    console.log('🔐 Signing in...');
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    console.log(`✅ Signed in as: ${user.email}`);
    
    console.log(`🔍 Checking permissions for user: ${user.uid}`);
    
    // Get user document
    const userRef = doc(db, 'users', user.uid);
    const userDoc = await getDoc(userRef);
    
    if (!userDoc.exists()) {
      console.error('❌ User not found');
      return;
    }
    
    const userData = userDoc.data();
    console.log('📊 Current user data:', {
      uid: userData.uid,
      email: userData.email,
      firstName: userData.firstName,
      lastName: userData.lastName,
      role: userData.role,
      securityLevel: userData.securityLevel,
      crm_sales: userData.crm_sales,
      tenantIds: userData.tenantIds
    });
    
    // Check if user has CRM access
    const hasCRMAccess = userData.crm_sales === true || 
                        userData.securityLevel === "4" || 
                        userData.securityLevel === "5" || 
                        userData.securityLevel === "6" || 
                        userData.securityLevel === "7" ||
                        userData.role === "HRX";
    
    console.log(`🔐 User has CRM access: ${hasCRMAccess}`);
    
    if (!hasCRMAccess) {
      console.log('⚠️ User does not have CRM access. Adding crm_sales flag...');
      
      // Update user to add crm_sales flag
      await updateDoc(userRef, {
        crm_sales: true,
        updatedAt: new Date()
      });
      
      console.log('✅ Successfully added crm_sales: true to user');
      
      // Verify the update
      const updatedDoc = await getDoc(userRef);
      const updatedData = updatedDoc.data();
      console.log(`🔍 Updated crm_sales flag: ${updatedData.crm_sales}`);
      
    } else {
      console.log('✅ User already has CRM access');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
    
    if (error.code === 'auth/user-not-found') {
      console.log('💡 User not found. Make sure the email is correct.');
    } else if (error.code === 'auth/wrong-password') {
      console.log('💡 Wrong password. Please check your credentials.');
    } else if (error.code === 'auth/invalid-email') {
      console.log('💡 Invalid email format.');
    }
  }
}

// Instructions
console.log('📋 Instructions:');
console.log('1. Replace the email and password in this script with your credentials');
console.log('2. Run: node checkAndFixUserPermissions.js');
console.log('3. The script will check your permissions and add crm_sales: true if needed\n');

// Uncomment the line below to run the script
// checkAndFixUserPermissions();

console.log('💡 To run the script, uncomment the last line and update your credentials.'); 
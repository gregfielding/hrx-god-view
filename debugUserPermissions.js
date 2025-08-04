const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc } = require('firebase/firestore');
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

async function debugUserPermissions() {
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
      tenantIds: userData.tenantIds,
      activeTenantId: userData.activeTenantId,
      orgType: userData.orgType
    });
    
    // Check security level hierarchy
    const securityLevels = {
      '0': 0, // Suspended
      '1': 1, // Dismissed
      '2': 2, // Applicant
      '3': 3, // Flex
      '4': 4, // Hired Staff
      '5': 5, // Worker
      '6': 6, // Manager
      '7': 7, // Admin
    };
    
    const userLevel = securityLevels[userData.securityLevel] || 0;
    const requiredLevel = securityLevels['4'] || 0; // Locations requires level 4
    
    console.log(`🔐 Security Level Analysis:`);
    console.log(`   User Level: ${userData.securityLevel} (${userLevel})`);
    console.log(`   Required Level: 4 (${requiredLevel})`);
    console.log(`   Has Access: ${userLevel >= requiredLevel ? '✅ YES' : '❌ NO'}`);
    
    // Check CRM access
    const hasCRMAccess = userData.crm_sales === true || 
                        userData.securityLevel === "4" || 
                        userData.securityLevel === "5" || 
                        userData.securityLevel === "6" || 
                        userData.securityLevel === "7" ||
                        userData.role === "HRX";
    
    console.log(`🔐 CRM Access: ${hasCRMAccess ? '✅ YES' : '❌ NO'}`);
    
    // Check tenant access
    if (userData.tenantIds) {
      console.log(`🏢 Tenant Access:`);
      if (Array.isArray(userData.tenantIds)) {
        console.log(`   Tenants: ${userData.tenantIds.join(', ')}`);
      } else if (typeof userData.tenantIds === 'object') {
        console.log(`   Tenants: ${Object.keys(userData.tenantIds).join(', ')}`);
      }
    }
    
    console.log(`🎯 Active Tenant: ${userData.activeTenantId || 'None'}`);
    
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
console.log('2. Run: node debugUserPermissions.js');
console.log('3. This will show your current permissions and security level\n');

// Uncomment the line below to run the script
// debugUserPermissions();

console.log('💡 To run the script, uncomment the last line and update your credentials.'); 
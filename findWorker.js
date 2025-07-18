const admin = require('firebase-admin');

// Initialize Firebase Admin with default credentials
admin.initializeApp();

const db = admin.firestore();

async function findWorker() {
  try {
    // Get all users and search for the one we're looking for
    const usersRef = db.collection('users');
    const snapshot = await usersRef.get();
    
    console.log('Searching through all users...');
    
    snapshot.docs.forEach(doc => {
      const userData = doc.data();
      const email = userData.email;
      
      // Look for users with 'fielding' in the email or name
      if (email && (email.includes('fielding') || 
          (userData.firstName && userData.firstName.toLowerCase().includes('fielding')) ||
          (userData.lastName && userData.lastName.toLowerCase().includes('fielding')))) {
        console.log('Found potential match:');
        console.log('  ID:', doc.id);
        console.log('  Email:', email);
        console.log('  Name:', userData.firstName, userData.lastName);
        console.log('  Role:', userData.role);
        console.log('  SecurityLevel:', userData.securityLevel);
        console.log('  Department:', userData.department);
        console.log('  TenantId:', userData.tenantId);
        console.log('  TenantIds:', userData.tenantIds);
        console.log('  InviteStatus:', userData.inviteStatus);
        console.log('---');
      }
    });
    
    // Also search for users with inviteStatus 'pending'
    console.log('\nSearching for users with pending invite status...');
    const pendingQuery = usersRef.where('inviteStatus', '==', 'pending');
    const pendingSnapshot = await pendingQuery.get();
    
    pendingSnapshot.docs.forEach(doc => {
      const userData = doc.data();
      console.log('Pending user:');
      console.log('  ID:', doc.id);
      console.log('  Email:', userData.email);
      console.log('  Name:', userData.firstName, userData.lastName);
      console.log('  Role:', userData.role);
      console.log('  SecurityLevel:', userData.securityLevel);
      console.log('  Department:', userData.department);
      console.log('  TenantId:', userData.tenantId);
      console.log('  TenantIds:', userData.tenantIds);
      console.log('---');
    });
    
  } catch (error) {
    console.error('Error finding worker:', error);
  }
}

// Run the search
findWorker().then(() => {
  console.log('Search completed');
  process.exit(0);
}).catch((error) => {
  console.error('Search failed:', error);
  process.exit(1);
}); 
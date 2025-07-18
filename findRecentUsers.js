const admin = require('firebase-admin');

// Initialize Firebase Admin with default credentials
admin.initializeApp();

const db = admin.firestore();

async function findRecentUsers() {
  try {
    // Get all users and search for recent ones with pending status
    const usersRef = db.collection('users');
    const snapshot = await usersRef.get();
    
    console.log('Searching through all users for recent pending invites...');
    
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    snapshot.docs.forEach(doc => {
      const userData = doc.data();
      const email = userData.email;
      const inviteSentAt = userData.inviteSentAt;
      
      // Check if user was invited recently (within last 24 hours)
      if (inviteSentAt) {
        const inviteDate = inviteSentAt.toDate ? inviteSentAt.toDate() : new Date(inviteSentAt);
        if (inviteDate > oneDayAgo) {
          console.log('Recent user:');
          console.log('  ID:', doc.id);
          console.log('  Email:', email);
          console.log('  Name:', userData.firstName, userData.lastName);
          console.log('  Role:', userData.role);
          console.log('  SecurityLevel:', userData.securityLevel);
          console.log('  Department:', userData.department);
          console.log('  TenantId:', userData.tenantId);
          console.log('  TenantIds:', userData.tenantIds);
          console.log('  InviteStatus:', userData.inviteStatus);
          console.log('  InviteSentAt:', inviteDate);
          console.log('---');
        }
      }
    });
    
    // Also search for users with inviteStatus 'pending' and no tenantIds map
    console.log('\nSearching for users with pending status and missing tenantIds map...');
    
    snapshot.docs.forEach(doc => {
      const userData = doc.data();
      const email = userData.email;
      
      if (userData.inviteStatus === 'pending') {
        const hasTenantIdsMap = userData.tenantIds && typeof userData.tenantIds === 'object' && !Array.isArray(userData.tenantIds);
        
        if (!hasTenantIdsMap) {
          console.log('Pending user without proper tenantIds map:');
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
      }
    });
    
  } catch (error) {
    console.error('Error finding recent users:', error);
  }
}

// Run the search
findRecentUsers().then(() => {
  console.log('Search completed');
  process.exit(0);
}).catch((error) => {
  console.error('Search failed:', error);
  process.exit(1);
}); 
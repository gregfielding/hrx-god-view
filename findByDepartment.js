const admin = require('firebase-admin');

// Initialize Firebase Admin with default credentials
admin.initializeApp();

const db = admin.firestore();

async function findByDepartment() {
  try {
    // Get all users and search for the one with the specific department
    const usersRef = db.collection('users');
    const snapshot = await usersRef.get();
    
    console.log('Searching for users with department: YnKO7fGMSRuMMrsWOZyC');
    
    snapshot.docs.forEach(doc => {
      const userData = doc.data();
      const department = userData.department;
      
      if (department === 'YnKO7fGMSRuMMrsWOZyC') {
        console.log('Found user with matching department:');
        console.log('  ID:', doc.id);
        console.log('  Email:', userData.email);
        console.log('  Name:', userData.firstName, userData.lastName);
        console.log('  Role:', userData.role);
        console.log('  SecurityLevel:', userData.securityLevel);
        console.log('  Department:', userData.department);
        console.log('  TenantId:', userData.tenantId);
        console.log('  TenantIds:', userData.tenantIds);
        console.log('  InviteStatus:', userData.inviteStatus);
        console.log('  InviteSentAt:', userData.inviteSentAt);
        console.log('---');
      }
    });
    
    // Also check what department this ID refers to
    console.log('\nChecking department details...');
    try {
      const deptDoc = await db.collection('departments').doc('YnKO7fGMSRuMMrsWOZyC').get();
      if (deptDoc.exists) {
        const deptData = deptDoc.data();
        console.log('Department data:');
        console.log('  Name:', deptData.name);
        console.log('  TenantId:', deptData.tenantId);
        console.log('  Type:', deptData.type);
        console.log('---');
      } else {
        console.log('Department not found');
      }
    } catch (error) {
      console.log('Error checking department:', error.message);
    }
    
  } catch (error) {
    console.error('Error finding by department:', error);
  }
}

// Run the search
findByDepartment().then(() => {
  console.log('Search completed');
  process.exit(0);
}).catch((error) => {
  console.error('Search failed:', error);
  process.exit(1);
}); 
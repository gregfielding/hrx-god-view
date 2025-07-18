const admin = require('firebase-admin');

// Initialize Firebase Admin with default credentials
admin.initializeApp();

const db = admin.firestore();

async function findAndFixUser() {
  try {
    // Find the user by email
    const email = 'g.fielding@c1staffing.com';
    const usersRef = db.collection('users');
    const q = usersRef.where('email', '==', email);
    const snapshot = await q.get();
    
    if (snapshot.empty) {
      console.log('No user found with email:', email);
      return;
    }
    
    const userDoc = snapshot.docs[0];
    const userData = userDoc.data();
    const userId = userDoc.id;
    
    console.log('Found user:', userId);
    console.log('Current user data:', userData);
    
    // Check if tenantIds map already exists
    if (userData.tenantIds && typeof userData.tenantIds === 'object' && !Array.isArray(userData.tenantIds)) {
      console.log('User already has proper tenantIds map structure');
      return;
    }
    
    // Get the department ID
    const departmentId = userData.department;
    if (!departmentId) {
      console.log('No department found for user');
      return;
    }
    
    console.log('Department ID:', departmentId);
    
    // Search for this department in all tenant subcollections
    console.log('Searching for department in tenant subcollections...');
    
    const tenantsRef = db.collection('tenants');
    const tenantsSnapshot = await tenantsRef.get();
    
    let foundTenantId = null;
    
    for (const tenantDoc of tenantsSnapshot.docs) {
      const tenantId = tenantDoc.id;
      try {
        const deptDoc = await db.collection('tenants').doc(tenantId).collection('departments').doc(departmentId).get();
        if (deptDoc.exists) {
          foundTenantId = tenantId;
          console.log('Found department in tenant:', tenantId);
          break;
        }
      } catch (error) {
        // Continue searching
      }
    }
    
    if (!foundTenantId) {
      console.log('Could not find department in any tenant');
      return;
    }
    
    console.log('Found tenantId:', foundTenantId);
    
    // Create the proper tenantIds map structure
    const tenantIdsMap = {
      [foundTenantId]: {
        role: userData.role || 'Tenant',
        securityLevel: userData.securityLevel || 'Worker',
        locationIds: userData.locationIds || [],
        department: userData.department || null,
        addedAt: admin.firestore.FieldValue.serverTimestamp()
      }
    };
    
    // Update the user document
    const updateData = {
      tenantId: foundTenantId,
      tenantIds: tenantIdsMap,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    console.log('Updating user with:', updateData);
    
    await usersRef.doc(userId).update(updateData);
    
    console.log('Successfully updated user with proper tenantIds structure');
    
  } catch (error) {
    console.error('Error fixing worker tenantIds:', error);
  }
}

// Run the fix
findAndFixUser().then(() => {
  console.log('Fix completed');
  process.exit(0);
}).catch((error) => {
  console.error('Fix failed:', error);
  process.exit(1);
}); 
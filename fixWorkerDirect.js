const admin = require('firebase-admin');

// Initialize Firebase Admin with default credentials
admin.initializeApp();

const db = admin.firestore();

async function fixWorkerDirect() {
  try {
    // Find the worker that was created without proper tenantIds structure
    const email = 'g.fielding@c1staffing.com';
    
    // Get user by email
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
    
    // Get the tenant ID from the department
    const departmentId = userData.department;
    if (!departmentId) {
      console.log('No department found for user');
      return;
    }
    
    // Find the tenant that owns this department
    const departmentsRef = db.collection('departments');
    const deptQuery = departmentsRef.where('__name__', '==', departmentId);
    const deptSnapshot = await deptQuery.get();
    
    if (deptSnapshot.empty) {
      console.log('Department not found:', departmentId);
      return;
    }
    
    const deptData = deptSnapshot.docs[0].data();
    const tenantId = deptData.tenantId;
    
    if (!tenantId) {
      console.log('No tenantId found in department');
      return;
    }
    
    console.log('Found tenantId:', tenantId);
    
    // Create the proper tenantIds map structure
    const tenantIdsMap = {
      [tenantId]: {
        role: userData.role || 'Tenant',
        securityLevel: userData.securityLevel || 'Worker',
        locationIds: userData.locationIds || [],
        department: userData.department || null,
        addedAt: admin.firestore.FieldValue.serverTimestamp()
      }
    };
    
    // Update the user document
    const updateData = {
      tenantId: tenantId,
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
fixWorkerDirect().then(() => {
  console.log('Fix completed');
  process.exit(0);
}).catch((error) => {
  console.error('Fix failed:', error);
  process.exit(1);
}); 
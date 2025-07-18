import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

const db = admin.firestore();

export const fixWorkerTenantIds = onCall(async (request) => {
  try {
    // Find the worker that was created without proper tenantIds structure
    const email = 'g.fielding@c1staffing.com';
    
    // Get user by email
    const usersRef = db.collection('users');
    const q = usersRef.where('email', '==', email);
    const snapshot = await q.get();
    
    if (snapshot.empty) {
      return { success: false, message: 'No user found with email: ' + email };
    }
    
    const userDoc = snapshot.docs[0];
    const userData = userDoc.data();
    const userId = userDoc.id;
    
    console.log('Found user:', userId);
    console.log('Current user data:', userData);
    
    // Check if tenantIds map already exists
    if (userData.tenantIds && typeof userData.tenantIds === 'object' && !Array.isArray(userData.tenantIds)) {
      return { success: true, message: 'User already has proper tenantIds map structure' };
    }
    
    // Get the tenant ID from the department
    const departmentId = userData.department;
    if (!departmentId) {
      return { success: false, message: 'No department found for user' };
    }
    
    // Find the tenant that owns this department
    const departmentsRef = db.collection('departments');
    const deptQuery = departmentsRef.where('__name__', '==', departmentId);
    const deptSnapshot = await deptQuery.get();
    
    if (deptSnapshot.empty) {
      return { success: false, message: 'Department not found: ' + departmentId };
    }
    
    const deptData = deptSnapshot.docs[0].data();
    const tenantId = deptData.tenantId;
    
    if (!tenantId) {
      return { success: false, message: 'No tenantId found in department' };
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
    
    return { 
      success: true, 
      message: 'Successfully updated user with proper tenantIds structure',
      userId: userId,
      tenantId: tenantId
    };
    
  } catch (error: any) {
    console.error('Error fixing worker tenantIds:', error);
    return { success: false, error: error.message };
  }
}); 
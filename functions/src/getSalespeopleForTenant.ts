import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

export const getSalespeopleForTenant = onCall(async (request) => {
  try {
    // Check if user is authenticated
    if (!request.auth) {
      throw new Error('User must be authenticated');
    }

    const { tenantId } = request.data;
    if (!tenantId) {
      throw new Error('tenantId is required');
    }

    // Get the user's document to check permissions
    const userDoc = await admin.firestore().collection('users').doc(request.auth.uid).get();
    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    const userData = userDoc.data();
    if (!userData) {
      throw new Error('User data not found');
    }

    // Check if user has access to this tenant
    const hasTenantAccess = userData.tenantIds && userData.tenantIds[tenantId];
    if (!hasTenantAccess) {
      throw new Error('User does not have access to this tenant');
    }

    // Use the same approach as TenantWorkforce.tsx - get all users for the tenant
    // and then filter for crm_sales: true
    const usersSnapshot = await admin.firestore()
      .collection('users')
      .get();

    console.log(`🔍 Total users in database: ${usersSnapshot.docs.length}`);

    const allUsers = usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // Filter for users in this tenant (same logic as TenantWorkforce)
    const usersInTenant = allUsers.filter((user: any) => {
      // Check if user has access to this tenant
      return user.tenantIds && user.tenantIds[tenantId];
    });
    
    console.log(`🏢 Users in tenant ${tenantId}: ${usersInTenant.length}`);
    
    // Filter for users with crm_sales: true
    const salespeople = usersInTenant
      .filter((user: any) => user.crm_sales === true)
      .map((user: any) => ({
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        jobTitle: user.jobTitle,
        crm_sales: user.crm_sales
      }));

    console.log(`✅ Salespeople with crm_sales: true: ${salespeople.length}`);
    console.log('📋 Salespeople:', salespeople.map(sp => ({ id: sp.id, name: `${sp.firstName} ${sp.lastName}`, email: sp.email })));

    return { salespeople };
  } catch (error) {
    console.error('Error in getSalespeopleForTenant:', error);
    throw new Error('Failed to get salespeople');
  }
}); 
import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

export const fixPendingUser = onCall(async (request) => {
  try {
    // Check if user is authenticated
    if (!request.auth) {
      throw new Error('User must be authenticated');
    }

    const { email, tenantId } = request.data;
    if (!email || !tenantId) {
      throw new Error('email and tenantId are required');
    }

    console.log('🔍 Fixing pending user status for:', email, 'in tenant:', tenantId);

    // Find the user by email
    const usersSnapshot = await admin.firestore()
      .collection('users')
      .where('email', '==', email)
      .get();

    if (usersSnapshot.empty) {
      throw new Error(`User not found with email: ${email}`);
    }

    const userDoc = usersSnapshot.docs[0];
    const userData = userDoc.data();

    console.log('✅ Found user:', {
      id: userDoc.id,
      email: userData.email,
      firstName: userData.firstName,
      lastName: userData.lastName,
      inviteStatus: userData.inviteStatus,
      tenantIds: userData.tenantIds
    });

    // Update the user to remove inviteStatus and ensure they're active
    const updates: any = {
      inviteStatus: null, // Remove the pending status
      crm_sales: true, // Enable CRM sales access
    };

    // Ensure they have proper tenant access
    if (userData.tenantIds) {
      updates.tenantIds = {
        ...userData.tenantIds,
        [tenantId]: {
          ...userData.tenantIds[tenantId],
          status: 'active',
          role: 'Tenant',
          securityLevel: 7
        }
      };
    } else {
      updates.tenantIds = {
        [tenantId]: {
          status: 'active',
          role: 'Tenant',
          securityLevel: 7
        }
      };
    }

    console.log('📝 Updating user with:', updates);

    await admin.firestore().collection('users').doc(userDoc.id).update(updates);

    console.log('✅ User updated successfully!');

    return { 
      success: true, 
      message: 'User status updated successfully',
      userId: userDoc.id 
    };

  } catch (error) {
    console.error('❌ Error fixing user:', error);
    throw new Error(`Failed to fix user: ${error}`);
  }
}); 
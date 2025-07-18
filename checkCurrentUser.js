const admin = require('firebase-admin');

// Initialize Firebase Admin with default credentials
admin.initializeApp();

const db = admin.firestore();

async function checkCurrentUser() {
  try {
    const userId = 'TWXMM1mOJHepmk80Qsx128w9AiS2';
    
    // Get user document
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      console.log('User not found');
      return;
    }
    
    const userData = userDoc.data();
    console.log('Current user data:', {
      role: userData.role,
      securityLevel: userData.securityLevel,
      activeTenantId: userData.activeTenantId,
      orgType: userData.orgType,
      tenantIds: userData.tenantIds
    });
    
    // Check what tenant data exists for the active tenant
    if (userData.activeTenantId) {
      console.log('\nActive tenant ID:', userData.activeTenantId);
      
      if (userData.tenantIds && userData.tenantIds[userData.activeTenantId]) {
        console.log('Active tenant data:', userData.tenantIds[userData.activeTenantId]);
      } else {
        console.log('No tenant data found for active tenant ID');
      }
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

checkCurrentUser(); 
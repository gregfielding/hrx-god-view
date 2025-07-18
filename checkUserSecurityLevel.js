const admin = require('firebase-admin');

// Initialize Firebase Admin with default credentials
admin.initializeApp();

const db = admin.firestore();

async function checkUserSecurityLevel() {
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
      tenantIds: userData.tenantIds
    });
    
    // Check the HRX tenant entry specifically
    if (userData.tenantIds && userData.tenantIds['TgDJ4sIaC7x2n5cPs3rW']) {
      console.log('HRX tenant entry:', userData.tenantIds['TgDJ4sIaC7x2n5cPs3rW']);
    }
    
    // Fix the HRX tenant entry to have Admin security level
    const tenantIds = userData.tenantIds || {};
    
    if (tenantIds['TgDJ4sIaC7x2n5cPs3rW']) {
      tenantIds['TgDJ4sIaC7x2n5cPs3rW'] = {
        ...tenantIds['TgDJ4sIaC7x2n5cPs3rW'],
        role: 'HRX',
        securityLevel: 'Admin'
      };
      
      // Update the user document
      await userRef.update({
        tenantIds: tenantIds,
        role: 'HRX',
        securityLevel: 'Admin'
      });
      
      console.log('Updated user security level to Admin for HRX tenant');
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

checkUserSecurityLevel(); 
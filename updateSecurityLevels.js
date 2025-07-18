const admin = require('firebase-admin');

// Initialize Firebase Admin with default credentials
admin.initializeApp();

const db = admin.firestore();

async function updateSecurityLevels() {
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
    
    // Update the tenantIds map with numeric security levels
    const tenantIds = userData.tenantIds || {};
    
    // Update HRX tenant (TgDJ4sIaC7x2n5cPs3rW)
    if (tenantIds['TgDJ4sIaC7x2n5cPs3rW']) {
      tenantIds['TgDJ4sIaC7x2n5cPs3rW'] = {
        ...tenantIds['TgDJ4sIaC7x2n5cPs3rW'],
        securityLevel: '5' // Admin
      };
    }
    
    // Update C1 Staffing tenant (BCiP2bQ9CgVOCTfV6MhD)
    if (tenantIds['BCiP2bQ9CgVOCTfV6MhD']) {
      tenantIds['BCiP2bQ9CgVOCTfV6MhD'] = {
        ...tenantIds['BCiP2bQ9CgVOCTfV6MhD'],
        securityLevel: '5' // Admin
      };
    }
    
    // Update the user document
    await userRef.update({
      tenantIds: tenantIds,
      securityLevel: '5' // Update main security level to Admin
    });
    
    console.log('Updated security levels to numeric values');
    console.log('New tenantIds:', tenantIds);
    
  } catch (error) {
    console.error('Error updating security levels:', error);
  }
}

updateSecurityLevels(); 
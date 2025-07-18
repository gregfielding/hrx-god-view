const admin = require('firebase-admin');

// Initialize Firebase Admin with default credentials
admin.initializeApp();

const db = admin.firestore();

async function fixUserSecurityLevel() {
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
    console.log('Current user data:', userData);
    
    // Fix the tenantIds map
    const tenantIds = userData.tenantIds || {};
    
    // Fix the HRX tenant entry
    if (tenantIds['TgDJ4sIaC7x2n5cPs3rW']) {
      tenantIds['TgDJ4sIaC7x2n5cPs3rW'] = {
        ...tenantIds['TgDJ4sIaC7x2n5cPs3rW'],
        securityLevel: 'Admin'  // Fix this from 'HRX' to 'Admin'
      };
    }
    
    // Update the user document
    await userRef.update({
      tenantIds: tenantIds
    });
    
    console.log('User security level fixed successfully');
    console.log('Updated tenantIds:', tenantIds);
    
  } catch (error) {
    console.error('Error fixing user security level:', error);
  }
}

fixUserSecurityLevel(); 
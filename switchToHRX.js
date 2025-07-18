const admin = require('firebase-admin');

// Initialize Firebase Admin with default credentials
admin.initializeApp();

const db = admin.firestore();

async function switchToHRX() {
  try {
    const userId = 'TWXMM1mOJHepmk80Qsx128w9AiS2';
    const hrxTenantId = 'TgDJ4sIaC7x2n5cPs3rW';
    
    // Get user document
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      console.log('User not found');
      return;
    }
    
    const userData = userDoc.data();
    console.log('Current activeTenantId:', userData.activeTenantId);
    
    // Switch to HRX tenant
    await userRef.update({
      activeTenantId: hrxTenantId
    });
    
    console.log('Switched active tenant to HRX');
    console.log('New activeTenantId:', hrxTenantId);
    
  } catch (error) {
    console.error('Error:', error);
  }
}

switchToHRX(); 
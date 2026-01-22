/**
 * Browser Console Script to Archive All CRM Deals
 * 
 * Instructions:
 * 1. Open your browser and navigate to the CRM page (while logged in)
 * 2. Open the browser console (F12 or Cmd+Option+I)
 * 3. Copy and paste this entire script into the console
 * 4. Press Enter to run
 * 
 * The script will archive all existing deals for the current tenant.
 */

(async function() {
  try {
    const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js');
    const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
    const { getApp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
    
    // Get the Firebase app instance (assuming it's already initialized)
    const app = getApp();
    const functions = getFunctions(app, 'us-central1');
    const auth = getAuth(app);
    
    // Get current user
    const user = auth.currentUser;
    if (!user) {
      throw new Error('You must be logged in to run this script');
    }
    
    // Get tenantId from the current page context or use default
    // You can also manually set it: const tenantId = 'BCiP2bQ9CgVOCTfV6MhD';
    const tenantId = window.activeTenantId || 'BCiP2bQ9CgVOCTfV6MhD';
    
    console.log(`🚀 Starting archive of all CRM deals for tenant: ${tenantId}\n`);
    
    const archiveAllCrmDeals = httpsCallable(functions, 'archiveAllCrmDeals');
    const result = await archiveAllCrmDeals({ tenantId });
    
    console.log('\n✅ Archive Complete!');
    console.log('Result:', result.data);
    
  } catch (error) {
    console.error('❌ Error:', error);
    
    // Fallback: Use the Firebase instance from the app
    try {
      const { functions } = await import('../src/firebase');
      const { httpsCallable } = await import('firebase/functions');
      
      const tenantId = window.activeTenantId || 'BCiP2bQ9CgVOCTfV6MhD';
      console.log(`🚀 Starting archive (fallback method) for tenant: ${tenantId}\n`);
      
      const archiveAllCrmDeals = httpsCallable(functions, 'archiveAllCrmDeals');
      const result = await archiveAllCrmDeals({ tenantId });
      
      console.log('\n✅ Archive Complete!');
      console.log('Result:', result.data);
    } catch (fallbackError) {
      console.error('❌ Fallback also failed:', fallbackError);
      console.log('\n💡 Alternative: Run this in the browser console on the CRM page:');
      console.log(`
        const { getFunctions, httpsCallable } = require('firebase/functions');
        const { functions } = require('./src/firebase');
        const archiveAllCrmDeals = httpsCallable(functions, 'archiveAllCrmDeals');
        archiveAllCrmDeals({ tenantId: 'BCiP2bQ9CgVOCTfV6MhD' }).then(r => console.log(r.data));
      `);
    }
  }
})();

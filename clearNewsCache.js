const admin = require('firebase-admin');

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

async function clearNewsCache() {
  try {
    console.log('🗑️ Clearing news cache for Parker Plastics...\n');

    const tenantId = 'test-tenant-id';
    const companyId = 'test-parker-plastics-id';

    // Delete the cached news document
    const newsRef = db.collection('tenants').doc(tenantId).collection('crm_companies').doc(companyId).collection('newsArticles').doc('latest');
    
    const newsDoc = await newsRef.get();
    if (newsDoc.exists) {
      await newsRef.delete();
      console.log('✅ Cached news data deleted');
    } else {
      console.log('ℹ️ No cached news data found');
    }

    console.log('✅ Cache cleared successfully!');
    console.log('\n💡 Now test the function again to trigger fresh API calls');

  } catch (error) {
    console.error('❌ Error clearing cache:', error);
  }
}

clearNewsCache(); 
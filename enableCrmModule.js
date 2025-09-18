const { initializeApp } = require('firebase/app');
const { getFirestore, doc, setDoc } = require('firebase/firestore');

// Your Firebase config
const firebaseConfig = {
  apiKey: 'AIzaSyBQA9bc25_7ncjvY75nAtIUv47C3w5jl6c',
  authDomain: 'hrx1-d3beb.firebaseapp.com',
  projectId: 'hrx1-d3beb',
  storageBucket: 'hrx1-d3beb.firebasestorage.app',
  messagingSenderId: '143752240496',
  appId: '1:143752240496:web:e0b584983d4b04cb3983b5',
  measurementId: 'G-LL20QKNT0W',
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function enableCrmModule(tenantId) {
  try {
    console.log(`🔧 Enabling CRM module for tenant: ${tenantId}`);
    
    // Enable the CRM module
    await setDoc(doc(db, 'tenants', tenantId, 'modules', 'hrx-crm'), {
      isEnabled: true,
      enabledAt: new Date(),
      enabledBy: 'admin',
      version: '1.0.0',
      settings: {
        enableContactManagement: true,
        enablePipelineTracking: true,
        enableDealManagement: true,
        enableTaskManagement: true,
        dataRetentionDays: 1825,
      },
      customSettings: {
        isEnabled: true,
        lastUpdated: new Date().toISOString()
      }
    });
    
    console.log('✅ CRM module enabled successfully!');
    console.log('🎯 Your sales team should now see CRM menu items including:');
    console.log('   - CRM Dashboard');
    console.log('   - Contacts');
    console.log('   - Companies');
    console.log('   - Deals');
    console.log('   - Tasks');
    console.log('   - Reports');
    console.log('\n📋 Note: Users need appropriate security levels (4+) to access CRM features.');
    
  } catch (error) {
    console.error('❌ Error enabling CRM module:', error);
  }
}

// Enable CRM module for C1 Staffing tenant
enableCrmModule('BCiP2bQ9CgVOCTfV6MhD');

module.exports = { enableCrmModule };

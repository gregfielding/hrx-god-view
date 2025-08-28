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

async function enableRecruiterModule(tenantId) {
  try {
    console.log(`Enabling recruiter module for tenant: ${tenantId}`);
    
    // Enable the recruiter module
    await setDoc(doc(db, 'tenants', tenantId, 'modules', 'hrx-recruiter'), {
      status: true,
      enabledAt: new Date(),
      enabledBy: 'system',
      version: '1.0.0',
      features: {
        jobOrders: true,
        candidates: true,
        applications: true,
        pipeline: true,
        jobsBoard: true,
        aiScoring: true,
        duplicateDetection: true,
      }
    });
    
    console.log('✅ Recruiter module enabled successfully!');
    console.log('You should now see the "Recruiter" menu item in the navigation.');
    
  } catch (error) {
    console.error('❌ Error enabling recruiter module:', error);
  }
}

// Usage: Replace 'your-tenant-id' with your actual tenant ID
// enableRecruiterModule('your-tenant-id');

module.exports = { enableRecruiterModule };

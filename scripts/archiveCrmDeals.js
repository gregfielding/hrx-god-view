const { initializeApp } = require('firebase/app');
const { getFunctions, httpsCallable, connectFunctionsEmulator } = require('firebase/functions');
const { getAuth, signInWithEmailAndPassword } = require('firebase/auth');

// Initialize Firebase (using the same config as the app)
const firebaseConfig = {
  apiKey: 'AIzaSyBQA9bc25_7ncjvY75nAtIUv47C3w5jl6c',
  authDomain: 'hrx1-d3beb.firebaseapp.com',
  projectId: 'hrx1-d3beb',
  storageBucket: 'hrx1-d3beb.firebasestorage.app',
  messagingSenderId: '143752240496',
  appId: '1:143752240496:web:e0b584983d4b04cb3983b5',
  measurementId: 'G-LL20QKNT0W',
};

const app = initializeApp(firebaseConfig);
const functions = getFunctions(app, 'us-central1');
const auth = getAuth(app);

// Get tenantId and credentials from command line arguments
const tenantId = process.argv[2] || 'BCiP2bQ9CgVOCTfV6MhD';
const email = process.argv[3] || process.env.FIREBASE_EMAIL;
const password = process.argv[4] || process.env.FIREBASE_PASSWORD;

async function runArchive() {
  try {
    // Authenticate if credentials provided
    if (email && password) {
      console.log('🔐 Authenticating...');
      await signInWithEmailAndPassword(auth, email, password);
      console.log('✅ Authenticated\n');
    }

    const archiveAllCrmDeals = httpsCallable(functions, 'archiveAllCrmDeals');
    
    console.log(`🚀 Archiving all CRM deals for tenant: ${tenantId}\n`);

    const result = await archiveAllCrmDeals({ tenantId });
    
    console.log('\n✅ Archive Complete!');
    console.log(JSON.stringify(result.data, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message || err);
    if (err.details) {
      console.error('Details:', err.details);
    }
    process.exit(1);
  }
}

runArchive();

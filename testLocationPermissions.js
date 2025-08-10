const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc } = require('firebase/firestore');
const { getAuth, signInWithEmailAndPassword } = require('firebase/auth');

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBqXqXqXqXqXqXqXqXqXqXqXqXqXqXqXq",
  authDomain: "hrx1-d3beb.firebaseapp.com",
  projectId: "hrx1-d3beb",
  storageBucket: "hrx1-d3beb.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef123456"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

async function testLocationPermissions() {
  try {
    // Sign in with a test user (you'll need to provide actual credentials)
    console.log('🔐 Signing in...');
    const userCredential = await signInWithEmailAndPassword(auth, 'test@example.com', 'password');
    const user = userCredential.user;
    console.log('✅ Signed in as:', user.email);

    // Test location access
    const tenantId = 'your-tenant-id'; // Replace with actual tenant ID
    const companyId = 'your-company-id'; // Replace with actual company ID
    const locationId = 'nFVWtAknhsCxihFfER8Y'; // The failing location ID

    console.log(`🔍 Testing location access for: ${locationId}`);
    console.log(`📍 Path: tenants/${tenantId}/crm_companies/${companyId}/locations/${locationId}`);

    // Try to access the location
    const locationRef = doc(db, `tenants/${tenantId}/crm_companies/${companyId}/locations`, locationId);
    const locationDoc = await getDoc(locationRef);

    if (locationDoc.exists()) {
      console.log('✅ Location found:', locationDoc.data());
    } else {
      console.log('❌ Location not found');
    }

  } catch (error) {
    console.error('❌ Error testing location permissions:', error);
    console.log('🔍 Error details:', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
  }
}

// Run the test
testLocationPermissions();

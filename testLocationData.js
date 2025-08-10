const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc } = require('firebase/firestore');

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

async function testLocationData() {
  try {
    // Test with a specific deal ID (you'll need to replace with an actual deal ID)
    const tenantId = 'your-tenant-id'; // Replace with actual tenant ID
    const dealId = 'your-deal-id'; // Replace with actual deal ID
    
    console.log(`🔍 Testing location data for deal: ${dealId} in tenant: ${tenantId}`);
    
    // Get the deal document to see its associations
    const dealRef = doc(db, `tenants/${tenantId}/crm_deals`, dealId);
    const dealDoc = await getDoc(dealRef);
    
    if (!dealDoc.exists()) {
      console.log('❌ Deal not found');
      return;
    }
    
    const dealData = dealDoc.data();
    console.log('📄 Deal data:', dealData);
    
    if (dealData.associations) {
      console.log('🔗 Associations:', dealData.associations);
      
      if (dealData.associations.locations) {
        console.log('📍 Locations in associations:', dealData.associations.locations);
        
        // Check each location
        for (const location of dealData.associations.locations) {
          console.log('🔍 Location:', location);
          
          if (typeof location === 'string') {
            console.log(`📍 Location ID: ${location}`);
          } else if (typeof location === 'object') {
            console.log(`📍 Location object:`, location);
          }
        }
      } else {
        console.log('❌ No locations in associations');
      }
    } else {
      console.log('❌ No associations field found');
    }
    
  } catch (error) {
    console.error('❌ Error testing location data:', error);
  }
}

// Run the test
testLocationData();

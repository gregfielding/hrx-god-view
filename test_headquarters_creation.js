const { initializeApp } = require('firebase/app');
const { getFunctions, httpsCallable } = require('firebase/functions');

// Firebase config (you'll need to add your config here)
const firebaseConfig = {
  // Add your Firebase config here
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const functions = getFunctions(app, 'us-central1');

/**
 * Test headquarters location creation
 */
async function testHeadquartersCreation() {
  try {
    console.log('🔍 Testing headquarters location creation...');
    
    // Example Apollo headquarters data
    const headquartersData = {
      street_address: '123 Main Street',
      city: 'Westmount',
      state: 'Quebec',
      postal_code: 'H3Z 1A1',
      country: 'Canada'
    };
    
    // Test parameters (you'll need to update these)
    const testParams = {
      tenantId: 'your-tenant-id', // Replace with actual tenant ID
      companyId: 'your-company-id', // Replace with actual company ID (e.g., Dorel Home)
      companyName: 'Dorel Home',
      headquartersData: headquartersData
    };
    
    console.log('📋 Test parameters:', testParams);
    
    // Call the function
    const createHeadquartersLocation = httpsCallable(functions, 'createHeadquartersLocation');
    const result = await createHeadquartersLocation(testParams);
    
    console.log('✅ Function call successful!');
    console.log('📊 Result:', result.data);
    
  } catch (error) {
    console.error('❌ Error testing headquarters creation:', error);
    console.error('Error details:', error.message);
  }
}

/**
 * Get Apollo data from a company to test with real data
 */
async function getCompanyApolloData(tenantId, companyId) {
  try {
    console.log('🔍 Getting company Apollo data...');
    
    // You can call the getFirmographics function to get Apollo data
    const getFirmographics = httpsCallable(functions, 'getFirmographics');
    const result = await getFirmographics({ tenantId, companyId });
    
    console.log('📊 Apollo data:', result.data);
    
    if (result.data?.firmographics?.apollo?.headquarters) {
      console.log('✅ Found headquarters data:', result.data.firmographics.apollo.headquarters);
      return result.data.firmographics.apollo.headquarters;
    } else {
      console.log('❌ No headquarters data found in Apollo response');
      return null;
    }
    
  } catch (error) {
    console.error('❌ Error getting Apollo data:', error);
    return null;
  }
}

// Instructions for use
console.log(`
🚀 HEADQUARTERS LOCATION CREATION TEST

To use this script:

1. Add your Firebase config to the firebaseConfig object
2. Update the testParams with your actual tenantId and companyId
3. Run: node test_headquarters_creation.js

Example usage:
- tenantId: 'your-tenant-id'
- companyId: 'dorel-home-company-id' (from Firestore)

The script will:
1. Test headquarters creation with sample data
2. Optionally get real Apollo data from a company
3. Show you the results

Make sure you have the required Firebase dependencies installed:
npm install firebase
`);

// Uncomment the line below to run the test
// testHeadquartersCreation();

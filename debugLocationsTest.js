const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc, collection, getDocs } = require('firebase/firestore');

const firebaseConfig = {
  apiKey: "AIzaSyBxJjOWL6X3uXq_xXBUO7NUfXssRbAqwt8",
  authDomain: "hrx1-d3beb.firebaseapp.com",
  projectId: "hrx1-d3beb",
  storageBucket: "hrx1-d3beb.appspot.com",
  messagingSenderId: "1097123456789",
  appId: "1:1097123456789:web:abcdef123456"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function testLocationsLoading() {
  try {
    const tenantId = 'TWXMM1mOJHepmk80Qsx128w9AiS2';
    
    console.log('🔍 Testing locations loading...');
    
    // 1. Find Parker Plastics company
    console.log('\n1. Finding Parker Plastics company...');
    const companiesRef = collection(db, `tenants/${tenantId}/crm_companies`);
    const companiesSnap = await getDocs(companiesRef);
    
    let parkerPlasticsId = null;
    for (const companyDoc of companiesSnap.docs) {
      const companyData = companyDoc.data();
      console.log(`Company: ${companyData.companyName || companyData.name} (${companyDoc.id})`);
      if (companyData.companyName && companyData.companyName.includes('Parker Plastics')) {
        parkerPlasticsId = companyDoc.id;
        console.log(`✅ Found Parker Plastics: ${companyDoc.id}`);
        break;
      }
    }
    
    if (!parkerPlasticsId) {
      console.log('❌ Parker Plastics not found');
      return;
    }
    
    // 2. Check locations for Parker Plastics
    console.log('\n2. Checking locations for Parker Plastics...');
    const locationsRef = collection(db, `tenants/${tenantId}/crm_companies/${parkerPlasticsId}/locations`);
    const locationsSnap = await getDocs(locationsRef);
    
    console.log(`✅ Found ${locationsSnap.docs.length} locations for Parker Plastics:`);
    locationsSnap.docs.forEach(locDoc => {
      const locData = locDoc.data();
      console.log(`  - ${locData.name} (${locDoc.id}): ${locData.address}, ${locData.city}, ${locData.state}`);
    });
    
    // 3. Find a deal for Parker Plastics
    console.log('\n3. Finding deals for Parker Plastics...');
    const dealsRef = collection(db, `tenants/${tenantId}/crm_deals`);
    const dealsSnap = await getDocs(dealsRef);
    
    let dealId = null;
    for (const dealDoc of dealsSnap.docs) {
      const dealData = dealDoc.data();
      if (dealData.companyId === parkerPlasticsId && dealData.name && dealData.name.includes('Parker Plastics')) {
        dealId = dealDoc.id;
        console.log(`✅ Found deal: ${dealData.name} (${dealDoc.id})`);
        console.log(`  CompanyId: ${dealData.companyId}`);
        console.log(`  LocationId: ${dealData.locationId}`);
        console.log(`  LocationName: ${dealData.locationName}`);
        break;
      }
    }
    
    if (!dealId) {
      console.log('❌ No Parker Plastics deal found');
      return;
    }
    
    console.log('\n✅ Test completed successfully!');
    console.log('The locations should now be available in the associations panel.');
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

testLocationsLoading(); 
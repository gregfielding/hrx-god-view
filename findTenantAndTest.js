const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, getDoc } = require('firebase/firestore');

// Firebase configuration
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

async function findTenants() {
  console.log('🔍 Finding all tenants...');
  
  try {
    const tenantsRef = collection(db, 'tenants');
    const snapshot = await getDocs(tenantsRef);
    
    console.log(`📊 Found ${snapshot.size} tenants:`);
    
    const tenants = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      tenants.push({
        id: doc.id,
        name: data.name || data.companyName || 'Unnamed Tenant',
        slug: data.slug || 'No slug'
      });
    });
    
    tenants.forEach((tenant, index) => {
      console.log(`${index + 1}. ${tenant.id} - ${tenant.name} (${tenant.slug})`);
    });
    
    return tenants;
    
  } catch (error) {
    console.error('❌ Error finding tenants:', error);
    return [];
  }
}

async function findCompanyInAllTenants(companyId) {
  console.log(`\n🎯 Searching for company ${companyId} across all tenants...`);
  
  try {
    const tenantsRef = collection(db, 'tenants');
    const tenantsSnapshot = await getDocs(tenantsRef);
    
    for (const tenantDoc of tenantsSnapshot.docs) {
      const tenantId = tenantDoc.id;
      console.log(`\n🔍 Checking tenant: ${tenantId}`);
      
      try {
        const companyRef = doc(db, 'tenants', tenantId, 'crm_companies', companyId);
        const companyDoc = await getDoc(companyRef);
        
        if (companyDoc.exists()) {
          const data = companyDoc.data();
          console.log('✅ Found company!');
          console.log('Tenant ID:', tenantId);
          console.log('Company Data:', {
            id: companyDoc.id,
            companyName: data.companyName || 'MISSING',
            companyUrl: data.companyUrl || 'MISSING',
            name: data.name || 'MISSING',
            website: data.website || 'MISSING',
            url: data.url || 'MISSING'
          });
          
          // Check if it matches the URL mentioned
          const url = data.companyUrl || data.website || data.url;
          if (url && url.includes('yforcelogistics.com')) {
            console.log('🎯 This is the company you mentioned!');
            console.log('URL matches: yforcelogistics.com');
          }
          
          return { tenantId, companyData: data };
        }
      } catch (error) {
        console.log(`❌ Error checking tenant ${tenantId}:`, error.message);
      }
    }
    
    console.log('❌ Company not found in any tenant');
    return null;
    
  } catch (error) {
    console.error('❌ Error searching for company:', error);
    return null;
  }
}

async function findCompaniesWithYforceUrl() {
  console.log('\n🔍 Searching for companies with yforcelogistics.com URL...');
  
  try {
    const tenantsRef = collection(db, 'tenants');
    const tenantsSnapshot = await getDocs(tenantsRef);
    
    const matches = [];
    
    for (const tenantDoc of tenantsSnapshot.docs) {
      const tenantId = tenantDoc.id;
      console.log(`\n🔍 Checking tenant: ${tenantId}`);
      
      try {
        const companiesRef = collection(db, 'tenants', tenantId, 'crm_companies');
        const companiesSnapshot = await getDocs(companiesRef);
        
        companiesSnapshot.forEach(companyDoc => {
          const data = companyDoc.data();
          const url = data.companyUrl || data.website || data.url;
          
          if (url && url.includes('yforcelogistics.com')) {
            console.log('✅ Found company with yforcelogistics.com URL!');
            console.log('Company ID:', companyDoc.id);
            console.log('Tenant ID:', tenantId);
            console.log('URL:', url);
            console.log('Company Name:', data.companyName || data.name || 'MISSING');
            
            matches.push({
              tenantId,
              companyId: companyDoc.id,
              companyData: data
            });
          }
        });
        
      } catch (error) {
        console.log(`❌ Error checking tenant ${tenantId}:`, error.message);
      }
    }
    
    if (matches.length === 0) {
      console.log('❌ No companies found with yforcelogistics.com URL');
    } else {
      console.log(`\n📊 Found ${matches.length} companies with yforcelogistics.com URL`);
    }
    
    return matches;
    
  } catch (error) {
    console.error('❌ Error searching for companies:', error);
    return [];
  }
}

async function main() {
  console.log('🔍 Tenant and Company Finder');
  console.log('============================\n');
  
  try {
    // Step 1: Find all tenants
    const tenants = await findTenants();
    
    // Step 2: Search for the specific company ID
    const companyId = 'Qb0Q42qtwEsPi9hUpimh';
    const foundCompany = await findCompanyInAllTenants(companyId);
    
    // Step 3: Search for companies with yforcelogistics.com URL
    const yforceMatches = await findCompaniesWithYforceUrl();
    
    // Summary
    console.log('\n📋 Summary:');
    console.log(`Total tenants: ${tenants.length}`);
    console.log(`Company ${companyId} found: ${foundCompany ? 'Yes' : 'No'}`);
    console.log(`Companies with yforcelogistics.com URL: ${yforceMatches.length}`);
    
    if (foundCompany) {
      console.log('\n💡 To run the extraction script, use:');
      console.log(`node extractCompanyInfoFromUrls.js ${foundCompany.tenantId} ${companyId} true`);
    } else if (yforceMatches.length > 0) {
      console.log('\n💡 Found companies with yforcelogistics.com URL. To run extraction:');
      yforceMatches.forEach(match => {
        console.log(`node extractCompanyInfoFromUrls.js ${match.tenantId} ${match.companyId} true`);
      });
    }
    
  } catch (error) {
    console.error('❌ Script failed:', error);
  }
}

// Run the script
main().catch(console.error); 
const { initializeApp } = require('firebase/app');
const { getFunctions, httpsCallable } = require('firebase/functions');

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBxJjowLbVWJ2wJjowLbVWJ2wJjowLbVWJ2w",
  authDomain: "hrx-god-view.firebaseapp.com",
  projectId: "hrx-god-view",
  storageBucket: "hrx-god-view.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef123456"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const functions = getFunctions(app);

async function testCompanyInfoExtraction() {
  try {
    console.log('🚀 Starting Company Info Extraction Test...');
    
    // Test with a specific tenant ID (you'll need to replace this with a real tenant ID)
    const tenantId = 'your-tenant-id-here'; // Replace with actual tenant ID
    
    // First, let's do a dry run to see what companies would be processed
    console.log('\n📋 Running DRY RUN to see what companies would be processed...');
    
    const extractCompanyInfo = httpsCallable(functions, 'extractCompanyInfoFromUrls');
    
    const dryRunResult = await extractCompanyInfo({
      tenantId: tenantId,
      dryRun: true,
      limit: 10
    });
    
    console.log('✅ Dry Run Results:');
    console.log(JSON.stringify(dryRunResult.data, null, 2));
    
    // Ask user if they want to proceed with actual processing
    console.log('\n❓ Do you want to proceed with actual processing? (This will update the database)');
    console.log('   Set dryRun: false in the script to proceed with actual updates.');
    
    // For now, we'll just show the dry run results
    // To actually process, change dryRun to false below
    
    /*
    console.log('\n🔄 Running ACTUAL PROCESSING...');
    
    const actualResult = await extractCompanyInfo({
      tenantId: tenantId,
      dryRun: false,
      limit: 5
    });
    
    console.log('✅ Actual Processing Results:');
    console.log(JSON.stringify(actualResult.data, null, 2));
    */
    
  } catch (error) {
    console.error('❌ Error testing company info extraction:', error);
    console.error('Error details:', error.message);
  }
}

// Test specific company mentioned by user
async function testSpecificCompany() {
  try {
    console.log('\n🎯 Testing specific company: Qb0Q42qtwEsPi9hUpimh with URL: https://yforcelogistics.com/');
    
    // This would be a direct test of the extraction logic
    // For now, we'll just show what the function would do
    
    const testUrl = 'https://yforcelogistics.com/';
    console.log('Test URL:', testUrl);
    
    // Extract domain info
    const urlObj = new URL(testUrl);
    const hostname = urlObj.hostname.toLowerCase();
    let companyName = hostname.replace(/^www\./, '').split('.')[0];
    companyName = companyName
      .replace(/[_-]/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase())
      .trim();
    
    console.log('Extracted company name from domain:', companyName);
    
    // Generate tags based on domain
    const tags = [];
    if (hostname.includes('logistics')) {
      tags.push('logistics', 'transportation', 'supply chain');
    }
    if (hostname.includes('force')) {
      tags.push('force', 'power', 'strength');
    }
    
    console.log('Generated tags:', tags);
    
    console.log('\n📝 Expected AI extraction would include:');
    console.log('- Company Name: YForce Logistics (or similar)');
    console.log('- Industry: Logistics and Transportation');
    console.log('- Description: Logistics and supply chain services company');
    console.log('- Tags: logistics, transportation, supply chain, force');
    console.log('- Additional info: address, phone, employee count, etc.');
    
  } catch (error) {
    console.error('❌ Error testing specific company:', error);
  }
}

// Run the tests
async function runTests() {
  console.log('🧪 Company Info Extraction Test Suite');
  console.log('=====================================\n');
  
  await testSpecificCompany();
  await testCompanyInfoExtraction();
  
  console.log('\n✅ Test suite completed!');
}

// Run the tests
runTests().catch(console.error); 
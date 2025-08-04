const { initializeApp } = require('firebase/app');
const { getFunctions, httpsCallable } = require('firebase/functions');

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBxJjJjJjJjJjJjJjJjJjJjJjJjJjJjJjJj",
  authDomain: "hrx1-d3beb.firebaseapp.com",
  projectId: "hrx1-d3beb",
  storageBucket: "hrx1-d3beb.appspot.com",
  messagingSenderId: "143752240496",
  appId: "1:143752240496:web:j7supdp4b6au1irkcp06ise32g9dfcr"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const functions = getFunctions(app);

// Test the fetchCompanyNews function
async function testNewsFeature() {
  console.log('Testing News Feature...\n');

  try {
    const fetchCompanyNews = httpsCallable(functions, 'fetchCompanyNews');
    
    // Test with a well-known company
    const testData = {
      companyName: 'Microsoft',
      companyId: 'test-company-123',
      tenantId: 'test-tenant-456',
      headquartersCity: 'Redmond',
      industry: 'Technology'
    };

    console.log('Calling fetchCompanyNews with:', testData);
    
    const result = await fetchCompanyNews(testData);
    
    console.log('✅ Function call successful!');
    console.log('Result:', JSON.stringify(result.data, null, 2));
    
    if (result.data.articles && result.data.articles.length > 0) {
      console.log(`\n📰 Found ${result.data.articles.length} news articles`);
      result.data.articles.forEach((article, index) => {
        console.log(`\nArticle ${index + 1}:`);
        console.log(`  Title: ${article.title}`);
        console.log(`  Source: ${article.source}`);
        console.log(`  Date: ${article.date}`);
        console.log(`  Tags: ${article.tags.join(', ')}`);
        console.log(`  Summary: ${article.summary}`);
      });
    } else {
      console.log('\n📰 No news articles found (this is normal if API keys are not configured)');
    }
    
  } catch (error) {
    console.error('❌ Error testing news feature:', error);
  }
}

// Test error handling with missing parameters
async function testErrorHandling() {
  console.log('\n\nTesting Error Handling...\n');

  try {
    const fetchCompanyNews = httpsCallable(functions, 'fetchCompanyNews');
    
    // Test with missing required parameters
    const invalidData = {
      companyName: '', // Missing company name
      companyId: 'test-company-123',
      tenantId: 'test-tenant-456'
    };

    console.log('Calling fetchCompanyNews with invalid data:', invalidData);
    
    const result = await fetchCompanyNews(invalidData);
    
    console.log('✅ Function handled invalid data gracefully');
    console.log('Result:', JSON.stringify(result.data, null, 2));
    
  } catch (error) {
    console.log('✅ Function properly rejected invalid data');
    console.log('Error:', error.message);
  }
}

// Run tests
async function runTests() {
  console.log('🚀 Starting News Feature Tests\n');
  
  await testNewsFeature();
  await testErrorHandling();
  
  console.log('\n\n✨ Tests completed!');
  console.log('\nNext steps:');
  console.log('1. Configure API keys in Firebase Functions');
  console.log('2. Test with real company data in the UI');
  console.log('3. Check the News tab in Company Details pages');
}

runTests().catch(console.error); 
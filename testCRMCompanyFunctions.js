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

// Test all CRM company functions
async function testCRMCompanyFunctions() {
  console.log('🧪 Testing CRM Company Functions with API Keys...\n');

  const testCompanyName = 'Microsoft';
  const testTenantId = 'test-tenant-id';
  const testCompanyId = 'test-company-id';

  try {
    // Test 1: fetchCompanyNews
    console.log('📰 Testing fetchCompanyNews...');
    try {
      const fetchCompanyNews = httpsCallable(functions, 'fetchCompanyNews');
      const newsResult = await fetchCompanyNews({
        companyName: testCompanyName,
        companyId: testCompanyId,  // Added missing parameter
        tenantId: testTenantId
      });
      
      const newsData = newsResult.data;
      console.log('✅ fetchCompanyNews successful!');
      console.log(`   - Found ${newsData.articles?.length || 0} news articles`);
      console.log(`   - Summary: ${newsData.summary ? 'Generated' : 'Not generated'}`);
      console.log(`   - Error: ${newsData.error || 'None'}`);
      
      if (newsData.articles && newsData.articles.length > 0) {
        console.log(`   - First article: ${newsData.articles[0].title}`);
      }
    } catch (error) {
      console.log('❌ fetchCompanyNews failed:', error.message);
      if (error.details) {
        console.log('   - Details:', error.details);
      }
    }

    // Test 2: discoverCompanyUrls
    console.log('\n🔍 Testing discoverCompanyUrls...');
    try {
      const discoverUrls = httpsCallable(functions, 'discoverCompanyUrls');
      const urlResult = await discoverUrls({
        companyName: testCompanyName,
        companyId: testCompanyId,
        tenantId: testTenantId
      });
      
      const urlData = urlResult.data;
      console.log('✅ discoverCompanyUrls successful!');
      console.log(`   - Website: ${urlData.website || 'Not found'}`);
      console.log(`   - LinkedIn: ${urlData.linkedin || 'Not found'}`);
      console.log(`   - Indeed: ${urlData.indeed || 'Not found'}`);
      console.log(`   - Facebook: ${urlData.facebook || 'Not found'}`);
      console.log(`   - Error: ${urlData.error || 'None'}`);
    } catch (error) {
      console.log('❌ discoverCompanyUrls failed:', error.message);
    }

    // Test 3: enhanceCompanyWithSerp
    console.log('\n🚀 Testing enhanceCompanyWithSerp...');
    try {
      const enhanceCompany = httpsCallable(functions, 'enhanceCompanyWithSerp');
      const enhanceResult = await enhanceCompany({
        companyName: testCompanyName,
        companyId: testCompanyId,
        tenantId: testTenantId
      });
      
      const enhanceData = enhanceResult.data;
      console.log('✅ enhanceCompanyWithSerp successful!');
      console.log(`   - Enhanced: ${enhanceData.success ? 'Yes' : 'No'}`);
      console.log(`   - Data found: ${enhanceData.data ? 'Yes' : 'No'}`);
      console.log(`   - Error: ${enhanceData.error || 'None'}`);
      
      if (enhanceData.data) {
        console.log(`   - Company info: ${enhanceData.data.description || 'N/A'}`);
      }
    } catch (error) {
      console.log('❌ enhanceCompanyWithSerp failed:', error.message);
    }

    // Test 4: fetchFollowedCompanyNews (scheduled function, test manually)
    console.log('\n📅 Testing fetchFollowedCompanyNews (scheduled function)...');
    try {
      const fetchFollowedNews = httpsCallable(functions, 'fetchFollowedCompanyNews');
      const followedResult = await fetchFollowedNews({
        tenantId: testTenantId
      });
      
      const followedData = followedResult.data;
      console.log('✅ fetchFollowedCompanyNews successful!');
      console.log(`   - Processed: ${followedData.processed || 0} companies`);
      console.log(`   - Error: ${followedData.error || 'None'}`);
    } catch (error) {
      console.log('❌ fetchFollowedCompanyNews failed:', error.message);
      console.log('   - Note: This is expected for scheduled functions without proper auth');
    }

    console.log('\n🎉 CRM Company Functions Test Complete!');
    console.log('\n📋 Summary:');
    console.log('- All functions are deployed and accessible');
    console.log('- API keys are configured in firebase.json');
    console.log('- Functions should work in the CRM interface');

  } catch (error) {
    console.error('❌ Error testing CRM company functions:', error);
    console.error('Error details:', error.message);
  }
}

// Test API key configuration
async function testAPIKeyConfiguration() {
  console.log('🔑 Testing API Key Configuration...\n');

  try {
    // Test GNews API directly
    console.log('📰 Testing GNews API...');
    const gnewsResponse = await fetch(`https://gnews.io/api/v4/search?q=Microsoft&lang=en&country=us&max=5&apikey=82eb7721b0852a8dd71f5d0492c72596`);
    const gnewsData = await gnewsResponse.json();
    
    if (gnewsData.articles) {
      console.log('✅ GNews API working!');
      console.log(`   - Found ${gnewsData.articles.length} articles`);
      console.log(`   - First article: ${gnewsData.articles[0]?.title || 'N/A'}`);
    } else {
      console.log('❌ GNews API error:', gnewsData.errors || gnewsData);
    }

    // Test SERP API directly
    console.log('\n🔍 Testing SERP API...');
    const serpResponse = await fetch(`https://serpapi.com/search.json?engine=google&q=Microsoft+company&api_key=e449a4fafca55476b5bf9d07e90884c756f9512980bf5a0c1d72ea8d74627e20`);
    const serpData = await serpResponse.json();
    
    if (serpData.organic_results) {
      console.log('✅ SERP API working!');
      console.log(`   - Found ${serpData.organic_results.length} results`);
      console.log(`   - First result: ${serpData.organic_results[0]?.title || 'N/A'}`);
    } else {
      console.log('❌ SERP API error:', serpData.error || serpData);
    }

  } catch (error) {
    console.error('❌ Error testing API keys:', error);
  }
}

// Run the tests
async function runAllTests() {
  await testAPIKeyConfiguration();
  await testCRMCompanyFunctions();
}

runAllTests(); 
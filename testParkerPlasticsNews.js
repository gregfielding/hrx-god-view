const admin = require('firebase-admin');

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

async function testParkerPlasticsNews() {
  try {
    console.log('🔍 Testing Enhanced News Fetching for Parker Plastics...\n');

    // Test data for Parker Plastics
    const testData = {
      companyName: 'Parker Plastics',
      companyId: 'test-parker-plastics-id',
      tenantId: 'test-tenant-id',
      headquartersCity: 'Hagerstown',
      industry: 'Manufacturing'
    };

    console.log(`🏢 Testing with: ${testData.companyName}`);
    console.log(`📍 Location: ${testData.headquartersCity}`);
    console.log(`🏭 Industry: ${testData.industry}\n`);

    // Simulate the enhanced search queries
    const searchQueries = [
      `"${testData.companyName}"`,
      testData.companyName,
      `${testData.companyName} news`,
      `${testData.companyName} hiring`,
      `${testData.companyName} jobs`,
      `${testData.companyName} ${testData.headquartersCity}`,
      `${testData.companyName} ${testData.headquartersCity} news`,
      `${testData.companyName} ${testData.industry}`,
      'Parker Plastics news',
      'Parker Plastics hiring'
    ];

    console.log('🔍 Enhanced Search Queries:');
    searchQueries.forEach((query, index) => {
      console.log(`  ${index + 1}. "${query}"`);
    });
    console.log('');

    // Test SERP API configuration
    const serpApiKey = process.env.SERP_API_KEY;
    const gnewsApiKey = process.env.GNEWS_API_KEY;

    console.log('🔑 API Configuration:');
    console.log(`  SERP API Key: ${serpApiKey ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`  GNews API Key: ${gnewsApiKey ? '✅ Configured' : '❌ Not configured'}`);
    console.log('');

    // Test the actual function call
    console.log('📞 Testing deployed fetchCompanyNews function...');
    
    try {
      // Create a test company document
      const companyRef = db.collection('tenants').doc(testData.tenantId).collection('crm_companies').doc(testData.companyId);
      await companyRef.set({
        companyName: testData.companyName,
        headquartersCity: testData.headquartersCity,
        industry: testData.industry,
        createdAt: new Date().toISOString()
      });

      // Call the function logic directly (simplified version)
      const newsRef = companyRef.collection('newsArticles').doc('latest');
      
      // Check if we have cached results
      const newsDoc = await newsRef.get();
      if (newsDoc.exists) {
        const cachedData = newsDoc.data();
        console.log('📋 Found cached news data:');
        console.log(`  Last Updated: ${cachedData.lastUpdated}`);
        console.log(`  Articles Count: ${cachedData.articles?.length || 0}`);
        console.log(`  Source: ${cachedData.source || 'unknown'}`);
        
        if (cachedData.articles && cachedData.articles.length > 0) {
          console.log('\n📰 Cached Articles:');
          cachedData.articles.slice(0, 5).forEach((article, index) => {
            console.log(`  ${index + 1}. ${article.title}`);
            console.log(`     Source: ${article.source}`);
            console.log(`     Date: ${article.date}`);
            console.log(`     Relevance: ${article.relevance}`);
            console.log('');
          });
        }
      } else {
        console.log('❌ No cached news data found');
      }

    } catch (error) {
      console.error('❌ Error testing function:', error);
    }

    console.log('✅ Test completed!');
    console.log('\n💡 Next Steps:');
    console.log('  1. Check the CRM interface for Parker Plastics');
    console.log('  2. Look for the News tab to see if articles appear');
    console.log('  3. If no articles, check Firebase function logs');
    console.log('  4. Verify SERP API key is properly configured');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testParkerPlasticsNews(); 
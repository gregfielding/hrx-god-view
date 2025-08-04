const { initializeApp } = require('firebase/app');
const { getFunctions, httpsCallable } = require('firebase/functions');

// Firebase config
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
const functions = getFunctions(app);

async function testParkerPlasticsNewsDirect() {
  try {
    console.log('🔍 Testing Deployed fetchCompanyNews Function for Parker Plastics...\n');

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

    // Call the deployed function
    const fetchCompanyNews = httpsCallable(functions, 'fetchCompanyNews');
    
    console.log('📞 Calling deployed fetchCompanyNews function...');
    const result = await fetchCompanyNews(testData);
    
    const data = result.data;
    console.log('✅ Function call successful!');
    console.log(`📰 Articles found: ${data.articles?.length || 0}\n`);

    if (data.articles && data.articles.length > 0) {
      console.log('📋 News Articles:');
      data.articles.forEach((article, index) => {
        console.log(`\n${index + 1}. ${article.title}`);
        console.log(`   Source: ${article.source}`);
        console.log(`   Date: ${article.date}`);
        console.log(`   Relevance: ${article.relevance}`);
        console.log(`   URL: ${article.url}`);
        console.log(`   Summary: ${article.summary?.substring(0, 100)}...`);
        console.log(`   Tags: ${article.tags?.join(', ')}`);
      });
    } else {
      console.log('❌ No articles found');
      console.log('\n🔍 Possible reasons:');
      console.log('  1. API rate limits reached');
      console.log('  2. Search queries not matching recent articles');
      console.log('  3. Articles filtered out by relevance criteria');
      console.log('  4. Cached empty results (check last 6 hours)');
    }

    console.log('\n✅ Test completed!');

  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Error details:', error.message);
    
    if (error.code === 'functions/unavailable') {
      console.log('\n💡 The function might not be deployed or accessible');
    } else if (error.code === 'functions/unauthenticated') {
      console.log('\n💡 Authentication required - you may need to sign in');
    }
  }
}

testParkerPlasticsNewsDirect(); 
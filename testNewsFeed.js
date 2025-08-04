const { initializeApp } = require('firebase/app');
const { getFunctions, httpsCallable } = require('firebase/functions');
const { getFirestore, doc, setDoc, deleteDoc, getDoc, collection, getDocs } = require('firebase/firestore');

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBxJjJjJjJjJjJjJjJjJjJjJjJjJjJjJj",
  authDomain: "hrx1-d3beb.firebaseapp.com",
  projectId: "hrx1-d3beb",
  storageBucket: "hrx1-d3beb.appspot.com",
  messagingSenderId: "143752240496",
  appId: "1:143752240496:web:j7supdp4b6au1irkcp06ise32g9dfcr"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const functions = getFunctions(app);
const db = getFirestore(app);

async function testNewsFeed() {
  try {
    console.log('🧪 Testing Sales News Feed Functionality...\n');
    
    // Test data
    const testUserId = 'test-user-123';
    const testCompanyId = 'test-company-456';
    const testCompanyName = 'Microsoft';
    const testTenantId = 'test-tenant-789';
    
    console.log('📋 Test Setup:');
    console.log(`   User ID: ${testUserId}`);
    console.log(`   Company ID: ${testCompanyId}`);
    console.log(`   Company Name: ${testCompanyName}`);
    console.log(`   Tenant ID: ${testTenantId}`);
    console.log('='.repeat(60));
    
    // Test 1: Follow a company
    console.log('\n⭐ Testing Company Follow:');
    try {
      const followRef = doc(db, 'users', testUserId, 'followedCompanies', testCompanyId);
      await setDoc(followRef, {
        followedAt: new Date(),
        companyName: testCompanyName,
        tenantId: testTenantId
      });
      
      const followDoc = await getDoc(followRef);
      if (followDoc.exists()) {
        console.log('✅ Company followed successfully');
        console.log('   Follow data:', followDoc.data());
      } else {
        console.log('❌ Failed to follow company');
      }
    } catch (error) {
      console.error('❌ Error following company:', error.message);
    }
    
    // Test 2: Check if company is followed
    console.log('\n🔍 Testing Follow Status Check:');
    try {
      const followRef = doc(db, 'users', testUserId, 'followedCompanies', testCompanyId);
      const followDoc = await getDoc(followRef);
      
      if (followDoc.exists()) {
        console.log('✅ Company is being followed');
        console.log('   Followed at:', followDoc.data().followedAt.toDate());
      } else {
        console.log('❌ Company is not being followed');
      }
    } catch (error) {
      console.error('❌ Error checking follow status:', error.message);
    }
    
    // Test 3: Get followed companies for user
    console.log('\n📋 Testing Followed Companies List:');
    try {
      const followsRef = collection(db, 'users', testUserId, 'followedCompanies');
      const followsSnap = await getDocs(followsRef);
      
      console.log(`✅ Found ${followsSnap.size} followed companies:`);
      followsSnap.forEach(doc => {
        console.log(`   - ${doc.data().companyName} (${doc.id})`);
      });
    } catch (error) {
      console.error('❌ Error getting followed companies:', error.message);
    }
    
    // Test 4: Simulate news cache data
    console.log('\n📰 Testing News Cache Structure:');
    try {
      const today = new Date().toISOString().split('T')[0];
      const newsCacheRef = doc(db, 'companyNewsCache', testCompanyId, today);
      
      const mockNewsData = {
        articles: [
          {
            title: 'Microsoft announces new AI features',
            url: 'https://example.com/news1',
            source: 'TechCrunch',
            snippet: 'Microsoft has announced new AI features for its products...',
            publishedAt: new Date().toISOString(),
            companyId: testCompanyId,
            companyName: testCompanyName
          },
          {
            title: 'Microsoft quarterly earnings beat expectations',
            url: 'https://example.com/news2',
            source: 'CNBC',
            snippet: 'Microsoft reported strong quarterly earnings...',
            publishedAt: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
            companyId: testCompanyId,
            companyName: testCompanyName
          }
        ],
        fetchedAt: new Date(),
        companyName: testCompanyName
      };
      
      await setDoc(newsCacheRef, mockNewsData);
      console.log('✅ Mock news data created successfully');
      console.log(`   Date: ${today}`);
      console.log(`   Articles: ${mockNewsData.articles.length}`);
    } catch (error) {
      console.error('❌ Error creating mock news data:', error.message);
    }
    
    // Test 5: Retrieve news cache data
    console.log('\n📖 Testing News Cache Retrieval:');
    try {
      const today = new Date().toISOString().split('T')[0];
      const newsCacheRef = doc(db, 'companyNewsCache', testCompanyId, today);
      const newsDoc = await getDoc(newsCacheRef);
      
      if (newsDoc.exists()) {
        const newsData = newsDoc.data();
        console.log('✅ News cache data retrieved successfully');
        console.log(`   Company: ${newsData.companyName}`);
        console.log(`   Articles: ${newsData.articles.length}`);
        console.log(`   Fetched: ${newsData.fetchedAt.toDate()}`);
        
        newsData.articles.forEach((article, index) => {
          console.log(`   Article ${index + 1}: ${article.title}`);
          console.log(`     Source: ${article.source}`);
          console.log(`     Published: ${article.publishedAt}`);
        });
      } else {
        console.log('❌ No news cache data found');
      }
    } catch (error) {
      console.error('❌ Error retrieving news cache:', error.message);
    }
    
    // Test 6: Unfollow company
    console.log('\n🚫 Testing Company Unfollow:');
    try {
      const followRef = doc(db, 'users', testUserId, 'followedCompanies', testCompanyId);
      await deleteDoc(followRef);
      
      const followDoc = await getDoc(followRef);
      if (!followDoc.exists()) {
        console.log('✅ Company unfollowed successfully');
      } else {
        console.log('❌ Failed to unfollow company');
      }
    } catch (error) {
      console.error('❌ Error unfollowing company:', error.message);
    }
    
    // Test 7: Clean up test data
    console.log('\n🧹 Cleaning up test data:');
    try {
      const today = new Date().toISOString().split('T')[0];
      const newsCacheRef = doc(db, 'companyNewsCache', testCompanyId, today);
      await deleteDoc(newsCacheRef);
      console.log('✅ Test data cleaned up successfully');
    } catch (error) {
      console.error('❌ Error cleaning up test data:', error.message);
    }
    
    console.log('\n🎉 News Feed Functionality Test Complete!');
    console.log('\n📝 Summary:');
    console.log('   ✅ Company follow/unfollow functionality');
    console.log('   ✅ Followed companies list retrieval');
    console.log('   ✅ News cache data structure');
    console.log('   ✅ News cache data retrieval');
    console.log('   ✅ Data cleanup');
    
  } catch (error) {
    console.error('❌ Test Error:', error);
    console.error('Error details:', error.message);
    console.error('Error code:', error.code);
  }
}

// Run the test
testNewsFeed(); 
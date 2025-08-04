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

// Test the enhanceContactWithAI function
async function testContactEnhancement() {
  console.log('Testing Contact Enhancement Feature...\n');

  try {
    const enhanceContact = httpsCallable(functions, 'enhanceContactWithAI');
    
    // Test with sample contact data
    const testData = {
      contactId: 'test-contact-id',
      tenantId: 'test-tenant-id',
      contactData: {
        fullName: 'John Smith',
        firstName: 'John',
        lastName: 'Smith',
        email: 'john.smith@example.com',
        jobTitle: 'Senior Software Engineer',
        companyName: 'Tech Corp',
        phone: '555-123-4567'
      }
    };
    
    console.log('Calling enhanceContactWithAI with test data...');
    const result = await enhanceContact(testData);
    
    console.log('✅ Function call successful!');
    console.log('Result:', JSON.stringify(result.data, null, 2));
    
    if (result.data.success) {
      console.log('\n🎉 Contact enhancement completed successfully!');
      console.log('Enhanced data includes:');
      
      const enhancedData = result.data.data;
      if (enhancedData.socialProfiles) {
        console.log(`- ${enhancedData.socialProfiles.length} social profiles found`);
      }
      if (enhancedData.newsMentions) {
        console.log(`- ${enhancedData.newsMentions.length} news mentions found`);
      }
      if (enhancedData.professionalSummary) {
        console.log('- Professional summary generated');
      }
      if (enhancedData.keySkills) {
        console.log(`- ${enhancedData.keySkills.length} key skills identified`);
      }
      if (enhancedData.inferredSeniority) {
        console.log(`- Seniority level: ${enhancedData.inferredSeniority}`);
      }
      if (enhancedData.inferredIndustry) {
        console.log(`- Industry: ${enhancedData.inferredIndustry}`);
      }
    } else {
      console.log('❌ Contact enhancement failed:', result.data.message);
    }
    
  } catch (error) {
    console.error('❌ Error testing contact enhancement:', error);
    console.error('Error details:', error.message);
  }
}

// Run the test
testContactEnhancement(); 
const { initializeApp } = require('firebase/app');
const { getFunctions, httpsCallable } = require('firebase/functions');

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBxJjAo_dTMQjJdXgDkqXqXqXqXqXqXqXqXq",
  authDomain: "hrx1-d3beb.firebaseapp.com",
  projectId: "hrx1-d3beb",
  storageBucket: "hrx1-d3beb.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef123456"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const functions = getFunctions(app);

async function testPhoneNumberContacts() {
  try {
    console.log('🔍 Testing phone number detection in contact names...');
    
    // Test the phone number detection logic
    const testCases = [
      '+15418419243',
      '5418419243',
      '15418419243',
      '+1-541-841-9243',
      '541-841-9243',
      '541.841.9243',
      '541 841 9243',
      'John Doe',
      'john@example.com',
      'postmaster@example.com',
      '1234567890',
      '+1234567890'
    ];
    
    console.log('📋 Testing phone number detection logic:');
    
    const isEmailAddress = (str) => {
      return str.includes('@') && str.includes('.');
    };
    
    const isNonNameContent = (str) => {
      // Check for email addresses, phone numbers, or other non-name patterns
      return isEmailAddress(str) || 
             /^\d+$/.test(str) || // Only numbers
             /^\+?\d+$/.test(str) || // Phone numbers with optional + prefix
             /^\d{10,}$/.test(str) || // Phone numbers with 10+ digits
             /^\+?\d{10,}$/.test(str) || // Phone numbers with + and 10+ digits
             /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(str) || // Email regex
             str.toLowerCase().includes('postmaster') ||
             str.toLowerCase().includes('noreply') ||
             str.toLowerCase().includes('no-reply') ||
             str.toLowerCase().includes('donotreply');
    };
    
    testCases.forEach((testCase, index) => {
      const isEmail = isEmailAddress(testCase);
      const isNonName = isNonNameContent(testCase);
      const shouldDelete = isNonName;
      
      console.log(`   Test ${index + 1}: "${testCase}"`);
      console.log(`     Is email: ${isEmail}`);
      console.log(`     Is non-name content: ${isNonName}`);
      console.log(`     Should delete: ${shouldDelete}`);
      console.log('');
    });
    
    // Now let's look at some actual contact data to see what we're dealing with
    console.log('🔍 Looking at actual contact data...');
    
    // Use the duplicate contacts function to get some sample data
    const result = await httpsCallable(functions, 'removeDuplicateContacts')({
      dryRun: true
    });
    
    if (!result.data.success) {
      console.error('❌ Function call failed:', result.data.error);
      return;
    }
    
    console.log('✅ Function call successful!');
    
    const { results } = result.data;
    
    results.forEach(tenantResult => {
      if (tenantResult.totalContacts > 0) {
        console.log(`\n🏢 Tenant: ${tenantResult.tenantName} (${tenantResult.tenantId})`);
        console.log(`   Total Contacts: ${tenantResult.totalContacts}`);
        
        // Look for contacts with phone numbers in names
        console.log('   🔍 Looking for contacts with phone numbers in names...');
        
        // This is a bit of a workaround since we don't have direct access to all contacts
        // Let's check if there are any patterns in the duplicate groups that might indicate phone numbers
        
        if (tenantResult.duplicateGroupsDetails && tenantResult.duplicateGroupsDetails.length > 0) {
          let phoneNumberContacts = 0;
          
          tenantResult.duplicateGroupsDetails.forEach((group, groupIndex) => {
            const keptContact = group.contactsToKeep[0];
            const fullName = keptContact.fullName || '';
            const firstName = keptContact.firstName || '';
            
            // Check if any name field contains a phone number pattern
            const hasPhoneInName = isNonNameContent(fullName) || isNonNameContent(firstName);
            
            if (hasPhoneInName) {
              phoneNumberContacts++;
              console.log(`      Found phone number contact: "${fullName}" (firstName: "${firstName}")`);
            }
          });
          
          if (phoneNumberContacts === 0) {
            console.log('      ✅ No contacts with phone numbers in names found in duplicate groups');
          } else {
            console.log(`      📱 Found ${phoneNumberContacts} contacts with phone numbers in names`);
          }
        }
      }
    });
    
  } catch (error) {
    console.error('❌ Error testing phone number contacts:', error);
  }
}

// Run the test
testPhoneNumberContacts(); 
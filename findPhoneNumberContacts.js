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

async function findPhoneNumberContacts() {
  try {
    console.log('🔍 Searching for contacts with phone numbers in name fields...');
    
    // First, let's get a sample of contacts to see what we're working with
    const result = await httpsCallable(functions, 'removeDuplicateContacts')({
      dryRun: true
    });
    
    if (!result.data.success) {
      console.error('❌ Function call failed:', result.data.error);
      return;
    }
    
    console.log('✅ Function call successful!');
    
    const { results } = result.data;
    
    // Define phone number detection patterns
    const phonePatterns = [
      /^\d{10,}$/, // 10+ digits
      /^\+?\d{10,}$/, // + and 10+ digits
      /^\d{3}-\d{3}-\d{4}$/, // XXX-XXX-XXXX
      /^\d{3}\.\d{3}\.\d{4}$/, // XXX.XXX.XXXX
      /^\d{3}\s\d{3}\s\d{4}$/, // XXX XXX XXXX
      /^\+1-\d{3}-\d{3}-\d{4}$/, // +1-XXX-XXX-XXXX
      /^\+1\s\d{3}\s\d{3}\s\d{4}$/, // +1 XXX XXX XXXX
    ];
    
    const isPhoneNumber = (str) => {
      if (!str || typeof str !== 'string') return false;
      const cleanStr = str.replace(/[^\d+]/g, ''); // Remove all non-digit and non-plus characters
      return phonePatterns.some(pattern => pattern.test(cleanStr)) || 
             /^\d{10,}$/.test(cleanStr) || // 10+ digits
             /^\+?\d{10,}$/.test(cleanStr); // + and 10+ digits
    };
    
    results.forEach(tenantResult => {
      if (tenantResult.totalContacts > 0) {
        console.log(`\n🏢 Tenant: ${tenantResult.tenantName} (${tenantResult.tenantId})`);
        console.log(`   Total Contacts: ${tenantResult.totalContacts}`);
        
        // Look through all contacts in duplicate groups for phone numbers in names
        if (tenantResult.duplicateGroupsDetails && tenantResult.duplicateGroupsDetails.length > 0) {
          let phoneNumberContacts = [];
          
          tenantResult.duplicateGroupsDetails.forEach((group, groupIndex) => {
            // Check the contact being kept
            const keptContact = group.contactsToKeep[0];
            const fullName = keptContact.fullName || '';
            const firstName = keptContact.firstName || '';
            const lastName = keptContact.lastName || '';
            
            if (isPhoneNumber(fullName) || isPhoneNumber(firstName) || isPhoneNumber(lastName)) {
              phoneNumberContacts.push({
                type: 'kept',
                contact: keptContact,
                field: isPhoneNumber(fullName) ? 'fullName' : isPhoneNumber(firstName) ? 'firstName' : 'lastName',
                value: isPhoneNumber(fullName) ? fullName : isPhoneNumber(firstName) ? firstName : lastName
              });
            }
            
            // Check contacts being deleted
            group.contactsToDelete.forEach((contact, contactIndex) => {
              const contactFullName = contact.fullName || '';
              const contactFirstName = contact.firstName || '';
              const contactLastName = contact.lastName || '';
              
              if (isPhoneNumber(contactFullName) || isPhoneNumber(contactFirstName) || isPhoneNumber(contactLastName)) {
                phoneNumberContacts.push({
                  type: 'deleted',
                  contact: contact,
                  field: isPhoneNumber(contactFullName) ? 'fullName' : isPhoneNumber(contactFirstName) ? 'firstName' : 'lastName',
                  value: isPhoneNumber(contactFullName) ? contactFullName : isPhoneNumber(contactFirstName) ? contactFirstName : contactLastName
                });
              }
            });
          });
          
          if (phoneNumberContacts.length === 0) {
            console.log('      ✅ No contacts with phone numbers in names found');
          } else {
            console.log(`      📱 Found ${phoneNumberContacts.length} contacts with phone numbers in names:`);
            phoneNumberContacts.forEach((item, index) => {
              console.log(`         ${index + 1}. ${item.type.toUpperCase()}: "${item.value}" in ${item.field} field`);
              console.log(`            ID: ${item.contact.id}, Email: ${item.contact.email || 'No email'}`);
            });
          }
        }
        
        // Also test some common phone number patterns
        console.log('\n   📋 Testing phone number patterns:');
        const testNumbers = [
          '+15418419243',
          '5418419243',
          '15418419243',
          '+1-541-841-9243',
          '541-841-9243',
          '541.841.9243',
          '541 841 9243',
          '1234567890',
          '+1234567890'
        ];
        
        testNumbers.forEach((testNum, index) => {
          const isPhone = isPhoneNumber(testNum);
          console.log(`      Test ${index + 1}: "${testNum}" -> ${isPhone ? 'PHONE' : 'NOT PHONE'}`);
        });
      }
    });
    
  } catch (error) {
    console.error('❌ Error finding phone number contacts:', error);
  }
}

// Run the search
findPhoneNumberContacts(); 
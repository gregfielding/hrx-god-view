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

async function diagnoseContactNames() {
  try {
    console.log('🔍 Diagnosing contact name fields...');
    
    // Call the function to get detailed results
    const result = await httpsCallable(functions, 'removeContactsWithoutNames')({
      dryRun: true
    });
    
    if (!result.data.success) {
      console.error('❌ Function call failed:', result.data.error);
      return;
    }
    
    console.log('✅ Function call successful!');
    
    // Let's examine some sample contacts to understand the data structure
    console.log('\n📋 Sample Contact Analysis:');
    
    // Get a few sample contacts from the results
    const { results } = result.data;
    
    results.forEach(tenantResult => {
      if (tenantResult.totalContacts > 0) {
        console.log(`\n🏢 Tenant: ${tenantResult.tenantName} (${tenantResult.tenantId})`);
        console.log(`   Total Contacts: ${tenantResult.totalContacts}`);
        
        // Show a few sample contacts
        if (tenantResult.contactsToDelete && tenantResult.contactsToDelete.length > 0) {
          console.log('   📋 Sample contacts to delete:');
          tenantResult.contactsToDelete.slice(0, 3).forEach((contact, index) => {
            console.log(`      Contact ${index + 1}:`);
            console.log(`        ID: ${contact.id}`);
            console.log(`        fullName: "${contact.fullName || 'undefined'}"`);
            console.log(`        firstName: "${contact.firstName || 'undefined'}"`);
            console.log(`        lastName: "${contact.lastName || 'undefined'}"`);
            console.log(`        email: "${contact.email || 'undefined'}"`);
            console.log(`        phone: "${contact.phone || 'undefined'}"`);
            console.log(`        jobTitle: "${contact.jobTitle || 'undefined'}"`);
            console.log(`        companyName: "${contact.companyName || 'undefined'}"`);
            console.log(`        salesOwnerRef: "${contact.salesOwnerRef || 'undefined'}"`);
            console.log('');
          });
        } else {
          console.log('   ✅ No contacts to delete found');
        }
      }
    });
    
    // Let's also check if there are any contacts with empty names but other data
    console.log('\n🔍 Checking for contacts with empty names but other data...');
    
    // Create a simple test to see what the actual data looks like
    const testContacts = [
      { fullName: '', firstName: '', lastName: '', email: 'test@example.com' },
      { fullName: '   ', firstName: '   ', lastName: '   ', email: 'test2@example.com' },
      { fullName: undefined, firstName: undefined, lastName: undefined, email: 'test3@example.com' },
      { fullName: null, firstName: null, lastName: null, email: 'test4@example.com' }
    ];
    
    console.log('📋 Test cases:');
    testContacts.forEach((contact, index) => {
      const firstName = (contact.firstName || '').trim();
      const fullName = (contact.fullName || '').trim();
      const lastName = (contact.lastName || '').trim();
      
      const hasFirstName = firstName.length > 0;
      const hasFullName = fullName.length > 0;
      const hasLastName = lastName.length > 0;
      
      const hasNoName = !hasFirstName && !hasFullName && !hasLastName;
      
      console.log(`   Test ${index + 1}:`);
      console.log(`     fullName: "${contact.fullName}" -> trimmed: "${fullName}" -> hasContent: ${hasFullName}`);
      console.log(`     firstName: "${contact.firstName}" -> trimmed: "${firstName}" -> hasContent: ${hasFirstName}`);
      console.log(`     lastName: "${contact.lastName}" -> trimmed: "${lastName}" -> hasContent: ${hasLastName}`);
      console.log(`     Has no name: ${hasNoName}`);
      console.log('');
    });
    
  } catch (error) {
    console.error('❌ Error diagnosing contact names:', error);
  }
}

// Run the diagnosis
diagnoseContactNames(); 
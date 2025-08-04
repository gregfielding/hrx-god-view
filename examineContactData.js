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

async function examineContactData() {
  try {
    console.log('🔍 Examining actual contact data...');
    
    // Let's look at some sample contacts to understand the data structure
    // We'll use the duplicate contacts function to get some sample data
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
        
        // Show some sample contacts from duplicate groups
        if (tenantResult.duplicateGroupsDetails && tenantResult.duplicateGroupsDetails.length > 0) {
          console.log('   📋 Sample contacts from duplicate groups:');
          
          // Take first few duplicate groups
          tenantResult.duplicateGroupsDetails.slice(0, 5).forEach((group, groupIndex) => {
            console.log(`      Group ${groupIndex + 1}: "${group.normalizedName}"`);
            
            // Show the contact being kept
            const keptContact = group.contactsToKeep[0];
            console.log(`        KEEPING: ${keptContact.fullName || `${keptContact.firstName || ''} ${keptContact.lastName || ''}`.trim()}`);
            console.log(`          ID: ${keptContact.id}`);
            console.log(`          Email: ${keptContact.email || 'No email'}`);
            console.log(`          Phone: ${keptContact.phone || 'No phone'}`);
            console.log(`          Company: ${keptContact.companyName || 'No company'}`);
            console.log(`          SalesOwnerRef: ${keptContact.salesOwnerRef || 'No owner'}`);
            
            // Show a couple being deleted
            group.contactsToDelete.slice(0, 2).forEach((contact, contactIndex) => {
              console.log(`        DELETING ${contactIndex + 1}: ${contact.fullName || `${contact.firstName || ''} ${contact.lastName || ''}`.trim()}`);
              console.log(`          ID: ${contact.id}`);
              console.log(`          Email: ${contact.email || 'No email'}`);
              console.log(`          SalesOwnerRef: ${contact.salesOwnerRef || 'No owner'}`);
            });
            
            if (group.contactsToDelete.length > 2) {
              console.log(`        ... and ${group.contactsToDelete.length - 2} more`);
            }
            console.log('');
          });
        } else {
          console.log('   ✅ No duplicate groups found');
        }
        
        // Let's also check for any contacts that might have email addresses as names
        console.log('   🔍 Checking for contacts with email addresses as names...');
        
        // This is a bit of a workaround - let's look at some sample contacts
        // We'll need to examine the actual data structure more carefully
        
        // Let's create a simple test to see what patterns we find
        const sampleContacts = [
          { fullName: 'postmaster@mgmresorts.onmicrosoft.com', email: 'postmaster@mgmresorts.onmicrosoft.com' },
          { fullName: 'noreply@example.com', email: 'noreply@example.com' },
          { fullName: 'test@test.com', email: 'test@test.com' }
        ];
        
        console.log('   📋 Testing name validation logic:');
        sampleContacts.forEach((contact, index) => {
          const fullName = (contact.fullName || '').trim();
          const isEmailAddress = (str) => {
            return str.includes('@') && str.includes('.');
          };
          
          const isNonNameContent = (str) => {
            return isEmailAddress(str) || 
                   /^\d+$/.test(str) || // Only numbers
                   /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(str) || // Email regex
                   str.toLowerCase().includes('postmaster') ||
                   str.toLowerCase().includes('noreply') ||
                   str.toLowerCase().includes('no-reply') ||
                   str.toLowerCase().includes('donotreply');
          };
          
          const isValidName = !isNonNameContent(fullName);
          
          console.log(`      Test ${index + 1}: "${fullName}"`);
          console.log(`        Is email: ${isEmailAddress(fullName)}`);
          console.log(`        Is non-name content: ${isNonNameContent(fullName)}`);
          console.log(`        Is valid name: ${isValidName}`);
          console.log('');
        });
      }
    });
    
  } catch (error) {
    console.error('❌ Error examining contact data:', error);
  }
}

// Run the examination
examineContactData(); 
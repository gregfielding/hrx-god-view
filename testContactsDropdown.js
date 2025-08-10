// Test to check contacts dropdown in Associations Panel
// Run this in the browser console on the Deal Details page

async function testContactsDropdown() {
  console.log('🔍 Testing Contacts Dropdown in Associations Panel');
  
  try {
    const tenantId = 'BCiP2bQ9CgVOCTfV6MhD';
    const dealId = '1xEcA2JdEdr20kjBSnKa';
    
    console.log('📊 Testing with tenantId:', tenantId);
    console.log('📊 Testing with dealId:', dealId);
    
    // Method 1: Check what contacts are available in the company
    console.log('📊 Step 1: Loading all contacts for Parker Plastics...');
    
    // Get the deal to find the companyId
    const { doc, getDoc, collection, getDocs, query, where } = await import('firebase/firestore');
    const { db } = await import('./src/firebase.ts');
    
    const dealRef = doc(db, 'tenants', tenantId, 'crm_deals', dealId);
    const dealDoc = await getDoc(dealRef);
    
    if (!dealDoc.exists()) {
      console.error('❌ Deal document not found');
      return;
    }
    
    const dealData = dealDoc.data();
    console.log('✅ Deal loaded:', dealData.name);
    console.log('📊 Deal companyId:', dealData.companyId);
    
    if (!dealData.companyId) {
      console.error('❌ Deal has no companyId');
      return;
    }
    
    // Load all contacts for this company
    console.log('📊 Step 2: Loading contacts for company:', dealData.companyId);
    
    const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
    const contactsQuery = query(contactsRef, where('companyId', '==', dealData.companyId));
    const contactsSnapshot = await getDocs(contactsQuery);
    
    const allContacts = contactsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    console.log('✅ All contacts for company:', allContacts.length);
    console.log('📊 Contact details:', allContacts.map(c => ({
      id: c.id,
      name: c.fullName || `${c.firstName} ${c.lastName}`,
      email: c.email,
      title: c.title
    })));
    
    // Check which contacts are already associated with the deal
    console.log('📊 Step 3: Checking current deal associations...');
    
    const currentAssociatedContactIds = dealData.contactIds || [];
    console.log('📊 Current associated contact IDs:', currentAssociatedContactIds);
    
    // Filter out already associated contacts
    const availableContacts = allContacts.filter(contact => 
      !currentAssociatedContactIds.includes(contact.id)
    );
    
    console.log('✅ Available contacts for dropdown:', availableContacts.length);
    console.log('📊 Available contact details:', availableContacts.map(c => ({
      id: c.id,
      name: c.fullName || `${c.firstName} ${c.lastName}`,
      email: c.email,
      title: c.title
    })));
    
    // Check if the SimpleAssociationsCard is using the correct data
    console.log('📊 Step 4: Checking SimpleAssociationsCard state...');
    
    // Look for the SimpleAssociationsCard component
    const associationsCard = document.querySelector('[class*="SimpleAssociationsCard"]') ||
                           document.querySelector('[class*="associations"]');
    
    if (associationsCard) {
      console.log('✅ Found Associations Card');
      
      // Try to access the component's state
      const reactFiber = associationsCard._reactInternalFiber;
      if (reactFiber) {
        console.log('✅ Found React fiber for Associations Card');
        
        // Look for available entities state
        let current = reactFiber;
        let depth = 0;
        const maxDepth = 20;
        
        while (current && depth < maxDepth) {
          if (current.memoizedState && current.memoizedState.availableEntities) {
            console.log('✅ Found availableEntities in component state at depth:', depth);
            console.log('📊 Available entities:', current.memoizedState.availableEntities);
            break;
          }
          
          if (current.stateNode && current.stateNode.availableEntities) {
            console.log('✅ Found availableEntities in component instance at depth:', depth);
            console.log('📊 Available entities:', current.stateNode.availableEntities);
            break;
          }
          
          current = current.child;
          depth++;
        }
      }
    }
    
    console.log('\n✅ Contacts dropdown test completed!');
    console.log('📊 Summary:');
    console.log(`- Total contacts in company: ${allContacts.length}`);
    console.log(`- Already associated: ${currentAssociatedContactIds.length}`);
    console.log(`- Available for dropdown: ${availableContacts.length}`);
    
    if (availableContacts.length === 0) {
      console.log('⚠️ No contacts available for dropdown - all contacts are already associated!');
    } else {
      console.log('✅ Contacts should appear in dropdown');
    }
    
  } catch (error) {
    console.error('❌ Error during contacts dropdown test:', error);
    console.error('Error details:', error.message);
  }
}

// Run the test
console.log('🔍 Starting Contacts Dropdown Test...');
testContactsDropdown();

// Make it available globally
window.testContactsDropdown = testContactsDropdown; 
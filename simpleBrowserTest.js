// Simple browser test for unified associations
// Run this in the browser console on the Deal Details page

async function simpleAssociationTest() {
  console.log('🔎 Simple Association Test');
  
  try {
    const tenantId = 'BCiP2bQ9CgVOCTfV6MhD';
    const dealId = '1xEcA2JdEdr20kjBSnKa';
    
    // Try to access Firebase through the React app's context
    console.log('📊 Attempting to access Firebase...');
    
    // Method 1: Try to access through React DevTools
    let firebaseApp = null;
    let firestore = null;
    
    try {
      // Check if Firebase is exposed globally by the app
      if (window.__FIREBASE_APP__) {
        firebaseApp = window.__FIREBASE_APP__;
        console.log('✅ Found Firebase app in __FIREBASE_APP__');
      }
      
      // Try to get Firestore from the app
      if (firebaseApp) {
        const { getFirestore } = await import('firebase/firestore');
        firestore = getFirestore(firebaseApp);
        console.log('✅ Got Firestore from app');
      }
    } catch (error) {
      console.log('❌ Could not access Firebase through global app:', error.message);
    }
    
    // Method 2: Try to access through React component context
    if (!firestore) {
      try {
        // Try to find Firebase in the React component tree
        const rootElement = document.querySelector('#root');
        if (rootElement && rootElement._reactInternalFiber) {
          console.log('📊 Searching React component tree for Firebase...');
          
          // This is a simplified approach - in reality, we'd need to traverse the tree
          // For now, let's try to access it through the AuthContext
          const authContext = window.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.get(1)?.getCurrentFiber();
          if (authContext) {
            console.log('✅ Found React DevTools context');
          }
        }
      } catch (error) {
        console.log('❌ Could not access Firebase through React context:', error.message);
      }
    }
    
    // Method 3: Try to create a new Firebase instance
    if (!firestore) {
      try {
        console.log('📊 Creating new Firebase instance...');
        
        const { initializeApp } = await import('firebase/app');
        const { getFirestore } = await import('firebase/firestore');
        
        const firebaseConfig = {
          apiKey: 'AIzaSyBQA9bc25_7ncjvY75nAtIUv47C3w5jl6c',
          authDomain: 'hrx1-d3beb.firebaseapp.com',
          projectId: 'hrx1-d3beb',
          storageBucket: 'hrx1-d3beb.firebasestorage.app',
          messagingSenderId: '143752240496',
          appId: '1:143752240496:web:e0b584983d4b04cb3983b5',
          measurementId: 'G-LL20QKNT0W',
        };
        
        const app = initializeApp(firebaseConfig);
        firestore = getFirestore(app);
        console.log('✅ Created new Firebase instance');
      } catch (error) {
        console.error('❌ Could not create new Firebase instance:', error.message);
        return;
      }
    }
    
    if (!firestore) {
      console.error('❌ Could not access Firestore');
      return;
    }
    
    // Now test the associations
    console.log('📊 Testing deal associations for:', dealId);
    
    const { doc, getDoc } = await import('firebase/firestore');
    
    // 1. Get the deal document
    console.log('📊 Step 1: Loading deal document...');
    const dealRef = doc(firestore, 'tenants', tenantId, 'crm_deals', dealId);
    const dealDoc = await getDoc(dealRef);
    
    if (!dealDoc.exists()) {
      console.error('❌ Deal document not found');
      return;
    }
    
    const dealData = dealDoc.data();
    console.log('✅ Deal loaded successfully');
    console.log('📊 Deal associations:', dealData.associations);
    console.log('📊 Deal contactIds:', dealData.contactIds);
    console.log('📊 Deal salespeopleIds:', dealData.salespeopleIds);
    
    // 2. Load contacts from deal's contactIds
    console.log('📊 Step 2: Loading contacts from deal...');
    const contacts = [];
    if (dealData.contactIds && dealData.contactIds.length > 0) {
      for (const contactId of dealData.contactIds) {
        try {
          const contactRef = doc(firestore, 'tenants', tenantId, 'crm_contacts', contactId);
          const contactDoc = await getDoc(contactRef);
          if (contactDoc.exists()) {
            const contactData = contactDoc.data();
            contacts.push({
              id: contactId,
              name: contactData.fullName || contactData.name || 'Unknown Contact',
              email: contactData.email || '',
              phone: contactData.phone || ''
            });
            console.log('✅ Contact loaded:', contactData.fullName || contactData.name);
          }
        } catch (error) {
          console.error('❌ Error loading contact', contactId, ':', error.message);
        }
      }
    }
    console.log('📊 Total contacts loaded:', contacts.length);
    
    // 3. Load salespeople from deal's salespeopleIds
    console.log('📊 Step 3: Loading salespeople from deal...');
    const salespeople = [];
    if (dealData.salespeopleIds && dealData.salespeopleIds.length > 0) {
      for (const salespersonId of dealData.salespeopleIds) {
        try {
          // Try tenant users first
          const salespersonRef = doc(firestore, 'tenants', tenantId, 'users', salespersonId);
          let salespersonDoc = await getDoc(salespersonRef);
          
          if (!salespersonDoc.exists()) {
            // Try global users
            const globalSalespersonRef = doc(firestore, 'users', salespersonId);
            salespersonDoc = await getDoc(globalSalespersonRef);
          }
          
          if (salespersonDoc.exists()) {
            const salespersonData = salespersonDoc.data();
            salespeople.push({
              id: salespersonId,
              name: salespersonData.fullName || salespersonData.name || 'Unknown Salesperson',
              email: salespersonData.email || ''
            });
            console.log('✅ Salesperson loaded:', salespersonData.fullName || salespersonData.name);
          }
        } catch (error) {
          console.error('❌ Error loading salesperson', salespersonId, ':', error.message);
        }
      }
    }
    console.log('📊 Total salespeople loaded:', salespeople.length);
    
    // 4. Load company
    console.log('📊 Step 4: Loading company...');
    let company = null;
    if (dealData.companyId) {
      try {
        const companyRef = doc(firestore, 'tenants', tenantId, 'crm_companies', dealData.companyId);
        const companyDoc = await getDoc(companyRef);
        if (companyDoc.exists()) {
          const companyData = companyDoc.data();
          company = {
            id: dealData.companyId,
            name: companyData.companyName || companyData.name || 'Unknown Company'
          };
          console.log('✅ Company loaded:', company.name);
        }
      } catch (error) {
        console.error('❌ Error loading company:', error.message);
      }
    }
    
    // 5. Summary
    console.log('\n📊 ASSOCIATION SUMMARY:');
    console.log('🏢 Company:', company ? company.name : 'None');
    console.log('👥 Contacts:', contacts.map(c => c.name).join(', ') || 'None');
    console.log('👤 Salespeople:', salespeople.map(s => s.name).join(', ') || 'None');
    
    // 6. Check for specific expected data
    console.log('\n🔍 CHECKING FOR EXPECTED DATA:');
    const jimParker = contacts.find(c => c.name.toLowerCase().includes('jim') && c.name.toLowerCase().includes('parker'));
    const gregFielding = salespeople.find(s => s.name.toLowerCase().includes('greg') && s.name.toLowerCase().includes('fielding'));
    const donnaPersson = salespeople.find(s => s.name.toLowerCase().includes('donna') && s.name.toLowerCase().includes('persson'));
    
    console.log('Jim Parker found:', jimParker ? '✅' : '❌');
    console.log('Greg Fielding found:', gregFielding ? '✅' : '❌');
    console.log('Donna Persson found:', donnaPersson ? '✅' : '❌');
    
    console.log('\n✅ Simple association test completed successfully!');
    
  } catch (error) {
    console.error('❌ Error during simple test:', error);
    console.error('Error details:', error.message);
  }
}

// Run the test
console.log('🔍 Starting Simple Association Test...');
simpleAssociationTest();

// Make it available globally
window.simpleAssociationTest = simpleAssociationTest; 
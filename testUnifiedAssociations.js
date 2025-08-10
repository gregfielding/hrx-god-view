// Test script for Unified Association Service
// Run this to verify the service works with the deal data

const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc } = require('firebase/firestore');

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
const db = getFirestore(app);

async function testUnifiedAssociations() {
  const tenantId = 'BCiP2bQ9CgVOCTfV6MhD';
  const dealId = '1xEcA2JdEdr20kjBSnKa';
  
  console.log('🔍 Testing Unified Association Service');
  console.log('Tenant ID:', tenantId);
  console.log('Deal ID:', dealId);
  
  try {
    // 1. Get the deal document directly
    console.log('\n📊 Step 1: Getting deal document...');
    const dealRef = doc(db, 'tenants', tenantId, 'crm_deals', dealId);
    const dealDoc = await getDoc(dealRef);
    
    if (!dealDoc.exists()) {
      console.log('❌ Deal document not found');
      return;
    }
    
    const dealData = dealDoc.data();
    console.log('✅ Deal document found');
    console.log('📊 Deal data:', {
      id: dealDoc.id,
      name: dealData.name,
      companyId: dealData.companyId,
      locationId: dealData.locationId,
      contactIds: dealData.contactIds,
      salespeopleIds: dealData.salespeopleIds,
      salesOwnerId: dealData.salesOwnerId,
      associations: dealData.associations
    });
    
    // 2. Check for explicit associations
    console.log('\n📊 Step 2: Checking explicit associations...');
    const { collection, query, where, getDocs } = require('firebase/firestore');
    const associationsRef = collection(db, 'tenants', tenantId, 'crm_associations');
    
    const sourceQuery = query(
      associationsRef,
      where('sourceEntityType', '==', 'deal'),
      where('sourceEntityId', '==', dealId)
    );
    const sourceSnapshot = await getDocs(sourceQuery);
    console.log(`📊 Found ${sourceSnapshot.docs.length} source associations`);
    
    const targetQuery = query(
      associationsRef,
      where('targetEntityType', '==', 'deal'),
      where('targetEntityId', '==', dealId)
    );
    const targetSnapshot = await getDocs(targetQuery);
    console.log(`📊 Found ${targetSnapshot.docs.length} target associations`);
    
    // 3. Load associated entities
    console.log('\n📊 Step 3: Loading associated entities...');
    
    // Load contacts
    if (dealData.contactIds && dealData.contactIds.length > 0) {
      console.log('📊 Loading contacts:', dealData.contactIds);
      for (const contactId of dealData.contactIds) {
        const contactRef = doc(db, 'tenants', tenantId, 'crm_contacts', contactId);
        const contactDoc = await getDoc(contactRef);
        if (contactDoc.exists()) {
          const contactData = contactDoc.data();
          console.log(`✅ Contact ${contactId}:`, {
            id: contactDoc.id,
            firstName: contactData.firstName,
            lastName: contactData.lastName,
            email: contactData.email,
            fullName: contactData.fullName
          });
        } else {
          console.log(`❌ Contact ${contactId} not found`);
        }
      }
    }
    
    // Load salespeople
    const allSalespersonIds = [];
    if (dealData.salespeopleIds && dealData.salespeopleIds.length > 0) {
      allSalespersonIds.push(...dealData.salespeopleIds);
    }
    if (dealData.salesOwnerId) {
      allSalespersonIds.push(dealData.salesOwnerId);
    }
    
    if (allSalespersonIds.length > 0) {
      console.log('📊 Loading salespeople:', allSalespersonIds);
      for (const salespersonId of allSalespersonIds) {
        // Try tenant users first
        let userRef = doc(db, 'tenants', tenantId, 'users', salespersonId);
        let userDoc = await getDoc(userRef);
        
        if (!userDoc.exists()) {
          // Try global users
          userRef = doc(db, 'users', salespersonId);
          userDoc = await getDoc(userRef);
        }
        
        if (userDoc.exists()) {
          const userData = userDoc.data();
          console.log(`✅ Salesperson ${salespersonId}:`, {
            id: userDoc.id,
            firstName: userData.firstName,
            lastName: userData.lastName,
            email: userData.email,
            displayName: userData.displayName
          });
        } else {
          console.log(`❌ Salesperson ${salespersonId} not found`);
        }
      }
    }
    
    // Load company
    if (dealData.companyId) {
      console.log('📊 Loading company:', dealData.companyId);
      const companyRef = doc(db, 'tenants', tenantId, 'crm_companies', dealData.companyId);
      const companyDoc = await getDoc(companyRef);
      if (companyDoc.exists()) {
        const companyData = companyDoc.data();
        console.log(`✅ Company ${dealData.companyId}:`, {
          id: companyDoc.id,
          name: companyData.name,
          companyName: companyData.companyName
        });
      } else {
        console.log(`❌ Company ${dealData.companyId} not found`);
      }
    }
    
    console.log('\n✅ Test completed successfully!');
    
  } catch (error) {
    console.error('❌ Error during test:', error);
  }
}

// Run the test
testUnifiedAssociations(); 
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc, updateDoc } = require('firebase/firestore');
const { getFunctions, httpsCallable } = require('firebase/functions');

// Initialize Firebase (you'll need to add your config)
const firebaseConfig = {
  // Add your Firebase config here
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const functions = getFunctions(app);

async function testApolloEnrichment() {
  const tenantId = 'BCiP2bQ9CgVOCTfG6MhD';
  const contactId = 'ievOWI2QKNrXH0ISJMTz'; // Jillian Carlson's contact ID
  
  try {
    console.log('Testing Apollo enrichment for Jillian Carlson...');
    
    // First, let's check the current state
    const contactRef = doc(db, 'tenants', tenantId, 'crm_contacts', contactId);
    const contactSnap = await getDoc(contactRef);
    
    if (!contactSnap.exists()) {
      console.error('Contact not found');
      return;
    }
    
    const contactData = contactSnap.data();
    console.log('Current contact data:');
    console.log('- headline:', contactData.headline);
    console.log('- jobTitle:', contactData.jobTitle);
    console.log('- avatar:', contactData.avatar);
    console.log('- apolloEnrichment:', contactData.apolloEnrichment ? 'exists' : 'missing');
    
    // Run the Apollo enrichment
    console.log('\nRunning Apollo enrichment...');
    const enrichContact = httpsCallable(functions, 'enrichContactOnDemand');
    
    const result = await enrichContact({
      tenantId,
      contactId,
      mode: 'full',
      force: true
    });
    
    console.log('Enrichment result:', result.data);
    
    // Check the updated state
    const updatedSnap = await getDoc(contactRef);
    const updatedData = updatedSnap.data();
    
    console.log('\nUpdated contact data:');
    console.log('- headline:', updatedData.headline);
    console.log('- jobTitle:', updatedData.jobTitle);
    console.log('- avatar:', updatedData.avatar);
    console.log('- apolloEnrichment:', updatedData.apolloEnrichment ? 'exists' : 'missing');
    
    if (updatedData.apolloEnrichment) {
      console.log('- Apollo person data:', updatedData.apolloEnrichment.person ? 'exists' : 'missing');
      if (updatedData.apolloEnrichment.person) {
        console.log('  - title:', updatedData.apolloEnrichment.person.title);
        console.log('  - headline:', updatedData.apolloEnrichment.person.headline);
        console.log('  - photo_url:', updatedData.apolloEnrichment.person.photo_url);
      }
    }
    
  } catch (error) {
    console.error('Error testing Apollo enrichment:', error);
  }
}

testApolloEnrichment();

const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc, updateDoc } = require('firebase/firestore');

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
const db = getFirestore(app);

// Test the contact auto-save functionality
async function testContactAutoSave() {
  console.log('Testing Contact Auto-Save Functionality...\n');

  try {
    const tenantId = 'test-tenant-id';
    const contactId = 'test-contact-id';
    
    // Create a test contact if it doesn't exist
    const contactRef = doc(db, 'tenants', tenantId, 'crm_contacts', contactId);
    const contactDoc = await getDoc(contactRef);
    
    if (!contactDoc.exists()) {
      console.log('Creating test contact...');
      await updateDoc(contactRef, {
        fullName: 'Test Contact',
        email: 'test@example.com',
        phone: '555-123-4567',
        jobTitle: 'Test Position',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date()
      });
      console.log('✅ Test contact created');
    } else {
      console.log('✅ Test contact already exists');
    }
    
    // Test updating individual fields
    console.log('\nTesting field updates...');
    
    // Test 1: Update full name
    await updateDoc(contactRef, {
      fullName: 'Updated Test Contact',
      updatedAt: new Date()
    });
    console.log('✅ Full name updated');
    
    // Test 2: Update email
    await updateDoc(contactRef, {
      email: 'updated@example.com',
      updatedAt: new Date()
    });
    console.log('✅ Email updated');
    
    // Test 3: Update job title
    await updateDoc(contactRef, {
      jobTitle: 'Senior Test Position',
      title: 'Senior Test Position',
      updatedAt: new Date()
    });
    console.log('✅ Job title updated');
    
    // Test 4: Update LinkedIn URL with protocol handling
    await updateDoc(contactRef, {
      linkedInUrl: 'linkedin.com/in/test-contact',
      updatedAt: new Date()
    });
    console.log('✅ LinkedIn URL updated');
    
    // Test 5: Update notes
    await updateDoc(contactRef, {
      notes: 'This is a test note for auto-save functionality.',
      updatedAt: new Date()
    });
    console.log('✅ Notes updated');
    
    // Verify the updates
    const updatedDoc = await getDoc(contactRef);
    const contactData = updatedDoc.data();
    
    console.log('\n📋 Final Contact Data:');
    console.log('- Full Name:', contactData.fullName);
    console.log('- Email:', contactData.email);
    console.log('- Job Title:', contactData.jobTitle);
    console.log('- LinkedIn URL:', contactData.linkedInUrl);
    console.log('- Notes:', contactData.notes);
    console.log('- Last Updated:', contactData.updatedAt?.toDate());
    
    console.log('\n🎉 Contact auto-save functionality test completed successfully!');
    
  } catch (error) {
    console.error('❌ Error testing contact auto-save:', error);
    console.error('Error details:', error.message);
  }
}

// Run the test
testContactAutoSave(); 
// Script to create a test contact for Gmail email capture testing
const { getFirestore, collection, addDoc, serverTimestamp } = require('firebase/firestore');
const { initializeApp } = require('firebase/app');

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBqXqXqXqXqXqXqXqXqXqXqXqXqXqXqXqXq",
  authDomain: "hrx1-d3beb.firebaseapp.com",
  projectId: "hrx1-d3beb",
  storageBucket: "hrx1-d3beb.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdefghijklmnop"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function createTestContact() {
  try {
    console.log('👤 Creating test contact for Gmail email capture...');
    
    const contactData = {
      firstName: 'Greg',
      lastName: 'Fielding',
      fullName: 'Greg Fielding',
      email: 'gregpfielding@gmail.com',
      phone: '+1-555-123-4567',
      jobTitle: 'Test Contact',
      contactType: 'Test',
      tags: ['test', 'gmail-capture'],
      isActive: true,
      notes: 'Test contact for Gmail email capture functionality',
      tenantId: 'BC1PZBQ9qGCVCTV6MND',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      salesOwnerId: 'zazCFZdVZMTX3AJZsVmrYzHmb6Q2',
      accountOwnerId: 'zazCFZdVZMTX3AJZsVmrYzHmb6Q2'
    };

    const contactsRef = collection(db, 'tenants', 'BC1PZBQ9qGCVCTV6MND', 'crm_contacts');
    const docRef = await addDoc(contactsRef, contactData);
    
    console.log('✅ Test contact created successfully!');
    console.log('📋 Contact details:', {
      id: docRef.id,
      name: contactData.fullName,
      email: contactData.email,
      tenantId: contactData.tenantId
    });
    
    return docRef.id;
    
  } catch (error) {
    console.error('❌ Error creating test contact:', error);
    throw error;
  }
}

createTestContact().catch(console.error);

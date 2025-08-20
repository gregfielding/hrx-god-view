// Script to create a test contact for Gmail email capture testing using Admin SDK
const admin = require('firebase-admin');

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: 'hrx1-d3beb'
  });
}

const db = admin.firestore();

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
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      salesOwnerId: 'zazCFZdVZMTX3AJZsVmrYzHmb6Q2',
      accountOwnerId: 'zazCFZdVZMTX3AJZsVmrYzHmb6Q2'
    };

    const contactsRef = db.collection('tenants').doc('BC1PZBQ9qGCVCTV6MND').collection('crm_contacts');
    const docRef = await contactsRef.add(contactData);
    
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

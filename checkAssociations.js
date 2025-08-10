const admin = require('firebase-admin');

// Initialize Firebase Admin
const serviceAccount = require('./firebase copy.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkAssociations() {
  try {
    console.log('🔍 Checking current association structure...');
    
    const tenantId = 'BCiP2bQ9CgVOCTfV6MhD';
    
    // Check deals
    console.log('\n📊 Checking deals...');
    const dealsRef = db.collection('tenants').doc(tenantId).collection('crm_deals');
    const dealsSnapshot = await dealsRef.limit(5).get();
    
    let dealsWithAssociations = 0;
    let dealsWithStringIds = 0;
    let dealsWithObjects = 0;
    
    dealsSnapshot.docs.forEach(doc => {
      const data = doc.data();
      const associations = data.associations || {};
      
      if (Object.keys(associations).length > 0) {
        dealsWithAssociations++;
        
        // Check each association type
        ['contacts', 'salespeople', 'companies'].forEach(type => {
          const items = associations[type] || [];
          if (items.length > 0) {
            const hasStringIds = items.some(item => typeof item === 'string');
            const hasObjects = items.some(item => typeof item === 'object' && item.id);
            
            if (hasStringIds) {
              dealsWithStringIds++;
              console.log(`  - Deal ${doc.id}: ${type} has string IDs (${items.length} items)`);
            }
            if (hasObjects) {
              dealsWithObjects++;
              console.log(`  - Deal ${doc.id}: ${type} has objects (${items.length} items)`);
            }
          }
        });
      }
    });
    
    console.log(`\n📈 Summary for deals:`);
    console.log(`  - Deals with associations: ${dealsWithAssociations}`);
    console.log(`  - Deals with string IDs: ${dealsWithStringIds}`);
    console.log(`  - Deals with objects: ${dealsWithObjects}`);
    
    // Check contacts
    console.log('\n📊 Checking contacts...');
    const contactsRef = db.collection('tenants').doc(tenantId).collection('crm_contacts');
    const contactsSnapshot = await contactsRef.limit(5).get();
    
    let contactsWithAssociations = 0;
    let contactsWithStringIds = 0;
    let contactsWithObjects = 0;
    
    contactsSnapshot.docs.forEach(doc => {
      const data = doc.data();
      const associations = data.associations || {};
      
      if (Object.keys(associations).length > 0) {
        contactsWithAssociations++;
        
        ['deals', 'companies', 'salespeople'].forEach(type => {
          const items = associations[type] || [];
          if (items.length > 0) {
            const hasStringIds = items.some(item => typeof item === 'string');
            const hasObjects = items.some(item => typeof item === 'object' && item.id);
            
            if (hasStringIds) {
              contactsWithStringIds++;
              console.log(`  - Contact ${doc.id}: ${type} has string IDs (${items.length} items)`);
            }
            if (hasObjects) {
              contactsWithObjects++;
              console.log(`  - Contact ${doc.id}: ${type} has objects (${items.length} items)`);
            }
          }
        });
      }
    });
    
    console.log(`\n📈 Summary for contacts:`);
    console.log(`  - Contacts with associations: ${contactsWithAssociations}`);
    console.log(`  - Contacts with string IDs: ${contactsWithStringIds}`);
    console.log(`  - Contacts with objects: ${contactsWithObjects}`);
    
    // Check companies
    console.log('\n📊 Checking companies...');
    const companiesRef = db.collection('tenants').doc(tenantId).collection('crm_companies');
    const companiesSnapshot = await companiesRef.limit(5).get();
    
    let companiesWithAssociations = 0;
    let companiesWithStringIds = 0;
    let companiesWithObjects = 0;
    
    companiesSnapshot.docs.forEach(doc => {
      const data = doc.data();
      const associations = data.associations || {};
      
      if (Object.keys(associations).length > 0) {
        companiesWithAssociations++;
        
        ['deals', 'contacts', 'salespeople'].forEach(type => {
          const items = associations[type] || [];
          if (items.length > 0) {
            const hasStringIds = items.some(item => typeof item === 'string');
            const hasObjects = items.some(item => typeof item === 'object' && item.id);
            
            if (hasStringIds) {
              companiesWithStringIds++;
              console.log(`  - Company ${doc.id}: ${type} has string IDs (${items.length} items)`);
            }
            if (hasObjects) {
              companiesWithObjects++;
              console.log(`  - Company ${doc.id}: ${type} has objects (${items.length} items)`);
            }
          }
        });
      }
    });
    
    console.log(`\n📈 Summary for companies:`);
    console.log(`  - Companies with associations: ${companiesWithAssociations}`);
    console.log(`  - Companies with string IDs: ${companiesWithStringIds}`);
    console.log(`  - Companies with objects: ${companiesWithObjects}`);
    
    console.log('\n✅ Association structure check completed!');
    
  } catch (error) {
    console.error('❌ Error checking associations:', error);
  }
}

// Run the check
checkAssociations();

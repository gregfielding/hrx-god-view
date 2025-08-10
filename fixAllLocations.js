const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, getDoc, writeBatch } = require('firebase/firestore');

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBxQJqXqXqXqXqXqXqXqXqXqXqXqXqXqXq",
  authDomain: "hrx-god-view.firebaseapp.com",
  projectId: "hrx-god-view",
  storageBucket: "hrx-god-view.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdefghijklmnop"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const fixAllLocations = async () => {
  try {
    console.log('🔧 Starting to fix all locations...');
    
    // Get all tenants
    const tenantsSnapshot = await getDocs(collection(db, 'tenants'));
    console.log(`Found ${tenantsSnapshot.docs.length} tenants`);
    
    let totalFixed = 0;
    let totalErrors = 0;
    
    for (const tenantDoc of tenantsSnapshot.docs) {
      const tenantId = tenantDoc.id;
      console.log(`\n🔍 Processing tenant: ${tenantId}`);
      
      try {
        // Get all companies in this tenant
        const companiesSnapshot = await getDocs(collection(db, 'tenants', tenantId, 'crm_companies'));
        console.log(`Found ${companiesSnapshot.docs.length} companies in tenant ${tenantId}`);
        
        for (const companyDoc of companiesSnapshot.docs) {
          const companyId = companyDoc.id;
          console.log(`\n📍 Processing company: ${companyId}`);
          
          try {
            // Get all locations for this company
            const locationsSnapshot = await getDocs(collection(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations'));
            console.log(`Found ${locationsSnapshot.docs.length} locations in company ${companyId}`);
            
            for (const locationDoc of locationsSnapshot.docs) {
              const locationId = locationDoc.id;
              const locationData = locationDoc.data();
              
              console.log(`🔍 Processing location: ${locationId} - ${locationData.name || 'Unnamed'}`);
              
              // Update all denormalized associations that reference this location
              await updateDenormalizedAssociationsWithLocation(tenantId, locationId, locationData);
              totalFixed++;
            }
          } catch (companyError) {
            console.error(`❌ Error processing company ${companyId}:`, companyError.message);
            totalErrors++;
          }
        }
      } catch (tenantError) {
        console.error(`❌ Error processing tenant ${tenantId}:`, tenantError.message);
        totalErrors++;
      }
    }
    
    console.log(`\n✅ Fix complete!`);
    console.log(`📊 Summary:`);
    console.log(`   - Total locations fixed: ${totalFixed}`);
    console.log(`   - Total errors: ${totalErrors}`);
    
  } catch (error) {
    console.error('❌ Error in fixAllLocations:', error);
  }
};

const updateDenormalizedAssociationsWithLocation = async (tenantId, locationId, locationData) => {
  try {
    // Get all deals in this tenant
    const dealsSnapshot = await getDocs(collection(db, 'tenants', tenantId, 'crm_deals'));
    
    for (const dealDoc of dealsSnapshot.docs) {
      const dealId = dealDoc.id;
      const dealData = dealDoc.data();
      
      // Check if this deal has denormalized associations
      if (dealData.denormalizedAssociations && dealData.denormalizedAssociations.locations) {
        const locations = dealData.denormalizedAssociations.locations;
        let updated = false;
        
        // Check if this location is referenced in the associations
        const updatedLocations = locations.map(location => {
          const locId = typeof location === 'string' ? location : location.id;
          
          if (locId === locationId) {
            console.log(`🔄 Updating location ${locationId} in deal ${dealId}`);
            updated = true;
            return {
              id: locationId,
              name: locationData.name || `Location ${locationId}`,
              address: locationData.address || locationData.title || '',
              ...locationData
            };
          }
          return location;
        });
        
        if (updated) {
          // Update the deal with the fixed associations
          const batch = writeBatch(db);
          const dealRef = doc(db, 'tenants', tenantId, 'crm_deals', dealId);
          batch.update(dealRef, {
            'denormalizedAssociations.locations': updatedLocations
          });
          await batch.commit();
          console.log(`✅ Updated deal ${dealId} with location data`);
        }
      }
    }
    
    // Also check contacts and other entities that might have location associations
    const contactsSnapshot = await getDocs(collection(db, 'tenants', tenantId, 'crm_contacts'));
    
    for (const contactDoc of contactsSnapshot.docs) {
      const contactId = contactDoc.id;
      const contactData = contactDoc.data();
      
      if (contactData.denormalizedAssociations && contactData.denormalizedAssociations.locations) {
        const locations = contactData.denormalizedAssociations.locations;
        let updated = false;
        
        const updatedLocations = locations.map(location => {
          const locId = typeof location === 'string' ? location : location.id;
          
          if (locId === locationId) {
            console.log(`🔄 Updating location ${locationId} in contact ${contactId}`);
            updated = true;
            return {
              id: locationId,
              name: locationData.name || `Location ${locationId}`,
              address: locationData.address || locationData.title || '',
              ...locationData
            };
          }
          return location;
        });
        
        if (updated) {
          const batch = writeBatch(db);
          const contactRef = doc(db, 'tenants', tenantId, 'crm_contacts', contactId);
          batch.update(contactRef, {
            'denormalizedAssociations.locations': updatedLocations
          });
          await batch.commit();
          console.log(`✅ Updated contact ${contactId} with location data`);
        }
      }
    }
    
  } catch (error) {
    console.error(`❌ Error updating associations for location ${locationId}:`, error);
  }
};

// Run the script
console.log('🚀 Starting location fix script...');
fixAllLocations().then(() => {
  console.log('✅ Script completed');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});

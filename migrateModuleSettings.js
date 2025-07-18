const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc, setDoc, collection, getDocs } = require('firebase/firestore');

// Your Firebase config
const firebaseConfig = {
  // Add your Firebase config here
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function migrateModuleSettings() {
  try {
    console.log('Starting module settings migration...');
    
    // Get all tenants
    const tenantsRef = collection(db, 'tenants');
    const tenantsSnap = await getDocs(tenantsRef);
    
    for (const tenantDoc of tenantsSnap.docs) {
      const tenantId = tenantDoc.id;
      console.log(`Processing tenant: ${tenantId}`);
      
      // Check if old module settings exist
      const oldModulesRef = doc(db, 'tenants', tenantId, 'aiSettings', 'modules');
      const oldModulesSnap = await getDoc(oldModulesRef);
      
      if (oldModulesSnap.exists()) {
        const oldData = oldModulesSnap.data();
        const modules = oldData.modules || [];
        
        console.log(`Found ${modules.length} modules for tenant ${tenantId}`);
        
        // Create new subcollection structure
        for (const module of modules) {
          if (module.id) {
            const newModuleRef = doc(db, 'tenants', tenantId, 'modules', module.id);
            
            // Prepare the new module document
            const newModuleData = {
              isEnabled: module.isEnabled !== undefined ? module.isEnabled : true,
              settings: module.settings || {},
              customSettings: module.customSettings || {},
              lastUpdated: new Date().toISOString(),
            };
            
            // Save to new structure
            await setDoc(newModuleRef, newModuleData, { merge: true });
            console.log(`Migrated module ${module.id} for tenant ${tenantId}`);
          }
        }
        
        console.log(`Completed migration for tenant ${tenantId}`);
      } else {
        console.log(`No old module settings found for tenant ${tenantId}`);
      }
    }
    
    console.log('Migration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
  }
}

// Run the migration
migrateModuleSettings(); 
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, getDocs, doc, addDoc, where } = require('firebase/firestore');

// Firebase configuration
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

// Salesperson mapping
const SALESPERSON_MAPPING = {
  'Donna Persson': 'vEdJeKRlcgOs3FoI57EfBkP5Ewp1',
  // Add more mappings as needed
  // 'John Doe': 'user_id_here',
  // 'Jane Smith': 'user_id_here',
};

async function createExplicitAssociations() {
  try {
    console.log('🔍 Starting explicit association creation process...');
    
    // Get all tenants
    const tenantsSnapshot = await getDocs(collection(db, 'tenants'));
    const tenants = tenantsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    console.log(`📊 Found ${tenants.length} tenants`);
    
    let totalAssociationsCreated = 0;
    let totalErrors = 0;
    
    for (const tenant of tenants) {
      console.log(`\n🏢 Processing tenant: ${tenant.name || tenant.id}`);
      
      try {
        // Get all deals for this tenant that have salespeopleIds
        const dealsRef = collection(db, 'tenants', tenant.id, 'crm_deals');
        const dealsSnapshot = await getDocs(dealsRef);
        const deals = dealsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        console.log(`📋 Found ${deals.length} deals for tenant ${tenant.name || tenant.id}`);
        
        for (const deal of deals) {
          try {
            // Check if deal has salespeopleIds
            if (!deal.salespeopleIds || deal.salespeopleIds.length === 0) {
              console.log(`⚠️ Deal ${deal.id} has no salespeopleIds, skipping`);
              continue;
            }
            
            console.log(`🔗 Creating explicit associations for deal ${deal.id} (${deal.name})`);
            
            // Create explicit associations for each salesperson
            for (const salespersonId of deal.salespeopleIds) {
              const associationData = {
                sourceEntityType: 'deal',
                sourceEntityId: deal.id,
                targetEntityType: 'salesperson',
                targetEntityId: salespersonId,
                associationType: 'assignment',
                strength: 'strong',
                metadata: {
                  source: 'salespeopleIds_field',
                  dealName: deal.name,
                  salesOwnerName: deal.salesOwnerName || 'unknown'
                },
                createdAt: new Date(),
                updatedAt: new Date()
              };
              
              // Add to crm_associations collection
              const associationsRef = collection(db, 'tenants', tenant.id, 'crm_associations');
              await addDoc(associationsRef, associationData);
              
              console.log(`✅ Created association: deal ${deal.id} → salesperson ${salespersonId}`);
              totalAssociationsCreated++;
            }
            
          } catch (dealError) {
            console.error(`❌ Error processing deal ${deal.id}:`, dealError.message);
            totalErrors++;
          }
        }
        
      } catch (tenantError) {
        console.error(`❌ Error processing tenant ${tenant.id}:`, tenantError.message);
        totalErrors++;
      }
    }
    
    console.log(`\n📊 Explicit Association Creation Complete:`);
    console.log(`   Total associations created: ${totalAssociationsCreated}`);
    console.log(`   Total errors: ${totalErrors}`);
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
  }
}

// Run the script
createExplicitAssociations()
  .then(() => {
    console.log('✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  }); 
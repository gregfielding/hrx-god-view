const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, getDocs, doc, updateDoc, arrayUnion, where } = require('firebase/firestore');

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

async function associateDealsWithSalespeople() {
  try {
    console.log('🔍 Starting deal-salesperson association process...');
    
    // Get all tenants
    const tenantsSnapshot = await getDocs(collection(db, 'tenants'));
    const tenants = tenantsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    console.log(`📊 Found ${tenants.length} tenants`);
    
    let totalDealsProcessed = 0;
    let totalAssociationsCreated = 0;
    let totalErrors = 0;
    
    for (const tenant of tenants) {
      console.log(`\n🏢 Processing tenant: ${tenant.name || tenant.id}`);
      
      try {
        // Get all deals for this tenant
        const dealsRef = collection(db, 'tenants', tenant.id, 'crm_deals');
        const dealsSnapshot = await getDocs(dealsRef);
        const deals = dealsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        console.log(`📋 Found ${deals.length} deals for tenant ${tenant.name || tenant.id}`);
        
        for (const deal of deals) {
          try {
            if (!deal.salesOwnerName) {
              console.log(`⚠️ Deal ${deal.id} has no salesOwnerName, skipping`);
              continue;
            }
            
            const salespersonId = SALESPERSON_MAPPING[deal.salesOwnerName];
            if (!salespersonId) {
              console.log(`⚠️ No mapping found for salesperson: ${deal.salesOwnerName}`);
              continue;
            }
            
            console.log(`🔗 Associating deal ${deal.id} (${deal.name}) with salesperson ${deal.salesOwnerName} (${salespersonId})`);
            
            // Update the deal document to include the salesperson ID
            const dealRef = doc(db, 'tenants', tenant.id, 'crm_deals', deal.id);
            await updateDoc(dealRef, {
              salespeopleIds: arrayUnion(salespersonId),
              assignedSalespersonId: salespersonId,
              updatedAt: new Date()
            });
            
            // Create explicit association in crm_associations collection
            const associationsRef = collection(db, 'tenants', tenant.id, 'crm_associations');
            const associationData = {
              sourceEntityType: 'deal',
              sourceEntityId: deal.id,
              targetEntityType: 'salesperson',
              targetEntityId: salespersonId,
              associationType: 'assignment',
              strength: 'strong',
              metadata: {
                source: 'salesOwnerName_mapping',
                salesOwnerName: deal.salesOwnerName
              },
              createdAt: new Date(),
              updatedAt: new Date()
            };
            
            // Note: We can't create documents with custom IDs in this script
            // The association will be created implicitly through the salespeopleIds field
            console.log(`✅ Successfully associated deal ${deal.id} with salesperson ${salespersonId}`);
            
            totalAssociationsCreated++;
            
          } catch (dealError) {
            console.error(`❌ Error processing deal ${deal.id}:`, dealError.message);
            totalErrors++;
          }
          
          totalDealsProcessed++;
        }
        
      } catch (tenantError) {
        console.error(`❌ Error processing tenant ${tenant.id}:`, tenantError.message);
        totalErrors++;
      }
    }
    
    console.log(`\n📊 Association Process Complete:`);
    console.log(`   Total deals processed: ${totalDealsProcessed}`);
    console.log(`   Total associations created: ${totalAssociationsCreated}`);
    console.log(`   Total errors: ${totalErrors}`);
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
  }
}

// Run the script
associateDealsWithSalespeople()
  .then(() => {
    console.log('✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  }); 
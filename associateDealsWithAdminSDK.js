const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
const serviceAccount = require('./firebase copy.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

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
    const tenantsSnapshot = await db.collection('tenants').get();
    const tenants = tenantsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    console.log(`📊 Found ${tenants.length} tenants`);
    
    let totalDealsProcessed = 0;
    let totalAssociationsCreated = 0;
    let totalErrors = 0;
    
    for (const tenant of tenants) {
      console.log(`\n🏢 Processing tenant: ${tenant.name || tenant.id}`);
      
      try {
        // Get all deals for this tenant
        const dealsSnapshot = await db.collection('tenants').doc(tenant.id).collection('crm_deals').get();
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
            const dealRef = db.collection('tenants').doc(tenant.id).collection('crm_deals').doc(deal.id);
            await dealRef.update({
              salespeopleIds: admin.firestore.FieldValue.arrayUnion(salespersonId),
              assignedSalespersonId: salespersonId,
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            
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
    
    console.log(`\n📊 Deal Association Process Complete:`);
    console.log(`   Total deals processed: ${totalDealsProcessed}`);
    console.log(`   Total associations created: ${totalAssociationsCreated}`);
    console.log(`   Total errors: ${totalErrors}`);
    
    return { totalAssociationsCreated, totalErrors };
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
    throw error;
  }
}

async function createExplicitAssociations() {
  try {
    console.log('\n🔍 Starting explicit association creation process...');
    
    // Get all tenants
    const tenantsSnapshot = await db.collection('tenants').get();
    const tenants = tenantsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    let totalAssociationsCreated = 0;
    let totalErrors = 0;
    
    for (const tenant of tenants) {
      console.log(`\n🏢 Processing tenant: ${tenant.name || tenant.id}`);
      
      try {
        // Get all deals for this tenant that have salespeopleIds
        const dealsSnapshot = await db.collection('tenants').doc(tenant.id).collection('crm_deals').get();
        const deals = dealsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        for (const deal of deals) {
          try {
            // Check if deal has salespeopleIds
            if (!deal.salespeopleIds || deal.salespeopleIds.length === 0) {
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
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
              };
              
              // Add to crm_associations collection
              const associationsRef = db.collection('tenants').doc(tenant.id).collection('crm_associations');
              await associationsRef.add(associationData);
              
              console.log(`✅ Created explicit association: deal ${deal.id} → salesperson ${salespersonId}`);
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
    console.log(`   Total explicit associations created: ${totalAssociationsCreated}`);
    console.log(`   Total errors: ${totalErrors}`);
    
    return { totalAssociationsCreated, totalErrors };
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
    throw error;
  }
}

async function runCompleteAssociationProcess() {
  try {
    console.log('🚀 Starting complete deal-salesperson association process...\n');
    
    // Step 1: Associate deals with salespeople
    const step1Results = await associateDealsWithSalespeople();
    
    // Step 2: Create explicit associations
    const step2Results = await createExplicitAssociations();
    
    console.log('\n🎉 Complete Association Process Summary:');
    console.log(`   Step 1 - Deal associations: ${step1Results.totalAssociationsCreated}`);
    console.log(`   Step 2 - Explicit associations: ${step2Results.totalAssociationsCreated}`);
    console.log(`   Total errors: ${step1Results.totalErrors + step2Results.totalErrors}`);
    
  } catch (error) {
    console.error('❌ Complete process failed:', error);
    throw error;
  }
}

// Run the complete script
runCompleteAssociationProcess()
  .then(() => {
    console.log('✅ Complete script finished successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Complete script failed:', error);
    process.exit(1);
  }); 
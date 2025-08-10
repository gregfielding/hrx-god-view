import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

// Salesperson mapping
const SALESPERSON_MAPPING: { [key: string]: string } = {
  'Donna Persson': 'vEdJeKRlcgOs3FoI57EfBkP5Ewp1',
  'Irene Castaneda': 'zlx8F28okWMRdFSbyPWdQfV7eQS2',
  'Jas\'myne Robinson': '9tQ3JI21HCQluuNeXGsnnDZPDZk1',
  'Greg Fielding': 'zazCFZdVZMTX3AJZsVmrYzHmb6Q2',
  // Add more mappings as needed
  // 'John Doe': 'user_id_here',
  // 'Jane Smith': 'user_id_here',
};

// Type definitions
interface Tenant {
  id: string;
  name?: string;
  [key: string]: any;
}

interface Deal {
  id: string;
  name?: string;
  salesOwnerName?: string;
  salespeopleIds?: string[];
  [key: string]: any;
}

export const associateDealsWithSalespeople = functions.https.onCall(async (data, context) => {
  try {
    console.log('🔍 Starting deal-salesperson association process...');
    
    // Get all tenants
    const tenantsSnapshot = await admin.firestore().collection('tenants').get();
    const tenants = tenantsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Tenant[];
    
    console.log(`📊 Found ${tenants.length} tenants`);
    
    let totalDealsProcessed = 0;
    let totalAssociationsCreated = 0;
    let totalErrors = 0;
    
    for (const tenant of tenants) {
      console.log(`\n🏢 Processing tenant: ${tenant.name || tenant.id}`);
      
      try {
        // Get all deals for this tenant
        const dealsSnapshot = await admin.firestore()
          .collection('tenants')
          .doc(tenant.id)
          .collection('crm_deals')
          .get();
        
        const deals = dealsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Deal[];
        
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
            const dealRef = admin.firestore()
              .collection('tenants')
              .doc(tenant.id)
              .collection('crm_deals')
              .doc(deal.id);
            
            await dealRef.update({
              salespeopleIds: admin.firestore.FieldValue.arrayUnion(salespersonId),
              assignedSalespersonId: salespersonId,
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            
            console.log(`✅ Successfully associated deal ${deal.id} with salesperson ${salespersonId}`);
            
            totalAssociationsCreated++;
            
          } catch (dealError: any) {
            console.error(`❌ Error processing deal ${deal.id}:`, dealError.message);
            totalErrors++;
          }
          
          totalDealsProcessed++;
        }
        
      } catch (tenantError: any) {
        console.error(`❌ Error processing tenant ${tenant.id}:`, tenantError.message);
        totalErrors++;
      }
    }
    
    console.log(`\n📊 Deal Association Process Complete:`);
    console.log(`   Total deals processed: ${totalDealsProcessed}`);
    console.log(`   Total associations created: ${totalAssociationsCreated}`);
    console.log(`   Total errors: ${totalErrors}`);
    
    return {
      success: true,
      totalDealsProcessed,
      totalAssociationsCreated,
      totalErrors
    };
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
    throw new functions.https.HttpsError('internal', 'Failed to associate deals with salespeople', error);
  }
});

export const createExplicitAssociations = functions.https.onCall(async (data, context) => {
  try {
    console.log('🔍 Starting explicit association creation process...');
    
    // Get all tenants
    const tenantsSnapshot = await admin.firestore().collection('tenants').get();
    const tenants = tenantsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Tenant[];
    
    let totalAssociationsCreated = 0;
    let totalErrors = 0;
    
    for (const tenant of tenants) {
      console.log(`\n🏢 Processing tenant: ${tenant.name || tenant.id}`);
      
      try {
        // Get all deals for this tenant that have salespeopleIds
        const dealsSnapshot = await admin.firestore()
          .collection('tenants')
          .doc(tenant.id)
          .collection('crm_deals')
          .get();
        
        const deals = dealsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Deal[];
        
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
              const associationsRef = admin.firestore()
                .collection('tenants')
                .doc(tenant.id)
                .collection('crm_associations');
              
              await associationsRef.add(associationData);
              
              console.log(`✅ Created explicit association: deal ${deal.id} → salesperson ${salespersonId}`);
              totalAssociationsCreated++;
            }
            
          } catch (dealError: any) {
            console.error(`❌ Error processing deal ${deal.id}:`, dealError.message);
            totalErrors++;
          }
        }
        
      } catch (tenantError: any) {
        console.error(`❌ Error processing tenant ${tenant.id}:`, tenantError.message);
        totalErrors++;
      }
    }
    
    console.log(`\n📊 Explicit Association Creation Complete:`);
    console.log(`   Total explicit associations created: ${totalAssociationsCreated}`);
    console.log(`   Total errors: ${totalErrors}`);
    
    return {
      success: true,
      totalAssociationsCreated,
      totalErrors
    };
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
    throw new functions.https.HttpsError('internal', 'Failed to create explicit associations', error);
  }
}); 
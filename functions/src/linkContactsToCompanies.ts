import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

export const linkContactsToCompanies = onCall(async (request) => {
  try {
    console.log('🔗 Starting Contact-Company Linking Process...');

    const db = admin.firestore();
    let totalProcessed = 0;
    let totalLinked = 0;
    let totalErrors = 0;
    const results: any[] = [];

    // Get all tenants
    const tenantsSnapshot = await db.collection('tenants').get();
    
    if (tenantsSnapshot.empty) {
      console.log('❌ No tenants found');
      return { success: false, message: 'No tenants found' };
    }

    for (const tenantDoc of tenantsSnapshot.docs) {
      const tenantId = tenantDoc.id;
      console.log(`\n🏢 Processing Tenant: ${tenantId}`);

      try {
        // Get all companies for this tenant
        const companiesSnapshot = await db.collection('tenants').doc(tenantId).collection('crm_companies').get();
        
        if (companiesSnapshot.empty) {
          console.log(`  ℹ️  No companies found for tenant ${tenantId}`);
          results.push({
            tenantId,
            status: 'no_companies',
            message: 'No companies found'
          });
          continue;
        }

        // Create a map of externalId to company document ID
        const companyMap = new Map();
        companiesSnapshot.docs.forEach(companyDoc => {
          const companyData = companyDoc.data();
          if (companyData.externalId) {
            companyMap.set(companyData.externalId, companyDoc.id);
            console.log(`  📋 Company: ${companyData.companyName || companyData.name} (External ID: ${companyData.externalId} → Document ID: ${companyDoc.id})`);
          }
        });

        console.log(`  📊 Found ${companyMap.size} companies with external IDs`);

        // Get all contacts for this tenant
        const contactsSnapshot = await db.collection('tenants').doc(tenantId).collection('crm_contacts').get();
        
        if (contactsSnapshot.empty) {
          console.log(`  ℹ️  No contacts found for tenant ${tenantId}`);
          results.push({
            tenantId,
            status: 'no_contacts',
            message: 'No contacts found'
          });
          continue;
        }

        console.log(`  👥 Found ${contactsSnapshot.docs.length} contacts`);

        // Process contacts that need linking
        let batch = db.batch();
        let batchCount = 0;
        const maxBatchSize = 500; // Firestore batch limit
        let tenantLinked = 0;
        let tenantErrors = 0;

        for (const contactDoc of contactsSnapshot.docs) {
          const contactData = contactDoc.data();
          const contactId = contactDoc.id;
          
          // Check if contact has externalCompanyId
          if (contactData.externalCompanyId) {
            const externalCompanyId = contactData.externalCompanyId;
            const targetCompanyId = companyMap.get(externalCompanyId);
            
            if (targetCompanyId) {
              // Check if contact is already properly linked
              if (contactData.companyId !== targetCompanyId) {
                console.log(`  🔗 Linking contact: ${contactData.fullName || 'Unknown'} (External Company ID: ${externalCompanyId} → Company Document ID: ${targetCompanyId})`);
                
                // Update the contact's companyId
                const contactRef = db.collection('tenants').doc(tenantId).collection('crm_contacts').doc(contactId);
                batch.update(contactRef, {
                  companyId: targetCompanyId,
                  updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                
                batchCount++;
                totalLinked++;
                tenantLinked++;
                
                // Commit batch if it reaches the limit
                if (batchCount >= maxBatchSize) {
                  await batch.commit();
                  console.log(`  ✅ Committed batch of ${batchCount} updates`);
                  batchCount = 0;
                  batch = db.batch(); // Create new batch
                }
              } else {
                console.log(`  ✅ Contact already linked: ${contactData.fullName || 'Unknown'} (Company ID: ${contactData.companyId})`);
              }
            } else {
              console.log(`  ⚠️  No matching company found for contact: ${contactData.fullName || 'Unknown'} (External Company ID: ${externalCompanyId})`);
              totalErrors++;
              tenantErrors++;
            }
          } else {
            console.log(`  ℹ️  Contact has no externalCompanyId: ${contactData.fullName || 'Unknown'}`);
          }
          
          totalProcessed++;
        }

        // Commit any remaining updates in the batch
        if (batchCount > 0) {
          await batch.commit();
          console.log(`  ✅ Committed final batch of ${batchCount} updates`);
        }

        console.log(`  📈 Tenant ${tenantId} Summary:`);
        console.log(`     - Total contacts processed: ${contactsSnapshot.docs.length}`);
        console.log(`     - Contacts linked: ${tenantLinked}`);
        console.log(`     - Errors: ${tenantErrors}`);

        results.push({
          tenantId,
          status: 'success',
          totalContacts: contactsSnapshot.docs.length,
          contactsLinked: tenantLinked,
          errors: tenantErrors,
          companiesFound: companyMap.size
        });

             } catch (error) {
         console.error(`  ❌ Error processing tenant ${tenantId}:`, error);
         totalErrors++;
         results.push({
           tenantId,
           status: 'error',
           error: error instanceof Error ? error.message : 'Unknown error'
         });
       }
    }

    console.log('\n' + '='.repeat(60));
    console.log('🎯 LINKING PROCESS COMPLETE');
    console.log('='.repeat(60));
    console.log(`📊 Final Summary:`);
    console.log(`   - Total contacts processed: ${totalProcessed}`);
    console.log(`   - Total contacts linked: ${totalLinked}`);
    console.log(`   - Total errors: ${totalErrors}`);
    console.log(`   - Success rate: ${totalProcessed > 0 ? ((totalLinked / totalProcessed) * 100).toFixed(1) : 0}%`);

    return {
      success: true,
      summary: {
        totalProcessed,
        totalLinked,
        totalErrors,
        successRate: totalProcessed > 0 ? ((totalLinked / totalProcessed) * 100).toFixed(1) : 0
      },
      results
    };

     } catch (error) {
     console.error('❌ Fatal error during linking process:', error);
     return {
       success: false,
       error: error instanceof Error ? error.message : 'Unknown error'
     };
   }
}); 
import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

export const linkCRMEntities = onCall(async (request) => {
  try {
    console.log('🔗 Starting CRM Entity Linking Process...');

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
        // Step 1: Get all companies and create externalId to document ID mapping
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

        // Step 2: Link contacts to companies
        const contactsSnapshot = await db.collection('tenants').doc(tenantId).collection('crm_contacts').get();
        let contactsLinked = 0;
        let contactsErrors = 0;
        
        if (!contactsSnapshot.empty) {
          console.log(`  👥 Processing ${contactsSnapshot.docs.length} contacts`);
          
          let batch = db.batch();
          let batchCount = 0;
          const maxBatchSize = 500;

          for (const contactDoc of contactsSnapshot.docs) {
            const contactData = contactDoc.data();
            const contactId = contactDoc.id;
            
            if (contactData.externalCompanyId) {
              const externalCompanyId = contactData.externalCompanyId;
              const targetCompanyId = companyMap.get(externalCompanyId);
              
              if (targetCompanyId) {
                if (contactData.companyId !== targetCompanyId) {
                  console.log(`  🔗 Linking contact: ${contactData.fullName || 'Unknown'} (External Company ID: ${externalCompanyId} → Company Document ID: ${targetCompanyId})`);
                  
                  const contactRef = db.collection('tenants').doc(tenantId).collection('crm_contacts').doc(contactId);
                  batch.update(contactRef, {
                    companyId: targetCompanyId,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                  });
                  
                  batchCount++;
                  contactsLinked++;
                  
                  if (batchCount >= maxBatchSize) {
                    await batch.commit();
                    console.log(`  ✅ Committed batch of ${batchCount} contact updates`);
                    batchCount = 0;
                    batch = db.batch();
                  }
                } else {
                  console.log(`  ✅ Contact already linked: ${contactData.fullName || 'Unknown'}`);
                }
              } else {
                console.log(`  ⚠️  No matching company found for contact: ${contactData.fullName || 'Unknown'} (External Company ID: ${externalCompanyId})`);
                contactsErrors++;
              }
            }
            totalProcessed++;
          }

          if (batchCount > 0) {
            await batch.commit();
            console.log(`  ✅ Committed final batch of ${batchCount} contact updates`);
          }
        }

        // Step 3: Link deals to companies
        const dealsSnapshot = await db.collection('tenants').doc(tenantId).collection('crm_deals').get();
        let dealsLinked = 0;
        let dealsErrors = 0;
        
        if (!dealsSnapshot.empty) {
          console.log(`  💼 Processing ${dealsSnapshot.docs.length} deals`);
          
          let batch = db.batch();
          let batchCount = 0;
          const maxBatchSize = 500;

          for (const dealDoc of dealsSnapshot.docs) {
            const dealData = dealDoc.data();
            const dealId = dealDoc.id;
            
            if (dealData.externalCompanyId) {
              const externalCompanyId = dealData.externalCompanyId;
              const targetCompanyId = companyMap.get(externalCompanyId);
              
              if (targetCompanyId) {
                if (dealData.companyId !== targetCompanyId) {
                  console.log(`  🔗 Linking deal: ${dealData.name || 'Unknown'} (External Company ID: ${externalCompanyId} → Company Document ID: ${targetCompanyId})`);
                  
                  const dealRef = db.collection('tenants').doc(tenantId).collection('crm_deals').doc(dealId);
                  batch.update(dealRef, {
                    companyId: targetCompanyId,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                  });
                  
                  batchCount++;
                  dealsLinked++;
                  
                  if (batchCount >= maxBatchSize) {
                    await batch.commit();
                    console.log(`  ✅ Committed batch of ${batchCount} deal updates`);
                    batchCount = 0;
                    batch = db.batch();
                  }
                } else {
                  console.log(`  ✅ Deal already linked: ${dealData.name || 'Unknown'}`);
                }
              } else {
                console.log(`  ⚠️  No matching company found for deal: ${dealData.name || 'Unknown'} (External Company ID: ${externalCompanyId})`);
                dealsErrors++;
              }
            }
          }

          if (batchCount > 0) {
            await batch.commit();
            console.log(`  ✅ Committed final batch of ${batchCount} deal updates`);
          }
        }

        // Step 4: Link deals to contacts (if deals have contactIds)
        let dealContactLinks = 0;
        if (!dealsSnapshot.empty && !contactsSnapshot.empty) {
          console.log(`  🔗 Processing deal-contact relationships`);
          
          // Create a map of contact externalId to document ID
          const contactMap = new Map();
          contactsSnapshot.docs.forEach(contactDoc => {
            const contactData = contactDoc.data();
            if (contactData.externalId) {
              contactMap.set(contactData.externalId, contactDoc.id);
            }
          });

                     let batch = db.batch();
           let batchCount = 0;
           const maxBatchSize = 500;

           for (const dealDoc of dealsSnapshot.docs) {
            const dealData = dealDoc.data();
            const dealId = dealDoc.id;
            
            // Check if deal has external contact IDs that need to be converted to document IDs
            if (dealData.externalContactIds && Array.isArray(dealData.externalContactIds)) {
              const validContactIds = dealData.externalContactIds
                .map((externalContactId: string) => contactMap.get(externalContactId))
                .filter((contactId: string) => contactId); // Remove undefined values
              
              if (validContactIds.length > 0) {
                console.log(`  🔗 Linking deal ${dealData.name || 'Unknown'} to ${validContactIds.length} contacts`);
                
                const dealRef = db.collection('tenants').doc(tenantId).collection('crm_deals').doc(dealId);
                batch.update(dealRef, {
                  contactIds: validContactIds,
                  updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                
                batchCount++;
                dealContactLinks++;
                
                if (batchCount >= maxBatchSize) {
                  await batch.commit();
                  console.log(`  ✅ Committed batch of ${batchCount} deal-contact updates`);
                  batchCount = 0;
                  batch = db.batch();
                }
              }
            }
          }

          if (batchCount > 0) {
            await batch.commit();
            console.log(`  ✅ Committed final batch of ${batchCount} deal-contact updates`);
          }
        }

        totalLinked += contactsLinked + dealsLinked;
        totalErrors += contactsErrors + dealsErrors;

        console.log(`  📈 Tenant ${tenantId} Summary:`);
        console.log(`     - Companies found: ${companyMap.size}`);
        console.log(`     - Contacts linked: ${contactsLinked}`);
        console.log(`     - Deals linked: ${dealsLinked}`);
        console.log(`     - Deal-contact relationships: ${dealContactLinks}`);
        console.log(`     - Errors: ${contactsErrors + dealsErrors}`);

        results.push({
          tenantId,
          status: 'success',
          companiesFound: companyMap.size,
          contactsLinked,
          dealsLinked,
          dealContactLinks,
          errors: contactsErrors + dealsErrors
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
    console.log('🎯 CRM ENTITY LINKING PROCESS COMPLETE');
    console.log('='.repeat(60));
    console.log(`📊 Final Summary:`);
    console.log(`   - Total entities processed: ${totalProcessed}`);
    console.log(`   - Total entities linked: ${totalLinked}`);
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
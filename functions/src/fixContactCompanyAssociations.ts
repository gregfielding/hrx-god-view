import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

export const fixContactCompanyAssociations = onCall(async (request) => {
  // Check if user is authenticated
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { tenantId } = request.data;
  
      if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required');
    }

  console.log('🔧 Starting to fix contact-company associations...');
  console.log(`Tenant ID: ${tenantId}`);

  try {
    // Get all contacts that have a companyId but no company association
    const contactsRef = admin.firestore().collection(`tenants/${tenantId}/crm_contacts`);
    const contactsSnapshot = await contactsRef.get();
    
    console.log(`📊 Found ${contactsSnapshot.docs.length} total contacts`);
    
    let fixedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    for (const contactDoc of contactsSnapshot.docs) {
      const contact = contactDoc.data();
      const contactId = contactDoc.id;
      
      // Check if contact has a companyId
      if (contact.companyId) {
        console.log(`\n🔍 Processing contact: ${contact.fullName || contact.name} (${contactId})`);
        console.log(`   Company ID: ${contact.companyId}`);
        
        // Check if company association already exists
        const hasCompanyAssociation = contact.associations?.companies?.includes(contact.companyId);
        
        if (hasCompanyAssociation) {
          console.log(`   ✅ Company association already exists`);
          skippedCount++;
        } else {
          console.log(`   ❌ Missing company association, adding...`);
          
          try {
            // Add company to associations
            const contactRef = admin.firestore().doc(`tenants/${tenantId}/crm_contacts/${contactId}`);
            await contactRef.update({
              'associations.companies': admin.firestore.FieldValue.arrayUnion(contact.companyId)
            });
            
            console.log(`   ✅ Added company association`);
            fixedCount++;
            
            // Also add contact to company's associations (bidirectional)
            const companyRef = admin.firestore().doc(`tenants/${tenantId}/crm_companies/${contact.companyId}`);
            await companyRef.update({
              'associations.contacts': admin.firestore.FieldValue.arrayUnion(contactId)
            });
            
            console.log(`   ✅ Added contact to company's associations`);
            
          } catch (error) {
            console.error(`   ❌ Error updating contact ${contactId}:`, error);
            errorCount++;
          }
        }
      } else {
        console.log(`\n⏭️  Skipping contact ${contact.fullName || contact.name} - no companyId`);
        skippedCount++;
      }
    }
    
    const result = {
      fixed: fixedCount,
      skipped: skippedCount,
      errors: errorCount,
      total: contactsSnapshot.docs.length
    };
    
    console.log(`\n🎉 Fix completed!`);
    console.log(`✅ Fixed: ${fixedCount} contacts`);
    console.log(`⏭️  Skipped: ${skippedCount} contacts`);
    console.log(`❌ Errors: ${errorCount} contacts`);
    
    return result;
    
  } catch (error) {
    console.error('❌ Error in fixContactCompanyAssociations:', error);
    throw new HttpsError('internal', 'Error fixing contact-company associations');
  }
}); 
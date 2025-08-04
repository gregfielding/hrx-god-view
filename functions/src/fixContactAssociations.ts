import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';

const db = getFirestore();

export const fixContactAssociations = onCall(async (request) => {
  try {
    const { tenantId } = request.data;
    
    if (!tenantId) {
      return {
        success: false,
        message: 'Tenant ID is required'
      };
    }

    console.log(`🔍 Starting contact-company associations fix for tenant: ${tenantId}`);
    
    // Get all contacts for the tenant
    const contactsRef = db.collection('tenants').doc(tenantId).collection('crm_contacts');
    const contactsSnapshot = await contactsRef.get();
    
    if (contactsSnapshot.empty) {
      return {
        success: true,
        message: 'No contacts found for this tenant',
        fixedCount: 0
      };
    }
    
    console.log(`📊 Found ${contactsSnapshot.docs.length} contacts to process`);
    
    let fixedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    // Process each contact
    for (const contactDoc of contactsSnapshot.docs) {
      const contactId = contactDoc.id;
      const contactData = contactDoc.data();
      
      try {
        // Check if contact has companyId but no associations.companies
        const hasCompanyId = contactData.companyId && contactData.companyId.trim() !== '';
        const hasCompanyAssociations = contactData.associations && 
                                     contactData.associations.companies && 
                                     contactData.associations.companies.length > 0;
        
        if (hasCompanyId && !hasCompanyAssociations) {
          console.log(`  🏢 Found companyId: ${contactData.companyId} for contact: ${contactData.fullName || contactId}`);
          
          // Verify the company exists
          const companyRef = db.collection('tenants').doc(tenantId).collection('crm_companies').doc(contactData.companyId);
          const companyDoc = await companyRef.get();
          
          if (!companyDoc.exists) {
            console.log(`  ⚠️ Company ${contactData.companyId} not found, skipping`);
            skippedCount++;
            continue;
          }
          
          console.log(`  ✅ Company exists: ${companyDoc.data()?.companyName || companyDoc.data()?.name}`);
          
          // Initialize associations object if it doesn't exist
          const associations = contactData.associations || {};
          associations.companies = associations.companies || [];
          
          // Add company to associations if not already there
          if (!associations.companies.includes(contactData.companyId)) {
            associations.companies.push(contactData.companyId);
            
            // Update the contact document
            await contactDoc.ref.update({
              associations: associations,
              updatedAt: new Date()
            });
            
            console.log(`  ✅ Added company association: ${contactData.companyId}`);
            fixedCount++;
          } else {
            console.log(`  ⏭️ Company already in associations`);
            skippedCount++;
          }
        } else if (!hasCompanyId) {
          console.log(`  ⏭️ No companyId found for contact: ${contactData.fullName || contactId}`);
          skippedCount++;
        } else if (hasCompanyAssociations) {
          console.log(`  ✅ Already has company associations for contact: ${contactData.fullName || contactId}`);
          skippedCount++;
        }
        
      } catch (error) {
        console.error(`  ❌ Error processing contact ${contactId}:`, error);
        errorCount++;
      }
    }
    
    console.log(`📊 Fix Summary - Fixed: ${fixedCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`);
    
    return {
      success: true,
      message: `Fixed ${fixedCount} contact associations`,
      fixedCount,
      skippedCount,
      errorCount,
      totalContacts: contactsSnapshot.docs.length
    };
    
  } catch (error) {
    console.error('❌ Error in fixContactAssociations:', error);
    return {
      success: false,
      message: `Failed to fix associations: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}); 
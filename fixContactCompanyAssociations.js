const admin = require('firebase-admin');

// Initialize Firebase Admin with default credentials
admin.initializeApp();

const db = admin.firestore();

// Configuration
const TENANT_ID = process.argv[2] || 'BCiP2bQ9CgVOCTfV6MhD';
const DRY_RUN = process.argv[3] !== 'false';

console.log('👤 Contact-Company Associations Fix Script');
console.log('========================================');
console.log(`Tenant ID: ${TENANT_ID}`);
console.log(`Dry Run: ${DRY_RUN}`);
console.log('');

async function fixContactCompanyAssociations() {
  try {
    console.log('🔍 Starting contact-company associations fix...');
    
    // Get all contacts for the tenant
    const contactsRef = db.collection('tenants').doc(TENANT_ID).collection('crm_contacts');
    const contactsSnapshot = await contactsRef.get();
    
    if (contactsSnapshot.empty) {
      console.log('❌ No contacts found for this tenant');
      return;
    }
    
    console.log(`📊 Found ${contactsSnapshot.docs.length} contacts to process`);
    
    const results = {
      totalContacts: contactsSnapshot.docs.length,
      contactsProcessed: 0,
      associationsFixed: 0,
      associationsSkipped: 0,
      errors: 0,
      details: []
    };
    
    // Process each contact
    for (const contactDoc of contactsSnapshot.docs) {
      const contactId = contactDoc.id;
      const contactData = contactDoc.data();
      
      console.log(`\n👤 Processing contact: ${contactData.fullName || `${contactData.firstName || ''} ${contactData.lastName || ''}`.trim() || contactId}`);
      
      try {
        // Check if contact has companyId but no associations.companies
        const hasCompanyId = contactData.companyId && contactData.companyId.trim() !== '';
        const hasCompanyAssociations = contactData.associations && 
                                     contactData.associations.companies && 
                                     contactData.associations.companies.length > 0;
        
        if (hasCompanyId && !hasCompanyAssociations) {
          console.log(`  🏢 Found companyId: ${contactData.companyId}`);
          console.log(`  ❌ Missing company association`);
          
          // Verify the company exists
          const companyRef = db.collection('tenants').doc(TENANT_ID).collection('crm_companies').doc(contactData.companyId);
          const companyDoc = await companyRef.get();
          
          if (!companyDoc.exists()) {
            console.log(`  ⚠️ Company ${contactData.companyId} not found, skipping`);
            results.associationsSkipped++;
            continue;
          }
          
          console.log(`  ✅ Company exists: ${companyDoc.data().companyName || companyDoc.data().name}`);
          
          if (!DRY_RUN) {
            // Initialize associations object if it doesn't exist
            const associations = contactData.associations || {};
            associations.companies = associations.companies || [];
            
            // Add company to associations if not already there
            if (!associations.companies.includes(contactData.companyId)) {
              associations.companies.push(contactData.companyId);
              
              // Update the contact document
              await contactDoc.ref.update({
                associations: associations,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
              });
              
              console.log(`  ✅ Added company association: ${contactData.companyId}`);
              results.associationsFixed++;
            } else {
              console.log(`  ⏭️ Company already in associations`);
              results.associationsSkipped++;
            }
          } else {
            console.log(`  📝 DRY RUN: Would add company association: ${contactData.companyId}`);
            results.associationsFixed++;
          }
        } else if (!hasCompanyId) {
          console.log(`  ⏭️ No companyId found`);
          results.associationsSkipped++;
        } else if (hasCompanyAssociations) {
          console.log(`  ✅ Already has company associations`);
          results.associationsSkipped++;
        }
        
        results.contactsProcessed++;
        results.details.push({
          contactId,
          contactName: contactData.fullName || `${contactData.firstName || ''} ${contactData.lastName || ''}`.trim(),
          companyId: contactData.companyId,
          hadAssociations: hasCompanyAssociations,
          fixed: hasCompanyId && !hasCompanyAssociations
        });
        
      } catch (error) {
        console.error(`  ❌ Error processing contact ${contactId}:`, error);
        results.errors++;
        results.details.push({
          contactId,
          contactName: contactData.fullName || `${contactData.firstName || ''} ${contactData.lastName || ''}`.trim(),
          error: error.message
        });
      }
    }
    
    // Print summary
    console.log('\n📊 Fix Summary');
    console.log('==============');
    console.log(`Total Contacts: ${results.totalContacts}`);
    console.log(`Contacts Processed: ${results.contactsProcessed}`);
    console.log(`Associations Fixed: ${results.associationsFixed}`);
    console.log(`Associations Skipped: ${results.associationsSkipped}`);
    console.log(`Errors: ${results.errors}`);
    
    if (DRY_RUN) {
      console.log('\n🔍 This was a DRY RUN. No changes were made to the database.');
      console.log('To run the actual fix, use: node fixContactCompanyAssociations.js <tenantId> false');
    } else {
      console.log('\n✅ Contact-company associations fix completed successfully!');
    }
    
    // Save detailed results to file
    const fs = require('fs');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `contact_associations_fix_${timestamp}.json`;
    fs.writeFileSync(filename, JSON.stringify(results, null, 2));
    console.log(`📄 Detailed results saved to: ${filename}`);
    
  } catch (error) {
    console.error('❌ Fix failed:', error);
    throw error;
  }
}

// Run the fix
fixContactCompanyAssociations()
  .then(() => {
    console.log('\n🎉 Fix script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Fix script failed:', error);
    process.exit(1);
  }); 
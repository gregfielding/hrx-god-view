const admin = require('firebase-admin');

// Initialize Firebase Admin with default credentials
admin.initializeApp();

const db = admin.firestore();

// Configuration
const TENANT_ID = process.argv[2] || 'BCiP2bQ9CgVOCTfV6MhD';
const DRY_RUN = process.argv[3] !== 'false';

console.log('🏢 Contact-Location Associations Fix Script');
console.log('==========================================');
console.log(`Tenant ID: ${TENANT_ID}`);
console.log(`Dry Run: ${DRY_RUN}`);
console.log('');

async function fixContactLocationAssociations() {
  try {
    console.log('🔍 Starting contact-location associations fix...');
    
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
        // Check if contact has locationId but no associations.locations
        const hasLocationId = contactData.locationId && contactData.locationId.trim() !== '';
        const hasLocationAssociations = contactData.associations && 
                                      contactData.associations.locations && 
                                      contactData.associations.locations.length > 0;
        
        if (hasLocationId && !hasLocationAssociations) {
          console.log(`  🏢 Found locationId: ${contactData.locationId}`);
          console.log(`  ❌ Missing location association`);
          
          // Verify the location exists by searching through companies
          let locationFound = false;
          let locationCompanyId = null;
          let locationCompanyName = null;
          
          // Get all companies to search for the location
          const companiesRef = db.collection('tenants').doc(TENANT_ID).collection('crm_companies');
          const companiesSnapshot = await companiesRef.get();
          
          for (const companyDoc of companiesSnapshot.docs) {
            const companyId = companyDoc.id;
            const companyData = companyDoc.data();
            
            const locationRef = db.collection('tenants').doc(TENANT_ID).collection('crm_companies').doc(companyId).collection('locations').doc(contactData.locationId);
            const locationDoc = await locationRef.get();
            
            if (locationDoc.exists) {
              locationFound = true;
              locationCompanyId = companyId;
              locationCompanyName = companyData.companyName || companyData.name;
              console.log(`  ✅ Location exists in company: ${locationCompanyName}`);
              break;
            }
          }
          
          if (!locationFound) {
            console.log(`  ⚠️ Location ${contactData.locationId} not found in any company, skipping`);
            results.associationsSkipped++;
            continue;
          }
          
          if (!DRY_RUN) {
            // Initialize associations object if it doesn't exist
            const associations = contactData.associations || {};
            associations.locations = associations.locations || [];
            
            // Add location to associations if not already there
            if (!associations.locations.includes(contactData.locationId)) {
              associations.locations.push(contactData.locationId);
              
              // Update the contact document
              await contactDoc.ref.update({
                associations: associations,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
              });
              
              console.log(`  ✅ Added location association: ${contactData.locationId}`);
              results.associationsFixed++;
            } else {
              console.log(`  ⏭️ Location already in associations`);
              results.associationsSkipped++;
            }
          } else {
            console.log(`  📝 DRY RUN: Would add location association: ${contactData.locationId}`);
            results.associationsFixed++;
          }
        } else if (!hasLocationId) {
          console.log(`  ⏭️ No locationId found`);
          results.associationsSkipped++;
        } else if (hasLocationAssociations) {
          console.log(`  ✅ Already has location associations`);
          results.associationsSkipped++;
        }
        
        results.contactsProcessed++;
        results.details.push({
          contactId,
          contactName: contactData.fullName || `${contactData.firstName || ''} ${contactData.lastName || ''}`.trim(),
          locationId: contactData.locationId,
          hadAssociations: hasLocationAssociations,
          fixed: hasLocationId && !hasLocationAssociations
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
      console.log('To run the actual fix, use: node fixContactLocationAssociations.js <tenantId> false');
    } else {
      console.log('\n✅ Contact-location associations fix completed successfully!');
    }
    
    // Save detailed results to file
    const fs = require('fs');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `contact_location_associations_fix_${timestamp}.json`;
    fs.writeFileSync(filename, JSON.stringify(results, null, 2));
    console.log(`📄 Detailed results saved to: ${filename}`);
    
  } catch (error) {
    console.error('❌ Fix failed:', error);
    throw error;
  }
}

// Run the fix
fixContactLocationAssociations()
  .then(() => {
    console.log('\n🎉 Fix script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Fix script failed:', error);
    process.exit(1);
  }); 
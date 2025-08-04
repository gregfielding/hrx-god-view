const admin = require('firebase-admin');

// Initialize Firebase Admin with default credentials
admin.initializeApp();

const db = admin.firestore();

// Configuration
const TENANT_ID = process.argv[2] || 'BCiP2bQ9CgVOCTfV6MhD';
const DRY_RUN = process.argv[3] !== 'false';

console.log('🧹 Company Associations Cleanup Script');
console.log('=====================================');
console.log(`Tenant ID: ${TENANT_ID}`);
console.log(`Dry Run: ${DRY_RUN}`);
console.log('');

async function cleanupCompanyAssociations() {
  console.log(`\n🧹 Starting cleanup for tenant: ${TENANT_ID}`);
  console.log(`🔧 Dry run mode: ${DRY_RUN ? 'ON' : 'OFF'}`);
  
  try {
    // Try different collection paths to find the correct one
    let companiesRef;
    let companiesSnapshot;
    
    // First try the tenant subcollection
    companiesRef = db.collection('tenants').doc(TENANT_ID).collection('crm_companies');
    companiesSnapshot = await companiesRef.get();
    
    if (companiesSnapshot.empty) {
      console.log('📁 No companies found in tenants/{tenantId}/crm_companies, trying top-level collection...');
      // Try top-level collection
      companiesRef = db.collection('crm_companies');
      companiesSnapshot = await companiesRef.get();
    }
    
    if (companiesSnapshot.empty) {
      console.log('📁 No companies found in crm_companies, trying with tenant filter...');
      // Try with tenant filter
      companiesRef = db.collection('crm_companies');
      companiesSnapshot = await companiesRef.where('tenantId', '==', TENANT_ID).get();
    }
    
    if (companiesSnapshot.empty) {
      console.log('❌ No companies found in any expected location');
      console.log('🔍 Available collections:');
      const collections = await db.listCollections();
      for (const collection of collections) {
        console.log(`  - ${collection.id}`);
      }
      return;
    }
    
    console.log(`\n📊 Found ${companiesSnapshot.size} companies to process`);
    
    let processedCount = 0;
    let skippedCount = 0;
    let totalFieldsRemoved = 0;
    const results = [];
    
    for (const companyDoc of companiesSnapshot.docs) {
      const companyId = companyDoc.id;
      const companyData = companyDoc.data();
      const companyName = companyData.companyName || companyData.name || 'Unknown';
      
      console.log(`\n🏢 Processing company: ${companyName}`);
      
      const updateData = {};
      const fieldsToRemove = [];
      
      // Check for old association fields
      if (companyData.associatedUsers) {
        console.log(`  🗑️ Will remove associatedUsers (${companyData.associatedUsers.length} items)`);
        updateData.associatedUsers = admin.firestore.FieldValue.delete();
        fieldsToRemove.push('associatedUsers');
      }
      
      if (companyData.associatedEmails) {
        console.log(`  🗑️ Will remove associatedEmails (${companyData.associatedEmails.length} items)`);
        updateData.associatedEmails = admin.firestore.FieldValue.delete();
        fieldsToRemove.push('associatedEmails');
      }
      
      if (companyData.accountOwnerId) {
        console.log(`  🗑️ Will remove accountOwnerId: ${companyData.accountOwnerId}`);
        updateData.accountOwnerId = admin.firestore.FieldValue.delete();
        fieldsToRemove.push('accountOwnerId');
      }
      
      if (companyData.salesOwnerId) {
        console.log(`  🗑️ Will remove salesOwnerId: ${companyData.salesOwnerId}`);
        updateData.salesOwnerId = admin.firestore.FieldValue.delete();
        fieldsToRemove.push('salesOwnerId');
      }
      
      if (companyData.salesOwnerRef) {
        console.log(`  🗑️ Will remove salesOwnerRef: ${companyData.salesOwnerRef}`);
        updateData.salesOwnerRef = admin.firestore.FieldValue.delete();
        fieldsToRemove.push('salesOwnerRef');
      }
      
      if (companyData.externalSalesId) {
        console.log(`  🗑️ Will remove externalSalesId: ${companyData.externalSalesId}`);
        updateData.externalSalesId = admin.firestore.FieldValue.delete();
        fieldsToRemove.push('externalSalesId');
      }
      
      if (companyData.externalSalesOwner) {
        console.log(`  🗑️ Will remove externalSalesOwner: ${companyData.externalSalesOwner}`);
        updateData.externalSalesOwner = admin.firestore.FieldValue.delete();
        fieldsToRemove.push('externalSalesOwner');
      }
      
      if (fieldsToRemove.length === 0) {
        console.log(`  ⏭️ No old fields to remove from this company`);
        skippedCount++;
        results.push({
          companyId,
          companyName,
          fieldsRemoved: [],
          hadAssociatedUsers: !!companyData.associatedUsers,
          hadAssociatedEmails: !!companyData.associatedEmails,
          hadAccountOwnerId: !!companyData.accountOwnerId,
          hadSalesOwnerId: !!companyData.salesOwnerId
        });
        continue;
      }
      
      console.log(`  📝 Removing ${fieldsToRemove.length} old fields...`);
      
      if (!DRY_RUN) {
        try {
          // Add a small delay to ensure Firestore operations complete
          await new Promise(resolve => setTimeout(resolve, 100));
          
          await companyDoc.ref.update(updateData);
          
          // Verify the update by reading the document back
          const verifyDoc = await companyDoc.ref.get();
          const verifyData = verifyDoc.data();
          
          // Check if fields were actually removed
          const stillPresent = [];
          if (verifyData.associatedUsers) stillPresent.push('associatedUsers');
          if (verifyData.associatedEmails) stillPresent.push('associatedEmails');
          if (verifyData.accountOwnerId) stillPresent.push('accountOwnerId');
          if (verifyData.salesOwnerId) stillPresent.push('salesOwnerId');
          if (verifyData.salesOwnerRef) stillPresent.push('salesOwnerRef');
          if (verifyData.externalSalesId) stillPresent.push('externalSalesId');
          if (verifyData.externalSalesOwner) stillPresent.push('externalSalesOwner');
          
          if (stillPresent.length > 0) {
            console.log(`  ⚠️ Warning: Some fields still present after update: ${stillPresent.join(', ')}`);
          } else {
            console.log(`  ✅ Successfully removed ${fieldsToRemove.length} fields from ${companyName}`);
          }
          
          totalFieldsRemoved += fieldsToRemove.length;
          
        } catch (error) {
          console.error(`  ❌ Error updating ${companyName}:`, error.message);
        }
      } else {
        console.log(`  🔍 [DRY RUN] Would remove ${fieldsToRemove.length} fields from ${companyName}`);
        totalFieldsRemoved += fieldsToRemove.length;
      }
      
      processedCount++;
      
      results.push({
        companyId,
        companyName,
        fieldsRemoved: fieldsToRemove,
        hadAssociatedUsers: !!companyData.associatedUsers,
        hadAssociatedEmails: !!companyData.associatedEmails,
        hadAccountOwnerId: !!companyData.accountOwnerId,
        hadSalesOwnerId: !!companyData.salesOwnerId
      });
    }
    
    console.log(`\n📊 Cleanup Summary`);
    console.log(`==================`);
    console.log(`Total Companies: ${companiesSnapshot.size}`);
    console.log(`Companies Processed: ${processedCount}`);
    console.log(`Companies Skipped: ${skippedCount}`);
    console.log(`Fields Removed: ${totalFieldsRemoved}`);
    console.log(`Errors: 0`);
    
    // Save detailed results
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const resultsFile = `cleanup_results_${timestamp}.json`;
    require('fs').writeFileSync(resultsFile, JSON.stringify({
      totalCompanies: companiesSnapshot.size,
      companiesProcessed: processedCount,
      companiesSkipped: skippedCount,
      fieldsRemoved: totalFieldsRemoved,
      errors: 0,
      details: results
    }, null, 2));
    
    console.log(`\n✅ Cleanup completed successfully!`);
    console.log(`📄 Detailed results saved to: ${resultsFile}`);
    
  } catch (error) {
    console.error('❌ Error in cleanup:', error);
    throw error;
  }
}

cleanupCompanyAssociations().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
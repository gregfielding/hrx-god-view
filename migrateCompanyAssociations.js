const admin = require('firebase-admin');

// Initialize Firebase Admin with default credentials
admin.initializeApp();

const db = admin.firestore();

// Configuration
const TENANT_ID = process.argv[2] || 'BCiP2bQ9CgVOCTfV6MhD';
const DRY_RUN = process.argv[3] !== 'false';

console.log('🏢 Company Associations Migration Script');
console.log('=====================================');
console.log(`Tenant ID: ${TENANT_ID}`);
console.log(`Dry Run: ${DRY_RUN}`);
console.log('');

async function migrateCompanyAssociations() {
  try {
    console.log('🔍 Starting migration...');
    
    // Get all companies for the tenant
    const companiesRef = db.collection('tenants').doc(TENANT_ID).collection('crm_companies');
    const companiesSnapshot = await companiesRef.get();
    
    if (companiesSnapshot.empty) {
      console.log('❌ No companies found for this tenant');
      return;
    }
    
    console.log(`📊 Found ${companiesSnapshot.docs.length} companies to process`);
    
    const results = {
      totalCompanies: companiesSnapshot.docs.length,
      companiesProcessed: 0,
      associationsCreated: 0,
      associationsSkipped: 0,
      errors: 0,
      details: []
    };
    
    // Process each company
    for (const companyDoc of companiesSnapshot.docs) {
      const companyId = companyDoc.id;
      const companyData = companyDoc.data();
      
      console.log(`\n🏢 Processing company: ${companyData.companyName || companyData.name || companyId}`);
      
      try {
        const companyAssociations = [];
        
        // 1. Process accountOwnerId
        if (companyData.accountOwnerId) {
          console.log(`  👤 Found account owner: ${companyData.accountOwnerId}`);
          companyAssociations.push({
            sourceEntityType: 'company',
            sourceEntityId: companyId,
            targetEntityType: 'salesperson',
            targetEntityId: companyData.accountOwnerId,
            associationType: 'ownership',
            role: 'account_owner',
            strength: 'strong',
            tenantId: TENANT_ID,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            createdBy: companyData.accountOwnerId || 'system',
            updatedBy: companyData.accountOwnerId || 'system'
          });
        }
        
        // 2. Process salesOwnerId
        if (companyData.salesOwnerId) {
          console.log(`  💼 Found sales owner: ${companyData.salesOwnerId}`);
          companyAssociations.push({
            sourceEntityType: 'company',
            sourceEntityId: companyId,
            targetEntityType: 'salesperson',
            targetEntityId: companyData.salesOwnerId,
            associationType: 'collaboration',
            role: 'sales_owner',
            strength: 'medium',
            tenantId: TENANT_ID,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            createdBy: companyData.salesOwnerId || 'system',
            updatedBy: companyData.salesOwnerId || 'system'
          });
        }
        
        // 3. Process associatedUsers array
        if (companyData.associatedUsers && Array.isArray(companyData.associatedUsers)) {
          console.log(`  👥 Found ${companyData.associatedUsers.length} associated users`);
          for (const userId of companyData.associatedUsers) {
            // Skip if this user is already the account owner or sales owner
            if (userId === companyData.accountOwnerId || userId === companyData.salesOwnerId) {
              console.log(`    ⏭️ Skipping ${userId} (already processed as owner)`);
              continue;
            }
            
            companyAssociations.push({
              sourceEntityType: 'company',
              sourceEntityId: companyId,
              targetEntityType: 'salesperson',
              targetEntityId: userId,
              associationType: 'collaboration',
              role: 'team_member',
              strength: 'medium',
              tenantId: TENANT_ID,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              createdBy: userId || 'system',
              updatedBy: userId || 'system'
            });
          }
        }
        
        // 4. Process associatedEmails array (convert to user associations if possible)
        if (companyData.associatedEmails && Array.isArray(companyData.associatedEmails)) {
          console.log(`  📧 Found ${companyData.associatedEmails.length} associated emails`);
          for (const email of companyData.associatedEmails) {
            // Try to find user by email
            const userQuery = await db.collection('users')
              .where('email', '==', email)
              .limit(1)
              .get();
            
            if (!userQuery.empty) {
              const userDoc = userQuery.docs[0];
              const userId = userDoc.id;
              
              // Check if this user is already associated
              const alreadyAssociated = companyAssociations.some(assoc => 
                assoc.targetEntityId === userId
              );
              
              if (!alreadyAssociated) {
                console.log(`    👤 Found user for email ${email}: ${userId}`);
                companyAssociations.push({
                  sourceEntityType: 'company',
                  sourceEntityId: companyId,
                  targetEntityType: 'salesperson',
                  targetEntityId: userId,
                  associationType: 'collaboration',
                  role: 'team_member',
                  strength: 'medium',
                  tenantId: TENANT_ID,
                  createdAt: admin.firestore.FieldValue.serverTimestamp(),
                  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                  createdBy: userId || 'system',
                  updatedBy: userId || 'system'
                });
              } else {
                console.log(`    ⏭️ Skipping ${email} (user already associated)`);
              }
            } else {
              console.log(`    ⚠️ No user found for email: ${email}`);
              // Store as metadata for future reference
              companyAssociations.push({
                sourceEntityType: 'company',
                sourceEntityId: companyId,
                targetEntityType: 'contact', // Use contact as fallback
                targetEntityId: `email_${email.replace(/[^a-zA-Z0-9]/g, '_')}`,
                associationType: 'collaboration',
                role: 'team_member',
                strength: 'weak',
                metadata: {
                  notes: `Migrated from associatedEmails. Original email: ${email}`,
                  originalEmail: email
                },
                tenantId: TENANT_ID,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                createdBy: 'system',
                updatedBy: 'system'
              });
            }
          }
        }
        
        // 5. Create association documents
        if (companyAssociations.length > 0) {
          console.log(`  📝 Creating ${companyAssociations.length} associations...`);
          
          if (!DRY_RUN) {
            const associationsRef = db.collection('tenants').doc(TENANT_ID).collection('crm_associations');
            
            for (const association of companyAssociations) {
              await associationsRef.add(association);
              results.associationsCreated++;
            }
            
            // Update company with association counts
            const associationCounts = {
              salespeople: companyAssociations.filter(a => a.targetEntityType === 'salesperson').length,
              contacts: companyAssociations.filter(a => a.targetEntityType === 'contact').length
            };
            
            await companyDoc.ref.update({
              associationCounts,
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            
            console.log(`  ✅ Created ${companyAssociations.length} associations for ${companyData.companyName || companyData.name}`);
          } else {
            console.log(`  📝 DRY RUN: Would create ${companyAssociations.length} associations`);
            results.associationsCreated += companyAssociations.length;
          }
        } else {
          console.log(`  ⏭️ No associations to create for this company`);
          results.associationsSkipped++;
        }
        
        results.companiesProcessed++;
        results.details.push({
          companyId,
          companyName: companyData.companyName || companyData.name,
          associationsCreated: companyAssociations.length,
          accountOwnerId: companyData.accountOwnerId,
          salesOwnerId: companyData.salesOwnerId,
          associatedUsersCount: companyData.associatedUsers?.length || 0,
          associatedEmailsCount: companyData.associatedEmails?.length || 0
        });
        
      } catch (error) {
        console.error(`  ❌ Error processing company ${companyId}:`, error);
        results.errors++;
        results.details.push({
          companyId,
          companyName: companyData.companyName || companyData.name,
          error: error.message
        });
      }
    }
    
    // Print summary
    console.log('\n📊 Migration Summary');
    console.log('==================');
    console.log(`Total Companies: ${results.totalCompanies}`);
    console.log(`Companies Processed: ${results.companiesProcessed}`);
    console.log(`Associations Created: ${results.associationsCreated}`);
    console.log(`Associations Skipped: ${results.associationsSkipped}`);
    console.log(`Errors: ${results.errors}`);
    
    if (DRY_RUN) {
      console.log('\n🔍 This was a DRY RUN. No changes were made to the database.');
      console.log('To run the actual migration, use: node migrateCompanyAssociations.js <tenantId> false');
    } else {
      console.log('\n✅ Migration completed successfully!');
    }
    
    // Save detailed results to file
    const fs = require('fs');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `migration_results_${timestamp}.json`;
    fs.writeFileSync(filename, JSON.stringify(results, null, 2));
    console.log(`📄 Detailed results saved to: ${filename}`);
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

// Run the migration
migrateCompanyAssociations()
  .then(() => {
    console.log('\n🎉 Migration script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Migration script failed:', error);
    process.exit(1);
  });
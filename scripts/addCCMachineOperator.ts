/**
 * Script to add "C&C Machine Operator" job title to tenant(s)
 * 
 * Usage:
 *   ts-node --project scripts/tsconfig.json scripts/addCCMachineOperator.ts [tenantId]
 * 
 * If tenantId is provided, adds to that tenant only.
 * If tenantId is "all" or omitted, adds to all tenants.
 * 
 * Example:
 *   ts-node --project scripts/tsconfig.json scripts/addCCMachineOperator.ts tenant123
 *   ts-node --project scripts/tsconfig.json scripts/addCCMachineOperator.ts all
 */

import * as admin from 'firebase-admin';
import { initializeApp, cert } from 'firebase-admin/app';

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  const serviceAccount = require('../functions/serviceAccountKey.json');
  initializeApp({
    credential: cert(serviceAccount),
  });
}

const db = admin.firestore();

const JOB_TITLE = 'C&C Machine Operator';
const JOB_DESCRIPTION = 'A C&C Machinist (or CNC Machinist) operates Computer Numerical Control machines to precisely cut, shape, and finish metal or plastic parts from raw stock, involving reading blueprints, programming machines (like mills & lathes), setting up tools, running the parts, and inspecting quality, blending mechanical skills with technical programming. The "C&C" often refers to companies like C&C Machining that specialize in high-quality, precision components for various industries, using both manual and advanced automated processes.';

async function addJobTitleToTenant(tenantId: string): Promise<boolean> {
  try {
    console.log(`\n📋 Processing tenant: ${tenantId}...`);

    const newJobTitle = {
      title: JOB_TITLE,
      description: JOB_DESCRIPTION,
      experience: '',
      education: '',
      certifications: [],
      skills: ['CNC Operation', 'Blueprint Reading', 'Machine Programming', 'Quality Inspection', 'Precision Machining'],
      licenses: [],
      languages: [],
      physicalRequirements: [],
      shiftType: [],
      payRange: '',
    };

    // First, check if it already exists in subcollection
    const jobTitlesCollection = db
      .collection('tenants')
      .doc(tenantId)
      .collection('modules')
      .doc('hrx-flex')
      .collection('jobTitles');
    
    const existingSnapshot = await jobTitlesCollection
      .where('title', '==', JOB_TITLE)
      .get();
    
    if (!existingSnapshot.empty) {
      console.log(`⚠️  Job title "${JOB_TITLE}" already exists in subcollection for tenant ${tenantId}`);
      return false;
    }

    // Try to add to subcollection first
    try {
      await jobTitlesCollection.add(newJobTitle);
      console.log(`✅ Successfully added "${JOB_TITLE}" to subcollection for tenant ${tenantId}`);
      return true;
    } catch (subcollectionError: any) {
      console.log(`⚠️  Subcollection add failed for tenant ${tenantId}, trying module settings...`);
      
      // If subcollection fails, add to module settings
      const flexModuleRef = db
        .collection('tenants')
        .doc(tenantId)
        .collection('modules')
        .doc('hrx-flex');
      
      const flexDoc = await flexModuleRef.get();
      const currentData = flexDoc.exists ? flexDoc.data() : {};
      const existingJobTitles = currentData?.jobTitles || [];
      
      // Check if job title already exists
      if (existingJobTitles.some((jt: any) => jt.title === JOB_TITLE)) {
        console.log(`⚠️  Job title "${JOB_TITLE}" already exists in module settings for tenant ${tenantId}`);
        return false;
      }
      
      await flexModuleRef.set(
        {
          ...currentData,
          jobTitles: [...existingJobTitles, newJobTitle],
        },
        { merge: true }
      );
      console.log(`✅ Successfully added "${JOB_TITLE}" to module settings for tenant ${tenantId}`);
      return true;
    }
  } catch (error: any) {
    console.error(`❌ Error adding job title to tenant ${tenantId}:`, error.message);
    return false;
  }
}

async function addToAllTenants() {
  try {
    console.log('🔍 Fetching all tenants...');
    const tenantsSnapshot = await db.collection('tenants').get();
    
    if (tenantsSnapshot.empty) {
      console.log('⚠️  No tenants found in the system');
      return;
    }

    console.log(`📊 Found ${tenantsSnapshot.size} tenant(s)\n`);
    
    let successCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const tenantDoc of tenantsSnapshot.docs) {
      const tenantId = tenantDoc.id;
      const tenantData = tenantDoc.data();
      const tenantName = tenantData.name || tenantData.companyName || 'Unnamed Tenant';
      
      console.log(`\n🏢 Tenant: ${tenantName} (${tenantId})`);
      const result = await addJobTitleToTenant(tenantId);
      
      if (result) {
        successCount++;
      } else {
        skippedCount++;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 Summary:');
    console.log(`   ✅ Successfully added: ${successCount}`);
    console.log(`   ⏭️  Skipped (already exists): ${skippedCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log('='.repeat(60));
  } catch (error: any) {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const tenantId = args[0];

  if (!tenantId || tenantId.toLowerCase() === 'all') {
    await addToAllTenants();
  } else {
    const result = await addJobTitleToTenant(tenantId);
    if (result) {
      console.log(`\n✅ Job title "${JOB_TITLE}" has been added successfully to tenant ${tenantId}!`);
    } else {
      console.log(`\n⚠️  Job title "${JOB_TITLE}" was not added (may already exist).`);
    }
  }
}

main()
  .then(() => {
    console.log('\n✨ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });



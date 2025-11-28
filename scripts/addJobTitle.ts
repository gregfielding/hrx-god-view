/**
 * Script to add a job title to a tenant's job titles collection
 * 
 * Usage:
 *   ts-node --project scripts/tsconfig.json scripts/addJobTitle.ts <tenantId> <jobTitle>
 * 
 * Example:
 *   ts-node --project scripts/tsconfig.json scripts/addJobTitle.ts tenant123 "Catering Service Attendant"
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

async function addJobTitle(tenantId: string, jobTitle: string) {
  try {
    console.log(`Adding job title "${jobTitle}" to tenant ${tenantId}...`);

    const newJobTitle = {
      title: jobTitle.trim(),
      description: '',
      experience: '',
      education: '',
      certifications: [],
      skills: [],
      licenses: [],
      languages: [],
      physicalRequirements: [],
      shiftType: [],
      payRange: '',
    };

    // Try to add to subcollection first
    try {
      const jobTitlesCollection = db
        .collection('tenants')
        .doc(tenantId)
        .collection('modules')
        .doc('hrx-flex')
        .collection('jobTitles');
      
      await jobTitlesCollection.add(newJobTitle);
      console.log(`✅ Successfully added "${jobTitle}" to subcollection`);
    } catch (subcollectionError: any) {
      console.log('⚠️  Subcollection add failed, trying module settings...');
      
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
      if (existingJobTitles.some((jt: any) => jt.title === jobTitle.trim())) {
        console.log(`⚠️  Job title "${jobTitle}" already exists in module settings`);
        return;
      }
      
      await flexModuleRef.set(
        {
          ...currentData,
          jobTitles: [...existingJobTitles, newJobTitle],
        },
        { merge: true }
      );
      console.log(`✅ Successfully added "${jobTitle}" to module settings`);
    }

    console.log(`\n✅ Job title "${jobTitle}" has been added successfully!`);
  } catch (error: any) {
    console.error('❌ Error adding job title:', error.message);
    process.exit(1);
  }
}

// Get command line arguments
const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('Usage: ts-node scripts/addJobTitle.ts <tenantId> <jobTitle>');
  console.error('Example: ts-node scripts/addJobTitle.ts tenant123 "Catering Service Attendant"');
  process.exit(1);
}

const [tenantId, jobTitle] = args;

addJobTitle(tenantId, jobTitle)
  .then(() => {
    console.log('Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });


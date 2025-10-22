/**
 * Migration Script: Populate applicationData on User Documents
 * 
 * This script reads existing applications from tenants/{tenantId}/applications
 * and creates the denormalized applicationData map on user documents for
 * efficient querying in the Recruiter Applicants table.
 * 
 * Run with: node scripts/migrateApplicationData.js
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Try to find service account key or use application default credentials
let credential;
const possibleKeyPaths = [
  path.join(__dirname, '..', 'serviceAccountKey.json'),
  path.join(__dirname, '..', 'firebase-adminsdk.json'),
  process.env.GOOGLE_APPLICATION_CREDENTIALS
].filter(Boolean);

for (const keyPath of possibleKeyPaths) {
  if (fs.existsSync(keyPath)) {
    console.log(`🔑 Using service account key: ${keyPath}`);
    const serviceAccount = require(keyPath);
    credential = admin.credential.cert(serviceAccount);
    break;
  }
}

if (!credential) {
  console.log('🔑 Using application default credentials');
  credential = admin.credential.applicationDefault();
}

// Initialize Firebase Admin
try {
  admin.initializeApp({
    credential,
    projectId: 'hrx1-d3beb'
  });
} catch (e) {
  console.log('ℹ️  Admin SDK already initialized');
}

const db = admin.firestore();

async function migrateApplicationData() {
  console.log('🚀 Starting application data migration...\n');
  
  let totalApplications = 0;
  let totalUsersUpdated = 0;
  let errors = 0;
  
  try {
    // Get all tenants
    const tenantsSnapshot = await db.collection('tenants').get();
    console.log(`📋 Found ${tenantsSnapshot.size} tenants\n`);
    
    for (const tenantDoc of tenantsSnapshot.docs) {
      const tenantId = tenantDoc.id;
      const tenantName = tenantDoc.data().name || tenantId;
      console.log(`\n📂 Processing tenant: ${tenantName} (${tenantId})`);
      
      // Get all applications for this tenant
      const applicationsRef = db.collection('tenants').doc(tenantId).collection('applications');
      const applicationsSnapshot = await applicationsRef.get();
      
      console.log(`   Found ${applicationsSnapshot.size} applications`);
      totalApplications += applicationsSnapshot.size;
      
      if (applicationsSnapshot.empty) {
        console.log('   ⏭️  No applications to process, skipping...');
        continue;
      }
      
      // Group applications by userId
      const applicationsByUser = new Map();
      
      for (const appDoc of applicationsSnapshot.docs) {
        const appData = appDoc.data();
        const userId = appData.userId || appData.uid;
        
        if (!userId) {
          console.log(`   ⚠️  Application ${appDoc.id} has no userId, skipping...`);
          continue;
        }
        
        if (!applicationsByUser.has(userId)) {
          applicationsByUser.set(userId, []);
        }
        
        applicationsByUser.get(userId).push({
          id: appDoc.id,
          data: appData
        });
      }
      
      console.log(`   👥 Processing ${applicationsByUser.size} unique users`);
      
      // Process each user
      for (const [userId, applications] of applicationsByUser.entries()) {
        try {
          const userRef = db.collection('users').doc(userId);
          const userDoc = await userRef.get();
          
          if (!userDoc.exists) {
            console.log(`   ⚠️  User ${userId} not found, skipping ${applications.length} applications...`);
            continue;
          }
          
          const userData = userDoc.data();
          const applicationDataMap = {};
          
          // Process each application for this user
          for (const app of applications) {
            const appData = app.data;
            const applicationId = app.id;
            
            // Fetch job posting details
            let jobTitle = null;
            let postTitle = null;
            let companyName = null;
            let companyId = null;
            let jobPostId = null;
            let payRate = null;
            let startDate = null;
            let location = null;
            
            if (appData.jobId) {
              try {
                const jobPostRef = db.collection('tenants').doc(tenantId).collection('job_postings').doc(appData.jobId);
                const jobPostDoc = await jobPostRef.get();
                
                if (jobPostDoc.exists) {
                  const jobData = jobPostDoc.data();
                  jobTitle = jobData.jobTitle || null;
                  postTitle = jobData.postTitle || null;
                  companyName = jobData.companyName || null;
                  companyId = jobData.companyId || null;
                  jobPostId = jobData.jobPostId || null;
                  payRate = jobData.payRate || null;
                  startDate = jobData.startDate || null;
                  location = jobData.worksiteName || jobData.city || null;
                }
              } catch (err) {
                console.log(`      ⚠️  Failed to fetch job posting ${appData.jobId}: ${err.message}`);
              }
            }
            
            // Create denormalized application data
            applicationDataMap[applicationId] = {
              jobId: appData.jobId || null,
              jobTitle,
              postTitle,
              companyName,
              companyId,
              jobPostId,
              payRate,
              status: appData.status || 'submitted',
              appliedAt: appData.submittedAt || appData.createdAt || admin.firestore.FieldValue.serverTimestamp(),
              startDate,
              location,
              updatedAt: appData.updatedAt || admin.firestore.FieldValue.serverTimestamp()
            };
          }
          
          // Update user document with applicationData map
          await userRef.update({
            applicationData: applicationDataMap,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
          
          totalUsersUpdated++;
          console.log(`   ✅ Updated user ${userData.firstName} ${userData.lastName} (${userId}) - ${applications.length} applications`);
          
        } catch (err) {
          errors++;
          console.error(`   ❌ Error processing user ${userId}: ${err.message}`);
        }
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('✨ Migration Complete!');
    console.log('='.repeat(60));
    console.log(`📊 Total applications processed: ${totalApplications}`);
    console.log(`👥 Total users updated: ${totalUsersUpdated}`);
    console.log(`❌ Errors: ${errors}`);
    console.log('='.repeat(60) + '\n');
    
  } catch (error) {
    console.error('💥 Fatal error during migration:', error);
    process.exit(1);
  }
  
  process.exit(0);
}

// Run the migration
migrateApplicationData();


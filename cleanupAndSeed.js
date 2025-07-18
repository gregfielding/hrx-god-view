// Script to clean up existing motivation data and run initial seeding
const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

async function cleanupExistingMotivations() {
  console.log('🧹 Cleaning up existing motivation data...');
  
  try {
    // Delete all documents from motivations collection
    const motivationsSnapshot = await db.collection('motivations').get();
    const batch = db.batch();
    
    motivationsSnapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    
    await batch.commit();
    console.log(`✅ Deleted ${motivationsSnapshot.size} existing motivation documents`);
    
    // Also clean up motivationMessages collection (legacy)
    const motivationMessagesSnapshot = await db.collection('motivationMessages').get();
    if (motivationMessagesSnapshot.size > 0) {
      const batch2 = db.batch();
      motivationMessagesSnapshot.docs.forEach((doc) => {
        batch2.delete(doc.ref);
      });
      await batch2.commit();
      console.log(`✅ Deleted ${motivationMessagesSnapshot.size} legacy motivationMessages documents`);
    }
    
    return true;
  } catch (error) {
    console.error('❌ Error cleaning up motivation data:', error);
    return false;
  }
}

async function runInitialSeeding() {
  console.log('\n🌱 Running initial seeding from Quotable.io...');
  
  try {
    // Call the cloud function to seed motivations
    const functions = require('firebase-functions');
    const seedMotivations = functions.httpsCallable('seedMotivationMessagesFromAPI');
    
    console.log('Calling seedMotivationMessagesFromAPI...');
    const result = await seedMotivations({
      page: 1,
      limit: 20,
      maxQuotes: 100
    });
    
    console.log('✅ Initial seeding completed!');
    console.log('Results:', JSON.stringify(result.data, null, 2));
    
    return result.data;
  } catch (error) {
    console.error('❌ Error during seeding:', error);
    return null;
  }
}

async function verifySeeding() {
  console.log('\n🔍 Verifying seeding results...');
  
  try {
    const motivationsSnapshot = await db.collection('motivations').get();
    console.log(`📊 Total motivations in database: ${motivationsSnapshot.size}`);
    
    if (motivationsSnapshot.size > 0) {
      console.log('\n📝 Sample quotes:');
      motivationsSnapshot.docs.slice(0, 3).forEach((doc, index) => {
        const data = doc.data();
        console.log(`${index + 1}. "${data.text}"`);
        console.log(`   — ${data.author || 'Unknown'}`);
        console.log(`   Tags: ${data.tags?.join(', ') || 'None'}`);
        console.log(`   Tone: ${data.toneTags?.join(', ') || 'None'}`);
        console.log(`   Roles: ${data.roleTags?.join(', ') || 'None'}`);
        console.log('');
      });
    }
    
    return motivationsSnapshot.size;
  } catch (error) {
    console.error('❌ Error verifying seeding:', error);
    return 0;
  }
}

async function main() {
  console.log('🚀 Starting Motivation Library Cleanup and Seeding\n');
  
  // Step 1: Clean up existing data
  const cleanupSuccess = await cleanupExistingMotivations();
  if (!cleanupSuccess) {
    console.log('❌ Cleanup failed, aborting...');
    return;
  }
  
  // Step 2: Run initial seeding
  const seedingResult = await runInitialSeeding();
  if (!seedingResult) {
    console.log('❌ Seeding failed, aborting...');
    return;
  }
  
  // Step 3: Verify results
  const totalQuotes = await verifySeeding();
  
  console.log('\n🎉 Cleanup and Seeding Complete!');
  console.log(`📈 Total quotes seeded: ${totalQuotes}`);
  console.log('\nNext steps:');
  console.log('1. Check the admin interface at http://localhost:3000');
  console.log('2. Navigate to Admin → Motivation Library Seeder');
  console.log('3. Verify quotes appear in the Daily Motivation module');
}

// Run the script
main().catch(console.error); 
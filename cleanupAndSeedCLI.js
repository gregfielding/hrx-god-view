// Script to clean up existing motivation data and run initial seeding using Firebase CLI
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

async function cleanupExistingMotivations() {
  console.log('🧹 Cleaning up existing motivation data...');
  
  try {
    // Use Firebase CLI to delete all documents from motivations collection
    console.log('Deleting documents from motivations collection...');
    await execAsync('firebase firestore:delete motivations --recursive -y');
    console.log('✅ Deleted all documents from motivations collection');
    
    // Also clean up motivationMessages collection (legacy)
    console.log('Deleting documents from motivationMessages collection...');
    await execAsync('firebase firestore:delete motivationMessages --recursive -y');
    console.log('✅ Deleted all documents from motivationMessages collection');
    
    return true;
  } catch (error) {
    console.error('❌ Error cleaning up motivation data:', error.message);
    return false;
  }
}

async function runInitialSeeding() {
  console.log('\n🌱 Running initial seeding from Quotable.io...');
  
  try {
    // Call the deployed cloud function
    console.log('Calling seedMotivationMessagesFromAPI cloud function...');
    
    const result = await execAsync('firebase functions:call seedMotivationMessagesFromAPI --data \'{"page": 1, "limit": 20, "maxQuotes": 100}\'');
    
    console.log('✅ Cloud function executed successfully');
    console.log('Response:', result.stdout);
    
    return true;
  } catch (error) {
    console.error('❌ Error during seeding:', error.message);
    return false;
  }
}

async function verifySeeding() {
  console.log('\n🔍 Verifying seeding results...');
  
  try {
    // Use Firebase CLI to get document count
    const result = await execAsync('firebase firestore:get motivations --limit 1');
    console.log('📊 Firestore query result:', result.stdout);
    
    // Try to get a sample document
    const sampleResult = await execAsync('firebase firestore:get motivations --limit 3');
    console.log('📝 Sample documents:', sampleResult.stdout);
    
    return true;
  } catch (error) {
    console.error('❌ Error verifying seeding:', error.message);
    return false;
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
  await verifySeeding();
  
  console.log('\n🎉 Cleanup and Seeding Complete!');
  console.log('\nNext steps:');
  console.log('1. Check the admin interface at http://localhost:3000');
  console.log('2. Navigate to Admin → Motivation Library Seeder');
  console.log('3. Verify quotes appear in the Daily Motivation module');
  console.log('4. Check Firebase Console → Firestore → motivations collection');
}

// Run the script
main().catch(console.error); 
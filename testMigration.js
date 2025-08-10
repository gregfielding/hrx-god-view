const { initializeApp } = require('firebase/app');
const { getFunctions, httpsCallable } = require('firebase/functions');

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBxJjAo_dTMQjBpgS7Oh6ySYlbVQ3wqZtE",
  authDomain: "hrx1-d3beb.firebaseapp.com",
  projectId: "hrx1-d3beb",
  storageBucket: "hrx1-d3beb.appspot.com",
  messagingSenderId: "1097123456789",
  appId: "1:1097123456789:web:abcdef123456789"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const functions = getFunctions(app, 'us-central1');

async function testMigration() {
  try {
    console.log('🔄 Testing migration with dry run...');
    
    // Call the migration function with dry run
    const migrateAssociationsToObjects = httpsCallable(functions, 'migrateAssociationsToObjects');
    
    const result = await migrateAssociationsToObjects({
      tenantId: 'BCiP2bQ9CgVOCTfV6MhD', // Replace with your tenant ID
      dryRun: true // This will show what would be migrated without making changes
    });
    
    console.log('✅ Migration dry run completed:');
    console.log('Result:', result.data);
    
    if (result.data.success) {
      console.log(`📊 Entities processed: ${result.data.entitiesProcessed}`);
      console.log(`📊 Associations that would be migrated: ${result.data.associationsMigrated}`);
      
      if (result.data.errors && result.data.errors.length > 0) {
        console.log('⚠️ Errors found:');
        result.data.errors.forEach(error => console.log(`  - ${error}`));
      }
    } else {
      console.log('❌ Migration failed:', result.data.message);
    }
    
  } catch (error) {
    console.error('❌ Error running migration test:', error);
  }
}

// Run the test
testMigration();

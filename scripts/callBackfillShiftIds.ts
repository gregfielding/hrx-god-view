/**
 * Script to call the backfillShiftIdsInApplications Firebase function
 * 
 * Usage:
 *   ts-node scripts/callBackfillShiftIds.ts
 */

import { initializeApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';

// Firebase config
const firebaseConfig = {
  apiKey: 'AIzaSyBQA9bc25_7ncjvY75nAtIUv47C3w5jl6c',
  authDomain: 'hrx1-d3beb.firebaseapp.com',
  projectId: 'hrx1-d3beb',
  storageBucket: 'hrx1-d3beb.firebasestorage.app',
  messagingSenderId: '143752240496',
  appId: '1:143752240496:web:e0b584983d4b04cb3983b5',
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const functions = getFunctions(app, 'us-central1');

async function runBackfill() {
  try {
    console.log('🚀 Calling backfillShiftIdsInApplications function...\n');
    
    const backfillFunction = httpsCallable(functions, 'backfillShiftIdsInApplications');
    
    // Call with admin key (temporary, as defined in the function)
    const result = await backfillFunction({
      adminKey: 'temporary-backfill-key-2025'
    });
    
    const data = result.data as any;
    
    console.log('\n✅ Backfill completed successfully!');
    console.log('\n📊 Results:');
    console.log(`   Users processed: ${data.totalUsersProcessed}`);
    console.log(`   Applications checked: ${data.totalApplicationsChecked}`);
    console.log(`   Applications updated: ${data.totalApplicationsUpdated}`);
    console.log(`   Errors: ${data.errors.length}`);
    
    if (data.errors && data.errors.length > 0) {
      console.log('\n⚠️  Errors encountered:');
      data.errors.forEach((err: any, index: number) => {
        console.log(`   ${index + 1}. ${err.applicationId}: ${err.error}`);
      });
    }
    
    console.log('\n');
    
  } catch (error: any) {
    console.error('❌ Error calling backfill function:', error.message);
    if (error.details) {
      console.error('   Details:', error.details);
    }
    process.exit(1);
  }
}

runBackfill().then(() => {
  console.log('✅ Script completed');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});


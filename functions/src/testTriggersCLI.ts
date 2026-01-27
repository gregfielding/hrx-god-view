#!/usr/bin/env node

/**
 * CLI script to test Firestore triggers locally
 * Usage: 
 *   npx ts-node testTriggersCLI.ts          # Run all tests
 *   npx ts-node testTriggersCLI.ts --coverage  # Check test coverage
 */

import * as admin from 'firebase-admin';

import { runFirestoreTriggerTests, checkTestCoverage } from './testFirestoreTriggers';
export { runFirestoreTriggerTests };

async function main() {
  console.log('🧪 Firestore Trigger Test CLI');
  console.log('==============================\n');

  // Check command line arguments
  const args = process.argv.slice(2);
  const checkCoverage = args.includes('--coverage') || args.includes('-c');

  // No need to initialize Firebase here, already done at the top
  if (!admin.apps.length) {
    const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'hrx1-d3beb';
    admin.initializeApp({ projectId });

    const isEmulator = !!process.env.FIRESTORE_EMULATOR_HOST || !!process.env.FIREBASE_EMULATOR_HUB;
    console.log('✅ Firebase Admin initialized successfully');
    console.log(`🔧 Connected to ${isEmulator ? 'Emulator' : 'Firebase'} (projectId: ${projectId})`);
    if (process.env.FIRESTORE_EMULATOR_HOST) {
      console.log(`   FIRESTORE_EMULATOR_HOST=${process.env.FIRESTORE_EMULATOR_HOST}`);
    }
  }

  if (checkCoverage) {
    // Run coverage check
    try {
      const coverage = await checkTestCoverage();
      
      console.log('\n📋 Coverage Summary:');
      console.log('====================');
      
      if (coverage.missingTests.length > 0) {
        console.log('\n❌ Missing Tests:');
        coverage.missingTests.forEach(test => console.log(`  - ${test}`));
      }
      
      if (coverage.extraTests.length > 0) {
        console.log('\n⚠️  Extra Tests (review needed):');
        coverage.extraTests.forEach(test => console.log(`  - ${test}`));
      }
      
      console.log('\n💡 Recommendations:');
      coverage.recommendations.forEach(rec => console.log(`  - ${rec}`));
      
      // Exit with warning if missing tests
      if (coverage.missingTests.length > 0) {
        console.log('\n⚠️  Coverage check completed with missing tests.');
        process.exit(1);
      } else {
        console.log('\n✅ Coverage check completed successfully!');
        process.exit(0);
      }
    } catch (error) {
      console.error('\n💥 Coverage check failed:', error);
      process.exit(1);
    }
  } else {
    // Run the tests
    try {
      const summary = await runFirestoreTriggerTests();
      
      // Exit with appropriate code
      if (summary.failedTests > 0) {
        console.log('\n❌ Some tests failed. Check the output above for details.');
        process.exit(1);
      } else {
        console.log('\n✅ All tests passed!');
        process.exit(0);
      }
    } catch (error) {
      console.error('\n💥 Test execution failed:', error);
      process.exit(1);
    }
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
} 
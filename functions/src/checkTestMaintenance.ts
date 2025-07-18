#!/usr/bin/env node

/**
 * Quick maintenance check script
 * Run this before making changes to triggers to see what needs attention
 */

import { checkTestCoverage } from './testFirestoreTriggers';

async function checkMaintenance() {
  console.log('🔧 Firestore Trigger Test Maintenance Check');
  console.log('==========================================\n');

  try {
    const coverage = await checkTestCoverage();
    
    if (coverage.missingTests.length === 0 && coverage.extraTests.length === 0) {
      console.log('✅ All good! Test coverage is complete and up to date.');
      console.log('💡 Remember to run tests after any trigger changes:');
      console.log('   npm run test:triggers');
    } else {
      console.log('⚠️  Maintenance needed:');
      
      if (coverage.missingTests.length > 0) {
        console.log('\n❌ Missing Tests:');
        coverage.missingTests.forEach(test => console.log(`   - ${test}`));
      }
      
      if (coverage.extraTests.length > 0) {
        console.log('\n⚠️  Extra Tests (review needed):');
        coverage.extraTests.forEach(test => console.log(`   - ${test}`));
      }
      
      console.log('\n💡 Next Steps:');
      console.log('   1. Add missing test methods to testFirestoreTriggers.ts');
      console.log('   2. Update runAllTests() to call new methods');
      console.log('   3. Update coverage detection lists');
      console.log('   4. Test manually before committing');
      console.log('   5. Run: npm run test:triggers');
    }
    
    console.log('\n📋 Quick Commands:');
    console.log('   npm run test:triggers:coverage  # Detailed coverage report');
    console.log('   npm run test:triggers          # Run all tests');
    console.log('   npm run test:triggers:deployed # Test deployed functions');
    
  } catch (error: any) {
    console.error('❌ Error checking maintenance:', error.message);
    console.log('\n💡 Try running: npm run test:triggers:coverage');
  }
}

// Run if called directly
if (require.main === module) {
  checkMaintenance().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { checkMaintenance }; 
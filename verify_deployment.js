#!/usr/bin/env node

/**
 * Enhanced AI Logging System - Deployment Verification Script
 * Tests key components of the deployed system
 */

const https = require('https');
const { execSync } = require('child_process');

console.log('🚀 Enhanced AI Logging System - Deployment Verification');
console.log('=====================================================\n');

// Configuration
const FRONTEND_URL = 'https://hrx1-d3beb.web.app';
const FIREBASE_PROJECT = 'hrx1-d3beb';

// Test functions
function testFrontendAccess() {
  console.log('1. Testing Frontend Access...');
  return new Promise((resolve) => {
    https.get(FRONTEND_URL, (res) => {
      if (res.statusCode === 200) {
        console.log('   ✅ Frontend accessible');
        resolve(true);
      } else {
        console.log(`   ❌ Frontend returned status: ${res.statusCode}`);
        resolve(false);
      }
    }).on('error', (err) => {
      console.log(`   ❌ Frontend error: ${err.message}`);
      resolve(false);
    });
  });
}

function testFirebaseFunctions() {
  console.log('\n2. Testing Firebase Functions...');
  try {
    const result = execSync('firebase functions:list', { encoding: 'utf8' });
    const functions = result.split('\n').filter(line => line.includes('v2'));
    
    // Check for key AutoDevOps functions
    const requiredFunctions = [
      'createAutoDevOpsLog',
      'getAutoDevOpsLogs', 
      'updateAutoDevOpsSettings',
      'applyAutoDevOpsPatch',
      'listAILogs',
      'runAILogTests'
    ];
    
    let foundFunctions = 0;
    requiredFunctions.forEach(func => {
      if (functions.some(f => f.includes(func))) {
        foundFunctions++;
      }
    });
    
    if (foundFunctions === requiredFunctions.length) {
      console.log('   ✅ All required AutoDevOps functions deployed');
      return true;
    } else {
      console.log(`   ⚠️  Found ${foundFunctions}/${requiredFunctions.length} required functions`);
      return false;
    }
  } catch (error) {
    console.log(`   ❌ Firebase functions test failed: ${error.message}`);
    return false;
  }
}

function testBuildStatus() {
  console.log('\n3. Testing Build Status...');
  try {
    const result = execSync('npm run build', { encoding: 'utf8' });
    if (result.includes('Build complete!')) {
      console.log('   ✅ Build successful');
      return true;
    } else {
      console.log('   ❌ Build failed');
      return false;
    }
  } catch (error) {
    console.log(`   ❌ Build test failed: ${error.message}`);
    return false;
  }
}

function generateDeploymentReport(results) {
  console.log('\n📊 Deployment Verification Report');
  console.log('==================================');
  
  const passed = results.filter(r => r).length;
  const total = results.length;
  
  console.log(`\nOverall Status: ${passed === total ? '✅ SUCCESS' : '⚠️  PARTIAL SUCCESS'}`);
  console.log(`Tests Passed: ${passed}/${total}`);
  
  if (passed === total) {
    console.log('\n🎉 All systems operational!');
    console.log('\n📋 Next Steps:');
    console.log('1. Visit: https://hrx1-d3beb.web.app/admin/ai-launchpad');
    console.log('2. Test AI settings forms');
    console.log('3. Monitor AutoDevOps logs');
    console.log('4. Verify logging coverage');
  } else {
    console.log('\n⚠️  Some issues detected. Please review the errors above.');
  }
  
  console.log('\n🔗 Quick Links:');
  console.log(`- Frontend: ${FRONTEND_URL}`);
  console.log(`- Admin Dashboard: ${FRONTEND_URL}/admin/ai-launchpad`);
  console.log(`- Firebase Console: https://console.firebase.google.com/project/${FIREBASE_PROJECT}/overview`);
}

// Main verification
async function main() {
  const results = [];
  
  results.push(await testFrontendAccess());
  results.push(testFirebaseFunctions());
  results.push(testBuildStatus());
  
  generateDeploymentReport(results);
}

// Run verification
main().catch(console.error); 
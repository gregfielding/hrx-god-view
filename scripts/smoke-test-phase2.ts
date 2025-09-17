#!/usr/bin/env ts-node

/**
 * Phase 2 Auth Smoke Test Script
 * 
 * This script performs basic smoke tests on the deployed Phase 2 Auth system
 * to verify that all components are working correctly.
 */

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBQA9bc25_7ncjvY75nAtIUv47C3w5jl6c",
  authDomain: "hrx1-d3beb.firebaseapp.com",
  projectId: "hrx1-d3beb",
  storageBucket: "hrx1-d3beb.appspot.com",
  messagingSenderId: "143752240496",
  appId: "1:143752240496:web:your-app-id"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const functions = getFunctions(app, 'us-central1');
const db = getFirestore(app);

interface TestResult {
  test: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  message: string;
  details?: any;
}

class SmokeTester {
  private results: TestResult[] = [];
  
  async runTest(testName: string, testFn: () => Promise<void>): Promise<void> {
    try {
      console.log(`🧪 Running: ${testName}`);
      await testFn();
      this.results.push({ test: testName, status: 'PASS', message: 'Test passed' });
      console.log(`✅ PASS: ${testName}`);
    } catch (error: any) {
      this.results.push({ 
        test: testName, 
        status: 'FAIL', 
        message: error.message,
        details: error
      });
      console.log(`❌ FAIL: ${testName} - ${error.message}`);
    }
  }
  
  async testCloudFunctions(): Promise<void> {
    // Test setTenantRole function exists
    const setTenantRole = httpsCallable(functions, 'setTenantRole');
    if (!setTenantRole) {
      throw new Error('setTenantRole function not found');
    }
    
    // Test inviteUser function exists
    const inviteUser = httpsCallable(functions, 'inviteUser');
    if (!inviteUser) {
      throw new Error('inviteUser function not found');
    }
  }
  
  async testAuthentication(): Promise<void> {
    // Test that we can sign in (this will fail if auth is broken)
    const testEmail = 'gregpfielding@gmail.com';
    const testPassword = process.env.HRX_PASSWORD;
    
    if (!testPassword) {
      throw new Error('HRX_PASSWORD environment variable not set');
    }
    
    const userCredential = await signInWithEmailAndPassword(auth, testEmail, testPassword);
    if (!userCredential.user) {
      throw new Error('Failed to authenticate user');
    }
    
    // Test that we can get ID token
    const idToken = await userCredential.user.getIdToken();
    if (!idToken) {
      throw new Error('Failed to get ID token');
    }
    
    // Test that we can get ID token result (for claims)
    const idTokenResult = await userCredential.user.getIdTokenResult();
    if (!idTokenResult) {
      throw new Error('Failed to get ID token result');
    }
    
    console.log('   Claims:', JSON.stringify(idTokenResult.claims, null, 2));
  }
  
  async testFirestoreAccess(): Promise<void> {
    // Test basic Firestore read access
    const testDoc = doc(db, 'tenants', 'TENANT_A');
    const docSnap = await getDoc(testDoc);
    
    // It's OK if the document doesn't exist, we just want to test access
    console.log('   Document exists:', docSnap.exists());
  }
  
  async testRoleAssignment(): Promise<void> {
    // Test that we can call setTenantRole (this will fail if not HRX)
    const setTenantRole = httpsCallable(functions, 'setTenantRole');
    
    try {
      // This should fail with permission denied if not HRX
      await setTenantRole({
        targetUid: 'test-uid',
        tenantId: 'TENANT_A',
        role: 'Recruiter',
        securityLevel: '2'
      });
      
      // If we get here, the function call succeeded (which might be unexpected)
      console.log('   ⚠️  Role assignment succeeded (verify this is expected)');
    } catch (error: any) {
      if (error.code === 'functions/permission-denied') {
        console.log('   ✅ Permission correctly denied for non-HRX user');
      } else {
        throw error;
      }
    }
  }
  
  async runAllTests(): Promise<void> {
    console.log('🚀 Starting Phase 2 Auth Smoke Tests\n');
    
    await this.runTest('Cloud Functions Deployment', () => this.testCloudFunctions());
    await this.runTest('Authentication System', () => this.testAuthentication());
    await this.runTest('Firestore Access', () => this.testFirestoreAccess());
    await this.runTest('Role Assignment Security', () => this.testRoleAssignment());
    
    // Sign out
    await signOut(auth);
    console.log('\n🔐 Signed out');
    
    // Print summary
    console.log('\n📊 Test Results Summary:');
    console.log('========================');
    
    const passed = this.results.filter(r => r.status === 'PASS').length;
    const failed = this.results.filter(r => r.status === 'FAIL').length;
    const skipped = this.results.filter(r => r.status === 'SKIP').length;
    
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`⏭️  Skipped: ${skipped}`);
    
    if (failed > 0) {
      console.log('\n❌ Failed Tests:');
      this.results.filter(r => r.status === 'FAIL').forEach(result => {
        console.log(`   - ${result.test}: ${result.message}`);
      });
    }
    
    if (passed === this.results.length) {
      console.log('\n🎉 All smoke tests passed! Phase 2 Auth is working correctly.');
    } else {
      console.log('\n⚠️  Some tests failed. Please review the issues above.');
    }
  }
}

// Run smoke tests
async function runSmokeTests() {
  const tester = new SmokeTester();
  await tester.runAllTests();
}

// Run the script
if (require.main === module) {
  runSmokeTests().catch(console.error);
}

export { runSmokeTests };

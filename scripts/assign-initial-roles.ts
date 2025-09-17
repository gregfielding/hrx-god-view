#!/usr/bin/env ts-node

/**
 * Initial Role Assignment Script
 * 
 * This script assigns initial roles to existing users using the deployed setTenantRole function.
 * It's designed to be run once after Phase 2 Auth deployment to bootstrap the system.
 */

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';

// Firebase config (same as in the app)
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

// Role assignments based on exported users
const ROLE_ASSIGNMENTS = [
  {
    uid: '9tQ3JI21HCQluuNeXGsnnDZPDZk1', // j.robinson@c1staffing.com
    email: 'j.robinson@c1staffing.com',
    name: "Jas'myne Robinson",
    tenantId: 'TENANT_A', // You'll need to replace with actual tenant ID
    role: 'Recruiter' as const,
    securityLevel: '2' as const
  },
  {
    uid: 'OqZ0SlWsYqMhFgq9fIxgd9Pm0I62', // r.govea@c1staffing.com
    email: 'r.govea@c1staffing.com',
    name: 'Rosa Govea',
    tenantId: 'TENANT_A',
    role: 'Recruiter' as const,
    securityLevel: '2' as const
  },
  {
    uid: 'TWXMM1mOJHepmk80Qsx128w9AiS2', // gregpfielding@gmail.com
    email: 'gregpfielding@gmail.com',
    name: 'Greg Fielding',
    tenantId: 'TENANT_A',
    role: 'Admin' as const,
    securityLevel: '1' as const,
    hrx: true // HRX user
  },
  {
    uid: 'vEdJeKRlcgOs3FoI57EfBkP5Ewp1', // dm@c1staffing.com
    email: 'dm@c1staffing.com',
    name: 'Donna Persson',
    tenantId: 'TENANT_A',
    role: 'Admin' as const,
    securityLevel: '1' as const
  },
  {
    uid: 'zazCFZdVZMTX3AJZsVmrYzHmb6Q2', // g.fielding@c1staffing.com
    email: 'g.fielding@c1staffing.com',
    name: 'Greg Fielding',
    tenantId: 'TENANT_A',
    role: 'Admin' as const,
    securityLevel: '1' as const
  },
  {
    uid: 'zlx8F28okWMRdFSbyPWdQfV7eQS2', // i.castaneda@c1staffing.com
    email: 'i.castaneda@c1staffing.com',
    name: 'Irene Castaneda',
    tenantId: 'TENANT_A',
    role: 'Recruiter' as const,
    securityLevel: '2' as const
  }
];

async function assignInitialRoles() {
  console.log('🚀 Starting Initial Role Assignment');
  console.log(`📊 Processing ${ROLE_ASSIGNMENTS.length} role assignments`);
  
  // You'll need to sign in as an HRX user to assign roles
  const hrxEmail = 'gregpfielding@gmail.com'; // Replace with actual HRX user email
  const hrxPassword = process.env.HRX_PASSWORD; // You'll need to set this
  
  if (!hrxPassword) {
    console.error('❌ HRX_PASSWORD environment variable is required');
    console.log('💡 Set it with: export HRX_PASSWORD="your-password"');
    process.exit(1);
  }
  
  try {
    // Sign in as HRX user
    console.log(`🔐 Signing in as HRX user: ${hrxEmail}`);
    const userCredential = await signInWithEmailAndPassword(auth, hrxEmail, hrxPassword);
    console.log('✅ Successfully signed in as HRX user');
    
    // Get the setTenantRole function
    const setTenantRole = httpsCallable(functions, 'setTenantRole');
    
    // Assign roles
    for (const assignment of ROLE_ASSIGNMENTS) {
      try {
        console.log(`\n👤 Assigning role to ${assignment.name} (${assignment.email})`);
        console.log(`   Role: ${assignment.role}, Security Level: ${assignment.securityLevel}`);
        
        const result = await setTenantRole({
          targetUid: assignment.uid,
          tenantId: assignment.tenantId,
          role: assignment.role,
          securityLevel: assignment.securityLevel,
          hrx: assignment.hrx
        });
        
        console.log('✅ Role assigned successfully');
        console.log('   Claims:', JSON.stringify(result.data, null, 2));
        
      } catch (error: any) {
        console.error(`❌ Failed to assign role to ${assignment.name}:`, error.message);
      }
    }
    
    console.log('\n🎉 Initial role assignment completed!');
    console.log('💡 Users can now log in and will have their assigned roles');
    
  } catch (error: any) {
    console.error('❌ Authentication failed:', error.message);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  assignInitialRoles().catch(console.error);
}

export { assignInitialRoles };

#!/usr/bin/env ts-node

/**
 * Seed Tenant Roles Script
 * 
 * This script sets up tenant roles for test users using Firebase Admin SDK.
 * It reads from a local array and merges roles into custom claims.
 * 
 * Usage:
 *   npm run seed-roles                    # Dry run (default)
 *   npm run seed-roles -- --execute      # Actually execute the changes
 *   npm run seed-roles -- --dry          # Explicit dry run
 * 
 * Environment Variables Required:
 *   FIREBASE_PROJECT_ID - Your Firebase project ID
 *   FIREBASE_SERVICE_ACCOUNT_PATH - Path to service account JSON file
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables from .env.local
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

// Types
interface TenantRoleSeed {
  uid: string;
  tenantId: string;
  role: 'Admin' | 'Recruiter' | 'Manager' | 'Worker' | 'Customer';
  securityLevel: '1' | '2' | '3' | '4' | '5';
  hrx?: boolean; // Optional HRX flag
}

interface CustomClaims {
  hrx?: boolean;
  roles?: {
    [tenantId: string]: {
      role: string;
      securityLevel: string;
    };
  };
  ver?: number;
}

// Test user data - MODIFY THIS ARRAY FOR YOUR TEST USERS
const TENANT_ROLE_SEEDS: TenantRoleSeed[] = [
  // Example entries - replace with your actual test users
  {
    uid: 'test-admin-uid-1',
    tenantId: 'TENANT_A',
    role: 'Admin',
    securityLevel: '5'
  },
  {
    uid: 'test-recruiter-uid-1',
    tenantId: 'TENANT_A',
    role: 'Recruiter',
    securityLevel: '4'
  },
  {
    uid: 'test-manager-uid-1',
    tenantId: 'TENANT_A',
    role: 'Manager',
    securityLevel: '3'
  },
  {
    uid: 'test-worker-uid-1',
    tenantId: 'TENANT_A',
    role: 'Worker',
    securityLevel: '2'
  },
  {
    uid: 'test-customer-uid-1',
    tenantId: 'TENANT_A',
    role: 'Customer',
    securityLevel: '1'
  },
  // HRX platform user example
  {
    uid: 'hrx-platform-uid-1',
    tenantId: 'TENANT_A',
    role: 'Admin',
    securityLevel: '5',
    hrx: true
  },
  // Multi-tenant user example
  {
    uid: 'multi-tenant-uid-1',
    tenantId: 'TENANT_A',
    role: 'Recruiter',
    securityLevel: '4'
  },
  {
    uid: 'multi-tenant-uid-1', // Same UID, different tenant
    tenantId: 'TENANT_B',
    role: 'Manager',
    securityLevel: '3'
  }
];

class TenantRoleSeeder {
  private app: admin.app.App | null = null;
  private isDryRun: boolean = true;

  constructor() {
    this.parseArguments();
  }

  private parseArguments(): void {
    const args = process.argv.slice(2);
    this.isDryRun = !args.includes('--execute');
    
    if (this.isDryRun) {
      console.log('🔍 DRY RUN MODE - No changes will be made');
    } else {
      console.log('⚠️  EXECUTE MODE - Changes will be applied');
    }
  }

  private initializeFirebase(): void {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

    if (!projectId) {
      throw new Error('FIREBASE_PROJECT_ID environment variable is required');
    }

    if (!serviceAccountPath) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_PATH environment variable is required');
    }

    if (!fs.existsSync(serviceAccountPath)) {
      throw new Error(`Service account file not found: ${serviceAccountPath}`);
    }

    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

    this.app = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: projectId
    });

    console.log(`✅ Firebase Admin SDK initialized for project: ${projectId}`);
  }

  private async getUserClaims(uid: string): Promise<CustomClaims> {
    if (!this.app) throw new Error('Firebase not initialized');
    
    try {
      const user = await this.app.auth().getUser(uid);
      return (user.customClaims as CustomClaims) || {};
    } catch (error) {
      if (error instanceof Error && error.message.includes('user-not-found')) {
        throw new Error(`User not found: ${uid}`);
      }
      throw error;
    }
  }

  private async setUserClaims(uid: string, claims: CustomClaims): Promise<void> {
    if (!this.app) throw new Error('Firebase not initialized');
    
    if (this.isDryRun) {
      console.log(`[DRY RUN] Would set claims for ${uid}:`, JSON.stringify(claims, null, 2));
      return;
    }

    await this.app.auth().setCustomUserClaims(uid, claims);
    console.log(`✅ Claims updated for user: ${uid}`);
  }

  private mergeClaims(currentClaims: CustomClaims, seed: TenantRoleSeed): CustomClaims {
    const newClaims: CustomClaims = {
      ...currentClaims,
      roles: {
        ...(currentClaims.roles || {}),
        [seed.tenantId]: {
          role: seed.role,
          securityLevel: seed.securityLevel
        }
      },
      ver: (currentClaims.ver || 0) + 1
    };

    // Set HRX flag if specified
    if (seed.hrx !== undefined) {
      newClaims.hrx = seed.hrx;
    }

    return newClaims;
  }

  private async processUser(seed: TenantRoleSeed): Promise<void> {
    console.log(`\n📋 Processing user: ${seed.uid}`);
    console.log(`   Tenant: ${seed.tenantId}`);
    console.log(`   Role: ${seed.role} (Level ${seed.securityLevel})`);
    if (seed.hrx !== undefined) {
      console.log(`   HRX: ${seed.hrx}`);
    }

    try {
      // Get current claims
      const currentClaims = await this.getUserClaims(seed.uid);
      console.log(`   Current claims:`, JSON.stringify(currentClaims, null, 4));

      // Merge new claims
      const newClaims = this.mergeClaims(currentClaims, seed);
      console.log(`   New claims:`, JSON.stringify(newClaims, null, 4));

      // Set new claims
      await this.setUserClaims(seed.uid, newClaims);

    } catch (error) {
      console.error(`❌ Error processing user ${seed.uid}:`, error);
      throw error;
    }
  }

  private async validateSeeds(): Promise<void> {
    console.log('🔍 Validating seed data...');
    
    const uniqueUids = new Set(TENANT_ROLE_SEEDS.map(s => s.uid));
    console.log(`   Found ${uniqueUids.size} unique users`);
    console.log(`   Found ${TENANT_ROLE_SEEDS.length} role assignments`);

    // Check for duplicate tenant assignments for same user
    const userTenantMap = new Map<string, Set<string>>();
    for (const seed of TENANT_ROLE_SEEDS) {
      if (!userTenantMap.has(seed.uid)) {
        userTenantMap.set(seed.uid, new Set());
      }
      const tenantSet = userTenantMap.get(seed.uid)!;
      if (tenantSet.has(seed.tenantId)) {
        throw new Error(`Duplicate tenant assignment: User ${seed.uid} has multiple roles for tenant ${seed.tenantId}`);
      }
      tenantSet.add(seed.tenantId);
    }

    console.log('✅ Seed data validation passed');
  }

  public async run(): Promise<void> {
    try {
      console.log('🚀 Starting Tenant Role Seeding Process');
      console.log(`📊 Processing ${TENANT_ROLE_SEEDS.length} role assignments`);

      await this.validateSeeds();
      this.initializeFirebase();

      let successCount = 0;
      let errorCount = 0;

      for (const seed of TENANT_ROLE_SEEDS) {
        try {
          await this.processUser(seed);
          successCount++;
        } catch (error) {
          console.error(`Failed to process user ${seed.uid}:`, error);
          errorCount++;
        }
      }

      console.log('\n📊 Summary:');
      console.log(`   ✅ Successful: ${successCount}`);
      console.log(`   ❌ Failed: ${errorCount}`);
      console.log(`   📋 Total: ${TENANT_ROLE_SEEDS.length}`);

      if (this.isDryRun) {
        console.log('\n💡 To execute these changes, run with --execute flag');
      } else {
        console.log('\n🎉 Tenant role seeding completed!');
      }

    } catch (error) {
      console.error('💥 Fatal error:', error);
      process.exit(1);
    } finally {
      if (this.app) {
        await this.app.delete();
      }
    }
  }
}

// Main execution
if (require.main === module) {
  const seeder = new TenantRoleSeeder();
  seeder.run().catch(console.error);
}

export { TenantRoleSeeder, TENANT_ROLE_SEEDS };

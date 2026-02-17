/**
 * Seed entities and requirement packages for onboarding Phase 1A.
 *
 * Creates:
 * - tenants/{tenantId}/entities/{entityId} - C1 Events, C1 Workforce, C1 Select
 * - tenants/{tenantId}/requirement_packages/{packageId} - 1099 basic, W2 basic, W2+E-Verify
 *
 * Run: TENANT_ID=your-tenant-id node scripts/seedOnboardingEntitiesAndPackages.js
 * Or: node scripts/seedOnboardingEntitiesAndPackages.js  (uses first tenant from firestore)
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

let credential;
const possibleKeyPaths = [
  path.join(__dirname, '..', 'serviceAccountKey.json'),
  path.join(__dirname, '..', 'firebase-adminsdk.json'),
  process.env.GOOGLE_APPLICATION_CREDENTIALS,
].filter(Boolean);

for (const keyPath of possibleKeyPaths) {
  if (keyPath && fs.existsSync(keyPath)) {
    console.log('Using service account key:', keyPath);
    const serviceAccount = require(keyPath);
    credential = admin.credential.cert(serviceAccount);
    break;
  }
}

if (!credential) {
  credential = admin.credential.applicationDefault();
}

try {
  admin.initializeApp({ credential, projectId: process.env.GCLOUD_PROJECT || 'hrx1-d3beb' });
} catch (e) {
  if (!e.message?.includes('already exists')) throw e;
}

const db = admin.firestore();
const now = admin.firestore.FieldValue.serverTimestamp();

// Entity IDs (deterministic)
const ENTITY_IDS = {
  C1_EVENTS: 'c1_events_llc',
  C1_WORKFORCE: 'c1_workforce_llc',
  C1_SELECT: 'c1_select_llc',
};

// Package IDs
const PACKAGE_IDS = {
  PACKAGE_1099_BASIC: '1099_basic',
  PACKAGE_W2_BASIC: 'w2_basic',
  PACKAGE_W2_EVERIFY: 'w2_everify',
};

async function seedEntities(tenantId) {
  const entities = [
    {
      id: ENTITY_IDS.C1_EVENTS,
      name: 'C1 Events LLC',
      entityCode: 'C1EV',
      workerType: '1099',
      everifyRequired: false,
      defaultRequirementPackageId: PACKAGE_IDS.PACKAGE_1099_BASIC,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: ENTITY_IDS.C1_WORKFORCE,
      name: 'C1 Workforce LLC',
      entityCode: 'C1WF',
      workerType: 'W2',
      everifyRequired: false,
      defaultRequirementPackageId: PACKAGE_IDS.PACKAGE_W2_BASIC,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: ENTITY_IDS.C1_SELECT,
      name: 'C1 Select LLC',
      entityCode: 'C1SL',
      workerType: 'W2',
      everifyRequired: true,
      defaultRequirementPackageId: PACKAGE_IDS.PACKAGE_W2_EVERIFY,
      createdAt: now,
      updatedAt: now,
    },
  ];

  for (const e of entities) {
    const { id, ...data } = e;
    await db.doc(`tenants/${tenantId}/entities/${id}`).set(data, { merge: true });
    console.log('  Created entity:', id, data.name);
  }
}

async function seedRequirementPackages(tenantId) {
  const packages = [
    {
      id: PACKAGE_IDS.PACKAGE_1099_BASIC,
      name: '1099 Events Contractor',
      workerType: '1099',
      everifyRequired: false,
      steps: [],
      documents: [],
      checks: [],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: PACKAGE_IDS.PACKAGE_W2_BASIC,
      name: 'W2 Basic',
      workerType: 'W2',
      everifyRequired: false,
      steps: [],
      documents: [],
      checks: [],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: PACKAGE_IDS.PACKAGE_W2_EVERIFY,
      name: 'W2 + E-Verify',
      workerType: 'W2',
      everifyRequired: true,
      steps: [],
      documents: [],
      checks: [],
      createdAt: now,
      updatedAt: now,
    },
  ];

  for (const pkg of packages) {
    const { id, ...data } = pkg;
    await db.doc(`tenants/${tenantId}/requirement_packages/${id}`).set(data, { merge: true });
    console.log('  Created requirement package:', id, data.name);
  }
}

async function getTenantId() {
  if (process.env.TENANT_ID) return process.env.TENANT_ID;
  const tenantsSnap = await db.collection('tenants').limit(1).get();
  if (tenantsSnap.empty) throw new Error('No tenants found. Set TENANT_ID env var.');
  return tenantsSnap.docs[0].id;
}

async function main() {
  const tenantId = await getTenantId();
  console.log('Seeding onboarding data for tenant:', tenantId);

  console.log('\nEntities:');
  await seedEntities(tenantId);

  console.log('\nRequirement packages:');
  await seedRequirementPackages(tenantId);

  console.log('\nDone. Next: update 1–2 job orders with entityId = the document ID from tenants/{tid}/entities/');
  console.log('  (e.g. entityId: "c1_workforce_llc", requirementPackageId: "w2_basic")');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Seed onboarding item library for Phase 1B.
 *
 * Creates sample items in tenants/{tenantId}/onboarding_item_library
 * (handbook_employee_ack, ic_agreement, w4, i9, background_standard, everify, etc.)
 *
 * Run: TENANT_ID=your-tenant-id node scripts/seedOnboardingItemLibrary.js
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

const ITEMS = [
  {
    key: 'handbook_employee_ack',
    title: 'Employee Handbook Acknowledgment',
    type: 'document',
    audience: 'worker',
    requiredDefault: true,
    blockingDefault: true,
    documentMode: 'acknowledge',
    documentKey: 'handbook_employee',
    tags: ['W2', '1099'],
    isActive: true,
  },
  {
    key: 'handbook_contractor_ack',
    title: 'Contractor Handbook Acknowledgment',
    type: 'document',
    audience: 'worker',
    requiredDefault: true,
    blockingDefault: true,
    documentMode: 'acknowledge',
    documentKey: 'handbook_contractor',
    tags: ['1099'],
    isActive: true,
  },
  {
    key: 'ic_agreement',
    title: 'Independent Contractor Agreement',
    type: 'document',
    audience: 'worker',
    requiredDefault: true,
    blockingDefault: true,
    documentMode: 'esign',
    documentKey: 'ic_agreement',
    tags: ['1099'],
    isActive: true,
  },
  {
    key: 'w4',
    title: 'W-4',
    type: 'step',
    audience: 'worker',
    requiredDefault: true,
    blockingDefault: true,
    tags: ['W2'],
    isActive: true,
  },
  {
    key: 'i9',
    title: 'I-9',
    type: 'step',
    audience: 'worker',
    requiredDefault: true,
    blockingDefault: true,
    tags: ['W2', 'everify'],
    isActive: true,
  },
  {
    key: 'background_standard',
    title: 'Background Check (Standard)',
    type: 'check',
    audience: 'worker',
    requiredDefault: true,
    blockingDefault: true,
    checkProvider: 'backgroundVendor',
    tags: ['W2', '1099'],
    isActive: true,
  },
  {
    key: 'everify',
    title: 'E-Verify',
    type: 'check',
    audience: 'worker',
    requiredDefault: true,
    blockingDefault: true,
    checkProvider: 'everify',
    tags: ['W2', 'everify'],
    isActive: true,
  },
  {
    key: 'direct_deposit_placeholder',
    title: 'Direct Deposit (Placeholder)',
    type: 'step',
    audience: 'worker',
    requiredDefault: true,
    blockingDefault: false,
    tags: ['W2'],
    isActive: true,
  },
  {
    key: 'emergency_contact',
    title: 'Emergency Contact',
    type: 'step',
    audience: 'worker',
    requiredDefault: false,
    blockingDefault: false,
    tags: [],
    isActive: true,
  },
];

async function getTenantId() {
  if (process.env.TENANT_ID) return process.env.TENANT_ID;
  const tenantsSnap = await db.collection('tenants').limit(1).get();
  if (tenantsSnap.empty) throw new Error('No tenants found. Set TENANT_ID env var.');
  return tenantsSnap.docs[0].id;
}

async function main() {
  const tenantId = await getTenantId();
  const colRef = db.collection('tenants').doc(tenantId).collection('onboarding_item_library');

  console.log('Seeding onboarding item library for tenant:', tenantId);

  for (const item of ITEMS) {
    const docRef = colRef.doc(item.key);
    const snap = await docRef.get();
    if (snap.exists) {
      console.log('  Skip (exists):', item.key);
      continue;
    }
    await docRef.set({
      ...item,
      createdAt: now,
      updatedAt: now,
    });
    console.log('  Created:', item.key, item.title);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

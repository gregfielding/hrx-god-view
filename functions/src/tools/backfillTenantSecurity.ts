/**
 * Backfill Tenant Security Levels
 * 
 * Ensures all users have per-tenant security levels set.
 * If a user has a legacy global securityLevel but no tenantIds[tenantId].securityLevel,
 * this script copies the global level to the tenant-specific level.
 */

import * as admin from 'firebase-admin';

// Only initialize if not already initialized (when run as a standalone script)
if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

// TEMP: single-tenant focus for C1 Staffing
const DEFAULT_TENANT_ID = 'BCiP2bQ9CgVOCTfV6MhD';

/**
 * Normalize security level to a number (1-7)
 */
function normalize(level: any): number {
  if (level === undefined || level === null) return 1;
  if (typeof level === 'number') return level;
  const n = parseInt(String(level), 10);
  if (Number.isNaN(n)) return 1;
  return Math.min(Math.max(n, 1), 7);
}

/**
 * Backfill tenant security levels for all users
 */
async function backfillTenantSecurity(tenantId: string = DEFAULT_TENANT_ID) {
  console.log(`[backfillTenantSecurity] Starting for tenant ${tenantId}...`);

  const snapshot = await db.collection('users').get();

  if (snapshot.empty) {
    console.log('[backfillTenantSecurity] No users found.');
    return;
  }

  console.log(`[backfillTenantSecurity] Found ${snapshot.size} users. Processing...`);

  let currentBatch = db.batch();
  let counter = 0;
  let updated = 0;
  let skipped = 0;
  const BATCH_SIZE = 500; // Firestore batch limit

  const commitBatch = async () => {
    if (counter > 0) {
      console.log(`[backfillTenantSecurity] Committing batch of ${counter} updates...`);
      await currentBatch.commit();
      counter = 0;
      currentBatch = db.batch();
    }
  };

  for (const doc of snapshot.docs) {
    const data = doc.data() || {};
    const userRef = doc.ref;

    const activeTenantId: string = (data.activeTenantId as string) || tenantId;

    const legacyLevel = normalize(data.securityLevel);
    const tenantIds = (data.tenantIds || {}) as Record<string, any>;
    const tenantSettings = tenantIds[activeTenantId] || {};

    // Only update if tenant security level is missing
    if (tenantSettings.securityLevel === undefined) {
      tenantSettings.securityLevel = legacyLevel;
      tenantIds[activeTenantId] = tenantSettings;

      // Ensure activeTenantId is set
      const updateData: any = {
        tenantIds,
      };

      if (!data.activeTenantId) {
        updateData.activeTenantId = activeTenantId;
      }

      currentBatch.set(userRef, updateData, { merge: true });
      counter += 1;
      updated += 1;

      if (counter >= BATCH_SIZE) {
        await commitBatch();
      }
    } else {
      skipped += 1;
    }
  }

  await commitBatch();

  console.log('[backfillTenantSecurity] DONE.');
  console.log({
    tenantId,
    totalUsers: snapshot.size,
    updated,
    skipped,
  });
}

// Allow running directly via `ts-node` or `node` after compilation
if (require.main === module) {
  backfillTenantSecurity()
    .then(() => {
      console.log('[backfillTenantSecurity] Complete.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[backfillTenantSecurity] ERROR', err);
      process.exit(1);
    });
}

export { backfillTenantSecurity };


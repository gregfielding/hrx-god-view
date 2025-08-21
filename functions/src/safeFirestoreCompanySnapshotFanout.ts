import * as admin from 'firebase-admin';
import * as functionsV1 from 'firebase-functions';
import { createSafeFirestoreTrigger, SafeFunctionUtils, CostTracker } from './utils/safeFunctionTemplate';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Configuration for safe company snapshot fanout
const SAFE_CONFIG = {
  MAX_DEALS_PER_BATCH: 500,
  MAX_EXECUTION_TIME_MS: 55000, // 55 seconds (under 60s limit)
  MAX_RECURSIVE_CALLS: 3,
  BATCH_DELAY_MS: 200, // Small backoff between batches
  RELEVANT_FIELDS: ['companyName', 'name', 'industry', 'city', 'state', 'companyPhone', 'phone', 'companyUrl', 'website', 'logo'],
  TAG: 'firestoreCompanySnapshotFanout@v2'
};

/**
 * Circuit breaker check - top of every handler per playbook
 */
function checkCircuitBreaker(): void {
  if (process.env.CIRCUIT_BREAKER === 'on') {
    throw new Error('Circuit breaker is active - function execution blocked');
  }
}

/**
 * Check if dual write is enabled
 */
function isDualWriteEnabled(): boolean {
  try {
    const cfg = (functionsV1 as any).config?.() || {};
    const val = cfg?.flags?.enable_dual_write;
    if (typeof val === 'string') return val.toLowerCase() === 'true';
    if (typeof val === 'boolean') return val === true;
  } catch {
    // ignore
  }
  return true; // default on
}

/**
 * Pick defined values from object (remove undefined, null, empty strings)
 */
function pickDefined<T extends Record<string, any>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  Object.keys(obj || {}).forEach((k) => {
    const v = (obj as any)[k];
    if (v !== undefined && v !== null && v !== '') {
      (out as any)[k] = v;
    }
  });
  return out;
}

/**
 * Check if relevant fields actually changed to prevent unnecessary updates
 * Per playbook §2.2: Change-only Processing
 */
function hasRelevantChanges(before: any, after: any): boolean {
  if (!before) return true; // New document
  
  return SAFE_CONFIG.RELEVANT_FIELDS.some(field => {
    const beforeValue = before[field];
    const afterValue = after[field];
    return JSON.stringify(beforeValue) !== JSON.stringify(afterValue);
  });
}

/**
 * Safe batch operation with limits per playbook §2.6
 */
async function safeBatchOperation<T>(
  items: T[],
  operation: (batch: admin.firestore.WriteBatch, item: T) => void,
  batchSize: number = SAFE_CONFIG.MAX_DEALS_PER_BATCH
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = db.batch();
    const batchItems = items.slice(i, i + batchSize);
    
    batchItems.forEach(item => operation(batch, item));
    
    // Check safety limits before committing
    SafeFunctionUtils.checkSafetyLimits();
    
    await batch.commit();
    
    // Small backoff between batches per playbook §2.6
    if (i + batchSize < items.length) {
      await new Promise(resolve => setTimeout(resolve, SAFE_CONFIG.BATCH_DELAY_MS));
    }
  }
}

/**
 * Update deals for entity with safety measures
 */
async function updateDealsForEntitySafely(
  tenantId: string,
  entityId: string,
  snapshotData: Record<string, any>
): Promise<void> {
  const dealsRef = db.collection('tenants').doc(tenantId).collection('crm_deals');
  
  // Use safe query with limits
  const snapshot = await SafeFunctionUtils.safeQuery(
    dealsRef.where('companyIds', 'array-contains', entityId),
    SAFE_CONFIG.MAX_DEALS_PER_BATCH
  );

  if (snapshot.length === 0) {
    console.log(`No deals found for company ${entityId} in tenant ${tenantId}`);
    return;
  }

  const dealsToUpdate: Array<{ doc: admin.firestore.QueryDocumentSnapshot; updatedAssociations: any }> = [];

  // Process deals and prepare updates
  snapshot.forEach((dealDoc) => {
    const dealData: any = dealDoc.data() || {};
    const assocArr: any[] = (dealData.associations?.companies || []).slice();
    
    if (!Array.isArray(assocArr) || assocArr.length === 0) return;

    let changed = false;
    const updatedArr = assocArr.map((entry) => {
      if (typeof entry === 'string') {
        // keep string form as-is
        return entry;
      }
      if (entry && entry.id === entityId) {
        const existingSnapshot = entry.snapshot || {};
        const nextSnapshot = { ...existingSnapshot, ...snapshotData };
        changed = true;
        return { ...entry, snapshot: nextSnapshot };
      }
      return entry;
    });

    if (changed) {
      const nextAssociations = {
        ...(dealData.associations || {}),
        companies: updatedArr,
      };
      
      dealsToUpdate.push({
        doc: dealDoc,
        updatedAssociations: nextAssociations
      });
    }
  });

  if (dealsToUpdate.length === 0) {
    console.log(`No deals need updating for company ${entityId}`);
    return;
  }

  // Use safe batch operation
  await safeBatchOperation(dealsToUpdate, (batch, item) => {
    batch.update(item.doc.ref, {
      associations: item.updatedAssociations,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      _processedBy: SAFE_CONFIG.TAG,
      _processedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });

  console.log(`Updated ${dealsToUpdate.length} deals for company ${entityId} in tenant ${tenantId}`);
}

/**
 * Safe version of firestoreCompanySnapshotFanout with hardening playbook compliance
 */
const safeTrigger = createSafeFirestoreTrigger(
  async (event) => {
    // Circuit breaker check per playbook §2.1
    checkCircuitBreaker();
    
    SafeFunctionUtils.resetCounters();
    CostTracker.reset();

    // Set up timeout per playbook §2.7
    const abort = AbortSignal.timeout(SAFE_CONFIG.MAX_EXECUTION_TIME_MS);

    try {
      // Check if dual write is enabled
      if (!isDualWriteEnabled()) {
        console.log('Dual write disabled, skipping company snapshot fanout');
        return;
      }

      const tenantId = event.params.tenantId as string;
      const companyId = event.params.companyId as string;
      const before = event.data?.before.data();
      const after = event.data?.after.data();
      
      if (!after) {
        console.log('No after data, skipping company snapshot fanout');
        return;
      }

      // Self-write ignore per playbook §2.3
      if (after._processedBy === SAFE_CONFIG.TAG) {
        console.log('Ignoring self-write for company snapshot fanout');
        return;
      }

      // Check if relevant fields actually changed per playbook §2.2
      if (!hasRelevantChanges(before, after)) {
        console.log('No relevant company fields changed, skipping deal association update');
        return;
      }

      // Check abort signal
      if (abort.aborted) {
        throw new Error('Function execution timeout');
      }

      // Prepare snapshot data
      const snap = pickDefined({
        name: after.companyName || after.name,
        industry: after.industry,
        city: after.city,
        state: after.state,
        phone: after.companyPhone || after.phone,
        companyUrl: after.companyUrl || after.website,
        logo: after.logo,
      });

      // Update deals with safety measures
      await updateDealsForEntitySafely(tenantId, companyId, snap);

      const costSummary = CostTracker.getCostSummary();
      console.log(`Company snapshot fanout completed for ${companyId}, Cost: $${costSummary.estimatedCost.toFixed(4)}`);

    } catch (error) {
      console.error('Error in company snapshot fanout:', error);
      // Don't throw - Firestore triggers should fail gracefully per playbook
    }
  },
  {
    timeoutSeconds: Math.floor(SAFE_CONFIG.MAX_EXECUTION_TIME_MS / 1000),
    memory: '512MiB',
    maxInstances: 2
  }
);

export const firestoreCompanySnapshotFanout = safeTrigger.onDocumentUpdated('tenants/{tenantId}/crm_companies/{companyId}');

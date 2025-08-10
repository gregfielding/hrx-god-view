import { onCall, onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

export async function performUpdate(payload: {
  tenantId: string;
  entityType: string;
  entityId: string;
  companyId: string;
  locationId?: string | null;
  locationName?: string | null;
}) {
  const { tenantId, entityType, entityId, locationId, companyId, locationName } = payload;
  if (!tenantId || !entityType || !entityId || !companyId) {
    throw new Error('Missing required parameters: tenantId, entityType, entityId, companyId');
  }

  const db = admin.firestore();
  let collectionName: string;
  switch (entityType) {
    case 'contact':
      collectionName = 'crm_contacts';
      break;
    case 'deal':
      collectionName = 'crm_deals';
      break;
    case 'salesperson':
      collectionName = 'crm_salespeople';
      break;
    default:
      throw new Error(`Invalid entity type: ${entityType}`);
  }

  const entityRef = db.collection('tenants').doc(tenantId).collection(collectionName).doc(entityId);
  const updateData: any = {
    locationId: locationId || null,
    locationName: locationName || null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  await entityRef.update(updateData);

  if (!locationId) {
    const entityDoc = await entityRef.get();
    const entityData = entityDoc.data();
    const currentLocationId = (entityData as any)?.locationId;
    if (currentLocationId) {
      await updateLocationAssociationCounts(db, tenantId, companyId, currentLocationId, entityType, -1);
    }
  } else {
    await updateLocationAssociationCounts(db, tenantId, companyId, locationId, entityType, 1);
  }

  return { success: true, message: `Location association updated for ${entityType}` };
}

// Callable (used by Firebase client SDK)
export const updateLocationAssociation = onCall({ cors: true }, async (request) => {
  try {
    return await performUpdate(request.data);

  } catch (error: any) {
    console.error('Error in updateLocationAssociation:', error);
    
    // Provide more specific error messages
    if (error.code === 'permission-denied') {
      throw new Error('Permission denied: You do not have access to update this association');
    } else if (error.code === 'not-found') {
      throw new Error('Entity not found: The contact or location does not exist');
    } else if (error.message) {
      throw new Error(`Failed to update location association: ${error.message}`);
    } else {
      throw new Error('Failed to update location association');
    }
  }
});

// HTTP wrapper (supports direct fetch with proper CORS)
export const updateLocationAssociationHttp = onRequest({ cors: true, region: 'us-central1', concurrency: 80, timeoutSeconds: 30, memory: '256MiB', minInstances: 0 }, async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.status(204).send('');
      return;
    }

    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const result = await performUpdate(payload || {});
    res.set('Access-Control-Allow-Origin', '*');
    res.status(200).json(result);
  } catch (error: any) {
    res.set('Access-Control-Allow-Origin', '*');
    res.status(500).json({ error: error.message || 'Failed to update location association' });
  }
});

async function updateLocationAssociationCounts(
  db: admin.firestore.Firestore,
  tenantId: string,
  companyId: string,
  locationId: string,
  entityType: string,
  increment: number
) {
  try {
    const locationRef = db.collection('tenants').doc(tenantId).collection('crm_companies').doc(companyId).collection('locations').doc(locationId);
    
    // Check if location document exists
    const locationDoc = await locationRef.get();
    if (!locationDoc.exists) {
      console.warn(`Location document ${locationId} does not exist, skipping count update`);
      return;
    }
    
    const updateData: any = {};
    
    switch (entityType) {
      case 'contact':
        updateData.contactCount = admin.firestore.FieldValue.increment(increment);
        break;
      case 'deal':
        updateData.dealCount = admin.firestore.FieldValue.increment(increment);
        break;
      case 'salesperson':
        updateData.salespersonCount = admin.firestore.FieldValue.increment(increment);
        break;
    }
    
    updateData.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    
    await locationRef.update(updateData);
    console.log(`Successfully updated location association counts for ${entityType} in location ${locationId}`);
  } catch (error) {
    console.error('Error updating location association counts:', error);
    // Don't throw here as this is a secondary operation
  }
} 
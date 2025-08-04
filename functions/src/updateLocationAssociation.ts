import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

export const updateLocationAssociation = onCall(async (request) => {
  try {
    const { tenantId, entityType, entityId, locationId, companyId, locationName } = request.data;
    
    if (!tenantId || !entityType || !entityId || !companyId) {
      throw new Error('Missing required parameters: tenantId, entityType, entityId, companyId');
    }

    console.log(`Updating location association for ${entityType} ${entityId} in company ${companyId}, tenant ${tenantId}`);

    const db = admin.firestore();
    
    // Determine the collection based on entity type
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

    // Update the entity with location association
    const entityRef = db.collection('tenants').doc(tenantId).collection(collectionName).doc(entityId);
    
    const updateData: any = {
      locationId: locationId || null,
      locationName: locationName || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await entityRef.update(updateData);

    // If we're removing a location association, also update the location's association counts
    if (!locationId) {
      // Get the current locationId to update its counts
      const entityDoc = await entityRef.get();
      const entityData = entityDoc.data();
      const currentLocationId = entityData?.locationId;
      
      if (currentLocationId) {
        await updateLocationAssociationCounts(db, tenantId, companyId, currentLocationId, entityType, -1);
      }
    } else {
      // Update the new location's association counts
      await updateLocationAssociationCounts(db, tenantId, companyId, locationId, entityType, 1);
    }

    console.log(`Successfully updated location association for ${entityType} ${entityId}`);
    
    return {
      success: true,
      message: `Location association updated for ${entityType}`
    };

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
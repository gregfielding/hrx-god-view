import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

interface AssociationRequest {
  action: 'add' | 'remove';
  sourceEntityType: string;
  sourceEntityId: string;
  targetEntityType: string;
  targetEntityId: string;
  tenantId: string;
}

interface AssociationResponse {
  success: boolean;
  message: string;
  associations?: any;
}

export const manageAssociations = functions.https.onCall(async (request, context) => {
  // Check if user is authenticated
  if (!request.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { action, sourceEntityType, sourceEntityId, targetEntityType, targetEntityId, tenantId } = request.data as AssociationRequest;
  const userId = request.auth.uid;

  try {
    console.log(`🔗 Managing association: ${action} ${sourceEntityType}:${sourceEntityId} → ${targetEntityType}:${targetEntityId}`);

    // Verify user has access to the tenant
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new functions.https.HttpsError('permission-denied', 'User not found');
    }

    const userData = userDoc.data();
    const userTenants = userData?.tenantIds || [];
    const userTenantIds = Array.isArray(userTenants) ? userTenants : Object.keys(userTenants);

    if (!userTenantIds.includes(tenantId)) {
      throw new functions.https.HttpsError('permission-denied', 'User does not have access to this tenant');
    }

    // Check if user has CRM access
    // Temporarily allow any authenticated user for testing
    const hasCRMAccess = userData?.crm_sales === true || 
                        userData?.role === 'HRX' || 
                        ['4', '5', '6', '7'].includes(userData?.securityLevel || '');
    
    if (!hasCRMAccess) {
      console.log('⚠️ User does not have explicit CRM access, but allowing for testing');
      // throw new functions.https.HttpsError('permission-denied', 'User does not have CRM access');
    }

    // Get collection paths
    const getCollectionPath = (entityType: string): string => {
      const collectionMap: { [key: string]: string } = {
        'company': `tenants/${tenantId}/crm_companies`,
        'companies': `tenants/${tenantId}/crm_companies`,
        'deal': `tenants/${tenantId}/crm_deals`,
        'deals': `tenants/${tenantId}/crm_deals`,
        'contact': `tenants/${tenantId}/crm_contacts`,
        'contacts': `tenants/${tenantId}/crm_contacts`,
        'salesperson': 'users',
        'salespeople': 'users',
        'task': `tenants/${tenantId}/crm_tasks`,
        'tasks': `tenants/${tenantId}/crm_tasks`,
        // Note: Locations are stored as subcollections under companies, not as a top-level collection
        'location': `tenants/${tenantId}/crm_companies`, // This will need special handling
        'locations': `tenants/${tenantId}/crm_companies`  // This will need special handling
      };
      return collectionMap[entityType] || `tenants/${tenantId}/crm_${entityType}s`;
    };

    // Helper function to get correct plural key
    const getCorrectPluralKey = (entityType: string): string => {
      const pluralMap: { [key: string]: string } = {
        'company': 'companies',
        'companies': 'companies',
        'deal': 'deals',
        'deals': 'deals',
        'contact': 'contacts',
        'contacts': 'contacts',
        'salesperson': 'salespeople',
        'salespeople': 'salespeople',
        'location': 'locations',
        'locations': 'locations',
        'task': 'tasks',
        'tasks': 'tasks'
      };
      return pluralMap[entityType] || `${entityType}s`;
    };

    // Get source and target entity documents
    const sourceCollection = getCollectionPath(sourceEntityType);
    const targetCollection = getCollectionPath(targetEntityType);

    const sourceRef = admin.firestore().collection(sourceCollection).doc(sourceEntityId);
    
    // Special handling for locations since they're stored as subcollections under companies
    let targetRef: admin.firestore.DocumentReference | undefined;
    if (targetEntityType === 'location' || targetEntityType === 'locations') {
      // For locations, we need to find which company they belong to
      // Since we don't have the companyId in the request, we'll need to search for it
      const companiesRef = admin.firestore().collection(`tenants/${tenantId}/crm_companies`);
      const companiesSnapshot = await companiesRef.get();
      
      let locationFound = false;
      for (const companyDoc of companiesSnapshot.docs) {
        const locationRef = companyDoc.ref.collection('locations').doc(targetEntityId);
        const locationDoc = await locationRef.get();
        if (locationDoc.exists) {
          targetRef = locationRef;
          locationFound = true;
          break;
        }
      }
      
      if (!locationFound) {
        throw new functions.https.HttpsError('not-found', `Target entity ${targetEntityType}:${targetEntityId} not found`);
      }
    } else {
      targetRef = admin.firestore().collection(targetCollection).doc(targetEntityId);
    }

    // Ensure targetRef is assigned
    if (!targetRef) {
      throw new functions.https.HttpsError('internal', 'Failed to resolve target reference');
    }

    const [sourceDoc, targetDoc] = await Promise.all([
      sourceRef.get(),
      targetRef.get()
    ]);

    if (!sourceDoc.exists) {
      throw new functions.https.HttpsError('not-found', `Source entity ${sourceEntityType}:${sourceEntityId} not found`);
    }

    if (!targetDoc.exists) {
      throw new functions.https.HttpsError('not-found', `Target entity ${targetEntityType}:${targetEntityId} not found`);
    }

    // Prepare update operations
    const batch = admin.firestore().batch();
    const targetArrayKey = getCorrectPluralKey(targetEntityType);
    const sourceArrayKey = getCorrectPluralKey(sourceEntityType);

    if (action === 'add') {
      // Create association objects with names for quick reference
      const targetEntityData = targetDoc.data();
      const sourceEntityData = sourceDoc.data();
      
      // Build target association object
      const targetAssociation = {
        id: targetEntityId,
        name: targetEntityData?.name || targetEntityData?.fullName || targetEntityData?.companyName || targetEntityData?.title || 'Unknown',
        email: targetEntityData?.email || '',
        phone: targetEntityData?.phone || '',
        type: targetEntityType === 'company' ? 'primary' : undefined
      };
      
      // Build source association object
      const sourceAssociation = {
        id: sourceEntityId,
        name: sourceEntityData?.name || sourceEntityData?.fullName || sourceEntityData?.companyName || sourceEntityData?.title || 'Unknown',
        email: sourceEntityData?.email || '',
        phone: sourceEntityData?.phone || '',
        type: sourceEntityType === 'company' ? 'primary' : undefined
      };
      
      // Add target to source associations (as object with name)
      batch.update(sourceRef, {
        [`associations.${targetArrayKey}`]: admin.firestore.FieldValue.arrayUnion(targetAssociation),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: userId
      });

      // Add source to target associations (as object with name)
      batch.update(targetRef, {
        [`associations.${sourceArrayKey}`]: admin.firestore.FieldValue.arrayUnion(sourceAssociation),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: userId
      });

      console.log(`✅ Added association: ${sourceEntityType}:${sourceEntityId} ↔ ${targetEntityType}:${targetEntityId}`);
    } else if (action === 'remove') {
      // For removal, we need to remove by ID since we can't use arrayRemove with objects
      // We'll need to get the current associations and filter out the target
      const sourceData = sourceDoc.data();
      const targetData = targetDoc.data();
      
      // Remove target from source associations
      const currentSourceAssociations = sourceData?.associations?.[targetArrayKey] || [];
      const updatedSourceAssociations = currentSourceAssociations.filter((assoc: any) => 
        typeof assoc === 'string' ? assoc !== targetEntityId : assoc.id !== targetEntityId
      );
      
      // Remove source from target associations
      const currentTargetAssociations = targetData?.associations?.[sourceArrayKey] || [];
      const updatedTargetAssociations = currentTargetAssociations.filter((assoc: any) => 
        typeof assoc === 'string' ? assoc !== sourceEntityId : assoc.id !== sourceEntityId
      );
      
      batch.update(sourceRef, {
        [`associations.${targetArrayKey}`]: updatedSourceAssociations,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: userId
      });

      batch.update(targetRef, {
        [`associations.${sourceArrayKey}`]: updatedTargetAssociations,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: userId
      });

      console.log(`✅ Removed association: ${sourceEntityType}:${sourceEntityId} ↔ ${targetEntityType}:${targetEntityId}`);
    }

    // Execute the batch
    await batch.commit();

    const response: AssociationResponse = {
      success: true,
      message: `Successfully ${action}ed association between ${sourceEntityType}:${sourceEntityId} and ${targetEntityType}:${targetEntityId}`
    };

    return response;

  } catch (error: any) {
    console.error('❌ Error managing association:', error);
    throw new functions.https.HttpsError('internal', `Failed to ${action} association: ${error.message}`);
  }
}); 
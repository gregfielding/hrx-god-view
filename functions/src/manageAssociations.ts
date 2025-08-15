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

export const handleManageAssociations = async (request: any, context: any) => {
  // Check if user is authenticated
  if (!request.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { action, sourceEntityType, sourceEntityId, targetEntityType, targetEntityId, tenantId, soft } = request.data as any;
  const userId = request.auth.uid;

  try {
    console.log(`🔗 Managing association: ${action} ${sourceEntityType}:${sourceEntityId} → ${targetEntityType}:${targetEntityId}`);

    // Verify user has access to the tenant (or holds a CRM role)
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new functions.https.HttpsError('permission-denied', 'User not found');
    }

    const userData = userDoc.data();
    const userTenants = userData?.tenantIds || [];
    const userTenantIds = Array.isArray(userTenants) ? userTenants : Object.keys(userTenants);

    // CRM role flags
    const hasCRMAccess = userData?.crm_sales === true ||
      userData?.role === 'HRX' ||
      ['4', '5', '6', '7'].includes(userData?.securityLevel || '');

    const allowedTenant = !!tenantId && userTenantIds.includes(tenantId);
    if (!allowedTenant && !hasCRMAccess) {
      console.warn('🚫 Tenant access check failed', { userId, tenantId, userTenantIds });
      throw new functions.https.HttpsError('permission-denied', 'User does not have access to this tenant');
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
      // Optimized: resolve location via collection group instead of scanning all companies
      const cgSnap = await admin
        .firestore()
        .collectionGroup('locations')
        .where(admin.firestore.FieldPath.documentId(), '==', targetEntityId)
        .limit(5)
        .get();

      if (cgSnap.empty) {
        throw new functions.https.HttpsError('not-found', `Target entity ${targetEntityType}:${targetEntityId} not found`);
      }

      // Prefer the location under the specified tenant if multiple are found
      const match = cgSnap.docs.find(d => d.ref.path.startsWith(`tenants/${tenantId}/crm_companies/`));
      targetRef = (match ?? cgSnap.docs[0]).ref;
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

    // Feature flags
    const enableDualWrite = (() => {
      try {
        const cfg = functions.config() as any;
        const v = cfg?.flags?.enable_dual_write;
        if (v === 'false') return false;
        if (v === false) return false;
        return true; // default on
      } catch {
        return true;
      }
    })();

    // Prepare update operations
    const batch = admin.firestore().batch();
    const targetArrayKey = getCorrectPluralKey(targetEntityType);
    const sourceArrayKey = getCorrectPluralKey(sourceEntityType);

    // Helper: update deal id arrays (companyIds/contactIds/salespersonIds/locationIds)
    const updateDealIdArrays = (dealRef: admin.firestore.DocumentReference, assocKey: string, id: string, op: 'add' | 'remove') => {
      const map: Record<string, string> = {
        companies: 'companyIds',
        contacts: 'contactIds',
        salespeople: 'salespersonIds',
        locations: 'locationIds'
      };
      const idArrayField = map[assocKey];
      if (!idArrayField) return;
      const FieldValue = admin.firestore.FieldValue as any;
      batch.update(dealRef, {
        [idArrayField]: op === 'add' ? FieldValue.arrayUnion(id) : FieldValue.arrayRemove(id)
      });
    };

    if (action === 'add') {
      // Create association objects with names for quick reference
      const targetEntityData = targetDoc.data();
      const sourceEntityData = sourceDoc.data();
      
      // Build target association object (normalized with schemaVersion)
      const targetAssociation = {
        id: targetEntityId,
        name: targetEntityData?.name || targetEntityData?.fullName || targetEntityData?.companyName || targetEntityData?.title || 'Unknown',
        email: targetEntityData?.email || '',
        phone: targetEntityData?.phone || '',
        ...(targetEntityType === 'company' ? { type: 'primary' } : {}),
        schemaVersion: 1,
        addedBy: userId,
        // Firestore does not allow FieldValue.serverTimestamp() inside array elements
        addedAt: admin.firestore.Timestamp.now()
      } as any;
      
      // Build source association object (normalized with schemaVersion)
      const sourceAssociation = {
        id: sourceEntityId,
        name: sourceEntityData?.name || sourceEntityData?.fullName || sourceEntityData?.companyName || sourceEntityData?.title || 'Unknown',
        email: sourceEntityData?.email || '',
        phone: sourceEntityData?.phone || '',
        ...(sourceEntityType === 'company' ? { type: 'primary' } : {}),
        schemaVersion: 1,
        addedBy: userId,
        // Firestore does not allow FieldValue.serverTimestamp() inside array elements
        addedAt: admin.firestore.Timestamp.now()
      } as any;
      
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

      if (enableDualWrite) {
        // Dual-write: maintain deal id arrays and reverse indexes
        const isSourceDeal = sourceEntityType === 'deal' || sourceEntityType === 'deals';
        const isTargetDeal = targetEntityType === 'deal' || targetEntityType === 'deals';

        if (isSourceDeal) {
          // source is deal → update its id arrays
          updateDealIdArrays(sourceRef, targetArrayKey, targetEntityId, 'add');

          // Intentionally do not set legacy deal.companyId/companyName

          // Update reverse index on target entity: associations.deals
          batch.update(targetRef, {
            'associations.deals': admin.firestore.FieldValue.arrayUnion({ id: sourceEntityId, addedAt: admin.firestore.Timestamp.now() })
          });
        } else if (isTargetDeal) {
          // target is deal → update its id arrays
          updateDealIdArrays(targetRef, sourceArrayKey, sourceEntityId, 'add');

          // Intentionally do not set legacy deal.companyId/companyName

          // Update reverse index on source entity: associations.deals
          batch.update(sourceRef, {
            'associations.deals': admin.firestore.FieldValue.arrayUnion({ id: targetEntityId, addedAt: admin.firestore.Timestamp.now() })
          });
        }
      }

      console.log(`✅ Added association: ${sourceEntityType}:${sourceEntityId} ↔ ${targetEntityType}:${targetEntityId}`);
    } else if (action === 'remove') {
      // Optional soft-delete path
      if (soft === true) {
        const sourceData = sourceDoc.data();
        const targetData = targetDoc.data();
        const currentSourceAssociations = sourceData?.associations?.[targetArrayKey] || [];
        const updatedSourceAssociations = currentSourceAssociations.map((assoc: any) => {
          if (typeof assoc === 'object' && assoc.id === targetEntityId) {
            return {
              schemaVersion: assoc.schemaVersion ?? 1,
              ...assoc,
              // Firestore does not allow FieldValue.serverTimestamp() inside array elements
              removedAt: admin.firestore.Timestamp.now(),
              removedBy: userId
            };
          }
          return assoc;
        });
        const currentTargetAssociations = targetData?.associations?.[sourceArrayKey] || [];
        const updatedTargetAssociations = currentTargetAssociations.map((assoc: any) => {
          if (typeof assoc === 'object' && assoc.id === sourceEntityId) {
            return {
              schemaVersion: assoc.schemaVersion ?? 1,
              ...assoc,
              // Firestore does not allow FieldValue.serverTimestamp() inside array elements
              removedAt: admin.firestore.Timestamp.now(),
              removedBy: userId
            };
          }
          return assoc;
        });

        await admin.firestore().runTransaction(async (trx) => {
          trx.update(sourceRef, { [`associations.${targetArrayKey}`]: updatedSourceAssociations, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: userId });
          trx.update(targetRef, { [`associations.${sourceArrayKey}`]: updatedTargetAssociations, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: userId });
        });
        return { success: true, message: 'Soft-removed association' } as AssociationResponse;
      }
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

      if (enableDualWrite) {
        const isSourceDeal = sourceEntityType === 'deal' || sourceEntityType === 'deals';
        const isTargetDeal = targetEntityType === 'deal' || targetEntityType === 'deals';

        if (isSourceDeal) {
          updateDealIdArrays(sourceRef, targetArrayKey, targetEntityId, 'remove');

          // Remove reverse index on target entity: associations.deals (needs read-modify-write)
          const targetDataFresh = (await targetRef.get()).data() || {};
          const currentDeals = (targetDataFresh.associations?.deals || []) as any[];
          const updatedDeals = currentDeals.filter((d: any) => (typeof d === 'string' ? d !== sourceEntityId : d.id !== sourceEntityId));
          batch.update(targetRef, { 'associations.deals': updatedDeals });
        } else if (isTargetDeal) {
          updateDealIdArrays(targetRef, sourceArrayKey, sourceEntityId, 'remove');

          const sourceDataFresh = (await sourceRef.get()).data() || {};
          const currentDeals = (sourceDataFresh.associations?.deals || []) as any[];
          const updatedDeals = currentDeals.filter((d: any) => (typeof d === 'string' ? d !== targetEntityId : d.id !== targetEntityId));
          batch.update(sourceRef, { 'associations.deals': updatedDeals });
        }
      }

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
};

export const manageAssociations = functions.https.onCall(handleManageAssociations);
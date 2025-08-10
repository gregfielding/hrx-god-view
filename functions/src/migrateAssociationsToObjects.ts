import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

interface MigrationRequest {
  tenantId: string;
  entityType?: string; // Optional: migrate specific entity type only
  dryRun?: boolean; // Optional: preview changes without applying
}

interface MigrationResult {
  success: boolean;
  message: string;
  entitiesProcessed: number;
  associationsMigrated: number;
  errors: string[];
  dryRun?: boolean;
}

export const migrateAssociationsToObjects = functions.https.onCall(async (request, context) => {
  // Check if user is authenticated
  if (!request.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { tenantId, entityType, dryRun = false } = request.data as MigrationRequest;
  const userId = request.auth.uid;

  if (!tenantId) {
    throw new functions.https.HttpsError('invalid-argument', 'tenantId is required');
  }

  try {
    console.log(`🔄 Starting association migration for tenant ${tenantId}${dryRun ? ' (DRY RUN)' : ''}`);
    
    const db = admin.firestore();
    const results: MigrationResult = {
      success: true,
      message: 'Migration completed successfully',
      entitiesProcessed: 0,
      associationsMigrated: 0,
      errors: [],
      dryRun
    };

    // Define entity types to migrate
    const entityTypes = entityType ? [entityType] : ['deal', 'company', 'contact', 'location'];
    
    for (const type of entityTypes) {
      console.log(`🔍 Processing ${type} entities...`);
      
      try {
        const collectionPath = getCollectionPath(type, tenantId);
        const collectionRef = db.collection(collectionPath);
        const snapshot = await collectionRef.get();
        
        console.log(`📊 Found ${snapshot.docs.length} ${type} entities`);
        
        for (const doc of snapshot.docs) {
          try {
            const entityData = doc.data();
            const associations = entityData.associations || {};
            let hasChanges = false;
            const updatedAssociations: any = {};
            
            // Process each association type
            const associationTypes = ['companies', 'contacts', 'salespeople', 'locations', 'deals', 'divisions', 'tasks'];
            
            for (const assocType of associationTypes) {
              const currentAssociations = associations[assocType] || [];
              
              if (currentAssociations.length > 0) {
                // Check if associations are already objects or just IDs
                const needsMigration = currentAssociations.some((assoc: any) => typeof assoc === 'string');
                
                if (needsMigration) {
                  console.log(`🔄 Migrating ${assocType} for ${type} ${doc.id}`);
                  
                  // Convert string IDs to objects with names
                  const migratedAssociations = await Promise.all(
                    currentAssociations.map(async (assoc: any) => {
                      if (typeof assoc === 'string') {
                        // Fetch the actual entity data to get the name
                        const entityInfo = await fetchEntityInfo(assoc, assocType, tenantId, db);
                        return {
                          id: assoc,
                          name: entityInfo.name || 'Unknown',
                          email: entityInfo.email || '',
                          phone: entityInfo.phone || '',
                          type: assocType === 'companies' ? 'primary' : undefined
                        };
                      }
                      return assoc; // Already an object
                    })
                  );
                  
                  updatedAssociations[assocType] = migratedAssociations;
                  hasChanges = true;
                  results.associationsMigrated += migratedAssociations.length;
                }
              }
            }
            
            if (hasChanges) {
              if (!dryRun) {
                // Apply the changes
                await doc.ref.update({
                  associations: {
                    ...associations,
                    ...updatedAssociations,
                    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
                  },
                  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                  updatedBy: userId
                });
                console.log(`✅ Updated ${type} ${doc.id}`);
              } else {
                console.log(`🔍 Would update ${type} ${doc.id} (dry run)`);
              }
              
              results.entitiesProcessed++;
            }
            
          } catch (entityError: any) {
            const errorMsg = `Error processing ${type} ${doc.id}: ${entityError.message}`;
            console.error(`❌ ${errorMsg}`);
            results.errors.push(errorMsg);
          }
        }
        
      } catch (typeError: any) {
        const errorMsg = `Error processing ${type} entities: ${typeError.message}`;
        console.error(`❌ ${errorMsg}`);
        results.errors.push(errorMsg);
      }
    }
    
    console.log(`✅ Migration completed: ${results.entitiesProcessed} entities processed, ${results.associationsMigrated} associations migrated`);
    
    if (results.errors.length > 0) {
      results.success = false;
      results.message = `Migration completed with ${results.errors.length} errors`;
    }
    
    return results;
    
  } catch (error: any) {
    console.error('❌ Migration failed:', error);
    throw new functions.https.HttpsError('internal', `Migration failed: ${error.message}`);
  }
});

// Helper function to get collection path
function getCollectionPath(entityType: string, tenantId: string): string {
  const collectionMap: { [key: string]: string } = {
    'company': `tenants/${tenantId}/crm_companies`,
    'deal': `tenants/${tenantId}/crm_deals`,
    'contact': `tenants/${tenantId}/crm_contacts`,
    'location': `tenants/${tenantId}/crm_locations`,
    'task': `tenants/${tenantId}/crm_tasks`
  };
  return collectionMap[entityType] || `tenants/${tenantId}/crm_${entityType}s`;
}

// Helper function to fetch entity info
async function fetchEntityInfo(entityId: string, entityType: string, tenantId: string, db: admin.firestore.Firestore): Promise<any> {
  try {
    let collectionPath: string;
    
    switch (entityType) {
      case 'companies':
        collectionPath = `tenants/${tenantId}/crm_companies`;
        break;
      case 'contacts':
        collectionPath = `tenants/${tenantId}/crm_contacts`;
        break;
      case 'deals':
        collectionPath = `tenants/${tenantId}/crm_deals`;
        break;
      case 'salespeople':
        collectionPath = 'users';
        break;
      case 'locations':
        collectionPath = `tenants/${tenantId}/crm_locations`;
        break;
      case 'tasks':
        collectionPath = `tenants/${tenantId}/crm_tasks`;
        break;
      default:
        return { name: 'Unknown', email: '', phone: '' };
    }
    
    const docRef = db.collection(collectionPath).doc(entityId);
    const doc = await docRef.get();
    
    if (doc.exists) {
      const data = doc.data();
      return {
        name: data?.name || data?.fullName || data?.companyName || data?.title || 'Unknown',
        email: data?.email || '',
        phone: data?.phone || ''
      };
    }
    
    return { name: 'Unknown', email: '', phone: '' };
    
  } catch (error) {
    console.error(`Error fetching entity info for ${entityType} ${entityId}:`, error);
    return { name: 'Unknown', email: '', phone: '' };
  }
}

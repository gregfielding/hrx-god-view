/**
 * Firestore Trigger Template
 * 
 * Copy this template when creating new Firestore triggers for AI logging.
 * Replace the placeholder values with your actual collection and field names.
 */

import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { logAIAction } from '../feedbackEngine';

// ============================================================================
// TEMPLATE: Replace 'newCollection' with your actual collection name
// ============================================================================

// Create trigger
export const firestoreLogNewCollectionCreated = onDocumentCreated('newCollection/{docId}', async (event) => {
  const data = event.data?.data();
  const itemName = data?.name || 'Unknown'; // Replace 'name' with your name field
  
  await logAIAction({
    eventType: 'new_collection.created',
    targetType: 'new_collection',
    targetId: event.params.docId,
    reason: `New collection item "${itemName}" created`,
    contextType: 'new_collection',
    aiTags: ['new_collection', 'creation'],
    urgencyScore: 3,
    aiRelevant: true,
    sourceModule: 'FirestoreTrigger',
    success: true,
    versionTag: 'v1'
  });
});

// Update trigger
export const firestoreLogNewCollectionUpdated = onDocumentUpdated('newCollection/{docId}', async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();
  const itemName = afterData?.name || beforeData?.name || 'Unknown'; // Replace 'name' with your name field
  
  await logAIAction({
    eventType: 'new_collection.updated',
    targetType: 'new_collection',
    targetId: event.params.docId,
    reason: `New collection item "${itemName}" updated`,
    contextType: 'new_collection',
    aiTags: ['new_collection', 'update'],
    urgencyScore: 2,
    aiRelevant: true,
    sourceModule: 'FirestoreTrigger',
    success: true,
    versionTag: 'v1'
  });
});

// Delete trigger
export const firestoreLogNewCollectionDeleted = onDocumentDeleted('newCollection/{docId}', async (event) => {
  const data = event.data?.data();
  const itemName = data?.name || 'Unknown'; // Replace 'name' with your name field
  
  await logAIAction({
    eventType: 'new_collection.deleted',
    targetType: 'new_collection',
    targetId: event.params.docId,
    reason: `New collection item "${itemName}" deleted`,
    contextType: 'new_collection',
    aiTags: ['new_collection', 'deletion'],
    urgencyScore: 4,
    aiRelevant: true,
    sourceModule: 'FirestoreTrigger',
    success: true,
    versionTag: 'v1'
  });
});

// ============================================================================
// TEMPLATE: For subcollections (e.g., parentCollection/{parentId}/subcollection)
// ============================================================================

// Create trigger for subcollection
export const firestoreLogSubcollectionCreated = onDocumentCreated('parentCollection/{parentId}/subcollection/{docId}', async (event) => {
  const data = event.data?.data();
  const itemName = data?.name || 'Unknown'; // Replace 'name' with your name field
  
  await logAIAction({
    eventType: 'subcollection.created',
    targetType: 'subcollection',
    targetId: event.params.docId,
    reason: `Subcollection item "${itemName}" created in parentCollection`,
    contextType: 'subcollection',
    aiTags: ['subcollection', 'creation', 'parentCollection'],
    urgencyScore: 3,
    aiRelevant: true,
    sourceModule: 'FirestoreTrigger',
    success: true,
    versionTag: 'v1'
  });
});

// Update trigger for subcollection
export const firestoreLogSubcollectionUpdated = onDocumentUpdated('parentCollection/{parentId}/subcollection/{docId}', async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();
  const itemName = afterData?.name || beforeData?.name || 'Unknown'; // Replace 'name' with your name field
  
  await logAIAction({
    eventType: 'subcollection.updated',
    targetType: 'subcollection',
    targetId: event.params.docId,
    reason: `Subcollection item "${itemName}" updated in parentCollection`,
    contextType: 'subcollection',
    aiTags: ['subcollection', 'update', 'parentCollection'],
    urgencyScore: 2,
    aiRelevant: true,
    sourceModule: 'FirestoreTrigger',
    success: true,
    versionTag: 'v1'
  });
});

// Delete trigger for subcollection
export const firestoreLogSubcollectionDeleted = onDocumentDeleted('parentCollection/{parentId}/subcollection/{docId}', async (event) => {
  const data = event.data?.data();
  const itemName = data?.name || 'Unknown'; // Replace 'name' with your name field
  
  await logAIAction({
    eventType: 'subcollection.deleted',
    targetType: 'subcollection',
    targetId: event.params.docId,
    reason: `Subcollection item "${itemName}" deleted from parentCollection`,
    contextType: 'subcollection',
    aiTags: ['subcollection', 'deletion', 'parentCollection'],
    urgencyScore: 4,
    aiRelevant: true,
    sourceModule: 'FirestoreTrigger',
    success: true,
    versionTag: 'v1'
  });
});

// ============================================================================
// USAGE INSTRUCTIONS:
// ============================================================================
// 
// 1. Copy the appropriate template above
// 2. Replace 'newCollection' with your actual collection name
// 3. Replace 'new_collection' with your target type (use underscores)
// 4. Replace 'name' with the field you want to use for descriptive logging
// 5. Adjust urgencyScore based on importance (1-10, higher = more urgent)
// 6. Update aiTags to reflect your collection's context
// 7. Add the exports to your index.ts file
// 8. Add tests to testFirestoreTriggers.ts
// 9. Deploy the functions
//
// Example for a 'projects' collection:
// - Collection: 'projects'
// - Target type: 'project'
// - Name field: 'title'
// - Event types: 'project.created', 'project.updated', 'project.deleted'
//
// ============================================================================ 
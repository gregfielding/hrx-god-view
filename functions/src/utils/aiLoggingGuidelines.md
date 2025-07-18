# AI Logging Guidelines for New Functions

## 🎯 **Overview**

Our AI logging system now uses **Firestore triggers** to automatically log all Firestore operations. This replaces manual logging calls and ensures consistent, comprehensive tracking across the application.

## ✅ **What's Already Covered (Automatic)**

The following Firestore operations are **automatically logged** via triggers:

### Core Collections
- `users` → `user.created`, `user.updated`, `user.deleted`
- `agencies` → `agency.created`, `agency.updated`, `agency.deleted`
- `customers` → `customer.created`, `customer.updated`, `customer.deleted`
- `assignments` → `assignment.created`, `assignment.updated`, `assignment.deleted`
- `conversations` → `conversation.created`, `conversation.updated`, `conversation.deleted`
- `jobOrders` → `job_order.created`, `job_order.updated`, `job_order.deleted`
- `campaigns` → `campaign.created`, `campaign.updated`, `campaign.deleted`
- `motivations` → `motivation.created`, `motivation.updated`, `motivation.deleted`
- `messages` → `message.created`, `message.updated`, `message.deleted`
- `shifts` → `shift.created`, `shift.updated`, `shift.deleted`
- `userGroups` → `user_group.created`, `user_group.updated`, `user_group.deleted`
- `locations` → `location.created`, `location.updated`, `location.deleted`
- `notifications` → `notification.created`, `notification.updated`, `notification.deleted`
- `settings` → `setting.created`, `setting.updated`, `setting.deleted`
- `ai_logs` → `ai_log.created`, `ai_log.updated`, `ai_log.deleted`
- `departments` → `department.created`, `department.updated`, `department.deleted`

### Subcollections
- `agencies/{agencyId}/contacts` → `agency_contact.created`, `agency_contact.updated`, `agency_contact.deleted`
- `agencies/{agencyId}/aiSettings` → `ai_settings.created`, `ai_settings.updated`, `ai_settings.deleted`
- `customers/{customerId}/departments` → `department.created`, `department.updated`, `department.deleted`
- `customers/{customerId}/aiSettings` → `ai_settings.created`, `ai_settings.updated`, `ai_settings.deleted`
- `conversations/{conversationId}/messages` → `message.created`, `message.updated`, `message.deleted`

### Global Collections
- `appAiSettings` → `ai_settings.created`, `ai_settings.updated`, `ai_settings.deleted`

## 🚀 **For New Functions: Best Practices**

### 1. **Use Existing Collections When Possible**

If your function operates on data that fits into existing collections, **no additional logging is needed** - it's automatic!

```typescript
// ✅ GOOD: This automatically creates AI logs via triggers
await db.collection('users').doc(userId).update({
  displayName: 'New Name',
  updatedAt: admin.firestore.FieldValue.serverTimestamp()
});

// ✅ GOOD: This automatically creates AI logs via triggers
await db.collection('agencies').doc(agencyId).collection('contacts').add({
  name: 'New Contact',
  email: 'contact@example.com',
  role: 'Manager'
});
```

### 2. **For New Collections: Add Trigger**

If you need a new collection, add a Firestore trigger:

```typescript
// In src/index.ts, add:
export const firestoreLogNewCollectionCreated = functions.firestore
  .document('newCollection/{docId}')
  .onCreate(async (snap, context) => {
    await createAILog({
      eventType: 'new_collection.created',
      targetType: 'new_collection',
      targetId: context.params.docId,
      reason: `New collection item "${snap.data().name}" created`,
      contextType: 'new_collection',
      aiTags: ['new_collection', 'creation'],
      urgencyScore: 3
    });
  });

export const firestoreLogNewCollectionUpdated = functions.firestore
  .document('newCollection/{docId}')
  .onUpdate(async (change, context) => {
    await createAILog({
      eventType: 'new_collection.updated',
      targetType: 'new_collection',
      targetId: context.params.docId,
      reason: `New collection item "${change.after.data().name}" updated`,
      contextType: 'new_collection',
      aiTags: ['new_collection', 'update'],
      urgencyScore: 2
    });
  });

export const firestoreLogNewCollectionDeleted = functions.firestore
  .document('newCollection/{docId}')
  .onDelete(async (snap, context) => {
    await createAILog({
      eventType: 'new_collection.deleted',
      targetType: 'new_collection',
      targetId: context.params.docId,
      reason: `New collection item deleted`,
      contextType: 'new_collection',
      aiTags: ['new_collection', 'deletion'],
      urgencyScore: 4
    });
  });
```

### 3. **For Complex Operations: Use Manual Logging**

For operations that don't fit the standard CRUD pattern, use manual logging:

```typescript
import { createAILog } from '../utils/aiFieldLogging';

// For complex operations
export const complexOperation = functions.https.onCall(async (data, context) => {
  try {
    // Your complex logic here
    const result = await performComplexOperation(data);
    
    // Log the operation
    await createAILog({
      eventType: 'complex_operation.completed',
      targetType: 'operation',
      targetId: result.id,
      reason: `Complex operation completed for ${data.target}`,
      contextType: 'operation',
      aiTags: ['complex_operation', 'completion'],
      urgencyScore: 5,
      aiResponse: result.summary
    });
    
    return result;
  } catch (error) {
    // Log errors too
    await createAILog({
      eventType: 'complex_operation.failed',
      targetType: 'operation',
      targetId: 'error',
      reason: `Complex operation failed: ${error.message}`,
      contextType: 'operation',
      aiTags: ['complex_operation', 'error'],
      urgencyScore: 8,
      errorMessage: error.message
    });
    throw error;
  }
});
```

### 4. **For AI-Specific Operations**

For functions that generate AI responses, include the AI context:

```typescript
export const aiAnalysisFunction = functions.https.onCall(async (data, context) => {
  const aiResponse = await generateAIResponse(data);
  
  await createAILog({
    eventType: 'ai_analysis.completed',
    targetType: 'analysis',
    targetId: data.targetId,
    reason: `AI analysis completed for ${data.targetType}`,
    contextType: 'ai_analysis',
    aiTags: ['ai_analysis', 'completion'],
    urgencyScore: 6,
    inputPrompt: data.prompt,
    composedPrompt: aiResponse.prompt,
    aiResponse: aiResponse.result,
    success: true,
    latencyMs: aiResponse.latency
  });
  
  return aiResponse;
});
```

## 📋 **Checklist for New Functions**

- [ ] **Does it modify existing collections?** → No logging needed (automatic)
- [ ] **Does it create new collections?** → Add Firestore triggers
- [ ] **Does it perform complex operations?** → Add manual logging
- [ ] **Does it generate AI responses?** → Include AI context in logs
- [ ] **Does it handle errors?** → Log error cases too
- [ ] **Test the logging** → Run the test suite to verify

## 🔧 **Testing New Logging**

Add tests to `src/testFirestoreTriggers.ts`:

```typescript
private async testNewCollectionTriggers() {
  console.log('\n📋 Testing New Collection Triggers...');
  
  const testData = {
    name: 'Test Item',
    description: 'Test description',
    createdBy: 'test-user',
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  };

  await this.testTrigger('New Collection Creation', 'newCollection', testData, 'create');
  
  const updateData = { ...testData, name: 'Updated Item', updatedBy: 'test-user' };
  await this.testTrigger('New Collection Update', 'newCollection', updateData, 'update');
  
  await this.testTrigger('New Collection Deletion', 'newCollection', testData, 'delete');
}
```

## 🎯 **Key Benefits**

1. **Automatic Coverage** - No need to remember to add logging
2. **Consistent Format** - All logs follow the same structure
3. **Comprehensive Tracking** - Every Firestore operation is logged
4. **Easy Maintenance** - Centralized trigger logic
5. **Performance** - No impact on function execution time

## 🚨 **Important Notes**

- **Never use the old logging methods** (`logUserCreated`, etc.) - they're deprecated
- **Always use Firestore operations** when possible to leverage automatic logging
- **Test your logging** by running the test suite
- **Follow the naming conventions** for `eventType` and `targetType`
- **Include relevant context** in `aiTags` and `reason` fields

---

**Remember: The goal is to have comprehensive, automatic logging without manual intervention!** 🎯 
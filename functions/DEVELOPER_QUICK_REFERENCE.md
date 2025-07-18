# 🚀 AI Logging Quick Reference

## ✅ **What's Automatic (No Action Needed)**

These Firestore operations are **automatically logged** via triggers:

| Collection | Operations | Event Types |
|------------|------------|-------------|
| `users` | CRUD | `user.created`, `user.updated`, `user.deleted` |
| `agencies` | CRUD | `agency.created`, `agency.updated`, `agency.deleted` |
| `customers` | CRUD | `customer.created`, `customer.updated`, `customer.deleted` |
| `assignments` | CRUD | `assignment.created`, `assignment.updated`, `assignment.deleted` |
| `conversations` | CRUD | `conversation.created`, `conversation.updated`, `conversation.deleted` |
| `jobOrders` | CRUD | `job_order.created`, `job_order.updated`, `job_order.deleted` |
| `campaigns` | CRUD | `campaign.created`, `campaign.updated`, `campaign.deleted` |
| `motivations` | CRUD | `motivation.created`, `motivation.updated`, `motivation.deleted` |
| `messages` | CRUD | `message.created`, `message.updated`, `message.deleted` |
| `shifts` | CRUD | `shift.created`, `shift.updated`, `shift.deleted` |
| `userGroups` | CRUD | `user_group.created`, `user_group.updated`, `user_group.deleted` |
| `locations` | CRUD | `location.created`, `location.updated`, `location.deleted` |
| `notifications` | CRUD | `notification.created`, `notification.updated`, `notification.deleted` |
| `settings` | CRUD | `setting.created`, `setting.updated`, `setting.deleted` |
| `ai_logs` | CRUD | `ai_log.created`, `ai_log.updated`, `ai_log.deleted` |
| `departments` | CRUD | `department.created`, `department.updated`, `department.deleted` |

**Subcollections:**
- `agencies/{id}/contacts` → `agency_contact.*`
- `agencies/{id}/aiSettings` → `ai_settings.*`
- `customers/{id}/departments` → `department.*`
- `customers/{id}/aiSettings` → `ai_settings.*`
- `conversations/{id}/messages` → `message.*`

## 🆕 **For New Collections**

### 1. **Copy Template**
```bash
cp src/utils/triggerTemplate.ts src/yourNewTriggers.ts
```

### 2. **Replace Placeholders**
```typescript
// Replace these values:
'newCollection' → 'yourCollection'
'new_collection' → 'your_collection'
'name' → 'yourNameField'
```

### 3. **Add to index.ts**
```typescript
export { 
  firestoreLogYourCollectionCreated,
  firestoreLogYourCollectionUpdated, 
  firestoreLogYourCollectionDeleted 
} from './yourNewTriggers';
```

### 4. **Add Tests**
```typescript
// In testFirestoreTriggers.ts
private async testYourCollectionTriggers() {
  await this.testTrigger('Your Collection Creation', 'yourCollection', testData, 'create');
  await this.testTrigger('Your Collection Update', 'yourCollection', updateData, 'update');
  await this.testTrigger('Your Collection Deletion', 'yourCollection', testData, 'delete');
}
```

### 5. **Deploy**
```bash
firebase deploy --only functions
```

## 🔧 **For Complex Operations**

Use manual logging for non-CRUD operations:

```typescript
import { logAIAction } from './feedbackEngine';

await logAIAction({
  eventType: 'complex_operation.completed',
  targetType: 'operation',
  targetId: result.id,
  reason: `Complex operation completed for ${data.target}`,
  contextType: 'operation',
  aiTags: ['complex_operation', 'completion'],
  urgencyScore: 5,
  aiResponse: result.summary
});
```

## 🎯 **Naming Conventions**

- **Collection names**: `camelCase` (e.g., `jobOrders`)
- **Target types**: `snake_case` (e.g., `job_order`)
- **Event types**: `target_type.operation` (e.g., `job_order.created`)
- **Context types**: `snake_case` (e.g., `job_order`)

## 📊 **Urgency Scores**

| Score | Description | Examples |
|-------|-------------|----------|
| 1-2 | Low priority | Minor updates, routine operations |
| 3-4 | Normal priority | Standard CRUD operations |
| 5-6 | Medium priority | Important changes, AI responses |
| 7-8 | High priority | Critical updates, errors |
| 9-10 | Critical | System failures, security events |

## 🚨 **Important Rules**

1. **Never use old logging methods** (`logUserCreated`, etc.)
2. **Always use Firestore operations** when possible
3. **Test your logging** with the test suite
4. **Follow naming conventions** exactly
5. **Include relevant context** in `aiTags` and `reason`

## 🧪 **Testing**

```bash
# Run all trigger tests
npm run test:triggers

# Run specific test
npx ts-node src/testTriggersCLI.ts --test "Your Collection"
```

## 📝 **Example: Adding 'Projects' Collection**

1. **Template**: Copy `triggerTemplate.ts`
2. **Replace**: `newCollection` → `projects`, `new_collection` → `project`, `name` → `title`
3. **Export**: Add to `index.ts`
4. **Test**: Add to `testFirestoreTriggers.ts`
5. **Deploy**: `firebase deploy --only functions`

**Result**: Automatic logging for `project.created`, `project.updated`, `project.deleted`

---

**Remember: The goal is automatic, comprehensive logging without manual intervention!** 🎯 
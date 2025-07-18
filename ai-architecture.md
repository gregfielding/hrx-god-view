# AI Context + Firestore + Strategy Conversation (ChatGPT to Cursor)

## 🌟 Summary

You're building the **admin web app for HRXOne**, which will power apps like Companion. You want to integrate OpenAI in a way that supports contextual reasoning across Customers, Employees, and Admin instructions — with weighting, memory, and structured evolution over time.

---

## ❓ Key Questions + Answers

### 1. **Does the AI remember or learn?**

> By default, OpenAI via API is stateless — it doesn't remember anything unless you store and inject context again.

- You need to **persist important data in Firestore**.
- For example, if the AI gives a great recommendation to a customer, you **store that output**, tag it, and optionally embed it for later retrieval.
- You can then **build a vector DB or Firestore-based memory layer** that powers future prompts.

---

### 2. **How should we organize context data?**

#### Recommended Context Groups:
- **Customer**: org chart, manager styles, mission
- **Employee**: satisfaction scores, feedback, behavioral trends
- **Admin**: internal override rules, tone guidance, legal limits

#### Store as:
```jsonc
/customers/{customerId}/aiSettings
/customers/{customerId}/aiContext
/appAiSettings/globalDefaults
/appAiSettings/contextJourneys
/customerBenchmarks/{customerId}
```

## Notifications & Alerts System Design

### Overview
A centralized, extensible notifications system for HRX Admins (God View), Customers, and Agencies. Supports table views, actions, and role-based visibility.

### Data Model
- **Collection:** `notifications`
- **Fields:**
  - `recipientType`: 'hrx' | 'customer' | 'agency' | 'user'
  - `recipientId`: string (null for global/HRX)
  - `type`: string (e.g., 'moment', 'ai', 'system', 'manual')
  - `message`: string
  - `actions`: string[] (e.g., ['retry', 'thank', 'dig_deeper'])
  - `status`: 'unread' | 'read' | 'actioned' | 'archived'
  - `createdAt`: timestamp
  - `relatedId`: string (optional, e.g., momentId, userId)

### Permissions
- **HRX Admins:** See all notifications.
- **Customers/Agencies:** See only their own (matching `recipientId`).
- **Users:** (optional/future) See only their own.

### UI Table View
- Columns: Date, Message, Type, Actions, Status
- Action buttons: Retry, Thank, Dig Deeper, etc.
- Filters: By type, status, recipient

### Extensibility
- Add new notification types and actions easily.
- Support for future notification channels (email, SMS, in-app, etc.).
- Can be triggered by AI, system events, or manual admin actions.

### Example Firestore Document
```json
{
  "recipientType": "customer",
  "recipientId": "customer123",
  "type": "moment",
  "message": "A new moment is ready for review.",
  "actions": ["thank", "dig_deeper"],
  "status": "unread",
  "createdAt": "2024-06-01T12:00:00Z",
  "relatedId": "moment456"
}
```
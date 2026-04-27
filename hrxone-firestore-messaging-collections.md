# HRX One — Firestore Collection Design for Messaging, Threads, Logs, and Templates  
Version: 1.0  
Status: APPROVED STRUCTURE DRAFT  
Scope: Matches multi-tenant structure using `/tenants/{tenantId}`

---

## Purpose

This document defines **exact Firestore collection paths and document structures** for:

- Two-way SMS threads
- Message logs (all channels)
- Messaging templates (global + tenant overrides)
- Consent & notification preferences

The structure:

- Aligns with the existing **`tenants/{tenantId}` hierarchy**
- Supports **A2P SMS compliance**
- Enables **scalable querying and security rules**
- Keeps **logging + analytics clean and consistent**

---

# 1️⃣ Global Overview — Collection Tree

```text
/tenants/{tenantId}                          
  /users/{userId}                            
  /notificationSettings/{userId}             
  /smsThreads/{threadId}                     
    /messages/{messageId}                    
  /messageLogs/{logId}                       
  /smsConsents/{userId}                      
    /events/{eventId}                        
  /automationRuns/{runId}                    
  /aiMessageLogs/{logId}                     

/system                                      
  /messagingConfig/{docId}                   
  /messageTypes/{messageTypeId}              
  /messageTemplates/{templateId}             

/messageTemplates_overrides/{templateId}     // optional — see below
```

> 🔹 **Every document includes a `tenantId` field**, even when the path already encodes it.  
This simplifies debugging, migrations, and cross-tenant analytics.

---

# 2️⃣ Two-Way SMS Threads

These collections power recruiter ↔ candidate chat.

## Paths

```text
/tenants/{tenantId}/smsThreads/{threadId}
/tenants/{tenantId}/smsThreads/{threadId}/messages/{messageId}
```

## `smsThreads` Document

```ts
interface SmsThread {
  id: string;
  tenantId: string;

  candidateUserId: string;
  candidatePhone: string;

  primaryRecruiterUserId: string | null;

  twilioNumber: string;

  status: "open" | "snoozed" | "closed";

  lastMessageAt: Timestamp;
  lastMessageSnippet: string;
  unreadCountForRecruiter: number;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

## `messages` Document

```ts
interface SmsMessage {
  id: string;
  tenantId: string;
  threadId: string;

  direction: "inbound" | "outbound";
  fromType: "candidate" | "recruiter" | "system" | "ai";
  fromUserId?: string;

  body: string;
  language: "en" | "es" | null;

  providerMessageId?: string;

  status: "queued" | "sent" | "delivered" | "failed" | "not_sent";
  failureReason?: string;

  createdAt: Timestamp;
}
```

### Why nest under tenant?

- Strong tenant isolation with security rules
- Efficient inbox queries
- Still supports `collectionGroup('messages')` cross-tenant analytics

---

# 3️⃣ Message Logs — All Channels

This is the **canonical system message log** for:

✓ SMS  
✓ Email  
✓ Push  
✓ Automations  
✓ Recruiter Chat  
✓ AI Replies  

## Path

```text
/tenants/{tenantId}/messageLogs/{logId}
```

## Document Shape

```ts
interface MessageLog {
  id: string;
  tenantId: string;

  userId: string;
  threadId?: string;

  messageTypeId: string;

  channel: "sms" | "email" | "push";
  direction: "inbound" | "outbound";
  fromIdentity: "candidate" | "recruiter" | "system" | "ai";
  fromUserId?: string;

  contentOriginal?: string;
  contentSent: string;
  language: "en" | "es" | null;

  status: "queued" | "sent" | "delivered" | "failed" | "not_sent";
  failureReason?: string;
  providerMessageId?: string;

  createdAt: Timestamp;
}
```

### Design Intent

- Twilio callbacks update by `providerMessageId`
- Compliance / audit proof trail
- Works perfectly with `collectionGroup('messageLogs')` for analytics

---

# 4️⃣ Templates — Global Defaults + Tenant Overrides

You want **editable messaging per tenant** without duplicating everything.

We recommend:

### Global Defaults

```text
/system/messageTypes/{messageTypeId}
/system/messageTemplates/{templateId}
```

### Tenant Overrides

```text
/tenants/{tenantId}/messageTemplates/{templateId}
```

---

## `messageTypes` Document

```ts
interface MessageTypeConfig {
  id: string;
  label: string;

  category:
    | "system"
    | "transactional"
    | "compliance"
    | "engagement"
    | "chat"
    | "marketing";

  defaultChannels: ("sms" | "email" | "push")[];
  critical: boolean;

  allowReply: boolean;
  requiresExplicitSmsOptIn: boolean;
  requiresTemplate: boolean;

  aiAllowedToDraft: boolean;
  aiAllowedToAutoSend: boolean;
}
```

---

## Global `messageTemplates` Document

```ts
interface MessageTemplate {
  id: string;
  tenantId: "GLOBAL";

  messageTypeId: string;
  channel: "sms" | "email" | "push";
  language: "en" | "es";

  name: string;
  body: string;
  variables: string[];

  includeStopFooter: boolean;

  active: boolean;
  version: number;

  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

---

## Tenant Override Template

```ts
interface TenantMessageTemplate extends MessageTemplate {
  tenantId: string;
  baseTemplateId?: string;
  overrideLevel: "tenant";
}
```

---

## Template Resolution Order

When sending a message:

1️⃣ Check tenant override  
`/tenants/{tenantId}/messageTemplates`  
→ match `messageTypeId + channel + language + active=true`

2️⃣ Else fall back to global  
`/system/messageTemplates`

3️⃣ If still none → log `missing_template` and skip send  
(or send minimal message for critical types only)

---

# 5️⃣ Consent + Preferences (Tenant Scoped)

These are tenant-local because messaging rights belong to the business using HRX One.

---

## 5.1 Consent State + History

### Paths

```text
/tenants/{tenantId}/smsConsents/{userId}
/tenants/{tenantId}/smsConsents/{userId}/events/{eventId}
```

### Consent State

```ts
interface SmsConsentState {
  tenantId: string;
  userId: string;

  smsOptIn: boolean;
  smsBlockedSystem: boolean;

  lastUpdatedAt: Timestamp;
}
```

### Consent Events

```ts
interface SmsConsentEvent {
  id: string;
  tenantId: string;
  userId: string;

  agreed: boolean;
  source: "signup" | "settings" | "keyword" | "admin";

  keyword?: string;
  termsVersion?: string;

  timestamp: Timestamp;
}
```

---

## 5.2 Per-User Notification Preferences

```text
/tenants/{tenantId}/notificationSettings/{userId}
```

```ts
interface NotificationPreferences {
  tenantId: string;
  userId: string;

  smsOptIn: boolean;
  smsBlockedSystem: boolean;

  emailEnabled: boolean;
  pushEnabled: boolean;
  preferredLanguage: "en" | "es";

  channelsAllowedPerType: {
    [messageTypeId: string]: {
      sms: boolean;
      email: boolean;
      push: boolean;
    };
  };
}
```

---

# 6️⃣ Automation Support Collections

### Path

```text
/tenants/{tenantId}/automationRuns/{runId}
```

Use this for:

- idempotency
- reporting
- debugging

---

# 7️⃣ Mapping to API Routes

| Feature | API | Firestore |
|--------|------|----------|
| Central Send | `/api/messaging/send` | `/tenants/{tenantId}/messageLogs` |
| Template CRUD | `/api/messaging/templates*` | `/system/...` + `/tenants/...` |
| Recruiter Inbox | `/api/messaging/threads*` | `/tenants/{tenantId}/smsThreads` |
| Chat Messages | same | `/smsThreads/{threadId}/messages` |
| STOP/HELP Handling | `/api/webhooks/twilio/inbound-sms` | `/smsConsents`, `/messageLogs`, `/messages` |
| Delivery Receipts | `/api/webhooks/twilio/status-callback` | update `/messageLogs` |
| Automations | `/internal/automations/*` | `/automationRuns`, `/messageLogs` |

---

# 8️⃣ Cursor Implementation Notes

> **Instructions for Cursor:**  
> 
> - Treat `/tenants/{tenantId}` as the **root namespace for everything operational.**  
> - Global config belongs under `/system`.  
> - Every document must include a `tenantId` field — even when the hierarchy encodes it.  
> - All messaging sends must:
>   - Resolve templates in order: tenant → global
>   - Check notification prefs + consent
>   - Write a `/messageLogs` record
>   - For SMS chat, also write `/smsThreads/.../messages`
> - Use `collectionGroup` for reporting across tenants.

Suggested examples:

```ts
await db.collectionGroup("messageLogs").where("tenantId", "==", tenantId);
await db.collectionGroup("messages").where("threadId", "==", threadId);
await db.collectionGroup("smsThreads").get();
```

---

# 9️⃣ Why This Design Works

✓ Clear tenant isolation  
✓ Simple & secure Firestore rules  
✓ Full compliance audibility  
✓ Works with Twilio callbacks  
✓ Supports AI classification & reply suggestions  
✓ Backward-compatible with HRX One backend model  
✓ Scales to thousands of tenants  

---

# END OF DOCUMENT

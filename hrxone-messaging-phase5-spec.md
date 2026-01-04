# HRX One – Messaging System Phase 5 Spec  
**Focus:** Rate Limiting • Quiet Hours • AI Assist • Messaging Dashboards  
**Audience:** Cursor / Engineering Team  
**Status:** Ready for implementation – builds on completed Phase 4 + 4.1

---

## 0. Context (What Exists Today)

The messaging system currently supports:

- Unified Messaging Orchestrator
- SMS (mock + Twilio provider abstraction)
- Email (SendGrid provider abstraction)
- Push Notifications (FCM provider abstraction)
- Tenant-scoped consent + notification settings
- STOP/HELP/START enforcement
- Unified message logging via `/tenants/{tenantId}/messageLogs`
- Two‑way messaging threads w/ recruiter chat
- Template + Message Type Registry

Phase 5 continues to **add enterprise‑grade safety + intelligence + visibility** without breaking this foundation.

---

# 1️⃣ Phase 5.1 — Rate Limiting & Abuse Protection

## Goal
Prevent accidental spam, runaway loops, or over‑messaging users and ensure platform safety & compliance.

---

## 1.1 Types of Rate Limits

We will support **three layers** of guardrails.

### (A) Per‑User Rate Limits
Prevent spamming a single recipient.

Default (configurable per tenant):

| Channel | Limit |
|--------|-------|
| SMS | max **6 / hour** or **20 / day** |
| Email | max **20 / day** |
| Push | max **30 / day** |

### (B) Per‑MessageType Limits (Optional)
Example: *don’t send more than 1 “shift reminder” / hour / user*.

### (C) Per‑Tenant Safety Throttle
Prevent tenant‑wide accidental explosions.

Defaults:

| Channel | Limit |
|--------|-------|
| SMS | **3,000 / hour** |
| Email | **10,000 / hour** |
| Push | **10,000 / hour** |

> Limits should be read from a tenant messaging config record and overrideable per tenant as needed.

---

## 1.2 Storage Model

### New collection

```text
/tenants/{tenantId}/messagingConfig/systemLimits
```

Document (example):

```ts
{
  defaults: {
    perUser: {
      smsHourly: 6,
      smsDaily: 20,
      emailDaily: 20,
      pushDaily: 30
    },
    perTenantHourly: {
      sms: 3000,
      email: 10000,
      push: 10000
    }
  },
  overridesPerMessageType: {
    shift_reminder_sms: {
      smsHourlyPerUser: 1
    }
  },
  updatedAt: Timestamp
}
```

---

## 1.3 Implementation Location

Add a **rateLimiter.ts** module:

```
functions/src/messaging/rateLimiter.ts
```

Exports:

```ts
export async function checkRateLimits(args: {
  tenantId: string;
  userId: string;
  messageTypeId: string;
  channel: "sms" | "email" | "push";
}): Promise<
  | { allowed: true }
  | {
      allowed: false;
      reason: "USER_LIMIT" | "TENANT_LIMIT";
      details: any;
    }
>;
```

---

## 1.4 Orchestrator Integration

### Where to call this

In `routingOrchestrator.ts`, inside **`deliverSMS` / `deliverEmail` / `deliverPush`**, before sending:

```ts
const limitCheck = await checkRateLimits(...);

if (!limitCheck.allowed) {
  await updateMessageLogStatus({
    status: "suppressed_rate_limit",
    providerErrorCode: limitCheck.reason,
    providerErrorMessage: JSON.stringify(limitCheck.details)
  });

  return {
    success: false,
    suppressed: true,
    channel
  };
}
```

> Important: **we still create a MessageLog entry**, but mark it as `suppressed_rate_limit`.

This ensures a complete audit trail.

---

# 2️⃣ Phase 5.2 — Quiet Hours

## Goal
Respect user experience & compliance by delaying non‑critical messages during late‑night hours.

---

## 2.1 Quiet Hour Rules

Tenant‑configurable defaults:

| Hours | Default |
|------|---------|
| Quiet Hours Start | 21:00 |
| Quiet Hours End | 08:00 |
| Timezone | tenant timezone |

### Allowed during quiet hours

- STOP/HELP handling
- Security & system alerts
- Shift cancellations or urgent messages (configurable whitelist)

---

## 2.2 Storage Model

### New doc:

```text
/tenants/{tenantId}/messagingConfig/quietHours
```

Fields:

```ts
{
  enabled: true,
  timezone: "America/Los_Angeles",
  startLocal: "21:00",
  endLocal: "08:00",
  allowedMessageTypes: [
    "shift_cancelled_sms",
    "system_security_alert_sms"
  ],
  updatedAt: Timestamp
}
```

---

## 2.3 Implementation

Create:

```
functions/src/messaging/quietHours.ts
```

Export:

```ts
export async function isQuietHours(args: {
  tenantId: string;
  messageTypeId: string;
  userLocalTime: Date;
}): Promise<boolean>
```

---

## 2.4 Orchestrator Integration

In each channel delivery:

```ts
if (await isQuietHours(...)) {
  await updateMessageLogStatus({
    status: "suppressed_quiet_hours"
  });

  return { success: false, suppressed: true };
}
```

> Future phase may **queue for later send** — for now we simply suppress and log.

---

# 3️⃣ Phase 5.3 — AI Assist for Inbound Messaging

## Goal
Use AI to draft helpful responses — **human‑approved only.**

---

## 3.1 Scope

AI will:
✔ classify inbound intent  
✔ propose reply options  
✔ never auto‑send  

---

## 3.2 New Collection

```text
/tenants/{tenantId}/messageDrafts/{draftId}
```

Document:

```ts
{
  threadId: string;
  userId: string;
  aiSuggested: boolean;
  approved: boolean;
  messageText: string;
  reason: string; // e.g. classified intent
  createdAt: Timestamp;
  approvedAt?: Timestamp;
}
```

---

## 3.3 AI Pipeline

### File:
```
functions/src/messaging/aiAssist.ts
```

Exports:

```ts
export async function classifyInboundMessage(...)
export async function suggestReply(...)
```

### Trigger location
Called from:

```
handleInboundSms()
```

or API thread reply route.

---

## 3.4 Logging Rules

When AI drafts a response:

```ts
fromIdentity = "ai_suggested"
```

When human approves:

```ts
fromIdentity = "human"
approvedAiDraftId = xxx
```

> We **do not send directly** from AI.

---

# 4️⃣ Phase 5.4 — Messaging Dashboards

## Goal
Expose insights from `messageLogs` and consent events.

---

## 4.1 Data Sources

### Already exist:

```
/tenants/{tenantId}/messageLogs
/tenants/{tenantId}/preferenceChangeLogs
```

---

## 4.2 Admin UI Pages

Create React pages under admin app:

### Page 1 — Messaging Overview Dashboard

Metrics:

- Total messages sent (by day)
- Failures over time
- STOP events over time
- Channel breakdown pie chart
- Opt‑out rate trend
- Top message types by volume
- Top message types by failure rate

---

### Page 2 — User‑Level Message History

Table per user:

- Date
- Channel
- Direction
- Status
- Message Type
- Provider ID

---

### Page 3 — Compliance Monitor

Show:

- Users who sent STOP recently
- Tenants with high opt‑out rates
- Messages suppressed by:
  - quiet hours
  - rate limit

---

## 4.3 Backend API

Expose Cloud Function API routes to query:

```
GET /api/messaging/logs
GET /api/messaging/analytics/summary
GET /api/messaging/analytics/user/:userId
GET /api/messaging/analytics/optouts
```

Use pagination + strict auth.

---

# 5️⃣ Database & Logging Standards (Phase 5 Additions)

Statuses to add to `messageLogs.status`:

| Status |
|--------|
| suppressed_rate_limit |
| suppressed_quiet_hours |
| suppressed_notification_settings |
| ai_draft_created |
| ai_draft_approved |

---

# 6️⃣ Acceptance Tests

## Rate limits
- exceed per‑user limit ➜ blocked + logged
- exceed tenant limit ➜ blocked + logged

## Quiet hours
- send allowed msg ➜ delivered
- send blocked msg ➜ suppressed + logged

## AI assist
- inbound msg ➜ AI classification + draft created
- recruiter approves ➜ outbound msg logged separately

## Dashboards
- verify analytics summarize correctly

---

# 7️⃣ Instructions for Cursor (Copy‑Paste)

> **Please implement Phase 5 according to this spec. Priorities:**  
>  
> 1. Add rate limiting (`rateLimiter.ts`) and integrate into all channels in the Messaging Orchestrator, logging suppressed messages instead of sending.  
> 2. Add quiet hours support (`quietHours.ts`) with tenant‑scoped config + suppress + log behavior.  
> 3. Implement AI‑assist reply drafting where AI only suggests — never auto‑sends — and store drafts with clear logging.  
> 4. Add analytics APIs and UI pages for dashboards using `messageLogs` + preference logs.  
> 5. Ensure **no messaging bypasses the orchestrator** and everything is tenant‑scoped + logged.  
>  
> When complete, provide a summary of:  
>  • Files created  
>  • Files modified  
>  • New Firestore collections used  
>  • Example log entries for suppressed messages and AI drafts.  
>  
> Twilio A2P approval may still be pending — **do not depend on real SMS delivery for testing**. Focus on logic, logging, and analytics.

---

**End of Phase 5 Spec**


# HRX SMS (Plan B) — Queue-First System SMS Rollout

**Owner:** Greg Fielding  
**Goal:** Ship **system/programmatic SMS** first using the existing queue-based architecture (`smsOutboundRequests` → Cloud Tasks → worker), then migrate MessageDrawer later.

---

## Executive summary (what’s true in code today)
You currently have **two outbound SMS paths** implemented:

### Path A — Unified `sendMessageApi` (direct send)
- Sends **directly** via provider (`Twilio` or `Mock`) and logs to `messageLogs`.
- **Does not use** Cloud Tasks or `smsOutboundRequests`.

### Path B — Two-way / threaded SMS (queue-based)
- Uses `smsOutboundRequests` + Firestore trigger + Cloud Tasks worker.
- Worker enforces compliance (`checkCompliance`), injects footer (`applyFooter`), calls provider, retries.
- Writes back status + updates thread messages + message logs.

### Inbound + compliance
- Inbound SMS webhooks exist and are **public**.
- **STOP/START/HELP** handling exists and is processed before regular inbound routing.
- Tenant-scoped consent exists (`tenants/{tenantId}/smsConsents/{userId}`), with legacy mirroring to `/users/{userId}`.

### Key gap
- Twilio error **21610** handling (opt-out returned by provider) is **not implemented**.

### Readiness verdict
- ~**80–85%** toward a working SMS system.
- Biggest caveat: outbound architecture is split; queue is solid but not the default for all sends.

---

## Decision
### We will execute **Plan B (recommended)**

✅ **System/programmatic SMS first**, then migrate MessageDrawer later.

**Canonical outbound SMS path:**
`createOutboundRequest()` → `tenants/{tenantId}/smsOutboundRequests` → Firestore trigger → Cloud Tasks → `processSmsOutbound`

**Initial system message:**
- “Thanks for signing up with C1 Staffing — we’re excited to help you find your next opportunity.”

**Trigger:**
- Must fire **upon user creation**.

---

# 1) Cursor-ready diff plan — unify outbound SMS for System SMS

## Goal
Make **system/programmatic SMS** go through the queue-based system (Path B), so that:
- consent is checked once (centrally)
- retries are consistent
- all messages are threadable (reply-ready)
- status + audit trail are unified

## Scope (Phase 1)
- Migrate **system SMS only** to queue.
- Do **not** migrate MessageDrawer yet.

---

## A. Required changes (high level)

### Change 1 — System SMS enqueue helper
Create a single helper that system code calls:
- resolves `tenantId`, `userId`, `toPhoneE164`, `fromPhoneE164`
- gets/creates a `threadId`
- creates a `messageLogs` entry with `status='queued'`
- calls `createOutboundRequest({ ... messageLogId ... })`

**Recommended location (choose one):**
- `functions/src/messaging/systemSms.ts` (new)
- or inside `functions/src/messaging/routingOrchestrator.ts` if you already orchestrate system notifications there

### Change 2 — Ensure system messages map to threads
To enable replies → thread continuity, outbound system SMS must include a `threadId`.

Add a helper (recommended):
- `getOrCreateThreadForUser({ tenantId, userId, toPhoneE164, fromPhoneE164 }) → threadId`

Best place to implement:
- `functions/src/messaging/twoWayMessaging.ts` (since it already manages threads)
- or a new `functions/src/messaging/smsThreadsService.ts`

### Change 3 — Extend queue request fields (small additions)
Update `createOutboundRequest()` to accept and store:
- `messageLogId?: string`
- `messageTypeId?: string`
- `source?: 'system' | 'automated' | 'manual'`
- `priority?: 'high'|'normal'|'low'`
- `dedupeKey?: string`

Update `processSmsOutbound`:
- If `messageLogId` exists, **update that log doc** (don’t create a duplicate log)

### Change 4 — Trigger: user creation
Add (or extend) a user-creation Cloud Function that enqueues the welcome SMS.

Trigger options:
- `onDocumentCreated` for `tenants/{tenantId}/users/{userId}` (preferred tenant-scoped)
- or a global `/users/{userId}` trigger if that’s your canonical user store

**Important:** the function should be idempotent (see dedupe policy below).

### Change 5 — Do NOT touch MessageDrawer yet
Leave Path A intact for manual messaging UI until Phase 2 migration.

---

## B. Concrete “edit list” (Cursor task list)

### Task 1 — Add thread helper
**File:** `functions/src/messaging/twoWayMessaging.ts` (or new service)

Add:
- `export async function getOrCreateThreadForUser(params): Promise<string>`

Behavior:
- Query threads by `userId` and/or `toPhoneE164` (+ optionally `fromPhoneE164`).
- If exists, return.
- If not, create `smsThreads/{threadId}` with participants and metadata.

### Task 2 — Add system SMS enqueue function
**File:** `functions/src/messaging/systemSms.ts` (new)

Add:
- `export async function enqueueSystemSmsWelcome({ tenantId, userId, toPhoneE164 }): Promise<{requestId, threadId, logId}>`

Steps:
1) `threadId = await getOrCreateThreadForUser(...)`
2) Create `messageLogs/{logId}` with `status='queued'`, `channel='sms'`, `messageTypeId='system_onboarding_welcome'`, `threadId`, `userId`
3) `requestId = await createOutboundRequest({ tenantId, threadId, toPhoneE164, fromPhoneE164, body, messageTypeId, source:'system', priority:'high', messageLogId: logId, dedupeKey })`
4) Update log with `smsRequestId=requestId`

### Task 3 — Extend queue request + worker
**File:** `functions/src/messaging/smsOutboundQueue.ts`

- Extend request schema and persist the new fields.
- In worker:
  - update existing `messageLogs/{logId}` when `messageLogId` is present
  - keep existing behavior for thread messages

### Task 4 — Add user-created trigger to enqueue welcome
**File:** whichever file contains user triggers (or new `functions/src/triggers/users.ts`)

Add:
- `onDocumentCreated('tenants/{tenantId}/users/{userId}')` → call `enqueueSystemSmsWelcome(...)`

Add guards:
- require phone + e164
- require that SMS consent exists (or allow queue worker to block)
- dedupe check (see Safety Rails)

### Task 5 — Add minimal tests / smoke checklist
- Create a user doc with phoneE164
- Verify `messageLogs.status='queued'`
- Verify `smsOutboundRequests` created
- Verify Cloud Task fires and worker sends
- Verify worker updates:
  - `smsOutboundRequests.status='sent'`
  - `messageLogs.status='sent'`
  - `smsThreads/{threadId}/messages` contains outbound message
- Reply from phone:
  - inbound webhook logs inbound message to same thread

---

# 2) Firestore schema — system messages (exact)

You already have:
- `messageLogs`
- `smsThreads/{threadId}/messages`
- `smsOutboundRequests`
- `smsConsents`

We will add minimal “governance” docs for system message definitions.

---

## A. Message Types (templates + governance)
**Path:** `tenants/{tenantId}/messageTypes/{messageTypeId}`

Example:
```ts
{
  messageTypeId: "system_onboarding_welcome",
  channel: "sms",
  name: "Onboarding: Welcome",
  purpose: "New worker signup confirmation",
  template: "Thanks for signing up with {agencyName}! We’re excited to help you find your next opportunity.",
  transactional: true,
  requiresConsent: true,
  footerPolicy: "default", // default | none | custom
  throttlePolicyId: "onboarding_welcome_v1",
  enabled: true,
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

---

## B. (Optional) Trigger Definitions (future-ready)
If you want configurable automations later:

**Path:** `tenants/{tenantId}/messageTriggers/{triggerId}`

```ts
{
  triggerId: "welcome_on_user_create",
  event: "user.created",
  messageTypeId: "system_onboarding_welcome",
  delaySeconds: 30,
  enabled: true,
  dedupeWindowHours: 72,
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

You can skip this in Phase 1 and hardcode the behavior.

---

## C. Queue Request (extend existing)
**Path:** `tenants/{tenantId}/smsOutboundRequests/{requestId}`

```ts
{
  toPhoneE164: "+17025551212",
  fromPhoneE164: "+17025559876",
  body: "Thanks for signing up...",

  threadId: "abc123",
  userId: "uid123",

  messageTypeId: "system_onboarding_welcome",
  source: "system", // system | automated | manual
  priority: "high", // high | normal | low

  messageLogId: "log123",
  dedupeKey: "welcome:{tenantId}:{userId}",

  scheduledFor: Timestamp,

  status: "queued" | "processing" | "sent" | "failed" | "blocked",
  attemptCount: 0,
  lastError: null,
  providerMessageId: null,

  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

---

## D. Thread messages (existing model)
**Path:** `tenants/{tenantId}/smsThreads/{threadId}/messages/{messageId}`

Outbound system message:
```ts
{
  direction: "outbound",
  source: "system",
  body: "...",
  userId: "uid123",
  providerMessageId: "SMxxxx",
  messageLogId: "log123",
  createdAt: Timestamp
}
```

---

## E. Message logs (standardize)
**Path:** `tenants/{tenantId}/messageLogs/{logId}`

Include (minimum):
- `status: queued|sent|failed|blocked`
- `channel: sms`
- `smsRequestId`
- `providerMessageId`
- `threadId`
- `userId`
- `messageTypeId`

---

# 3) Rate-limit + safety rails (onboarding SMS)

These prevent spam from duplicate triggers, retries, imports, or bugs.

## A. Dedupe (hard stop)
### Dedupe key
For welcome message:
- `dedupeKey = welcome:{tenantId}:{userId}`

Policy:
- Allow **1 welcome message per user per 72 hours**.

Enforce in two places:
1) **At enqueue time** (best UX)
2) **In worker** (belt-and-suspenders)

Implementation:
- At enqueue time, query `smsOutboundRequests` or `messageLogs` for same `messageTypeId` + `userId` within window.
- If found, skip enqueue.

---

## B. Tenant rate limit (protect Twilio + you)
Implement token bucket (worker-enforced).

**Doc:** `tenants/{tenantId}/rateLimits/smsOutbound`
```ts
{
  windowStart: Timestamp,
  sentInWindow: number,
  windowSeconds: 60,
  maxPerWindow: 30
}
```

Worker behavior:
- If tenant is over limit, **reschedule** the task for +30–90 seconds (don’t fail).

Start conservative:
- **30 SMS/min/tenant** (adjust later)

---

## C. User rate limit (prevent loops)
Policy:
- Max **3 outbound system SMS per user per hour**
- Max **10 outbound system SMS per user per day**

Enforce in worker by counting recent `messageLogs` with `source='system'`.

---

## D. Quiet hours (recommended)
For welcome message:
- If user local time is 9pm–8am, schedule for 8:30am.

If you don’t have user timezone:
- use tenant default
- or skip in Phase 1

---

## E. Failure storm circuit breaker (optional, Phase 2)
If a tenant has >X failures in 5 minutes:
- set `tenants/{tenantId}/settings/messaging.smsPaused = true`
- worker blocks outbound sends until unpaused

---

# Notes / Known gaps to backlog (non-blocking for Phase 1)
- Twilio error **21610** (opt-out) auto-handling (recommended Phase 2)
- Admin UI/table for `smsOutboundRequests` (filters, requeue)
- Dead-letter review workflow

---

# Phase 1 Delivery Checklist
✅ Enqueue welcome SMS on user creation  
✅ Welcome SMS goes through queue-based worker  
✅ Logs show `queued → sent/failed/blocked`  
✅ Thread created and outbound message saved  
✅ Reply SMS lands in same thread + messageLogs  

---

*End of document*

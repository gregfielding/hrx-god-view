
# HRX One — Messaging System Migration Plan (Phases 1–3)

**Date:** 2025-01-27  
**Purpose:** Safely unify legacy & new messaging code while closing compliance gaps  
**Audience:** Cursor / Engineering Team  
**Status:** READY FOR IMPLEMENTATION

---

## 🎯 Core Goal

We now have a **new unified messaging framework**:
- Messaging Orchestrator
- Message Type Registry
- Template Engine
- `/tenants/{tenantId}/messageLogs`
- STOP / HELP / START keyword handling
- Two‑way messaging threads

But **legacy messaging still exists** and is currently bypassing compliance + logging safeguards.

This migration plan:

✔️ Closes compliance risks fast  
✔️ Unifies SMS delivery under one path  
✔️ Retires legacy templates & logging  
✔️ Adds email + push support cleanly  
✔️ Maintains backward compatibility while migrating

---

# 🚨 Phase 1 — Critical Safety & Compliance Fence

Goal: **Even if legacy code is still called, STOP & logging must apply 100% of the time.**

---

## ✅ Task 1.1 — Patch Legacy Twilio Helper (DO NOT DELETE IT YET)

### 📍 Location
```
functions/src/twilio.ts
```

### ✔️ Requirements
- `sendWorkerMessageInternal()` must:

☑️ Check BOTH:
```
smsOptIn !== false
smsBlockedSystem !== true
```
☑️ Stop writing to `/sms_messages`
☑️ Call the **unified logger** in `messageLogging.ts`
☑️ Prefer calling `sendMessage()` from the orchestrator when possible

---

## 🟢 Why Do This First?

Because **STOP must always work — everywhere — immediately.**  
This guarantees:

✔️ A2P compliance  
✔️ Unified audit logs  
✔️ Tenant isolation  
✔️ No untracked SMS after today  

---

## ✅ Task 1.2 — Fix Missing Tenant Scope in Thread Queries

### 📍 Locations
```
functions/src/messaging/aiAssistApi.ts
functions/src/messaging/webhooksApi.ts
```

Replace unscoped collections like:
```
db.collection("smsThreads")
```

With **tenant‑scoped paths**:
```
/tenants/{tenantId}/smsThreads
```

> We never want thread data crossing tenants.

---

# 🟣 Phase 2 — Remove Dual Systems (Templates & Logs)

Goal: **Only one template system + one logging system exists going forward.**

---

## ✅ Task 2.1 — Migrate Legacy SMS Templates to New Engine

### 📍 Legacy locations
```
functions/src/smsTemplates.ts
functions/src/applicationSmsTriggers.ts
```

### 📍 New storage
```
/tenants/{tenantId}/messageTemplates/{templateId}
```

### ✔️ Migration Steps

☑️ Create a helper that copies legacy docs from:
```
/tenants/{tenantId}/smsTemplates
→
/tenants/{tenantId}/messageTemplates
```

☑️ Update all template lookups to use:
```
templateEngine.getTemplate()
```

☑️ Mark `/smsTemplates` as deprecated *(DO NOT DELETE YET)*

---

## 📝 Result

✔️ One single source of truth for templates  
✔️ Easy localization  
✔️ Unified preview & variable extraction  
✔️ Less confusion for developers  

---

## ✅ Task 2.2 — Stop Writing to `/sms_messages` Permanently

### 📍 Current writers
```
functions/src/twilio.ts
```

Replace with unified logger:

```
/tenants/{tenantId}/messageLogs/{logId}
```

via:
```
logMessage()
updateMessageLogStatus()
```

---

# 🟢 Phase 3 — Route ALL SMS Through the Orchestrator

Goal: **No one talks to Twilio directly except the orchestrator.**

---

## 📍 Legacy SMS senders to update

```
functions/src/applicationSmsTriggers.ts
functions/src/groupMessaging.ts
functions/src/updateNextShiftDate.ts
functions/src/index.ts   (sendBroadcastInternal)
```

All of these currently call:

```
sendWorkerMessageInternal()
```

### 🚀 Replace with

```
sendMessage({
  tenantId,
  userId,
  messageTypeId: "...",
  context: {...}
})
```

Using `routingOrchestrator.ts`.

---

## 🧠 Suggested transition pattern

Create helpers like:

```
sendLegacyApplicationStatusMessage(args)
```

That internally call `sendMessage()` — **this keeps code readable while modernizing under the hood.**

---

# 📧 Phase 4 — Implement Email & Push Correctly

> DO THIS AFTER SMS IS UNIFIED — so email & push inherit the same quality.

---

## ✅ Task 4.1 — Implement EmailProvider + SendGrid Adapter

Use the spec in:

```
hrxone-email-provider-spec.md
```

Then wire into:

```
deliverEmail()
```

in:

```
routingOrchestrator.ts
```

### Email must:

☑️ Resolve templates via `templateEngine`  
☑️ Log to `/messageLogs`  
☑️ Store provider messageId  
☑️ Track status updates  

---

## 🔔 Task 4.2 — Implement Push Notifications

Using FCM or Expo client library.

Wire to:
```
deliverPush()
```

And log the same way.

---

# 📜 Phase 5 — Tenant‑Scoped Consent & Notification Settings

*(Follow‑up — not blocking migration but important for multi‑tenant safety)*

---

## Move consent to:

```
/tenants/{tenantId}/smsConsents/{userId}
/events/{eventId}
```

## Move settings to:

```
/tenants/{tenantId}/notificationSettings/{userId}
```

---

# 🔐 Hard Rules (Please Follow During Implementation)

✔️ DO NOT delete legacy collections yet  
✔️ DO NOT bypass the orchestrator for new code  
✔️ Ensure **every send writes to messageLogs**  
✔️ Always include `tenantId`  
✔️ Continue STOP keyword enforcement end‑to‑end  

---

# 📊 Expected Final State (After Phase 3)

### 💬 All outbound messaging:

Flows through:

```
routingOrchestrator.sendMessage()
```

### ✉️ All templates:

Live in:

```
/tenants/{tenantId}/messageTemplates
```

### 🧾 All logs live in:

```
/tenants/{tenantId}/messageLogs
```

### 🛑 STOP ALWAYS WORKS

Across all code paths.

---

# 🎯 Why This Plan Works

Because it:

✔️ Locks down risk first  
✔️ Avoids big‑bang rewrites  
✔️ Lets us iterate safely  
✔️ Maintains developer flow  
✔️ Builds toward long‑term architecture  
✔️ Keeps A2P compliance intact  

---

# 🛠 Suggested Cursor Command

Paste this into Cursor when ready:

> “Please implement Phase 1–3 in this plan. Start with STOP enforcement + SMS logging unification in twilio.ts. Then fix tenant scoping in smsThreads. Then migrate legacy template + logging usage to the new systems. Finally, route all legacy SMS calls through routingOrchestrator.sendMessage(). Do not delete legacy code yet — just redirect it safely.”

---

## ✅ After Implementation — We Will:

🔍 Re‑run the audit  
🧪 Test real message flows  
📧 Add Email + Push fully  
🛡 Continue compliance hardening  

---

### 👍 Thank you for moving this forward carefully & professionally — this is the right way to grow a real system.


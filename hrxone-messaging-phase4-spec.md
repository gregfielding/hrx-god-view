# HRX One – Messaging System Phase 4 Spec  
**Focus:** Email & Push Channels + Tenant‑Scoped Consent/Notification Settings  
**Audience:** Cursor / Engineering Team  
**Status:** Ready for implementation (Twilio A2P still pending – SMS is in mock mode by default)

---

## 0. Context (What’s Already Done)

From the previous phases + latest updates:

- ✅ All SMS flows (legacy + new) now route through the **Messaging Orchestrator**.
- ✅ STOP/HELP/START implemented and enforced.
- ✅ Unified logging to `/tenants/{tenantId}/messageLogs` in place.
- ✅ Legacy SMS collections only used as guarded fallback.
- ✅ `SmsProvider` abstraction implemented with:
  - `MockSmsProvider` (default, no real SMS)
  - `TwilioSmsProvider` (real Twilio, A2P-ready)
  - `smsProviderFactory` controlled by `SMS_PROVIDER` env var.

**Now we will:**

1. Implement **Email** as a first‑class channel via `EmailProvider` (SendGrid).
2. Implement **Push** notifications via `PushProvider` (FCM/Expo).
3. Move **consent & notification settings** to tenant‑scoped collections while keeping backward compatibility.

This keeps the system production‑ready even while Twilio campaign approval is still pending.

---

# 1️⃣ Email Channel Implementation

## 1.1 EmailProvider Interface

### ✅ Task E1 — Create Email provider abstraction

**File:** `functions/src/messaging/EmailProvider.ts`

```ts
// functions/src/messaging/EmailProvider.ts

export interface EmailRecipient {
  email: string;
  name?: string;
}

export interface SendEmailOptions {
  tenantId: string;
  to: EmailRecipient | EmailRecipient[];
  subject: string;
  htmlBody: string;
  textBody?: string;
  fromEmail?: string;
  fromName?: string;
  messageTypeId: string;
  userId?: string;
}

export interface EmailSendResult {
  success: boolean;
  providerMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface EmailProvider {
  sendEmail(options: SendEmailOptions): Promise<EmailSendResult>;
}
```

Notes:

- Provider‑agnostic (no SendGrid types).
- Supports one or many recipients.

---

## 1.2 SendGridEmailProvider Implementation

### ✅ Task E2 — Implement SendGrid provider

**File:** `functions/src/messaging/SendGridEmailProvider.ts`

Use your existing SendGrid setup, but wrap it in this provider.

Implementation outline:

```ts
// functions/src/messaging/SendGridEmailProvider.ts

import sgMail from "@sendgrid/mail";
import {
  EmailProvider,
  SendEmailOptions,
  EmailSendResult,
} from "./EmailProvider";

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const DEFAULT_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || "no-reply@hrxone.com";
const DEFAULT_FROM_NAME = process.env.SENDGRID_FROM_NAME || "HRX One";

if (!SENDGRID_API_KEY) {
  console.warn("[SendGridEmailProvider] SENDGRID_API_KEY not set");
} else {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

export class SendGridEmailProvider implements EmailProvider {
  async sendEmail(options: SendEmailOptions): Promise<EmailSendResult> {
    if (!SENDGRID_API_KEY) {
      return {
        success: false,
        errorCode: "MISSING_API_KEY",
        errorMessage: "SENDGRID_API_KEY is not configured",
      };
    }

    const recipients = Array.isArray(options.to) ? options.to : [options.to];

    const msg = {
      to: recipients.map((r) => ({
        email: r.email,
        name: r.name,
      })),
      from: {
        email: options.fromEmail || DEFAULT_FROM_EMAIL,
        name: options.fromName || DEFAULT_FROM_NAME,
      },
      subject: options.subject,
      html: options.htmlBody,
      text: options.textBody || undefined,
    };

    try {
      const [response] = await sgMail.send(msg);
      const messageId =
        response.headers["x-message-id"] ||
        response.headers["X-Message-Id"] ||
        undefined;

      return {
        success: response.statusCode >= 200 && response.statusCode < 300,
        providerMessageId: messageId,
      };
    } catch (err: any) {
      return {
        success: false,
        errorCode: err?.code?.toString?.() ?? "SENDGRID_ERROR",
        errorMessage: err?.message ?? "Unknown SendGrid error",
      };
    }
  }
}
```

---

## 1.3 Email Provider Factory

### ✅ Task E3 — Add factory similar to SmsProvider

**File:** `functions/src/messaging/emailProviderFactory.ts`

```ts
// functions/src/messaging/emailProviderFactory.ts

import { EmailProvider } from "./EmailProvider";
import { SendGridEmailProvider } from "./SendGridEmailProvider";

let cachedProvider: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (cachedProvider) return cachedProvider;

  // For now there is only one implementation.
  // Later we can add "mock" or "ses" if needed.
  cachedProvider = new SendGridEmailProvider();

  return cachedProvider;
}
```

If you want to support a mock email mode later, copy the SMS pattern and add an `EMAIL_PROVIDER` env flag. For now, SendGrid only is fine.

---

## 1.4 Wire Email into the Messaging Orchestrator

### ✅ Task E4 — Implement `deliverEmail()`

**File:** `functions/src/messaging/routingOrchestrator.ts`

In your orchestrator, find the `deliverEmail()` stub and implement something like:

```ts
import { getEmailProvider } from "./emailProviderFactory";
import { getTemplate, renderTemplate } from "./templateEngine";
import { logMessage, updateMessageLogStatus } from "./messageLogging";

async function deliverEmail(args: DeliverEmailArgs): Promise<DeliveryResult> {
  const {
    tenantId,
    user,
    messageTypeId,
    language,
    context,
    toEmail,
    toName,
  } = args;

  // 1) Resolve template (email channel)
  const template = await getTemplate({
    tenantId,
    messageTypeId,
    channel: "email",
    language,
  });

  if (!template) {
    return {
      success: false,
      channel: "email",
      errorCode: "TEMPLATE_NOT_FOUND",
      errorMessage: `No email template for ${messageTypeId}`,
    };
  }

  const rendered = await renderTemplate(template, context);
  const subject = rendered.subject ?? template.subject ?? "";
  const htmlBody = rendered.htmlBody ?? rendered.body ?? "";
  const textBody = rendered.textBody ?? undefined;

  // 2) Log "queued"
  const logDoc = await logMessage({
    tenantId,
    userId: user.id,
    messageTypeId,
    channel: "email",
    direction: "outbound",
    to: toEmail,
    contentSent: {
      subject,
      htmlBody,
      textBody,
    },
    meta: {
      language,
    },
    status: "queued",
  });

  // 3) Send via provider
  const provider = getEmailProvider();
  const result = await provider.sendEmail({
    tenantId,
    to: { email: toEmail, name: toName || user.name },
    subject,
    htmlBody,
    textBody,
    messageTypeId,
    userId: user.id,
  });

  // 4) Update log
  await updateMessageLogStatus({
    tenantId,
    logId: logDoc.id,
    status: result.success ? "sent" : "failed",
    providerMessageId: result.providerMessageId,
    providerErrorCode: result.errorCode,
    providerErrorMessage: result.errorMessage,
  });

  return {
    success: result.success,
    channel: "email",
    providerMessageId: result.providerMessageId,
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
  };
}
```

> Ensure `DeliverEmailArgs` includes `toEmail`, `toName`, `language`, etc., or infer them from `user` + tenant defaults.

---

## 1.5 Migrate Existing Email Flows to Orchestrator

### ✅ Task E5 — Replace ad‑hoc email sending

Search for any existing email‑sending functions (e.g., invites, task emails):

Likely files:

- `functions/src/index.ts` — user invites (SendGrid)
- `functions/src/gmailTasksIntegration.ts` — Gmail task emails
- Any other `sendgrid` or `gmail` usage.

For each of these:

1. Replace direct SendGrid/Gmail calls with calls to `sendMessage()` / orchestrator using a **messageTypeId** like:
   - `user_invite_email`
   - `password_reset_email`
   - `task_notification_email`
2. Add the corresponding email templates for each `messageTypeId` under:
   - `/tenants/{tenantId}/messageTemplates`
3. Ensure `messageLogs` entries are created for all email sends.

> Goal: **No direct SendGrid/Gmail calls remain in business logic.** Everything funnels through the orchestrator.

---

# 2️⃣ Push Notifications Implementation

We’ll mirror the SMS/Email patterns.

## 2.1 PushProvider Interface

### ✅ Task P1 — Define push provider

**File:** `functions/src/messaging/PushProvider.ts`

```ts
// functions/src/messaging/PushProvider.ts

export interface PushTarget {
  userId: string;
  deviceTokens: string[]; // FCM/Expo tokens
}

export interface PushSendParams {
  tenantId: string;
  targets: PushTarget[];
  title: string;
  body: string;
  data?: Record<string, any>;
  messageTypeId: string;
}

export interface PushSendResult {
  success: boolean;
  sentCount: number;
  failedCount: number;
  errors?: Array<{
    deviceToken: string;
    errorCode?: string;
    errorMessage?: string;
  }>;
}

export interface PushProvider {
  sendPush(params: PushSendParams): Promise<PushSendResult>;
}
```

---

## 2.2 FCM/Expo PushProvider Implementation

### ✅ Task P2 — Implement using FCM or Expo

Pick your existing stack (FCM via Firebase Admin or Expo). Example outline for FCM:

**File:** `functions/src/messaging/FcmPushProvider.ts`

```ts
import admin from "firebase-admin";
import {
  PushProvider,
  PushSendParams,
  PushSendResult,
} from "./PushProvider";

export class FcmPushProvider implements PushProvider {
  async sendPush(params: PushSendParams): Promise<PushSendResult> {
    let sentCount = 0;
    let failedCount = 0;
    const errors: PushSendResult["errors"] = [];

    for (const target of params.targets) {
      for (const token of target.deviceTokens) {
        try {
          await admin.messaging().send({
            token,
            notification: {
              title: params.title,
              body: params.body,
            },
            data: {
              ...params.data,
              tenantId: params.tenantId,
              messageTypeId: params.messageTypeId,
              userId: target.userId,
            },
          });
          sentCount += 1;
        } catch (err: any) {
          failedCount += 1;
          errors.push({
            deviceToken: token,
            errorCode: err?.code,
            errorMessage: err?.message,
          });
        }
      }
    }

    return {
      success: failedCount === 0,
      sentCount,
      failedCount,
      errors: errors.length ? errors : undefined,
    };
  }
}
```

You can later add a **MockPushProvider** if you want to avoid real notifications in some environments.

---

## 2.3 Push Provider Factory

### ✅ Task P3 — Factory

**File:** `functions/src/messaging/pushProviderFactory.ts`

```ts
import { PushProvider } from "./PushProvider";
import { FcmPushProvider } from "./FcmPushProvider";

let cachedProvider: PushProvider | null = null;

export function getPushProvider(): PushProvider {
  if (cachedProvider) return cachedProvider;
  cachedProvider = new FcmPushProvider();
  return cachedProvider;
}
```

(Optionally add `PUSH_PROVIDER` env and Mock provider similar to SMS.)

---

## 2.4 Wire Push into Orchestrator

### ✅ Task P4 — Implement `deliverPush()`

**File:** `functions/src/messaging/routingOrchestrator.ts`

In `deliverPush()`:

1. Respect notification preferences (see Section 3).  
2. Resolve a push template if you have one (or derive title/body from context).  
3. Log message as `channel: "push"` in `messageLogs`.  
4. Use `getPushProvider().sendPush()` with device tokens fetched from your user/device collections.  
5. Update log status based on result.

Simplified example (pseudocode, adjust to your actual models):

```ts
import { getPushProvider } from "./pushProviderFactory";
import { logMessage, updateMessageLogStatus } from "./messageLogging";

async function deliverPush(args: DeliverPushArgs): Promise<DeliveryResult> {
  const tokens = await getDeviceTokensForUser(args.user.id);
  if (!tokens.length) {
    return {
      success: false,
      channel: "push",
      errorCode: "NO_DEVICE_TOKENS",
      errorMessage: "No push device tokens for user",
    };
  }

  const logDoc = await logMessage({
    tenantId: args.tenantId,
    userId: args.user.id,
    messageTypeId: args.messageTypeId,
    channel: "push",
    direction: "outbound",
    to: args.user.id,
    contentSent: {
      title: args.title,
      body: args.body,
    },
    status: "queued",
  });

  const provider = getPushProvider();
  const result = await provider.sendPush({
    tenantId: args.tenantId,
    messageTypeId: args.messageTypeId,
    targets: [{ userId: args.user.id, deviceTokens: tokens }],
    title: args.title,
    body: args.body,
    data: args.data,
  });

  await updateMessageLogStatus({
    tenantId: args.tenantId,
    logId: logDoc.id,
    status: result.success ? "sent" : "failed",
    providerErrorCode: !result.success ? "PUSH_FAILED" : undefined,
    providerErrorMessage: !result.success ? JSON.stringify(result.errors || []) : undefined,
  });

  return {
    success: result.success,
    channel: "push",
    errorCode: !result.success ? "PUSH_FAILED" : undefined,
    errorMessage: !result.success ? "One or more push sends failed" : undefined,
  };
}
```

---

# 3️⃣ Tenant‑Scoped Consent & Notification Settings

Now that SMS, email, and push all run through the orchestrator, we should upgrade **where** consent and settings are stored.

Currently, consent and notification prefs are partly on `/users/{userId}`. We’ll move to **tenant‑scoped** collections, but keep backward‑compatible mirrors for now.

## 3.1 New Firestore Collections

### ✅ Task C1 — Introduce tenant‑scoped consent & settings

**Collections:**

```text
/tenants/{tenantId}/smsConsents/{userId}
/tenants/{tenantId}/smsConsents/{userId}/events/{eventId}
/tenants/{tenantId}/notificationSettings/{userId}
```

### Example `smsConsents` doc

```ts
// /tenants/{tenantId}/smsConsents/{userId}
{
  userId: string;
  tenantId: string;
  phoneNumber: string;
  smsOptIn: boolean;
  smsBlockedSystem: boolean; // set true on STOP
  consentVersion: string;    // e.g. "2025-10-21"
  lastUpdatedAt: FirebaseFirestore.Timestamp;
  source: "signup" | "keyword" | "admin" | "import";
}
```

### Example consent `events` doc

```ts
// /tenants/{tenantId}/smsConsents/{userId}/events/{eventId}
{
  eventId: string;
  tenantId: string;
  userId: string;
  type: "OPT_IN" | "OPT_OUT" | "STOP" | "START" | "HELP" | "ADMIN_UPDATE";
  previousValue?: any;
  newValue?: any;
  createdAt: FirebaseFirestore.Timestamp;
  source: "signup" | "keyword" | "admin" | "system";
  rawMessageSid?: string;
  rawPayload?: any;
}
```

### Example `notificationSettings` doc

```ts
// /tenants/{tenantId}/notificationSettings/{userId}
{
  userId: string;
  tenantId: string;

  // High level overrides
  emailEnabled: boolean;
  smsEnabled: boolean;
  pushEnabled: boolean;

  // Per message type overrides
  channelsAllowedPerType: {
    [messageTypeId: string]: {
      email?: boolean;
      sms?: boolean;
      push?: boolean;
    };
  };

  updatedAt: FirebaseFirestore.Timestamp;
}
```

---

## 3.2 Update STOP/HELP Handler to Use New Collections

### ✅ Task C2 — Extend `stopHelpHandler.ts`

**File:** `functions/src/messaging/stopHelpHandler.ts`

1. When processing STOP/START/HELP:
   - Update both:
     - `/tenants/{tenantId}/smsConsents/{userId}`
     - (optionally) mirror fields on `/users/{userId}` for now (`smsOptIn`, `smsBlockedSystem`)
   - Append an event doc under `/events` subcollection.

2. Continue calling `logPreferenceChange()` to keep centralized logs, but also keep the new `smsConsents` as the **authoritative** consent store for multi‑tenant safety.

> IMPORTANT: Tenant ID must be derived reliably from the incoming message (e.g., via Messaging Service → Brand → Tenant mapping, or metadata on `smsThreads`). Use the best existing mechanism in your code; if unclear, add a TODO + assumption comment.

---

## 3.3 Update Orchestrator Consent Checks

### ✅ Task C3 — Read from tenant‑scoped consent first

**File:** `functions/src/messaging/routingOrchestrator.ts`

In the logic where you decide whether SMS is allowed (`shouldUseChannel()` or equivalent):

1. First, try to read consent from `/tenants/{tenantId}/smsConsents/{userId}`.
2. If missing (migration period), fall back to `/users/{userId}` fields.
3. Combine:

```ts
// pseudocode
if (channel === "sms") {
  const consent = await getTenantSmsConsent(tenantId, userId);

  const smsBlockedSystem = consent?.smsBlockedSystem ?? user.smsBlockedSystem ?? false;
  const smsOptIn = consent?.smsOptIn ?? user.smsOptIn ?? false;

  if (!smsOptIn || smsBlockedSystem) {
    return false;
  }
}
```

> This keeps old data working while you migrate, but new updates go into tenant‑scoped docs.

---

## 3.4 Notification Settings Resolution

### ✅ Task C4 — Merge notification settings into channel decisions

Still in `routingOrchestrator.ts` (or a helper used by `shouldUseChannel()`):

1. Load `/tenants/{tenantId}/notificationSettings/{userId}` if present.
2. Merge with defaults and with user‑level flags:

Order of precedence (strongest → weakest):

1. **Per‑message‑type setting** (`channelsAllowedPerType[messageTypeId].sms`)  
2. Global channel toggle on notificationSettings (`smsEnabled`, `emailEnabled`, `pushEnabled`)  
3. User‑level defaults or system defaults

Pseudocode:

```ts
function isChannelAllowedForUser({
  channel,
  messageTypeId,
  notificationSettings,
}): boolean {
  const perType = notificationSettings?.channelsAllowedPerType?.[messageTypeId];

  if (perType && typeof perType[channel] === "boolean") {
    return perType[channel];
  }

  if (channel === "sms") {
    return notificationSettings?.smsEnabled ?? true;
  }
  if (channel === "email") {
    return notificationSettings?.emailEnabled ?? true;
  }
  if (channel === "push") {
    return notificationSettings?.pushEnabled ?? true;
  }

  return true;
}
```

Then call this in `shouldUseChannel()` *in addition to* consent checks.

---

# 4️⃣ Testing Plan (What to Verify After Changes)

## 4.1 Email

- Trigger a flow that sends an email via `sendMessage()` (e.g. user invite).
- Verify:
  - Email is delivered (in staging / with a test address).
  - `messageLogs` entry is present with `channel: "email"`.
  - `providerMessageId` is populated where possible.

## 4.2 Push

- Register a test device and save tokens.  
- Trigger a push‑type `messageTypeId` (e.g. `shift_reminder_push`).  
- Verify:
  - Device receives push.
  - `messageLogs` entry logged as `channel: "push"`.
  - Failures are recorded when you intentionally pass an invalid token.

## 4.3 Consent & Settings

- For a user + tenant:
  - Confirm a `smsConsents/{userId}` doc is created when they opt in.
  - Send `STOP` → confirm `smsBlockedSystem=true` in `smsConsents` and mirrored in `/users`.
  - Send `START` → confirm it flips back and SMS is allowed again.
  - Toggle notificationSettings to disable SMS for a message type → send that message type → ensure no SMS is attempted (but maybe email still is).

---

# 5️⃣ Instructions to Cursor (Copy/Paste)

> **Please implement Phase 4 according to `HRX One – Messaging System Phase 4 Spec` as follows:**
>
> 1. Create the Email provider abstraction and SendGrid implementation (`EmailProvider`, `SendGridEmailProvider`, `getEmailProvider()`), then fully implement `deliverEmail()` in `routingOrchestrator.ts` so that all email sending runs through the orchestrator + messageLogs.
> 2. Implement Push notifications via a `PushProvider` interface, `FcmPushProvider` (or equivalent), a `getPushProvider()` factory, and `deliverPush()` in the orchestrator, including message logging.
> 3. Introduce tenant‑scoped Firestore collections for `smsConsents` and `notificationSettings` under `/tenants/{tenantId}/...`. Update `stopHelpHandler.ts` and the orchestrator’s consent logic to read/write from these collections, while still mirroring critical fields on `/users/{userId}` for backward compatibility.
> 4. Update `shouldUseChannel()` / routing logic to respect notificationSettings (global toggles + per‑message‑type overrides).
> 5. Remove any remaining ad‑hoc SendGrid/Gmail usage in business logic and replace with orchestrator‑based message sends using `messageTypeId` + templates.
> 6. Do **not** delete existing user‑level consent fields or legacy collections yet; just ensure new flows use the tenant‑scoped paths as the source of truth and everything is logged through `messageLogs`.
> 7. Finally, provide a summary of all files touched/created and brief instructions on how to test email, push, and tenant‑scoped consent in our dev environment.
>
> Twilio A2P approval may still be pending, so **do not rely on real SMS delivery for testing**. Focus on email, push, consent logic, and messageLogs behavior.

---

**End of Phase 4 Spec**

# HRX One – Mock SMS Provider & Pre‑A2P Testing Plan

**Date:** 2025-01-27  
**Audience:** Cursor / Engineering Team  
**Purpose:** Allow full end‑to‑end testing of the unified messaging system **before** Twilio A2P campaign approval, and make it trivial to switch to real Twilio once approval is granted.

---

## 1️⃣ Overall Strategy

We want to:

1. Exercise the **Messaging Orchestrator**, templates, consent checks, and Firestore logging **right now**, even while A2P campaigns are still “In progress.”
2. Avoid sending any real SMS until A2P is approved.
3. Once Twilio approves the campaign, switch from “mock” to “live” by changing a single environment flag.

To do this, we will introduce a **pluggable `SmsProvider` interface** with two implementations:

- `MockSmsProvider` – used for local/dev/staging and while waiting for Twilio approval.
- `TwilioSmsProvider` – used in production once A2P is live.

All outbound SMS in the codebase must go through `SmsProvider` (via the Messaging Orchestrator).

---

## 2️⃣ SmsProvider Interface

### ✅ Task: Create a provider abstraction

**File:** `functions/src/messaging/SmsProvider.ts` (or similar)

```ts
// functions/src/messaging/SmsProvider.ts

export interface SmsSendParams {
  tenantId: string;
  to: string;              // destination phone
  from: string;            // Twilio number / Messaging Service number
  body: string;
  messageTypeId: string;   // maps to messageTypes registry
  userId?: string;         // HRX user ID related to this message
  threadId?: string;       // smsThreads threadId, if applicable
}

export interface SmsSendResult {
  success: boolean;
  providerMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface SmsProvider {
  sendSms(params: SmsSendParams): Promise<SmsSendResult>;
}
```

> IMPORTANT: No Twilio-specific types here. This file is **provider-agnostic**.

---

## 3️⃣ TwilioSmsProvider (Real Provider, Used Later)

### ✅ Task: Wrap existing Twilio sending in a provider class

**File:** `functions/src/messaging/TwilioSmsProvider.ts`

Implementation outline:

```ts
// functions/src/messaging/TwilioSmsProvider.ts

import twilioClient from "../twilioClient"; // however you currently construct the Twilio client
import {
  SmsProvider,
  SmsSendParams,
  SmsSendResult,
} from "./SmsProvider";

export class TwilioSmsProvider implements SmsProvider {
  async sendSms(params: SmsSendParams): Promise<SmsSendResult> {
    try {
      const message = await twilioClient.messages.create({
        to: params.to,
        from: params.from,
        body: params.body,
        // If you are using Messaging Service SID, pass messagingServiceSid instead of from
      });

      return {
        success: true,
        providerMessageId: message.sid,
      };
    } catch (err: any) {
      return {
        success: false,
        errorCode: err?.code?.toString?.() ?? "TWILIO_ERROR",
        errorMessage: err?.message ?? "Unknown Twilio error",
      };
    }
  }
}
```

This implementation can (now or later) replace the internal Twilio calls currently used by `sendWorkerMessageInternal()` and the new orchestrator.

---

## 4️⃣ MockSmsProvider (Used BEFORE Twilio Approval)

### ✅ Task: Implement a mock provider that never sends real SMS

**File:** `functions/src/messaging/MockSmsProvider.ts`

```ts
// functions/src/messaging/MockSmsProvider.ts

import {
  SmsProvider,
  SmsSendParams,
  SmsSendResult,
} from "./SmsProvider";
import { db } from "../firebase"; // Firestore

export class MockSmsProvider implements SmsProvider {
  async sendSms(params: SmsSendParams): Promise<SmsSendResult> {
    // Optionally write a separate debug log collection
    const debugRef = db
      .collection("test_logs")
      .doc("mockSms")
      .collection("events")
      .doc();

    await debugRef.set({
      id: debugRef.id,
      tenantId: params.tenantId,
      to: params.to,
      from: params.from,
      body: params.body,
      messageTypeId: params.messageTypeId,
      userId: params.userId ?? null,
      threadId: params.threadId ?? null,
      createdAt: new Date(),
      provider: "mock",
    });

    // Pretend Twilio accepted the message
    return {
      success: true,
      providerMessageId: `mock-${debugRef.id}`,
    };
  }
}
```

Notes:

- This is **safe**: no outbound network request to Twilio, but everything in your stack behaves as if the SMS was sent successfully.
- The Messaging Orchestrator will still log to `/tenants/{tenantId}/messageLogs` as usual; this debug collection is just extra visibility for dev.

---

## 5️⃣ Provider Factory & Environment Flag

### ✅ Task: Centralize provider selection

**File:** `functions/src/messaging/smsProviderFactory.ts`

```ts
// functions/src/messaging/smsProviderFactory.ts

import { SmsProvider } from "./SmsProvider";
import { TwilioSmsProvider } from "./TwilioSmsProvider";
import { MockSmsProvider } from "./MockSmsProvider";

let cachedProvider: SmsProvider | null = null;

export function getSmsProvider(): SmsProvider {
  if (cachedProvider) return cachedProvider;

  const mode = process.env.SMS_PROVIDER ?? "mock";

  if (mode === "twilio") {
    cachedProvider = new TwilioSmsProvider();
  } else {
    cachedProvider = new MockSmsProvider();
  }

  return cachedProvider;
}
```

### ✅ Env variable

In your Functions environment (.env / runtime config):

```bash
# While waiting for Twilio A2P approval:
SMS_PROVIDER=mock

# After A2P is approved and live:
SMS_PROVIDER=twilio
```

> The ONLY change when you go live is this variable (plus any Messaging Service SID config you already use).

---

## 6️⃣ Wire the Messaging Orchestrator to SmsProvider

### ✅ Task: Ensure ALL SMS goes through `getSmsProvider()`

**File:** `functions/src/messaging/routingOrchestrator.ts`

In `deliverSMS()` (or equivalent SMS delivery function):

1. Render the SMS body with the template engine.  
2. Call the unified logger to create a `/messageLogs` entry (status: `"queued"`).  
3. Use the provider factory:

```ts
import { getSmsProvider } from "./smsProviderFactory";

async function deliverSMS(args: DeliverSmsArgs): Promise<DeliveryResult> {
  const smsProvider = getSmsProvider();

  const result = await smsProvider.sendSms({
    tenantId: args.tenantId,
    to: args.to,
    from: args.from, // or messaging service
    body: args.body,
    messageTypeId: args.messageTypeId,
    userId: args.user.id,
    threadId: args.threadId ?? undefined,
  });

  // Update messageLogs status based on result
  // (this logic already exists or is easy to implement)
}
```

3. **Remove any remaining direct calls to Twilio** from business logic files. They must all route through `deliverSMS()` → `SmsProvider`.

> This keeps the Phase 1–3 migration intact while giving us a clean test vs. prod switch.

---

## 7️⃣ How to Test While A2P is “In Progress”

Even with Twilio not fully approved, you can test **all logic** inside your system.

### 7.1 Outbound flow test

1. Confirm `SMS_PROVIDER=mock` in your Functions environment.  
2. Use any existing API/button that triggers `sendMessage()` in the orchestrator (e.g., application-created, status change, group message).  
3. Verify:

   - A `messageLogs` entry is created under `/tenants/{tenantId}/messageLogs`:
     - `channel: "sms"`
     - `status: "sent"` (mock success)
     - `providerMessageId` starts with `mock-...`
   - A `test_logs/mockSms/events` entry exists with the same details (optional).

### 7.2 STOP / HELP / START behavior

Even in mock mode, you can test keyword handling end‑to‑end by calling your **own webhooks** directly.

#### a) Inbound SMS webhook

- Find your deployed endpoint for `twilioInboundSmsWebhook()` (e.g., `/api/webhooks/twilio/inbound-sms`).  
- Use curl or Postman to send a request **mimicking Twilio**:

Example (urlencoded form body):

```bash
curl -X POST https://<YOUR_FUNCTION_URL>/api/webhooks/twilio/inbound-sms   -d "From=+15551234567"   -d "To=+1YOURTWILIONUMBER"   -d "Body=STOP"   -d "MessageSid=SMXXXXXXXXXXXXXXXXXXXXXXXX"
```

Expected results:

- `stopHelpHandler` runs.  
- User consent is updated (`smsOptIn`, `smsBlockedSystem`).  
- A preference change log entry is created.  
- Future calls to `sendMessage()` for that user should result in **no SMS** being delivered (the orchestrator’s `shouldUseChannel()` should block SMS).

Repeat with:

- `Body=HELP` → should send a help response.  
- `Body=START` → should re-enable SMS (`smsOptIn=true`, `smsBlockedSystem=false`).

#### b) Status callback webhook

- Call your status callback URL (e.g., `/api/webhooks/twilio/status-callback`) with a payload that includes:
  - `MessageSid`
  - `MessageStatus` (`sent`, `delivered`, `failed`, etc.)

Verify:

- `messageLogs` entries with matching `providerMessageId` are updated.  
- This works the same in mock or twilio mode; the handler only cares about the payload, not how the message was sent.

---

## 8️⃣ Instructions for Cursor

**Please implement this EXACT plan (no real SMS required yet):**

1. **Create the `SmsProvider` abstraction** in `functions/src/messaging/SmsProvider.ts` with `SmsSendParams`, `SmsSendResult`, and `SmsProvider` interface.
2. **Implement `TwilioSmsProvider`** in `functions/src/messaging/TwilioSmsProvider.ts` that wraps the existing Twilio client logic and returns `SmsSendResult` (do not throw on normal Twilio errors; return structured failure instead).
3. **Implement `MockSmsProvider`** in `functions/src/messaging/MockSmsProvider.ts` that:
   - Does **NOT** call Twilio.
   - Writes a debug entry to `test_logs/mockSms/events` in Firestore.
   - Returns `success: true` and a fake `providerMessageId` like `mock-<docId>`.
4. **Create `getSmsProvider()` factory** in `functions/src/messaging/smsProviderFactory.ts` that:
   - Reads `process.env.SMS_PROVIDER` (default `"mock"`).
   - Returns a singleton instance of either `MockSmsProvider` or `TwilioSmsProvider`.
5. **Update the Messaging Orchestrator’s `deliverSMS()`** to:
   - Use `getSmsProvider().sendSms(...)` for all outbound SMS.
   - Update `/tenants/{tenantId}/messageLogs` based on the returned `SmsSendResult`.
6. **Ensure there are no remaining direct Twilio calls** in business logic files (application triggers, group messaging, shifts, broadcasts). All paths should call the orchestrator, which in turn uses `SmsProvider`.
7. **Do NOT delete legacy collections yet**; just ensure the happy path no longer writes to `/sms_messages`.
8. Provide a short summary of:
   - Where you wired `SmsProvider` in.  
   - How to toggle between `"mock"` and `"twilio"` modes.  
   - Example curl command bodies for hitting the inbound SMS and status callback webhooks for testing.

Once this is done, we can keep `SMS_PROVIDER=mock` until Twilio A2P approval is complete, then flip to `"twilio"` for real-world testing without further code changes.

---

**End of Document**

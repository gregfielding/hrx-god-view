# HRX One – Messaging Phase 4.1  
**Focus:** Email Provider Cleanup, Lint Fixes, and Final Wiring  
**Audience:** Cursor / Engineering Team  
**Status:** Phase 4 core implementation is complete; this doc is for cleanup + final alignment.

---

## 0. Context

From Phase 4 implementation:

- Email channel is wired through the Messaging Orchestrator using `sendGridEmailProvider` and `emailProviderFactory`.
- Push notifications are wired via `PushProvider` / `FcmPushProvider` / `pushProviderFactory`.
- Tenant-scoped consent (`tenantConsent.ts`) and notification settings (`tenantNotificationSettings.ts`) are implemented and used by:
  - `routingOrchestrator.ts`
  - `stopHelpHandler.ts`

**Remaining issues (from Cursor’s summary):**

1. Two linter errors about **missing `emailProvider.ts`**.
2. `emailService.ts` still imports from a non-existent `emailProvider.ts`.

This Phase 4.1 spec is just to:  
- Standardize the `EmailProvider` interface location.  
- Fix imports & lints.  
- Make sure **all email usage is routed through the orchestrator**, not through any leftover direct services.

---

# 1️⃣ Target Architecture for Email Provider

We want ONE canonical definition of the Email provider interfaces under **messaging**, mirroring the SMS & Push patterns.

### Canonical interface file

- **File:** `functions/src/messaging/EmailProvider.ts`
- This file should define:
  - `EmailRecipient`
  - `SendEmailOptions`
  - `EmailSendResult`
  - `EmailProvider`

Everything else (`sendGridEmailProvider.ts`, `emailProviderFactory.ts`, any internal helpers) should import from this file.

Other old interface locations (e.g. a bare `emailProvider.ts` in root or in `src/utils`) should be removed or have their imports updated.

---

# 2️⃣ Exact Implementation Tasks

## Task E1 — Create `EmailProvider.ts` (if not already present)

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

- This should match the interface you already wired into `sendGridEmailProvider.ts` and `emailProviderFactory.ts`.  
- If those files define their own types, remove the duplicates and import from here instead.

---

## Task E2 — Update `sendGridEmailProvider.ts` to import from the canonical interface

**File:** `functions/src/messaging/sendGridEmailProvider.ts`

1. Replace any local interface definitions with imports:

```ts
import {
  EmailProvider,
  SendEmailOptions,
  EmailSendResult,
} from "./EmailProvider";
```

2. Confirm that the `SendGridEmailProvider` class implements `EmailProvider` and returns `EmailSendResult` exactly.

3. Remove any now-unused types or old imports from a different `emailProvider.ts` path.

---

## Task E3 — Update `emailProviderFactory.ts` to import from the canonical interface

**File:** `functions/src/messaging/emailProviderFactory.ts`

1. Ensure the imports look like:

```ts
import { EmailProvider } from "./EmailProvider";
import { SendGridEmailProvider } from "./sendGridEmailProvider";
```

2. Confirm the exported factory signature:

```ts
let cachedProvider: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (cachedProvider) return cachedProvider;

  // For now we only support SendGrid; later we can add MOCK or others.
  cachedProvider = new SendGridEmailProvider();

  return cachedProvider;
}
```

3. Remove any references to a non-existent `emailProvider.ts` file.

---

## Task E4 — Resolve `emailService.ts` Import (Frontend / Other Layer)

You mentioned that `emailService.ts` imports from a non-existent `emailProvider.ts`. The goal is to **not** have frontend or non-messaging code importing the provider directly.

Instead:

- Frontend / external code should use **HTTP APIs or Cloud Functions** that delegate to the **Messaging Orchestrator**, not call providers directly.

### Option A (Preferred) — `emailService.ts` uses Messaging API

1. Locate `src/utils/emailService.ts` (path may vary).  
2. Replace any imports like:

```ts
import { EmailProvider } from "../emailProvider"; // or similar
```

with **no direct provider import**.

3. Rework `emailService.ts` to call your existing Messaging API, e.g.:

```ts
// PSEUDOCODE – adjust to your actual API endpoints
export async function sendSystemEmail(params: {
  tenantId: string;
  userId: string;
  messageTypeId: string;
  context: Record<string, any>;
}) {
  const res = await fetch("/api/messaging/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenantId: params.tenantId,
      userId: params.userId,
      messageTypeId: params.messageTypeId,
      channels: ["email"],
      context: params.context,
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to send system email: ${res.status}`);
  }

  return res.json();
}
```

4. The backend handler for `/api/messaging/send` should already call `sendMessage()` in the orchestrator, which then calls `deliverEmail()` → `getEmailProvider()`.

> Result: The frontend never knows about `EmailProvider` and the linter errors go away.

### Option B — Keep `emailService.ts` purely backend-only

If `emailService.ts` is actually in the Functions codebase (not frontend), then:

1. Move it under `functions/src/messaging/` if it’s truly part of messaging.  
2. Update any imports in that file to pull from `./EmailProvider` instead of a flat `emailProvider.ts`.  
3. Make sure only orchestrator / messaging layer imports the provider; nothing else should.

---

## Task E5 — Lint Pass and Import Cleanup

Once Tasks E1–E4 are done:

1. Run your linter + TypeScript checks:
   - `npm run lint` or `pnpm lint` (whatever you use)
   - `npx tsc --noEmit` (or your existing TS check)

2. Confirm:
   - No references to a top-level `emailProvider.ts` remain.
   - All imports resolve to the canonical `functions/src/messaging/EmailProvider.ts`.

3. If any other file imports `EmailProvider` from the wrong path, update it to use:

```ts
import { EmailProvider } from "./messaging/EmailProvider"; // or correct relative path
```

---

# 3️⃣ Final Sanity Checks (After Cleanup)

After Phase 4.1 is implemented, verify:

1. **Build/Typecheck**: repo builds and passes TypeScript/lint checks with zero errors.  
2. **Email path** (dev environment):
   - Trigger a message via orchestrator (`sendMessage()` with `channels: ["email"]`).
   - Email is delivered via SendGrid (or at least reaches your SendGrid sandbox / test inbox).
   - `messageLogs` entry created with:
     - `channel: "email"`
     - `messageTypeId`
     - `providerMessageId` (if SendGrid returns one).
3. **No direct provider usage in UI**:
   - Frontend only calls APIs or Cloud Functions.
   - No UI code imports `EmailProvider` directly.

---

# 4️⃣ Instructions for Cursor (Copy/Paste)

> **Please implement Phase 4.1 for the HRX One messaging system, focusing on Email provider cleanup and linter fixes:**
>
> 1. Create `functions/src/messaging/EmailProvider.ts` and move the `EmailRecipient`, `SendEmailOptions`, `EmailSendResult`, and `EmailProvider` interface definitions there (or ensure they match the spec above).
> 2. Update `functions/src/messaging/sendGridEmailProvider.ts` to import these interfaces from `./EmailProvider` and remove any duplicate type declarations or incorrect imports.
> 3. Update `functions/src/messaging/emailProviderFactory.ts` so it imports `EmailProvider` from `./EmailProvider` and `SendGridEmailProvider` from `./sendGridEmailProvider`. Ensure it exports a `getEmailProvider()` function that returns a singleton `EmailProvider` instance.
> 4. Fix `emailService.ts` (and any other files) that currently import from a non-existent `emailProvider.ts`:
>    - Prefer routing all email send requests through the Messaging Orchestrator’s `sendMessage()` API instead of calling providers directly.
>    - Remove any direct imports of `EmailProvider` from UI or non-messaging files.
> 5. Run lint/TypeScript checks and confirm there are **no remaining linter errors** related to `emailProvider.ts` or unresolved imports.
> 6. Provide a brief summary of:
>    - Files created/modified
>    - How the EmailProvider is now structured
>    - How the UI or other services should trigger email sends (i.e., via orchestrator APIs).
>
> Twilio A2P approval may still be pending; do **not** change the SMS mock/real provider behavior. This task is focused only on Email provider cleanup and making sure the messaging system compiles cleanly.

---

**End of Phase 4.1 Spec**

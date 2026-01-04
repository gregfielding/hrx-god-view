# HRX One – EmailProvider & SendGrid Implementation Spec  
Version: 1.0  
Scope: Tiny provider interface, SendGrid adapter, and integration with Messaging Orchestrator + messageLogs

---

## 1️⃣ Goals

1. Define a **minimal, stable EmailProvider interface** used everywhere in the app.  
2. Implement a **SendGridEmailProvider** that satisfies this interface.  
3. Integrate email sending into the existing **Messaging Orchestrator** so that:
   - All outbound emails go through a **single code path**.
   - Every email is logged into `/tenants/{tenantId}/messageLogs`.
   - Future provider swaps (SES/Postmark/etc.) only require changes in the adapter, not in business logic.

---

# 2️⃣ EmailProvider Interface

Create a file like: `src/services/email/EmailProvider.ts`

```ts
// src/services/email/EmailProvider.ts
export type EmailChannel = "transactional" | "system" | "notification";

export interface EmailRecipient {
  email: string;
  name?: string;
}

export interface SendEmailOptions {
  tenantId: string;

  // Recipients
  to: EmailRecipient[];           // required: at least 1
  cc?: EmailRecipient[];
  bcc?: EmailRecipient[];

  // Content
  subject: string;
  textBody?: string;             // plain text version
  htmlBody?: string;             // HTML version (preferred)
  replyTo?: EmailRecipient;

  // Classification
  messageTypeId: string;         // maps to /system/messageTypes
  channelType?: EmailChannel;    // optional categorization

  // Optional metadata
  userId?: string;               // primary user the email relates to
  threadId?: string;             // if tied to messaging thread
  tags?: string[];               // e.g. ["shift_confirmation", "welcome"]
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

- **No direct SendGrid types** here; keep it provider-agnostic.
- `messageTypeId` ties directly into your MessageTypes registry + messageLogs.

---

# 3️⃣ SendGridEmailProvider Implementation

Create something like: `src/services/email/SendGridEmailProvider.ts`.

```ts
// src/services/email/SendGridEmailProvider.ts
import sgMail from "@sendgrid/mail";
import {
  EmailProvider,
  SendEmailOptions,
  EmailSendResult,
} from "./EmailProvider";

export interface SendGridConfig {
  apiKey: string;
  defaultFromEmail: string;
  defaultFromName?: string;
}

export class SendGridEmailProvider implements EmailProvider {
  private config: SendGridConfig;

  constructor(config: SendGridConfig) {
    this.config = config;
    sgMail.setApiKey(config.apiKey);
  }

  async sendEmail(options: SendEmailOptions): Promise<EmailSendResult> {
    const fromName = this.config.defaultFromName ?? "HRX One";
    const msg = {
      from: {
        email: this.config.defaultFromEmail,
        name: fromName,
      },
      to: options.to.map(r => ({
        email: r.email,
        name: r.name,
      })),
      cc: options.cc?.map(r => ({ email: r.email, name: r.name })),
      bcc: options.bcc?.map(r => ({ email: r.email, name: r.name })),
      subject: options.subject,
      text: options.textBody,
      html: options.htmlBody ?? options.textBody,
      replyTo: options.replyTo && {
        email: options.replyTo.email,
        name: options.replyTo.name,
      },
      // Custom args used later in logs/analytics if needed
      customArgs: {
        tenantId: options.tenantId,
        messageTypeId: options.messageTypeId,
        userId: options.userId ?? "",
        threadId: options.threadId ?? "",
      },
    };

    try {
      const [response] = await sgMail.send(msg);
      const providerMessageId =
        response.headers["x-message-id"] ||
        response.headers["x-sendgrid-message-id"] ||
        undefined;

      return {
        success: true,
        providerMessageId,
      };
    } catch (err: any) {
      const errorCode = err?.code?.toString?.() ?? "SENDGRID_ERROR";
      const errorMessage =
        err?.response?.body?.errors?.[0]?.message ?? err.message ?? "Unknown SendGrid error";

      // Do NOT throw; return structured failure so caller can log it.
      return {
        success: false,
        errorCode,
        errorMessage,
      };
    }
  }
}
```

### Configuration

Config can come from:

- Environment variables (`SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, etc.) or  
- A Firestore `/system/messagingConfig/email` document (if you want runtime changes).

Example factory:

```ts
// src/services/email/index.ts
import { EmailProvider } from "./EmailProvider";
import { SendGridEmailProvider } from "./SendGridEmailProvider";

let emailProvider: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (!emailProvider) {
    emailProvider = new SendGridEmailProvider({
      apiKey: process.env.SENDGRID_API_KEY!,
      defaultFromEmail: process.env.SENDGRID_FROM_EMAIL!,
      defaultFromName: process.env.SENDGRID_FROM_NAME ?? "HRX One",
    });
  }
  return emailProvider;
}
```

---

# 4️⃣ Integrating with the Messaging Orchestrator

The goal is that your central Messaging Orchestrator, when deciding to send on the **email channel**, will:

1. Render the template (using your Template Engine).
2. Create a `messageLogs` record.
3. Use `EmailProvider` to send.
4. Update the log with provider status.

Assuming you already have a function like:

```ts
// MessagingService.ts
async function sendMessage({
  tenantId,
  userId,
  messageTypeId,
  context,
}: {
  tenantId: string;
  userId: string;
  messageTypeId: string;
  context: Record<string, any>;
}) {
  // 1) load user + prefs + typeConfig
  // 2) determine allowed channels
  // 3) for each channel, route to per-channel sender
}
```

### 4.1 Email-specific send logic

Inside your orchestrator, create a helper:

```ts
import { getEmailProvider } from "../services/email";
import { db } from "../firebase"; // or wherever Firestore client lives

async function sendEmailChannel({
  tenantId,
  user,
  messageTypeId,
  context,
}: {
  tenantId: string;
  user: { id: string; email: string; name?: string };
  messageTypeId: string;
  context: Record<string, any>;
}) {
  // 1) Resolve template
  const template = await templateService.getTemplate({
    messageTypeId,
    channel: "email",
    language: user.preferredLanguage ?? "en",
    tenantId,
  });

  if (!template) {
    // Optionally: log missing template
    await logMessage({
      tenantId,
      userId: user.id,
      messageTypeId,
      channel: "email",
      direction: "outbound",
      fromIdentity: "system",
      contentSent: "[NOT SENT - missing template]",
      status: "not_sent",
      failureReason: "missing_template",
    });
    return { success: false, reason: "missing_template" };
  }

  // 2) Render template
  const renderedBody = renderTemplate(template, context);

  // 3) Create initial log entry (status: queued)
  const logRef = db
    .collection("tenants")
    .doc(tenantId)
    .collection("messageLogs")
    .doc();

  const logDoc = {
    id: logRef.id,
    tenantId,
    userId: user.id,
    threadId: null,
    messageTypeId,
    channel: "email" as const,
    direction: "outbound" as const,
    fromIdentity: "system" as const,
    fromUserId: null,
    contentOriginal: renderedBody,
    contentSent: renderedBody,
    language: user.preferredLanguage ?? "en",
    status: "queued" as const,
    createdAt: new Date(),
  };

  await logRef.set(logDoc);

  // 4) Send via EmailProvider
  const emailProvider = getEmailProvider();
  const result = await emailProvider.sendEmail({
    tenantId,
    to: [{ email: user.email, name: user.name }],
    subject: context.subject ?? template.name ?? "[no subject]",
    textBody: context.textBody ?? undefined,
    htmlBody: renderedBody,
    messageTypeId,
    userId: user.id,
    threadId: undefined,
  });

  // 5) Update log with final status
  const update: any = {
    status: result.success ? "sent" : "failed",
  };

  if (result.providerMessageId) {
    update.providerMessageId = result.providerMessageId;
  }
  if (!result.success) {
    update.failureReason = result.errorMessage ?? result.errorCode;
  }

  await logRef.update(update);

  return {
    success: result.success,
    messageLogId: logRef.id,
  };
}
```

### 4.2 Hooking into the Existing Orchestrator

Inside your main `sendMessage` orchestrator, add:

```ts
if (channels.includes("email")) {
  await sendEmailChannel({
    tenantId,
    user,
    messageTypeId,
    context,
  });
}
```

Where `channels` is the output from your `chooseChannels()` logic that already considers:

- notification preferences
- smsOptIn, smsBlockedSystem (for SMS)
- messageType defaults

> **Key point:** Email should be treated as just another channel in the orchestrator, using the same `messageLogs` pattern as SMS.

---

# 5️⃣ Twilio / SendGrid Webhook Tie-In (Optional)

If you enable SendGrid **event webhooks** (delivered / bounced / spam / etc.), they can map nicely to `messageLogs`:

1. Configure a route like `/api/webhooks/sendgrid`.
2. Parse events with their `sg_message_id` or custom args.
3. Find the corresponding `/tenants/{tenantId}/messageLogs/{logId}` entry by `providerMessageId` or `customArgs`.
4. Update `status` & `failureReason` as needed.

This gives you symmetric behavior with Twilio’s SMS status callbacks.

---

# 6️⃣ How This Interacts With the Firestore Design

- All email logs live at:  
  `/tenants/{tenantId}/messageLogs/{logId}` with `channel: "email"`
- No email-specific log collections are needed.
- Templates for email live in the same structure as SMS templates:  
  `/system/messageTemplates` + optional `/tenants/{tenantId}/messageTemplates` overrides, with `channel: "email"`.

This keeps the whole messaging system:

- **Channel-agnostic** at the orchestration level  
- **Provider-agnostic** at the email layer  
- **Tenant-scoped** at the Firestore level

---

# 7️⃣ Instructions for Cursor

1. Create the `EmailProvider` interface + types exactly as defined.  
2. Implement `SendGridEmailProvider` using the given structure, reading config from env vars.  
3. Add `getEmailProvider()` factory and ensure it’s reused (singleton).  
4. Add an `email` branch to the existing Messaging Orchestrator that:
   - Resolves email templates via the TemplateService
   - Renders them with `renderTemplate`
   - Logs to `/tenants/{tenantId}/messageLogs`
   - Sends via `EmailProvider.sendEmail()`
   - Updates log status based on the result
5. Keep all tenant + user references consistent with the Firestore collections spec.

---

# END OF DOCUMENT

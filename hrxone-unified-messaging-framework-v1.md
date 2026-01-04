# HRX One — Unified Messaging Framework  
Version: 1.0  
Owner: Product + Engineering  
Audience: Engineering (Cursor), Product, AI Systems  
Status: Draft — Implement + Iterate

---

## 🎯 Purpose

Define a **unified, compliant, multi-channel messaging system** for HRX One that:

- Supports **SMS (Twilio), Email, and Push Notifications**
- Honors **user notification preferences**
- Classifies messages into **strict categories**
- Supports **automated + human-triggered messages**
- Enables **two-way messaging with candidates**
- Leverages **AI responsibly**
- Scales globally + supports Spanish / multilingual
- Meets **A2P / carrier compliance requirements**
- Supports **recruiter-assigned phone numbers + web-based texting**
- Logs everything for **auditability + legal protection**

Cursor should **follow this framework** and **adapt existing code into it where appropriate**, not blindly rewrite everything.

---

# 1️⃣ Core Principles

1. **User-First & Compliant**
   - Explicit opt-in
   - Easy STOP / HELP
   - Clear message purpose
   - No shadow messaging or dark patterns

2. **Preference-Driven**
   - Users control SMS participation
   - Email is always attempted (for most flows)
   - Push follows mobile OS permissions and app settings

3. **Message Type Controls Channel**
   - Critical = ALL channels by default
   - Routine = Configurable
   - Marketing = Strict opt-in

4. **Template-First**
   - Structured templates per channel + language
   - AI can help generate content, but final rendered message is deterministic
   - The exact rendered text is logged

5. **Two-Way Safe Messaging**
   - Recruiters text from web UI via Twilio
   - Candidate can reply normally
   - AI assists with replies and classification but never ignores STOP/HELP/opt-out

6. **Multi-Language by Design**
   - Spanish supported from the beginning
   - System can store templates in multiple languages and use AI translation when needed

7. **Secure + Fully Logged**
   - All messages, consents, and key decisions are written to log collections
   - Logs are queryable for audits, disputes, and debugging

8. **Scalable + Modular**
   - Clear separation of concerns
   - Queue/Task-friendly
   - Retry logic is explicit, not ad hoc

---

# 2️⃣ System Components Overview

1. **Message Types Registry** (admin-configurable)
2. **User Notification Preferences** (per user)
3. **Consent & Compliance Layer** (SMS consent + STOP/HELP)
4. **Template Engine** (per type, channel, language)
5. **Routing & Delivery Orchestrator** (decides what gets sent where)
6. **Two-Way Messaging / Threads** (recruiter ↔ candidate chat)
7. **Automation Triggers** (profile reminders, shift confirmations, etc.)
8. **AI Assist Layer** (summaries, drafts, classification, translation)
9. **Logging & Analytics** (deliverability, volume, and behavior insights)
10. **Admin Controls** (config UI)

Cursor should map these concepts to the existing codebase and upgrade where necessary.

---

# 3️⃣ Messaging Types Registry

## 3.1 Concept

Instead of scattering message logic, define **Message Types** in a registry stored in Firestore or config.

Example structure:

```ts
type Channel = "sms" | "email" | "push";

interface MessageTypeConfig {
  id: string;                     // e.g. "shift_confirmation"
  label: string;                  // Human-readable
  category: "system" | "transactional" | "compliance" | "engagement" | "chat" | "marketing";
  defaultChannels: Channel[];     // e.g. ["sms","email","push"]
  critical: boolean;              // if true, should strongly attempt delivery
  allowReply: boolean;            // whether user can freely reply
  requiresExplicitSmsOptIn: boolean; // almost always true
  requiresTemplate: boolean;      // true for system / transactional / compliance
  aiAllowedToDraft: boolean;      // whether AI can propose content
  aiAllowedToAutoSend: boolean;   // ONLY for defined automation flows
}
```

## 3.2 Example Message Types

- `shift_confirmation`
- `shift_cancellation`
- `profile_incomplete_reminder`
- `background_check_reminder`
- `resume_upload_reminder`
- `recruiter_chat`
- `ai_outreach_nudge` (future)
- `system_alert` (password reset, security, etc.)

Admin UI should allow:

- Toggling **default channels** per type
- Marking message types as **critical** or not
- Setting whether replies are allowed
- (Future) Defining throttling/limits per type

---

# 4️⃣ User Notification Preferences

## 4.1 Data Model

```ts
interface NotificationPreferences {
  smsOptIn: boolean;        // true if user explicitly opted in
  smsBlockedSystem: boolean; // true if STOP applied (overrides smsOptIn)
  emailEnabled: boolean;    // currently default true; may allow disable later for some types
  pushEnabled: boolean;     // true if user wants push and has a token
  preferredLanguage: "en" | "es";  // extendable
  channelsAllowedPerType: {
    [messageTypeId: string]: {
      sms: boolean;
      email: boolean;
      push: boolean;
    };
  };
}
```

Preferences are stored under something like:  
`/users/{userId}/settings/notifications` or directly on the user doc.

## 4.2 Rules

- **Email** is always attempted when:
  - `emailEnabled === true`
  - The message type allows email

- **SMS** is sent only when:
  - `smsOptIn === true`
  - `smsBlockedSystem === false`
  - `channelsAllowedPerType[messageTypeId]?.sms !== false`

- **Push** is sent only when:
  - `pushEnabled === true`
  - A valid device token exists
  - The message type allows push

If all channels are disabled or blocked for a non-critical message, the system may log a “not-deliverable” entry but **must not override preferences**.

---

# 5️⃣ Message Routing Logic

## 5.1 High-Level Flow

1. **Trigger received** (event, recruiter action, automation, API)
2. **Classify message** → find `MessageTypeConfig`
3. **Resolve recipient preferences**
4. **Apply legal/compliance rules** (consent, quiet hours if implemented, etc.)
5. **Decide channels** (intersection of defaults + preferences + legal)
6. **Render templates** per channel and language
7. **Queue sends** to Twilio / email provider / push provider
8. **Record logs** (request + final status)
9. **AI follow-up** (summaries, suggested follow-ups, etc.)

## 5.2 Pseudo-code

```ts
function sendMessage({ userId, messageTypeId, context }) {
  const user = getUser(userId);
  const prefs = getNotificationPreferences(userId);
  const typeConfig = getMessageTypeConfig(messageTypeId);

  const channels = chooseChannels(typeConfig, prefs);

  if (channels.length === 0) {
    logNoDelivery({ userId, messageTypeId, reason: "No allowed channels" });
    return;
  }

  for (const channel of channels) {
    const template = resolveTemplate({
      messageTypeId,
      channel,
      language: prefs.preferredLanguage || "en",
    });

    const rendered = renderTemplate(template, context);

    queueSend({ channel, user, rendered, messageTypeId });
  }
}
```

`chooseChannels` should encapsulate all opt-in, opt-out, and legal rules.

---

# 6️⃣ Consent & Compliance Layer

## 6.1 SMS Consent Capture

Sources of consent:

1. **Signup Checkbox**  
   - Text clearly says user agrees to receive messages related to jobs, scheduling, onboarding, payroll, etc.
   - Not pre-checked.
   - Terms & Privacy linked.

2. **In-App Settings**  
   - User can toggle SMS on/off anytime.

3. **Re-Opt-In via Keyword**  
   - If user texts START (or similar allowed keyword), re-enable SMS.

All consent changes are recorded under something like:

```ts
interface SmsConsentRecord {
  agreed: boolean;
  source: "signup" | "settings" | "keyword";
  timestamp: Timestamp;
  termsVersion: string;   // optional reference to consent/terms doc
}
```

## 6.2 STOP / HELP Handling

The inbound SMS handler must:

1. Normalize body to upper-case, trim whitespace.
2. If it matches a STOP keyword:
   - Set `smsBlockedSystem = true` and `smsOptIn = false`.
   - Create a `SmsConsentRecord` with `agreed: false` and source `"keyword"`.
   - Send standard STOP confirmation message.
   - Add a system note to any active recruiter threads.

3. If it matches HELP:
   - Send standard HELP message with support contact.
   - Log the request.

STOP keywords to support:  
`STOP`, `STOPALL`, `UNSUBSCRIBE`, `CANCEL`, `END`, `QUIT`

(Exact list should follow Twilio best practices.)

---

# 7️⃣ Template Engine

## 7.1 Template Structure

```ts
interface MessageTemplate {
  id: string;
  messageTypeId: string;
  channel: Channel;
  language: "en" | "es";
  name: string;
  body: string;           // e.g. "Hi {{firstName}}, your shift at {{location}} starts at {{shiftStart}}."
  variables: string[];    // ["firstName","location","shiftStart"]
  includeStopFooter: boolean;  // if true and channel === "sms", append standard STOP text
  active: boolean;
  version: number;
  createdBy: string;      // userId or "system"
  updatedAt: Timestamp;
}
```

### Variable Convention

- Use `{{variableName}}` for placeholders.
- Backend validates that all required variables are provided in `context` before rendering.

## 7.2 Rendering Rules

1. Select template by `(messageTypeId, channel, language)`.
2. If not found in requested language:
   - Fall back to English **or** auto-translate (see Localization).

3. Interpolate variables; if any missing:
   - Log an error and do not send.

4. If `includeStopFooter` and channel is SMS:
   - Append standardized STOP/HELP line, e.g.:  
     `" Reply STOP to unsubscribe, HELP for help."`

5. Save the rendered text into `MessageLog` before sending.

## 7.3 Template Management UI

Admin should be able to:

- Create / edit / archive templates
- Duplicate a template (for A/B tests or language variants)
- Preview interpolation with sample data
- Mark a template as default per message type + channel + language

---

# 8️⃣ Two-Way Messaging (Recruiter ↔ Candidate)

## 8.1 Numbers & Identity

- Each recruiter has either:
  - A **dedicated Twilio number**, or
  - Is mapped to a number from a **shared pool** with clear assignment rules.

Fields for recruiter:

```ts
interface RecruiterMessagingProfile {
  recruiterId: string;
  twilioNumber: string;
  active: boolean;
}
```

## 8.2 Thread Model

```ts
interface MessageThread {
  id: string;
  candidateId: string;
  recruiterId: string | null;   // null for shared pool auto-assignment
  channel: "sms";
  createdAt: Timestamp;
  lastMessageAt: Timestamp;
  status: "open" | "snoozed" | "closed";
}

interface ChatMessage {
  id: string;
  threadId: string;
  fromType: "recruiter" | "candidate" | "system" | "ai";
  fromUserId?: string;          // recruiter or system actor
  direction: "inbound" | "outbound";
  body: string;
  language: "en" | "es" | null;
  createdAt: Timestamp;
  deliveryStatus?: "queued" | "sent" | "delivered" | "failed";
  failureReason?: string;
}
```

## 8.3 Inbound SMS Handling

- Look up number → thread → candidate.
- If no thread exists:
  - Create thread and assign recruiter (using simple routing rules initially, e.g., last recruiter who contacted them or round-robin).

- Detect:
  - STOP / HELP keywords (handled at Consent layer).
  - Simple “YES/NO” answers for flows like shift confirmations.
  - High-risk content (harassment, threats) → flag for review.

## 8.4 Recruiter UI Features

- Inbox with filters: open, mine, unassigned, etc.
- Conversation view with:
  - Message bubbles (who said what, when)
  - Candidate profile preview
  - AI suggested replies (one-click insert)
  - Language indicator + quick translate button

- Restrictions:
  - Prevent sending if candidate has SMS blocked.
  - Show banner if STOP received.

---

# 9️⃣ Automation & Semi-Automation

## 9.1 Trigger Types

- **Event-based** (e.g., application submitted, profile incomplete after X days, shift created, shift cancelled)
- **Recruiter-initiated** (button click like “Send profile reminder”)
- **Time-based** (scheduled reminders, check-ins)

## 9.2 Example Flows

### a) Profile Incomplete Reminder

**Trigger:**  
- User account older than 3 days AND profile missing required fields.

**Logic:**  
- Check user prefs.
- Use `profile_incomplete_reminder` message type.
- Default channels: push + email; SMS only if opted in.
- Message highlights what's missing and links directly to profile.

### b) Shift Confirmation

**Trigger:**  
- New confirmed shift added for candidate.

**Logic:**  
- Use `shift_confirmation` type (critical + transactional).
- Channels: SMS + Email + Push where allowed.
- SMS body (English example):  
  `"Hi {{firstName}}, you are confirmed for a shift at {{location}} on {{shiftDate}} from {{shiftStart}} to {{shiftEnd}}. Reply YES to confirm or NO if you cannot attend."`

**Inbound handling:**  
- YES → mark shift confirmed.  
- NO → mark as declined, notify recruiter, suggest replacement candidate list.

### c) Background Check / Drug Screen Reminder

- Use `background_check_reminder` type.
- Typically email + push, SMS only if opted in.
- Include clear CTA and contact info.

## 9.3 AI Role in Automation

AI can:

- Help determine best time of day (future feature).
- Suggest message tone variants (gentle vs urgent).
- Summarize candidate responses for recruiters.

AI should not:

- Create new automation flows on its own.
- Change message categories or legal text.

---

# 🔟 AI Assist Layer (Details)

## 10.1 AI Functions

1. **Draft Templates**
   - Product/ops enters intent + key facts.
   - AI generates first draft template in EN + ES.
   - Human reviews and approves.

2. **Suggest Replies**
   - For chat threads, recruiter can click “AI Suggest Reply”.
   - AI sees recent context and candidate message.
   - AI returns 2–3 short, compliant options.

3. **Classify Inbound Messages**
   - Detect if response is:
     - YES / NO / MAYBE / RESCHEDULE
     - STOP / HELP
     - Question for recruiter
   - Attach classification to message for automation triggers.

4. **Translate Messages**
   - If user prefers Spanish and recruiter writes English, AI produces Spanish version (and optionally shows English back-translation to recruiter).

5. **Summaries & Insights**
   - Summarize long threads for recruiters and admins.
   - Highlight risk signals or important candidate notes.

## 10.2 Safety & Guardrails

- AI outputs must be:
  - Short and professional for SMS.
  - Respectful and non-discriminatory.
  - Non-committal on pay/guarantees unless explicitly given data.

- System must NEVER send an AI-generated SMS automatically **unless**:
  - The flow is explicitly defined as such (e.g., standard YES-confimation acknowledgment).

---

# 1️⃣1️⃣ Localization & Spanish Support

## 11.1 Language Preference

User model should include:

```ts
preferredLanguage: "en" | "es" | null;
```

Defaults to `"en"` if not set.

## 11.2 Template Localization Strategy

- For all **high-volume or critical** message types, create both EN and ES templates.
- For ad-hoc recruiter messages:
  - Recruiter writes in their language.
  - AI translation is offered based on user preference.

## 11.3 Runtime Rules

When sending a message:

1. Use template with `language === preferredLanguage` if it exists.
2. Else fall back to English template and **optionally AI-translate** to the preferred language.
3. Store both:
   - `contentOriginal`
   - `contentSent` (after translation/footer).

This helps for audits and debugging.

---

# 1️⃣2️⃣ Logging & Analytics

## 12.1 Message Log

```ts
interface MessageLog {
  id: string;
  userId: string;
  threadId?: string;       // for chat
  messageTypeId: string;
  channel: Channel;
  direction: "outbound" | "inbound";
  fromIdentity: "system" | "recruiter" | "candidate" | "ai";
  body: string;
  bodyOriginal?: string;   // if translated
  language: "en" | "es" | null;
  status: "queued" | "sent" | "delivered" | "failed" | "not_sent";
  failureReason?: string;
  providerMessageId?: string;
  createdAt: Timestamp;
}
```

## 12.2 Consent & Preference Logs

- Every change to:
  - `smsOptIn`
  - `smsBlockedSystem`
  - `preferredLanguage`
  - `channelsAllowedPerType`
- Should create a `PreferenceChangeLog` entry with:
  - `oldValue`, `newValue`, `source`, `timestamp`, `changedBy`.

## 12.3 Analytics

Admin dashboards should expose:

- Delivery rates per channel and message type
- Opt-out rates over time
- Volume per recruiter / per customer
- Response rates (YES/NO, click-throughs where available)

---

# 1️⃣3️⃣ Admin Controls

Core pages to implement:

1. **Message Types Config**
   - List message types
   - Edit default channels, critical flag, reply allowed

2. **Templates Manager**
   - Filter by type, channel, language
   - Edit and version templates
   - Preview messages with sample data

3. **Messaging Settings**
   - Global flags (enable SMS, max daily volume, quiet hours, etc.)
   - Twilio configuration (per environment)

4. **Reports**
   - Deliverability metrics
   - Opt-out trends
   - Usage by customer

5. **Recruiter Messaging Profile**
   - Assign or change Twilio numbers
   - Enable/disable messaging for recruiter

---

# 1️⃣4️⃣ Security & Privacy

- Only authorized roles can:
  - View candidate phone numbers
  - Send messages
  - View whole message history

- Logs containing PII must be:
  - Properly secured with Firestore rules
  - Accessible only to appropriate roles

- Any exports (e.g. reports) should avoid full phone numbers unless necessary.

---

# 1️⃣5️⃣ Data Model Sketch (Non-Binding)

Collections (names are examples):

- `/users/{id}`
- `/users/{id}/notificationSettings/default`
- `/users/{id}/smsConsentHistory/{consentId}`
- `/messageTypes/{id}`
- `/messageTemplates/{id}`
- `/messageThreads/{threadId}`
- `/messageLogs/{messageId}`

Cursor should **reuse and adapt** the closest existing structures rather than replacing them outright.

---

# 1️⃣6️⃣ Implementation Guidance for Cursor

1. **Do not start from scratch.**  
   - Inspect existing messaging-related code (Twilio, email, push, and any partial preference or template system).  
   - Map each part of this spec onto what already exists.

2. **Introduce a clear service layer**, e.g.:
   - `MessagingService`
   - `ConsentService`
   - `TemplateService`
   - `RecruiterChatService`

3. **Centralize outbound sends** through a single orchestrator so that:
   - Every message passes through consent checks
   - All messages are logged consistently

4. **Add type-safe models** (TypeScript interfaces / zod schemas) for:
   - `MessageTypeConfig`
   - `NotificationPreferences`
   - `MessageTemplate`
   - `MessageLog`
   - `MessageThread`

5. **Document decisions in comments** where you deviate from this spec because of legacy code or technical constraints.

6. **Prepare for Spanish support now** by:
   - Including `language` fields
   - Designing template keys that are not language-specific

7. **Wire AI usage through well-defined functions**, e.g.:
   - `generateTemplateDraft(...)`
   - `suggestRepliesForThread(...)`
   - `classifyInboundMessage(...)`
   - `translateMessage(...)`

8. **Keep compliance text centralized**, e.g. STOP/HELP footers, so that legal copy can be updated in one place.

---

# 1️⃣7️⃣ Open Questions (for Product / Legal)

These must be answered before finalizing implementation details:

1. Should SMS opt-out also disable **push** and/or **email** in any cases?  
2. Do we need **quiet hours** rules (e.g., no SMS after 9pm local time)?  
3. Are there any **pure marketing** campaigns, or is everything employment-related?  
4. Which email provider is standard (SendGrid, Mailgun, etc.)?  
5. Should recruiters have **dedicated numbers**, or is a shared pool acceptable per market?  
6. Should AI-generated messages ever be sent automatically without human review outside narrowly defined flows?  
7. Are there jurisdictions (states/countries) we need to **special-case** in messaging rules?  

Until clarified, the system should err on the side of **stricter consent and fewer automated sends**.

---

# END OF DOCUMENT

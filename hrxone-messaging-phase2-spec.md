# HRX One — Messaging Phase 2 Spec  
Template Engine, Two-Way Messaging, Automation, and AI Assist  
Version: 1.0  
Status: IMPLEMENT NEXT  
Depends on: Unified Messaging Framework v1 (implemented foundation)

---

## 0. Goal of this Phase

Build on the existing foundation (message types, routing orchestrator, logging, STOP/HELP handling) to deliver:

1. A **full Template Engine** for SMS, Email, and Push, with localization.
2. A **Two-Way Messaging system** for recruiter ↔ candidate SMS chat.
3. An initial **Automation layer** (profile reminders, shift confirmations).
4. A structured **AI Assist layer** (reply suggestions, translation, classification).

This spec assumes the following are already implemented and stable:

- `MessageTypesRegistry`
- `Messaging Orchestrator` / central send function
- `Logging & Analytics` base
- `STOP/HELP/START keyword handling`
- `NotificationPreferences` + `smsBlockedSystem` logic

Cursor should **extend the current implementation** following this spec, not replace it.

---

# 1️⃣ Template Engine

## 1.1 Objectives

- Move all system / transactional / compliance / automation messages into templates.
- Support **per-channel** and **per-language** variants.
- Ensure templates are **type-safe**, **variable-validated**, and **loggable**.
- Prepare for non-technical users to manage templates via an admin UI.

## 1.2 Data Model

Use a collection like `/messageTemplates` or equivalent.

```ts
export type Channel = "sms" | "email" | "push";
export type LanguageCode = "en" | "es"; // extendable

export interface MessageTemplate {
  id: string;                    // generated id
  messageTypeId: string;         // FK into MessageTypesRegistry
  channel: Channel;
  language: LanguageCode;
  name: string;                  // human readable, e.g., "Shift Confirmation (EN/SMS)"
  body: string;                  // "Hi {{firstName}}, your shift at {{location}}..."
  variables: string[];           // ["firstName","location","shiftStart","shiftEnd"]
  includeStopFooter: boolean;    // for SMS: auto-append STOP/HELP
  active: boolean;
  version: number;
  createdBy: string;             // userId or "system"
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

Notes:

- `messageTypeId + channel + language + active` should be unique for the *default* template combination.
- Support multiple inactive/older templates for A/B or history.

## 1.3 STOP/HELP Footer Handling

Define a single config (env or Firestore doc) for reusable SMS footer text, e.g.:

```ts
export interface SmsFooterConfig {
  stopText: string; // "Reply STOP to unsubscribe, HELP for help."
}
```

When `includeStopFooter === true` and channel is `"sms"`:

- Append `" " + stopText` to rendered body **if not already present**.
- Enforce max SMS length logic if necessary (truncate gracefully, prioritized content first).

## 1.4 Template Resolution

Create a `TemplateService` (or similar) with:

```ts
getTemplate({
  messageTypeId,
  channel,
  language,        // user preferred language if available
}): Promise<MessageTemplate | null>;
```

Resolution order:

1. Exact match: `(messageTypeId, channel, preferredLanguage)`.
2. Fallback 1: `(messageTypeId, channel, "en")`.
3. Fallback 2 (optional): Use AI translation of EN template into preferred language at runtime.

If no template is found, the Messaging Orchestrator should:

- Log a structured error: `missing_template` with `messageTypeId`, `channel`, and `language`.
- NOT send the message unless message type is marked `critical`. For a critical type, you may fallback to a very simple hard-coded failsafe message and log prominently.

## 1.5 Template Rendering

Create a small, deterministic renderer (no external dependency required, but you can use a tiny mustache-style library if already present).

```ts
renderTemplate(template: MessageTemplate, context: Record<string, any>): string
```

Rules:

1. Verify that all `template.variables` exist in `context` and are non-null.
   - If a required variable is missing → log & do not send.
2. Support simple filters only if needed (e.g., date formatting) via utility functions, not inside template syntax.
3. Produce final `contentSent` string.
4. If `includeStopFooter && channel === "sms"` → append footer.

## 1.6 Orchestrator Integration

Update the central send function so that instead of building text inline, it:

1. Resolves template via `TemplateService.getTemplate(...)`.
2. Calls `renderTemplate` with `context`.
3. Writes `contentOriginal` (pre-translation, pre-footer if you want) and `contentSent` to `MessageLog`.
4. For email:
   - Later we may support `subject`/`html` fields in templates; for now, start with `body` as text or HTML blob.

Pseudo-code:

```ts
async function sendMessage({ userId, messageTypeId, context }) {
  const user = await getUser(userId);
  const prefs = await getNotificationPreferences(userId);
  const typeConfig = getMessageTypeConfig(messageTypeId);

  const channels = chooseChannels(typeConfig, prefs);
  if (!channels.length) { /* log & exit */ }

  for (const channel of channels) {
    const template = await templateService.getTemplate({
      messageTypeId,
      channel,
      language: prefs.preferredLanguage ?? "en",
    });
    if (!template) { /* log missing template & continue */ }

    const rendered = renderTemplate(template, context);

    const logEntry = await logOutboundMessage({
      userId,
      messageTypeId,
      channel,
      body: rendered,
      language: prefs.preferredLanguage ?? "en",
      fromIdentity: "system",
    });

    queueSendToProvider({ channel, user, rendered, messageTypeId, logId: logEntry.id });
  }
}
```

## 1.7 Admin UI Sketch

In the admin panel, add a **Templates** section:

- List view:
  - Filters: messageTypeId, channel, language, active/inactive
  - Columns: name, type, channel, language, active, version, updatedAt
- Detail view:
  - Edit `name`, `body`, `includeStopFooter`, `variables` (auto-detected or manually set)
  - Preview with sample data
  - Toggle `active`

Cursor can build a basic CRUD UI first; later we can polish it.

---

# 2️⃣ Two-Way Messaging (Recruiter ↔ Candidate)

## 2.1 Objectives

- Allow recruiters to send/receive SMS from inside the web app.
- Tie SMS to candidates and deals/job orders.
- Respect STOP/HELP/START and notification preferences.
- Provide a usable inbox-style interface.

## 2.2 Data Model (Align to Existing Structures)

If you already have partial models, adapt this shape to them.

```ts
export interface SmsThread {
  id: string;
  candidateId: string;
  primaryRecruiterId: string | null;
  twilioNumber: string;       // number used for outbound messages
  candidatePhone: string;
  status: "open" | "snoozed" | "closed";
  lastMessageAt: Timestamp;
  createdAt: Timestamp;
}

export interface SmsMessage {
  id: string;
  threadId: string;
  direction: "inbound" | "outbound";
  fromType: "candidate" | "recruiter" | "system" | "ai";
  fromUserId?: string;         // recruiter id, or null for candidate/system
  body: string;
  language: LanguageCode | null;
  providerMessageId?: string;
  status: "queued" | "sent" | "delivered" | "failed" | "not_sent";
  createdAt: Timestamp;
}
```

You can store these in:

- `/smsThreads/{threadId}`
- `/smsThreads/{threadId}/messages/{messageId}`

or a flat `/smsMessages` collection with a `threadId` field, depending on current Firestore structure.

## 2.3 Twilio Webhook Flow

Existing `inboundSmsWebhook.ts` can be extended to:

1. **Locate or create thread**:
   - Find candidate by phone number.
   - Find existing open thread for `(candidateId, twilioNumber)`.
   - If none, create a new thread and assign `primaryRecruiterId`:
     - Simple version: last recruiter who contacted the candidate or a default routing rule.
2. **Create `SmsMessage` with direction = "inbound".**
3. **Classify message**:
   - If STOP/HELP/START → handled by existing handler (already implemented).
   - Else pass to AI classifier (see Section 4) to tag type: `yes`, `no`, `question`, `other`.
4. **Update thread.lastMessageAt`.**
5. Optionally notify recruiter (UI badge or email/push).

## 2.4 Outbound SMS from Recruiter

API handler, e.g. `POST /api/messaging/sms/send`:

Inputs:

- `threadId`
- `recruiterId`
- `body`

Flow:

1. Verify recruiter has permission to message this candidate.
2. Load thread (and candidate preferences).
3. Check that SMS allowed (smsOptIn && !smsBlockedSystem).
4. Create `SmsMessage` with `direction: "outbound"`, `fromType: "recruiter"`.
5. Use central `queueSendToProvider` to send via Twilio.
6. Update status as Twilio callbacks come in.

## 2.5 Recruiter UI

Initial implementation can be simple:

- **Inbox View**
  - List of threads with:
    - candidate name
    - last message snippet
    - lastMessageAt
    - status (open/snoozed/closed)
  - Filters: `status`, `assigned to me`, `unassigned` (if you add assignment).

- **Thread View**
  - Conversation bubbles (candidate vs recruiter).
  - Message timestamps.
  - Candidate header: name, phone, key attributes (role, location).
  - Text input box to send message.
  - Button: “AI Suggest Reply” (integrate later).
  - Visual indicator if SMS is blocked or opt-out is in effect.

## 2.6 Edge Cases

- If recruiter tries to message a candidate who is SMS-blocked:
  - Prevent send.
  - Show banner: “This candidate has opted out of SMS. You cannot send messages.”

- If candidate replies in another language:
  - Show “Translate” button (calls AI translation).

- If multiple recruiters contact the same candidate:
  - Decide whether:
    - They share one thread, or
    - Each gets their own thread per recruiter.
  - For simplicity, start with **one primary recruiter per candidate/thread**.

---

# 3️⃣ Automation Layer (First Pass)

## 3.1 Architecture

Implement an `AutomationService` which can be called from Cloud Functions / CRON / backend schedulers.

Responsibilities:

- Evaluate conditions (profile incomplete, upcoming shift, missed shift, etc.).
- Emit **high-level intents**, e.g., `sendMessage("profile_incomplete_reminder", userId, context)`.
- Reuse existing routing + templates for actual messaging.

## 3.2 Initial Automations

### 3.2.1 Profile Incomplete Reminder

Condition:

- `daysSinceAccountCreated >= N` (e.g., 3)
- AND required fields missing.
- AND user has not received this reminder in the last X days.

Action:

- Message Type: `profile_incomplete_reminder`
- Channels: email + push; SMS only if opted in.
- Context: `{ firstName, missingFields, profileUrl }`

### 3.2.2 Shift Confirmation Messages

Use `shift_confirmation` type.

Flows:

- On shift creation/assignment → send initial confirmation request.
- On YES reply:
  - Update shift status.
  - (Optional) send confirmation receipt template.
- On NO reply:
  - Mark declined.
  - Notify recruiter (system message + UI notification).

## 3.3 Implementation Notes

- Automations should be idempotent (log last-run or last-sent-per-user-per-type).
- Use Firestore or a small `automationRuns` collection to avoid duplicates.
- All automation sends go through central routing.

---

# 4️⃣ AI Assist Layer (First Pass)

## 4.1 AI Functions to Implement Now

1. **Inbound Classification**
   - Input: recent message text (from candidate).
   - Output: label enum, e.g.: `"YES" | "NO" | "QUESTION" | "STOP" | "HELP" | "OTHER"`.
   - Used to trigger automations (e.g. shift confirmation).

2. **Suggested Replies for Recruiters**
   - UI button in thread view: “AI Suggest Reply”.
   - Input: last N messages in the thread + candidate profile context + intent (optional).
   - Output: 2–3 short, ready-to-send replies.

3. **Translation**
   - Helper function:
     ```ts
     translateMessage(body, fromLang, toLang): Promise<{ translated: string }>
     ```
   - Used when recruiter and candidate languages differ.

## 4.2 Safety Rules

- AI suggestions are **drafts only**; recruiter must click “Send”.
- No automatic pay promises or commitments unless given structured inputs (e.g., wage range).
- Classifier output for STOP/HELP is **secondary**; primary STOP/HELP logic remains keyword-based as already implemented.

---

# 5️⃣ Prioritized Implementation Order (Within this Spec)

1. **Template Engine core (Section 1.2–1.6)**  
   - Data model, resolver, renderer, orchestrator integration.  
   - Migrate a few key message types (e.g., shift_confirmation, profile_incomplete_reminder).

2. **Two-Way Messaging core (Section 2.2–2.4)**  
   - Thread/message models, webhook integration, outbound send from recruiter UI.

3. **Basic Automation flows (Section 3.2)**  
   - Profile reminders + shift confirmations.

4. **AI Assist basics (Section 4.1)**  
   - Inbound classification + suggested replies + translation helper.

5. **Admin Template UI (Section 1.7) & Messaging Inbox UI polish (Section 2.5)**  
   - Once backend is working, build UIs to manage templates and conversations.

---

# 6️⃣ Notes for Cursor

- Reuse existing configuration, logging, and routing services whenever possible.
- When this spec conflicts with current implementation, prefer:
  - **Backward-compatible additions** over breaking changes.
  - Clear wrappers/adapters over deeply invasive rewrites.
- Add comments in new code referencing this file and the section implemented, e.g.:
  ```ts
  // Implements: HRX One Messaging Phase 2 Spec — Section 1.5 Template Rendering
  ```
- For any ambiguity (e.g., thread assignment rules, collection naming), choose a sensible default, implement, and document your decision inline.

---

# END OF SPEC

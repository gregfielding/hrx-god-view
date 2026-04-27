# HRX Semi‑Programmatic SMS Messaging Service (Inventory + Next Steps Spec)
**Owner:** Greg Fielding  
**Primary SMS Number:** **(888) 805‑8650** (Twilio Toll‑Free — Approved ✅)  
**Goal:** Support *automated + semi‑automated* outbound texts via templates **and** a shared-team Inbox at `/text-messages` for human replies—built now with an architecture that can later add **AI co‑pilot / auto‑reply / suggested responses** safely.

---

## 0) What Cursor should do first (Inventory / Gap Assessment)
Before building anything new, **Cursor should audit the repo and report back** in a short checklist with file paths and what each piece does.

### 0.1 Inventory questions (answer with paths + notes)
1. **Twilio integration status**
   - Do we already have: Twilio webhook endpoint(s) for inbound SMS?
   - Do we already have: outbound send function(s) for SMS?
   - Is the project using a **Messaging Service SID** or a **From number** directly?
   - Where are Twilio credentials stored (Firebase config / Secret Manager / env)?

2. **Data model / storage**
   - Is there a Firestore collection for:
     - `sms_messages` (individual message records)
     - `sms_threads` (conversation threads)
     - `sms_participants` or recipient mapping
     - `sms_templates`
     - `recruiter_numbers` or number assignments
   - If yes, list schema fields, indexes, and security rules.

3. **UI**
   - Does `/text-messages` already exist? If yes:
     - Thread list + message pane?
     - Search/filter?
     - “Send message” composer?
     - Attachments/media?
   - Does the **Settings → Templates** page work end‑to‑end (create/edit/delete)?

4. **Consent & compliance**
   - Where is SMS consent stored (e.g., user profile / applicant record)?
   - Do we log opt‑in timestamp + source + text shown?
   - STOP/HELP handling implemented? If yes, where and how?

5. **Queueing / retries / rate limiting**
   - Are outbound sends done synchronously or via Cloud Tasks?
   - Do we have idempotency keys to prevent duplicates?
   - Any throttling per recipient / per tenant / per minute?

6. **Future AI hooks**
   - Any “AI suggestion” stubs, logs, or message classification already in place?

### 0.2 Deliverable from Cursor
A single message back in chat titled **“SMS Inventory Report”** with:
- ✅ Existing components found (with file paths)
- ❌ Missing components
- ⚠️ Risks/bugs spotted (auth, rules, compliance, duplication)
- Recommended next 3 implementation steps

---

## 1) Product Definition (What we’re building)
### 1.1 Modes
1. **Programmatic / Automated**
   - Triggered from events (application received, interview scheduled, shift reminder, onboarding, payroll alert, security/verification)
   - Uses template variables (`{{firstName}}`, `{{jobTitle}}`, etc.)
   - Sends from the **main number (888‑805‑8650)** or (future) region/rep number based on assignment rules.

2. **Semi‑Programmatic**
   - Same as above, but requires **review/approval** (e.g., “Send to 32 workers tomorrow at 9am”)

3. **Human Inbox**
   - Team members can reply to incoming messages at `/text-messages`
   - Shared threads, read/unread, assignments, internal notes (optional)
   - Audit trail of who sent what and when

4. **AI‑Assisted (Phase 2/3)**
   - Draft suggested replies
   - Summarize thread
   - Detect intent (STOP/HELP, schedule change, issue escalation)
   - Recommend next action (create task, call, reschedule)
   - **Never auto‑send** without explicit “AI allowed” toggle + policy gates

---

## 2) Architecture Overview
### 2.1 Inbound SMS (Twilio → HRX)
- Twilio webhook receives inbound message events.
- Verify Twilio signature.
- Normalize payload to our internal `SmsMessage` model.
- Create/update `SmsThread` for the sender.
- Store the message in `sms_messages` (or subcollection).
- Apply compliance logic:
  - If inbound body contains STOP keywords → mark thread/recipient as opted-out and confirm with Twilio compliant reply.
  - If HELP → respond with help text.

### 2.2 Outbound SMS (HRX → Twilio)
- UI (or triggers) creates a `SmsSendRequest` record.
- Cloud Function/Task processes request:
  - Validates consent + eligibility + quiet hours
  - Renders template with variables
  - Sends via Twilio API
  - Records send result (SID, status)
  - Writes `sms_messages` entry in the thread

### 2.3 Read Status / Assignment
- Store read pointers per user:
  - `sms_thread_reads/{threadId}_{userId}` with `lastReadAt`
- Optional assignment:
  - `assignedToUserId` on thread
  - Inbox filters: Mine / Unassigned / All

---

## 3) Firestore Data Model (Proposed)
> Cursor: adapt to existing schemas if already present; do not duplicate.

### 3.1 Threads
Collection: `sms_threads`
```ts
export type SmsThread = {
  id: string;

  participantType: 'applicant' | 'worker' | 'crm_contact' | 'unknown';
  participantId?: string;
  phoneE164: string;
  displayName?: string;
  companyId?: string;
  dealId?: string;
  locationId?: string;

  lastMessageAt: FirebaseTimestamp;
  lastMessagePreview: string;
  assignedToUserId?: string;
  status: 'open' | 'closed' | 'needs_attention';

  optedOut: boolean;
  optedOutAt?: FirebaseTimestamp;
  consentStatus: 'unknown' | 'consented' | 'not_consented' | 'opted_out';
  consentSource?: 'signup_checkbox' | 'admin_import' | 'manual';
  consentedAt?: FirebaseTimestamp;

  tenantId: string;

  createdAt: FirebaseTimestamp;
  updatedAt: FirebaseTimestamp;
};
```

### 3.2 Messages
Option A: subcollection `sms_threads/{threadId}/messages/{messageId}`  
Option B: top-level `sms_messages` with `threadId` (easier for feed/search)

```ts
export type SmsMessage = {
  id: string;
  tenantId: string;
  threadId: string;

  direction: 'inbound' | 'outbound';
  body: string;
  bodyNormalized?: string;

  sentByUserId?: string;
  sentByName?: string;

  twilioMessageSid?: string;
  twilioStatus?: 'queued' | 'sent' | 'delivered' | 'undelivered' | 'failed';
  fromE164: string;
  toE164: string;

  templateId?: string;
  templateVersion?: number;
  variables?: Record<string, string>;

  aiSuggested?: boolean;
  aiDraftId?: string;
  aiAnnotations?: {
    intent?: string;
    sentiment?: 'pos'|'neutral'|'neg';
    riskFlags?: string[];
    summary?: string;
  };

  createdAt: FirebaseTimestamp;
};
```

### 3.3 Templates
Collection: `sms_templates`
```ts
export type SmsTemplate = {
  id: string;
  tenantId: string;

  name: string;
  category: 'application'|'interview'|'onboarding'|'shift'|'payroll'|'security'|'general';
  body: string;
  variables: string[];
  enabled: boolean;

  autoAppendOptOutFooter: boolean;

  version: number;
  createdAt: FirebaseTimestamp;
  updatedAt: FirebaseTimestamp;
};
```

### 3.4 Send Requests (recommended)
Collection: `sms_send_requests`
```ts
export type SmsSendRequest = {
  id: string;
  tenantId: string;

  threadId?: string;
  recipientE164: string;
  templateId?: string;
  body?: string;
  variables?: Record<string,string>;

  mode: 'automated'|'review_required'|'manual';
  scheduledFor?: FirebaseTimestamp;
  createdByUserId: string;

  status: 'pending'|'approved'|'sending'|'sent'|'failed'|'canceled';
  error?: string;

  createdAt: FirebaseTimestamp;
  updatedAt: FirebaseTimestamp;
};
```

---

## 4) UI Module Outline
### 4.1 `/settings/templates`
Tabs:
- **SMS Templates**
  - List: category, enabled toggle, last updated
  - Create/Edit:
    - Name, category, body
    - Variable helper (autocomplete insert `{{firstName}}`)
    - Live preview with sample values
    - Character count + segment estimate (GSM vs Unicode)
- **Email Templates** (existing/placeholder)
- **Recruiter Numbers** (future)

### 4.2 `/text-messages` (Shared Inbox)
Layout:
- Left: thread list + search + filters (Mine/Unassigned/All, Open/Closed)
- Middle: message pane (chat bubbles)
- Right (optional): context panel (linked contact/worker/deal + quick actions)

Composer:
- Free text
- Optional template picker
- Variable insert when template used
- Send → logs outbound + Twilio send
- Phase 2: AI suggest reply / summarize

---

## 5) Compliance & Safety Requirements
1. **No marketing SMS** unless separately registered.
2. **Consent gating** for outbound:
   - Only send if `consentStatus === 'consented'` and not opted-out
3. **STOP/HELP**
   - STOP → mark opted-out + suppress future sends
   - HELP → return help instructions
4. **Quiet hours** (default 8am–8pm local time)
5. **Audit trail** (who sent what)
6. **Footer policy**: include “Reply STOP to opt out.” where appropriate

---

## 6) API Endpoints / Cloud Functions (Proposed)
### 6.1 Inbound webhook
- `POST /twilio/inboundSms`
  - Verify signature
  - Parse payload (From/To/Body/MessageSid)
  - Upsert thread, write message
  - STOP/HELP routing
  - Idempotency by `MessageSid`

### 6.2 Outbound send
- `callable: smsSendMessage`
  - input: `{ tenantId, threadId?, recipientE164?, body?, templateId?, variables?, mode?, scheduledFor? }`
  - checks: auth, permissions, consent, optedOut
  - create request or send directly

### 6.3 Inbox helpers
- `callable: smsListThreads`
- `callable: smsListMessages`
- `callable: smsMarkThreadRead`
- `callable: smsAssignThread`

### 6.4 AI (Phase 2+)
- `callable: smsSuggestReply`
- `callable: smsSummarizeThread`

---

## 7) Security Rules (High level)
- Only internal users (securityLevel 5–7) can read/write `sms_*` collections for their `tenantId`
- Sending requires `canSendSms === true` (role flag)
- Block access to opted-out phone numbers for outbound send

---

## 8) Template Builder Upgrades (Recommended)
- Variable catalog by context (worker/applicant/contact/deal)
- Autocomplete insert + validate variables
- Preview with sample values + missing-variable warnings
- Segment counter + Unicode detection
- Versioning + “last used” metadata

---

## 9) Suggested Build Order
1. Inventory report
2. Inbound webhook + threads/messages storage
3. Outbound send w/ consent + STOP/HELP
4. `/text-messages` inbox MVP
5. Template builder upgrades
6. Thread assignment + read/unread
7. Dashboard feed integration
8. AI suggestions + toggles + logs

---

## 10) MVP Acceptance Criteria
- Inbound SMS creates thread + message
- Team can view + reply at `/text-messages`
- STOP opt-out blocks future sends and is recorded
- Template send works and logs template + variables used
- Security rules prevent non-internal users from accessing inbox

---

## 11) Notes for Cursor
- Do **not** try to “game” Twilio compliance with UI tricks.
- Implement durable consent logging and opt-out handling.
- Keep Twilio secrets in **Secret Manager** where possible.
- Use idempotency guards to avoid duplicate threads/messages.

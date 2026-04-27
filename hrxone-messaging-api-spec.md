# HRX One – Messaging & Automation API Route Signatures  
Version: 1.0  
Owner: Backend / Platform  
Depends on:  
- Unified Messaging Framework v1  
- Messaging Phase 2 Spec (Templates, Two-Way, Automation, AI)  

> NOTE FOR CURSOR:  
> These are **route signatures and payload shapes**, not a rigid implementation.  
> Prefer aligning paths and naming with existing conventions where possible, but keep the structure and intent of each endpoint.

---

## 0. General Conventions

- All routes are **JSON over HTTPS**.
- Auth: existing JWT/session mechanism (e.g., Firebase auth or custom) enforced via middleware.
- All `POST`/`PATCH` routes return either:
  - `200` with `{ success: true, data: ... }`, or  
  - `4xx/5xx` with `{ success: false, error: { code, message, details? } }`.
- Internal/cron routes should be **protected** (e.g., secret header, service account, or restricted network).

TypeScript helper types used in this spec:

```ts
type UUID = string;

type Channel = "sms" | "email" | "push";
type LanguageCode = "en" | "es";

interface PaginationQuery {
  page?: number;       // 1-based
  pageSize?: number;   // default 20–50 depending on route
}
```

---

# 1️⃣ Messaging – High-Level Send API

These routes expose the central Messaging Orchestrator to the rest of the app.

## 1.1 POST `/api/messaging/send`

**Purpose:**  
Generic, type-based message send. This should be the **preferred entry point** for backoffice UI and business logic (except webhooks and recruiter chat, which have dedicated routes).

**Request Body:**

```ts
interface SendMessageRequest {
  userId: string;                 // recipient user
  messageTypeId: string;          // must exist in MessageTypesRegistry
  context: Record<string, any>;   // data for template interpolation
  overrideChannels?: Channel[];   // optional: override default channel selection
  // Optional: for multi-tenant routing
  customerId?: string;
  agencyId?: string;
}
```

**Response:**

```ts
interface SendMessageResponse {
  success: boolean;
  dispatchedChannels: Channel[];   // channels actually attempted
  messageLogIds: string[];         // MessageLog IDs per channel
  warnings?: string[];             // e.g., "No SMS due to opt-out"
}
```

Notes:

- Implementation should delegate directly to the central orchestrator (`MessagingService.send(...)`).
- Orchestrator handles preferences, consent, templates, logging, and provider dispatch.

---

## 1.2 POST `/api/messaging/test-render`

**Purpose:**  
Render (but do not send) a template for preview/testing. Used from admin UI when editing templates, or debugging context.

**Request Body:**

```ts
interface TestRenderRequest {
  messageTypeId: string;
  channel: Channel;
  language: LanguageCode;
  context: Record<string, any>;
}
```

**Response:**

```ts
interface TestRenderResponse {
  success: boolean;
  renderedBody?: string;
  templateId?: string;
  variablesMissing?: string[];
}
```

---

# 2️⃣ Templates – Admin CRUD

These routes manage `MessageTemplate` records as defined in the Phase 2 spec.

## 2.1 GET `/api/messaging/templates`

**Purpose:**  
List templates with filtering & pagination for admin UI.

**Query Params:**

```ts
interface ListTemplatesQuery extends PaginationQuery {
  messageTypeId?: string;
  channel?: Channel;
  language?: LanguageCode;
  active?: boolean;
}
```

**Response:**

```ts
interface ListTemplatesResponse {
  success: boolean;
  data: MessageTemplate[];
  page: number;
  pageSize: number;
  total: number;
}
```

> `MessageTemplate` should match the interface defined in the Phase 2 spec.

---

## 2.2 GET `/api/messaging/templates/:id`

**Purpose:**  
Fetch a single template by ID.

**Response:**

```ts
interface GetTemplateResponse {
  success: boolean;
  data?: MessageTemplate;
}
```

---

## 2.3 POST `/api/messaging/templates`

**Purpose:**  
Create a new template.

**Request Body:**

```ts
interface CreateTemplateRequest {
  messageTypeId: string;
  channel: Channel;
  language: LanguageCode;
  name: string;
  body: string;
  variables?: string[];         // optional; backend may auto-detect
  includeStopFooter?: boolean;  // default false
  active?: boolean;             // default true
}
```

**Response:**

```ts
interface CreateTemplateResponse {
  success: boolean;
  data?: MessageTemplate;
}
```

---

## 2.4 PATCH `/api/messaging/templates/:id`

**Purpose:**  
Update an existing template (partial updates).

**Request Body (partial):**

```ts
type UpdateTemplateRequest = Partial<{
  name: string;
  body: string;
  variables: string[];
  includeStopFooter: boolean;
  active: boolean;
}>;
```

**Response:**

```ts
interface UpdateTemplateResponse {
  success: boolean;
  data?: MessageTemplate;
}
```

---

## 2.5 DELETE `/api/messaging/templates/:id`

**Purpose:**  
Soft-delete or archive a template (implementation choice).

**Response:**

```ts
interface DeleteTemplateResponse {
  success: boolean;
}
```

---

## 2.6 GET `/api/messaging/types`

**Purpose:**  
Expose the MessageTypes Registry to the frontend/admin.

**Response:**

```ts
interface MessageTypeConfig {
  id: string;
  label: string;
  category: "system" | "transactional" | "compliance" | "engagement" | "chat" | "marketing";
  defaultChannels: Channel[];
  critical: boolean;
  allowReply: boolean;
  requiresExplicitSmsOptIn: boolean;
  requiresTemplate: boolean;
  aiAllowedToDraft: boolean;
  aiAllowedToAutoSend: boolean;
}

interface ListMessageTypesResponse {
  success: boolean;
  data: MessageTypeConfig[];
}
```

---

# 3️⃣ Two-Way Messaging – Threads & Messages

These routes power recruiter ↔ candidate SMS chat in the web app.

## 3.1 GET `/api/messaging/threads`

**Purpose:**  
List SMS threads for a recruiter (inbox view).

**Query Params:**

```ts
interface ListThreadsQuery extends PaginationQuery {
  status?: "open" | "snoozed" | "closed";
  assignedToMeOnly?: boolean;      // true -> restrict to current recruiter
  search?: string;                 // candidate name / phone / role, etc.
}
```

**Response:**

```ts
interface SmsThreadSummary {
  id: string;
  candidateId: string;
  candidateName: string;
  candidatePhoneMasked: string;
  primaryRecruiterId: string | null;
  lastMessageSnippet: string;
  lastMessageAt: string; // ISO
  status: "open" | "snoozed" | "closed";
  unreadCount: number;
}

interface ListThreadsResponse {
  success: boolean;
  data: SmsThreadSummary[];
  page: number;
  pageSize: number;
  total: number;
}
```

---

## 3.2 GET `/api/messaging/threads/:threadId`

**Purpose:**  
Fetch full details and recent messages for a thread.

**Query Params (optional):**

- `limit` (default 50)
- `before` (messageId or timestamp for pagination)

**Response:**

```ts
interface SmsThreadDetails extends SmsThreadSummary {
  twilioNumber: string;
}

interface SmsMessageDTO {
  id: string;
  threadId: string;
  direction: "inbound" | "outbound";
  fromType: "candidate" | "recruiter" | "system" | "ai";
  fromUserId?: string;
  body: string;
  language: LanguageCode | null;
  status: "queued" | "sent" | "delivered" | "failed" | "not_sent";
  createdAt: string;      // ISO
}

interface GetThreadResponse {
  success: boolean;
  thread?: SmsThreadDetails;
  messages: SmsMessageDTO[];
}
```

---

## 3.3 POST `/api/messaging/threads/:threadId/messages`

**Purpose:**  
Send a recruiter message in an existing thread.

**Request Body:**

```ts
interface SendThreadMessageRequest {
  body: string;
  // optional – for "send as another recruiter" or system actions
  fromUserId?: string;  
}
```

**Response:**

```ts
interface SendThreadMessageResponse {
  success: boolean;
  message?: SmsMessageDTO;
  warning?: string; // e.g., "SMS blocked due to STOP"
}
```

Behavior:

- Enforce permissions: calling recruiter must be allowed to message this candidate.
- Respect `smsOptIn` + `smsBlockedSystem` before sending.
- Use existing orchestrator → Twilio for sending.
- Write to message log collections.

---

## 3.4 POST `/api/messaging/threads` (optional / future)

**Purpose:**  
Create a new thread manually (e.g., recruiter starting 1st contact).  
If you already handle thread creation inside send logic, this can be deferred.

**Request Body:**

```ts
interface CreateThreadRequest {
  candidateId: string;
  initialMessageBody: string;
}
```

**Response:**

```ts
interface CreateThreadResponse {
  success: boolean;
  thread?: SmsThreadDetails;
  firstMessage?: SmsMessageDTO;
}
```

---

# 4️⃣ Webhooks – Twilio Integration

These routes are **called by Twilio**, not by the front end.

## 4.1 POST `/api/webhooks/twilio/inbound-sms`

**Purpose:**  
Handle all inbound SMS (keywords, replies, chat).  
(You already have `inboundSmsWebhook.ts`; this formalizes the route signature.)

**Request:**  
- Standard Twilio webhook form-encoded payload.  
- The handler should:

  1. Run STOP/HELP/START logic (already implemented).
  2. Log inbound message.
  3. Attach message to the correct thread (create if needed).
  4. Optionally trigger automations (e.g., YES/NO on shift confirmations).

**Response:**  
- Twilio expects an XML TwiML or simple 200 response.  
- For now, use a simple 200 OK with any required TwiML based on design.

---

## 4.2 POST `/api/webhooks/twilio/status-callback`

**Purpose:**  
Track outbound message delivery status changes (sent, delivered, failed).

**Request:**  
- Standard Twilio status callback payload including `MessageSid`, `MessageStatus`, etc.

**Handler Behavior:**

- Find corresponding `MessageLog` + `SmsMessage` by `MessageSid`.
- Update `status` and `failureReason` (if any).
- Optionally trigger alerts if failure rate spikes.

**Response:**  
- 200 OK.

---

# 5️⃣ Automations API

Automations will usually run as **scheduled jobs** or system-internal tasks.  
We still define explicit HTTP routes so Cloud Scheduler / internal tools can trigger them.

All automation routes should be **locked down** (e.g., API key header or internal auth).

## 5.1 POST `/internal/automations/profile-incomplete/run`

**Purpose:**  
Scan for users with incomplete profiles and send reminders.

**Request Body (optional):**

```ts
interface ProfileAutomationRequest {
  dryRun?: boolean;         // if true, log candidates but don't send
  limit?: number;           // max users to process in this run
}
```

**Response:**

```ts
interface ProfileAutomationResponse {
  success: boolean;
  processedCount: number;
  sentCount: number;
  skippedDueToPreferences: number;
  skippedOtherReasons: number;
}
```

---

## 5.2 POST `/internal/automations/shift-confirmations/run`

**Purpose:**  
Send upcoming shift confirmation messages and handle follow-ups.

**Request Body (optional):**

```ts
interface ShiftAutomationRequest {
  windowHours?: number;   // e.g. confirm all shifts starting within next 24h
  dryRun?: boolean;
  limit?: number;
}
```

**Response:**

```ts
interface ShiftAutomationResponse {
  success: boolean;
  shiftsConsidered: number;
  confirmationsSent: number;
  alreadyConfirmed: number;
  skippedDueToPreferences: number;
}
```

---

## 5.3 POST `/internal/automations/retry-failed-messages` (optional)

**Purpose:**  
Retry transiently failed messages (e.g., provider errors).  
Can be simple in first version: find failed in last X hours with `retryable = true` flag and requeue once.

**Request Body:**

```ts
interface RetryFailedMessagesRequest {
  sinceMinutes?: number;   // default e.g. 60
  limit?: number;          // safety cap
}
```

**Response:**

```ts
interface RetryFailedMessagesResponse {
  success: boolean;
  candidatesFound: number;
  retriedCount: number;
}
```

---

# 6️⃣ AI Assist Endpoints

These routes are **called by the front end**, which in turn may call OpenAI or your AI stack internally.

(If your backend already has a generic AI proxy, adapt these to call into that.)

## 6.1 POST `/api/messaging/ai/classify-inbound`

**Purpose:**  
Classify a candidate’s inbound message for UI hints + automations.

**Request Body:**

```ts
interface ClassifyInboundRequest {
  messageId?: string;      // optional: if already stored
  body?: string;           // optional: if not yet stored
  threadId?: string;       // to give context
}
```

**Response:**

```ts
type InboundLabel = "YES" | "NO" | "MAYBE" | "RESCHEDULE" | "STOP" | "HELP" | "OTHER";

interface ClassifyInboundResponse {
  success: boolean;
  label: InboundLabel;
  confidence: number;     // 0-1
  reasoningSummary?: string; // short explanation if needed
}
```

> NOTE: For STOP/HELP, the primary logic remains your keyword handler. This endpoint is just a helper for broader classification and should not override compliance logic.

---

## 6.2 POST `/api/messaging/ai/suggest-reply`

**Purpose:**  
Provide suggested replies for recruiters in a thread.

**Request Body:**

```ts
interface SuggestReplyRequest {
  threadId: string;
  messageId?: string;     // most recent candidate message
  numSuggestions?: number; // default 3
}
```

**Response:**

```ts
interface SuggestedReply {
  id: string;            // suggestion id (local)
  body: string;
  tone?: "friendly" | "formal" | "concise" | "encouraging";
  language: LanguageCode;
}

interface SuggestReplyResponse {
  success: boolean;
  suggestions: SuggestedReply[];
}
```

Recruiter UI will show suggestions and allow one-click insert into the composer (not auto-send).

---

## 6.3 POST `/api/messaging/ai/translate`

**Purpose:**  
Translate a message between English and Spanish, for recruiter or candidate view.

**Request Body:**

```ts
interface TranslateRequest {
  body: string;
  fromLang?: LanguageCode | "auto";   // default "auto"
  toLang: LanguageCode;               // "en" or "es"
}
```

**Response:**

```ts
interface TranslateResponse {
  success: boolean;
  translated: string;
  detectedSourceLang?: LanguageCode;
}
```

---

# 7️⃣ Logging & Debugging APIs (Optional / Admin Only)

These help debug messaging behavior without digging into Firestore manually.

## 7.1 GET `/api/admin/messaging/logs`

**Purpose:**  
Search or list `MessageLog` entries.

**Query Params:**

```ts
interface ListLogsQuery extends PaginationQuery {
  userId?: string;
  messageTypeId?: string;
  channel?: Channel;
  direction?: "inbound" | "outbound";
  status?: "queued" | "sent" | "delivered" | "failed" | "not_sent";
  since?: string;  // ISO timestamp
  until?: string;  // ISO timestamp
}
```

**Response:**

```ts
interface MessageLogDTO {
  id: string;
  userId: string;
  messageTypeId: string;
  channel: Channel;
  direction: "inbound" | "outbound";
  body: string;
  language: LanguageCode | null;
  status: "queued" | "sent" | "delivered" | "failed" | "not_sent";
  createdAt: string;  // ISO
}

interface ListLogsResponse {
  success: boolean;
  data: MessageLogDTO[];
  page: number;
  pageSize: number;
  total: number;
}
```

---

## 7.2 GET `/api/admin/messaging/consent-history/:userId`

**Purpose:**  
See SMS consent changes for a given user.

**Response:**

```ts
interface SmsConsentHistoryItem {
  agreed: boolean;
  source: "signup" | "settings" | "keyword" | "admin";
  timestamp: string;       // ISO
  termsVersion?: string;
  note?: string;
}

interface ConsentHistoryResponse {
  success: boolean;
  data: SmsConsentHistoryItem[];
}
```

---

# 8️⃣ Implementation Notes for Cursor

1. **Align with existing structure:**  
   - If your current API prefixes are different (`/api/v1/...`, `/functions/messaging/...`), adapt paths but keep **route responsibilities** the same.

2. **Use existing services where possible:**  
   - For sending SMS/email, reuse any current Twilio/email wrappers; just route them through the new orchestrator.

3. **Centralize authorization & tenancy logic:**  
   - Make sure all messaging routes respect tenant/customer/agency boundaries defined elsewhere in the system.

4. **Incremental rollout:**  
   - It’s okay to initially wire only a subset of message types into the Template Engine and gradually move others over.
   - For Two-Way Messaging, start with a single market or recruiter group as beta.

5. **Code comments:**  
   - Add comments tying implementations back to this file, example:  
     `// HRX Messaging API Spec §3.3 – SendThreadMessage`

---

# END OF DOCUMENT

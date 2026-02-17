# Outbound SMS → Canonical-first (Next PR)

**Follows:** Inbound SMS → Conversations bridge (inbound writes to canonical; Worker Inbox reads from it).

**Goal:** When recruiter/admin sends, write one canonical message first, then send SMS, then update that message with provider metadata. One source of truth, auditable delivery; no “smsThreads as canonical”.

---

## Minimal design

### 1. Admin UI → sendConversationMessage callable

- Admin UI calls **sendConversationMessage** (or a variant that accepts `channel: 'sms'` and recipient info).
- Callable:
  - Creates **canonical message** in `tenants/{tenantId}/conversations/{conversationId}/messages/{messageId}` (channel `in_app` or `sms` depending on intent).
  - Updates conversation rollups (lastMessageAt, lastMessagePreview, unreadByUid).
  - Returns `{ conversationId, messageId }`.

### 2. Server enqueues outbound SMS with linkage

**Queue payload must include (required for deterministic auditability):**

- `tenantId`
- `conversationId`
- `conversationMessageId` (canonical message doc id)
- `toNumberE164`
- `fromNumberE164`
- `text`

So `processSmsOutbound` can update that exact message doc with provider + delivery.

### 3. processSmsOutbound (worker)

- Sends via Twilio using `toNumberE164`, `fromNumberE164`, `text`.
- On success, **updates** the canonical message doc  
  `tenants/{tenantId}/conversations/{conversationId}/messages/{conversationMessageId}`:
  - `provider: { name: 'twilio', messageId: sid }`
  - `delivery: { status: 'sent', sentAt: serverTimestamp() }` (and later `failed` / `delivered` as needed)

That gives deterministic auditability: every outbound send is tied to one message doc.

---

## Outcomes

- One source of truth: canonical conversation + messages.
- Auditable delivery: provider + delivery fields on the same doc.
- smsThreads can remain for legacy admin UI until migration, but outbound is canonical-first.

---

## Verification (after inbound bridge)

Use the checklist in the repo (deploy → Cloud Logs → Firestore → idempotency → rollup semantics). Ensure new conversations use `status: "open"` and `lastMessageAt` so `findOrCreateConversationForSms` lookup does not create duplicates.

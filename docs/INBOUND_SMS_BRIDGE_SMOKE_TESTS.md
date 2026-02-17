# Inbound SMS → Conversations Bridge — Smoke Tests

Run these **after deploying functions** to confirm the bridge behaves correctly. Do them in order.

**Automated tests (optional):** With the Firestore emulator running (`firebase emulators:start --only firestore`), from `functions/` run:
```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 GCLOUD_PROJECT=your-project npm test -- --grep inboundSmsConversationsBridge
```
This runs the same three scenarios (create + idempotent replay + reuse conversation) against the emulator. Without `FIRESTORE_EMULATOR_HOST`, those tests are skipped so `npm test` does not touch production.

---

## Prerequisites

- Functions deployed: `firebase deploy --only functions`
- Twilio webhook URL pointing at your deployed `twilioInboundSmsWebhook` (or equivalent)
- A test worker user with `phoneE164` matching the number you’ll send from
- Firestore console (or script) access to check `tenants/{tenantId}/conversations` and `messages`

---

## Test 1 — Single inbound SMS

**Goal:** Legacy path still works and canonical conversation + message are created.

1. Send **one** SMS from your test phone to your Twilio number (e.g. “Hello bridge test”).
2. In **Cloud Logs**, filter for:
   - `inboundSmsWebhook` or `handleInboundSms`
   - `[InboundSMS->ConversationsBridge]`
   Confirm no bridge error (if you see one, fix before continuing).
3. **Legacy:** In Firestore, confirm an `smsThreads` message was created (path depends on your schema). Admin UI for that thread should still show the message.
4. **Canonical conversation:** Under `tenants/{tenantId}/conversations`, find a document where:
   - `channelEndpoints.sms.workerPhoneE164` = your test phone (E.164)
   - `channelEndpoints.sms.twilioNumberE164` = your Twilio number (E.164)
   - `status` = `"open"`
   - `participantUids` contains the worker’s UID
   Note the `conversationId`.
5. **Canonical message:** Under  
   `tenants/{tenantId}/conversations/{conversationId}/messages`, find a document with id  
   `tw_<MessageSid>` (use the Twilio MessageSid from logs or Twilio console). Body should match the SMS text.
6. **Worker Inbox:** Log in as that worker and open the inbox. The conversation should appear with the message.

**Pass:** smsThreads message exists, canonical conversation exists, canonical message `tw_<MessageSid>` exists, Worker Inbox shows the conversation.

---

## Test 2 — Replay same inbound webhook (idempotency)

**Goal:** No duplicate message; rollups stay sane (no “thrashing”).

1. Re-send the **same** webhook request (same `MessageSid`, same body) to your webhook URL (e.g. with curl or a replay tool). Or temporarily return a non-200 from the webhook once so Twilio retries.
2. In Firestore, under the **same** `tenants/{tenantId}/conversations/{conversationId}/messages`:
   - There should still be **only one** document with id `tw_<MessageSid>` (no duplicate).
3. Conversation rollups (`lastMessageAt`, `lastMessagePreview`, `unreadByUid`) may have been updated again but should still be consistent (e.g. one preview, no extra message docs).

**Pass:** No new message doc created; conversation still has a single message for that MessageSid.

---

## Test 3 — Second inbound SMS from same worker + same Twilio number

**Goal:** Same conversation is reused (no duplicate conversation).

1. Send a **second** SMS from the **same** test phone to the **same** Twilio number (e.g. “Second message”).
2. In Firestore:
   - There should still be **one** conversation document for that (workerPhoneE164, twilioNumberE164) pair (the same `conversationId` as in Test 1).
   - Under that conversation’s `messages` subcollection there should be **two** message docs: `tw_<FirstMessageSid>` and `tw_<SecondMessageSid>`.
3. Worker Inbox should show the same conversation with both messages.

**Pass:** Same conversation doc; two message docs under it; Worker Inbox shows both messages.

---

## Optional checks

- **Rollup fields:** Conversation doc has `lastMessageAt`, `lastMessagePreview`, and optionally `lastMessageDirection: 'inbound'`, `lastMessageChannel: 'sms'` for inbox display/filtering.
- **Index:** If you use a composite index on `channelEndpoints.sms.*` + `status` + `lastMessageAt`, ensure it is built and enabled (`firebase deploy --only firestore:indexes`).

---

## Failure hints

- **Bridge error in logs:** Check Firestore rules for `tenants/{tenantId}/conversations` and `messages` (participant can read/write). Check that `participantUids` and `channelEndpoints.sms` field names match the code.
- **Duplicate conversation on Test 3:** Ensure new conversations are created with `status: 'open'` and `lastMessageAt` so the find query can match them; check index.
- **Duplicate message on Test 2:** Ensure message id is `tw_${MessageSid}` and you use `create()` and treat ALREADY_EXISTS as success.

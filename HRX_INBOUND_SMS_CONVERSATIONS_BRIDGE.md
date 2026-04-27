# HRX Messaging --- Inbound SMS → Conversations Bridge

**Date:** 2026-02-16\
**Repo:** hrx-god-view\
**PR Name:** feat(messaging): Inbound SMS bridge to canonical
conversations

------------------------------------------------------------------------

## 🎯 Goals

1.  Keep existing `smsThreads` behavior unchanged.
2.  Add canonical write to
    `tenants/{tenantId}/conversations/{conversationId}/messages/{messageId}`.
3.  Make bridge idempotent (Twilio retries safe).
4.  Never rely on client-provided identity.
5.  Use existing tenant + worker resolution logic already used for
    smsThreads.

------------------------------------------------------------------------

## 🚫 Out of Scope

-   Outbound SMS bridge
-   Admin UI migration to conversations
-   Push notifications redesign
-   Deleting smsThreads

------------------------------------------------------------------------

# 🧠 Canonical Mapping Rules

## Conversation Identity (SMS)

Conversation is uniquely defined by:

-   `tenantId`
-   `workerUid`
-   `From` (worker phone)
-   `To` (Twilio number)

Conversation doc must include:

``` json
{
  "tenantId": "<tenantId>",
  "participantUids": ["<workerUid>"],
  "type": "support",
  "status": "open",
  "topic": { "type": "support", "label": "Support" },
  "createdAt": "serverTimestamp()",
  "updatedAt": "serverTimestamp()",
  "lastMessageAt": "serverTimestamp()",
  "lastMessagePreview": "",
  "unreadByUid": {},
  "channelEndpoints": {
    "sms": {
      "workerPhoneE164": "<From>",
      "twilioNumberE164": "<To>",
      "provider": "twilio"
    }
  }
}
```

------------------------------------------------------------------------

## Message Identity (Idempotency)

Use Twilio `MessageSid` as deterministic ID:

    tenants/{tid}/conversations/{cid}/messages/tw_{MessageSid}

Use `create()` instead of `set()`.

If document exists → treat as success (Twilio retry).

------------------------------------------------------------------------

# 📁 Files to Implement / Modify

------------------------------------------------------------------------

## 1️⃣ functions/src/messaging/conversations/conversationsModel.ts

### 1.1 findOrCreateConversationForSms(...)

Input:

-   tenantId
-   workerUid
-   workerPhoneE164
-   twilioNumberE164
-   topic

Lookup Query:

-   where channelEndpoints.sms.workerPhoneE164 == workerPhoneE164
-   where channelEndpoints.sms.twilioNumberE164 == twilioNumberE164
-   orderBy lastMessageAt desc
-   limit 1

If none found → create conversation.

Return `{ conversationId, ref }`.

------------------------------------------------------------------------

### 1.2 appendConversationMessage(...)

Input:

-   tenantId
-   conversationId
-   messageId (tw_MessageSid)
-   sender { role: 'worker', uid }
-   channel: 'sms'
-   visibility: 'participants'
-   body { text }
-   provider { name: 'twilio', messageId }

Use `create()` and catch ALREADY_EXISTS.

Return `{ created: boolean }`.

------------------------------------------------------------------------

### 1.3 updateConversationRollups(...)

Transaction update:

-   lastMessageAt = serverTimestamp()
-   lastMessagePreview = text.slice(0, 180)
-   unreadByUid update logic

For now:

-   unreadByUid\[workerUid\] = 0

------------------------------------------------------------------------

# 2️⃣ functions/src/messaging/inboundSmsWebhook.ts

Locate your main inbound handler (likely handleRegularInboundMessage).

After legacy smsThreads write succeeds, insert:

``` ts
try {
  const { conversationId } = await findOrCreateConversationForSms({
    tenantId,
    workerUid,
    workerPhoneE164: fromE164,
    twilioNumberE164: toE164,
    topic: { type: "support", label: "Support" },
  });

  const canonicalMessageId = `tw_${messageSid}`;

  const appended = await appendConversationMessage({
    tenantId,
    conversationId,
    messageId: canonicalMessageId,
    channel: "sms",
    visibility: "participants",
    sender: { role: "worker", uid: workerUid },
    body: { text: bodyText },
    provider: { name: "twilio", messageId: messageSid },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  if (appended.created) {
    await updateConversationRollups({
      tenantId,
      conversationId,
      lastMessageText: bodyText,
      senderUid: workerUid,
    });
  }
} catch (err) {
  console.error("[InboundSMS->ConversationsBridge] failed", {
    tenantId,
    workerUid,
    messageSid,
    err: String(err),
  });
}
```

Do NOT fail webhook if canonical write fails.

------------------------------------------------------------------------

# 🔁 Idempotency Strategy

Twilio may retry webhook.

Safe because:

-   Deterministic message ID (`tw_MessageSid`)
-   Using `create()`
-   Catch duplicate and treat as success

------------------------------------------------------------------------

# 🧪 Smoke Tests

Test 1 -- Fresh inbound SMS

Send SMS → Expect:

-   smsThreads message created
-   canonical conversation created (or reused)
-   canonical message created
-   worker inbox shows conversation

------------------------------------------------------------------------

Test 2 -- Retry webhook

Replay same payload → No duplicate message.

------------------------------------------------------------------------

Test 3 -- Legacy UI still works

Admin TextMessagesPage continues reading smsThreads.

------------------------------------------------------------------------

# 🧱 Deployment Order

1.  Implement conversationsModel functions.
2.  Add inbound bridge block.
3.  Deploy functions.
4.  Send test SMS.
5.  Verify worker inbox.
6.  Verify smsThreads unchanged.

------------------------------------------------------------------------

# 🧩 Optional Future PR

-   Outbound bridge (canonical-first).
-   Recruiter notifications on inbound.
-   Admin UI migration to conversations.
-   Remove smsThreads.

------------------------------------------------------------------------

# ✅ Success Criteria

Worker receives SMS → conversation appears instantly in worker inbox\
No duplicate messages on Twilio retry\
Admin UI still works\
No webhook failures

------------------------------------------------------------------------

END OF FILE

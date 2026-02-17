# WORKER INBOX — Conversations not showing (Cursor Debug + Fix Plan)

**Date:** 2026-02-16  
**Repo:** hrx-god-view  
**Goal:** Fix Worker Inbox showing **“No conversations yet.”** even though a valid conversation exists in Firestore.

---

## 0) Known-good data (confirmed)

Worker app logs show:

- `tenantId` (runtime): `BCiP2bQ9CgVOCTfV6MhD`
- `auth uid` (runtime): `TWXMM1mOJHepmk80Qsx128w9AiS2`

Firestore document exists at:

- **Conversation doc**  
  `tenants/BCiP2bQ9CgVOCTfV6MhD/conversations/test123`

  With:
  - `participantUids: ["TWXMM1mOJHepmk80Qsx128w9AiS2"]`
  - `lastMessageAt: Timestamp`
  - `lastMessagePreview: "Hello"`
  - `topic: { type: "support", label: "Test" }`
  - `unreadByUid: {}`

- **Message doc**  
  `tenants/BCiP2bQ9CgVOCTfV6MhD/conversations/test123/messages/msg1`

  With:
  - `body.text: "Hello from Firestore"`
  - `channel: "in_app"`
  - `createdAt: Timestamp`
  - `sender.uid: "TWXMM1mOJHepmk8OQsx128w9AiS2"`  **⚠️ NOTE: contains letter “O” not zero “0”**
  - `visibility: "participants"`

**Expected behavior:** Worker Inbox list query should return at least `["test123"]`.

---

## 1) Most likely root causes (ranked)

### A) Path helper mismatch (highest probability)
`conversationPaths.conversations(tenantId)` might be pointing to the wrong collection path (typo like `conversation` vs `conversations`, missing `tenants/`, etc.).
**Symptom:** No errors, but `onSnapshot` returns empty because it’s listening to the wrong path.

### B) Query never actually subscribes / bails early
If the hook returns early until `tenantId`/`uid` are truthy but never re-subscribes correctly, you’ll see logs but no snapshot results.

### C) Firestore index not built / rules denied (would show errors)
If index is missing or rules deny read, `onSnapshot` error callback fires.
**Symptom:** console.error with “requires an index” or “Missing or insufficient permissions”.

### D) UI render filters conversations out
Even if query returns docs, UI may filter them (e.g., `status !== 'open'`, `topic` missing, etc.).
**Symptom:** Hook logs doc ids, but UI still says “No conversations”.

---

## 2) Cursor tasks (do these exactly)

### 2.1 Verify conversationPaths points to the correct Firestore path
**File:** `src/data/firestorePaths.ts`

Find/confirm:

```ts
export const conversationPaths = {
  conversations: (tenantId: string) => collection(db, "tenants", tenantId, "conversations"),
  conversation: (tenantId: string, conversationId: string) => doc(db, "tenants", tenantId, "conversations", conversationId),
  messages: (tenantId: string, conversationId: string) => collection(db, "tenants", tenantId, "conversations", conversationId, "messages"),
  message: (tenantId: string, conversationId: string, messageId: string) => doc(db, "tenants", tenantId, "conversations", conversationId, "messages", messageId),
};
```

**Fix if needed:** Any deviation from the above path should be corrected.

✅ Quick sanity check: search for `"conversations"` and confirm it’s not singular anywhere in this helper.

---

### 2.2 Make the hook prove what it is querying (log the actual path + snapshot size)
**File:** `src/hooks/useConversationsForUser.ts`

Add TEMP logging right before `onSnapshot`:

```ts
console.log("[useConversationsForUser] collection path:", `tenants/${tenantId}/conversations`);
console.log("[useConversationsForUser] uid:", uid);
```

Then in snapshot callback:

```ts
console.log("[useConversationsForUser] snapshot size:", snap.size);
console.log("[useConversationsForUser] doc ids:", snap.docs.map(d => d.id));
```

And in error callback:

```ts
console.error("[useConversationsForUser] snapshot error:", err);
```

**Expected:** size >= 1 and ids include `test123`.

---

### 2.3 Add a one-time `getDocs()` proof (bypasses realtime listener issues)
In the same effect (TEMP, remove after):

```ts
import { getDocs } from "firebase/firestore";

// ...
(async () => {
  try {
    const snap = await getDocs(q);
    console.log("[useConversationsForUser] getDocs size:", snap.size, "ids:", snap.docs.map(d => d.id));
  } catch (e) {
    console.error("[useConversationsForUser] getDocs error:", e);
  }
})();
```

If `getDocs` returns the doc but `onSnapshot` doesn’t, the issue is listener wiring/unsubscribe logic.

---

### 2.4 Confirm the Worker Inbox page is not filtering out the list
**File:** `src/pages/c1/workers/inbox.tsx`

Find the “No conversations yet.” condition.

If it’s something like:

```ts
if (!conversations?.length) return <EmptyState />;
```

Add TEMP logging immediately before render:

```ts
console.log("[C1WorkerInbox] conversations length:", conversations?.length);
console.log("[C1WorkerInbox] conversations ids:", conversations?.map(c => c.id));
```

If length > 0 but empty UI still shows, there is additional filtering. Remove/adjust the filter.

---

### 2.5 Fix the message sender UID typo (important for rendering “mine/theirs”)
Right now the message has:

- `sender.uid: TWXMM1mOJHepmk8OQsx128w9AiS2`  (letter O)

But auth uid is:

- `TWXMM1mOJHepmk80Qsx128w9AiS2` (zero 0)

**Fix in Firestore (manual data):**
Update `sender.uid` in `msg1` to use the correct UID with **0**.

This won’t fix the list query, but it can affect message bubble ownership logic.

---

## 3) If the query still returns empty after 2.1–2.4

Do a direct Firestore console check:

1) Go to: `tenants/BCiP2bQ9CgVOCTfV6MhD/conversations`
2) Confirm `test123` is visible **under that exact tenant doc** (not under `tenants/c1/...`).
3) Confirm `participantUids` is an **array** and includes the exact uid string.

Then, verify the app is pointing to the same Firebase project as your Firestore console (common gotcha: local env using a different project).

---

## 4) Definition of “DONE”

- Console shows:  
  `[useConversationsForUser] snapshot size: 1` and `doc ids: ["test123"]`
- Inbox list renders at least one conversation row
- Selecting it shows `msg1`
- No “Missing or insufficient permissions”
- Remove TEMP logs and the `getDocs()` block after fix.

---

## 5) What Cursor should report back

After making changes, paste the resulting console output for:

- `[useConversationsForUser] collection path: ...`
- `[useConversationsForUser] snapshot size: ...`
- `[useConversationsForUser] doc ids: ...`
- `[useConversationsForUser] snapshot error:` (if any)

And confirm whether `conversationPaths` matches the expected canonical path.

---

## 6) Cursor implementation (done)

- **2.1 conversationPaths:** Confirmed. `src/data/firestorePaths.ts` exports path strings `tenants/${tenantId}/conversations` (plural). The hook does *not* use `conversationPaths`; it builds the ref with `collection(db, 'tenants', tenantId, 'conversations')`, which matches the same canonical path. No change needed.
- **2.2 Hook logging:** Added `collection path`, `uid`, `snapshot size`, `doc ids`, and `snapshot error` logs in `useConversationsForUser.ts`.
- **2.3 getDocs proof:** Added one-time `getDocs(q)` in the same effect; logs `getDocs size` and `ids` (or `getDocs error`).
- **2.4 Inbox logging:** Added `[C1WorkerInbox] conversations length` and `conversations ids` before render.
- **2.5 Sender UID typo:** No code change. Fix in Firestore: set `sender.uid` in `msg1` to `TWXMM1mOJHepmk80Qsx128w9AiS2` (zero) to match auth uid for "mine/theirs" bubbles.

After you run the app and capture console output, paste it here and remove the TEMP logs + getDocs block.

---

## 7) Console output diagnosis (2026-02-16)

**Observed:** Path and uid are correct (`tenants/BCiP2bQ9CgVOCTfV6MhD/conversations`, `TWXMM1mOJHepmk80Qsx128w9AiS2`). Inbox shows `conversations length: 0`, `ids: []`. No snapshot error.

**Conclusion:** The query is returning 0 documents. `array-contains` is exact string match.

**Most likely cause:** **UID typo in the conversation doc.** Your auth uid uses digit **zero** `0`: `TWXMM1mOJHepmk80Qsx128w9AiS2`. If the conversation doc’s `participantUids` has the letter **O** instead (e.g. `TWXMM1mOJHepmk8OQsx128w9AiS2`), the query will match no documents.

**Fix:** In Firestore, open `tenants/BCiP2bQ9CgVOCTfV6MhD/conversations/test123` and set:
- `participantUids`: `["TWXMM1mOJHepmk80Qsx128w9AiS2"]`  
  (use **zero** `0` in `80Qsx`, not letter `O`).

Then reload the inbox. A warning log was added so if the snapshot fires with size 0 you’ll see the reminder to check path and participantUids.

---

## 8) Data confirmed correct — next checks (conversation list still 0)

Screenshots confirm **conversation doc** `test123` is correct: `tenantId` and `participantUids` (with zero) match the app. So the issue is likely one of:

1. **Firebase project mismatch** — App and Firestore console must use the same project. Check `src/firebase.ts` (or env) for `projectId` and compare to the console URL.
2. **Index not deployed** — Deploy: `firebase deploy --only firestore:indexes`. If the index is missing, you should see a console error from getDocs or onSnapshot.
3. **Rules not deployed** — Deploy: `firebase deploy --only firestore:rules` so the `match /conversations/{conversationId}` block is active.
4. **Message doc `msg1` (for "mine" bubble only)** — Set `sender.uid` to exactly `TWXMM1mOJHepmk80Qsx128w9AiS2` (zero, no extra `l`). This does not affect the conversation list.

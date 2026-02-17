# Worker Inbox Conversations — Debug Results

**Date:** 2026-02-16  
**Scope:** Why Worker Inbox shows "No conversations yet" despite valid Firestore doc at `tenants/c1/conversations/test123`.

---

## 1) What `tenantId` resolves to at runtime

- **Source:** `tenantId = activeTenant?.id ?? null` in `src/pages/c1/workers/inbox.tsx`.
- **How `activeTenant` is set:** In `AuthContext`, `activeTenant` is set from the **Firestore tenant document**: `doc(db, 'tenants', tenantIdToUse)` then `setActiveTenant({ id: tenantSnap.id, ...tenantSnap.data() })`. So **`activeTenant.id` is the Firestore tenant document ID**, not a slug.
- **Important:** For the C1 worker flow, the user doc’s `activeTenantId` (or `primaryTenantId`) is used as `tenantIdToUse`. That value is often **`BCiP2bQ9CgVOCTfV6MhD`** (see `AuthContext.tsx` line 501 when on C1 route for `ensureUserDocument`). So at runtime, **`tenantId` is very likely `BCiP2bQ9CgVOCTfV6MhD`**, not `"c1"`.
- **With debug logs:** In the browser console you’ll see:
  - `[C1WorkerInbox] activeTenant?.id: <value> tenantId: <value> auth uid: <value>`
  - `[useConversationsForUser] Inbox tenantId: <value> uid: <value>`
  Use these to confirm the actual `tenantId` and `uid`.

---

## 2) What UID resolves to at runtime

- **Source:** `uid = user?.uid ?? null` from `useAuth().user?.uid`.
- **Expected for your test:** `TWXMM1mOJHepmk8OQsx128w9AiS2` (must match `participantUids` in the conversation doc exactly).
- **With debug logs:** Same console lines above show `auth uid` and the hook logs `uid`. Any whitespace or different string = no match.

---

## 3) Whether the query returns snapshot docs

- **With debug logs:** You’ll see either:
  - `[useConversationsForUser] Query result doc ids: ['test123', ...]` → query returned docs, or
  - `[useConversationsForUser] Query result doc ids: []` → query ran but returned no docs (wrong path or no matching docs).
- If the snapshot **error** callback runs, you’ll see:
  - `[useConversationsForUser] Snapshot error (permission or index): <error>`.

---

## 4) Whether Firestore throws permission or index error

- **Rules:** Under `match /tenants/{tenantId}/conversations/{conversationId}` the read rule allows:
  - HRX, or
  - assigned + internal for that tenant, or
  - `request.auth.uid in resource.data.participantUids`.
  So a worker in `participantUids` can read; no rule bug identified for that case.
- **Index:** `firestore.indexes.json` already has a composite index for the `conversations` collection group: `participantUids` (CONTAINS) + `lastMessageAt` (DESC). So a missing index would only be an issue if that index isn’t deployed.
- **How to confirm:** If the snapshot **error** callback runs, the console log will show the error (e.g. “Missing or insufficient permissions” or “The query requires an index”).

---

## 5) Exact root cause (most likely)

**Tenant path mismatch.**

- You created the test conversation at **`tenants/c1/conversations/test123`**.
- The app is almost certainly querying **`tenants/<activeTenant.id>/conversations`** where **`activeTenant.id`** is the Firestore tenant document ID (e.g. **`BCiP2bQ9CgVOCTfV6MhD`**), not the string `"c1"`.
- So the query runs against **`tenants/BCiP2bQ9CgVOCTfV6MhD/conversations`**, which is empty, and the UI shows “No conversations yet.”
- Less likely but possible: UID mismatch, or (if you see an error in the snapshot callback) rules/index.

---

## 6) Minimal fix

**Option A — No code change (recommended first):**

- Check the console logs for the actual `tenantId` and `uid`.
- If `tenantId` is **not** `"c1"` (e.g. it’s `BCiP2bQ9CgVOCTfV6MhD`):
  - Create the test conversation (and messages) under that tenant path, e.g.  
    **`tenants/BCiP2bQ9CgVOCTfV6MhD/conversations/<id>`**  
    with the same shape (`participantUids`, `lastMessageAt`, etc.) and ensure your logged-in user’s UID is in `participantUids`.
- If your **real** tenant document ID in Firestore is literally **`c1`**, then set the user’s `activeTenantId` (and/or primary tenant) to `"c1"` so `activeTenant.id` is `"c1"` and the existing `tenants/c1/conversations/test123` doc is queried.

**Option B — Route-based tenant for C1 worker (only if you intentionally use slug `"c1"` for Firestore paths):**

- If you always want the worker inbox on `/c1/workers` to use the tenant path **`tenants/c1/...`** regardless of `activeTenant.id`, you can derive `tenantId` for the **conversations** read path only, e.g. from the route or a mapping (e.g. when path starts with `/c1/workers`, use `"c1"`). This is a small, localized change in the inbox page and is only appropriate if your data model uses `"c1"` as the tenant doc ID for that app.

---

## Summary

| Item              | Result |
|-------------------|--------|
| **tenantId**      | Resolves from `activeTenant?.id` (Firestore tenant doc ID); likely **not** `"c1"` (e.g. `BCiP2bQ9CgVOCTfV6MhD`). Console logs confirm. |
| **UID**           | From `user?.uid`; must exactly match `participantUids`. Console logs confirm. |
| **Query result**  | Logs show either doc ids returned or empty array. |
| **Permission/index** | If snapshot errors, log shows the exact Firestore error. |
| **Root cause**    | **Tenant path mismatch:** data under `tenants/c1/...`, query under `tenants/<activeTenant.id>/...`. |
| **Minimal patch** | Align data path with app: create conversations under `tenants/<activeTenant.id>/conversations` (or set `activeTenantId` to `"c1"` if that’s your real tenant doc ID). Optionally use a route-based tenant for C1 worker if you intentionally use slug `"c1"`. |

---

## Temporary debug logs added

- **`src/hooks/useConversationsForUser.ts`:** Logs `tenantId`, `uid`, query result doc ids, and any snapshot error.
- **`src/pages/c1/workers/inbox.tsx`:** Logs `activeTenant?.id`, `tenantId`, and `user?.uid`.

Remove these `console.log` / `console.error` lines once the issue is resolved.

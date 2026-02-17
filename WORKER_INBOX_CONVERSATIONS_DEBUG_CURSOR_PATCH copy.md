# WORKER_INBOX_CONVERSATIONS_DEBUG_CURSOR_PATCH.md
**Date:** 2026-02-16  
**Repo:** hrx-god-view  
**Goal:** Fix why Worker Inbox shows **“No conversations yet”** even though a conversation exists at:  
`/tenants/BCiP2bQ9CgVOCTfV6MhD/conversations/test123` with participant `TWXMM1mOJHepmk80Qsx128w9AiS2`.

---

## What we know from console output
- Inbox renders and logs: `conversations length: 0`.
- `useConversationsForUser` logs only:
  - `collection path: tenants/BCiP2bQ9CgVOCTfV6MhD/conversations`
  - `uid: TWXMM1mOJHepmk80Qsx128w9AiS2`
- **We do NOT see**:
  - `getDocs size: ...`
  - `snapshot size: ...`
  - `snapshot error: ...`

That strongly suggests the hook **is not actually running the getDocs/onSnapshot blocks**, or it is failing before those logs.

---

## Cursor task
Make the hook **provably** execute:
1) `getDoc()` on the exact test doc id  
2) a minimal `getDocs()` query (no orderBy)  
3) the full query (where + orderBy)  
4) `onSnapshot()` listener  
…and log **success or failure for each step**.

Then fix the underlying bug (usually an early return, missing imports, a thrown error before try/catch, or a query/index/rules issue).

---

## Step 1 — Patch `src/hooks/useConversationsForUser.ts` (diagnostic + fix)
### Requirements
- MUST log each stage with a clear prefix.
- MUST log caught errors (including Firestore error codes).
- MUST set React state from snapshot results.
- MUST return the unsubscribe function from `useEffect`.

### Drop-in patch (replace the effect body)
> Cursor: keep existing types/state, but replace the `useEffect(() => { ... }, [tenantId, uid])` with the version below.

```ts
useEffect(() => {
  let unsubscribe: (() => void) | undefined;

  // Guard
  if (!tenantId || !uid) {
    console.warn("[useConversationsForUser] SKIP (missing tenantId/uid)", { tenantId, uid });
    setConversations([]);
    setLoading(false);
    return;
  }

  console.log("[useConversationsForUser] START", { tenantId, uid });
  setLoading(true);
  setError(null);

  const run = async () => {
    try {
      // 1) Direct getDoc proof (exact path, no query/index dependency)
      const testId = "test123";
      const testRef = doc(db, "tenants", tenantId, "conversations", testId);
      console.log("[useConversationsForUser] getDoc(ref)", testRef.path);

      try {
        const testSnap = await getDoc(testRef);
        console.log("[useConversationsForUser] getDoc result", {
          exists: testSnap.exists(),
          id: testSnap.id,
          dataKeys: testSnap.exists() ? Object.keys(testSnap.data() as any) : [],
        });
      } catch (e: any) {
        console.error("[useConversationsForUser] getDoc ERROR", e?.code, e?.message, e);
      }

      // 2) Minimal getDocs query (array-contains only, no orderBy)
      const baseRef = collection(db, "tenants", tenantId, "conversations");
      const qBase = query(baseRef, where("participantUids", "array-contains", uid), limit(50));
      console.log("[useConversationsForUser] getDocs BASE query", {
        path: `tenants/${tenantId}/conversations`,
        where: ["participantUids", "array-contains", uid],
      });

      try {
        const baseSnap = await getDocs(qBase);
        console.log("[useConversationsForUser] getDocs BASE result", {
          size: baseSnap.size,
          ids: baseSnap.docs.map((d) => d.id),
        });
      } catch (e: any) {
        console.error("[useConversationsForUser] getDocs BASE ERROR", e?.code, e?.message, e);
      }

      // 3) Full getDocs query (array-contains + orderBy lastMessageAt)
      const qFull = query(
        baseRef,
        where("participantUids", "array-contains", uid),
        orderBy("lastMessageAt", "desc"),
        limit(50)
      );

      console.log("[useConversationsForUser] getDocs FULL query", {
        where: ["participantUids", "array-contains", uid],
        orderBy: ["lastMessageAt", "desc"],
      });

      try {
        const fullSnap = await getDocs(qFull);
        console.log("[useConversationsForUser] getDocs FULL result", {
          size: fullSnap.size,
          ids: fullSnap.docs.map((d) => d.id),
        });
      } catch (e: any) {
        console.error("[useConversationsForUser] getDocs FULL ERROR", e?.code, e?.message, e);
      }

      // 4) Real-time snapshot (this is what the UI should use)
      console.log("[useConversationsForUser] onSnapshot SUBSCRIBE");
      unsubscribe = onSnapshot(
        qFull,
        (snap) => {
          console.log("[useConversationsForUser] snapshot SUCCESS", {
            size: snap.size,
            ids: snap.docs.map((d) => d.id),
          });
          const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
          setConversations(rows);
          setLoading(false);
        },
        (err: any) => {
          console.error("[useConversationsForUser] snapshot ERROR", err?.code, err?.message, err);
          setError(err);
          setLoading(false);
        }
      );
    } catch (e: any) {
      console.error("[useConversationsForUser] OUTER ERROR", e?.code, e?.message, e);
      setError(e);
      setLoading(false);
    }
  };

  void run();

  return () => {
    console.log("[useConversationsForUser] CLEANUP unsubscribe?", Boolean(unsubscribe));
    if (unsubscribe) unsubscribe();
  };
}, [tenantId, uid]);
```

### Expected output after patch
When loading `/c1/workers/inbox`, console must include:

- `[useConversationsForUser] getDoc result { exists: true, ... }`
- `[useConversationsForUser] getDocs BASE result { size: 1, ids: ["test123"] }` (at minimum)
- `[useConversationsForUser] snapshot SUCCESS { size: 1, ids: ["test123"] }`

If ANY of these show an error, Cursor must fix the cause using the branches below.

---

## Step 2 — Patch `src/pages/c1/workers/inbox.tsx` to show hook error/loading (tiny)
Add a temporary diagnostic render block near the top of the component:

```tsx
{error && (
  <Alert severity="error" sx={{ mb: 2 }}>
    Inbox error: {String((error as any)?.code || "")} {String((error as any)?.message || error)}
  </Alert>
)}
{loading && (
  <Alert severity="info" sx={{ mb: 2 }}>
    Loading conversations…
  </Alert>
)}
```

Also log the hook props once (not on every render) if needed, but prefer the hook logs.

---

## How to interpret results (Cursor must follow this)
### Case 1 — `getDoc exists: false`
You’re looking at the wrong tenantId or wrong doc id.
- Verify the Firestore doc is under **exactly**:
  `tenants/BCiP2bQ9CgVOCTfV6MhD/conversations/test123`
- If it exists in console but getDoc says false, you are pointed at a different Firebase project/environment.

### Case 2 — `getDoc ERROR permission-denied`
Firestore rules are denying reads for worker users.
- Fix rules for:
  `match /tenants/{tenantId}/conversations/{conversationId}`
  and `match /messages/{messageId}`
- Ensure worker’s auth uid is in `participantUids`.
- Ensure the rules use `request.auth.uid in resource.data.participantUids` (or equivalent), and not a different field name.

### Case 3 — `getDocs BASE size: 0` but `getDoc exists: true`
The doc exists but does not match the query.
- Confirm the conversation doc has:
  - `participantUids` (plural) as an ARRAY containing the exact uid string.
- Check for typos: `participantUids` vs `participantsUids` / `participantUids ` (space) / `participantIds`.

### Case 4 — BASE works but FULL query errors
If you see:
- `getDocs BASE result size: 1`
- `getDocs FULL ERROR failed-precondition` (index)
Then the composite index is missing for:
- `participantUids ARRAY_CONTAINS` + `lastMessageAt DESC`

Create/deploy the index (it may already be in firestore.indexes.json but not deployed).

### Case 5 — getDocs FULL works but snapshot is 0 / never fires
This is almost always a listener wiring bug.
- Ensure `unsubscribe = onSnapshot(...)` is actually assigned in the same scope (no shadowing).
- Ensure you do NOT early-return after starting async.
- Ensure `onSnapshot` is called with `qFull` (not `qBase`).
- Ensure `setConversations(rows)` is called.

---

## Step 3 — After it’s fixed
- Remove the temporary `getDoc/getDocs` diagnostics and extra logs.
- Keep *one* small log or none at all in production.
- Leave hook clean: just `onSnapshot` + state.

---

## Optional: Quick manual sanity check (no code)
In Firestore console (same project as your app), run:
- Open the worker user’s `/users/{uid}` doc to confirm tenant linkage.
- Confirm the worker is authenticated (uid logs show it is).

---

## Definition of done
- Worker Inbox shows 1 conversation “Test”.
- Selecting it loads `msg1` and displays “Hello from Firestore”.
- No permission errors in console.


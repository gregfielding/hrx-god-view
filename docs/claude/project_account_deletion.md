# Account deletion — request queue + auto-deletion pipeline

## Flow (as of 2026-08-25, Greg approved)

Workers request deletion in the worker app (profile → About/Legal) →
`account_deletion_requests/{uid}` (doc id = uid, status `pending`). Staff
queue at `/users/deletion-requests` (DeletionRequestsPage).

**Retention rule (non-negotiable):** real Everee pay/tax linkage
(`taxIdentity.source === 'everee'` || `evereeWorkerId`) → deactivate +
retain, NEVER hard-delete. `last4SSN` alone (typed at signup, no pay
history) is deletable — amber chip, not red.

## Auto-deletion pipeline (SHIPPED 2026-08-25)

`functions/src/accountDeletionGraceSweep.ts` →
`runAccountDeletionGraceSweep()`, hosted on the **`processApplyAbandonNudges`
daily cron** (17:00 UTC — the only daily schedule with Twilio secrets bound
and a daylight SMS window; Cloud Run cap forbids a dedicated function).

Per pending request:
- users doc gone → auto-complete `processedBy: 'auto (account deleted)'`
  (server twin of the client page's self-heal).
- payroll history OR staff level ≥5 → held pending for a human, forever.
- eligible, first pass → SMS + in-app notice ("deleted on {date}, reply if
  you changed your mind"), stamps `graceNoticeSentAt`,
  `scheduledDeletionAt` (+7 days), `phoneE164AtNotice` (users doc is gone
  by farewell time), `preferredLanguageAtNotice`.
- grace elapsed → `recursiveDelete(users/{uid})` + Auth delete
  (auth/user-not-found tolerated), request → completed
  `'auto (grace elapsed)'`, farewell SMS. Cap 20 deletions/run.

**Cancel path:** staff Dismiss the request (sweep only touches `pending`),
or the worker replies to the notice SMS (lands in the normal inbound
conversation queue). Queue shows a blue "Auto-deletes {date}" chip on
noticed rows.

Verified 2026-08-25 on synthetic docs: heal / notice(+7d stamp) /
payroll-guard / staff-guard / delete legs all exercised (Auth deletion via
Identity Toolkit REST in the local test — ☠️ laptop admin-SDK Auth footgun;
`runAccountDeletionGraceSweep({deleteAuthUser})` is injectable for exactly
this).

## Footguns
- firestore.rules constrains CLIENT updates to
  `['status','processedBy','processedAt','note']` and status to
  `pending|completed|dismissed`. The sweep's new fields are admin-SDK
  writes (bypass rules) — but any new CLIENT-written field or status needs
  the rules allowlist updated.
- No `phone` on the request doc at creation — resolve from users doc at
  notice time (the sweep stamps `phoneE164AtNotice` for the farewell).
- `deleteUserCompletely` (admin UI callable) is NOT idempotent: Auth
  delete throws after Firestore data is already gone. The sweep's own
  delete leg tolerates a missing Auth user instead of reusing it.
- Morning brief (inboxChiefOfStaff `buildDeletionRequestsSection`) reads
  pending requests — held-for-human rows keep appearing there. That's
  intended: those are exactly the ones needing a person.

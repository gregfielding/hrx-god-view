# Assignment Reminder QA (MVP Launch)

## Launch-Locked Production Contract

For production launch, worker shift reminders are:

- `assignment_reminder_24h` (24 hours before start)
- `assignment_reminder_2h` (2 hours before start)

Channels:

- Push
- SMS

Deep link target:

- `/c1/workers/assignments/{assignmentId}`

## Architecture

1. Firestore trigger (`onAssignmentConfirmedScheduleReminders`) schedules reminder jobs under:
   - `tenants/{tenantId}/assignments/{assignmentId}/scheduled_notifications/{notificationId}`
2. Scheduler (`dispatchScheduledWorkerReminders`) runs every 5 minutes and dispatches due jobs.
3. Send-time safety re-check suppresses reminders for non-confirmed/cancelled/declined/missing-start assignments.
4. Channel-level dedupe prevents duplicates on retries/re-runs.

## Reminder Job Fields to Verify

Each scheduled notification doc should include:

- `reminderType`
- `scheduledFor`
- `status`
- `claimedAt`
- `sentAt`
- `cancelledAt`
- `cancelReason`
- `delivery` (per-channel result for `inbox` / `push` / `sms`)
- `attempts`
- `lastError`

Common supporting fields:

- `assignmentId`
- `workerId`
- `tenantId`
- `deepLink`
- `assignmentStatusSnapshot`
- `resolvedTimezone`
- `channels`
- `maxAttempts`

## Status Expectations

- `pending`: scheduled and waiting for dispatch window
- `processing`: claimed by scheduler and currently attempting delivery
- `sent`: success rule met (durable in-app + external channel success when available)
- `cancelled`: suppressed due to ineligibility or migration cleanup
- `failed`: retries exhausted (`attempts >= maxAttempts`)

## 24h and 2h Scheduling Verification

1. Confirm worker assignment status is `confirmed` (or `active`) with future start time.
2. Inspect:
   - `tenants/{tenantId}/assignments/{assignmentId}/scheduled_notifications`
3. Verify canonical docs exist and are `pending`:
   - `assignment_reminder_24h`
   - `assignment_reminder_2h`

## Cancellation Suppression Verification

1. Set assignment status to `cancelled` or `declined`.
2. Verify pending reminder docs transition to:
   - `status = cancelled`
   - `cancelReason` populated (e.g. `assignment_status_cancelled`)

## Dedupe Keys to Verify

Notification dedupe docs are written at:

- `tenants/{tenantId}/notification_dedupe/{dedupeKey}`

Expected per-channel keys:

- `assignment_reminder_24h__{assignmentId}__inbox`
- `assignment_reminder_24h__{assignmentId}__push`
- `assignment_reminder_24h__{assignmentId}__sms`
- `assignment_reminder_2h__{assignmentId}__inbox`
- `assignment_reminder_2h__{assignmentId}__push`
- `assignment_reminder_2h__{assignmentId}__sms`

## Logs to Inspect

Function logs (prefix):

- `[worker_shift_reminders]`

Useful events:

- reminder scheduling synced
- reminder send attempt
- reminder send success
- reminder send incomplete/failure
- reminder suppressed (status/start invalid)
- reminder suppressed due to dedupe
- legacy cleanup complete

## Legacy Cleanup (One-Time Path)

Callable function:

- `cleanupLegacyWorkerShiftReminders`

Purpose:

- Cancels legacy pending docs (e.g. `shift_reminder_4h`) with audit trail.
- Optionally re-syncs canonical reminder docs for confirmed assignments.

Recommended first run:

- `dryRun: true`

Then execute:

- `dryRun: false`

No legacy docs are deleted; they are marked cancelled/migrated for auditability.

## Non-Production Test Override

Non-production only:

- `tenants/{tenantId}/messagingConfig/reminderOverrides`
  - `enabled: true`
  - `shortIntervalsMinutes: [10, 2]`

Behavior:

- Canonical reminder jobs still used
- `scheduledFor` uses short offsets for staging/QA validation
- Never applied in production project

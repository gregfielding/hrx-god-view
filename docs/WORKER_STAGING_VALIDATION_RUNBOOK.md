# Worker Staging Validation Runbook (Launch Hardening)

## Purpose

Run a single, consistent validation sequence for worker launch-critical flows and record pass/fail quickly.

Use this alongside:
- `docs/WORKER_STAGING_VALIDATION_MATRIX.md`

## Test Preconditions

- Use one known worker test account (and one recruiter/admin test account).
- Worker account has a valid phone (for SMS) and push token (if testing push).
- At least:
  - one career posting
  - one gig posting with multiple days/shifts
- Deep-link routes deployed on web.

## Recommended Execution Order (fastest signal first)

1. Web fallback deep links
2. Career happy path
3. Offer -> accept
4. Offer -> decline
5. Gig happy path (day-scoped)
6. Cancel after confirm
7. Reminder visibility / status transitions
8. Assignment detail correctness

---

## 1) Web fallback deep links

Open on mobile browser:
- `https://hrxone.com/c1/workers/assignments/test123`
- `https://hrxone.com/c1/workers/applications/test123`
- `https://hrxone.com/c1/jobs/test123`

Expected:
- no 404
- route loads app shell/page
- no dead-end nav

Record:
- PASS / FAIL
- screenshot if fail

---

## 2) Career happy path

Steps:
1. Worker applies to career posting.
2. Recruiter places/accepts worker.
3. Worker completes accept flow.
4. Verify assignment created/linked.

Expected:
- Admin: clear application -> assignment progression.
- Worker: applications + assignments reflect latest status.
- Messaging: no contradictory status message.

Record key IDs:
- `applicationId`
- `assignmentId`
- `jobId/jobPostId`

---

## 3) Offer -> accept

Steps:
1. Send/trigger offer.
2. Worker accepts from jobs/app flow.

Expected:
- worker lands on assignment detail
- status transitions to confirmed/active as expected
- no waitlist message collision

Record:
- SMS received (yes/no + template)
- final assignment status

---

## 4) Offer -> decline

Steps:
1. Send/trigger offer.
2. Worker declines.

Expected:
- decline reflected in admin + worker UI
- no assignment shown as confirmed
- no misleading follow-up notification

---

## 5) Gig happy path (day-scoped)

Steps:
1. Apply for one gig day only.
2. Verify admin applicants/placements for that specific day.
3. Confirm/accept that day.

Expected:
- worker appears only on selected/confirmed day
- no ghost applications across other days
- assignment detail shows only worker-specific day/time

Record:
- day key
- assignment doc id

---

## 6) Cancel after confirm

Steps:
1. Confirm assignment.
2. Cancel assignment from admin flow.

Expected:
- worker UI updates to cancelled state
- pending reminders are cancelled/suppressed
- no reminder sent after cancellation

---

## 7) Reminder visibility / status transitions

Inspect scheduled reminder docs and logs for tested assignment.

Expected lifecycle (example):
- `pending` -> `processing` -> `sent`
- or `pending` -> `cancelled` (if assignment cancelled)

Verify fields:
- `type/reminderType`
- `status`
- `scheduledFor`
- `attempts`
- `sentAt/cancelledAt`
- `delivery` results
- `lastError` (if failed)

---

## 8) Assignment detail correctness

Validate for both career and gig samples:
- worker-specific schedule only
- recruiter contact visible (name/phone/email fallback)
- final resolved staff instructions (no conflicting duplicates)
- uniform/critical requirements shown from effective source
- maps/directions usable
- no Inbox references

---

## Quick Result Template (copy/paste)

```txt
Run Date:
Environment:
Worker UID:
Recruiter UID:

1) Deep-link web fallback: PASS|FAIL
2) Career happy path: PASS|FAIL|PARTIAL
3) Offer -> accept: PASS|FAIL|PARTIAL
4) Offer -> decline: PASS|FAIL|PARTIAL
5) Gig day-scoped behavior: PASS|FAIL|PARTIAL
6) Cancel after confirm: PASS|FAIL|PARTIAL
7) Reminder visibility/statuses: PASS|FAIL|PARTIAL
8) Assignment detail correctness: PASS|FAIL|PARTIAL

Blocking issues:
- 

Non-blocking issues:
- 

Evidence links/screenshots:
- 
```

## Launch Decision Rule

- Launch-ready if no blocking FAIL in:
  - offer accept/decline correctness
  - gig day-scoped correctness
  - cancel/reminder suppression
  - assignment detail correctness
  - deep-link web fallback

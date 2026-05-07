# BI.1 — Bulk Invite (Tempworks → HRX → Everee migration)

A complete build plan for the new `/users/bulk-import` feature. Designed for the immediate Tempworks-migration use case (~3,000 workers across multiple entities) and reusable as a permanent tool for future bulk-onboarding events.

---

## 0. Goal + design constraints

Build a recruiter/admin tool that:
- Lives at **`/users/bulk-import`** (new tab on the existing users layout).
- Takes one file per Hiring Entity. Recruiter picks the entity, drags in a CSV, sees a preview, hits go.
- Handles **~3,000 rows per upload** reliably. Cloud Tasks fan-out, ~10–25 in-flight workers, idempotent retries.
- Matches incoming rows against existing HRX users by **email + phone** (both must agree for a confident hit). Surfaces four outcomes: net-new, existing-not-onboarded, already-onboarded-skip, duplicate-in-file.
- Stores `tempworksEmployeeIds: string[]` on the user record for audit trail.
- Triggers the same Everee onboarding primitive (`runStartOnCallEmploymentFlow`) the manual "Start on-call employment" button uses today — so the migration path produces byte-identical Everee state to the manual path.
- Sends a **migration-specific messaging sequence**: first-touch + reminders at 3 / 7 / 14 days, hard stop at 21 days.
- Exposes an **operator dashboard** with live row-state counts during the run.
- Supports **soft cancel** mid-run: stops new tasks, lets completed rows stand.

**Out of scope:**
- Migrating existing assignments (workers come in clean — future assignments created normally).
- Hard rollback (deleting already-created Everee workers).
- Per-row manual review / editing during preview (volume too high).
- Cross-branch routing in a single file (one file = one entity).

---

## 1. Architecture overview

```
┌──────────────────────────────────────────────────────────────┐
│  /users/bulk-import (React)                                   │
│  ─ Tab: New import                                            │
│    ─ Entity picker → file dropzone → preview → confirm        │
│  ─ Tab: Imports (operator dashboard)                          │
│    ─ List of jobs · live progress · cancel button · row drill │
└──────────────────────────────────────────────────────────────┘
                              │
                              │ callables
                              ▼
┌──────────────────────────────────────────────────────────────┐
│  Cloud Functions (callable surface)                           │
│  ─ parseAndPreviewBulkInvite (writes job + rows in 'preview')│
│  ─ confirmBulkInviteJob (transitions to 'queued', enqueues)  │
│  ─ cancelBulkInviteJob (sets job 'cancelling')               │
│  ─ retryFailedBulkInviteRows (re-enqueues 'failed' rows)     │
└──────────────────────────────────────────────────────────────┘
                              │
                              │ Cloud Tasks queue
                              ▼
┌──────────────────────────────────────────────────────────────┐
│  bulkInviteRowProcessor (per-row HTTP-triggered function)    │
│  ─ Reads row, checks job status (skip if cancelled)          │
│  ─ Ensures HRX user (find-or-create)                         │
│  ─ Calls runStartOnCallEmploymentFlow(userId, entityId)      │
│  ─ Captures Everee workerId on the row                        │
│  ─ Triggers migration sequence first message                  │
│  ─ Updates row status, increments job counters                │
└──────────────────────────────────────────────────────────────┘
                              │
                              │ scheduled
                              ▼
┌──────────────────────────────────────────────────────────────┐
│  bulkInviteReminderCron (every 6 hours)                       │
│  ─ Queries rows in 'invited' or 'reminded' state              │
│  ─ Fires next reminder if cadence threshold passed            │
│  ─ Marks 'failed' if past 21-day hard stop                    │
└──────────────────────────────────────────────────────────────┘
                              │
                              │ Everee webhook
                              ▼
┌──────────────────────────────────────────────────────────────┐
│  evereeWebhook.ts (extended)                                   │
│  ─ On worker.onboarding-completed: find row by evereeWorkerId│
│  ─ Mark row 'completed', increment job.succeededRows          │
│  ─ If job counts hit total → status: 'complete'              │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. Schema changes

### 2.1 NEW: `tenants/{t}/bulk_invite_jobs/{jobId}`

```ts
export interface BulkInviteJob {
  id: string;
  tenantId: string;
  hiringEntityId: string;                    // entity all rows go to
  hiringEntityName: string;                  // denormalized for dashboard

  source: 'tempworks_migration' | 'manual_csv' | 'other';
  fileName: string;
  fileChecksum: string;                      // sha256 of uploaded bytes (dedup detection)

  uploadedBy: string;
  uploadedAt: FirebaseFirestore.Timestamp;

  status:
    | 'parsing'          // CSV parse in progress
    | 'preview'          // parsed, awaiting recruiter confirm
    | 'queued'           // confirmed, tasks enqueued
    | 'processing'       // tasks running
    | 'cancelling'       // recruiter hit cancel; queue draining
    | 'cancelled'        // queue drained, no further work
    | 'complete'         // all rows terminal
    | 'failed';          // file-level failure (parse error, schema mismatch)

  // Counts (kept current by row triggers)
  totalRows: number;
  pendingRows: number;
  processingRows: number;
  succeededRows: number;
  failedRows: number;
  skippedRows: number;
  cancelledRows: number;

  // Outcome breakdown from match phase (set at preview time)
  matchOutcomes: {
    netNew: number;
    existingNotOnboarded: number;
    alreadyOnboarded: number;
    duplicateInFile: number;
    invalid: number;
  };

  // Messaging
  sequenceId: string;                        // 'tempworks_migration_v1' (hardcoded today)
  customMessageOverride?: string;            // optional per-job override of first message

  // Reminder cadence (days from invite)
  reminderSchedule: number[];                // default [3, 7, 14], hard-stop 21

  // Audit
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
  cancelledAt?: FirebaseFirestore.Timestamp;
  cancelledBy?: string;
  completedAt?: FirebaseFirestore.Timestamp;
}
```

### 2.2 NEW: `tenants/{t}/bulk_invite_jobs/{jobId}/rows/{rowId}`

```ts
export interface BulkInviteRow {
  id: string;                                // {jobId}_{rowIndex}
  tenantId: string;
  jobId: string;
  rowIndex: number;                          // for traceability to source CSV

  // Raw + normalized inputs from the CSV
  rawRow: {
    lastName: string;
    firstName: string;
    middleName?: string;
    tempworksEmployeeId: string;
    ssnLast4?: string;                       // 'xxx-xx-1234' format from Tempworks
    cellPhone?: string;
    phone?: string;
    officePhone?: string;
    email?: string;
  };
  normalized: {
    email: string;                           // lowercased
    phoneCanonical: string;                  // stripped non-digits, leading-1 dropped if 11-digit
    ssnLast4?: string;                       // last 4 digits only
  };

  matchOutcome:
    | 'net_new'
    | 'existing_not_onboarded'
    | 'already_onboarded'
    | 'duplicate_in_file'
    | 'invalid';
  matchedUserId?: string;
  matchedBy?: 'email_and_phone' | 'email_only' | 'phone_only';
  duplicateOfRowId?: string;                 // when matchOutcome = 'duplicate_in_file'

  status:
    | 'pending'                              // queued, awaiting processor
    | 'processing'                           // task running
    | 'invited'                              // first message sent
    | 'reminded_1' | 'reminded_2' | 'reminded_3'
    | 'completed'                            // Everee onboarding done
    | 'failed'                               // terminal failure
    | 'skipped'                              // already onboarded or duplicate
    | 'cancelled';                           // job cancelled before processing

  invitedAt?: FirebaseFirestore.Timestamp;
  lastReminderAt?: FirebaseFirestore.Timestamp;
  completedAt?: FirebaseFirestore.Timestamp;

  // Everee linkage
  evereeWorkerId?: string;

  errorMessage?: string;
  errorCount: number;                        // increments on each failed attempt; cap at 3

  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}
```

### 2.3 EDIT: User doc gets `tempworksEmployeeIds`

```ts
// On users/{uid} — additive optional
tempworksEmployeeIds?: string[];             // historical Tempworks IDs; latest first
```

`tempworksEmployeeIds` is an array (not single field) because the Tempworks export shows the same person can have multiple IDs over time (re-activation creates new IDs). On match, push the new ID if it's not already in the array. Used for audit trail; don't make it the primary linkage key.

### 2.4 NEW Firestore composite indexes

```
bulk_invite_jobs
  - tenantId + status + createdAt DESC
  - tenantId + hiringEntityId + status + createdAt DESC
  - tenantId + uploadedBy + createdAt DESC

bulk_invite_jobs/{jobId}/rows  (collection-group)
  - tenantId + status + lastReminderAt
  - tenantId + status + invitedAt          // for reminder cadence query
  - tenantId + jobId + status              // for per-job dashboard
  - tenantId + matchedUserId               // for "what jobs has this user been part of"
```

---

## 3. Page layout: `/users/bulk-import`

### 3.1 Route + nav

- Add `/users/bulk-import` as a tab on the existing users layout.
- Permission gate: `securityLevel >= 6` (admin-level — bulk operations affect many records).
- Two sub-tabs:
  - **New import** — entity picker → dropzone → preview → confirm
  - **Imports** — list of historical + active jobs (operator dashboard)

### 3.2 New import flow

```
Step 1 — Select hiring entity
┌──────────────────────────────────────────────┐
│  Hiring entity *                              │
│  [C1 Events LLC ▾]                            │
│                                                │
│  Pay period policy: per-event                  │
│  Worker type: 1099                             │
└──────────────────────────────────────────────┘

Step 2 — Download template
[Download CSV template] ← provides exact column layout matching Tempworks export

Step 3 — Upload file
┌──────────────────────────────────────────────┐
│                                                │
│       Drag CSV here, or click to browse        │
│                                                │
│       (one file per entity, max 5,000 rows)   │
└──────────────────────────────────────────────┘

Step 4 — Preview (after parse + match)
┌──────────────────────────────────────────────┐
│  ✓ 2,847 rows parsed                          │
│                                                │
│  Match outcomes:                               │
│   • 2,541 net new workers                      │
│   • 192 existing, not onboarded with C1 Events │
│   • 89 already onboarded with C1 Events (skip) │
│   • 25 duplicates within file (collapsed)      │
│                                                │
│  ⚠ 0 invalid rows                              │
│                                                │
│  Sequence: tempworks_migration_v1              │
│   • Day 0: invite                              │
│   • Day 3: reminder                            │
│   • Day 7: reminder                            │
│   • Day 14: final reminder                     │
│   • Day 21: hard stop                          │
│                                                │
│  [Cancel]  [Confirm and start import]         │
└──────────────────────────────────────────────┘

Step 5 — Confirmation
[banner] "Import started. 2,733 invitations queued. Track progress on the Imports tab."
```

### 3.3 Operator dashboard (Imports tab)

```
Imports
┌──────────────────────────────────────────────────────────────────┐
│ Tempworks_Events_2026-05-07.csv                                   │
│ C1 Events LLC · uploaded by Greg · 2 hours ago                    │
│                                                                    │
│ ████████████░░░░░░░░░░░░░░░░░ 47%                                │
│                                                                    │
│ 1,287 of 2,733 processed                                          │
│  • 1,201 invited     • 67 completed                                │
│  • 0 errors          • 19 in flight                                │
│                                                                    │
│ [View row detail]   [Cancel import]                                │
└──────────────────────────────────────────────────────────────────┘

(historical jobs below, completed/cancelled/failed)
```

Row detail shows the full per-row table with filtering by status. Lets you spot-check errors and retry individual rows.

---

## 4. Cloud Tasks orchestration

### 4.1 Why Cloud Tasks (not Firestore triggers, not Pub/Sub)

3,000 rows × per-row processing time (~5s for Everee + Firestore + message dispatch) = ~4 hours of wall-clock work even at single concurrency. Strategy:

- **Cloud Tasks queue** with concurrency cap of 10 in-flight.
- Each task is one row. Task body is `{ jobId, rowId }`.
- Task target: an HTTP-triggered Cloud Function `bulkInviteRowProcessor`.
- Task retry policy: 3 attempts, exponential backoff 30s → 5m → 30m.
- After 3 attempts fail, row → `'failed'`, recruiter manually retries via dashboard.

Pub/Sub would also work but Cloud Tasks gives finer-grained per-task retry policy and status visibility, which matters for a 3,000-task fan-out where some will inevitably hit Everee rate limits or transient errors.

### 4.2 `confirmBulkInviteJob` callable

```ts
// functions/src/bulkInvite/confirmBulkInviteJob.ts

export const confirmBulkInviteJob = onCall<...>(async (req) => {
  // 1. Permission gate (sec >= 6)
  // 2. Read job, verify status === 'preview'
  // 3. Update job → status: 'queued', updatedAt
  // 4. Query rows where status === 'pending' (skip 'skipped' rows from match phase)
  // 5. For each pending row:
  //    - Enqueue Cloud Task targeting bulkInviteRowProcessor
  //    - Task name = deterministic `${jobId}_${rowId}` for idempotent enqueue
  // 6. Update job → status: 'processing'
});
```

### 4.3 `bulkInviteRowProcessor` HTTP function

```ts
// functions/src/bulkInvite/bulkInviteRowProcessor.ts

export const bulkInviteRowProcessor = onRequest(async (req, res) => {
  const { jobId, rowId } = req.body;

  // 1. Read job. If status === 'cancelling' or 'cancelled' → mark row 'cancelled', return 200
  // 2. Read row. If status !== 'pending' && !== 'processing' → return 200 (already terminal, idempotent skip)
  // 3. Set row status → 'processing'

  try {
    // 4. Find or create HRX user
    //    - If matchedUserId exists, read existing user, push new tempworksEmployeeId if not in array
    //    - Else, create new user with normalized email/phone/name + tempworksEmployeeIds: [...]

    // 5. Call runStartOnCallEmploymentFlow(userId, hiringEntityId)
    //    - This wraps Everee createWorkerIfNeeded + writes user_employments doc
    //    - Returns { evereeWorkerId, ... }

    // 6. Write row.evereeWorkerId

    // 7. Trigger migration sequence first message
    //    - sendSequenceMessage('tempworks_migration_v1', userId, { firstName, entityName, deepLink })

    // 8. Update row → status: 'invited', invitedAt: now()
    // 9. Increment job counter → succeededRows++ (transactional)
  } catch (err) {
    // Increment errorCount; if errorCount < 3 → return 5xx (Cloud Tasks will retry)
    // If errorCount >= 3 → row 'failed', errorMessage, return 200
  }
});
```

Idempotency contract: every step checks pre-conditions before acting. Re-running the processor on a row already in `'invited'` state is a no-op (early return at step 2). User creation is find-or-create (no duplicate users). Everee `createWorkerIfNeeded` already idempotent per existing pattern. Message dispatch checks `invitedAt` before firing.

### 4.4 `cancelBulkInviteJob` callable

```ts
export const cancelBulkInviteJob = onCall<...>(async (req) => {
  // 1. Permission gate
  // 2. Update job → status: 'cancelling', cancelledBy, cancelledAt
  // 3. Return immediately — queue drains naturally (each task checks job status at step 1)
});
```

Once all in-flight tasks complete (each marks its row `'cancelled'` at step 1), a separate cron `bulkInviteCancellationCompleter` transitions the job from `'cancelling'` → `'cancelled'` when no rows remain in `'pending'` or `'processing'`.

---

## 5. Match + dedup logic

### 5.1 Implementation lives in `parseAndPreviewBulkInvite`

Pure function (with one Firestore read per unique email/phone for the existing-user check).

```ts
// functions/src/bulkInvite/parseAndPreviewBulkInvite.ts

export const parseAndPreviewBulkInvite = onCall<...>(async (req) => {
  // 1. Permission gate
  // 2. Validate hiringEntityId
  // 3. Receive file as base64 in payload (or signed URL for files >1MB)
  // 4. Parse CSV (use papaparse — already in the codebase per package.json)
  // 5. For each row:
  //    a. Normalize email + phone (per §5.2)
  //    b. Validate required fields (firstName, lastName, email + phone)
  //    c. If invalid → matchOutcome: 'invalid', errorMessage
  // 6. Within-file dedup:
  //    - Build map of (normalized email | normalized phone) → first-occurrence rowIndex
  //    - For 2nd+ occurrence → matchOutcome: 'duplicate_in_file', duplicateOfRowId
  // 7. Existing user lookup (only for rows that passed dedup):
  //    - Batch read users by email (Firestore `in` query, max 30 per batch)
  //    - Cross-check phone (must agree for 'email_and_phone' confidence)
  //    - For each match:
  //      - Read user_employments / everee_workers for hiringEntityId
  //      - If onboarding_complete → matchOutcome: 'already_onboarded'
  //      - Else if user exists but not onboarded for this entity → 'existing_not_onboarded'
  //    - No match → 'net_new'
  // 8. Write job doc with status 'preview' + counts
  // 9. Write rows in batches of 500
  // 10. Return job summary to client for preview UI
});
```

### 5.2 Normalization rules (`normalize.ts`)

```ts
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.substring(1);
  if (digits.length === 10) return digits;
  return '';                                 // invalid → row marked invalid
}

export function normalizeSsnLast4(raw: string): string | undefined {
  const match = raw.match(/(\d{4})$/);
  return match?.[1];
}
```

### 5.3 Match confidence

For BI.1: **email + phone both must agree**. Single-field match is treated as `'invalid'` and surfaced in the preview as a count (recruiter can fix the file and re-upload). No automatic acceptance of weak matches at this scale.

Future iteration could add fuzzy-name + DOB matching for the 1–2% of rows where phone or email is missing in Tempworks. Not in scope for BI.1.

---

## 6. Migration messaging sequence

### 6.1 Hardcoded fallback in `sequences/`

Until M.1 ships the Firestore-backed sequence loader, this build ships a single hardcoded sequence as a TS module.

```ts
// functions/src/sequences/tempworksMigration.ts

export const TEMPWORKS_MIGRATION_V1: MessageSequence = {
  id: 'tempworks_migration_v1',
  steps: [
    {
      id: 'invite',
      offsetDays: 0,
      channels: ['sms', 'email'],
      template: {
        sms: 'Hi {{firstName}}! C1 is moving from Tempworks to a new payroll system. To keep getting paid, set up your account here: {{deepLink}}. Takes 5 minutes.',
        email: { subject: 'Action required: complete your C1 payroll setup', body: '...' },
      },
    },
    {
      id: 'reminder_1',
      offsetDays: 3,
      channels: ['sms'],
      template: {
        sms: 'Reminder from C1: your payroll account is still pending. Complete here: {{deepLink}}',
      },
    },
    {
      id: 'reminder_2',
      offsetDays: 7,
      channels: ['sms', 'email'],
      template: {
        sms: 'C1 Staffing — your payroll setup is overdue. Set up by [date+14] to keep working: {{deepLink}}',
        email: { subject: 'Final week to complete payroll setup', body: '...' },
      },
    },
    {
      id: 'reminder_3',
      offsetDays: 14,
      channels: ['sms', 'email'],
      template: {
        sms: 'Last reminder, {{firstName}}. {{deepLink}} — set up by [date+7] or you\'ll be moved to inactive.',
        email: { subject: 'Last chance: complete payroll setup', body: '...' },
      },
    },
  ],
  hardStopDays: 21,
};
```

### 6.2 `sendSequenceMessage` contract

```ts
export async function sendSequenceMessage(
  sequenceId: string,
  recipientUserId: string,
  vars: Record<string, string>,
  stepId?: string,                           // omit = first step
): Promise<{ messageIds: string[] }> {
  const sequence = getSequence(sequenceId);  // hardcoded today, Firestore-backed when M.1 lands
  const step = stepId
    ? sequence.steps.find(s => s.id === stepId)
    : sequence.steps[0];
  // dispatch via existing SMS + email infrastructure
}
```

Same signature M.1 will use — when M.1 lands, swap `getSequence` from "look up in TS module" to "read from Firestore." Zero changes to callers.

### 6.3 `bulkInviteReminderCron`

Runs every 6 hours. Per-tenant scoped.

```ts
export const bulkInviteReminderCron = onSchedule('every 6 hours', async () => {
  // For each active job (status: 'processing' | 'cancelling'):
  //   For each row in 'invited' | 'reminded_1' | 'reminded_2' state:
  //     Compute days since invitedAt
  //     Check sequence's reminderSchedule [3, 7, 14]
  //     If past next threshold AND not already at that threshold:
  //       sendSequenceMessage(jobId.sequenceId, row.matchedUserId, vars, stepId)
  //       Update row → status: reminded_N, lastReminderAt: now()
  //   For each row past 21 days from invitedAt and still not 'completed':
  //     Update row → status: 'failed', errorMessage: 'No response within 21 days'
});
```

### 6.4 Completion detection

Already-built — webhook handler in `evereeWebhook.ts` for `worker.onboarding-completed` is the trigger. Extend the existing handler (`handleWorkerOnboardingCompleted`) to also:

```ts
// In handleWorkerOnboardingCompleted, after the existing onboarding_complete logic:
const matchingRow = await db.collectionGroup('rows')
  .where('tenantId', '==', tenantId)
  .where('evereeWorkerId', '==', evereeWorkerId)
  .where('status', 'in', ['invited', 'reminded_1', 'reminded_2', 'reminded_3'])
  .limit(1)
  .get();

if (!matchingRow.empty) {
  const rowDoc = matchingRow.docs[0];
  await rowDoc.ref.update({ status: 'completed', completedAt: FieldValue.serverTimestamp() });
  // Increment job.succeededRows transactionally
}
```

---

## 7. Soft cancel UX

**Behavior:**
- Recruiter clicks "Cancel import" on the operator dashboard.
- Job status → `'cancelling'` immediately.
- All in-flight tasks check job status at step 1 of the processor — if `'cancelling'`, mark row `'cancelled'` and return 200 (Cloud Task succeeds, no retry).
- Already-completed rows (status `'invited'`, `'reminded_*'`, `'completed'`) stay as-is. Their messages have already gone out; their Everee workers exist; their HRX users are real. Cancellation doesn't unmake history.
- After ~30 seconds (max task duration + buffer), `bulkInviteCancellationCompleter` cron transitions job to `'cancelled'`.

**Recruiter sees on cancellation:**
```
Import cancelled.
  • 1,287 workers fully invited
  • 1,446 cancelled (not contacted)
  • 0 errors
```

If the recruiter realizes the file was wrong AFTER 1,287 invites went out, they have to manually clean up those 1,287 in HRX. That's the cost of soft cancel — and it's the right cost. Hard rollback would be far messier (deleting half-onboarded Everee workers in the middle of their I-9 flow is a worse user experience than "we sent you a message in error, please ignore").

The "what to do about the 1,287 already-invited" cleanup is a manual recruiter task, not in scope for BI.1.

---

## 8. Phased build (Cursor handoff)

### Phase 1 — Foundation (~1 week)
- Schema: types, indexes (§2.1, 2.2, 2.3, 2.4)
- Add `tempworksEmployeeIds` to user types
- Page shell at `/users/bulk-import` with two sub-tabs
- Entity picker (reuse the `<EntityPicker />` from TS.1.P1.C.1)
- File dropzone (no parsing yet)
- Operator dashboard skeleton (empty state)
- Permission gate at sec-6

### Phase 2 — Parse + match + preview (~1.5 weeks)
- `parseAndPreviewBulkInvite` callable (§5)
- CSV parser with papaparse
- Normalization utilities (§5.2)
- Match logic with batch user lookup (§5.1)
- Preview UI with counts (§3.2 step 4)
- Within-file dedup (§5.1 step 6)

### Phase 3 — Job execution (~1 week)
- `confirmBulkInviteJob` callable (§4.2)
- Cloud Tasks queue setup (`firebase deploy --only functions:bulkInviteRowProcessor`)
- `bulkInviteRowProcessor` HTTP function (§4.3)
- Retry policy + idempotency contract
- Re-uses `runStartOnCallEmploymentFlow` for Everee onboarding
- No messaging yet — rows reach `'invited'` state on Everee success but no message sent

### Phase 4 — Migration messaging (~1 week)
- Hardcoded sequence module `tempworksMigration.ts` (§6.1)
- `sendSequenceMessage` contract (§6.2)
- Wire processor to call sendSequenceMessage at `'invited'` transition
- `bulkInviteReminderCron` (§6.3)
- 21-day hard stop (§6.3)
- Webhook completion detection (§6.4)

### Phase 5 — Operator dashboard + cancel (~1 week)
- Live progress view (subscribe to job doc with onSnapshot)
- Row detail drill-in with status filter
- Cancel button + `cancelBulkInviteJob` callable (§4.4)
- `bulkInviteCancellationCompleter` cron
- Retry-failed-rows action

---

## 9. Tests + verification

### 9.1 Unit tests
- Normalization: email lowercasing, phone canonical form (10/11-digit, leading-1, non-digit stripping), SSN last-4 extraction
- Match logic: net-new vs existing-not-onboarded vs already-onboarded vs duplicate-in-file
- Sequence step selection: offset days → correct step
- Idempotency: re-run processor on already-invited row → no-op

### 9.2 Integration tests
- End-to-end: upload 10-row file → preview → confirm → all 10 rows reach `'invited'` → Everee mock returns `worker.onboarding-completed` for 5 → those 5 reach `'completed'`
- Cancel mid-run: enqueue 100 rows, cancel after 30 → completed rows stay, remaining 70 go to `'cancelled'`
- Reminder cadence: row `invitedAt = -4 days` → cron fires reminder_1, sets status accordingly

### 9.3 Load smoke (pre-launch)
- 3,000-row CSV upload → preview returns within 60s
- 3,000-row job execution → all rows terminal within 8 hours (worst case)
- Concurrency observed at ~10 in-flight at any moment
- Zero duplicate users created across re-runs of the same file

---

## 10. Open questions to confirm before build

1. **Cloud Tasks queue setup** — do we already have a Cloud Tasks queue provisioned, or does this build need to set up the GCP queue + IAM + service account first? Check before P3.
2. **SMS/email rate limits** — sending 3,000 first-touch SMS within an hour might trip provider rate limits (Twilio, SendGrid). Confirm provider limits and stagger if needed (per-job throttle: max 100 messages per minute).
3. **Deep link target** — `{{deepLink}}` in the messages should resolve to what? Web `/c1/workers/payroll/{entityId}`? Flutter app deep link? Smart link that prefers Flutter-installed?
4. **Email vs SMS preference per worker** — some Tempworks workers may have email-only or SMS-only contact. Sequence currently fires both channels; if only one is available, fire only that one. Confirm fallback policy.
5. **Sec-6 permission scope** — is `securityLevel >= 6` the right gate, or does only the tenant owner get to bulk-import? Same gate as setAssignmentOutcome would be `>= 5`; bulk operations might warrant higher.
6. **Operator dashboard real-time refresh** — Firestore onSnapshot on the job doc gives live counters, but the per-row collection-group is too big for live subscription. Pagination or "Refresh" button instead? (Suggested: snapshot the job doc for live progress; row detail drilldown is paginated + manually refreshed.)

---

## 11. Branch + PR convention

- Branch per phase: `feat/bi1-p1-foundation`, `feat/bi1-p2-parse`, `feat/bi1-p3-execute`, `feat/bi1-p4-messaging`, `feat/bi1-p5-dashboard`
- Commit prefix: `BI.1.PX`
- PR title: `BI.1.PX — <phase title>`
- Coordinate with `.cursorrules` so other Cursor sessions don't collide on the Everee files in P3 (`runStartOnCallEmploymentFlow` consumer) and on `evereeWebhook.ts` in P4.

---

## 12. File map

**New backend files:**
```
functions/src/bulkInvite/
  parseAndPreviewBulkInvite.ts
  confirmBulkInviteJob.ts
  cancelBulkInviteJob.ts
  retryFailedBulkInviteRows.ts
  bulkInviteRowProcessor.ts
  bulkInviteReminderCron.ts
  bulkInviteCancellationCompleter.ts
  normalize.ts
  __tests__/

functions/src/sequences/
  tempworksMigration.ts
  sendSequenceMessage.ts
  index.ts
```

**Extended backend files:**
```
functions/src/integrations/everee/evereeWebhook.ts
  - extend handleWorkerOnboardingCompleted to update bulk_invite_rows
```

**New frontend files:**
```
src/types/recruiter/bulkInvite.ts
src/pages/users/BulkImport.tsx              (the /users/bulk-import page)
src/components/bulkInvite/
  EntityPicker.tsx                           (reuse from timesheets if compatible)
  FileDropzone.tsx
  PreviewPanel.tsx
  OperatorDashboard.tsx
  JobProgressCard.tsx
  RowDetailTable.tsx
src/utils/bulkInvite/
  csvParseClient.ts                          (client-side preview parse)
```

**Edited frontend files:**
```
src/layouts/UsersLayout.tsx                   (add bulk-import tab)
firestore.indexes.json                        (add new composite indexes)
```

---

## 13. Why we're NOT doing things

**Why not assignment migration:**
Greg explicitly said "purely get them in." Tempworks-side assignments stay where they are; future HRX assignments are created normally. Avoids massive scope creep.

**Why not per-row preview audit:**
3,000 rows is too many to manually review. The match logic (email + phone both required) is strict enough that false positives are rare; counts in the preview give the recruiter enough signal to detect a wrong-file mistake without per-row scrolling.

**Why not hard rollback on cancel:**
Already-sent messages can't be unsent. Already-created Everee workers may have started filling out I-9 — deleting them mid-flow is a worse user experience than leaving them and asking the recruiter to manually clean up. Soft cancel matches how real-world bulk operations work.

**Why hardcoded sequence (not waiting for M.1):**
The Tempworks migration timeline is concrete and shouldn't block on the conversation engine's full rollout. The hardcoded sequence + `sendSequenceMessage` contract is the M.1 architecture — when M.1 lands, swap the sequence source from TS module to Firestore with zero caller changes.

**Why Cloud Tasks (not Firestore triggers, not Pub/Sub):**
Cloud Tasks gives explicit per-task retry policy, concurrency caps, and rate limiting that fit a 3,000-row fan-out. Firestore triggers don't give us the rate limiting; Pub/Sub doesn't give us the per-task observability the operator dashboard needs.

**Why not storing full SSN:**
Tempworks export only has SSN last-4. Even if we had full SSN, this build doesn't need it — Everee handles SSN collection during onboarding. Last-4 is stored for future tiebreaker matching only, never as the primary identity field.

---

## Appendix A — Approved schema amendments (2026-05-07)

The original plan above is preserved as-written. The following amendments were proposed against it after a recon pass and approved by Greg before BI.1.P1 build began. **Implementation must follow the amended spec, not the original.** Each amendment cites the §reference it modifies in the original plan.

### A.1 Drop SSN last-4 from `BulkInviteRow` (amends §2.2)

`rawRow.ssnLast4` and `normalized.ssnLast4` are removed entirely. Match logic uses email + phone only (both required). If future fuzzy matching ever needs SSN, persist hashed last-4 then — not plaintext on rows that live forever. Aligns with `.cursorrules` "Redact sensitive data (phone, SSN)."

### A.2 Add `nextReminderDueAt` to `BulkInviteRow` (amends §2.2 and §6.3)

```ts
nextReminderDueAt?: FirebaseFirestore.Timestamp;
```

Set by the row processor on the `pending → invited` transition (`invitedAt + 3d`) and updated by the reminder cron as it walks forward through the cadence. Cleared (or set to null) when the row reaches a terminal state (`completed` / `failed` / `cancelled`).

The reminder cron query becomes a single-field range:

```ts
db.collectionGroup('rows').where('nextReminderDueAt', '<=', now).limit(BATCH);
```

Replaces the `where status in [...] and invitedAt > X` pattern, which Firestore can't efficiently serve (the `in` operator on `status` defeats range filtering on `invitedAt`).

### A.3 Add `lastEvereeProvisionWarning` + `evereeProvisionedAt` to `BulkInviteRow` (amends §2.2)

```ts
lastEvereeProvisionWarning?: string;
evereeProvisionedAt?: FirebaseFirestore.Timestamp;
```

`runStartOnCallEmploymentFlow` returns `evereeProvisionWarning?: string | null` separately from hard errors — on-call employment can succeed (row reaches `invited`, message dispatched) while Everee provisioning failed. Without these fields the row would silently sit in `invited` with an empty `evereeWorkerId`. Dashboard can show "1,287 invited (12 with Everee retry needed)" instead of conflating with hard failures.

### A.4 Document `errorCount` cap as a constant (amends §2.2)

```ts
errorCount: number; // default 0; cap at CAP_ERROR_COUNT (= 3); on hit, row → 'failed'
```

Cosmetic, but explicit > implicit on the contract. The constant lives next to the processor implementation in P3.

### B.1 Counters become eventually-consistent on `BulkInviteJob` (amends §2.1 and §4.3 step 9)

The counter fields (`pendingRows`, `processingRows`, `succeededRows`, `failedRows`, `skippedRows`, `cancelledRows`) are NOT incremented transactionally from the row processor. Instead a 1-min `bulkInviteJobReconciler` cron computes them from a counted query of the rows subcollection.

**Rationale:** at 10 in-flight processors × ~5s/row = 2 transactional writes/sec on the same job doc, right at Firestore's single-doc soft limit. Adding reminder-cron + webhook-completion writes pushes us over. Eventual consistency with ~60s lag is acceptable for a multi-hour run; "retry failed rows" stays trivially correct because counters re-derive themselves.

**Contract:** the row processor writes ONLY the row's own status. Do not reach for `db.runTransaction` to bump job counters from row code. The reconciler ships in P3 alongside the processor.

### B.2 Add `queueName` to `BulkInviteJob` (amends §2.1)

```ts
queueName?: string; // Cloud Tasks queue used for this job's row tasks; default 'bulk-invite-rows'
```

Audit + future re-enqueue (retry-failed-rows uses the same queue) + bad-deploy detection (a job whose queueName no longer exists fails loud).

### B.3 Add `uploadedBySecurityLevel` to `BulkInviteJob` (amends §2.1)

```ts
uploadedBySecurityLevel: number; // captured at upload time
```

Audit hygiene: if we tighten or loosen the gate later, we still know which historical jobs ran under which gate. Cheap and load-bearing for compliance review.

### C.1 User-doc additions (amends §2.3)

```ts
// On users/{uid} — additive optional
tempworksEmployeeIds?: string[];                                    // unchanged from original §2.3
migrationSource?: 'tempworks_bulk_invite' | 'manual_csv' | 'other'; // NEW
migratedAt?: FirebaseFirestore.Timestamp;                            // NEW
```

**Constraints:**
- Only `bulk_invite_jobs` running with `source: 'tempworks_bulk_invite'` set `migrationSource: 'tempworks_bulk_invite'`. Other sources leave the field unset until those code paths are written.
- `migratedAt` is set ONLY on the user's first touch by any bulk-invite job (don't reset on subsequent runs).
- No backfill of existing users with `'manual_csv'` or `'other'` — out of scope for BI.1.

Unblocks future audit queries like "which workers came in via the Tempworks migration vs normal recruiter flow."

### D Indexes (amends §2.4)

`bulk_invite_jobs/{jobId}/rows` collection-group indexes — final list (replaces original §2.4 row-index list):

```
- tenantId + nextReminderDueAt ASC          // reminder cron + 21-day hard-stop sweep
- tenantId + jobId + status                 // per-job dashboard
- tenantId + matchedUserId                  // "what jobs has this user been part of"
- tenantId + evereeWorkerId                 // P4 webhook completion lookup
                                             //   (handleWorkerOnboardingCompleted matches by
                                             //    evereeWorkerId on the rows collection-group;
                                             //    missing in original §2.4 — would full-scan)
```

The three original indexes (`+ status + lastReminderAt`, `+ status + invitedAt`, and `+ status + invitedAt`) are dropped — they don't help once status filtering moves out of the cron query.

`bulk_invite_jobs` indexes are unchanged from original §2.4.

### E Permission gate (amends §3.1 and §10 Q5)

The bulk-import page is gated at `securityLevel >= 7` (admin-only), not the original `>= 6` (senior recruiter / admin). Rationale: bulk operations affect 3,000+ records and trigger external state (Everee provisions + Twilio SMS sends — real money). "Tighten first, loosen on actual demand" matches HRX product posture for high-blast-radius features. The B.3 audit field means we keep full visibility into the gate's history if it ever loosens.

---

## Appendix B — Open questions parked for later phases

These are tracked but don't block P1:

- **Q3 (deep link target).** Smart link (prefers Flutter-installed, falls back to web) is the recommended direction. Decision needed before P3 message dispatch implementation.
- **Q1 (Cloud Tasks queue provisioning).** Provision dedicated `bulk-invite-rows` queue (~5 min GCP) before P3.
- **Q2 (SMS rate limit).** Twilio 1/sec/sender per `.cursorrules`. Bake throttle into `smsOutboundQueue`, not BI.1. Decouple message dispatch from row processing — don't `await` SMS inside `bulkInviteRowProcessor`.
- **Q4 (channel preference).** Try preferred channel first, fall back on dispatch failure. Don't burn 3 retries on a typo'd email.
- **Q6 (dashboard refresh).** Job-doc `onSnapshot` for live counters; row detail paginated + manual refresh.

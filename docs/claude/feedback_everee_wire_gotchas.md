# everee wire gotchas

# Everee API wire-shape gotchas

Two wire-shape mismatches discovered during the Slice 6b sandbox
operational smoke (2026-05-22). Both would have blocked every
real production submission. Both are now fixed in main (PR #26)
+ deployed.

Capturing here because the Everee docs don't surface either —
both required live API probing to discover.

## 1. `/api/v2/work-locations` POST body is FLAT, not nested

Initial wrong shape (rejected with `422 'city' must not be blank`
or `'postalCode' must not be blank`):
```ts
{ externalId, name, address: { addressLine1, city, state, postalCode, country } }
```

Correct shape:
```ts
{ externalId, name, line1, city, state, postalCode, country }
```

Address fields are at the **top level**, AND the street field is
`line1` (NOT `addressLine1`, despite that being what other Everee
endpoints accept). Fixed in `evereeWorkLocations.ts`.

## 2. `externalWorkerId` ≠ Everee `workerId` (UUID)

In Everee's vocabulary, `externalWorkerId` is the
**partner-system id** they store on the worker record. For HRX,
that's the firebase uid. Verified via `GET /api/v2/workers/<uuid>`:
```
externalWorkerId: TWXMM1mOJHepmk80Qsx128w9AiS2  ← HRX uid
```

Our linkage docs + `users/{uid}.evereeWorkerIds` denorm both
store the Everee UUID (workerId), and the old `resolveExternalWorkerId`
was returning that UUID. Sending UUID in worked-shift POST →
`404: resource does not exist`. Sending HRX uid → reaches business
validation.

Fixed via `functions/src/payroll/workerContextResolver.ts`:
- `resolveExternalWorkerId(tenantId, workerId, evereeTid)` —
  confirms linkage exists, returns `workerId` (HRX uid)
- `resolveEvereeWorkerUuid(...)` — for callers that need the UUID
  (e.g. `GET /api/v2/workers/{uuid}` reconcile paths)

## 3. `/api/v2/payments` ignores external-worker-id filter

This was discovered when wiring up the Recent Pay card v2 (PR #23).
Passing `?external-worker-id=<uid>` on `/api/v2/payments` returns
**the full unfiltered tenant-wide list** — Everee silently ignores
the param. Server-side filtering uses `employee-id` (numeric Everee
id), which our linkage docs don't carry.

Workaround in `mapPaymentsToPayHistory`: fetch big page (500) and
filter client-side by `payment.employee.externalWorkerId`. Pass
BOTH HRX uid AND Everee UUID as candidate match keys (dual-key
filter) because linkage data is mixed across waves — some workers
have HRX uid as externalWorkerId on Everee, others have UUID due
to schema drift in older onboarding code.

## 4. `/api/v2/payables` POST: `timestamp` must be ISO-8601, not epoch seconds

Discovered 2026-05-25 via the sandbox dummy-data smoke (3 synthetic
1099 entries on Everee 2320). Everee deserializes the payable
`timestamp` into `java.time.LocalDateTime`, which rejects a raw
integer:
```
400 "JSON parse error: raw timestamp (1779120000) not allowed for
 java.time.LocalDateTime: need additional information such as an
 offset or time-zone"
```
This is **payable-specific** — `worked-shifts` accepts epoch seconds
without complaint. Fix is to convert at the wire boundary
(`payableWireBody()` in `evereePayables.ts`); callers can still pass
`timestamp: number` (epoch seconds) on the type interface.

## 5. `/api/v2/payables` POST: `verified` is required (not nullable)

Same smoke run. After fixing #4, second attempt failed with:
```
422 "Validation failed: 'verified' must not be null"
```
The field isn't in our `CreatePayableInput` type. For partner
submissions (we're submitting on behalf of a recruiter who already
approved the entry), `verified: true` is the right default. Stamped
in the same `payableWireBody()` helper so all three payable endpoints
(create / bulk-create / update) get it.

## 6. `PUT /api/v2/workers/{id}/address` — update existing worker's home address

Discovered 2026-05-26 while looking for a way to push the right home
address into existing Everee records that were created with empty or
stub homeAddress (Pamela McDonald and the contractor cohort). The
worker endpoint itself rejects PATCH/PUT/POST with 405, but the
`/address` sub-resource accepts PUT with the same flat body shape
the worker-create endpoints use:

```ts
PUT /api/v2/workers/{workerId}/address
body = { line1, line2?, city, state, postalCode }
```

Returns 200 with the full updated worker; `homeAddress.current` is
replaced immediately. Sibling endpoints that also exist (all
PUT-only): `/api/v2/workers/{id}/contact-info`,
`/api/v2/workers/{id}/personal-info`.

⚠️ 2026-06-17 CORRECTION: the body now ALSO requires `effectiveDate`
(YYYY-MM-DD). Everee added a non-null check — without it the PUT 500s:
`"effectiveDate is marked non-null but is null"`. This made "Push data to
Everee" throw an opaque internal error. Surfaced while fixing Marquis Dennis,
whose Everee record carried a sandbox STUB home address ("1 Sandbox Way, San
Francisco, CA 94105") that Everee used as his **legal work location** → his
PA worked shift was rejected with "Invalid workers comp code 2922 for CA" (see
§9). Fixed in `evereeService.ts` `updateEvereeWorkerAddress` — body is now
`{ line1, line2?, city, state, postalCode, effectiveDate }`, effectiveDate
defaults to today (optional param backdates it so a corrected address covers
already-worked unpaid shifts). The legal work location = the worker's home
address, so a stale/stub home address silently mis-routes WC + state taxes.

## 7. `worked-shifts` POST: `fullyClassifiedHours` is REQUIRED (no auto-classify)

Discovered 2026-06-17 on the first real CSV-import W-2 submit (all 39 rows
400'd): `"The field 'fullyClassifiedHours' is required"`. "Fully Classified
Shifts" is enabled on every C1 instance, so the endpoint does NOT auto-classify
OT when you omit it — it rejects. The CSV importer had deliberately omitted it
expecting Everee to compute OT. Fix (`submitImportTimesheetBatch.ts` submitW2):
send a single `REGULAR_TIME` segment per day (imported daily totals have no
clock detail + the canonical entry stores them straight-time). Consequence:
**daily/weekly OT is NOT auto-applied** for imports — Everee takes our
classification as final. A real multistate OT classifier is a future need.

## 8. `worked-shifts` window is FLOORED to the whole minute; classified segment is full-precision

Same submit, second error (500): `"shift (X) duration is 05:59:00; classified
duration is 05:59:24; unpayable duration is 24s"`. Everee floors the worked-shift
window (`shiftStart..shiftEnd`) to the whole minute but evaluates the
`fullyClassifiedHours` segment at full precision — so a synthetic window of
`start + round(hours*3600)` for a fractional hour (5.99h = 5:59:24) gets floored
to 5:59:00 while the classified hours stay 5:59:24 → unpayable overage. Rows with
clean whole-minute hours (8.0, 8.5) succeeded; fractional ones failed. Fix:
`minuteAlignedDay()` snaps the day to the nearest whole minute and derives the
window, the segment, AND the gross from that one value. Verified live: Amauri
5.99h → 05:59 / $107.70 in Everee. Pay delta ≤30s/day (standard minute rounding).

## 9. WC class code is validated against the shift's WORK-LOCATION STATE

Same submit, 2 residual failures (404): `"Invalid workers comp code 2922 for CA"`.
2922 is a valid PA code (other PA workers in the same batch used it fine) — Everee
rejected it because it evaluated the shift against **CA**, i.e. the worker's Everee
**default work location** state, since the imported worked shift sent no
`overrideWorkLocationId`. WC validity is keyed to where the work is performed. So
a worker whose Everee profile defaults to one state, working in another, needs the
shift's work location overridden to the real state (or the state-correct WC code).
For CSV imports this bites workers with no covering assignment/worksite to resolve
an Everee `workLocationId` from (e.g. a manually-reassigned worker). Fix is data,
not code: set the worker's work location in Everee, or send a work-location
override on the shift.

## 10. payable `earningTimestamp` must be ON OR AFTER the worker's start date

Discovered 2026-06-17 on the first real VenueSmart/Connect Team 1099 batch (all
264 payables 400'd): `"'earningTimestamp' must be on or after worker's start
date (earningTimestamp: 2026-06-12T..., workerId: ...)"`. The contractors were
onboarded to Everee AFTER the work week (their `hireDate` = Jun 13 — confirmed
via `GET /api/v2/workers/{uuid}`, which exposes `hireDate` + `legalWorkAddress.
current.startDate`), so any payable dated before the hire date is rejected.

Note `position.scheduledChangeValidation.earliestEffectiveDate` on the worker =
the current start date, i.e. Everee won't let you BACKDATE the start before it —
so fixing the hire date to cover past work isn't an option.

Fix (`submitImportTimesheetBatch.ts` submit1099): stamp every CONTRACTOR payable
at the PAY DATE (today) instead of the work date — contractor pay isn't tied to
a specific work day, today is always ≥ the hire date, and the real work date
stays in the pay-stub label + the HRX entry. W-2 worked shifts keep work-date
timestamps (dates matter there for OT/state) — W-2 workers in this tenant were
onboarded before their work so they don't hit this.

## 11. Creating payables ≠ a payment — you must REQUEST PAYOUT to surface them

Discovered 2026-06-17, right after the VenueSmart 1099 batch finally POSTed:
HRX said "264 submitted ($38,974.88)" but NOTHING showed in Everee's Payments
tab. `POST /api/v2/payables/bulk` only creates raw payable line items; they
don't become a "Needs Approval" PAYMENT until `POST /api/v2/payables/payment-
request` (requestPayablePayout) groups them. The regular payroll flow
(`finalizeTimesheetBatch.ts`) calls it; the CSV-import 1099 path
(`submitImportTimesheetBatch.ts` submit1099) did NOT — so payables were created
but invisible/unpaid. Fixed: submit1099 now calls requestPayablePayout for the
externalIds it created (`{ externalIds, includeWorkersOnRegularPayCycle: false }`,
idempotent — Everee dedupes already-paid). It does NOT auto-pay (the resulting
payment still needs approval in Everee). Also note: `bulkCreatePayables` reports
"submitted" by echoing the INPUT externalIds when the response omits an
`externalIds` array — so the HRX submitted-count can overstate; verify against
Everee (listPayables / the Payments tab), not the count alone.

Reminder: 1099 (payables) needs this payout step; W-2 (worked shifts) does NOT —
worked shifts flow straight into Everee's regular payroll run.

## 12. Onboarding-login lockout — use the EMBEDDED create + `accountSetupEnabled:false`

Discovered 2026-06-23 (Destinee Williams, C1 Events 1099): worker got an Everee
account she couldn't log into ("you already have an account / locked from too many
password attempts"), stuck at the "Welcome back, sign in" wall. **Not** a data/timing
problem (address is gated + DOB sent). Root cause = we forced workers into Everee's
HOSTED, login-based onboarding. Two fixes (commit `f3c4ce93`, `evereeService.ts`):

1. **1099 was created via the NON-embedded `/api/v2/onboarding/contractor`** (which
   sets the worker up for hosted login onboarding), while **W-2 already used the
   embedded `/api/v2/embedded/workers/employee`**. Switched 1099 to the matching
   **`/api/v2/embedded/workers/contractor`**. Schema differs: `startDate` (not
   `hireDate`), `payeeType:'INDIVIDUAL'`, **no `legalWorkAddress`** (W-2-only / captured
   in onboarding); home address + DOB still sent. The embedded create returns a minimal
   body (just echoes our uid as `id`), so the existing `GET /api/v2/workers/external/{uid}`
   fallback resolves the canonical `workerId` for linkage.
2. **Embedded `/api/v2/embedded/session` (ONBOARDING) now sends
   `experienceOptions:{ accountSetupEnabled:false }`.** Per Everee docs this means "no
   login account or password will be created, and the worker won't be able to sign into
   Everee outside your application." So workers onboard entirely inside HRX — no
   everee.com password, no lockout. Safe because ALL worker-facing Everee access (pay
   stubs, deposits, tax docs) already flows through embedded sessions minted by
   `workerId` (the session IS the auth) — no direct everee.com login is needed anywhere.
   Default is `true`; we only set it for `experience === 'ONBOARDING'`.

Fixes new workers going forward; already-stuck workers may unblock on a re-minted
session (onboarding skips the login step), else use the hosted-recovery link
(`evereeGetHostedOnboardingUrl` / `evereeSendHostedOnboardingLink`, different signing
context) or Everee support with the worker id. See [[feedback_everee_antifraud_address]].

## 13. Undocumented WC-codes CRUD — FULLY MAPPED + PROVEN (sandbox 2320)

**2026-07-14/15 UPDATE — the sync WORKS. Full CRUD confirmed by live probe**
(sandbox left clean; both test codes deleted). Everee's PUBLIC docs expose NO
WC endpoint (developer.everee.com/llms.txt) — this whole surface is
undocumented, discovered by OPTIONS/validator probing:

| op | call | notes |
|----|------|-------|
| LIST | `GET /api/v2/workers-comp/list` | `{items[],pageSize:20,pageNumber,totalPages}` — PAGINATED |
| CREATE | `POST /api/v2/workers-comp` | body `{code,name,rateER,state,rateEE?}` → `{id,displayName}` |
| UPDATE | `PUT /api/v2/workers-comp/{id}` | FULL body; rate change 2.45→3.99 verified 200 |
| DELETE | `DELETE /api/v2/workers-comp/{id}` | 204 |

- **Required fields** (learned from 422s one at a time): `code`, `name`,
  `rateER`, `state`. `rateEE` defaults 0. `displayName` is server-derived
  as `"{state} - {name}"`. `rate` is NOT a field — it's **`rateER`** (employer).
- `GET /api/v2/workers-comp` → 405 (POST only). `GET .../{id}` → 405. PATCH → 405.
- ⚠️ **Duplicate POST → HTTP 500** (not 409): `duplicate key value violates
  unique constraint "workerscompclass_company_state_code_ukey"`. Unique key is
  **(company, state, code)** → a LIST-FIRST ensure is mandatory; never blind-POST.
- ⚠️ **DELETE returns an EMPTY body** → `evereeRequest` throws "Unexpected end of
  JSON input" (it JSON.parses unconditionally). Needs a void-tolerant path.
- ⚠️ WC codes are **per Everee company** → must push to EACH entity tenant
  (prod 3133 C1 Select + 3138 C1 Events); HRX `workers_comp_rates` is tenant-level.
- ⚠️ Local ts-node runs need **Node 20** (`export PATH="$HOME/.nvm/versions/node/
  v20.19.3/bin:$PATH"`) — repo default node is v16, which has no global `fetch`,
  so `evereeRequest` dies with "fetch is not defined". Cf. [[feedback_local_functions_run_parity]].

**HRX side (reviewed 2026-07-15):** canonical = `tenants/{tid}/workers_comp_rates`
docs `{state, code, rate, jobTitles[], modifierAccountId?}` → maps cleanly:
state→state, code→code, **rate→rateER**; `name` has NO HRX source (derive from
jobTitles[] or add a field — open question). Built into maps by
src/utils/workersCompRateMaps.ts; entered via EditWorkersCompDialog
(setEntryWorkersComp callable) + account.workersCompCode/Rate; cascades
account→JO→shift→entry; already sent per-shift as `workersCompClassCode`.
**Data audit 2026-07-15: 23 docs / 22 distinct state+code / 8 account-scoped
(modifierAccountId) / ZERO rate conflicts** → compatible with Everee's
one-rate-per-(state,code) constraint. NOTE: if a future account-scoped rule ever
sets a DIFFERENT rate for an existing state+code, Everee cannot represent it.

**Why the sync matters (Greg 2026-07-15):** codes+rates must exist in Everee
BEFORE a shift referencing them is sent (else "Invalid workers comp code X for
{state}", cf. §9) — and C1 adds new codes/rates constantly, so dual entry is the
pain. Build = `ensureWorkersCompCode` (list→create-or-PUT-if-rate-changed,
mirroring `ensureCustomPayCode` in evereePayCodes.ts) + onWrite trigger on
workers_comp_rates + backfill of the 23 + per-entity fan-out. NOT YET BUILT.

## (historical) original discovery note: `POST /api/v2/workers-comp`

Discovered 2026-07-14 investigating Greg's ask to sync HRX WC codes → Everee.
Everee's PUBLIC docs (developer.everee.com/llms.txt) expose NO workers-comp
endpoint — the only documented WC touchpoint is the per-shift
`workersCompClassCode` param on worked-shifts (HRX already sends it, cascade-
resolved JO-level code; Everee computes the WC expense at payroll run). BUT
live sandbox (2320) OPTIONS probing found an UNDOCUMENTED endpoint:
`OPTIONS /api/v2/workers-comp` → 200 `Allow: POST, OPTIONS` (GET → 405). So
a POST-only create endpoint exists; no confirmed GET/list (the
`/api/v2/companies/workers-comp-codes` 400 was a routing artifact — it parsed
the trailing segment as a company-id path param, not a real sub-resource).
POST body shape is UNKNOWN (undocumented) — do NOT reverse-engineer it blind
against prod; WC codes+rates tie to C1's actual comp INSURANCE POLICY / state
filings, so confirm the payload with Everee support (Piers) first, or do a
`POST {}` validation probe on sandbox 2320 to read required-field errors.
HRX canonical WC source = `tenants/{tid}/workers_comp_rates` docs
({state, code, rate, jobTitles[], modifierAccountId?}); built into lookup maps
by src/utils/workersCompRateMaps.ts; entered via EditWorkersCompDialog
(setEntryWorkersComp callable) + account.workersCompCode/Rate; cascades
account→JO→shift→entry. A sync would mirror `ensureCustomPayCode` in
evereePayCodes.ts (list-or-create idempotent provisioner) triggered on WC-code
entry. OPEN QUESTION whether a push-sync is even needed: if Everee already has
all C1's codes configured from the policy, per-shift sending suffices; sync
matters only for NEW codes Everee doesn't yet know (unknown code → shift
submit fails, cf. §9 "Invalid workers comp code 2922 for CA").

## 17. Worked-shift ids serialize as JSON STRINGS; list pagination is `size`+`page` (0-based)

Discovered 2026-07-23. POST/PUT/GET worked-shift responses carry
`"workedShiftId": "3792221"` — a STRING. The old createWorkedShift parse
required `typeof === 'number'`, so EVERY submit stamped `workedShiftId: 0`
into `timesheet_import_payables` (197 rows) and `"0"` onto entry
`everee.workedShiftId` — void/correction/PUT-idempotency flows couldn't
address any shift (and the grid path would POST duplicates instead of PUT).

⚠️ **THE 2026-07-23 FIX WAS LOST** — commit `8b94a915` only ever lived on
unmerged branch `claude/funny-hodgkin-906dd1` (same failure mode as
[[feedback_tenantids_map_creation_paths]]), so every later deploy from main
shipped the number-only parse again and 175 MORE zero-id rows accumulated
by 2026-08-13.

**Re-fixed + DEPLOYED 2026-08-13** (commit `a108cee6` on branch
`claude/adoring-heyrovsky-e727fc` — ⚠️ merge to main or it dies again;
supersedes funny-hodgkin, which can be deleted). Superset of the old fix:
- `parseWorkedShiftId()` exported from `evereeWorkedShifts.ts` (number or
  numeric string; createWorkedShift warn-logs `raw` when unparseable);
  pinned by `__tests__/everee/parseWorkedShiftId.test.ts`.
- `submitTimesheetEntryWorker` reads `everee.workedShiftId` through the
  parser (was number-only `numericOrUndef` → stored STRING never matched →
  every grid retry POSTed a duplicate shift). NOTE: numericOrUndef itself
  left alone — it also feeds totalFlsa/NonFlsaOTHours where 0 is valid.
- `voidImportTimesheetPayable` self-heals a zero-id status doc: lists the
  worker's shifts and deletes only on a UNIQUE workDate + "Imported from
  <customer>" note-prefix match (`recoverImportWorkedShiftId`).
- `listWorkedShifts()` typed wrapper (size+page 0-based, `{items,totalItems,
  totalPages,pageNumber}`).
- Deployed scoped: submitImportTimesheetBatch, voidImportTimesheetPayable,
  submitTimesheetEntryWorker. Env-file gotcha: deploying from a WORKTREE
  needs root `.env` + `functions/.env*` copied in first (all gitignored) —
  predeploy copy-env otherwise strips every secret from the deployed fns.

**Backfill #2 ran 2026-08-13** (`.scratch/backfill-import-workedshift-ids.ts`,
main checkout): 172/175 zero-id submitted status docs + paired import
entries stamped via unique note+date match (Zaon Cox's two pre-uid-swap
rows matched through a dead→live uid alias). The 3 leftovers are CORRECT
zeros — shifts deliberately deleted in Everee and paid another way; do NOT
void/resubmit them: Aaron Ortiz 7/11 (§16 manual pay), Ryane Singleton +
James Meyer 7/24 (§20 off-cycle retro pay run 1361749).
~77 GRID-path entries with `everee.workedShiftId == "0"` still need a
separate repair (no note-date to match on) — until then, revert on those
entries SILENTLY skips the Everee delete (revertSentTimesheetEntryToDraft
only deletes when id > 0), leaving live shifts behind.

Pagination on `GET /integration/v1/labor/timesheet/worked-shifts`: the
accepted params are **`size` + `page` (0-BASED)** — `page-size`,
`page-number`, `pageSize`, `pageNumber` are all silently ignored (you get
page 0 of 20 forever; a naive loop sees duplicate items, not progress).
Envelope: `{items, pageSize, pageNumber, totalPages, totalItems}`.

Pagination on `GET /integration/v1/labor/timesheet/worked-shifts`: the
accepted params are **`size` + `page` (0-BASED)** — `page-size`,
`page-number`, `pageSize`, `pageNumber` are all silently ignored (you get
page 0 of 20 forever; a naive loop sees duplicate items, not progress).
Envelope: `{items, pageSize, pageNumber, totalPages, totalItems}`.

## 18. "No hourly position present" (worked-shifts 500) = W-2 employment not ONBOARDING-COMPLETE — no shortcut

Discovered 2026-07-31 (Jul 19 VenueSmart import, 28 rows, all `500 "No hourly
position present"` on `/integration/v1/labor/timesheet/worked-shifts`). A W-2
worked-shift must attach to an **hourly position**, which only exists once the
worker's employment in that Everee company is **onboarding-complete (Active)**.
- The workers HAD C1 Select (3133) Everee records (real `workerId`s) — but their
  C1 Select status was **"Onboarding"** ("Direct deposit: Not started", "Employer
  I-9: Waiting on worker"). A worker RECORD existing ≠ a finalized position.
- **"Push data to Everee" does NOT create the position.** It re-sends the embedded
  employee create (which DOES include `payType:'HOURLY'` + `payRate`), yet the
  500 persisted after pushing (proven live on Israel De Julian Iira). The position
  is gated on onboarding completion, not on the pay-rate push. No API to create a
  position directly (endpoint inventory has none; `/embedded/workers/employee` is
  the only position-establishing call, at onboarding). A job title (janitor /
  warehouse associate) is irrelevant — not a classification problem.
- **Unpayable ≠ this.** "Unpayable" is a POST-acceptance state (payment created,
  worker has no direct deposit yet) and applies to **1099 payables** — submit them,
  they sit unpayable, pay once the bank is set. Worked-shift "no position" is a
  HARD REJECT at creation, never reaches unpayable. So you CANNOT "just submit W-2
  and let them sit unpayable" the way you can with 1099.
- **The working path for a mid-onboarding worker: pay 1099.** Same workers were
  **"C1 Events: Active"** (fully onboarded as contractors) → payables/off-cycle
  pay them fine (Deion Wilson $152 proved it). To keep them W-2, they must finish
  C1 Select onboarding (worker: direct deposit + I-9 + W-4; employer: I-9) — nudge
  via the profile's "Resend payroll link"; once Active, worked-shifts go through.

## 20. Off-cycle payout MUST set includeWorkersOnRegularPayCycle:true for W-2 (fixed 2026-07-31)

After §19 (added the payout request), off-cycle payments for **W-2 workers on a
regular pay cycle** STILL didn't pay: the payout used `includeWorkersOnRegular
PayCycle: false` (copied from submitImportTimesheetBatch, where it's right for
1099), which makes Everee SKIP regular-cycle workers — leaving the payable to
ride the next regular run. For a RETRO whose period is already closed (a lost
Friday), that run never comes → the payable orphans (ungrouped, invisible in
Payments, never pays). Ryane $171 / James $109.68 stuck this way; Kyle $85.50
paid only because his 07-19 run was still open when his payable was created.
Fix (`offCyclePayments.ts`): set it **true** — an off-cycle payment is meant to
pay NOW; scoped to the created externalIds so only that payable is grouped;
no-op for 1099. **Recovery for the already-stuck ones**: `requestPayablePayout
(cfg, {externalIds:[...], includeWorkersOnRegularPayCycle:true})` per entity
(`.scratch/force-offcycle-payouts.ts`) → grouped into a fresh pay run
(1361749 C1 Select Ryane+James, 1361750 C1 Events Patricia); still needs
approval in Everee to pay.

**"Lost Friday" pattern + orphaned-shift cleanup:** a worked-shift SUBMITTED
AFTER the week's Everee run already closed orphans in the paid period (verified,
unpaid, doesn't auto-pay — §16). To fix, pay the missing day via off-cycle AND
delete the orphan shift so it can't later double-pay. **Plain `deleteWorkedShift`
400s** on a shift in a paid period (period-lock); **`deleteWorkedShift(cfg, id,
{correctionAuthorized:true})` succeeds** for an UNPAID orphan (verified gone).
Prevent recurrence: don't approve the Everee pay run until the whole Sun–Sat
week is imported+submitted. Audit tool: `.scratch/audit-friday-shorts.ts`
(CSV worked-hours vs Everee paid-hours per worker).

## 22. Mon–Sun workweek exception — `payWeekStart:'monday'` on the ACCOUNT (built 2026-07-31)

VenueSmart pays its crew on a Mon–Sun week; C1 Select's Everee pay cycle is
company-wide Sun–Sat ("Contact us to change" — not per-worker; worker Job
panel shows it read-only). Resolution: **move the OT math, not the dates.**
FLSA allows a fixed alternate workweek per worker group, and the workweek
need not match the pay period. Greg proposed date-shifting (report Mon as
Sun) — REJECTED: WC claims + wage records key off real work dates; a
date-mismatched injury claim is the worst failure mode.

Implementation (commit `feat(payroll): Mon–Sun FLSA workweek exception`):
`accounts/{id}.payWeekStart:'monday'` → submitImportTimesheetBatch resolves
per row (entry.accountId, else entry.jobOrderId→JO.recruiterAccountId — import
rows usually carry only the JO link) and threads through `weekKeyFor(date,
weekStart)`, classifyWeeklyOt grouping, priorWeekSecondsForBatch windows, and
the composeImportWindow overnight clamp (boundary Sunday 23:59 for Mon-weeks).
Flagged: **Venuesmart LLC National `m1JEJs8YPohuXTQVjVQp`** (all 5 W-2 crew
resolve to it via the travel-team JO X4Zav0bM6fMB18B6yDiA). Everee's payment
calendar unchanged: a Sunday shift rides the NEXT weekly run (+1 week timing,
dollars exact) — or pay Sundays off-cycle if same-check matters.

Open items: (a) ask VenueSmart to send BASE rates only — their sheet encoded
Sunday at $27.60 (=1.5×18.40, their Mon–Sun OT); with HRX now computing
Mon–Sun OT, premium-encoded rates would double-premium. Guard idea (unbuilt):
flag rows whose rate ≈1.5× the worker's other-day rate. (b) client-side
import preview still shows Sun-week OT (cosmetic; server split is
authoritative). (c) HRX OT double-allocation across piecemeal resubmits
(§21a) still possible — weekly audit catches it.

## 21. ORPHANED EARNINGS from piecemeal/late W-2 resubmits + the weekly sweep runbook (2026-07-31)

VenueSmart 5-worker W-2 audit (Israel/Antonio/Kiara/Talia/Mark, C1 Select) after
repeated failed→fixed→resubmit cycles surfaced the general failure mode: when a
week's rows land in Everee ACROSS MULTIPLE submit attempts, the payment groups
whatever earnings exist at creation time — later-created earnings for the same
period get **paymentId=null (orphaned)** and never pay (their period's payment
already exists; the next run covers the next period). The `/api/v2/payables`
list is the ONE source that shows ALL earnings (worked-shift wages appear there
too, label "Shift ending YYYY-MM-DD") with `paymentId` + `paymentStatus` —
orphan = no paymentId. Statuses seen: PAID / UNPAYABLE_WORKER (payment exists
but worker has no direct deposit — releases when they finish payment setup; NOT
a data problem) / undefined+no-paymentId (orphan → must force payout).

**Sweep fix (verified live):** `requestPayablePayout(cfg, {externalWorkerIds:
[uid], startTimestamp, endTimestamp, includeWorkersOnRegularPayCycle: true})`
— per-worker + date-window scoping captured EXACTLY the orphans (counts 4/2/1),
grouped into needs-approval payments (runs 1362460 Kiara $527.87, 1362461 Talia
$254.23, 1362462 Mark $16). externalWorkerIds in the POST body IS respected
(unlike the GET payments filter, §3).

**Runbook scripts** (functions/.scratch/): `venuesmart-perday.ts` (per-day HRX
entries vs Everee worked-shifts vs payables w/ paymentId — the audit),
`force-orphan-earnings.ts` (the sweep), `audit-friday-shorts.ts` (CSV worked
vs paid hours). Run the audit BEFORE approving each weekly run.

**Also found:** (a) HRX import OT can DOUBLE-allocate across resubmit attempts
(Antonio/Talia had 4.33h OT stamped on BOTH 07-24 and 07-25 for a 44.3h week —
submit-time weekly classification sees prior attempts' hours; Kiara, submitted
in one shot, was correct). Worker-favorable when paid, but audit weekly.
(b) Antonio's 07-24 paid all-straight + 07-25 OT line paid $69.28 vs $104 →
$74.47 wage top-up owed (off-cycle). (c) "Per diem" does NOT exist as an HRX
field — the $50/day is entered as `bonusAmount` → BONUS payables; worker
complaints about "missing per diem" are usually a missing wage line instead.

## 19. Off-cycle payment path ALSO missed requestPayablePayout (fixed 2026-07-31)

Same root cause as §11 but a DIFFERENT code path: `createOffCyclePayment`
(`functions/src/payroll/offCyclePayments.ts`, the profile "Send payment" /
off-cycle 1099 button) created the payable via `createPayable` and stamped the
HRX doc `sent_to_everee`, but NEVER called `requestPayablePayout` — so the amount
sat in Everee as a raw line item, invisible in the Payments tab (Greg: "I paid
Deion Wilson, it's not showing in Everee"). Fixed: after creating the payable(s)
it now requests payout scoped to the created externalIds (`{ externalIds,
includeWorkersOnRegularPayCycle: false }`, non-fatal on failure — a retry mints a
new doc → new externalId → double-pay). The stuck Deion payable was drained with
a one-off `.scratch/payout-deion-offcycle.ts` (pay run 1360659). Audit: any OTHER
payable-creating path that isn't submitImportTimesheetBatch / finalizeTimesheetBatch
/ submitTimesheetAdjustments likely has the same gap.

## 23. One-time payments platform update (Everee FAQ 2026-07-22; reviewed 2026-08-05)

Everee reworked the one-time/ad-hoc payments experience. UI/import-focused but with
integration implications:
- **Rate + hours now REQUIRED on hourly/OT/DT pay codes** (UI + import; API still
  accepted amount-only REGULAR_HOURLY on 2026-08-05 — Mark True's 3 corrections went
  through — but flat-amounts-on-hourly is the exact pattern being retired).
  Hardened `createOffCyclePayment` (e0b66a1a, deployed): wage-like payables with no
  admin-entered hours/rate now send `unitCount:1, unitRate:gross` so rate×hours
  always equals gross. Non-hourly codes (CONTRACTOR/BONUS/REIMBURSEMENT/PER_DIEM)
  exempt. If Everee ever rejects, the alternative is a support-provisioned custom
  pay code (support@everee.com).
- **Explicit grouping choice** (next payroll vs next ad-hoc; no default) + a
  "grouped payment at risk of being lost" warning (contractor-grouped-to-payroll,
  separated workers) — the UI face of the §20/§21 orphaned-payable problem. Our
  API "send now" path (requestPayablePayout, includeWorkersOnRegularPayCycle:true)
  is explicitly unchanged.
- **WC code + work location are now optional overridable fields on every one-time
  payment** — relevant to §9/§14 state-mismatch pain and the payroll-costs WC
  report (off-cycle payments can carry WC going forward).
- **Deduction + deduction reversal are now self-serve** (reversal must map 1:1 to
  an existing worker deduction) — first sanctioned clawback-ish primitive; relevant
  to overpay recovery (previously manual recall via support).
- Terminology: "Earning type" → **"Pay code"**; "negative deduction" → "deduction
  reversal"; one-time = ad-hoc.

## When you hit a new Everee wire issue

Live API probe pattern from this session:
```sh
set -a; source functions/.env.hrx1-d3beb; set +a
B64=$(printf "%s" "$EVEREE_API_TOKEN_2320" | base64 | tr -d '\n')
curl -s -o /tmp/r.json -w "HTTP %{http_code}\n" \
  -X POST \
  -H "Authorization: Basic $B64" \
  -H "x-everee-tenant-id: 2320" \
  -H "content-type: application/json" \
  -d '{...}' \
  https://api.everee.com/api/v2/<path>
cat /tmp/r.json
```

Sandbox tenant 2320 is safe for probing. Production tenants are
3133 (C1 Select) + 3138 (C1 Events).

## 13b. WC sync BUILT + DEPLOYED 2026-07-16 (60f8895c)

`syncWorkersCompToEveree` callable (level-7 gate) + UI on Settings →
Workers Comp: per-row Everee chip (Synced / Rate drift / Not synced via
`everee.{entityId}` stamps on workers_comp_rates docs), per-row cloud
button and Sync-all header button share one preview dialog — dry-run is
ALWAYS shown first, Apply is the only write. Collapses HRX rows by
(state,code) (conflicting rates for a pair are refused); one-way upsert,
Everee-only rows (KY/OH 8044 etc.) reported but never touched; `name` =
first linked jobTitle (resolves the old open question). Default target
c1_select_llc. Known drift at build time: GA 8044 HRX 2.92 vs Everee
2.35 — the sync would push 2.92; Greg to confirm which is right. First
live single-row test not yet run.

## 13b. Correcting a PAID shift (learned 2026-07-17, Brian Battles rate fix)

- **correction-authorized PUT on a PAID shift = archive original + mint a
  FULL-AMOUNT unpaid replacement with a NEW workedShiftId.** The original
  keeps its payment (paid stays true); `hasCorrections` on the payment
  stays false at this point; the netting (if any) happens when a later
  payroll run picks the replacement up — behavior UNVERIFIED, we never let
  it run.
- **Replacements vanish from the worked-shifts LIST but remain readable by
  id** (originals show `archivedAt`).
- **Plain DELETE of a replacement → the normal period-lock 400.**
  **Correction-authorized DELETE of a replacement → Everee 500s** (raw
  Hibernate "persistent instance references an unsaved transient
  instance") — their bug; a correction-of-a-correction delete is broken.
- **The escape hatch: correction-authorized PUT the replacement BACK to
  the exact as-paid values** (rate, minute-aligned segments, grosses to
  the penny). Updating an UNPAID replacement edits in place (same id, no
  re-mint). Delta becomes \$0 → any later netting is a no-op → a manual
  same-day payment of the difference is unconditionally safe. Used for
  Brian: shifts restored to as-paid \$1,280.10; \$322.65 paid manually
  2026-07-17.
- Practical rule: for same-day corrections, skip the shift-correction
  machinery entirely — pay the difference manually and leave shifts
  as-paid (Collin/Brian pattern). Use correction PUTs only when the
  next-run timing is acceptable AND verify the run nets before approval.

## 14. Worked-shift WC validation + period locks (learned 2026-07-16, live payroll)

- **WC validation is (code, state) — the job TITLE never travels.** A worked
  shift carries only `workersCompClassCode`; Everee validates the pair
  against the company WC table. "Invalid workers comp code 8044 for OH"
  means the STATE resolution is wrong, not the code — check where the state
  came from before touching the WC table. Never add home-state rows to
  "fix" it: WC follows the worksite state.
- **The state comes from the shift's work location.** With
  `overrideWorkLocationId` → that location. Without → the worker's CURRENT
  default work location in Everee (their profile work address — often HOME,
  or the company default: a GA worker with no work address validated
  against C1 Select's CA company address).
- **Validation uses the location as of SUBMISSION time, not the work
  date.** Work-address changes can't be backdated in Everee's UI, but that
  doesn't matter: Terry's KY address effective "today" let Jul 7–9 shifts
  through. If a fixed worker still fails, the change is probably saved as
  scheduled/pending, not active.
- **FIXED 2026-07-16 (b40f9278, deployed):** root cause was
  `loadWorksiteFromChildLocation` casting the CRM location's `address`
  field to an object — locations store the street as a STRING there, so
  `.street` read "" and the account-fallback fed streetless addresses into
  import rows; Everee's work-location create then 400'd on line1 and
  `submitImportTimesheetBatch` swallowed it. Now: string `address` is read
  as the street, and a row that CLAIMS a worksite which can't attach is a
  loud per-row error (rows with no worksite keep the legacy fallback).
  Already-saved sidecars still carry street:"" — re-run match on old rows
  if they trip the new error. Stopgap that also works: set the worker's
  WORK ADDRESS in Everee to the actual worksite.
- **Period locks are PER-WORKER, not global.** "included in a payment that
  is already approved" fires only if THAT worker was paid for the period
  (Collin, paid 7/5–7/11, locked; Terry, unpaid that week, same dates
  submitted fine). Unpaid work inside a worker's paid period can ONLY go
  out as a retro wage line.
- **RETRO_WAGES / MEAL_PREMIUM / REST_PREMIUM are NOT provisioned on
  C1 Select prod** (Everee: "Unknown 'payCode'"). The one-shot idempotent
  script exists: `functions/src/integrations/everee/scripts/
  provisionCustomPayCodes.ts --entity=c1_select_llc` (dry-run default).
  Greg declined 2026-07-16 (paid Collin manually in the Everee UI
  instead + deleted the HRX row). The next locked-period straggler will
  hit this again — offer the script run then.

## 15. CA daily OT bug in the IMPORT classifier (found+fixed 2026-07-16)

- The import path's `classifyWeeklyOt` was FLSA-weekly-40 ONLY. Brian
  Battles' CA week (4 × 11.5-12.5h days, Northern California DC, 47.33h)
  shipped 40 reg + 7.33 OT; CA §510 wanted 32 reg + 14.83 OT + 0.5 DT →
  **$106.55 gross underpaid**, verified against his 7/11 statement. It was
  OUR classification, not Everee's — the statement's per-day rows exactly
  matched our weekly cascade. GET worked-shifts returns
  `fullyClassified: null` even for shifts we sent segments on (response
  just doesn't echo them).
- Fixed a4f2f53b (+ grid display 92b08580): classifyWeeklyOt takes
  worksite state, applies CA daily 8h/12h caps then the weekly cascade
  over REG hours only (no pyramiding; identity for non-CA — verified
  bit-for-bit). DOUBLE_TIME segments at 2× flow to Everee, preview,
  retro fallback, entry mirror. NOT DEPLOYED as of the fix — needs
  `functions:submitImportTimesheetBatch` + hosting.
- **EXPOSURE SCAN RUN 2026-07-16** (.scratch/scanCaOtExposure.ts,
  re-runnable): **57 workers / 97 worker-weeks / $4,533.22 owed**, almost
  all Naval Base Coronado weeks of 6/14 + 6/21 (long since paid) plus
  Brian Battles $108.33 (Distribution Center NorCal). Top: Alexzander
  Corbett $842.26/4wk. A few ±$0.07 rounding rows — skip deltas <$1.
  Reports: ~/Downloads/ca-ot-exposure-2026-07-16.txt + -summary CSV.
  **CLOSED 2026-08-05 (Greg policy decision): C1 Events 1099 contractors get
  NO automatic overtime — pay OT only when manually added, never auto-derive.**
  Cohort check: the June CA exposure was 429 c1_events entries / 134 workers
  vs 13 c1_select / 2 workers — the W-2 slice (Brian Battles) was already
  remediated 7/17. Code audit confirmed the policy was ALREADY enforced
  everywhere: import W-2 auto-OT gated to AUTO_OT_ENTITY_IDS={c1_select_llc}
  (2026-07-06), import 1099 payables flat hours×rate, grid contractor payable
  (composeContractorPayable) pays OT hours at 1.0× with premiums folded flat
  (§226.7 is employee-only). Grid may DISPLAY an OT split on Events entries —
  cosmetic, no premium dollars. No code change was needed.

## 16. RESOLVED 2026-07-16 — overnight shifts straddling the pay-week boundary

Aaron Ortiz's 7/11 6pm → 7/12 5:25am shift (4012226, $205.50) straddled
the Sun-start boundary: Everee's PAYROLL bucketed by shift END (excluded
from the 7/5-11 run) while its Timesheet UI bucketed by START (displayed
in NEITHER week; Payments showed no upcoming period). An unpaid shift no
Everee screen shows. Resolution: shift verified paid:false via API,
DELETED via deleteWorkedShift; Greg paid the $205.50 manually. The HRX
row stays "Submitted" — do NOT void/resubmit it (would recreate the
shift on top of the manual payment).

**Durable fix aadccadf (deploy with submitImportTimesheetBatch):**
composeImportWindow clamps a Sat→Sun-crossing window to end Sat 23:59
worksite-local, start pulled earlier so duration/pay unchanged;
`clampedToPayWeek` flag adds a stub note. Mid-week overnights untouched.
Worth reporting the display-vs-payroll bucketing disagreement to Everee
regardless.

**Fourth gotcha (2026-07-23, RESOLVED end-to-end same day):**
POST /api/v2/work-locations is NOT idempotent on externalId as
documented — duplicate NAME under a different externalId errors as
EITHER a 500 "duplicate key value" (raw Postgres) OR a 404 "Work
location name must be unique" (validation layer) — match
`/duplicat|already exist|must be unique/i`. Recovery in
ensureEvereeWorkLocation (final form 65041be5): catch → GET
`/api/v2/work-locations?pageNumber=N&pageSize=100` (0-based; envelope
`{items, pageSize, pageNumber, totalPages, totalItems}` — the array
is under **`items`**, and NOTE the param names differ from
worked-shifts' `size`+`page`, §17) → walk all pages → match by
normalized name then line1 → reuse + cache. Verified live: KY rows
recovered against existing location 589382.

Same saga, the **stale-browser clobber family**: submit re-SAVES
browser rows before sending, wiping server-side repairs. Two
preservation layers now exist, both keyed on the saved entry:
addresses (save keeps a complete saved street over an empty incoming
one, 70d824bb; submit falls back to entry address, dcd81e40) and
**workers-comp codes** (`import.wcManuallyCorrected: true` flag —
saveImportTimesheetRows preserves flagged code+rate and re-asserts
the flag; submitImportTimesheetBatch pre-reads entries and prefers a
flagged code over the client row's, 65041be5). Ops pattern for a
wrong WC on an unsubmitted import row: patch the ENTRY (code, rate,
workersCompSource:'manual_correction', wcManuallyCorrected:true) —
or just have Greg type it in the grid, whose inline edit writes the
entry directly. Also: W-2 (c1_select) submissions are worked shifts
(Time→Timesheets, weekly payroll gross), NEVER Payments-page batch
payables — only 1099 (c1_events) makes payables.

## 4. Pay codes: the dashboard dropdown IS the full list — no RETRO_WAGES, no custom codes (2026-08-05)

`/api/v2/payables/bulk` rejected `payCode: 'RETRO_WAGES'` with 400
"Unknown 'payCode'". There is NO self-serve custom pay-code creation in
the Everee dashboard (no Settings→Pay codes page); the one-time-payment
dropdown is the complete list: Regular Hourly/Salary, Overtime/Double
Time Hourly, Additional Holiday, Bonus, Commission, Contractor Pay,
Holiday, ISO/NSO/RSU, Loan, Meal/Rest Break Premium (CA §226.7 —
BUILT-INS, not our custom codes), Mileage, Payroll Advance, Per Diem,
Phone Stipend, Reimbursement (non-taxed), Separation Pay, Sick Pay,
Time Off (+Enrollment Payout), Tips, Vacation. Fix: period-locked retro
wages ship as `payCode: 'BONUS'` (supplemental wages, same withholding
class) with a "Retro wages — …" label; the `::RETRO` externalId keeps
ledger semantics.

## 5. Worked-shift WC validation uses the WORK LOCATION's state — home-state fallback trap (2026-08-05)

Everee validates the worked shift's WC code against ITS OWN
workers-comp table for the shift's work-location state. If the shift
carries no attachable work location (e.g. the VenueSmart travel-crew
worksite whose address has NO state), Everee falls back to the
worker's DEFAULT location — their HOME state — producing 404 "Invalid
workers comp code 8044 for TX/FL" for DC/MI work. Two requirements:
(1) every submitted row needs a worksite with a real stateful address
(the weekly event-mapping flow provides it; fix-travel-event-worksites
sweep repaired the Mubadala DC Open → Rock Creek Park Tennis Center DC
and Rocket Classic → Detroit Golf Club MI rows); (2) the HRX WC matrix
must be pushed to Everee's table via Settings → WC Class Codes → "Sync
to Everee" after ANY matrix change, or valid codes still 404.

## Worked shifts need an hourly position EFFECTIVE ON THE SHIFT DATE (2026-08-06)

A freshly-provisioned worker's position gets `startDate = provision day`
(`createWorkerIfNeeded` defaults `hireDate → today` and rate → $20), so
past-dated import shifts 500 with `"No hourly position present"` even though
the worker HAS an hourly position (Zaon Cox: provisioned 8/06, shifts
7/27–7/31 all rejected; the position existed at $20 starting 8/06).

Fix: `PUT /api/v2/workers/{uuid}/position` with
`{startDate, payType: 'HOURLY', payRate: {amount, currency}}` — endpoint is
undocumented but real (GET returns 405 = exists, wrong method; mirrors the
`/address` and `/personal-info` PUTs). Script:
`.scratch/fix-everee-position-startdate.ts` (`--worker/--start/--rate`).
Durable fix candidate: pass `hireDate` = earliest unpaid workDate when
provisioning from import/backfill flows.

**Endpoint truth for backdating (verified live 2026-08-06, Zaon fix):**
`PUT /api/v2/workers/{uuid}/hire-date` with body `{startDate: 'YYYY-MM-DD'}`
moves BOTH the worker's hireDate and the position's startDate — this is THE
call. `PUT .../position` requires `effectiveDate` and can only edit the
position ACTIVE on that date (rate/hours — good for fixing the $20 default
to the real rate); pointing it at a pre-start date 500s with "No active
position present", and it can never move the start date itself.

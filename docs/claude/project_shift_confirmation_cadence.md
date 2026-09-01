# Shift-confirmation cadence (no-show prevention) — state + conventions

> Greg 2026-08-29: "#6 - yes we need massive help with this - too many
> no-shows" → Oakland Arena pilot built; then "audit our entire messaging
> sequence system… different 'tracks' for different account and worker
> types/job order types" (audit in flight, see below).

## How it works (mechanics)

- Two reminder profiles in `functions/src/cadence/shiftReminderProfile.ts`:
  `default` (24h + 2h plain reminders) and `cort_gig` (the full commitment
  loop: 24h "Reply YES to confirm or CANCEL", 23h escalation, 22h last-call,
  2h instructions+address, 15m clock-in nudge, 0h "reply HERE" check-in,
  T+30m silent no-show check that alerts recruiters).
- `tenants/{t}/messagingSequences/{sequenceId}` docs GOVERN targeting.
  **2026-08-29: generalized from the single hardcoded `cort_gig` doc to
  scanning the whole collection** — each sequence carries its own
  `targeting: {active, accountIds, locationIds?, workerTypes, occurrence}`.
  `locationIds` (new) narrows inside a national account (Oakland Arena is a
  location under Legends National Account, not its own account). First
  matching doc wins; if ANY targeting doc exists, docs govern (no legacy
  tenant-switch fallback).
- Worker replies parsed by `functions/src/cadence/replyClassifier.ts` +
  `cadenceReplyHandler.ts`; state lives on the assignment as
  `cortConfirmation: {state: pending|confirmed|cancelled|…}`. Escalations
  are gated at dispatch time against that state.

## ☠️ Hard product fences (Greg, 2026-08-29)

The confirm/check-in cadence is for **gig shift work only**:
- `jobOrderType === 'career'` → always the default two-step reminders.
- `isOpenShift === true` (standing-crew/date-range) → always default.
Both fences sit at the TOP of `resolveShiftReminderProfile` (and the sync
variant) — no targeting doc, tenant switch, or per-assignment override can
opt them in. Don't "fix" this by moving the fence below the override.

## Standardized tracks (2026-08-29, Greg — built pre-OnTrac)

Profiles in `shiftReminderProfile.ts`; sequence docs pick one via `track`:
- **`gig_standard`**: 24h YES/CANCEL ask → 23h/22h escalations (while
  silent) → **T-4h re-confirm** (Qwick-style second opt-in — deliberately
  ALSO sent to already-confirmed workers; suppressed only on
  cancelled/checked_in) → T-2h worksite details → T+0 "reply HERE" →
  T+30m silent no-show probe. No 15m clock-in step.
- **`cort_gig`**: gig_standard + T-15m clock-in step (CORT's QR
  `clockInUrl` from shift extras).
- **`career_placement`**: `career_first_day` welcome at T-15h (evening
  before a morning start) + morning-of note. NO confirm demands, NO
  probes. Careers are routed here BY THE FENCE (jobOrderType 'career'),
  never by targeting — this replaced the bare default for careers.
- **`default`**: 24h + 2h plain reminders — untargeted gig accounts and
  Open Shifts.
Reply handler: YES from an already-confirmed worker re-confirms
idempotently (needed for the T-4h re-ask; used to fall through to the
compliance START handler).

☠️ Resolver trap (burned us 8/29): `normalizeProfileId('')` returns
'default', so the per-assignment override check must treat an ABSENT
`shiftReminderProfile` field as no-override (guard on raw string) — feeding
undefined straight in makes every assignment resolve 'default' and turns
the targeting scan into dead code. CORT assignments carry the field
explicitly stamped, which masked this for months.

## Live sequences (prod, tenant BCiP2bQ9CgVOCTfV6MhD)

| sequenceId | track | targeting | occurrence |
|---|---|---|---|
| `cort_gig` | cort_gig | account CORT `iNJQeuidEg6nJodNeWjc`, gig | first_shift (until completion) |
| `oakland_arena_gig` | gig_standard | account Legends National `uhb5hq4ddyLWtSeJP9Te` + locationId `QGNUkDRD4jMej6RArOO4` (Oakland Arena only), gig | every_shift |

Settings → Messaging Sequences now renders EVERY sequence doc as an
editable card (track, accounts, location-ID filter, occurrence) + "Add
sequence" (`SequenceTargetingCard.tsx`). OnTrac onboarding = Add sequence
→ pick gig_standard → select the OnTrac account → Active. NOTE: if OnTrac
runs as Open Shift standing crews, the isOpenShift fence excludes them —
decide the OnTrac assignment shape first.

Oakland pilot went live 2026-08-29; existing 8/30 assignments (71 workers)
were re-synced via a stamp-then-clear of `shiftReminderProfile` (now a
MATERIAL field in `shouldResync` — without that, per-assignment overrides
never re-materialize reminders on an already-synced assignment).

## Recruiter visibility

Scheduling Health (`src/pages/SchedulingHealthPage.tsx`) now has two cards
fed by a direct assignments query (startDate range today→+3d, client-side
filter on `cortConfirmation`): "Workers who declined their shift" (CANCEL /
no_show → Add-a-replacement button into the job order's Placements tab) and
"Haven't confirmed their shift yet" (pending, with tel: Call buttons).

## Footguns

- **☠️ TWO deployed inbound-SMS webhooks wrap ONE source (incident
  2026-08-29 night)**: Twilio's "C1 Messaging" service
  (MGe3edf114c7b9c270ee66928816d65b25, useInboundWebhookOnNumber=false)
  posts inbound to `twilioInboundSmsWebhook` — a thin wrapper around
  `handleInboundSms` — while the number-level smsUrl points at
  `handleInboundSms` directly (bypassed for service numbers). Named-list
  deploys of `functions:handleInboundSms` do NOT refresh the wrapper's
  bundled copy, so the LIVE inbound path served months-stale code with no
  cadence-reply claim: all 34 Oakland pilot YES/SI replies on 8/29 were
  eaten as START opt-in keywords ("re-subscribed" texts) and
  cortConfirmation stayed pending. Fix deployed: redeploy
  `functions:twilioInboundSmsWebhook` WHENEVER inboundSmsWebhook.ts or
  cadenceReplyHandler.ts changes — always deploy the pair. Better fix
  (needs Greg): repoint the messaging service inboundRequestUrl to
  handleInboundSms and delete the wrapper. Also: number ***3750 still
  points at Twilio's demo URL.
- **☠️ Reply-eating incident layer 2 (found 2026-08-30 AM)**: even after
  the wrapper redeploy, replies still fell to START — the Phase B rework
  gave `handleCadenceReply` a `collectionGroup('assignments').where
  ('userId'==…)` lookup and the COLLECTION_GROUP index for
  assignments.userId was never created. The query threw
  FAILED_PRECONDITION on every reply; the webhook's compliance-safety
  catch swallowed it, and the error was invisible to log greps because
  functions logger.error lands in jsonPayload while
  `--format=value(textPayload)` shows blanks. Index created 2026-08-30
  via the field-exemption REST API. TWO lessons: (1) any new
  collectionGroup query needs its index verified with a scratch run
  BEFORE relying on it in a swallow-errors path; (2) when grepping
  function logs, always ALSO read jsonPayload
  (`--format=json` or value(jsonPayload.message)) or you'll miss every
  logger.error/warn.
- The Settings → Messaging Sequences page
  (`src/pages/TenantViews/settings/MessagingSequencesPage.tsx`) is still
  HARDCODED to the `cort_gig` doc — the Oakland sequence doc is invisible
  there (config-only). Extending that page is part of the audit follow-up.
- `accountId + startDate` on assignments needs a composite index — scratch
  scripts use accountId equality + in-memory date filter instead.
- Step timing and message copy are hardcoded in
  `workerShiftRemindersV2.ts` / `cadenceMessages.ts` (English-only) —
  targeting is the only recruiter-editable surface today.

## Audit 2026-08-29 (Greg: "audit our entire messaging sequence system")

Full review artifact (16 defect classes, competitor scan, tracks plan):
https://claude.ai/code/artifact/d47711eb-a416-4ebc-a307-ab29f36f8542

**Fixed + deployed same night** (commit 03b64b9d):
1. ☠️ TIMEZONE: `startDate+startTime` were merged AS UTC → every reminder
   fired hours early (7h for CA) and the 8AM floor ran at 1AM PT. Now
   wall-clock via explicit tz → `worksiteState`→IANA map → LA fallback,
   DST-safe two-pass offset. NOTE: nothing in prod writes
   `assignment.timezone`/`startDateTime` — the state map is the live path.
2. ☠️ RESYNC DEADLOCK: material edits cancel-then-upsert, and upsert
   preserved `cancelled` as terminal → ANY edit to a confirmed assignment
   permanently killed its reminders. `cancelled` now revives when the
   recomputed time is future; only sent/failed stay terminal.
3. Spanish reply grammar (SI/CANCELAR/AQUÍ + walk-off phrases) + all
   cadence bodies/receipts bilingual via `preferredLanguage`.
4. Walk-off classified BEFORE cancellation ("NO ONE IS HERE" was hitting
   the bare `NO` token and cancelling the worker's NEXT shift). 'PASS'
   removed from cancel tokens.
5. CANCEL from a CONFIRMED worker now cancels the shift — it used to fall
   through to the compliance STOP handler and globally unsubscribe them.
6. Late YES near shift start confirms instead of triggering the START
   opt-in reply. Resync no longer stomps checked_in/no_show → pending.
7. No-show recruiter-feed route fixed (`/assignments/{id}`).

**OnTrac blockers CLOSED 2026-08-29 late** (commit 12e356bc,
`cadence/reminderSchedulePlanner.ts` — pure, 10 jest tests):
- Pre-8AM shifts: floored 24h/23h/22h ladder re-spaces to ask+2h/+4h
  (was 3 texts in one dispatch batch at 8:00).
- Late fills: `assignment_confirm_now` synthesized at materialization when
  the 24h ask is past and start is ≥45min away — bilingual, CARRIES THE
  ADDRESS, escalation ladder rebuilt off it. <45min = no ask.
- T-4h re-confirm re-anchors to T-12h (previous evening) for 5–9 AM
  starts; dropped when it collides (<30min) with the details step.
- Retries are honest: `releaseLifecycleEvent` frees the dedupe key after a
  FAILED send (claiming on first attempt made retries no-op "successes").

**Phase B remainder + paper cuts CLOSED 2026-08-29 eve** (commit 1b76f25d):
- `copyOverrides` on sequence docs: per-step SMS templates (EN/ES,
  {brand}/{jobTitle}/{startLabel}/{address}/{clockInUrl} tokens) rendered
  at dispatch (`cadence/sequenceCopyOverrides.ts`, 60s cache); reminder
  docs stamp the governing `sequenceId`. Settings has the wording editor +
  a venue picker (options = distinct locationId/worksiteName from the
  account's own assignments).
- SMS brand from `messagingConfig/branding.smsBrand` (default C1 Staffing).
- Deleted assignments purge their scheduled_notifications (in the existing
  onWrite trigger — no new function).
- Settings step-table truth pass + reconfirm/late-fill rows;
  jest 0-failure: `setupFiles` wiring was the root cause of all 8 broken
  suites (setup.ts existed, never loaded); 2 emulator suites skip cleanly.

**Open, ranked** (see artifact for detail): P0 late fills get no confirm
ask + no address (<2h fills get NOTHING on default profile); P0 CANCEL
never reopens the seat (status untouched → shift stays "filled", no
backfill — Scheduling Health cards are the stopgap); P1 8AM floor
collapses 24/23/22h onto one timestamp for pre-8AM shifts; P1 retries
cosmetic (dedupe claims on attempt, not success); P1 `processing` docs
strand forever (claim TTL never checked; 200 sequential sends vs 60s
default timeout); P1 cadence bypasses rate limiter AND quiet hours, and
no-show alerts silently no-op when the job order has no recruiter; P2
orphaned reminder docs on delete, unscoped reply lookup, "C1 Staffing"
hardcoded ×12, Settings copy promises behavior code doesn't do.

**Tracks plan** (phases A–D in the artifact): A = multi-sequence targeting
(shipped) + Settings page must render ALL sequence docs; B = steps/copy
into the sequence doc (recruiter-editable, EN/ES pairs, compressed
same-day track); C = consequences (unconfirmed→removed, CANCEL→seat
reopens + offer blast to Tier-1 regulars); D = rolling reliability score
feeding [[project_tiered_shift_access]].

Related: [[project_sms_audit_2026_08]], [[project_open_shift_feature]],
[[project_tiered_shift_access]].

---

## 2026-08-31 — reply routing bug (FIXED, deployed)

**Symptom** (reported by Danny, worker Kelly Idarraga): 12 SMS in a rolling
day, three "Si" replies, a "last reminder — we may reassign your shift"
23 min AFTER she confirmed, a false `no_show`, and then a job-invite blast
for the shift she was working.

**Root cause**: `pickPendingCadence` sorted candidates by start time only,
so a worker holding TWO pending shifts on one day had every reply bound to
the EARLIER shift. The later shift's escalation ladder was never cancelled
(the cancel code itself was correct — it ran on the wrong assignment), so
it kept asking. She had 1:00 PM and 6:00 PM Usher shifts from two different
job orders; each ran its own independent 7–9 step ladder.

**Fix** (`db23873f`): the reminder engine stamps
`cortConfirmation.lastAskedAt` whenever a `CONFIRMATION_ASK_REMINDER_TYPES`
reminder sends; reply lookups now prefer the most-recently-asked shift and
fall back to earliest-start only when nothing has been asked. Receipts now
name the shift ("Aug 30, 6:00 PM") — built from the raw `startDate` /
`startTime` strings, because **assignments carry no `timezone` field** and
real conversion would relabel an 18:00 gig as 1:00 AM. A YES on an
already-confirmed shift now says "you were already confirmed" instead of
repeating the receipt verbatim. Regression tests in
`src/cadence/__tests__/cadenceReplyRouting.test.ts`.

Deployed: `handleInboundSms`, `twilioInboundSmsWebhook`,
`dispatchScheduledWorkerReminders`, `onAssignmentConfirmedScheduleReminders`.

**Still open from the same investigation** (ranked):

1. ~~**`no_show` cannot see clock-ins.**~~ **MUTED 2026-08-31** (`b4f32d55`).
   Greg's framing is the correct one: *we have no real-time attendance
   signal, so we cannot detect a no-show in real time.* The probe was
   inferring one from absence of evidence — the only writer of `checked_in`
   is the worker texting HERE (14 of 118 cadenced shifts in 14 days), and
   timesheets arrive as BATCH imports well after the fact, so "just read the
   clock-in data" would not have produced a real-time signal either.
   Production: 65 `no_show` against 14 `checked_in`, all of them Aug 2026.
   Now gated behind `messagingConfig/noShowDetection {enabled:true}`,
   defaulting to muted and failing closed on a config read error. The probe
   still runs and logs `noshow_check muted` with `wouldHaveFlaggedNoShow`, so
   the false-positive rate stays measurable while the alert is off.
   **Re-enabling needs a real attendance signal first** — a worker check-in
   in the app (natural home: the shift card that already carries Confirm /
   Can't make it) or a live clock-in feed. The flag alone reproduces the bug.
   Leftover contamination: **65 assignment records still carry
   `state: 'no_show'` and 67 carry `needsRecruiterAttention`** — not
   backfilled, because we cannot tell the real no-shows from the false ones
   without cross-referencing `timesheet_entries` for that worker + date.

2. **No per-worker daily cap on cadence SMS.** Each assignment runs an
   independent ladder with nothing deduplicating across them. Note the
   shift-invite blast DOES have one — `tryClaimDailySmsSlot` in
   `jobOrderAutoMessaging.ts`, transactional, 24h global — and its comment
   describes exactly this failure mode. Mirror it for the cadence.
3. **Invite blasts don't exclude already-assigned workers.** The 24h cap
   works; there's no "already working this job order" exclusion.

Also observed: much of the historical `never_asked` state is **backfilled
assignments materialized after their start date**, not a coverage gap —
don't read that number as broken automation without checking `createdAt`
against `startDate` first.

### 2026-08-31 — the 65 no_show flags were cleared

Cross-referencing them against `timesheet_entries` could not adjudicate a
single one, for a reason worth remembering: **all 65 came from one account —
Legends Global / Oakland Arena** (Usher, Ticket Taker, Wardrobe Attendant,
Elevator Attendant), and that venue has **166 assignments and ZERO timesheet
entries**. The join itself is sound (60/60 non-flagged August assignments
matched a timesheet; Kelly Idarraga has 15 timesheets all time, all
`sent_to_everee` with real hours, all from a different job order). So the
flags cluster perfectly on the one venue that records no attendance data of
any kind — which is also why nothing ever stamped `checked_in` there.

Cleared anyway (Greg's call, and the right one): a conclusion produced by a
process with no valid input is not evidence. Of the 65, **38 had explicitly
confirmed** ("YES") before being flagged a no-show.

Each record now carries `cortConfirmation.clearedNoShow` — `previousState`,
`restoredTo`, `clearedAt`, `clearedBy`, and the reason — and state was
restored to the detector's own recorded `priorState` (38 confirmed, 27
pending). Reversible from that audit block. `needsRecruiterAttention` went
67 → 2. **If tiered shift access ever consumes attendance data, ignore
everything before the detector was muted.**

**RETRACTED 2026-08-31 (same day).** The "166 Legends Global assignments with
no timesheet entries — possibly unbilled revenue" flag above was WRONG, and the
error is worth keeping as a lesson.

☠️ **An assignment doc-id prefix is a `shiftId`, NOT a `jobOrderId`.**
Doc ids are `{shiftId}__{userId}__{date}`. Reading the prefix as a job order
turned "four shifts" into "four job orders" and made a routine weekend look
like a systemic billing gap. Always join timesheet entries to assignments on
the full `assignmentId`, or read the assignment's own `jobOrderId` field.

Corrected: all four are shifts under ONE job order (`Nx0abe5F6tOUBevOX8eO`,
Legends Global / Oakland Arena). That job order is **91% timesheeted**
(912/1,004). All 166 un-entered assignments are dated **2026-08-29/30** — the
weekend immediately before the check — and **none** are older than 10 days.
Danny enters Legends' paper timesheets on Tuesdays; the check ran on a Monday.
Nothing was wrong.

**The durable lesson**: hours lag the shift by days, so *absence of a timesheet
is not evidence of anything* until the entry window has passed. Any check on
timesheet coverage must exclude the trailing ~10 days or it manufactures alarms
— the same shape of mistake as reading `never_asked` on backfilled assignments
as a cadence failure.

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

## Live sequences (prod, tenant BCiP2bQ9CgVOCTfV6MhD)

| sequenceId | targeting | occurrence |
|---|---|---|
| `cort_gig` | account CORT `iNJQeuidEg6nJodNeWjc`, gig | first_shift (until completion) |
| `oakland_arena_gig` | account Legends National `uhb5hq4ddyLWtSeJP9Te` + locationId `QGNUkDRD4jMej6RArOO4` (Oakland Arena only), gig | every_shift |

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

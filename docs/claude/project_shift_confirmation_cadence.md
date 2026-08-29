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

Related: [[project_sms_audit_2026_08]], [[project_open_shift_feature]],
[[project_tiered_shift_access]].

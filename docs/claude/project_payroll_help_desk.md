# Payroll help desk (Slice 1 SHIPPED 2026-08-24)

Greg's direction (2026-08-24): "uniform way for workers to request help, then
give Claude the ability to fix pay/Everee issues directly." Architecture:
**every channel feeds one queue; the queue is where AI diagnoses and (later,
with approval) fixes.** Deflection is part of the plan — native Earnings v1
and clearer onboarding status preempt most "where's my money" tickets.

## Slice 1 — LIVE

- **Data**: top-level `payroll_tickets` (uid, tenantId, status
  open/waiting_worker/resolved, channel app/sms/email, subject, denormalized
  worker name/email/phone/preferredLanguage, `diagnosis`, lastMessageAt/By) +
  `messages` subcollection (by: worker/staff/ai). Client-READ-ONLY by rules
  (worker sees own; staff = isHRX or hasSecurityLevel(tenantId, 5) — staff
  list queries MUST filter `tenantId==` or the level-5 rules branch can't be
  proven). ALL writes go through the callable.
- **Callable**: `workerSupportAssistant` gained actions (Cloud Run cap — NO
  new functions): `payroll_create_ticket` {tenantId, text},
  `payroll_reply` {ticketId, text}, `payroll_set_status` {ticketId, status}.
  Timeout bumped 45→120s because the diagnosis runs INLINE at creation.
  Core in `functions/src/payroll/payrollTicketsCore.ts` — SMS/email intakes
  later should import these same helpers.
- **AI diagnosis** (Claude opus, json_object): reads users doc,
  `everee_workers` linkages incl. readinessMirror (sandbox 2320/smokeData
  excluded), recent timesheet_entries + assignments → {category
  (missing_pay/wrong_amount/onboarding_stuck/direct_deposit/tax_docs/other),
  severity (urgent/normal/low), staff-facing summary, suggested EN+ES
  worker replies, confidence}. PII discipline: NO SSN/last-4/bank numbers in
  the prompt (booleans/counts only). Verified on Greg's real data — it
  correctly root-caused "unsubmitted draft timesheet, not payment setup" and
  flagged Events is AD_HOC-pay only.
- **Worker UI**: `/c1/workers/payroll-help` (+`/:ticketId` thread, live via
  onSnapshot; list sorted client-side — where+orderBy would need a composite
  index). Entries: Help & Support card + Earnings footer link. EN/ES strings
  under `payrollHelp.*`. Staff replies send an in-app notification
  (`sendNotificationAndPush`, deepLink to the thread).
- **Staff UI**: `/payroll-tickets` ("Payroll Help Desk" sidebar item, levels
  5–7) — status tabs, drawer with diagnosis panel + "Use this reply" (EN/ES)
  + reply/resolve.
- Test tickets from Greg's worker account left in the queue as live examples.

## Hardening pass (audit, SHIPPED 2026-08-24 later)

- Timesheet context reads **`workDate`** (the real field — `date` doesn't
  exist) + `totalDoubleTimeHours`; worker Profile stats DT field fixed too.
- `payroll_create_ticket` validates tenant membership (`isTenantMemberData`)
  and caps active tickets at 3/worker (resource-exhausted with a friendly
  message).
- **Diagnosis split**: main doc keeps only category/severity/confidence
  (worker-readable, drives queue chips); staff-facing summary + unsent
  draft replies live in `payroll_tickets/{id}/private/diagnosis` —
  rules: staff-only read. Console falls back to legacy main-doc detail.
- **Urgent alerting**: severity=urgent → SMS to
  `app_config/payroll_help_desk.urgentAlertPhones` (seeded with Greg;
  Twilio secrets bound to workerSupportAssistant). Verified delivered to
  Greg's phone 2026-08-24. Open tickets also in the morning brief
  (`buildPayrollTicketsSection`).
- Staff replies notify in the worker's language; staff reply on a resolved
  ticket no longer reopens it; typed errors (not-found / permission-denied /
  resource-exhausted).
- **Admin↔account connection**: Open-profile button in the ticket drawer;
  `OpenPayrollTicketChip` ("N payroll tickets", warning) in the profile
  header — mounted in BOTH header variants (index.tsx compact +
  RecruiterUserProfileTableHeader, which is what /users/:uid actually
  renders).
- Mocha: `src/__tests__/payroll/payrollTicketsCore.test.ts` (pure helpers).

## Slice 2 — approved actions (SHIPPED 2026-08-24, verified live)

Callable actions (staff-only, drawer ACTIONS row):
- `payroll_action_send_link` {kind: onboarding|bank_update} — SMS in the
  worker's language + in-app notification, both deep-linking to
  `/c1/workers/earnings/{evereeTenantId}` (onboarding → first incomplete
  prod linkage; bank_update → first complete). Worker-visible system
  message in the thread ("We sent you a text…" EN/ES).
- `payroll_action_refresh_everee` — `reconcileWorkerInternal`
  (syncSource 'manual') over all prod linkages, then RE-RUNS the diagnosis
  on the fresh mirror (main-doc chips + private detail both update live).
- Every action → audit entry in `payroll_tickets/{id}/private/audit`
  (entries arrayUnion: at/action/byUid/byName + detail); drawer shows the
  last 5. Money-moving actions deliberately excluded — human forever.
- Everee tokens are env vars (all functions have them); Twilio secrets
  already bound to workerSupportAssistant.

## Earnings v1 + payment truth (SHIPPED 2026-08-24)

- Worker Earnings tab shows **Recent pay** natively: `evereeGetPayHistory`
  (existing callable; `canSelfOrManageEveree` already allows self-access)
  per employer, merged/sorted, amount + date + employer + status chip
  (PAID/processing/issue), EN/ES. Section hidden when the worker has no
  payments (correct empty behavior — verified on Greg's worker account,
  which has ZERO Everee payments). `useEvereeEntityInfos` now carries
  `entityId`.
- Diagnosis context gains **"Recent Everee payments (settled truth)"**
  (`getPayHistory` per prod linkage) + a prompt rule: no payment on record
  → say plainly none was issued (unsubmitted hours), never speculate about
  returned deposits; payment exists → cite date/amount/status. Verified:
  the live direct-deposit ticket's diagnosis flipped from "check whether
  the deposit was returned" to "NO payments on record — Grant Park
  7/30–8/02 hours were never submitted."
- ☠️ Scratch-testing diagnosis: load `functions/.env.hrx1-d3beb` via
  dotenv or ANTHROPIC_API_KEY is missing and runPayrollTicketDiagnosis
  silently returns null (looks like a stale doc).

## AI first reply (SHIPPED 2026-08-25, Greg approved)

At ticket creation, when diagnosis confidence ≥ 0.7 the drafted reply posts
to the thread immediately as **"C1 Assistant (AI)" / "Asistente C1 (IA)"**
(worker's language). Ticket STAYS open with lastMessageBy 'ai' so staff
still follow up; audit entry `ai_first_reply` {confidence}. Config:
`app_config/payroll_help_desk` — `aiFirstReplyEnabled` (kill switch,
default on) + `aiFirstReplyMinConfidence` (default 0.7).

## Slice 3 — two-lane autonomy (SHIPPED 2026-08-25, Greg's spec)

Greg's operating model: **fix-it lane = AI resolves alone** (staff only read
the Resolved tab / #payroll Slack); **money lane = AI investigates, staff
authorize with one click**.

**Fix-it auto-resolution** (`maybeAutoResolveFixIt`, runs at ticket
creation): category allowlist `onboarding_stuck→onboarding link`,
`direct_deposit→bank_update link`, `tax_docs→portal link` (new 'portal'
kind: pay stubs + tax docs copy, same earnings embed URL). Requirements:
config `autoResolveEnabled !== false`, confidence ≥
`autoResolveMinConfidence` (default 0.75), **AI first reply actually
sent** (never resolve silently), prod Everee linkage exists (link send
throws otherwise → stays open). On success: resolved w/ resolvedBy 'ai',
resolutionNote "Auto-resolved by AI: replied and sent …", audit
`auto_resolved`, Slack `:robot_face:` post. Worker reply reopens (status
machine) — failed fixes come straight back. Any failure = ticket stays
open, creation never fails.

**Money-lane investigation** (`runMoneyInvestigation`): deterministic
hours-vs-paid comparison written to `private/investigation` — every
timesheet entry with expected pay computed by the cost-report math
(reg/OT/DT × payRate + premiums + tips + bonus; csv_import excludes DT +
premiums) next to settled `getPayHistory` payments per prod linkage.
Claude only NARRATES the computed numbers → `{summary, recommendation:
pay_correction|paid_correctly|needs_review, proposedAmount (must derive
from shown numbers, ≤$10k else null; pay_correction w/o amount degrades
to needs_review), workerReplyEn/Es (for paid_correctly), rationale}`.
Runs automatically at creation for money-lane tickets + via
`payroll_investigate` action ("Re-run investigation" button).
`defaultEntityId` computed in code (unpaid entries' entity, else first
linkage) — never AI-chosen.

**One-click actions** (workerSupportAssistant):
- `payroll_authorize_correction` {ticketId, amount, workDate, hours?,
  hourlyRate?, entityId, overrideDuplicateWarning?} — gate
  `ensureBooksAccess` (level ≥6); executes via
  `createOffCyclePaymentInternal` (extracted from Mark's
  createOffCyclePayment onCall — SAME battle-tested path: duplicate-pay
  guard, $10k/$1k caps, payable + payout w/
  includeWorkersOnRegularPayCycle, reason 'payroll_correction',
  `sourceTicketId` stamped on the offcycle doc). duplicate_warning is
  passed through for a "Pay anyway" second confirm. Success: worker
  system-message + push ("correction of $X sent"), audit
  `authorize_correction`, ticket resolved, `:money_with_wings:` Slack.
- `payroll_resolve_paid_correctly` {ticketId, text} — sends the editable
  explanation (prefilled from investigation workerReply) then resolves;
  audit `resolved_paid_correctly`.

Console (PayrollTicketsPage): "INVESTIGATION — HOURS VS. PAID" panel on
money tickets (recommendation chip, summary, entries/payments tables,
totals, rationale) + green "Authorize correction — pay $X" (confirm
dialog w/ editable amount/date/hours/rate/entity), "Paid correctly —
send & resolve" dialog, "Re-run investigation".

Verified 2026-08-25 on Greg's own test tickets: money ticket ("$50
short") investigation correctly returned needs_review, refusing to
invent the $50 (only a 0-hour draft entry + zero Everee payments on
record); fix-it ticket ("switched banks") auto-resolved end-to-end
(conf 0.9 → AI reply → bank-update link → resolved by ai). ☠️ Do NOT
click Authorize on the test tickets — the test identity is Greg's own
account. NOT yet exercised live: an actual Everee correction payment
through the authorize button (first real money-lane ticket will be).

☠️ Footguns learned:
- Diagnosis sometimes omits `confidence` → coerced to 0 → no AI reply,
  no auto-resolve (safe direction; observed once locally). Don't "fix"
  by defaulting up.
- `sendNotificationAndPush` used to write `undefined` fields — only
  worked because resumeParser's module load sets
  `ignoreUndefinedProperties` globally in the deployed monolith. Now
  hardened to nulls; any new notification writer must never rely on
  that global.
- Local scratch runs: Twilio/Slack `defineSecret().value()` is empty →
  SMS/Slack silently skipped (fine — deployed callable has them bound).

## Roadmap (agreed sequence)

2. ~~Earnings v1~~ SHIPPED (above). v2: statement detail / PDF via
   evereeGetPayStatement; per-employer "view all".
3. ~~Approved actions~~ SHIPPED (above). ~~Auto-execute safe actions~~
   SHIPPED as Slice 3 auto-resolution (above). Future: flag-timesheet-
   for-correction + approver nudge.
4. **SMS intake**: dedicated Twilio number → existing inbound webhook branches
   on `To` number → `createPayrollTicket({channel:'sms'})`; replies go back
   out via SMS. Needs a number purchased/assigned (ask Greg).
5. **payroll@ email intake**: clone inbox-chief-of-staff pattern.
6. Consider pending-ticket line in Greg's morning brief (same pattern as
   deletion requests).

Skipped by decision: Slack channel; third-party ticket systems (context must
live next to Everee/timesheets for the AI).

## Pay-schedule policy — the 4 places it lives (2026-08-26)

Greg's stated policy: **C1 Select** pay week Sun–Sat, payday the FOLLOWING
Friday; **C1 Events** pay week Mon–Sun, payday Friday; all payments by
direct deposit. When this ever changes, update ALL FOUR:
1. `functions/src/workerSupportAssistant.ts` → `SUPPORT_KNOWLEDGE_V1.pay_schedule_basics`
2. `functions/src/payroll/payrollTicketsCore.ts` → BOTH system prompts
   (triage ~260 + investigator ~1142; the investigator line also teaches
   "payday not arrived ≠ missing payment")
3. `src/pages/c1/workers/payrollHelp.tsx` → "When do I get paid?" card
4. `i18n/locales/en.json` + `es.json` → `payrollHelp.schedule*` keys
   (public copies regenerate on build — commit them too)
The ticket AI context is entity-tagged (linkage lines + `[entityId]`
payments), so it answers with the worker's specific entity's schedule.

## Consolidated into ONE help door (2026-08-30, Greg)

Greg: "I am concerned about Support vs payroll help. Is it confusing to have
2 channels?" It was worse than two — the web had THREE overlapping surfaces:
`/c1/workers/support` (Claude Q&A, no ticket, no record),
`/c1/workers/payroll-help` (this queue), and the app's new Support desk.

Competitor scan (Instawork / Qwick / Wonolo): every one runs a SINGLE help
entry with categories at intake. Wonolo puts AI on the AGENT side (Einstein
drafts replies, ~20% handle-time cut) rather than gating the human. Nobody
runs parallel worker-facing channels.

**Decision — one door, AI first, ticket always available:**
- Topic chips at intake (payroll | shifts_jobs | app_issue | other) →
  grounded assistant answers → "That answered it" (nothing filed;
  deflection) or "Still need help" (files into THIS queue with the exchange
  attached as an `ai` message).
- ☠️ The recruiter is NOT the failure fallback — that's the untracked
  channel this desk was built to replace. Claude may *suggest* contacting a
  recruiter for on-shift urgency (Instawork's on-site-contact pattern), but
  every unresolved request still becomes a ticket.
- Contextual entries (payroll hub, assignment page) open the same door with
  the topic preset — `?topic=` on web, `initialTopic:` in the app.

**Grounding (`functions/src/support/workerSupportContext.ts`)**: the answer
path previously had NO worker data — it was a keyword classifier over ~7
policy entries that escalated on anything account-specific, so "where's my
shift tomorrow?" returned generic guidance. It now reads upcoming/recent
assignments, the next job order's staffInstructions, and payroll setup
booleans. Same PII rule as the diagnosis: no SSN/last-4/bank numbers.

**Always-human categories** (`requiresHuman`): credentials (password,
login, SSN, bank/routing) and anything implying money movement (not paid,
wrong amount, refund). An answer can't resolve those — someone has to act.

**Realistic deflection**: 60–75% once grounded, NOT 90%. The remainder need
a human action, not an answer.

**Renames**: staff desk is "Worker Help Desk"; `/payroll-tickets` route and
the `payroll_tickets` collection keep their names for data continuity.
`topic` defaults to `'payroll'` so every pre-existing ticket and the SMS/
email intakes stay valid.

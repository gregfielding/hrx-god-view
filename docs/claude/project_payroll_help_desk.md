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

## Roadmap (agreed sequence)

2. **Earnings v1** — native payment history from Everee API (deflection).
3. **Approved actions** (Slice 2): one-click resend onboarding link, re-run
   evereeReconcileWorker, flag timesheet for correction — staff-approved;
   money-moving actions ALWAYS human. Keep `diagnosis` additive.
4. **SMS intake**: dedicated Twilio number → existing inbound webhook branches
   on `To` number → `createPayrollTicket({channel:'sms'})`; replies go back
   out via SMS. Needs a number purchased/assigned (ask Greg).
5. **payroll@ email intake**: clone inbox-chief-of-staff pattern.
6. Consider pending-ticket line in Greg's morning brief (same pattern as
   deletion requests).

Skipped by decision: Slack channel; third-party ticket systems (context must
live next to Everee/timesheets for the AI).

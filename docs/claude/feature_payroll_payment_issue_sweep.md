# Payroll payment-issue sweep + returned funds

> Money-stuck sweep (texts workers about bounced/invalid deposits) and the 2026-09-11 returned-funds fix: Everee re-routes a long-bounced deposit to the entity's funding account, the payment reads PAID, and the sweep used to call that resolved.

Code: `functions/src/payroll/payrollPaymentIssueSweep.ts` (IO) +
`functions/src/payroll/fundsReturnedDetection.ts` (pure, unit-tested in
`functions/src/__tests__/payroll/fundsReturnedDetection.test.ts`). Hosted by
`scheduledOrchestrator` (hourly tick, self-gated to every 6h via
`payroll_payment_issues/_sweep_meta.lastRunAtMs`). Texting doctrine and
message types: [[project_sms_audit_2026_08]].

## ☠️ The incident (2026-09-11)

After ~30–45 days of failed deposits Everee gave up and sent $896.48 back to
C1 Events (email "Return of Failed Payments - C1 Events"). The four payments
then read `PAID / DEPOSITED`; `GET /api/v2/payments/{id}` showed the deposit
re-routed to C1's own Relay business checking (`depositList[].updatedAt` =
12:11Z). The sweep saw "no issue" and flipped all four issue docs to
`resolved` at 13:21Z — the workers were never paid. Ops fixed them by hand
(pattern in [[project_payroll_cost_attribution]]). Everee-side facts:
[[feedback_everee_wire_gotchas]] §24.

## Statuses (`tenants/{t}/payroll_payment_issues/{entityId}__{paymentId}`)

| status | meaning | who writes | sweep touches it? |
|---|---|---|---|
| `open` | payment shows an issue now; worker texted (max 3, 5 days apart) | sweep | yes |
| `resolved` | cleared. `deposit_returned` needs a settled deposit to a NON-company account (`resolvedEvidence: 'worker_deposit'`); `bank_invalid`/`missing_tin` resolve when the error clears | sweep, or staff "Worker was paid" | no |
| `funds_returned` | deposit went back to the entity's funding account — **worker still owed** (`stillOwed: true`) | sweep (or ops by hand) | **never** (frozen) |
| `funds_returned_repaid` | repaid by an off-cycle from the card (`repaidVia: offcycle_payments/{id}`) | `createOffCyclePayment` | never |
| `funds_returned_already_repaid` | staff say it was repaid another way; C1 keeps the returned money | staff (card) / ops | never |
| `deposit_unconfirmed` | cleared, but nothing proves the worker got the money (`unconfirmedReason`: `no_funding_account_configured`, `no_worker_deposit`, `no_deposit_records`, `deposit_in_flight` >10 days, `payment_not_found`) | sweep | re-evaluated every run |

Any status starting `funds_returned` is frozen: the upsert for
currently-failing payments skips it (no re-open, no text) and the resolve
pass never queries it.

`funds_returned` fields (same shape as the manual fix): `fundsReturnedAt`,
`fundsReturnedAmount`, `fundsReturnedSource`, `fundsReturnedNote`,
`stillOwed`, plus `evereePaymentChain`, `entryLinkStatus`, `linkedEntryIds`,
`linkedWorkDates`, `possibleRepayment {offcycleId,total,createdAt}` (an
off-cycle of exactly that amount sent after the pay date — a hint, never
proof; one of the four on 9/11 had been repaid that way).

## Per run

1. **Scan** each entity's `/api/v2/payments` **newest first** (`sort=id,desc`;
   was `asc`, and the 10×500 page cap would have dropped the newest payments
   once C1 Events passed 5,000 — it was at 4,146). Rows are sanitized on
   arrival.
2. **Upsert + text** issues within the 45-day lookback (frozen docs skipped).
3. **Returned-funds pass** — any scanned payment (no lookback: returns land
   around day 30–45) with a live deposit row on the funding account; the
   payment GET decides; creates the doc if the sweep never saw the bounce.
4. **Settle pass** — `open` + `deposit_unconfirmed` docs no longer failing:
   `deposit_returned` → GET the payment → `resolved` / `funds_returned` /
   `deposit_unconfirmed` / leave (still failing, or in flight <10 days).

## Funding accounts (config — Everee has no API for it)

`tenants/{t}/entities/{entityId}.evereeFundingAccounts = [{ bankAccountId,
routingLast4, accountLast4, label }]` — matches on `bankAccountId`, or on
BOTH last-4s (routing alone would match every account at that bank).
Never infer it from "an account shared by several employees": a family
sharing one account looks the same (seen in prod).

- **C1 Events** (3138): Everee `bankAccountId` 4027 (Relay Business
  Checking) — the row the 9/11 returns landed on. Only 6 payments ever
  deposited there, all returns.
- **C1 Select** (3133): **not configured.** No return has ever happened
  there (564 payments, no company deposit rows as of 9/11), so the account
  is unknown. Until it's set, a cleared Select `deposit_returned` goes to
  `deposit_unconfirmed` (never `resolved`) and a warning logs each run.
  After Select's first return, read that payment's `depositList` for the
  company row and add it.
- If C1 ever changes funding banks, update the field or returns will read
  as worker deposits again.

## Linking the payment to timesheet entries

All-or-nothing, strict (`matchReturnedPayables`): the worker's Everee
payables (`GET /api/v2/payables?external-worker-id=`) whose `paymentId` is in
the re-issue chain (`prevPaymentId`, up to 3 hops) must sum to the payment
gross, and each must match exactly one HRX line of the same amount (and the
label's work date when present). HRX line amounts come from the
`timesheet_import_payables` ledger, so **only CSV-import rows can link**;
grid rows have no per-line amount → `unmatched:*`, and a payment made
directly in Everee → `no_hrx_entries`. Linked entries get the manual-fix
shape: `status: 'error'`, `everee.status: 'DEPOSIT_RETURNED'`,
`everee.errorCode: 'deposit_returned'`, `everee.errorMessage` ("…repay with
an off-cycle payment; do NOT resubmit"), `everee.fundsReturnedAt`,
`everee.returnedPaymentId`, `updatedBy: 'payroll_payment_issue_sweep'`.
Why strict: a genuinely paid entry flipped to `error` drops out of cost
reports and disarms the off-cycle duplicate-pay guard.

## Ops surface

Payroll Costs (`/reports/payroll`, Payroll Report tab):
**"Returned deposits — workers still owed"** card
(`src/components/payroll/ReturnedDepositsCard.tsx`), hidden when empty,
lists `funds_returned` (stillOwed ≠ false) + `deposit_unconfirmed`,
filtered by the entity picker.
- **Repay via off-cycle** → the existing off-cycle dialog, prefilled
  (worker when the issue uid is an HRX uid, entity, reason payroll
  correction, first linked work date, amount, note); ops picks the job
  order. `createOffCyclePayment` takes `sourcePaymentIssueId` and, once
  Everee accepts, marks the issue `funds_returned_repaid` (same entity
  only; non-fatal) → `paymentIssueMarked` in the response.
- **Already repaid** (funds_returned) / **Worker was paid** (unconfirmed) —
  client writes; rules allow `isTenantAdmin` (claims Admin, or legacy
  securityLevel 6/7).

Worker-facing: unchanged. The Home/Earnings banners query `status == 'open'`,
so returned funds drop off the worker's banner and are never texted —
contact the worker by hand (the 9/11 SMS wording is in
`functions/.scratch/text_returned_workers.ts` in Greg's checkout).

## Dry run (read-only against prod)

`runPayrollPaymentIssueSweepCore({ dryRun: true, ignoreGate: true,
fundingAccountsOverride: { c1_events_llc: [{ bankAccountId: 4027 }] } })`
from a `functions/.scratch/` ts-node script (load
`functions/.env.hrx1-d3beb` for the Everee tokens) returns `plan` — every
transition it would make — and writes/texts nothing. The override is only
honored on dry runs.

2026-09-11 dry run with C1 Events configured: the four 9/11 docs untouched
(frozen), and **three older returns nobody had tracked** (they predate the
sweep: payments 23081370 $296.00 paid 5/15, 24271518 $190.72 paid 6/22,
24493763 $106.72 paid 6/25 — $593.44, all back in C1's account, no off-cycle
or later payment to those workers) would become `funds_returned`. 24493763
links one import entry (2026-06-19, verified: one payable, one ledger line,
same amount); the other two were paid directly in Everee (`no_hrx_entries`).
Without the config the same run makes zero transitions.

☠️ PII: raw payments carry `employee.taxpayerIdentifier` (full SSN) and full
routing numbers. Only `sanitizePaymentForDetection` / `sanitizePayableLine`
touch raw rows; never log or persist them.

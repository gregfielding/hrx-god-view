# Worker onboarding + Everee without the embedded widget — investigation (2026-08-21)

> **2026-08-31 — ☠️ THE 48h WAVE GATE IS WRONG. Onboarding takes WEEKS, not days.**
> Re-count before scheduling EV-1 (Greg's ask), and it corrected two things this doc previously
> implied.
>
> **Completion curve, measured on August-invited C1 Events workers who finished (n=213):**
> median **6.8 days** invite→complete, p75 16.9d, p90 **22.7d**. Only **15% finish within 1 day**,
> 30% within 3, 51% within 7. Nothing about this process resolves in 48 hours.
>
> - **Therefore drain-wave conversion CANNOT be judged at 48h** (the gate written in the
>   2026-08-30 wave-1 entry below). Wave 1 sent 2026-08-30 08:58 PT; at 31h it showed 1/50 (2%),
>   which is roughly what a normal-but-modest conversion looks like that early — NOT evidence of
>   failure. Judge a wave at **~7 days minimum**, ideally 14. Scaling to 150/day on a 48h read is
>   deciding on noise.
> - **"The backlog replenishes ~100/month" is FALSE** — an artifact of measuring a cohort before
>   it has had time to complete. Of the 113 August-invited links sitting at `created`, **107 are
>   still inside the p90 completion window** and only **6** are genuinely beyond it. August is
>   leaking ~6, not ~113. Any month-over-month stuck count taken less than ~23 days after invite
>   overstates the leak, badly.
>
> **Census 2026-08-31**: Events **876** stuck / 3,043 (29%), Select **624** / 795 (78%, still
> deferred on the I-9 document-set question with Piers). 1,500 total. Events 860 → 876 is cohort
> aging, not new breakage.
>
> **The recruiter-proxy hypothesis does NOT hold for the August cohort.** Comparing the 113
> stalled against the 213 completed, every data-quality marker in "Why recruiter-proxied
> onboarding backfires" (below) either fails to discriminate or points the wrong way:
>
> | marker | stalled | completed |
> |---|---|---|
> | no home address | 3% | **12%** |
> | shared phone | 2% | 0% |
> | shared email | 0% | 0% |
> | smsOptIn false | 2% | 1% |
>
> The stalled cohort is *cleaner* than the completed one, and origin mix is near-identical
> (phone_signup 38% vs 30%, public_jobs_board 57% vs 55%). Whatever produced the legacy pile is
> not operating now — **August completion is 65% and still climbing** as in-flight links land.
> Do not carry the recruiter-proxy explanation forward to recent cohorts without re-testing it.
>
> **What this means for EV-1**: it IS a bounded legacy cleanup, not a moving leak — there is no
> source problem to fix first. The real drain target is **May (231) + June (172) = 403 links**,
> all 60+ days past invite and unambiguously cold. Sizing note: only 598 of the 876 stuck links
> can be dated at all (via `worker_payroll_accounts` invite stamps — `everee_workers` docs carry
> NO usable date field); the other 278 are the true undated legacy bulk.

> **2026-08-28 — widget punch-list audit DONE** (Greg's pre-removal ask, OnTrac-driven; artifact
> https://claude.ai/code/artifact/7d3e1400-e182-4180-a137-128722d43c87). Key findings on top of the
> 2026-08-21 investigation below:
> - **Only widget-exclusive captures**: full SSN, bank account, W-4 (8 fields, exact
>   `withholdingSettings` enum parity in complete-record), W-9 certification + e-sign (NO API
>   fields — biggest build item), ESIGN/disclosure consents. Everything identity/comp we already
>   pass at create.
> - **Show-now natively (API integrated, worker self-access already allowed)**: pay history/stubs
>   LIVE (Earnings v2 2026-08-24); tax documents page (`/api/v2/workers/files` type TAXES via
>   `evereeAdminGetWorkerDocuments`); W-4/W-9 read-only cards (`evereeAdminGetWorkerW4/W9`);
>   deposit-account last-4 card; native checklist from `evereeGetMyOnboardingStatus`; address
>   already syncs via `evereeUpdateWorkerAddress`.
> - **Verify-live before switch**: widget pre-fill, state withholding handling (not in
>   complete-record schema), post-onboarding W-4 changes (no update API found), pay-card decision
>   (`PAY_CARD_SIGNUP` embed never mounted). Cheapest: walk ONE test worker through the widget and
>   screenshot every step.
> - Embed catalogue (docs 2026-08-28): ONBOARDING V2_0, WORKER_HOME/PAYMENT_HISTORY/TAX_DOCUMENTS/
>   PAYMENT_DEPOSIT/HOME_ADDRESS/PAY_CARD_SIGNUP V1_0. Only ONBOARDING + WORKER_HOME are mounted
>   in HRX; the rest reachable via the hub. `update-payment-preferences` documented but NOT
>   integrated (bank changes post-switch need it or a kept embed).
>
> **SANDBOX TEST PASSED + v1 SHIPPED (2026-08-28, sandbox tenant 2320, walked live via a local
> harness — MessageChannel port-transfer per hostMessageBridge is REQUIRED or the embed ignores
> input/events):**
> - **Step-skipping CONFIRMED**: 1099 contractor with bank PUT'd by API before first widget open
>   walked payee-type → SSN+consent → personal info → W-9 → "Success!" — NO payment-method step;
>   ended `onboardingComplete: true` with our pushed account as direct deposit.
> - **Bank PUT works mid-onboarding** (both W-2 + 1099 test workers). **Pre-fill CONFIRMED**
>   (name/DOB/address; contact-info step skipped entirely — DOB re-ask reports = legacy cohort).
> - **ESIGN consent lives on the widget's SSN screen** (Everee ToS/privacy/e-records agreement).
> - **☠️ "Tax forms" step = per-tenant DOCUMENTS ENGINE**: sandbox served full CA DE-4 (typed
>   e-signature) AND a complete I-9 (Section 1 + Section 2 List A/B/C uploads). Document set is
>   Everee tenant config → CHECK PROD Select 3133 / Events 3138 onboarding document sets in Everee
>   admin; Select must not double-collect I-9 (WorkBright owns it).
> - **Shipped v1 (commit 6356df0d)**: native bank-first card on WorkerPayrollEvereeTenant before
>   the ONBOARDING embed mounts; details ride `evereeCreateOnboardingSession` (`bankAccount` input,
>   `bankPush` result) in transit only — `updateWorkerDefaultBankAccount` in evereeService sanitizes
>   errors (Everee 4xx text can echo submitted digits), ABA checksum both sides, cache-reuse is
>   bypassed when a bank rides along. Push failure falls back to the widget's own bank step.
> - Test workers left in sandbox: `shrinktest_20260828` (W-2, stopped at I-9),
>   `shrinktest_1099_20260828` (1099, completed). Scratch: `.scratch/shrink-*.ts` + scratchpad
>   `harness.html`.
>
> **Last-4 SSN: already Everee-sourced (2026-08-21) + full-TIN leak fixed (2026-08-28).** The
> wizard stopped asking last-4 on 2026-08-21; `evereeReconcileWorker` stamps
> `users/{uid}.last4SSN` from the worker record's `taxpayerIdentifierLast4` once payroll
> onboarding completes (`taxIdentity.source: 'everee'`), and the recruiter payroll panel reads
> the live value. ☠️ While verifying that path: `GET /api/v2/workers/{id}` returns the FULL
> 9-digit `taxpayerIdentifier` (and `/integration/v1/workers/{id}` does too) — and
> `evereeAdminGetWorker` was forwarding the record verbatim, so full SSNs were reaching admin
> browsers in the network payload. Fixed 2026-08-28 (commit 7bc205ad): `scrubFullTinDeep`
> strips every full-TIN key server-side on evereeAdminGetWorker + evereeAdminGetWorkerW9;
> last-4 survives. Any future code touching those Everee worker endpoints MUST scrub before
> returning to a client.
>
> **Admin/worker bank editing SHIPPED (2026-08-28, commit 93ac58d5).** User > Payroll panel (both
> admin and worker-facing mounts of EmployeePayrollSection) has an Add/Replace bank account dialog:
> optional `setDefaultBankAccount` on `evereeAdminGetWorker` PUTs the account and returns the fresh
> scrubbed record in one round trip (`bankUpdate` result field; ABA checksum via shared
> `src/utils/abaRouting.ts`). This retires the PAYMENT_DEPOSIT embed for bank changes. Earnings
> picker also reworked same day (commit daafc3ea): cards titled "W-2 Employee" / "Independent
> Contractor" (entity name in caption, EN+ES) and shown from onboarding START (everee_workers
> linkage w/ worker id) unless employment ended — no longer requires an active employment row.
> Limit: Everee's update APIs accept NO phone/email post-create — those edits stay HRX-side (ask
> Piers).
>
> **Architecture direction (Greg, 2026-08-28): SHRUNKEN WIDGET, not full native.** Push everything
> we can by API so the ONBOARDING widget collapses to one short step (SSN + W-4/W-9) and Everee
> keeps the compliance surface. Deciding facts: SSN is settable ONLY at complete-record create —
> `update-personal-information` (PUT /integration/v1/workers/{id}/personal-info) explicitly
> excludes it, so on the widget path SSN never touches our systems at all; bank HAS a real update
> API (`PUT /integration/v1/workers/{id}/bank-accounts/default`, full fields — note it reroutes all
> not-yet-approved payments); complete-record has ZERO state-withholding fields, and OnTrac W-2
> spans many state-certificate states (NJ/OH/IL/NC…) — full-native would mean hand-building state
> tax forms. Verify-live for the design: (1) widget step-skipping when bank pre-pushed by API,
> (2) bank PUT during onboarding-in-progress status, (3) ask Everee (Piers) about a scoped
> tax-forms-only session/experienceOptions. Full-native shelved unless the one embedded step
> measurably loses workers.

> **EVENTS DRAIN WAVE 1 SENT (2026-08-30, Greg-approved copy + pacing).** Fresh census: Events
> 876 stuck `created` (was 860), Select 624/795 (78%) — Select intentionally deferred (I-9
> document-set question with Piers outstanding; Events is 1099 = no I-9, sandbox contractor flow
> verified clean). Wave 1 = 50 workers (all 35 with hours in last 60d prioritized), bilingual SMS
> with per-worker `/c1/workers/payroll/{evereeTenantId}` link via `resolveWorkerOnboardingLink` +
> `sendWorkerMessageInternal` (same rails as the manual "Resend payroll link" button; audit rows
> in `onboarding_reminder_audit` source `events_drain_wave1`). Result: 49 sent (Twilio sampled
> `delivered`), 1 correctly refused (smsOptIn=false). Filters held back: 152 no-address, 31
> duplicate-phone, 22 orphaned-uid links, 7 bad phones — each needs its own repair pass before
> those cohorts can be drained. Links stamped `drainWave: 1`; track conversions with
> `.scratch/check-drain-wave-status.ts` (status flips created→onboarding_complete). Next waves:
> scale to ~150/day if wave-1 conversion looks healthy after ~48h. ☠️ Script gotcha: the generic
> `payrollInviteResend` path is dead for Everee entities (entity `payrollSettings` is null →
> `not_applicable` skip) — Everee drains MUST use `resolveWorkerOnboardingLink`, not
> `loadEntityPayrollInviteContext`.

> **HIRE-MOMENT COPY REWRITE SHIPPED (2026-08-30, Greg-approved).** workerHiredDispatch default
> SMS/email/push bodies now lead with classification + entity ("...independent contractor (1099),
> no taxes withheld" / "on-call W-2 employee, taxes withheld every paycheck"), name the tax form
> (W-9 vs W-4+I-9), template the employer-of-record ({hiringEntityName} — supports C1 Workforce
> LLC with zero copy changes), NO overtime/WC claims (Greg's call), and carry a best-effort
> inline payroll link. Based on "The Hire Moment" competitor research artifact
> (claude.ai/code/artifact/31ef433e-7970-4ef6-a1a3-cf2fd9a5dc93). ☠️ Deploy lesson applied:
> ALL NINE functions bundling workerHiredDispatch were deployed together (logAssignmentUpdated,
> placements trio, startOnCall pair, evereeAdminRecreateWorkerOnboarding,
> processWorkerOnboardingReminders, resendOnboardingPayrollLink) — never just one, or the others
> serve stale copy. Drain wave-2 script copy updated to classification-led framing. Tenant
> automation rules still override defaults. REMAINING copy surfaces not yet touched: R1–R5
> reminder bodies (buildOnboardingReminderSmsBody), payrollInviteResend generic text.

> Greg: workers "sign up with us and then have to sign up again with Everee — both need emails and
> passwords; we ask last-4 SSN, Everee asks the whole thing." Compared unfavorably to Instawork /
> Qwick. Greg + Mark independently concluded: **phone-number auth instead of email/password.**
> Status: investigation + options, not built. Companion to [[project_recruiter_roster_adoption]].

## Live state — Venue Smart (C1 Events, 1099) workers with imported hours, last 60 days: 593

- Everee link status: **553 onboarding_complete, 38 `created` (never finished)** → the future
  "can't be paid" tickets. Across ALL C1 Events links: 2,029 complete vs **860 stuck at `created`**
  (30%; no `createdAt` stamped on those docs — bulk/legacy provisioned).
- **118 (20%) no home address** (legacy tail; wizard requires address at account creation since
  ADDR-1 2026-08-07). **12 duplicate phone numbers** = duplicate accounts (Ana Ibarra ×12).
- Language 468 en / 68 es / 55 unset — many "en" are Spanish speakers never asked.
- Account origin: public_jobs_board 185, apply_group_landing (Rosa's link) 180, apply_landing 131,
  tempworks migration 51, admin_create_worker 44. 275 accounts created in July (festival season).
- No recruiter-inbox fingerprints (no `rosa+name@` emails) → when Rosa's team onboards "for" a
  worker it's on the worker's phone with the worker's email → worker can't get back in later.

## Why recruiter-proxied onboarding backfires
identity = email+password the worker doesn't own → lockouts land on Rosa; Everee invite goes to an
inbox they don't check → `created` forever; recruiter-typed SSN/routing typos → failed payments weeks
later; worker later self-signs with another email → duplicate account, split hours; attestations /
W-9 / policy acks completed by a non-signer = exposure (audit quietly).

## What our Everee integration does today (functions/src/integrations/everee/evereeService.ts)

- Create: W-2 `POST /api/v2/embedded/workers/employee`, 1099 `POST /api/v2/embedded/workers/contractor`
  (switched from hosted `/api/v2/onboarding/contractor` on **2026-06-23** — Destinee Williams lockout).
  We pass name/phone/email/DOB/homeAddress (+comp for W-2). DOB matters: missing DOB → Everee
  anti-fraud flips `accountAccessPermitted:false` (~25% of provisions pre-fix).
- Onboard: `POST /api/v2/embedded/session` experience `ONBOARDING` V2_0 with
  **`experienceOptions.accountSetupEnabled: false`** (since 2026-06-23) → per Everee docs "no login
  account or password will be created". Worker completes SSN / bank / W-4 or W-9 inside the HRX-hosted
  iframe. Other experiences: WORKER_HOME, PAYMENT_HISTORY, TAX_DOCUMENTS, PAYMENT_DEPOSIT, HOME_ADDRESS
  (all minted by workerId — no Everee login anywhere).
- ⇒ **Anyone provisioned after 2026-06-23 should NOT be creating an Everee login.** If Rosa's
  workers still hit an email/password wall, suspects: (1) legacy cohort (the 860 `created` links
  predate the switch — their path is still Everee-hosted), (2) Everee tenant-level notification
  emails inviting workers to everee.com (check Everee admin → notifications), (3) the HRX login
  itself being perceived as "the second sign-up". **Verify by watching one live sign-up with Rosa.**
- Duplicate data entry is real regardless: HRX wizard collects name/address/DOB/last-4 SSN, then the
  widget asks again for DOB?/full SSN/bank. Fields passed at create (name, phone, email, DOB,
  address) should pre-fill — confirm in the widget; **drop our last-4 SSN question** (redundant: I-9
  is WorkBright, payroll SSN is Everee's).

## Everee API — the path WITHOUT the widget (developer.everee.com, read 2026-08-21)

- **`POST /api/v2/workers/contractor` — "Add a complete contractor record"**: firstName, lastName,
  phoneNumber(10), email, hireDate, dateOfBirth, **taxpayerIdentifier (9 digits)**, homeAddress
  (line1, city, state, 5-digit zip), **bankAccount {bankName, accountName, accountType
  CHECKING|SAVINGS, routingNumber(9), accountNumber}**, legalWorkAddress {useHomeAddress|workLocationId};
  optional middleName, onboardingComplete (default true), externalWorkerId, approvalGroupId.
  → 201, worker **Active, no worker-facing onboarding**. No W-9 / e-sign / consent fields in the
  schema. Docs: "the integrating application assumes the risk and responsibility" for the PII.
- **`POST /api/v2/workers/employee` — "Add a complete employee record"** (W-2): same identity +
  bank + payType/payRate/hireDate/typicalWeeklyHours + **withholdingSettings** (2020+ W-4:
  maritalStatus, haveExactlyTwoJobs, countOfChildren, countOfOtherDependents, exempt,
  otherIncomeAnnually, deductionsAnnually, extraWithholdingsMonthly); optional paySchedule,
  eligibleForOvertime, socCode, timeOffPolicyId… → Active, "no further worker-facing onboarding".
- Later changes: `update-personal-information` (name/DOB), `update-payment-preferences` (ACH / pay
  card), `get-w-4-tax-withholding-settings`, `get-w9-info`, `get-access-details-for-worker`
  (invitation URL), `look-up-hiring-status-for-a-worker`, `rehire-a-worker`.
- What we'd take on by skipping the widget: **SSN + bank capture** (client → callable → Everee,
  never persisted in Firestore/logs; encrypt in transit; field-level masking), **W-9 (1099) / W-4
  (W-2) presentation + e-signature** with ESIGN consent (HRX-Signatures/DropboxSign spec exists),
  routing-number validation (ABA checksum + bank lookup), and Everee anti-fraud outcomes
  (`accountAccessPermitted`) surfacing as our support problem. I-9 stays WorkBright.

## Options

1. **Fix what's already fixable (days):** confirm live what workers see; drain the 860 `created`
   backlog (re-mint embedded ONBOARDING sessions via SMS magic link — no login needed now); remove
   last-4 SSN + any duplicated wizard fields; verify widget pre-fill; set language properly.
2. **Hybrid (weeks):** phone-OTP identity for HRX (no password) + one HRX flow that collects
   everything we can legally hold (name, phone, address, DOB, language, W-9/W-4 elections) and hands
   the worker ONE secure step (embedded session, no login) for SSN + bank. One sign-up, zero passwords.
3. **Native (Instawork/Qwick parity, 1–2 months):** complete-record API; HRX collects SSN + bank in
   its own secure screen and the worker is Active in Everee instantly; PAYMENT_DEPOSIT embed or
   update-payment-preferences for later bank changes. Pilot with 1099 (no W-4, no I-9): bank +
   SSN + W-9 e-sign only. Requires the PII/e-sign work above and a security review.

Recommendation: 1 now, 2 as the real project (phone auth is the keystone — same conclusion Greg +
Mark reached), 3 only if the hybrid's single secure step still loses workers.

## Open questions (for Rosa's team)
Where exactly do workers stall (wizard step, email/password, the Everee step)? What does "doing it
for them" look like concretely (whose phone, which steps, live or later from the sheet)? Is intake
in person at the venue or remote?

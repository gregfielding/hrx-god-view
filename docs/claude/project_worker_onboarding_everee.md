# Worker onboarding + Everee without the embedded widget — investigation (2026-08-21)

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

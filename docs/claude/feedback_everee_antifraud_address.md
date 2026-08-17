# everee antifraud address

# Everee anti-fraud lockout from stub home address

## ⚠️ 2026-06-09 CORRECTION (from Everee dev Piers) — `accountAccessPermitted` is NOT a lock

`accountAccessPermitted: false` does **not** mean the account is locked,
blocked, or anti-fraud-flagged. Per Piers (Everee), it ONLY means the worker
hasn't set up an Everee login **password** yet — the password is created
about halfway through onboarding, at which point the flag flips to `true`. So
`false` is the **normal** state for anyone who hasn't reached that step.

This invalidates key claims in the sections below — read them with this lens:
- The 2026-05-27 audit's "~25% still locked despite a valid address" metric
  bucketed on `accountAccessPermitted === false`. That's mostly just
  "hasn't finished onboarding / no password yet," **not** fraud locks. The
  "missing DOB → `accountAccessPermitted: false`" causal theory is **wrong**.
- The DOB-at-provision change is fine to keep (Everee wants the identity data;
  harmless, helps TIN), but its anti-fraud justification was a misread.
- The REAL onboarding lock ("onboarding has been locked due to a possible
  security risk", the iframe/hosted banner) is a **separate** mechanism —
  Piers: triggered when a worker is prompted to log into an EXISTING Everee
  account and enters an invalid password several times. (The May rapid
  session-create + identical-stub-address incidents may also trip the genuine
  fraud engine.) **We have no direct API flag for the real lock** — only the
  worker sees the banner. Remediation when they actually hit it: send the
  Everee-hosted onboarding link, then escalate to Everee support.
- HRX UI fix (commit `<this session>`): `EmployeePayrollSection` no longer
  renders a red "Account locked by Everee / anti-fraud" banner for
  `accountAccessPermitted === false`. Reframed to a calm info note ("Everee
  login not set up yet — normal until ~halfway through onboarding"), keeping
  the hosted-link button for workers who report the real lock screen. The
  table address-badge is unaffected (it gates on missing home address, which
  is still a legit data-quality flag).

---


Production incident 2026-05-23: "most newly provisioned users
have their accounts locked due to suspicious activity" inside the
Everee onboarding embed. Sibling failure to the May 14 rapid
session-create lockout (different trigger, same anti-fraud engine).

## Root cause

`evereeEnsureWorker` (the callable behind `EvereePayrollSetupEmbed`
and the Admin Sync card) never read `users/{uid}.addressInfo`
before posting to Everee's `/api/v2/embedded/workers/employee`.
`createWorkerIfNeeded` injected a sandbox stub home address
`"1 Sandbox Way, San Francisco, CA 94105"` when the caller didn't
supply one. Result: every new W-2 worker landed at Everee with
the same home address. Anti-fraud engine read the pattern as
synthetic-identity / account-takeover and locked the new accounts
with the "Your onboarding has been locked due to a possible
security risk" message.

The code's own doc-comment had foreshadowed it:
> "Production callers should thread real worker address +
>  compensation from profile / assignment data."
But the wiring was never done.

## Fix (PR-less commit 990ec7bc on main, deployed)

1. `evereeEnsureWorker` now reads `users/{uid}.addressInfo` via
   `extractEvereeHomeAddressFromUserDoc` and passes the resulting
   `EvereeAddress` to `createWorkerIfNeeded`.
2. When the worker's profile address is incomplete (street, city,
   state, ZIP all required), the callable throws
   `HttpsError('failed-precondition', …)` with a clear message
   instead of falling through to the stub. Both the embed dialog
   and the Admin Sync card route this through
   `formatFirebaseHttpsError` → surfaces as a useful toast.
3. Lowest-level guard in `createWorkerIfNeeded`: refuses to use
   the stub home address whenever the resolved
   `config.evereeTenantId` is not the sandbox (`'2320'`).
   Future callers can't accidentally bring the bug back.

Contractor (1099) path is unaffected — it uses
`legalWorkAddress: { useHomeAddress: true }` and never had a
stub fallback.

## Remediation for already-locked workers

This fix only stops NEW lockouts. Workers already locked
(`accountAccessPermitted: false`) cannot be unlocked from our side
— contact Everee support with the affected Everee worker IDs.

## Other fields the engine might key on (for next time)

Watching for future flagging triggers — these are the other
fields all newly-provisioned workers share identical values for
today, in descending order of fraud signal:

1. **Home address** — fixed above
2. **Phone** — usually unique per worker, fine
3. **Email** — usually unique per worker, fine
4. `payRate` — stub `$20.00/HOURLY` for every new worker. Less
   risky (real businesses commonly pay same rate across roles),
   but worth threading from JO data if we hit a second wave
5. `typicalWeeklyHours` — stub `40` for every new worker. Even
   less risky (warehouse jobs default to 40)
6. `hireDate` — defaults to today (varies by provisioning day, not
   a fraud signal)

If we ever see another anti-fraud surge after #1 is fixed,
investigate the order above.

## How to detect re-occurrence

1. Tail logs:
   ```sh
   gcloud functions logs read evereeEnsureWorker \
     --gen2 --region us-central1 --project hrx1-d3beb --limit 50
   ```
   Look for `homeAddress fetch failed` or `failed-precondition`
   throws — those are the new guards firing.
2. Watch Everee dashboard for `accountAccessPermitted: false` on
   newly-created workers.

## Related files

- `functions/src/integrations/everee/evereeCallables.ts` —
  `evereeEnsureWorker`, `fetchEvereeHomeAddressFromUserDoc`,
  `fillEvereeIdentityFromUserDoc`
- `functions/src/integrations/everee/evereeService.ts` —
  `createWorkerIfNeeded`, the stub fallback + new sandbox-only
  guard
- `functions/src/integrations/everee/evereeUserAddress.ts` —
  `extractEvereeHomeAddressFromUserDoc` (the helper that was
  already there but never wired in)
- `functions/src/onboarding/restartEvereeOnboardingCallable.ts`
  — already wires home address correctly; now also benefits
  from the lowest-level guard

## 2026-05-27 follow-up — address fix did NOT solve the systemic lockout

Three more pieces of evidence + a new root cause hypothesis:

### Evidence

1. **Tenant-wide audit** after the 830-record address patch sweep
   (`functions/.scratch/auditEvereeLockStatus.ts`) found ~25% of
   linked workers STILL locked despite having a complete home
   address pushed to Everee:
   - 591 unlocked
   - 249 locked WITH valid address now on file
   - 135 locked WITHOUT HRX address (recruiter must collect)
   - 97 rate-limited (status unknown)
2. **Pamela McDonald** (the first reported lockout — a 1099
   contractor) DID unlock after we pushed her real address. So the
   address push works for the subset who hit only that signal.
3. **Craig Steffey Sr** (reported 2026-05-27, lockout #2) was
   provisioned TODAY with a valid home address from the start —
   still locked, zero embed sessions, zero webhook events. So the
   address fix didn't prevent his lock either.

### New root cause (likely the systemic ~25%)

We never passed `dateOfBirth` to Everee at create. Probe confirmed
`PUT /api/v2/workers/{id}/personal-info` accepts `dateOfBirth`
(HTTP 200; value persists on GET). Without DOB AND without SSN
(which we also don't pass at create — worker enters it during
onboarding), Everee has zero identity-verification signal at
provision time. Their anti-fraud engine defaults to
`accountAccessPermitted: false` until the worker proves identity
via the hosted onboarding flow.

### Forward fix (commit e6be9a71, deployed 2026-05-27)

- `CreateWorkerInput.dateOfBirth?: string` added (YYYY-MM-DD shape).
- Three callers thread DOB from `users/{uid}.dateOfBirth ?? .dob`:
  `evereeEnsureWorker`, `startOnCallEmployment`,
  `restartEvereeOnboardingCallable`. Format-validated against
  `/^\d{4}-\d{2}-\d{2}$/` so a malformed legacy value can't 422
  an otherwise-clean provision.
- Included in BOTH the W-2 (`/embedded/workers/employee`) and
  contractor (`/onboarding/contractor`) request bodies.

### Retroactive (does NOT clear existing locks)

Like the address fix, pushing DOB to a worker who's already locked
does NOT clear `accountAccessPermitted` (confirmed on Craig).
Everee's anti-fraud doesn't auto-re-evaluate. For the ~384 already
locked workers, the options remain:

1. **Send Everee-hosted onboarding link** — pre-built affordance on
   the User Details page. Worker completes onboarding via Everee's
   branded UI using a different signing context, which bypasses
   the lock. This is the documented workaround in the in-app
   advisory.
2. **Contact Everee support** with the worker IDs. The 31
   ACTIVE+locked-and-onboarded workers are the cleanest support
   ticket — onboarding's done, no other action is possible from
   our side.

### How to verify the forward fix is working

After the next batch of new provisions, run the audit again and
compare the unlocked / locked ratio for workers whose linkage
`createdAt > 2026-05-27T17:00:00Z`:
```sh
cd functions && PATH=… GOOGLE_APPLICATION_CREDENTIALS=… \
  npx ts-node .scratch/auditEvereeLockStatus.ts
```

If the new-worker unlock rate is significantly higher than the
historical ~55%, the fix is landing.

### What's NOT yet checked

- **SSN at create** — Everee may accept `taxpayerIdentifier` or
  `ssn` on the create body too, but we'd need to probe. Adding
  it would be the strongest identity signal (DOB+SSN+address is
  the full KYC trio). Risk: SSN handling adds PII surface we
  don't want unless necessary.
- **Whether Everee re-evaluates anti-fraud on `dateOfBirth` PUT**
  for already-locked workers — confirmed it does NOT for Craig,
  but maybe a multi-field push (DOB + something else) would.

### Related new files (2026-05-27)

- `functions/.scratch/auditEvereeLockStatus.ts` — tenant-wide
  read-only sweep that buckets every linked worker by
  `accountAccessPermitted` × hasAddress × lifecycle.
- Updated `feedback_everee_wire_gotchas.md` should add the
  `dateOfBirth` PUT endpoint to its §6.

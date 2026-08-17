# everify disabled

> "E-Verify processing in HRX was fully disabled (full stop) on 2026-06-30 at the user's request; reversible by flipping EVERIFY_ENABLED back to true + redeploy."

On 2026-06-30 Greg asked to "stop all E-Verify processing through HRX." Done via the existing gate: set `EVERIFY_ENABLED=false` in `functions/.env` AND `functions/.env.hrx1-d3beb` (both were `true`), then redeployed the 18 E-Verify functions.

`functions/src/integrations/everifyGate.ts` loads the real `./everify` module only when `EVERIFY_ENABLED === 'true'`; otherwise every export is a stub — all 14 callables throw `failed-precondition` "disabled", and the automatic processors (`scheduledEverifyPoller` cron, `onUserEmploymentUpdatedEverify` trigger, `onEverifyCaseUpdatedSyncOnboarding` trigger, `processEverifyCaseFromEmployment` HTTP worker) become no-ops. So nothing E-Verify runs in HRX now.

**Why this is worth remembering:** the flag lives in gitignored local `.env` files (not in the repo), so inspecting code shows the gate but not that it's currently OFF. The disable is GLOBAL across project `hrx1-d3beb` (effectively C1 Staffing's instance).

**Scope at time of disable:** C1 had 52 `everify_cases` — 16 closed, 35 error, 1 pending (the only in-flight case; it no longer auto-updates).

**To re-enable:** set `EVERIFY_ENABLED=true` in both env files + redeploy those 18 functions (secrets `EVERIFY_WS_USERNAME`/`EVERIFY_WS_PASSWORD` must be present). While disabled, any legally-required E-Verify must be done directly in the federal E-Verify portal. Related: [[reference_tenant_entity_ids]].

**2026-08-14 update — WorkBright is the successor, not a re-enable:** WorkBright is LIVE for I-9s (E-Verify expected same day). Verified live: new Everee workers report `hasWorkbrightDocs: true` on `/api/v2/workers/{id}/onboarding-status` (Larry Haywood, Patricia Phipps) while pre-cutover workers stay `false` (Zaon Cox May record) — the per-worker rollout signal built 2026-07-11 (evereeReadinessMirror.ts) works, and I-9 Section 2 still auto-resolves via `documentsVerifiedByCompany`, so ALL HRX employer surfaces (Pending Employer I-9, /readiness/i9-signatures, countdown, profile chips) keep working unchanged through the cutover. GAP: Everee's onboarding-status carries NO E-Verify case state, so WorkBright-run E-Verify is invisible to HRX — the readiness `e_verify` step needs the manual "completed outside HRX" checkbox until a WB-1 integration (WorkBright API/webhooks → auto-complete e_verify on AUTHORIZED + TNC alerts; blocked on getting WorkBright API credentials from their rep). The 18 stubbed functions should be deleted (not re-enabled) once WB-1 lands. **Chip rule (5d20375f, 2026-08-14):** I-9 Section 2 completion now flips `entity_employments` status/employmentState `onboarding`→`active` (trigger onEntityEmploymentI9Section2WriteUpdateReadiness — the choke point all stamp writers pass; skips terminated/DNR; payroll gates untouched), which is what every yellow "Onboarding" chip folds from (tables/tiles/header). 46-doc backfill executed (`.scratch/backfill-i9-active-chips.ts`).


**2026-08-17 — E-Verify web-services connected; case-status visibility blocked on Everee/WorkBright:**
Greg fixed the Onboarding+ connection with John Dodson (Everee): the
Web Services Credentials field needs the E-Verify web-services USER ID
(`GFIE3537`, role "General User, Web Services Access"), NOT an email;
the Program Administrator ID field is `GFIE8869` (separate account).
The web-services user's E-Verify password was rotated (exposed in a
support screenshot) and EXPIRES ~Nov 12, 2026 — E-Verify passwords
expire every ~90 days, so expect the connection to break quarterly
until someone owns rotation.
Probed the Everee API post-connection: `onboarding-status` still
exposes ONLY hasWorkbrightDocs + documentsVerified(ByCompany) — no
E-Verify case state; `/workers/{id}/e-verify|everify|i9|i9-status|
workbright` and `/e-verify/cases` all 404. Case results (Employment
Authorized / TNC) live only inside WorkBright.
ASK OUT (2026-08-17): Greg emailed John Dodson requesting API field /
webhook / WorkBright API token for per-worker case status. When it
lands: extend the readiness-mirror cron (NO new function — Cloud Run
cap) to stamp eVerify state on the employment record + chip/column +
TNC alert (TNC has an 8-federal-workday clock). Until then, Section-2
completion (documentsVerifiedByCompany → green Active chip) is the
working proxy: E-Verify runs post-hire and only an unresolved TNC
blocks continued employment.

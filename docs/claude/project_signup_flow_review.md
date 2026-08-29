# Worker signup flow review (2026-08-28) — findings + redesign plan

> Greg: "The flow should be intuitive. Currently, it's a mess." Full review
> artifact (flow maps, ranked findings, build plan):
> https://claude.ai/code/artifact/098affb9-98b4-4063-b811-27462760254a
> Status: REVIEW DELIVERED, build not started.

## The two paths (live code, 2026-08-28)

- **Path A (jobs board → job apply)**: /apply/{slug}/{jobId} → Wizard.tsx.
  Phone-OTP signup at step 0 (checkOtp in twilio.ts creates passwordless
  auth user, source 'phone_signup'), email+address, then up to 9 screens
  (resume/headshot/skills/education/certs/experience mostly self-skip,
  requirements ack last). Ends BACK ON THE JOBS BOARD after 1.5s;
  prescreen SMS ~15min later.
- **Path B (group landing /c1/apply/group/{id} → auto-hire, VenueSmart)**:
  same wizard, 4-6 screens (no jobId → optional steps skip; email
  optional). Membership write fires onUserGroupMemberAddedAutoOnboard →
  runStartOnCallEmploymentFlow (employment row + onboarding pipeline +
  Everee provision, idempotent, audited). Lands on the DASHBOARD; payroll
  setup arrives later via SMS with a legacy /payroll redirect-hop link.

## Ranked findings

1. ☠️ **Hired→paid handoff broken by design**: auto-hired worker lands on
   dashboard; the payroll-setup moment is deferred to SMS. (A stale
   docblock on PostSubmitRedirect says it was DESIGNED to land on payroll.)
2. ☠️ **Three front doors, three data contracts**: wizard (OTP+DOB+group
   add) vs jobs-board AuthDialog (NO DOB → 18+ check silently skipped, no
   group auto-add, signupSource 'jobs_board_dialog') vs dead
   email/password branches in both.
3. ☠️ **Silent no-op hiring**: group path creates NO application doc, so
   any quality preset except hire_everyone silently skips the member —
   worker + recruiter both see nothing.
4. Path A = 9 screens for gig work; completion ~75%; two nudge crons +
   SMS prescreen flow exist to chase the fallout.
5. **Dead auto-hire door**: onApplicationHiringSignalsChangedAutoOnboard
   requires application.groupId which the wizard never writes.
6. Group evaluator falls back to "any application, limit 1" — can judge
   the wrong application.
7. Doubled work: group auto-add runs twice per signup (trigger fires 2×);
   two group-resolution utils (applyWizardGroupAutoAdd vs
   quickApplicationSubmit); two shells host the same wizard.
8. ~300 lines dead signup code (Wizard.tsx:1864-2002 unreachable
   email/password branch; AuthDialog same; orphaned EVerifyComfortStep/
   ReviewSubmitStep; hidden dup nav bar; stale docblocks).
9. WorkerNav + server SMS URLs (workerUrls.ts:104) still use
   /c1/workers/payroll → redirect hop after the 8/23 earnings rename.

## Agreed target (proposed, not yet approved to build)

One front door, 4-screen spine, hire lands IN SESSION on the Payroll-hub
setup checklist (shipped 2026-08-28); prescreen offered in-session after
apply; resume/headshot/education move to post-hire Work Profile; AuthDialog
signup routes to wizard; group path creates application doc + pending
state (revives the signals door, kills the wrong-app fallback).

Build plan: quick wins (~half day: hired→Payroll-hub landing, /earnings
SMS links, dedupe auto-add, AuthDialog reroute) → convergence (~2-3 days)
→ dead-code cleanup (~half day). Related: [[project_worker_onboarding_everee]],
[[project_recruiter_roster_adoption]], feedback_apply_* docs.

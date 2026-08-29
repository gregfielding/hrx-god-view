# Worker signup flow review (2026-08-28) — findings + redesign plan

> Greg: "The flow should be intuitive. Currently, it's a mess." Full review
> artifact (flow maps, ranked findings, build plan):
> https://claude.ai/code/artifact/098affb9-98b4-4063-b811-27462760254a
> Status 2026-08-29: QUICK WINS + most of convergence + cleanup SHIPPED
> (commits 8e9da766, 53d39d71): hired→Payroll-hub landing, DOB in dialog
> signup (18+ closed), /earnings SMS links, auto-add dedupe, resume+headshot
> out of the funnel, job applies land IN the AI interview post-submit,
> ~645 dead lines deleted (both email/password branches, orphaned steps,
> hidden nav bar). Findings 5/6/7 SHIPPED
> 2026-08-29 (b831a17a): both application creators stamp groupId/groupIds
> (signals auto-hire door LIVE — prescreen completion can now hire),
> membership reactor's arbitrary-application fallback removed, quick apply
> uses the wizard's shared group resolver, /c1/apply routes joined
> ConditionalWorkerLayout (Apply.tsx gutter compensates when authed).
> Finding 3 SHIPPED 2026-08-29 (6ddfd31e) per Greg's call — NO worker-facing
> pending state; "the system decides" via adjustable interview/AI thresholds:
> validateUserGroupSignup returns hireEveryone/hiringActive; hire_everyone
> groups keep membership auto-hire (no application, Payroll-hub landing);
> every other preset creates an application doc at submit ({uid}_group_{gid},
> status submitted, groupId stamped, group title as jobTitle) → first-touch
> texts the interview → interview submit stamps scores/orchestrator →
> application-signals reactor auto-hires on 'advance'. Below-threshold
> workers just stay group members. Score-gated signups land in the interview
> in-session. ALL REVIEW FINDINGS NOW CLOSED. Watch items: first real
> score-gated group signup end-to-end; recruiter Applications views showing
> applicationKind 'group_signup' rows (jobId null) render acceptably.

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

## 2026-08-29 evening — two-step signup + vocabulary doctrine (56804fd3, deployed)

Greg's calls after the platform comparison (Instawork/Qwick/Traba/Bluecrew):

- **"Hired" is banned for mere enrollment.** Three states, three words:
  ENROLLED (employment row + Everee = payable) → "approved to work with
  C1"; crew/group membership → no promise of work; BOOKED (assignment) →
  the ONLY "you're working" message. Auto-hire landings now say approved +
  explicit "you don't have any shifts yet" (prevents show-up-unbooked).
- **Two-step signup**: brand-new jobs-board visitors get an account-only
  wizard (steps 0-1, "Continue to the job"), return to the posting, and
  apply there via the authed flow (requirement acks) — quick-apply success
  now lands straight in the interview. Wizard `accountOnly` mode frozen at
  mount (authed cert-jumps/error fallbacks keep the full wizard).
- **Interview = "make your application stand out"** (unlock-not-judge
  framing) on all in-session entries.
- **Roadmap parked with Greg's blessing**: tiered-claim marketplace model —
  regulars/crews get early claim windows, new signups earn access via
  reliability + interview scores (compliance-safe use of scores = access
  ordering, not hiring decisions); converges with roster board + the
  parked "always hire" Tier-2 designations. Threshold auto-DECISIONS
  flagged as AEDT/EEOC exposure (NYC LL144 etc.) — recommendation on file:
  demote to recruiter-priority queue once Greg signs off.

# Flutter clone spec 2/4 — Jobs board, Apply wizard, Interview, Applications, Screening

> Generated 2026-08-29 by deep source audit. Route map from src/App.tsx:585-688.
> Hardcoded C1 tenant: `BCiP2bQ9CgVOCTfV6MhD`.

## 0. Route + guard map

| Route | Component | Guard |
|---|---|---|
| /c1/jobs-board | PublicJobsBoard | ConditionalWorkerLayout — guests: no shell; signed-in: WorkerRoute+layout |
| /c1/jobs-board/:postId, /c1/jobs/:postId | JobPostingDetail | same |
| /c1/apply, /c1/apply/group/:groupId | Apply → Wizard | no auth required |
| /apply/:tenantSlug/:jobId? | ApplyWizardPage → Wizard | no auth required |
| /c1/workers/prescreen | WorkerAiPrescreenPage | signed-out renders in-page sign-in prompt |
| /c1/workers/applications(/:applicationId) | UserApplications | layout |
| /c1/workers/screening | screening.tsx | layout |
| /signup(/group/:groupId) | redirect → /c1/apply | — |

## 1. PublicJobsBoard (`src/pages/PublicJobsBoard.tsx`)
- Guest header: C1 logo · EN|ES toggle · "Sign In" pill (opens AuthDialog: Create Account via PhoneSignupGate / Sign In tab) · H3 `nav.findWork` "Find Shifts".
- Filter Paper: search (`jobs.searchPlaceholder` "Search jobs by title, location"); Job Type select (`jobs.allTypes/gig/career`); Sort (`jobs.newestFirst`, `jobs.closestToMe`, `jobs.payRateHighToLow`); mobile = collapsible panel; `jobs.clearFilters` when any filter set; FavoritesFilter star (auth only).
- Empty: Alert info `jobs.noJobsFound` "No jobs found matching your criteria…". Loading: spinner. Error: Alert `err.message || 'Failed to load jobs'`.
- Card (Grid xs12/md6, whole card → detail): title 2-line clamp + FavoriteButton + chevron (`jobs.openJobDetails`); jobTitle row (hidden if = postTitle); pay `success.dark` if showPayRate; location + distance line when geolocation granted (`jobs.distanceMilesAway`/`distanceUnderPointOne`); schedule summary; max-2 chips (gig: [`jobs.newLabel` <7d] + `jobs.gig`; career: applied→`jobs.applicationStatusSubmitted` else new); CTA — career+applied → status pill (pointerEvents none; hired #4CAF50, waitlisted #ED6C02, rejected #F44336, withdrawn #9E9E9E, advanced #111 "Accepted", default #FFC700 "Submitted"); else navigate, label `jobs.expressInterest`/`jobs.viewShifts` (gig)/`jobs.viewJob`.
- **Gig cards never show applied state** (per-shift state lives on the posting page).
- Filters: search across title/desc/worksite/company/skills; visibility public/private/restricted (restricted requires userGroupIds intersection; hidden for guests); DNR (users.dnrAccountIds ∋ accountId|parentAccountId) and separation (separatedEntityIds ∋ hiringEntityId) hide postings. Sort closest = Haversine (geolocation requested only on gesture; denial resets sort to newest).
- `handleApply` decision tree (shared logic — mirror as one Dart service):
  1. !user → `/apply/{tenantId}/{jobId}?returnTo=…` (wizard account-only mode)
  2. gig with no shifts selected → alert 'Please select at least one shift to apply to.'
  3. no existing application data → full wizard
  4. else missing required certs → wizard `?step=7` (**off-by-one bug: step 7 is Education, certs = 8 — FIX in clone**)
  5. else unanswered requirement acks → wizard `?step=12`
  6. else `submitQuickApplication` → success: prescreen redirect unless `hasCompletedPrescreen(uid)`; failure: alert + wizard.
- Data: JobsBoardService.getPublicPosts; gig job_orders (status open) converted when no posting; locations for coords; users/{uid} (applicationIds, userGroupIds, dnr, separated, certifications); applications by user; assignments in [proposed,confirmed,active].
- Dead code (do NOT port): in-page job Dialog (~570 lines, never opened), EligibilityModal on this page.

## 2. JobPostingDetail (`src/pages/JobPostingDetail.tsx`, 4267 lines)
- Query params: `?invite=1` (banner `jobs.invitedBanner`); `?assignmentId=X&intent=assignment_response` (SMS accept/decline mode); `?intent=decline` (auto-decline banners: firing "Declining your assignment…" / success warning "You've declined this assignment…" / error "We couldn't decline this assignment automatically: {err}…").
- Hero: H1 postTitle; **client company hidden on public hero**; pay `jobs.hourlyRateDisplay` "${amount}/hr" if showPayRate; city/state; chips type + date (gig w/ shifts → `jobs.nextShiftLabel` "Next Shift: {date}"; else `jobs.estimatedStartLabel`/`jobs.startsLabel`); copy-link icon → clipboard + snackbar `jobs.linkCopied`. Primary action block suppressed for gig postings (apply is per-shift) unless express-interest or assignment-response mode.
- Main column: About (`jobs.aboutThisJob`, bold-markdown stripped, 280/400-char truncate + `jobs.readMore`/`showLess`, empty `jobs.noDescriptionProvided`); career 2+ open shifts → RadioGroup `jobs.availableShifts` else Weekly Schedule card; Location card (worksite + "Open in Google Maps" → maps search URL + 170px map iframe — **native map in Flutter**; distance opt-in `jobs.showDistanceFromMe`); gig → ShiftSelector; Requirements card only when missingRequired>0 (blue summary `jobs.requirementsToApplySummary` "To apply for this shift, complete these {count} steps:" + action labels `jobs.requirementsActionConfirm*` + hardcoded EN for background/drug/everify/screening lines); inline requirement answering hard-disabled (answers happen in wizard).
- Sidebar (sticky; hidden for gig): "Apply for this Position" card — title `jobs.youveBeenHired`/`jobs.acceptThisPosition`/`jobs.applyForThisPosition`; `jobs.youQualifyForThisJob` or `jobs.completeStepsToApply`; rows Openings/Type/Start/Weekly; CTA; `jobs.postingExpired`/`postingPaused` alerts.
- Mobile sticky apply footer when scrolled past hero (career only).
- WorkerBottomSheet confirm drawer (`jobs.confirmYourShift`): snapshot rows + 3 required acks (on-time; `jobs.offerAckUniformAndRequirements`; `jobs.offerAckNoShowConsequence`); submit `jobs.confirmShift`/`confirmingShift` enabled when all 3; errors: headshot-gate message + " You can upload a new photo from your profile, then come back here and tap Confirm Shift."; else cleaned message + " Please try again — if this keeps happening, contact your recruiter."
- Multi-day dialog: `jobs.multiDayPromptTitle` "This crew works multiple days" / `multiDayPromptBody` "You're applying for {date}. Want to apply for the other days too?" / per-day checkboxes / `multiDayJustThisDay`·`multiDayApplyToOne`·`multiDayApplyToMany`.
- handleApply = same tree as board (incl. the step-7 bug), plus: career multi-open-shift requires selection ('Please select a shift to apply to.'); quick-apply success stays on page (career) with `emitWorkerCardSignal({type:'job_applied'})`, or prescreen redirect if first interview.
- Status matrix (career): hired/waitlisted (+`jobs.applicationStatusWaitlistedHelp`)/rejected (+RejectedHelp)/withdrawn/advanced→Accepted/accepted→green "You've been hired to work this job." + Accept/Decline (`jobs.acceptOfferCta`/`jobs.declineJob`, loading `jobs.accepting`)/confirmed→"View Assignment Details" → `/c1/workers/assignments/{id}`/submitted→Submitted + red "Cancel Application".
- Cancel application: window.confirm 'Are you sure you want to cancel your application?' → status withdrawn (+withdrawnAt/By, delete applyDate(s)); per-day variant copy 'Are you sure you want to cancel your application for this day? You can apply again for this day later.'; last day → withdraw whole app. Reapply flow deletes worker-cancelled assignment docs + revives app (status submitted, reappliedAt).
- Shift apply: `handleApplyToShift` → multi-day prompt → `proceedApplyWithDates` → authed+existing app → `quickApplyToShift` (merge shiftIds/applyDates, never downgrade status); else wizard with `?shiftId&applyDate(s)&returnTo`.
- States: loading 3 skeletons; not-found `jobs.jobPostingNotFound` + back button; dead posting/JO status → replace-navigate to board.
- Data: job_postings/{postId} or job_orders (postId prefix `job-order-`); applications/{uid}_{postId}; assignments by user; users/{uid}. Callable `respondToAssignment`.

### 2b. ShiftSelector (`src/components/ShiftSelector.tsx`)
- One row per shift, or per DAY when dateSchedule && endDate≠shiftDate (rowKey `{shiftId}__{date}`).
- Row: title + day label; date/time (+`(+1 day)` overnight, `• {n} hrs`); open shift → `jobs.ongoing` + `jobs.flexibleHours`; spots chip "{n} spots left" only when posting.showWorkersNeeded; pay chip; `jobs.confirmDetailsHelper` when offered; description only when confirmed.
- State colors: confirmed green #4CAF50/#E8F5E9; offered blue; applied gold #FFC700/#FFF9E6; past faded; full 0.6 opacity.
- CTA precedence: confirmed → "View Details" (→ assignment) · offered → `jobs.clickToConfirm` + `jobs.declineShift` · declined → disabled Not Accepted · applied → disabled `jobs.shiftRequested` + `jobs.cantWork` link · past → disabled "Past" · reapply → `jobs.reapplyToShift` · default → `jobs.applyForShift` / `jobs.shiftFull` when spotsRemaining<=0.
- Past rule: 24h AFTER end time (overnight-aware); open shifts past only when endDate < today.

## 3. Apply wizard

### 3a. Hosts
- **Apply.tsx** (/c1/apply[/group/:groupId]): resolves groupId (param or ?groupId); callable `validateUserGroupSignup({tenantId, groupId})` → {title, hireEveryone} → signupGroupAutoHires (true auto-hire / false score-gated / null → auto-hire fallback). Error: 'Unable to validate this signup link. Please try again.' Header: authed "Finish your profile" / guest "Sign up" (+ "Signing up for: {title}"). `?phone=` prefills phone.
- **ApplyWizardPage.tsx** (/apply/:tenantSlug/:jobId?): slug ≥20 alnum → treated as tenantId; else slug lookup; 15s timeout ('Request timed out. Check your connection or try again.'; 'Tenant not found').

### 3b. Wizard shell (`src/components/apply/Wizard.tsx`)
- **accountOnly mode** = jobId && returnTo && unauthed-at-mount (frozen ref) → steps [0,1] only; last button `apply.continueToJob` "Continue to the job" → handleNext + navigate(returnTo). **No application doc created.**
- Normal candidate order: [0 Personal, 1 Address, 4 WorkEligibility, 6 Skills, 7 Education, 8 Certs, 9 WorkExp, 13 PositionInterests, 12 Requirements]. Steps 2 résumé / 3 everify-comfort / 5 headshot / 10 bio / 11 preferences NEVER in funnel.
- Auto-skips: 0 when authed + name/phone/dob on file; 1 when address+coords (+email if jobId) on file; 4 disabled by default flag OR C1 Events entity OR answered; 6/7/8/9 when posting doesn't require or profile/resume covers; 13 when jobId or interests exist; 12 when all posting questions answered + transportMethod set (never evicted while current).
- Persistence: localStorage `app-wizard-session-id/step/data:{tenant}-{job}`; `?step=N` override; unauthed force-reset to 0.
- No stepper UI — LinearProgress while saving only.
- Primary label: continueToJob / `apply.submitApplication` / `apply.skipForNow` (2,5,8-missing-certs) / `apply.next`. Disabled: last+step12 with missing answers; step0 invalid or unauthed; step1 invalid address (or bad email when jobId); step4 not authorized; saving.
- DNR gate: full-page "This position is no longer available" / "Please browse our jobs board for other open positions." (hardcoded EN).

### 3c. Steps (visible funnel)
1. **Step 0 Personal**: firstName*, lastName*, phone* (digits, display (XXX)XXX-XXXX, `apply.phoneTenDigits` "Enter a valid 10-digit U.S. phone number (area code + number)."), dob* (MM/DD/YYYY mask → YYYY-MM-DD; age 18–100). Unauthed: **PhoneSignupGate** below — `phoneSignup.title` "Verify your phone to create your account"; send `phoneSignup.sendCode` "Text me a code" (ready = name+phone+18+ dob; else caption `phoneSignup.mustBe18`/`fillNamePhone`); code field 6-digit one-time-code with WebOTP auto-verify; `checkOtp({signup:true, firstName, lastName, dob, preferredLanguage, signupSource, signupGroupId, jobContext})`; `choose` result → household picker radio `{firstName L., email}` + `phoneSignup.continue`; success alerts `phoneSignup.welcomeBack`/`accountReady`. On step exit: profile write + auto group add; phone changed or unverified → EligibilityModal pauses advance.
2. **Step 1 Address/Email**: email (required when jobId; helper `apply.emailNeededForJob`/`phoneSignup.emailOptional`); AddressStep: street* Google Places (US), unit, city/state/zip read-only after pick; free typing → "Please select your address from the dropdown"; manual fallback link "Can't find your address in the dropdown? Enter it manually" → editable fields + "Verify address" via callable `placesGeocodeAddress` (3 attempts backoff; errors "Please fill in street, city, state, and ZIP code." / "We couldn't verify that address. Double-check the street number, city, state, and ZIP — then tap Verify again." / "We couldn't verify that address right now. Please try again in a moment."); success "✓ Address verified". Valid = street+city+state+zip + numeric coords. (**AddressStep is hardcoded EN — add i18n in clone.**)
3. **Step 4 Work eligibility** (usually auto-skipped): workAuthorized* checkbox `profile.authorizedToWork` (next disabled unless true; caption `profile.confirmAuthorized`), requireSponsorship checkbox. EEO removed.
4. **Steps 6/7/8/9** Skills / Education / Certifications / WorkExperience — conditional on posting requirements; captions `apply.profileImprovementOptional`; submit guard `apply.addAtLeastOneSkill`.
5. **Step 13 Position interests** (generic signup only): chips janitorial, food_service, events, warehouse, hospitality, general_labor, customer_service, skilled_trades (`apply.positionInterest_{key}`); persists per toggle to workerProfile.preferences.positionInterests.
6. **Step 12 Requirements** (always last): see 3d.

### 3d. Step 12 — requirement acks (`RequirementsAcknowledgementStep.tsx`)
- Blocks render when posting enables + answer unknown. Widget = Yes/No/Maybe chips (`apply.yes/no/maybe`; stored EN tokens; tap-again clears). Answers debounce-write to profile.
- Order: E-Verify (`apply.eVerify` + /img/everify.png) → Drug (`apply.drugScreening`; Maybe → required `apply.explainDrugTest` multiline) → Screening-package services (per service `apply.comfortableWithScreening` "{name}") → Additional screenings → Background (`apply.backgroundScreening`; Maybe → `apply.explainBackgroundScreening`) → Languages (`apply.comfortableSpeaking` "{list}") → Physical → Uniform → Custom uniform → Required PPE → **Transport** (always unless known): `apply.howWillYouGetToWork` + 5 icon chips Car/Public Transit/Bike/Walk/Other → transportMethod.
- Hidden file input for cert uploads → Storage `users/{uid}/certifications/{slug}/{ts}-{name}`.

### 3e. Submission (handleSubmit)
- Guard order (alert + jump): no uid → `apply.completePersonalInfo`; address invalid → `apply.homeAddressRequired`; unmatched skills → `apply.addAtLeastOneSkill`; missing answers → `apply.completeRequiredItems`; bad phone → `apply.phoneTenDigits`; ungeocoded → `apply.completeAddressBeforeSubmit`; gig date conflict → `apply.shiftConflict` "You already have an active application for a shift on {date}…". Catch-all `apply.couldNotSubmitApplication` + details.
- Writes: applicationDrafts submit; users/{uid} full profile patch (incl. tenantIds role Applicant/level '2'); applications/{uid}_{jobId} (status submitted, hiringLifecycle, groupId/groupIds via resolveApplyWizardAutoGroupIds, data, applicant, jobScoreSummary, shift/apply dates); users.applicationIds arrayUnion + applicationData map; smart-group updates; score-gated group signup → applications/{uid}_group_{groupId} (applicationKind group_signup, jobTitle = group title); clears reminder fields + localStorage. Analytics logApply*.
- On mount: draft + in_progress application mirror.

### 3f. Terminal landings (PostSubmitRedirect, delay 1500ms; buttons `apply.viewMyApplications` + `apply.browseMoreJobs`)
| Case | Destination | Copy |
|---|---|---|
| returnTo+jobId+authed, first interview | /prescreen?applicationId={uid}_{jobId}&entry=apply_wizard_inline | `apply.applicationSubmittedMessage` + `nextInterviewSubhead`/`Helper` |
| returnTo, repeat/no-job | returnTo | + `settingUpPayroll(Helper)` |
| score-gated group, first interview | /prescreen?applicationId={uid}_group_{gid}&entry=apply_group_inline | interview copy |
| score-gated group, repeat | /c1/workers/dashboard | interview copy |
| auto-hire group | /c1/workers/earnings | `apply.approvedTitle` "You're approved to work with C1 🎉" + `takingYouToPayroll` |
| general signup | /c1/workers/dashboard | `apply.hiredTitle` "You're all set! 🎉" + `takingYouHome` |
- Repeat-interviewee test: `hasWorkerAiPrescreenInterview===true || interviewStatus==='completed'`.

## 4. Interview (AI prescreen) — `/c1/workers/prescreen?applicationId&entry`
Files: WorkerAiPrescreenPage.tsx, workerAiPrescreenV2Flow.ts, workerAiPrescreenQuestions.ts.
- Signed-out: `workerAiPrescreen.signInPrompt` + `common.signIn` (→/login state.from) + `backToDashboard`.
- Layout: framing header (title `workerAiPrescreen.title` "Quick interview" / `titleOptional`; subtitle variants; job title + location; duration hints) → answer-bank delta banner `bank.deltaBanner` "We kept your answers from your last interview — just {count} quick questions for this job." → entry banner (`entryBanner.*`) → LinearProgress + "{current} of {total}" + phase label (`progressPhase.*`) → early-encouragement caption (first third) → alerts → question body (section overline; transition lines `v2.*`; micro-confirm chips; worksite card with Maps link for dyn_worksite_commute; prompt pre-line; input) → StrengthenPanel (optional `strengthen.*`) → Back/Next|Submit footer.
- Widgets: text = multiline minRows3 placeholder `placeholderShortAnswer` "A sentence or two is fine"; single = radio; multi = checkboxes + chip echo; dynamic = radio yes/no/not_sure (`dynamicOpts.*`).
- **Validation constant: 9 substantive words** (`PRESCREEN_MIN_SUBSTANTIVE_WORDS`, shared/prescreenAnswerQuality.ts). Fast-path: 3–8 words accepted on experience/pressure/supervisor but adds an optional follow-up step (`v2.followup*Prompt`); motivation asked only in expanded mode (experience <8 words, sticky per session).

### 4a. Full step order (26 nav entries — see table in agent-audit; key facts)
- Opening prefs (target work types, schedules, per-target experience multi-selects, gig types) → work_confidence → reliability (attendance_issues + conditional explanation ≥9w or N/A; transportation_plan "How will you usually get to work?"; backup_transportation; physical_comfort with-or-without-accommodation) → 2 early dynamics → experience_details (bullet prompt) [+optional follow-up] → [motivation, pressure_situation + follow-up in expanded mode] → late dynamics → drug_screen (+detail ≥9w "Thanks for being upfront — context helps us place you well…") → background_check (+detail; + optional offense_class/offense_when "last 7–10 years matter most") → supervisor_feedback [+follow-up] → additional_notes (optional).
- Core drug/background omitted when plan carries dyn_job_drug_screen/dyn_job_background_check.
- Dynamics: first 2 early, rest late. Known: dyn_shift_punctuality, dyn_worksite_commute (worksite card + Maps), dyn_job_drug/background, dyn_physical_job_fit, dyn_cert__*, dyn_uniform_available, dyn_gig_path_willing. Client dedupe skips with synthetic 'yes' (physical=yes → skip physical_job_fit; reliable transport + no attendance issues → skip punctuality/commute).
- confirm_legal_first_name asked first only when the profile firstName looks numeric.

### 4b. Answer bank / repeat skip
- Callers skip page entirely when hasCompletedPrescreen(uid).
- plan.bankCoverage: covered steps filtered from nav; bank answers seeded; `askedStepIds` sent on submit. Zero-delta → confirm card `bank.allSetTitle` "You're all set" + `bank.allSetConfirmCta` "Use my saved answers" → submit.
- Adaptive entry: prefs hydrated from workerProfile.preferences → jump to first invalid step.

### 4c. Gates / states / errors
- Address gate (no address on file): `addressGate.title` "One quick thing first" + AddressStep + `addressGate.save` "Save address & start interview".
- Errors via friendlyPrescreenCallableError: `errors.planPermission/submitPermission/planInternal/submitInternal/planTransient/submitTransient/serverDetail/planGeneric/submitGeneric`. Plan errors = warning (non-blocking); submit = error, stays on last step.
- Done: green paper, `successTitle` "Interview submitted", body variants, `referenceLabel` "Reference: {id}", → dashboard (or jobs board when no applicationId).
- Submit payload: answers (follow-ups merged into parents; conditional clears), applicationId, tenantId, entry, dynamicAnswers, sessionProfileEnhancements, askedStepIds.
- Callables: getWorkerAiPrescreenInterviewPlan, submitWorkerAiPrescreenInterview. Reads: users/{uid} snapshot, applications/{applicationId} (ownership check), job_orders/{id}.
- **Missing i18n keys (fix in web + don't inherit): `workerAiPrescreen.loadingProfileQuestions`, `workerAiPrescreen.alertChooseTenantProfileFirst`.**

## 5. Screening — /c1/workers/screening (read-only)
- Header `workerAccount.screeningPageTitle` "Pre-employment checks" back→dashboard; pointer alert "Payroll setup and I-9 documents are in Employment." when employments exist.
- Cards: Identity verification (static copy); Background orders (rows + status chip map: completed/report_ready/drug_report_ready/in_progress/awaiting_applicant "Awaiting you"/submitted/queued/draft/canceled/error; awaiting → "Check your email for instructions from the screening provider."); Drug screen/clinic (two static variants); E-Verify cases (up to 8, `Case {id8}…`); Assigned screening tasks (compliance items background_check|drug_screen|tb_test).
- States: no uid → `screeningSignInPrompt`; no tenant → `screeningSelectWorkspace`; loading spinner; error dismissible.
- Reads: everify_cases, backgroundChecks (candidateId), user_employments, workerComplianceItems. No writes. Card bodies hardcoded EN — add keys in clone.

## 6. My Applications — /c1/workers/applications(/:id)
- Optional warning "This item is unavailable. You can review your other applications below." when :id not in list. Header `applications.title` "My Applications" back→dashboard.
- Card (whole card → /c1/jobs-board/{jobId}): jobTitle · company · shift date (MMM d, h:mm a) · location · pay · `applications.dateApplied` "Date Applied: {…}" · status chip. Actions: `applications.viewJob` "View Job →"; withdrawable (Applied/Under Review) → red `applications.withdrawApplication` → window.confirm 'Are you sure you want to withdraw your application?' → status withdrawn; failure alert.
- Status precedence: confirmed/active assignment → Hired; withdrawn; rejected/declined → Declined; expired/cancelled → Expired; submitted+proposed → Under Review; submitted → Applied; reviewed/pending → Under Review; accepted/confirmed/hired → Hired. Chip: Hired success bold; Applied/UnderReview gold #FFC700 black text; rejected error.
- Empty: `applications.emptyMessage` "You haven't applied to any jobs yet." + `applications.browseJobs`.
- Data: users.applicationIds `{tid}_{jobId}` → applications/{uid}_{jobId} + enrichment (shifts, job_orders, job_postings, users.applicationData) + assignments proposed/confirmed. **N+1 users read inside loop — batch in Flutter.**

## 7. Bugs/gaps to NOT inherit (fix in clone; consider fixing web too)
1. `?step=7` cert redirect off-by-one (should be 8) — both board + detail.
2. Missing i18n keys: workerAiPrescreen.loadingProfileQuestions, alertChooseTenantProfileFirst.
3. Hardcoded EN: AddressStep entirely; DNR screen; screening card bodies; posting-detail confirm/cancel/apply-again strings + requirement labels; ShiftSelector View Details/Confirmed/Past.
4. Dead code: jobs-board dialog; posting assignment-info cards (flag false); wizard steps 2/3/5/10/11.
5. No stepper UI in wizard (labels exist unused) — decide: add one in Flutter.
6. alert()/window.confirm() everywhere → replace with dialogs/snackbars (strings above).
7. getUnansweredRequirementAcks fails open (throw → []).

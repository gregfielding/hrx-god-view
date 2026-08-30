# Flutter clone spec 1/4 — Shell, Auth, Home, Notifications

> Generated 2026-08-29 by deep source audit for the Flutter worker-app clone.
> Copy source of truth: `public/i18n/locales/en.json` (es.json mirrors).
> See README.md in this directory for the index + build phases.

## 0. Global constants / tokens

- `C1_TENANT_ID = 'BCiP2bQ9CgVOCTfV6MhD'` (hardcoded fallback in dashboard.tsx:37). Typo variant `BCiP2bQ9CgV0CTfV6MhD` (zero vs O) normalized in AuthContext (`src/utils/c1TenantIdNormalize.ts`).
- Worker theme (`src/theme/workerTheme.tsx`): primary `#111111` (dark `#000000`, light `#3A3A3A`, onPrimary `#FFFFFF`); secondary/C1 gold `#FFC700` (dark `#E6B300`, light `#FFD84D`, onSecondary `#111111`); text.primary `#16181A`, text.secondary `#6B6B6B`; background `#FAFAF8`, surface `#FFFFFF`; hairline `#e6e6e3`. System font stack. h5/h6 weight 650, letterSpacing -0.01em. Button weight 600 size 15, no uppercase. AppBar/Drawer radius 0. Easing `cubic-bezier(0.2,0.8,0.2,1)`; press 150ms, page 140ms, sheet 180ms, hover 120ms.
- Auth screens deliberately do NOT use the theme — `src/pages/authMinimalStyles.ts` (white bg, `#111` ink, underline inputs `borderBottom: 1.5px solid #111`, full-width black pill button radius 6, error `#b00020`, success `#1b5e20`, `100dvh`).
- i18n: `t(key, params)` with `{placeholder}` substitution; fallback current-lang → en → the raw key string. `useT()` subscribes to language changes; bare `t` import does NOT re-render. **Bug to fix in Flutter (don't inherit):** WorkerBottomTabs, WorkerAppBar, PaymentIssueHomeBanner, WorkerDashboardEarningsStrip, WorkerNotificationListItem use bare `t` — labels don't update on language change until re-render.

## 1. Shell

### 1.1 ConditionalWorkerLayout (`src/components/ConditionalWorkerLayout.tsx`)
- Wraps every `/c1/*` route (App.tsx:613). Mount → `preloadLocales()` (fetches en+es).
- `!user` → worker theme + toast provider + bare Outlet. **No app bar, no bottom tabs for guests** (jobs-board/apply render standalone with their own sign-in CTA). Deliberate — do not show tabs to guests.
- `user` → WorkerRoute → C1WorkerLayout.

### 1.2 WorkerRoute guard (`src/auth/WorkerRoute.tsx`)
- `loading` → centered spinner + literal "Loading..." (hardcoded EN).
- `!user` → Navigate `/login` with `state.from`.
- `securityLevel >= 5` (staff) → Navigate `/dashboard` unless `isStaffAllowedPublicJobBoardPath(pathname)` (jobs-board paths).

### 1.3 C1WorkerLayout (`src/layouts/C1WorkerLayout.tsx`)
- Side effects: `usePushNotifications(uid)` (registers FCM token; foreground handler is a console.log stub — **build a real in-app toast in Flutter**), `setLanguage(useWorkerPreferredLanguage())`.
- Tree: WorkerAppBar (sticky) → Container main (`py:3, px:{2,3}, pb: calc(80px + safe-area)`, maxWidth sm:720) with WorkerPageTransition (140ms fade+8px rise on pathname change) → WorkerBottomTabs (fixed).

### 1.4 WorkerAppBar (`src/components/worker/WorkerAppBar.tsx`)
- White, 1px bottom hairline, dense toolbar (48/52px).
- Left: `/C1.png` logo h26 → `/{tenantSlug}/workers/dashboard` (slug default 'c1').
- Right: bell IconButton aria `nav.notifications` "Notifications" → notifications page; Badge color=secondary (gold, ink count) max 9 ("9+"); filled icon when unread>0 else outline. Unread source: live onSnapshot `users/{uid}/notifications` orderBy createdAt desc limit 50.
- NO avatar menu / language toggle / logout / drawer (removed 2026-08-23; those live on Profile).
- **First-login language dialog** (only dialog): opens when `users/{uid}.preferredLanguage` not exactly 'en'|'es'. NOT dismissible. Title `nav.selectYourLanguage` "Select Your Language"; subtitle `nav.selectYourLanguageSubtitle` "Seleccione su idioma"; two large buttons `nav.english` "English" / `nav.espanol` "Español" (contained if selected else outlined). Pick → setLanguage + setGuestLanguage + `updateDoc(users/{uid}, {preferredLanguage, updatedAt})` (failure swallowed).

### 1.5 WorkerBottomTabs (`src/components/worker/WorkerBottomTabs.tsx`) — THE navigation
- Fixed bottom, white, 1px top hairline, `paddingBottom: env(safe-area-inset-bottom)`, zIndex 1200. Icon 24, label 11px, active `#111` weight 650 / inactive `#8a8a86` weight 500. Active match: pathname equals or startsWith match+'/'.

| # | key | EN | Icon | Destination | Also matches |
|---|---|---|---|---|---|
| 1 | nav.home | Home | HomeOutlined | /c1/workers/dashboard | — |
| 2 | nav.findWork | Find Shifts | WorkOutline | /c1/jobs-board | — |
| 3 | nav.myAssignments | Schedule | CalendarMonthOutlined | /c1/workers/assignments | /c1/workers/applications |
| 4 | nav.payroll | Payroll | PaymentsOutlined | /c1/workers/earnings | /c1/workers/payroll |
| 5 | nav.myAccount | Profile | PersonOutline | /c1/workers/profile | — |

- No tab badges; the only badge is the app-bar bell.

### 1.6 Logout (on Profile, not shell)
- Profile row `nav.logOut` "Log Out" / `profile.logOutSecureSecondary` "Sign out of this device securely." → `logout()`: log activity → signOut → reset state → **hard redirect to `/c1/jobs-board`** (not /login). Port that destination.

## 2. Auth + entry

### 2.1 Worker vs staff (`src/contexts/AuthContext.tsx`)
- `securityLevel` string '0'..'7'. **Worker = 0–4, staff = 5+.** Context defaults `'5'` + `loading:true` — never route before loading false.
- Resolution order (keyed on activeTenantId = userData.activeTenantId || primaryTenantId): (1) JWT claims `roles[tenantId]`; (2) `users/{uid}.tenantIds[tenantId].{role,securityLevel}`; (3) top-level `users/{uid}.role/.securityLevel`; (4) fallback Tenant/'5'.
- Auto-provisioning: signed in on `/c1/` with no user doc → creates `role:'Tenant'`, `securityLevel:'2'` (Applicant), activeTenantId C1, `tenantIds[C1]={role:'Applicant', securityLevel:'2'}`, `source:'public_jobs_board'`, onboarded:false, phoneVerified:false, default notificationSettings (all true, quietHours disabled 22:00–08:00) + privacySettings.
- Session-start callables: `updateUserLoginInfo` (once/session, initializeIfMissing), `updateUserActivity` heartbeat (5-min throttle).

### 2.2 /login — LoginGate (`src/pages/LoginGate.tsx`)
- `getLastLoginMethod()==='email'` → Navigate `/login/email` (state preserved); else renders PhoneLoginPage inline. localStorage key `c1LastLoginMethod` ('phone'|'email'), written only on successful sign-in.
- Routes: `/login/email` → Login; `/login/phone` → PhoneLoginPage direct.

### 2.3 PhoneLoginPage (`src/pages/PhoneLoginPage.tsx`) — Twilio Verify OTP, no password, no reCAPTCHA
- **Copy is an inline COPY map (lines 28–99), NOT in en.json** — reproduce verbatim from source.
- Chrome: top-right `EN | ES` toggle (active #111, inactive #999, separator #ccc); main maxWidth 360 centered; h1 t.title "Sign in"/"Iniciar sesión"; footer C1 logo 56px + link t.emailLogin "Sign in with email instead" → /login/email.
- **Step phone**: field tel, autoComplete tel-national, placeholder `(555) 555-5555`, fontSize 22. Sanitize: digits only, strip leading 1 of 11, slice 10. Display format `(XXX) YYY-ZZZZ` progressive. Label t.phoneLabel "Mobile number". Hint "We'll text you a code. No password needed." Submit "Continue"/"Sending…", disabled unless 10 digits. → callable `sendOtp({phoneE164:'+1'+digits})` → step code. Guard error t.badPhone "Enter a 10-digit US mobile number."
- **Step code**: field numeric, autoComplete one-time-code, maxLength 6, placeholder `······`, letterSpacing .35em. Label "Enter the 6-digit code"; hint "Sent to (555) 555-5555". Submit "Sign in"/"Checking…", disabled unless 6 digits. Secondary: "Send a new code" (resend) · "Use a different number" (reset). WebOTP autofill auto-submits on 6-digit match; SMS ends `@hrxone.com #123456` — **Flutter: SMS Retriever (Android) / textContentType oneTimeCode (iOS)**.
- checkOtp resolution: `signed_in`+token → setLastLoginMethod('phone') → signInWithCustomToken; `choose` → step choose (selectionToken + candidates {uid, firstName, lastInitial, email?}); else → step no_account (+recoveryToken).
- **Step choose**: "More than one person uses this number." / h2 "Who are you?"; one bordered button per candidate (name line + optional email line) → checkOtp({selectionToken, pick: uid}); link "Start over".
- **Step no_account**: "We don't have an account with this number." / "New to C1? Create your account in a minute." Primary "Create account" → `/c1/apply?phone={digits}`. If recoveryToken: link "My number changed — I already have an account" → step recover. Link "Start over".
- **Step recover**: h2 "Find your account"; hint "Tell us who you are and our team will move your account to this number." Fields: first name (given-name), last name (family-name), DOB (type=date, bday). Submit "Submit", disabled unless all filled. → checkOtp({phoneChange:true, recoveryToken, firstName, lastName, dob}). `pending_approval` → step recover_pending; `not_found` → "We couldn't find a matching account. Check the spelling and date of birth, or contact your recruiter."
- **Step recover_pending** (terminal): "Got it — we're on it." / "Our team will verify your request and move your account to this number, usually within 1 business day. We'll text you here when it's done."
- **Error mapping** (every callable failure): invalid-argument+/phone/i → badPhone; permission-denied or invalid-argument+/code/i → t.badCode "That code didn't match. Try again."; deadline-exceeded → t.expired "That code expired. Send a new one."; resource-exhausted → t.tooMany "Too many attempts. Wait a few minutes and try again."; else t.generic "Something went wrong. Try again." **rawError (`code — message`) is ALSO rendered in 12px mono — decide whether to port this debug line (recommend: no).**
- **Post-sign-in redirect**: getDoc users/{uid} (missing doc → no redirect); sync preferredLanguage if different; level = securityLevel ?? tenantIds[C1].securityLevel; deepLink = state.from only if pathname startsWith '/c1/'; navigate(level>=5 ? '/' : deepLink || '/c1/workers/dashboard').

### 2.4 /login/email — Login (`src/pages/Login.tsx`)
- Inline copy map. h1 "Platform Login". Fields email (trimmed on submit — iOS autofill trailing space) + password. Submit "Login"/'…', no field validation; error = raw Firebase err.message verbatim.
- Success message/email prefill from location.state (SetupPassword flows), consumed once.
- Footer: "Forgot password?" and "First time here? / Set up your account" → both run handleForgotPassword: no @ → inline hint "Type your email here and we'll send you a link." + focus; else callable `sendPasswordResetV2({email lowercased, continueUrl:'/c1/workers/payroll'})` → "We've sent you a password reset link. Check your email." / error "Couldn't send reset link. Double-check the email and try again."
- Redirect effect: waits for auth resolved; level 0–4 → deepLink || dashboard; else '/'.
- Quiet link "Sign in with your phone instead" → /login/phone.

### 2.5 /setup-password — SetupPassword (`src/pages/SetupPassword.tsx`)
- MUI Paper card, **hardcoded English only, no ES**. Query: oobCode + continueUrl (sanitized: default /dashboard, reject >256 chars, non-`/` start, `//` start).
- Mount: user already → navigate continueUrl/'/'; verifyPasswordResetCode(oobCode) → email, failure → linkInvalid.
- Form: h5 "Set Your Password"; "Setting up account for: {email}"; New Password (helper "Password must be at least 6 characters long") + Confirm Password (mismatch live error "Passwords don't match"); Button "Set Password" disabled until code verified. Errors: "No invitation code found" / "Password must be at least 6 characters long" / "Passwords do not match" / weak-password → "Password is too weak. Please choose a stronger password." / invalid|expired action code → switches to recovery panel.
- Success path: confirmPasswordReset → try signInWithEmailAndPassword → navigate(continueUrl); else success screen "Password changed" → "CONTINUE".
- Recovery panel (linkInvalid): "This link has expired" / "Setup links work for a limited time and only once. Enter your email and we'll send you a fresh one." Email field (helper "Use the email your employer has on file.") → "Send me a new link" → sendPasswordResetV2. Validation "Please enter the email address you used to sign up."; failure "Could not send a new link right now. Please try again in a moment."
- Sent state: "Check your email" + "We sent a fresh setup link to {email}…" + spam note; "Try a different email" / "Sign in instead".
- **Flutter: needs App/Universal Link handler for `/setup-password?oobCode=…`.**

## 3. Home — /c1/workers/dashboard (`src/pages/c1/workers/dashboard.tsx`)
- Container maxWidth 720; Stack spacing 3/3.5. tenantId = activeTenant?.id ?? C1_TENANT_ID. locale es|en-US.
- **Order**: (1) WorkerDashboardHero (always) → (2) PaymentIssueHomeBanner (null unless open issue) → (3) WorkerDashboardEarningsStrip (null unless pay history) → (4) WorkerDashboardActionItems → (5) Upcoming Assignments (only when loaded && non-empty; spinner while loading).
- **No readiness summary section on Home** — `#home-readiness-summary` anchor (job-readiness redirect target) does not exist; treat redirect as plain dashboard.

### 3.1 WorkerDashboardHero
- Card outlined. h5 `dashboard.welcomeBack` "Welcome back, {firstName}" (fallback literal "there" even in ES — fix in Flutter).
- Has next shift: subtitle2 `dashboard.nextShift` "Next shift"; primary "{jobTitle} — {site}"; secondary "{day}, {date} at {time}" (**"at" hardcoded EN — localize in Flutter**); tertiary addressShort/city. Buttons: contained `dashboard.viewDetails` "View details" → assignment detail; text `jobs.findMoreWork` "Find Your Next Opportunity" → jobs board.
- No shift: `empty.noShiftsScheduled` "No shifts scheduled." / `empty.checkJobsBoard` "Browse Find Work for available shifts."; contained `nav.findWork` → jobs board; text `dashboard.completeProfile` "Complete profile" → profile.
- nextShift prop = upcomingAssignments[0] only after load (shows State B during load — consider a skeleton in Flutter).

### 3.2 PaymentIssueHomeBanner
- Query `tenants/{t}/payroll_payment_issues where uid==uid && status=='open' limit 1` (errors swallowed → hidden).
- missing_tin → `earnings.issueSetupTitle` "Finish payroll setup to get paid" / body / CTA `earnings.issueFinishSetupCta` "Finish setup" → `/c1/workers/earnings/{evereeTenantId}`.
- other → `earnings.issueDepositTitle` "A payment couldn't be deposited" / "Your bank returned a recent payment. Double-check your routing and account number — once they're fixed, the deposit is retried automatically." / CTA "Fix direct deposit" → payroll-settings.

### 3.3 WorkerDashboardEarningsStrip
- Data: useWorkerEmployerLinkages (skips smokeData + sandbox tenant '2320') + useWorkerPayHistory(…, 1) via callable `evereeGetPayHistory` per linkage, merged, payDate string-desc.
- Renders null while loading AND with no history (no skeleton).
- Card/CardActionArea → /c1/workers/earnings. Left: caption `dashboard.lastPayLabel` "Last pay" + h6 USD(net ?? gross) tabular-nums. Right: payday text — `nextPayday()` = next Friday inclusive of today; today → `earnings.paydayTodayLabel` "Payday is today — deposits usually arrive by end of day."; else `earnings.nextPaydayLabel` "Next payday: {weekday, month day}" (es-US/en-US).

### 3.4 WorkerDashboardActionItems
- Data: onSnapshot users/{uid} → `workerDashboardActionItemsV1.items`; absent after load → one-shot callable `syncWorkerDashboardActionItemsV1({uid, tenantId})`. Client: filter sms_opt_in while localStorage `worker_sms_warning_dismiss_until_{uid}` in future; cap 3. Server sorts priorityScore desc.
- **Work-only feed**: server drops PROFILE_NAG_IDS (confirm_date_of_birth, verify_phone_number, confirm_home_address, add_profile_photo, add_emergency_contact, re_enable_sms_notifications, sms_opt_in). Those render paths exist but are unreachable on Home.
- Heading h5 `dashboard.actionItems.sectionTitle` "Action Items".
- Empty card: h6 `caughtUpTitle` "You're all caught up" / `caughtUpBody` "Nothing needs your attention right now."; contained `nav.findWork` → jobs board; outlined `viewProfile` "View Profile" → profile.
- **Two item shapes**: (a) SMS Alert (sms ids only; warning Alert, title+body+contained warning action, optional "Not now"); (b) generic compact tile — bordered by category (blocking=error edge, important=warning, recommended=grey bg, snoozable plain), single-line truncated title + 1-line clamped caption + tier Chip (Blocking error-filled / Important warning-filled / Recommended info-outlined / Optional default), right side = optional text secondary + **40×40 ArrowForward IconButton (label is aria-only — consider visible label in Flutter)**.
- Primary kinds: navigate(href) | enable_sms (updateDoc smsNotifications/smsOptIn/smsBlockedSystem) | assignment_accept → callable `respondToAssignment({tenantId, assignmentId, decision:'accept'})` | tempworks_open (stamp onboarding.tempworksStartedAt then window.open) | external_open (window.open).
- Secondary kinds: snooze_sms (localStorage 24h) | dismiss_firestore (`workerProfile.dashboard.dismissedActionItems[id]=true`) | assignment_decline (callable) — **decline button not rendered on generic tile today (gap: confirm card shows only Confirm on Home)**.
- Headshot gate errors (respondToAssignment failed-precondition): codes HEADSHOT_MISSING/PENDING/REJECTED/ERROR → `avatarVerification.gateMissing` "Add a profile photo before confirming this shift…" etc + `avatarVerification.retakeButton` "Retake photo". **⚠ assignmentError state is set but NEVER rendered — accept/decline failures are silent. MUST surface in Flutter (snackbar).**
- Full catalog (id / score / tier / title / primary): assignment_confirmation_required 920 blocking "Confirm your shift" Confirm+Decline; everify_action_required 900 blocking "E-Verify needs your action" → profile; drug_screen_reschedule_required 880; background_check_issue_requires_action 860; complete_tempworks_onboarding 800 (two variants: Start onboarding / Re-open onboarding, tempworks_open); complete_payroll_setup 760 → /earnings/{tid}; background_check_action_required 720; drug_screen_schedule_required 700; worker_ai_prescreen_interview 550 "Complete my interview" → `/c1/workers/prescreen?applicationId={id}&entry=dashboard_cta` (30-day fresh-interview suppression); worker_ai_prescreen_complete_profile 545; [profile nags filtered from Home: DOB 650, phone 640, address 600, re_enable_sms 590, photo 400, emergency 390, sms_opt_in 100]; add_tax_identity_last4 retired.

### 3.5 Upcoming Assignments
- section aria `dashboard.upcomingAssignments.title` "Upcoming Assignments"; h5 heading; bordered List, divider rows.
- Row → assignment detail; primary jobTitle (fallback literal 'Assignment'); secondary "{day}, {date} · {time} · {siteName}"; trailing 40px black circle + white ArrowForward (decorative).
- Data: `tenants/{t}/assignments where userId==uid` — **no orderBy/limit; all fetched, filtered client-side**: exclude cancelled/canceled/declined/completed + startAt < today; sort startAt asc. startAt = `{startDate}T{startTime||'00:00'}` local. siteName = locationNickname||worksiteName with looksLikeDocId suppression (15–30 chars alnum). Error → console only (**add error state in Flutter**).

## 4. /c1/workers (index) — Navigate to dashboard. Same for /c1 index.

## 5. Notifications — /c1/workers/notifications (`src/pages/c1/workers/notifications.tsx`)
- Header: WorkerPageHeader back → dashboard (explicit), title `nav.notifications`.
- Filter chips (small; selected primary-filled): All / Unread ("Unread (3)" with count) / Applications / Assignments / Reminders / Documents-Compliance (`notifications.filterDocuments` "Documents / Compliance") / System. Trailing "Mark all read" button when unread>0 (sequential callables, no progress state).
- Bucketing precedence: reminders (category assignments + text contains reminder|starts in|tomorrow) → documents (type document OR category profile OR text compliance|certification) → applications → assignments → system. `opportunities` category lands in system (no chip).
- States: loading spinner; empty `notifications.emptyTitle` "No notifications yet." + `emptySubtitle` "We'll notify you about applications, documents, and shifts here." (same for filtered-empty); **no error state (snapshot errors swallowed → looks empty)**.
- Item (WorkerNotificationListItem): leading icon by type (assignment/shift→Assignment, application/payroll→Work, document→Info, opportunity→Campaign, profile_action→Person, else Notifications); 8px unread dot; subtitle2 title (weight 600 unread / 400 read); caption relative time ("Just now" / "{n}m ago" / HH:MM / date); body **single-line ellipsis**; trailing "Mark read" icon button when unread. No swipe/delete.
- **Auto-mark-all-read on open** (once per mount after load) — clears bell badge on visit.
- Row tap: mark read → resolve url = deepLink || getNotificationUrlAsync (priority: deepLink → assignmentId→/assignments/{id} → jobId→/jobs-board/{id} → applicationId→/applications/{id} → threadId→/support → legacy application lookup → /notifications). Starts with '/' → in-app navigate; else **window.location.href (external, unvalidated — Flutter: url_launcher + scheme check)**.
- Data: `users/{uid}/notifications` onSnapshot orderBy createdAt desc limit 100 (bar uses 50). Callable `markWorkerNotificationRead({uid, notificationId})`. ctaLabel/severity read but never rendered.

## 6. Cross-cutting Flutter notes
- Deep links IN: `/setup-password?oobCode=…`; SMS links `/c1/workers/payroll(→earnings)`, `/c1/workers/assignments/{id}`, `/c1/workers/earnings`; notification deepLinks are app-relative `/c1/` paths.
- External OUT: tempworks_open + external_open (third-party auth'd portals — use external browser, not webview); notification external URLs.
- Redirect chain: /c1→dashboard; /c1/workers→dashboard; find-work→jobs-board; settings→profile/app-language; job-readiness→dashboard (dead anchor); /jobs-board→/c1/jobs-board; /applications, /assignments → c1 equivalents.
- Local state to port: c1LastLoginMethod; worker_sms_warning_dismiss_until_{uid} (24h); guest language + changed-this-session flag (local wins over Firestore once).
- Push: token at `users/{uid}/pushTokens/{token}` {token, platform, deviceId, enabled:true, createdAt, updatedAt}; foreground toast NOT built (build it).
- Safe areas: tabs pad env(safe-area-inset-bottom); content pads calc(80px + inset). Content max width 720.
- i18n: en/es only; missing key renders raw key (add debug assertion).

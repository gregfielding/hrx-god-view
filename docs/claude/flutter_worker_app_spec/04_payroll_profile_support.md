# Flutter clone spec 4/4 — Payroll, Pay history, Bank, Everee embed, Payroll help, Profile, Support

> Generated 2026-08-29 by deep source audit.

## 0. Cross-cutting
- Money routes double-guarded (WorkerRoute wrapper): earnings, earnings/:tid, payroll-settings, pay-history(+detail). payroll-help/support/profile rely on layout guard.
- Redirects: /c1/workers/payroll → /earnings; /payroll/:tid → /earnings/:tid; /settings → /profile/app-language; /inbox → /notifications.
- Theming: **light only** — worker theme has no dark mode. Flutter: single ThemeData, do NOT wire ThemeMode.system.
- i18n: runtime-fetched public/i18n/locales/{en,es}.json; persistence localStorage `hrx_preferred_language` + session "changed this session" flag; reconciliation on login: local-changed-this-session wins and writes to Firestore, else Firestore wins. Port this rule or language flips after login.
- Push: registerPushToken writes `users/{uid}/pushTokens/{token}` {token, platform:'web'→'ios'/'android', deviceId, enabled:true, createdAt, updatedAt} merge. Profile push toggle writes only a pref flag — does NOT delete token doc. Foreground handler is a stub.

## 1. /c1/workers/earnings — Payroll hub (`WorkerPayrollIndex.tsx`)
- Data resolution: users/{uid} snapshot evereeWorkerIds map → fallback everee_workers where firebaseUid==uid → eligibility filter (entity_employments terminated/separated/inactive excluded) → **always 'picker' landing (single-employer auto-redirect removed 2026-08-28)** → entity labels from entities where evereeTenantId==tid → workerKind (c1_events_llc locks contractor) → setup checklist from everee_workers (done = status onboarding_complete/complete[d]; ssnOk = readinessMirror.taxpayerIdentifierLast4; bankOk = bankAccountCount>0 || directDepositReady).
- Layout: h5 `nav.payroll` "Payroll" → `earnings.chooseEmployer` "Pay history, direct deposit, and tax forms — everything about getting paid." → PaymentIssueBanner → payday strip (Card action.hover): rows>0 && today → `earnings.paydayTodayLabel`; rows>0 → "Next payday: Friday, September 5" (`nextPaydayLabel`, Intl es-US/en-US); rows==0 → `earnings.firstPaydayNote` "You're paid by direct deposit on the Friday after your first work week." → **Recent pay** (≤10 rows, Card+dividers; row: net USD (fallback gross) + caption "{payDate} · {employer} · Gross ${g}" when net≠gross; chip PAID→"Paid" success filled / ERROR|RETURNED→"Needs attention" error outlined / else "Processing" outlined; tap → pay-history/{tid}/{statementId}) + "View all →" → pay-history → **Payroll settings** cards: Direct deposit (`profile.sectionDirectDepositTitle/Description`) → payroll-settings; per eligible entity: title !done → `earnings.finishSetupCard` "Finish payroll setup" else `contractorTaxForms`/`w2TaxForms`; 3-step checklist ✓/○ (`stepSsn` "Social Security number" / `stepBank` "Direct deposit" / `stepTaxForms` "Tax forms & signatures" — taxForms always ○ since it's in-widget) + "{done}/3 · about {5|2} minutes"; tap → earnings/{tid} → trailing "Payroll help →" → payroll-help.
- States: no uid → hardcoded "Sign in to view payroll."; loading spinner; loadError raw message; empty landing → hardcoded "No payroll account yet — contact your recruiter if you were expecting access." + "Back to dashboard". **(Hardcoded EN — add i18n keys in clone.)**
- PaymentIssueBanner (hub + pay-history): first open-issue row with payDate ≥ today-60d; missing_tin → setup title/body/CTA "Finish setup" → earnings/{tid}; bank_invalid|deposit_returned → deposit title/body/CTA "Fix direct deposit" → payroll-settings.
- Data: callable evereeGetPayHistory per linkage (via useWorkerPayHistory: per-employer failures silently swallowed; merged; payDate STRING sort desc; USD = Intl en-US always). Linkage hook skips smokeData + sandbox tenant '2320'.

## 2. /c1/workers/earnings/:tid — Everee embed (`WorkerPayrollEvereeTenant.tsx`, 1166 lines)
- Phases: loading | bank_offer | ready | expired | error | forbidden.
- Session start: users.evereeWorkerIds[tid] (string + numeric forms) → fallback everee_workers query (+ self-heal write evereeWorkerIds) → no id → redirect to hub. Entity via entities where evereeTenantId==tid (string/int) → else error "Could not resolve payroll configuration for this employer…". Preflight callable **evereeGetMyOnboardingStatus** → experienceType ONBOARDING|WORKER_HOME (API failure ⇒ ONBOARDING).
- **Bank-first gate**: ONBOARDING && bankStep pending → BankFirstCard (`workerPayroll.bankFirst.*`): title "Set up direct deposit"; intro "…you'll only have your SSN and tax forms left."; fields bankName/accountName/accountType (CHECKING default)/routing (9 digits)/account (4–17)/confirm — single bottom warning Alert; errors `.requiredFields` "Please fill in every field." / `.routingInvalid` (ABA checksum) / `.accountInvalid` "Account number should be 4–17 digits." / `.accountMismatch`; privacy caption "…HRX ONE never stores them."; buttons `.skip` "Skip for now — I'll add it during setup" / `.submit` "Save & continue" (details ride the session callable ONCE via ref, never resubmitted). bankPush.ok===false later → dismissable info `.pushFailedContinue`.
- Callable **evereeCreateOnboardingSession** {tenantId, entityId, userId, evereeWorkerId, experienceType, context worker_page[_bank_first], bankAccount?, returnUrl} → {embedUrl, origin, expiresInMs (1h default), eventHandlerName ('hrx_default'), bankPush?}. Expiry timer → expired phase. Server-rejection auto-swap: EMB-201/complete → WORKER_HOME; EMB-202 → ONBOARDING (once each).
- Ready: header back→/earnings → iframe (height calc(100vh-170px)) → ONBOARDING extra: text button "I've already finished onboarding — open my account" (hardcoded).
- **Iframe bridge — the #1 Flutter port risk** (`utils/everee/hostMessageBridge.ts`): V1_0 (WORKER_HOME) = postMessage + origin check; V2_0 (ONBOARDING) = BOTH `window[eventHandlerName].postMessage` bridge object injected pre-load AND a MessageChannel port transferred on iframe load — missing either ⇒ Everee renders EMB-102 forever. Messages advisory only. Flutter WebView needs: JS bridge injection, MessageChannel shim, origin checking, fresh session per mount (one-time URLs), cookies/3rd-party storage allowed.
- Other states hardcoded EN: "Sign in to view payroll." / forbidden "No payroll account found for this employer." / error {msg} + "Try again" / expired "This payroll session expired. Refresh to continue." + "Refresh session".

## 3. /c1/workers/pay-history (+/:tid/:statementId) (`payHistory.tsx`)
- List: header `earnings.payHistoryTitle` "Pay history" back→earnings; PaymentIssueBanner; employer filter chips only when >1 linkage (`earnings.allEmployers` "All" + labels); rows = hub anatomy, limit 200; loading spinner; empty `earnings.noPayments` "No payments yet." (info alert).
- Detail: header `earnings.statementTitle` "Pay statement" back→pay-history; summary card renders from list row then overlays fetched detail — **h5 shows GROSS while list shows NET (flag: decide before porting)**; "{payDate} · {employer}"; "Pay period: {start} – {end}" (`earnings.period`); status chip. Fetch callable **evereeGetPayStatement** {tenantId, entityId, statementId} (entityId from matching linkage — if linkages not loaded the effect returns early). Line-item card sections Earnings/Taxes/Deductions ({label | amount}). PDF: pdfUrl → "View PDF statement" window.open (short-lived signed URL — never cache) else `earnings.noPdf`. Errors `earnings.statementError` "Couldn't load this statement — please try again."

## 4. /c1/workers/payroll-settings — Direct deposit (`payrollSettings.tsx`)
- Header `payrollSettings.title` "Direct deposit" **back→/c1/workers/profile**; intro "The bank account where your pay is deposited, for each employer."
- EmployerBankCard per linkage with evereeWorkerId: fetch **evereeAdminGetWorker** {tenantId, entityId, evereeWorkerId, userId} (self-access allowed; TIN scrubbed server-side) → bankAccounts → "{bankName||'Bank account'} · {Checking|Savings} •••• {last4}" + `payrollSettings.blocked` "Deposits blocked" error chip when depositsBlocked; error → `loadError` warning; none → `noAccount` "No bank account on file yet."; button "Replace bank account"/"Add bank account" (`bankDialog.replaceTitle/addTitle`).
- **ReplaceBankAccountDialog** (shared w/ admin): same 6 fields as bank-first, `bankDialog.*` namespace, single bottom warning Alert, submit-time validation only. ABA checksum (`src/utils/abaRouting.ts`): 3·(d0+d3+d6)+7·(d1+d4+d7)+(d2+d5+d8) %10==0 && >0. Save = **evereeAdminGetWorker with setDefaultBankAccount payload** (write-through+read, no dedicated callable). Failure: bankUpdate.error || `bankDialog.rejected`; success → onSaved(fresh scrubbed record) → snackbar `payrollSettings.saved` "Bank account updated."
- Inputs are **plain text, not obscured** (display masking read-side only) — consider obscureText+reveal in Flutter; disable clipboard persistence; no screenshot cache.
- Empty state `payrollSettings.empty` "Payroll setup hasn't started yet — once you're hired, direct deposit appears here."
- SSN/tax forms live ONLY in the Everee widget (§2) — keys `profile.sectionSsnTax*`/`sectionPayDocs*` are dead strings (no consumer).

## 5. /c1/workers/payroll-help (+/:ticketId) (`payrollHelp.tsx`)
- Header "Payroll help" back→**/c1/workers/support**; subtitle `payrollHelp.subtitle`.
- Pay-schedule facts card: `scheduleTitle` "When do I get paid?" + `scheduleSelect` "C1 Select: the pay week runs Sunday–Saturday, and payday is the following Friday." + `scheduleEvents` "C1 Events: the pay week runs Monday–Sunday, and payday is Friday." + `scheduleDirectDeposit`.
- New ticket: "What's going on?" + multiline placeholder `newTicketPlaceholder` "Example: I worked Saturday but my pay looks short…" + Send (disabled sending||empty). No subject/category/attachments.
- My requests list (only when tickets exist — **no empty state**): subject + lastMessageAt date + status chip (resolved→"Resolved" success / waiting_worker→"New reply" secondary / else "Open" outlined) → thread.
- Thread: messages ("You" / authorName / "C1 Payroll team" + date, pre-wrap); zero messages → `loadingThread` "Loading conversation…" (doubles as empty); reply composer `replyPlaceholder`.
- Data: LIVE onSnapshot payroll_tickets where uid==uid (client sort by lastMessageAt desc — intentionally unindexed) + messages orderBy createdAt asc. Writes: NONE direct (rules deny) — callable **workerSupportAssistant** {action:'payroll_create_ticket'|'payroll_reply'}. Send error `sendError` "Couldn't send — please try again." Guard: no-ops without activeTenant?.id.

## 6. /c1/workers/support (`support.tsx`)
- Header "Help & Support" back→profile.
- Ask a question: single field placeholder `askPlaceholder` "How do I cancel a shift?" + send; reply panel: answer pre-wrap + "Confidence: {pct}%" + `escalationRecommended` warning chip; suggested actions (**first 3**, keyword-routed: inbox|recruiter|contact→notifications, assignment→assignments, profile→profile, else no-op); follow-ups (**first 2**) re-submit; escalate → warning `mayNeedRecruiterSupport`; error `errorSending` "Something went wrong. Try again or contact your recruiter."
- Common questions (tap fills+submits): questionCancelShift/WhenPaid/WhatToWear/UpdateCerts.
- Payroll help desk row → payroll-help (`payrollHelp.entryTitle/entrySubtitle`).
- **Escalation/contact-recruiter card is dead code ({false && …}) — no human-contact channel here besides the payroll desk.** No tenant → `selectOrganization`.
- Callable workerSupportAssistant {question, tenantId} → {answer, confidence, suggestedActions, followUps, escalate, sourceTopics(unrendered)}.

## 7. Profile
### 7.1 Hub — /c1/workers/profile (`profile.tsx`)
- Identity card: Avatar 64 (workerProfile.photoUrl||avatar||auth) · name or `yourProfile` · "{city}, {state}" or `addLocation` · stats "{n} shifts · {n} hours · Member since {year}" (server aggregate on timesheet_entries; hidden on failure) · "{complete} of {total} sections complete · {pct}%" when incomplete · row Personal details → /profile/personal-details.
- Work Profile card (`workerAccount.sectionWorkProfile`): Work authorization (**hidden by default flag**) / Skills (✓ at ≥3) / Certifications & Licenses / Languages / Availability and preferences / Experience (hub → /profile/experience).
- Documents card → /c1/workers/documents. Account Settings card: Sign-in & security (/profile/reset-password) / Communication Preferences (/profile/app-language) / Help & Support (/c1/workers/support) / About & Legal (/profile/about) / **Log Out (no confirm dialog)**.
- Commented-out (do not port): Employment card, Pre-employment checks card. **No Direct-deposit/Earnings row — money only via bottom tab** (payroll-settings back button targets profile anyway).
- Completion math: basic = name+email+phone+city+state; work = workAuth(auto)+resume+bio+certs+experience+education+languages+skills≥3; account = email.

### 7.2 Section editor — /profile/:section (`profileSection.tsx`)
- Sections: personal-details / work-authorization (redirects away when flag disabled) / preferences / resume / bio / skills / certifications / work-history / education / languages / app-language / reset-password. Aliases: settings→app-language; location→personal-details. Unknown → `sectionUnavailable` "That profile section is not available."
- `?verify=phone` auto-opens EligibilityModal (Twilio OTP) and strips param.
- preferences: toggle buttons write IMMEDIATELY (no save; failures unhandled) — target work types Hospitality/Industrial; schedule Full-Time/Part-Time/Gig Work → buildReadinessIntentWritePatch.
- languages: 13 toggle buttons (English…French) → updateDoc users.languages deduped; saved/error alerts.
- app-language: language Select (en/es — UI switches instantly, then Firestore write; **UI stays switched even if write fails**); 4 notification Switches (email/push/sms/marketing; sms derives smsOptIn!==false && !smsBlockedSystem; enabling sms clears smsBlockedSystem); phone-verification status read-only ("Verified"/"Not verified" + note).
- reset-password: phone-OTP explainer `phoneSignInHelp` "You sign in with your mobile number — we text you a code. No password needed." + Log Out button. (Password-reset strings dead.)

### 7.3 Personal details (`WorkerBasicIdentityCard.tsx`)
- Avatar 72 + camera overlay → file input → ImageCropDialog (round, aspect 1) → Storage `avatars/{uid}.jpg` → updateDoc avatar + workerProfile.photoUrl. **Upload errors console-only — add error surface in Flutter.**
- **Persistence: 600ms debounce + write-on-blur straight to users/{uid}. NO validation, NO error strings, NO save indicator. Shared timeout ref can drop rapid cross-field edits.** Flutter: keep autosave feel but add per-field debounce + minimal validation.
- Fields: firstName, lastName, phone (tel; ≥10 digits reformatted), email (no validation), dateOfBirth (date; writes dateOfBirth AND dob), emergencyContact name/phone (progressive US format), streetAddress (Google Places US autocomplete; blur geocode when coords missing), city, state (free text), zip (writes zip+postalCode); address writes mirror streetAddress/addressLine1 via mirrorAddressShapes + homeLat/homeLng. last4SSN render disabled (mirrored from Everee, read-only).
- **Email/phone changes are plain writes — no verification/re-auth.** Phone-change RECOVERY is the logged-out flow (PhoneLoginPage recover step → staff approval queue). Nothing in profile links to it.

### 7.4 /profile/experience — nav hub → resume/bio/work-history/education rows.
### 7.5 /profile/about (`profileAboutLegal.tsx`)
- Rows open SAME-ORIGIN routes in new tab: /terms, /privacy, /sms-privacy (`aboutTerms/Privacy/Sms` labels).
- **Delete account** (App Store requirement — port verbatim): row `aboutDeleteTitle`/`aboutDeleteSecondary` → confirm Dialog `aboutDeleteExplainer` "This sends a deletion request to our team. Records we are legally required to keep (like payroll and tax records) are retained for the required period; everything else is removed. We will confirm by text or email." + `aboutDeleteConfirm` "Request deletion" → account_deletion_requests/{uid} {status pending, source worker_profile_about}; already-exists → 'already' state; done → `aboutDeleteRequested`. **Throw → silent (add error surface).**

## 8. Callable/collection inventory (this slice)
- Callables: evereeGetPayHistory, evereeGetPayStatement, evereeAdminGetWorker (read + bank write-through), evereeGetMyOnboardingStatus, evereeCreateOnboardingSession, workerSupportAssistant (Q&A + payroll tickets), sendOtp/checkOtp (auth).
- Reads: users/{uid} snapshot; everee_workers; entities; entity_employments; timesheet_entries aggregate; payroll_tickets(+messages) read-only; account_deletion_requests.
- Writes: users/{uid} (profile fields, prefs, language, avatar, evereeWorkerIds self-heal); pushTokens; account_deletion_requests; Storage avatars/{uid}.jpg.

## 9. Gaps to NOT inherit
- Hardcoded EN: hub sign-in/empty states; ALL WorkerPayrollEvereeTenant state strings; both "already finished onboarding" buttons.
- Statement detail gross-vs-net headline inconsistency.
- Payroll-help list no empty state; thread empty = "Loading conversation…".
- Silent failures: avatar upload, preferences writes, deletion request.
- Bank inputs plain text (only stored value masked).
- No dark mode; no foreground push toast; no biometric gate on money screens (consider adding in Flutter).

# Flutter clone spec 3/4 — Assignments, Assignment details, Employment, Documents, Readiness

> Generated 2026-08-29 by deep source audit.

## 0. Shared
- SmsWarningBanner (assignments list + details): shows when smsSystemAvailable && smsDisabled && !snoozed (localStorage `worker_sms_warning_dismiss_until_{uid}` 24h). **Hardcoded EN**: "Turn on text alerts" / body / actions "Turn On SMS" (updateDoc smsNotifications/smsOptIn/smsBlockedSystem) or "Add phone number" → personal-details; "Not now" snooze; busy "Saving…".
- Pay formatting: `formatHourlyPayRateForDisplay` → "$18.81/hr" (2 decimals; null hides).
- Date parsing: ALWAYS local (`YYYY-MM-DD` parsed as local midnight) — never `new Date(string)` UTC.

## 1. Assignments list — /c1/workers/assignments (`assignments.tsx`)
- Header: h5 `assignments.title` "My Schedule" + `assignments.subtitle` "Your upcoming and past shifts." + icon-only ToggleButtonGroup: **Calendar (default) / List / Archive** (`assignments.tabCalendar/tabUpcoming/tabPast` tooltips).
- **Calendar** (WorkerAssignmentsCalendar): Day/Week/Month toggle (default month); toolbar ‹ Today › (`assignments.calendarPrevMonth/Today/NextMonth`); month cells cap 4 items + "+{n} more" (`calendarMore`); day agenda empty `calendarNoShiftsDay`; whole empty `calendarEmpty`. Item = `{compactTime} {jobTitle}` colored by kind: confirmed #1976d2, accepted #2e7d32, submitted #DAA520, available #9e9e9e. Tooltip "{STATUSWORD} · {time} {postTitle} - {jobTitle} • {cityState}" (`calendarStatusConfirmed` "CONFIRMED", `...Accepted` "ACCEPTED - CLICK TO CONFIRM", `...Pending`, `...Available`). Tap: confirmed → assignment detail; others → `/c1/jobs-board/{jobPostId}`. Multi-day items repeat on EVERY day in range (open shifts: start day only). compactTime "3pm"/"10:30am".
- **List**: empty → Card `emptyNoUpcomingTitle` "You don't have any upcoming shifts." + `findWork` "Find Work" → jobs board; else WorkerAssignmentCard per item.
- **Archive**: sub-toggle Assignments (default) / Applications (`archiveAssignments/archiveApplications`); assignments empty → `emptyNoPastTitle` "No past assignments yet" + subtext; applications → `<UserApplications embedded/>`.
- **Card** (WorkerAssignmentCard, whole card → detail): jobTitle (fallback 'Assignment'); **company deliberately hidden**; date/time line — open shift: "{start} – {end|'ongoing'} • No set times" (`openShiftOngoing`/`openShiftNoTimes`); multi-day (endDate>startDate raw compare): "Fri, Mar 13 – Sat, Mar 14" no times; normal: "Fri, Mar 13 • 1:00 PM – 9:00 PM"; open-shift explainer italic box (`openShiftExplainer`); location "{siteName}, {address}"; pay primary.main; status chip; "View Details →" (`viewDetails`).
- Status mapping: confirmed|active→confirmed; cancelled|canceled|declined→cancelled; completed; no-show; else scheduled. Labels: scheduled/confirmed → `statusUpcoming` "Upcoming"; cancelled → "Cancelled"; completed → "Completed"; no-show → `statusMissed` "Missed". **Past-tab override**: past + scheduled/confirmed → forced "Completed"/success. Colors: scheduled/confirmed/completed success; cancelled/no-show error.
- Bucketing: past = status ∈ cancelled/declined/completed OR today > (endDate||startDate)+1day (stays upcoming through day after end). Upcoming asc, past desc.
- Data: assignments where userId==uid (tenant = activeTenant ?? C1); per-locationId `tenants/{t}/locations/{id}` enrichment; calendar extras: applications by user + job_orders + shifts (submitted app_{shiftId} entries + grey avail_{shiftId} future shifts of engaged JOs). Synthetic ids `app_*`/`avail_*` must never route as assignments. looksLikeDocId (15-30 alnum chars) suppresses id-like names.
- **Dead**: onCancelShift plumbing (no button renders — cancel lives on details page); `assignments.cancelShift` orphan key. Do not port.

## 2. Assignment details — /c1/workers/assignments/:assignmentId (`AssignmentDetails.tsx`, 1840 lines)
- Access: owner (userId||candidateId === uid) OR tenant staff; else error 'You do not have permission to view this assignment'.
- `?intent=accept` (SMS deep link): auto-fires `respondToAssignment({decision:'accept'})` on mount (skipped if status ∈ confirmed/active/declined/cancelled); banners (hardcoded EN): info "Accepting your assignment…" / success "You've accepted this assignment. The details are below…" / error "We couldn't accept this assignment automatically: {msg}. Scroll down and tap Accept manually, or contact your recruiter."; strips intent param.
- Sections in order:
  1. SmsWarningBanner.
  2. Header: `assignment.detailsTitle` "Assignment Details", back → /c1/workers/assignments (when path has /workers/) else history; right: outlined "Add to calendar" (`assignment.addToCalendar`) disabled without startDate. **No status chip (removed by design — don't re-add).**
  3. Open-shift explainer Alert (`assignments.openShiftExplainer`).
  4. **Assignment Info** card: left — Job Title, Start Date (MMMM dd, yyyy), Time "{h:mm a} – {h:mm a}" (effectiveStart/EndTime), Pay Rate; company hidden. Right — Worksite name; Worksite address AS a link-button → `https://www.google.com/maps/search/?api=1&query={enc}`; "Job Preparation" subtitle; Required Uniform (uniform+custom joined, pre-wrap); Required PPE (conditional); Physical requirements (conditional); Critical requirements (joined hardcoded 'Background check'/'Drug screening'/'E-Verify'). **No-show risk never rendered.**
  5. **Shift details** card (only if shiftDescription or clockInUrl; hardcoded EN): "Clock-in" + "Open clock-in" button (**uses RAW clockInUrl — normalize http/https in Flutter**); "Shift-specific details" + LinkifiedText of shiftDescription_i18n.es ?? shiftDescription.
  6. **Staff instructions** cards, fixed order: firstDay/parking/checkIn/uniform/credentials/other/attachments (`assignment.firstDayInstructions` etc). Text: staffInstructions_i18n[key][lang] → legacy staffInstructions[key].text ({en,es} resolved) → checkInInstructions (checkIn only). LinkifiedText: URLs, bare www./domain-path, US phones → tel:. Files → outlined buttons href new tab (`common.viewFile` "View File"). Inheritance (low→high): parent account orderDefaults < account < location_defaults < job order < shift < assignment; text and files picked independently.
  7. Additional Notes card (assignment.notes || jobOrderDescription) — hardcoded "Additional Notes".
  8. Location map card: 320px iframe `google.com/maps?output=embed&q=` + "Open in Google Maps" (`assignment.openInGoogleMaps`).
  9. **My Recruiter** card (hardcoded header): per recruiter — name; phone as **`sms:` link** (not tel: — keep, consider adding call); email mailto:. Falls back to denormalized assignment.recruiterName/Email/Phone (worker reads of staff `users` docs are DENIED since 2026-08-25 — expect failure, use fallback).
  10. Self-cancel: full-width outlined error `jobs.cantWork` "I can no longer work" — shown unless open shift or status ∈ cancelled/declined/completed/terminated. window.confirm(`assignments.cantWorkConfirm`) → respondToAssignment worker_cancel → navigate jobs-board/{jobPostId}. Error alert `assignments.cantWorkError`.
- Time resolution: assignment.startTime || dateSchedule entry for that day || shift.defaultStartTime.
- respondToAssignment server effects: accept → assignment confirmed + application accepted + ensureWorkerOnboardingPipeline; decline → declined; worker_cancel → 'worker-cancelled' + application applyDates minus day (empty → withdrawn).
- Data reads: assignments/{id} (legacy root → per-tenant fallback across [activeTenant, C1, ...user tenantIds]); app_ prefix → applications path; loadFromJobOrder (job_orders, accounts, location_defaults, shifts); shifts doc; recruiters via job_order.assignedRecruiters→users (falls back to denormalized); crm_companies + locations for names/addresses.

### ICS contract (`src/utils/assignmentCalendarIcs.ts`) — replicate byte-for-byte
- Input: title=jobTitle||'Assignment'; description=[company, worksite] join '\n'; location=worksiteAddressStr; start/end dates + effective times.
- No startDate → null → button silently no-ops. All-day (no times): DTSTART;VALUE=DATE local, DTEND +1day. Timed: start=combineLocal(startDate, startTime||'09:00'); end=combineLocal(endDay, endTime||startTime||'10:00'), end<=start → +1 day; UTC Z format.
- VCALENDAR: PRODID -//HRX//Assignment//EN; UID {assignmentId}@{hostname}; escaping \\ \; \, \n; 75-char folding CRLF+space on SUMMARY/LOCATION/DESCRIPTION; NO alarms/timezone/recurrence (multi-day = one spanning event). Filename `assignment-{slug48}.ics`.
- Flutter: prefer native add-to-calendar intent (add_2_calendar) with same fields; keep .ics share fallback. Maps: geo:/Apple Maps deep links with web URL fallback; iframe map → static image or google_maps_flutter or just the link.

## 3. MyAssignments.tsx (/c1/assignments) — legacy table page, zero i18n, different status vocab ("Assigned"), naive UTC date parsing, queries userId+candidateId across all tenants. **Do not port**; fold dual-field/multi-tenant query into the main list if needed.

## 4. My Employment
### 4a. List — /c1/workers/my-employment (`myEmployment.tsx`)
- Concept: one card per `entity_employments` doc = relationship with a C1 legal entity (entityId, entityKey select|workforce|events, workerType w2|1099, status, onboardingPipelineId, phase...).
- Header `workerEmploymentHub.myEmploymentTitle` "My Employment" back→profile; description "Employers you work with and what to do next."
- Card: entityName · workerType chip 'W-2'/'1099' · status chip (`statusNotStarted/UnderReview/ActionNeeded/WaitingOnEmployer/Complete/Ended/Inactive`; historical rows → "Record · {label}" outlined) · nextStepLine (`nextUploadI9` "Upload I-9 documents", `nextFinishReplaceI9`, `nextReplaceRejectedI9`, `nextI9UnderReview`, `nextWaitingForEmployer`, `nextFinishTasks`, `nextContinueOnboarding`, `nextGetStarted`) · chevron → detail.
- Empty `myEmploymentEmptyList`; !uid → `myEmploymentSignIn` + Sign in; !tenant → `myEmploymentNeedEntity`.
- Reads: entity_employments by user; worker_onboarding/{pipelineId} (progress + i9 verified flag); assignments by entityKey. No writes.

### 4b. Detail — /c1/workers/my-employment/:employmentId (`myEmploymentDetail.tsx`)
- Readiness banner (unless ready): onboarding → `readinessOnboardingShort` "Finish onboarding to start working."; at_risk warning "Some items need attention soon"; blocked error "You are not eligible to work right now"; not_ready info.
- Compliance alert: `complianceDocActionRequired` / `complianceDocExpiringSoon`.
- **Branch A (onboarding complete)** → hub: success "You're all set" + card "Payroll, documents & details" with 3 sections — Payroll (buttons from entity.payrollSettings: `payrollButtonSetup` external contained / `payrollButtonView` portal outlined; none → placeholder), Identity & work auth (scroll-to-I9 + I9 subsection; hidden for 1099 → `hubNoI9Uploads`), Screening (one status line).
- **Branch B (bridge checklist)** → 3 cards (Identity & work authorization / Payroll setup / Screening) of path rows + optional "Payroll login (existing account)" external link + `bridgeHelpLink` → support. Historical alert `historicalPathAlertShort`.
- Row anatomy: status icon (complete CheckCircle success / required ErrorOutline error / in_progress Hourglass primary / pending RadioUnchecked disabled) + bundle label (`bundleFormsTax` "Forms and tax documents", `bundlePayrollSetup`, `bundleWorkAuth`, `bundleEmploymentVerification`, `bundleBackgroundCheck`, `bundleScreening(s)`, `bundlePayroll`) + chip ("On file"/"Needs attention"/"Done"/"In progress"/"Waiting") + Start/Continue button (worker-actionable only): everee+incomplete → window.open(payroll signup/portal); i9/work_authorization → scroll to I9 anchor.
- **I-9 section** (WorkerEntityI9Section, hardcoded EN): "I-9 supporting documents" + "one List A, or one List B plus one List C." + I9SupportingDocumentsWorkspace (upload UI). Manual-complete → success alert "Your employer confirmed your I-9 supporting documents…" and no uploader. **No WorkBright in worker src — I-9 = HRX uploads + external portals.**
- Reads: entity_employments/{id} (fallback by pipelineId), entities/{id} (payrollSettings), worker payroll account, worker_compliance_items, onboarding_automation_dispatch, onboarding path builder (big shared util — port as Dart module or move behind a callable). No writes on page (I9 workspace writes internally).

## 5. Documents — /c1/workers/documents (`documents.tsx`)
- Header `dashboard.documents` "Documents" back→profile; description `documents.subtitle` "Compliance, credentials, and job files."
- Summary card: "Compliance" + "{pct}%" chip (success at 100) + "{n} expiring soon" warning + "{n} expired" error; no checklist → "Not started".
- Tabs: Compliance / Credentials / Job Files.
- **Compliance**: checklist from users/{uid}.onboarding.checklist (live) + synthetic work_eligibility item from attestation. Labels: everee_identity "Identity verification", everee_i9 "I-9", direct_deposit, driver_license, resume, certifications, work_eligibility. DocRecordCard: label + chip (Missing warning/Submitted default/Verified success/Expiring Soon warning/Expired error — hardcoded EN) + "Expires/Expired {date}" caption + CTA. CTA rules: attestation → `documents.reviewAnswers` → `/c1/workers/profile#work-eligibility`; provider everee → `dashboard.notAvailableYet` "Not available yet"; missing → "Upload"; verified/expiring/expired → "Replace". **Every CTA except work_eligibility opens the "Not available yet" dialog** (`documents.actionNotAvailable` — uploads are stubs today; decide whether Flutter builds real upload or keeps parity).
- Display status: expiresAt past → expired; ≤30d → expiring_soon. compliancePercent = completed/required (missing/submitted/expired don't count).
- **Credentials**: WorkerDocumentsSummary (hardcoded EN: Work Eligibility attestation status + "Review answers" link; Certifications count; Background "{n} background, {n} drug"/"None ordered"); missing-required warning + "Upload now" scroll; Required = **Resume only** (verified iff resume.downloadUrl); Optional always empty → "No certifications added yet." + "Add certification" (stub dialog); screening-orders card (lines "{Background|Drug|Other}: {label} — {status} ({result})", E-Verify "C1 Select — E-Verify — {status} ({result})").
- **Job Files**: read-only staff-instruction files across applied job orders (users.applicationIds → applications → job_orders.staffInstructions.*.files), card = file label + "{jobOrderName} · {sectionLabel}" + View (new tab). Empty `documents.noAssignmentFiles`.
- No writes at all. File View = external browser (signed URLs) — url_launcher external mode.

## 6. Readiness
- **JobReadinessFeed.tsx (1595 lines) is ORPHANED — no route, no importer.** `/c1/workers/job-readiness` redirects to a dashboard anchor that no longer exists. Treat as design reference only (7-step wizard: intent/photo/resume/work-auth/certs/skills + impact-weighted readiness engine with lifecycle states Not started/Self-reported/Under review/Verified/Action required). Do NOT assume it ships.
- The LIVE readiness surface = dashboard Action Items (spec 1/4 §3.4): snapshot `users/{uid}.workerDashboardActionItemsV1` — **i18n keys not strings; a Flutter mirror already exists at `c1_app/lib/.../worker_dashboard_action_items_v1.dart`** (note: a c1_app Flutter scaffold exists — check it before starting fresh).

## 7. Gaps / defects to NOT inherit
1. Dead job-readiness redirect + orphaned wizard.
2. Raw clockInUrl as href (normalize).
3. Dead onCancelShift plumbing on list; dead getStatusColor/Icon on details.
4. Documents page CTAs are stub dialogs (only work_eligibility navigates) — product decision for the clone: build real uploads or keep parity.
5. Hardcoded EN inventory: SmsWarningBanner; details accept banners/Shift details/Clock-in/Additional Notes/My Recruiter/critical-requirement labels; Doc cards + summary + required/optional/empty states; WorkerEntityI9Section; MyAssignments page; withdraw confirms.
6. window.confirm/alert for destructive flows → real dialogs.
7. Debug console.log of raw assignment docs — don't port.

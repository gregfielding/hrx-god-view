# FLUTTER_WORKER_APP_SOURCE_OF_TRUTH

## 1) OVERVIEW

This document maps the current **worker-facing** web app behavior in `hrx-god-view` for a future Flutter worker app implementation.

Scope included:
- Worker users with `securityLevel` in `0,1,2,3,4` and `null` (treated as worker in route guards).
- Worker-facing routes, screen behaviors, Firestore reads/writes, callables, triggers, notifications, deep links, and support/inbox flows.

Scope excluded:
- Recruiter/admin/god flows unless they directly affect what workers see (e.g., recruiter-created assignments that workers read; backend triggers that generate worker notifications).

Current worker experiences in web app:
- Worker dashboard/home
- Find Work (jobs board)
- Job detail + apply
- Apply wizard
- My applications
- My assignments + assignment detail
- Job readiness/profile
- Documents
- Inbox + notifications
- Help & Support (AI + recruiter escalation)

Primary route definitions live in:
- `src/App.tsx`
- `src/components/ConditionalWorkerLayout.tsx`
- `src/components/ConditionalJobsBoardLayout.tsx`
- `src/auth/WorkerRoute.tsx`

Known unstable/incomplete areas:
- Worker documents upload actions in `/c1/workers/documents` are largely placeholder ("Not available yet"), except existing file viewing.
- Legacy/global thread model (`threads/*`) coexists with tenant-scoped conversations.
- Some paths/services still mix legacy naming and denormalized data assumptions.
- Notification token path helper mismatch exists (`deviceTokens` helper vs actual `pushTokens` usage).

---

## 2) WORKER AUTH / SECURITY MODEL

### How worker users are identified
- Auth comes from Firebase Auth, centralized in `src/contexts/AuthContext.tsx`.
- Route guard for worker shell is `WorkerRoute` (`src/auth/WorkerRoute.tsx`):
  - unauthenticated -> `/login`
  - `securityLevel >= 5` -> `/dashboard`
  - else allowed (worker scope)

### Security level interpretation
- Numeric interpretation used in worker guard:
  - `const level = parseInt(String(securityLevel ?? '0'), 10) || 0;`
- This means `null/undefined/empty` acts as `0`.
- Worker app scope in this doc: levels `0-4` and `null`.

### Claims/roles affecting worker visibility
- `AuthContext` supports token claims (`claims.roles[tenantId].securityLevel`) and legacy user-doc fields.
- Current worker route gating is still based on `securityLevel` from context.
- `activeTenant` is heavily used for tenant scoping on worker screens.

### Route guards / access checks relevant to worker app
- `/c1/*` under `ConditionalWorkerLayout`:
  - logged out: plain `Outlet` (public pages possible)
  - logged in: wrapped in `WorkerRoute` + `C1WorkerLayout`
- `ConditionalJobsBoardLayout` similarly wraps tenant-slug jobs/assignments routes when logged in.

### Onboarding / login assumptions
- Login redirect (`src/pages/Login.tsx`):
  - worker-ish users (`<5`) are sent to `/{tenantSlug}/users/{uid}` currently.
  - admin/internal (`>=5`) to `/`.
- Public onboarding routes exist:
  - `/onboarding/profile`
  - `/onboarding/complete`
  - `/invite/:token` -> onboarding flow

### Null `securityLevel` handling
- Null is treated as `0` in worker routing logic.
- Flutter should not assume null means unauthorized; it should follow backend/claims policy and product decision.

---

## 3) SCREEN / ROUTE INVENTORY

Route map is documented in `docs/WORKER_ROUTES.md`. Worker-relevant routes:

### Dashboard/Home
- Path: `/c1/workers/dashboard`
- Purpose: worker smart home with assignment/recommendation/readiness cards
- Main entities: `users`, `tenants/{tenantId}/assignments`, `applications`, `job_postings`, onboarding checklist
- Mirror in Flutter: **Yes**
- Key file: `src/pages/c1/workers/dashboard.tsx`

### Find Work / Jobs Board
- Path: `/c1/jobs-board`
- Purpose: recommendation-first jobs browsing, filter/search/apply entry
- Main entities: `job_postings`, user `applicationIds/applicationData`, `applications`, `assignments`
- Mirror: **Yes**
- Key file: `src/pages/PublicJobsBoard.tsx`

### Job Detail
- Path: `/c1/jobs-board/:postId` and `/c1/jobs/:postId`
- Purpose: job details, requirements UI, apply/withdraw, assignment accept/decline
- Main entities: `job_postings`, `job_orders`, `shifts`, `applications`, `assignments`, `users`
- Mirror: **Yes**
- Key file: `src/pages/JobPostingDetail.tsx`

### Apply Flow
- Path: `/apply/:tenantSlug/:jobId?`
- Purpose: full application wizard and account/profile data completion
- Main entities: `tenants`, `users`, `applications`, `job_orders`, `shifts`, requirement packs
- Mirror: **Yes**
- Key files: `src/pages/ApplyWizardPage.tsx`, `src/components/apply/Wizard.tsx`

### My Applications
- Path: `/c1/workers/applications`
- Purpose: list/card view of applications + status + withdraw
- Main entities: `users/{uid}`, `tenants/{tid}/applications`, `job_postings`, `assignments`
- Mirror: **Yes**
- Key file: `src/pages/UserApplications.tsx`

### My Assignments
- Path: `/c1/workers/assignments`
- Purpose: upcoming/past assignments, card/list, cancel shift
- Main entities: `tenants/{tid}/assignments`, `tenants/{tid}/locations`
- Mirror: **Yes**
- Key file: `src/pages/c1/workers/assignments.tsx`

### Assignment Detail
- Path: `/c1/workers/assignments/:assignmentId` (also tenant-slug alias route)
- Purpose: operational assignment detail (location/instructions/schedule context)
- Main entities: assignments + linked job order/shift/company/location
- Mirror: **Yes**
- Key file: `src/pages/AssignmentDetails.tsx`

### Job Readiness / Profile
- Paths: `/c1/workers/profile`, `/c1/workers/job-readiness`
- Purpose: readiness score, prompts, profile completion, attestation updates, improvement tasks
- Main entities: `users/{uid}`, `users/{uid}.onboarding.checklist`
- Mirror: **Yes**
- Key files: `src/pages/c1/workers/profile.tsx`, `src/pages/c1/workers/JobReadinessFeed.tsx`

### Documents
- Path: `/c1/workers/documents`
- Purpose: compliance checklist + credential summary + job files
- Main entities: `users/{uid}`, `onboarding.checklist`, applications->job_orders staff files
- Mirror: **Yes** (with caveats)
- Key file: `src/pages/c1/workers/documents.tsx`

### Inbox / Notifications
- Paths:
  - `/c1/workers/inbox`
  - `/c1/workers/inbox/:conversationId`
  - `/c1/workers/notifications`
- Purpose: tenant conversations + persistent notification center
- Main entities: `tenants/{tid}/conversations/*`, `users/{uid}/notifications`
- Mirror: **Yes**
- Key files: `src/pages/c1/workers/inbox.tsx`, `src/pages/c1/workers/notifications.tsx`

### Help & Support
- Path: `/c1/workers/support`
- Purpose: AI support, common questions, recruiter escalation to inbox
- Main entities: `tenants/{tid}/ai_chats` (via callable/backend), inbox route
- Mirror: **Yes**
- Key file: `src/pages/c1/workers/support.tsx`

### Login / onboarding (worker-relevant)
- Paths: `/login`, `/invite/:token`, `/onboarding/profile`, `/onboarding/complete`
- Mirror: **Yes** for auth entry and onboarding bootstrapping
- Caveat: web currently redirects worker login to `/{tenantSlug}/users/{uid}` which is not the worker profile route.

---

## 4) FIRESTORE ENTITY MAP

Worker-relevant entities and paths used by web worker flows.

### `users/{uid}`
- Used by workers for:
  - profile basics: name/email/phone/address
  - `preferredLanguage`
  - `avatar`, `resume`
  - `certifications`, `skills`, `languages`, `educationLevel`
  - readiness fields (`backgroundCheckComfort`, `scoreSummary`, etc.)
  - `workEligibilityAttestation`, `workEligibility`
  - `applicationIds` (array), `applicationData` (map)
  - tenant membership (`tenantIds`, `activeTenantId`)
  - onboarding object (`onboarding.checklist`, status summary)
- Worker writes:
  - profile edits, work eligibility attestation, requirements ack fields, language preference, application summary fields
- Backend/admin writes read by workers:
  - `scoreSummary`, screening order arrays, onboarding checklist statuses

### `users/{uid}/notifications`
- Persistent worker notification inbox.
- Fields used:
  - `type`, `category`, `title`, `body`, `createdAt`, `readAt`, `deepLink`, `entityId`, `threadId`, `severity`, `source`
- Worker writes:
  - `readAt` via callable (`markWorkerNotificationRead`)
- Backend writes:
  - notification docs created by unified messaging + triggers.

### `users/{uid}/pushTokens`
- Device tokens for FCM push.
- Web writes directly in `src/firebaseMessaging.ts` with fields:
  - `token`, `platform`, `deviceId`, `enabled`, timestamps
- Backend reads these tokens to send push.

### `tenants/{tenantId}/job_postings`
- Jobs board source.
- Fields heavily depended on:
  - `status`, `visibility`, `restrictedGroups`
  - title/description/company/worksite/pay/start/end
  - requirement fields (`licensesCerts`, `experienceLevels`, `educationLevels`, etc.)
  - `jobOrderId`, `positionJobTitle`, dynamic shifts flags
- Mostly backend/recruiter written; worker reads.

### `tenants/{tenantId}/job_orders/{jobOrderId}`
- Worker reads linked job order details from job detail/apply/assignment detail.
- Worker also reads `shifts` subcollection:
  - `tenants/{tid}/job_orders/{jobOrderId}/shifts/{shiftId}`

### `tenants/{tenantId}/applications/{applicationId}`
- Core worker application record (`applicationId` usually `${uid}_${jobId}`).
- Worker reads status + data + requirements.
- Worker writes:
  - withdraw/cancel-day updates
  - requirement ack updates (`data.requirements.*`) in job detail flow
- Backend/recruiter writes:
  - status progression (`reviewed`, `offer`, `hired`, etc.), assignment linkage, score fields.

### `tenants/{tenantId}/assignments/{assignmentId}`
- Worker reads own assignments for list/detail and offer states.
- Worker writes in web:
  - cancel status update in assignments page (`status: cancelled`)
- Backend/recruiter writes:
  - assignment lifecycle status, details, links to application/job/shift.

### `tenants/{tenantId}/locations/{locationId}`
- Read for assignment location enrichment.

### `tenants/{tenantId}/conversations/{conversationId}`
- Worker inbox conversation list.
- Important fields:
  - `participantUids`, `lastMessageAt`, `lastMessagePreview`, `unreadByUid`, `topic`, `type`, `channelEndpoints`

### `tenants/{tenantId}/conversations/{conversationId}/messages/{messageId}`
- Worker inbox message thread.
- Fields:
  - `sender`, `body`, `createdAt`, `channel`, `direction`, `visibility`.

### `threads/{threadId}` + `threads/{threadId}/messages`
- Legacy worker-thread model still present in code/callables.
- Flutter should prioritize conversation model unless product mandates legacy support.

### `tenants/{tenantId}/ai_chats/{threadId}` and messages
- Created by `startAIThread` callable for support flow.

### `tenants/{tenantId}/requirement_packages`, `onboarding_instances`, etc.
- Present in apply/readiness architecture but worker web mostly consumes denormalized outputs and job requirements rather than managing these directly.

### Query/index assumptions visible in code
- `conversations`: `where(participantUids, 'array-contains', uid)` + `orderBy(lastMessageAt, 'desc')` + `limit(50)` (composite index expectation).
- `notifications`: `orderBy(createdAt, 'desc')`; unread count uses `where(readAt, '==', null)`.
- assignments/applications queries combine `where(userId, ...)` + status filters (`==` / `in`).
- Jobs board public fetch often pulls all posts then filters in client (`JobsBoardService.getPublicPosts`), reducing strict index needs at the cost of larger reads.

---

## 5) SCREEN-BY-SCREEN DATA CONTRACTS

## 5.1 Dashboard (`/c1/workers/dashboard`)

### A. Firestore reads / queries
- `getDoc(users/{uid})`
- `getDocs(tenants/{tid}/assignments where userId == uid)`
- Optional `getDoc(tenants/{tid}/locations/{locationId})` for display name enrichment
- `useOnboarding(uid)` -> `onSnapshot(users/{uid})` for `onboarding.checklist`
- `UserApplicationsService.getUserApplications(uid, tid)`:
  - reads `users/{uid}` + per-app `tenants/{tid}/applications/{uid}_{jobId}`
- `JobsBoardService.getPublicPosts(tid)`:
  - reads `tenants/{tid}/job_postings`

### B. Firestore writes / updates
- None directly in dashboard.

### C. Cloud Function calls
- None directly.

### D. Derived worker state logic
- Priority content:
  1) next upcoming assignment
  2) if none, action-needed application (`offer_*`, `hired_pending`)
  3) recommended jobs (rank by nearest date -> higher pay -> fewer spots left)
  4) job readiness card when compliance incomplete.
- Uses improvement tasks from `getImprovementTasks`.

---

## 5.2 Find Work (`/c1/jobs-board`)

### A. Firestore reads / queries
- `JobsBoardService.getPublicPosts(tenantId, userGroups?)` -> `tenants/{tid}/job_postings`
- `getDoc(users/{uid})` for `applicationIds`, `applicationData`, user groups/certs.
- `getDocs(tenants/{tid}/applications where userId == uid)` for application statuses.
- `getDocs(tenants/{tid}/assignments where userId == uid)` for assignment state overlays.

### B. Firestore writes / updates
- Favorite/bookmark mechanisms (via hooks) may write user-facing preference docs (implementation split across favorites hooks).
- No major direct writes in base board listing flow.

### C. Cloud Function calls
- Apply action can route to quick apply utility (which itself may call callables; see apply section).

### D. Derived worker state logic
- Card/list hybrid filtering by query, location, type, favorites.
- Applied/hired badges use merged application + assignment state.
- Eligibility gate if missing critical profile fields before apply.

---

## 5.3 Job Detail (`/c1/jobs-board/:postId`)

### A. Firestore reads / queries
- Posting:
  - `getDoc(tenants/{tid}/job_postings/{postId})` or job-order indirection
- Existing application:
  - `getDocs(tenants/{tid}/applications where userId==uid and jobId==postId)`
  - Additional `where jobOrderId == posting.jobOrderId` fallback query paths
- Shift data:
  - `getDocs(tenants/{tid}/job_orders/{jobOrderId}/shifts)`
- User profile:
  - `getDoc(users/{uid})`
- Assignment context:
  - `getDoc(tenants/{tid}/assignments/{assignmentId})` + linked shift docs.

### B. Firestore writes / updates
- Withdraw application:
  - `updateDoc(tenants/{tid}/applications/{appId}, { status:'withdrawn', withdrawnAt, withdrawnBy })`
- Cancel single-day/multi-day apply date adjustments:
  - update `applyDate/applyDates`, possible withdraw.
- Requirement fix actions:
  - update application nested `data.requirements`
  - update user fields (`skills`, `languages`, `certifications`, ack fields, comfort flags).

### C. Cloud Function calls
- `respondToAssignment` callable:
  - request: `{ tenantId, assignmentId, decision: 'accept'|'decline' }`
  - response: `{ success: true, status: 'confirmed'|'declined' }`
- Quick apply path uses utility `submitQuickApplication` (see apply section), which may invoke `addUsersToGroups`.

### D. Derived worker state logic
- CTA/state depends on:
  - application status
  - shift-specific status map
  - assignment existence/decision state
  - readiness/eligibility summary and missing requirement checks.
- Accept/decline modifies both assignment + linked application via backend callable.

---

## 5.4 Apply Flow (`/apply/:tenantSlug/:jobId?`, `Wizard`)

### A. Firestore reads / queries
- Resolve tenant by slug or ID:
  - `getDocs(tenants where slug == tenantSlug)`
  - or `getDoc(tenants/{tenantId})`
- Load posting/job order and requirement context.
- Load existing user profile and existing application docs.
- For shift conflict checks:
  - read shifts in `job_orders/{jobOrderId}/shifts`.

### B. Firestore writes / updates
- Creates/merges application:
  - path: `tenants/{tenantId}/applications/{uid}_{jobId}`
  - sets `status:'submitted'`, timestamps, `data` payload, shift linkage fields, optional `jobScoreSummary`.
- Updates user:
  - tenant membership (`tenantIds`, `activeTenantId`)
  - profile fields from wizard
  - `applicationIds` array
  - `applicationData.{tenantId_jobId}` denormalized map.
- Draft status updates may occur in wizard-specific draft structures.

### C. Cloud Function calls
- `addUsersToGroups` callable (auto-add group memberships from posting):
  - req: `{ userId, groupIds: string[], tenantId }`
  - res: `{ success, message, groupIds }`
- Auth creation path for new worker:
  - `createUserWithEmailAndPassword` from Firebase Auth.

### D. Derived worker state logic
- Gig jobs require at least one selected shift.
- Date conflict checks prevent applying to multiple same-day shifts in constrained logic.
- Missing cert handling can route user to cert step.
- Existing applicant path may use quick apply instead of full wizard.

---

## 5.5 My Applications (`/c1/workers/applications`)

### A. Firestore reads / queries
- `getDoc(users/{uid})` for `applicationIds`, `applicationData`.
- For each app id:
  - `getDoc(tenants/{tid}/applications/{uid}_{jobId})`
  - fallback `getDoc(tenants/{tid}/job_postings/{jobId})` for display data.
- Offer/hired overlays from assignments:
  - proposed: `where status == 'proposed'`
  - hired: `where status in ['confirmed','active']`

### B. Firestore writes / updates
- Withdraw action:
  - `updateDoc(applicationDoc, { status:'withdrawn', withdrawnAt, withdrawnBy, updatedAt })`

### C. Cloud Function calls
- None directly.

### D. Derived worker state logic
- Status display merges application status + assignment offer/hired overlays.
- Withdraw availability typically for active under-review/applied states.

---

## 5.6 My Assignments (`/c1/workers/assignments`)

### A. Firestore reads / queries
- `getDocs(tenants/{tid}/assignments where userId == uid)`
- `getDoc(tenants/{tid}/locations/{locationId})` for display enrichment.

### B. Firestore writes / updates
- Cancel shift from worker UI:
  - `updateDoc(assignment, { status:'cancelled', updatedAt: serverTimestamp() })`

### C. Cloud Function calls
- None directly from this screen.

### D. Derived worker state logic
- Status mapping:
  - confirmed/active -> confirmed
  - cancelled/canceled/declined -> cancelled
  - completed -> completed
  - no-show -> no-show
  - else scheduled
- Upcoming vs past:
  - by terminal statuses + date cutoff (day-after-end-date logic).

---

## 5.7 Assignment Detail (`/c1/workers/assignments/:assignmentId`)

### A. Firestore reads / queries
- Reads tenant assignment doc; fallback/legacy variants.
- May resolve linked application, job order, shift, company, worksite, and recruiter user docs.

### B. Firestore writes / updates
- Typically read-focused screen (worker operations may happen via related routes/callables).

### C. Cloud Function calls
- Not primary on this screen; assignment decisions in current UX are surfaced via job detail flow.

### D. Derived worker state logic
- Builds operational trust-center style details:
  - location, schedule, instructions, support context.

---

## 5.8 Worker Profile (`/c1/workers/profile`)

### A. Firestore reads / queries
- `onSnapshot(users/{uid})` real-time profile data.

### B. Firestore writes / updates
- Work eligibility attestation:
  - updates `workEligibilityAttestation`, derived `workEligibility`, plus related fields.
- Additional section edits delegated to nested forms/components (worker profile accordions).
- Debounced writes in key flows.

### C. Cloud Function calls
- None required for baseline profile edits on this page.

### D. Derived worker state logic
- Readiness score from `scoreSummary.aiScore` (via `getUserScore`).
- Unlock prompts from `getReadinessPrompts`.
- Top improvements from `scoreSummary.explainability.nextActions`.

---

## 5.9 Job Readiness Feed (`/c1/workers/job-readiness`)

### A. Firestore reads / queries
- `onSnapshot(users/{uid})`
- `useOnboarding(uid)` for checklist.

### B. Firestore writes / updates
- Task completion writes selective fields:
  - `educationLevel`
  - `backgroundCheckComfort`
  - `updatedAt`
- Skip actions are local-only unless tied to profile edit flows.

### C. Cloud Function calls
- None.

### D. Derived worker state logic
- Tasks computed by `getImprovementTasks(userDoc, checklist)`:
  - priority: certs -> education -> background -> fallback (availability/work experience)
- Completion of all task cards shows confirmation state.

---

## 5.10 Documents (`/c1/workers/documents`)

### A. Firestore reads / queries
- `useOnboarding(uid)` -> `users/{uid}.onboarding.checklist`
- `useWorkerCredentials(uid)` -> `users/{uid}` (resume, cert count, attestation, screening orders)
- `useAssignmentFiles(uid)`:
  - reads `users/{uid}.applicationIds`
  - reads per-app `tenants/{tid}/applications/{uid}_{jobId}` -> `jobOrderId`
  - reads `tenants/{tid}/job_orders/{jobOrderId}.staffInstructions`

### B. Firestore writes / updates
- No direct upload writes from this screen in current implementation (mostly placeholder actions).

### C. Cloud Function calls
- None directly here.

### D. Derived worker state logic
- Compliance summary from checklist + attestation-derived work eligibility merge.
- Credentials summary cards built from user doc.
- Job files tab is read-only listing of recruiter-uploaded staff instruction files.

---

## 5.11 Notifications (`/c1/workers/notifications`)

### A. Firestore reads / queries
- `onSnapshot(users/{uid}/notifications orderBy createdAt desc limit 100)`

### B. Firestore writes / updates
- Read updates via callable (not direct client write):
  - mark one read
  - mark all read loops callable per notification.

### C. Cloud Function calls
- `markWorkerNotificationRead` via wrapper `markNotificationReadCallable(uid, notificationId)`.

### D. Derived worker state logic
- Filters: `all`, `unread`, categories (`assignments`, `applications`, `opportunities`, `profile`, `system`)
- Deep-link resolution:
  - `deepLink` preferred
  - fallback entity/thread/cta mapping via helper.

---

## 5.12 Inbox (`/c1/workers/inbox`)

### A. Firestore reads / queries
- Conversations list:
  - `onSnapshot(tenants/{tid}/conversations where participantUids array-contains uid orderBy lastMessageAt desc limit 50)`
- Messages:
  - `onSnapshot(tenants/{tid}/conversations/{conversationId}/messages orderBy createdAt asc limit 200)`

### B. Firestore writes / updates
- None direct; writes happen via callables.

### C. Cloud Function calls
- `sendConversationMessage({ tenantId, conversationId, text })` -> `{ messageId? }`
- `markConversationRead({ tenantId, conversationId })` -> `{}`

### D. Derived worker state logic
- Unread badge per conversation from `unreadByUid[uid]`.
- Mobile/desktop split view behavior.

---

## 5.13 Help & Support (`/c1/workers/support`)

### A. Firestore reads / queries
- None directly from page state (except auth/tenant context from AuthContext).

### B. Firestore writes / updates
- Indirect via backend:
  - `startAIThread` creates `tenants/{tenantId}/ai_chats/{threadId}`.
  - chat endpoint appends AI chat messages.

### C. Cloud Function calls / endpoints
- Callable: `startAIThread({ tenantId, context: 'worker_support' })` -> `{ threadId }`
- HTTP: `enhancedChatWithGPT` POST:
  - body `{ tenantId, userId, threadId, messages }`
  - response includes `reply`.

### D. Derived worker state logic
- Conversation maintained in local refs, sending last N messages.
- Escalation CTA routes to worker inbox.

---

## 6) WORKER STATUS / STATE MACHINE MAP

### Application statuses (visible/used in worker UI)
Observed values across `UserApplications`, `JobPostingDetail`, and backend:
- `submitted`
- `reviewed`
- `pending`
- `offer`, `offer_pending`, `offer_extended`
- `accepted`, `confirmed`, `hired`, `hired_pending`
- `waitlisted`
- `rejected`, `declined`
- `withdrawn`
- `expired`, `cancelled`
- `not accepted` (mapped in job detail labels)

Worker-visible transitions:
- Submit apply -> `submitted`
- Recruiter progression -> review/offer/waitlist/hired states
- Worker withdraw -> `withdrawn`
- Worker assignment decline path via `respondToAssignment` sets linked app -> `withdrawn`.
- Assignment accept path via `respondToAssignment` sets app -> `confirmed`.

UI effects:
- Apply vs status badges, withdraw availability, accept/decline buttons depending on assignment offer context.

### Assignment statuses
Observed:
- `proposed`
- `confirmed`
- `active`
- `declined`
- `cancelled` / `canceled`
- `completed`
- `no-show`

Transitions:
- Recruiter creates/offers -> `proposed`
- Worker accepts -> `confirmed` (callable)
- Worker declines -> assignment `declined` + app withdrawn
- Recruiter/system -> `active`, `completed`, `cancelled`

UI effects:
- Assignment cards/tabs split by status/date
- Offer badges in applications
- Notifications triggered on specific status changes.

### Readiness/compliance states
- Checklist item statuses: `missing`, `submitted`, `verified`, `expired`
- Display status derives `expiring_soon` from `expiresAt`.
- Overall compliance status from summary:
  - `compliant`, `expiring_soon`, `non_compliant`, `incomplete`

### Notification states
- Unread: `readAt == null`
- Read: `readAt` timestamp set by callable
- Categories: `assignments`, `applications`, `opportunities`, `profile`, `system`

### Certification/document states
- Certifications usually in `users/{uid}.certifications[]` (objects or strings historically)
- Documents/checklist status controlled by onboarding checklist + metadata fields.

---

## 7) REQUIREMENTS / JOB READINESS LOGIC

Current logic is distributed and partially denormalized.

### Readiness calculation / scoring
- Compliance summary: `src/utils/complianceSummary.ts` from onboarding checklist.
- Profile/readiness prompts:
  - `src/components/worker/profile/readinessPrompts.ts`
  - missing availability/certs/work experience/bio.
- Improvement card feed:
  - `src/utils/jobReadinessTasks.ts`
  - top 3 priority tasks.

### Missing requirements detection
- Generic profile missing checks:
  - `src/pages/UserProfile/utils/detectMissingItems.ts`
- Job-specific cert gap checks:
  - `src/utils/quickApplicationSubmit.ts#getMissingRequiredCertifications`
  - `src/utils/checkMissingCertifications.ts`

### Requirement types present
- Certifications / licenses
- Experience level
- Education level
- Language requirements
- Shift/availability compatibility
- Background/drug/eVerify comfort/acks
- Physical/uniform/PPE requirements (job posting fields)

### Requirement answer storage
- Application-level:
  - `tenants/{tid}/applications/{id}.data.requirements`
  - contains `acks`, `uploaded`, and screening-related nested fields.
- User-level:
  - some requirement answers mirrored to `users/{uid}` fields
  - e.g., `comfortablePassBackground`, `comfortablePassDrug`, `requirementsAcks`.

### What blocks apply vs informational
- Gig jobs block apply when no shift selected.
- Missing required certs can divert to wizard cert step.
- Shift conflict checks can block submission.
- Many readiness prompts are advisory/optimization rather than hard blockers.

### Category-specific logic
- Certifications:
  - compared using case-insensitive partial matching.
- Education:
  - normalized option set in readiness tasks.
- Background/drug/eVerify:
  - captured as comfort/ack responses.

---

## 8) NOTIFICATIONS / INBOX / PUSH

### Storage / model
- Persistent notifications: `users/{uid}/notifications`
- Push tokens: `users/{uid}/pushTokens`
- Inbox conversations: `tenants/{tid}/conversations` and nested `messages`
- Legacy worker threads also exist under `threads/*`.

### Unread/read state
- Notifications:
  - unread if `readAt == null`
  - `markWorkerNotificationRead` callable sets `readAt`.
- Conversations:
  - unread counts tracked in `unreadByUid[uid]`
  - reset via `markConversationRead`.

### Event types and categories
- Types include: `assignment`, `application`, `opportunity`, `profile_action`, etc.
- Categories used by UI filters.

### Deep link attachment and resolution
- Backend (`resolveDeepLink` in `unifiedWorkerNotifications.ts`) priority:
  - explicit `deepLink` -> `ctaUrl` -> `threadId` -> entity fallback.
- Client helper fallback:
  - `getNotificationUrl` / `getNotificationUrlAsync`.

### Push to inbox mapping
- Contract: every push should also create inbox notification doc.
- Trigger examples:
  - `onApplicationCreatedPush`
  - `onAssignmentUpdatedPush`
  - application status changes in `applicationSmsTriggers` via helper.

### Badge count logic
- App bar uses `useWorkerNotifications` unread count from snapshot.

---

## 9) FILES / UPLOADS / DOCUMENTS

### Profile photo
- Two paths in current web:
  - wizard uses `profile-pictures/{file}`
  - profile avatar uses `avatars/{uid}.jpg` style flows
- Flutter should standardize to one canonical path.

### Resume
- Stored metadata in `users/{uid}.resume`:
  - `storagePath`, `downloadUrl`, `fileName`, timestamps
- Upload/parse flow:
  - HTTP `parseResumeHttp` backend path used by `ResumeUpload`.
- Storage rule path:
  - `resumes/{userId}/{fileName}`.

### Certifications
- Storage:
  - `users/{userId}/certifications/{certSlug}/{fileName}`
- Metadata in user doc:
  - array entries with `name`, optional `fileUrl`, `expiresAt`, etc. (shape varies historically).

### Worker documents screen behavior
- Compliance tab: checklist statuses from onboarding + attestation merge.
- Credentials tab: summary and read-only indicators.
- Job Files tab: read-only links from job order staff instruction files.
- Upload actions in current screen are mostly placeholders.

### Storage assumptions from rules
- See `storage.rules`:
  - resumes, certifications, profile pictures, avatars, job order staff instructions.

---

## 10) HELP / SUPPORT / MESSAGING

### Current architecture
- Worker support page is AI-first but lightweight:
  - start thread via callable
  - send prompt to HTTP endpoint
  - display assistant reply
- Recruiter escalation goes to inbox/conversation system.

### Inbox vs chat
- Worker inbox = tenant-scoped canonical conversations.
- Legacy threads API still exists for older flows.
- Worker should primarily target conversations model.

### Recruiter messaging dependency
- Recruiters/internal can post into conversations, workers read/reply.
- SMS outbound callable exists for internal users (`sendSmsFromConversation`).

### Gaps
- AI support endpoint contract is thin and may evolve.
- No rich message typing/attachments surfaced in worker UI yet.

---

## 11) DEEP LINKS / NAVIGATION TARGETS

Worker-relevant deep links observed:
- `/c1/jobs-board`
- `/c1/jobs-board/:postId`
- `/c1/workers/applications`
- `/c1/workers/assignments`
- `/c1/workers/assignments/:assignmentId`
- `/c1/workers/job-readiness`
- `/c1/workers/inbox/:threadId_or_conversationId` (depending on notification source)
- `/c1/workers/notifications`

Data requirements per target:
- Job detail: `postId`
- Assignment detail: `assignmentId`
- Inbox thread/conversation: id must exist in whichever model produced the notification.

Service worker push click behavior:
- `public/firebase-messaging-sw.js` opens `deepLink` or `ctaUrl`.

---

## 12) RECOMMENDATION / DASHBOARD LOGIC

Current dashboard logic (`src/pages/c1/workers/dashboard.tsx`) is partially state-aware:
- Assignment section:
  - shows next upcoming assignment if present
  - otherwise may show application needing response
- Recommended jobs section:
  - top N jobs from ranked public posts
  - ranking: nearest upcoming shift -> pay rate -> urgency proxy (spots remaining)
- Job readiness section:
  - card appears when compliance/profile incomplete
  - payload from onboarding summary + improvement tasks

Card engine/components:
- Carousel rail: `WorkerDashboardCardRail`
- One-card deck: `CardDeck` / `WorkerCardDeck`
- Reusable row item for notifications: `WorkerNotificationListItem`

---

## 13) CLOUD FUNCTIONS / BACKEND INTEGRATIONS SUMMARY

Worker-relevant backend interactions.

### Callables used directly by worker UI
- `markWorkerNotificationRead`
  - from: notifications/app bar
  - req: `{ notificationId }` (uid from auth)
  - res: `{}`
- `sendConversationMessage`
  - from: inbox
  - req: `{ tenantId, conversationId, text }`
  - res: `{ messageId?: string }`
- `markConversationRead`
  - from: inbox
  - req: `{ tenantId, conversationId }`
  - res: `{}`
- `startAIThread`
  - from: support
  - req: `{ tenantId, context: 'worker_support' }`
  - res: `{ threadId }`
- `respondToAssignment`
  - from: job detail assignment accept/decline
  - req: `{ tenantId, assignmentId, decision: 'accept'|'decline' }`
  - res: `{ success: true, status: 'confirmed'|'declined' }`
- `addUsersToGroups`
  - from: apply/quick-apply auto-grouping
  - req: `{ userId, groupIds: string[], tenantId }`
  - res: `{ success, message, groupIds }`

### HTTP endpoints used by worker UI
- `enhancedChatWithGPT`
  - from support page
  - req body: `{ tenantId, userId, threadId, messages }`
  - response: `{ reply, ... }`
- `parseResumeHttp` (used in resume upload components)
  - req includes base64 file payload + user/tenant metadata
  - response includes parse success + parsed data/error.

### Trigger dependencies worker UX relies on
- `onApplicationCreatedPush`
  - creates worker notification/push when app created
- `onAssignmentUpdatedPush`
  - sends notification/push on assignment status changes
- `applicationSmsTriggers` (status changes)
  - calls `sendApplicationStatusChangedNotification` to create worker notification/push.

---

## 14) KNOWN RISKS / GAPS / UNSTABLE AREAS

- **Legacy + canonical messaging overlap:** `threads/*` and `tenants/*/conversations/*` coexist; Flutter should prefer one canonical model.
- **Token path mismatch risk:** frontend helper defines `deviceTokens` path in one place, but actual behavior uses `pushTokens`.
- **Upload UX gap:** worker documents screen has placeholder upload actions; Flutter should not mirror placeholder UX blindly.
- **Profile photo path inconsistency:** `profile-pictures/*` vs `avatars/*`.
- **Heavy denormalization assumptions:** many views depend on `users/{uid}.applicationIds` and `applicationData` cache; backend consistency is critical.
- **Status vocabulary drift:** multiple synonyms (`cancelled/canceled`, `accepted/confirmed/hired`, etc.) require normalization.
- **Route assumptions:** login redirect currently goes to `/{tenantSlug}/users/{uid}` for worker-level users; may not match intended Flutter IA.
- **Firestore rules complexity/legacy:** rules file has layered legacy and modern sections; Flutter should validate actual prod behavior before locking implementation.

---

## 15) FLUTTER BUILD RECOMMENDATIONS

### Query directly from Firestore (recommended)
- Worker notifications (`users/{uid}/notifications`)
- Conversations + messages (`tenants/{tid}/conversations/*`)
- Worker profile (`users/{uid}`)
- Assignments/applications/job postings with read-only list patterns

### Keep behind Cloud Functions
- Assignment accept/decline (`respondToAssignment`)
- Notification read marking (for consistency/audit if desired)
- AI support thread bootstrap and chat orchestration
- Auto-group assignment on apply (`addUsersToGroups`)
- Resume parsing ingestion

### Required Flutter architecture abstractions
- `AuthSessionRepository`: user, claims/security, active tenant resolution
- `WorkerRoutePolicy`: normalize level/null handling + worker-only entry gating
- `NotificationsRepository`: stream + mark read + deep link resolver
- `InboxRepository`: conversations + messages + unread handling
- `JobsRepository`: postings + detail + eligibility overlays
- `ApplicationsRepository`: submit/withdraw/status normalization
- `AssignmentsRepository`: upcoming/past segmentation + lifecycle normalization
- `ProfileReadinessRepository`: score/prompt/task model normalization
- `DocumentsRepository`: checklist + credentials + staff instruction files

### Normalize before Flutter build starts
- Canonical messaging model (choose conversations over legacy threads).
- Canonical profile photo and token paths.
- Canonical status enums and transition rules shared by web/mobile/backend.
- Canonical application identifier strategy (`${uid}_${jobId}` vs alternatives) and denormalized cache guarantees.
- Stabilize support endpoint contract and readiness requirement schema.

---

## Key Traceability File Paths

- Routing/guards:
  - `src/App.tsx`
  - `src/auth/WorkerRoute.tsx`
  - `src/components/ConditionalWorkerLayout.tsx`
  - `src/components/ConditionalJobsBoardLayout.tsx`
- Worker screens:
  - `src/pages/c1/workers/dashboard.tsx`
  - `src/pages/PublicJobsBoard.tsx`
  - `src/pages/JobPostingDetail.tsx`
  - `src/pages/ApplyWizardPage.tsx`
  - `src/components/apply/Wizard.tsx`
  - `src/pages/UserApplications.tsx`
  - `src/pages/c1/workers/assignments.tsx`
  - `src/pages/AssignmentDetails.tsx`
  - `src/pages/c1/workers/profile.tsx`
  - `src/pages/c1/workers/JobReadinessFeed.tsx`
  - `src/pages/c1/workers/documents.tsx`
  - `src/pages/c1/workers/inbox.tsx`
  - `src/pages/c1/workers/notifications.tsx`
  - `src/pages/c1/workers/support.tsx`
- Hooks/services/APIs:
  - `src/hooks/useWorkerNotifications.ts`
  - `src/hooks/useConversationsForUser.ts`
  - `src/hooks/useConversationMessages.ts`
  - `src/hooks/useOnboarding.ts`
  - `src/hooks/useAssignmentFiles.ts`
  - `src/hooks/useWorkerCredentials.ts`
  - `src/services/userApplicationsService.ts`
  - `src/services/recruiter/jobsBoardService.ts`
  - `src/api/workerNotificationsApi.ts`
  - `src/api/conversationsApi.ts`
- Backend functions:
  - `functions/src/messaging/unifiedWorkerNotifications.ts`
  - `functions/src/messaging/conversations/conversationsApi.ts`
  - `functions/src/triggers/onApplicationCreatedPush.ts`
  - `functions/src/triggers/onAssignmentUpdatedPush.ts`
  - `functions/src/applicationSmsTriggers.ts`
  - `functions/src/placementsApi.ts`
  - `functions/src/aiChat.ts`
  - `functions/src/index.ts` (exports and `addUsersToGroups`)
- Rules + web push:
  - `firestore.rules`
  - `storage.rules`
  - `public/firebase-messaging-sw.js`

---

## 16) APPENDIX A — FIELD-LEVEL FIRESTORE SCHEMA SNAPSHOTS

The following are implementation-oriented snapshots from observed read/write usage (not strict JSON schemas).

### 16.1 Worker user doc (`users/{uid}`)

```ts
{
  firstName: string
  lastName: string
  email: string
  phone: string
  preferredLanguage?: 'en' | 'es'
  avatar?: string

  // security/tenant context
  securityLevel?: string // worker scope handled as 0..4, null -> 0 in route logic
  activeTenantId?: string
  tenantId?: string
  tenantIds?: string[] | Record<string, { role?: string; securityLevel?: string; userGroupIds?: string[] }>

  // application denormalization (critical for worker UI performance)
  applicationIds?: string[] // e.g. ["<tenantId>_<jobId>"]
  applicationData?: Record<string, {
    applicationId: string
    jobId: string
    jobOrderId?: string | null
    jobTitle?: string | null
    postTitle?: string | null
    companyName?: string | null
    location?: string | null
    payRate?: number | null
    status?: string
    appliedAt?: Timestamp
    updatedAt?: Timestamp
    shiftIds?: string[]
    shiftAssignments?: Record<string, string>
  }>

  // profile/readiness
  certifications?: Array<string | { name?: string; fileUrl?: string; fileName?: string; uploadedAt?: any; expiresAt?: any }>
  skills?: string[]
  languages?: string[]
  educationLevel?: string
  backgroundCheckComfort?: boolean
  scoreSummary?: {
    aiScore?: number
    explainability?: { nextActions?: Array<{ label?: string; sectionId?: string }> }
  }

  // work eligibility
  workEligibilityAttestation?: {
    authorizedToWorkUS: boolean
    requireSponsorship?: boolean
    attestedAt: any
    sourceApplicationId?: string
    gender?: string
    veteranStatus?: string
    disabilityStatus?: string
  }
  workEligibility?: boolean // derived

  // onboarding/compliance
  onboarding?: {
    checklist?: Record<string, {
      status: 'missing' | 'submitted' | 'verified' | 'expired'
      provider: 'everee' | 'hrx'
      kind?: 'document' | 'attestation'
      expiresAt?: any
      nextExpiringAt?: any
      fileUrl?: string
      viewUrl?: string
      updatedAt?: any
      count?: number
    }>
  }

  // screening summaries surfaced in credentials tab
  backgroundCheckOrders?: any[]
  drugScreeningOrders?: any[]
  additionalScreeningOrders?: any[]
  eVerifyOrders?: any[]

  resume?: {
    fileName: string
    size: number
    sizeKB?: number
    timestamp: any
    storagePath: string
    downloadUrl?: string
  }
}
```

### 16.2 Worker notification doc (`users/{uid}/notifications/{notificationId}`)

```ts
{
  id: string
  uid: string
  tenantId: string
  type: 'assignment' | 'application' | 'document' | 'shift' | 'payroll' | 'general' | 'system' | 'opportunity' | 'profile_action' | 'support'
  category?: 'assignments' | 'applications' | 'opportunities' | 'profile' | 'system'
  title: string
  body: string
  severity?: 'info' | 'success' | 'warning' | 'error'
  createdAt: Timestamp
  readAt: Timestamp | null
  source?: 'system' | 'recruiter' | 'automation'
  channel?: 'push' | 'sms' | 'email' | 'web'
  deepLink?: string
  entityId?: string
  ctaLabel?: string
  ctaUrl?: string
  threadId?: string
  entity?: { kind: string; id: string }
  metadata?: Record<string, unknown>
  priority?: 'low' | 'normal' | 'high'
}
```

### 16.3 Application doc (`tenants/{tenantId}/applications/{uid}_{jobId}`)

```ts
{
  userId: string
  tenantId: string
  jobId: string
  jobOrderId?: string | null
  shiftId?: string
  shiftIds?: string[]
  shiftDate?: string
  shiftDates?: string[]
  shiftAssignments?: Record<string, string>

  status: string // see status normalization appendix
  appliedAt?: Timestamp
  submittedAt?: Timestamp
  updatedAt?: Timestamp

  confirmedAt?: Timestamp
  confirmedBy?: string
  withdrawnAt?: Timestamp
  withdrawnBy?: string

  companyName?: string
  location?: string
  payRate?: number

  jobScoreSummary?: {
    version?: string
    jobScore?: number
    eligible?: boolean
    missingLabels?: string[]
    buckets?: { missingRequired?: string[] }
    computedAt?: Timestamp
    writtenAt?: Timestamp
  }

  data?: {
    personal?: Record<string, any>
    eligibility?: Record<string, any>
    qualifications?: Record<string, any>
    preferences?: Record<string, any>
    requirements?: {
      acks?: Record<string, 'Yes' | 'No'>
      uploaded?: Record<string, any>
      additionalScreenings?: Record<string, 'Yes' | 'No'>
      backgroundScreeningComfort?: 'Yes' | 'No'
      drugScreeningComfort?: 'Yes' | 'No'
      eVerifyComfort?: 'Yes' | 'No'
    }
  }

  applicant?: {
    firstName?: string
    lastName?: string
    email?: string
    phone?: string
  }
}
```

### 16.4 Assignment doc (`tenants/{tenantId}/assignments/{assignmentId}`)

```ts
{
  tenantId: string
  userId?: string
  candidateId?: string
  applicationId?: string
  jobId?: string
  jobPostId?: string
  jobOrderId?: string
  shiftId?: string

  status: string // proposed|confirmed|active|declined|cancelled|completed|no-show...
  startDate?: any
  endDate?: any
  startTime?: string
  endTime?: string
  payRate?: number
  jobTitle?: string
  jobOrderName?: string
  companyName?: string

  locationId?: string
  worksiteId?: string
  worksiteName?: string
  locationNickname?: string
  worksiteAddress?: { street?: string; city?: string; state?: string; zip?: string }
  latitude?: number
  longitude?: number

  confirmedAt?: Timestamp
  confirmedBy?: string
  declinedAt?: Timestamp
  declinedBy?: string
  lastPushSentForStatus?: string
  lastPushSentAt?: Timestamp
  updatedAt?: Timestamp
}
```

### 16.5 Conversation + message docs

Conversation (`tenants/{tid}/conversations/{conversationId}`):

```ts
{
  tenantId: string
  type: 'recruiter' | 'support' | 'system' | 'broadcast_response'
  status: 'open' | 'closed' | 'pending_worker' | 'pending_internal'
  participantUids: string[]
  participants?: Array<{ uid: string; role: 'worker' | 'recruiter' | 'admin' | 'ai' | 'system'; displayName?: string }>
  assignedToUid: string | null
  topic?: { entityType: 'application' | 'assignment' | 'support' | 'general'; entityId?: string; label?: string }
  lastMessageAt: Timestamp
  lastMessagePreview: string
  unreadByUid: Record<string, number>
  createdAt: Timestamp
  createdByUid: string | 'system'
  channelEndpoints?: {
    sms?: { workerPhoneE164: string; twilioNumberE164: string }
    email?: { workerEmail: string; fromAddress?: string }
  }
}
```

Message (`tenants/{tid}/conversations/{conversationId}/messages/{messageId}`):

```ts
{
  tenantId: string
  conversationId: string
  createdAt: Timestamp
  sender: { uid?: string; role: 'worker' | 'recruiter' | 'admin' | 'ai' | 'system' }
  body: { text: string; html?: string }
  channel: 'in_app' | 'sms' | 'email' | 'push'
  direction?: 'inbound' | 'outbound'
  visibility: 'participants' | 'internal_only'
  provider?: { name: 'twilio' | 'fcm' | 'sendgrid' | 'gmail'; messageId?: string; status?: string; errorCode?: string; deliveredAt?: Timestamp }
  delivery?: { status: 'queued' | 'sent' | 'failed' | 'delivered' | 'undelivered'; sentAt?: Timestamp; failedAt?: Timestamp; deliveredAt?: Timestamp; errorCode?: string; errorMessage?: string }
}
```

---

## 17) APPENDIX B — CALLABLE/HTTP CONTRACTS (WORKER-RELEVANT)

### 17.1 `markWorkerNotificationRead` (callable)
- Backend: `functions/src/messaging/unifiedWorkerNotifications.ts`
- Auth: required
- Request (actual use): `{ notificationId: string }`
- Client wrapper currently passes `{ uid, notificationId }` but backend ignores `uid` and trusts `request.auth.uid`.
- Response: `{}`

### 17.2 `sendConversationMessage` (callable)
- Backend: `functions/src/messaging/conversations/conversationsApi.ts`
- Auth: required
- Request: `{ tenantId: string, conversationId: string, text: string }`
- Backend accepts `text` or fallback `body`.
- Response: `{ messageId: string }` (client type allows optional).

### 17.3 `markConversationRead` (callable)
- Request: `{ tenantId: string, conversationId: string }`
- Response: `{}`

### 17.4 `startAIThread` (callable)
- Backend: `functions/src/aiChat.ts`
- Request: `{ tenantId: string, context?: string }`
- Uses `request.auth.uid` or `request.data.userId`.
- Response: `{ threadId: string }`

### 17.5 `respondToAssignment` (callable)
- Backend: `functions/src/placementsApi.ts`
- Request: `{ tenantId: string, assignmentId: string, decision: 'accept'|'decline' }`
- Behavior:
  - accept -> assignment `status=confirmed`; linked application `status=confirmed`
  - decline -> assignment `status=declined`; linked application `status=withdrawn`
- Response: `{ success: true, status: 'confirmed' | 'declined' }`

### 17.6 `addUsersToGroups` (callable)
- Backend: `functions/src/index.ts`
- Request: `{ userId: string, groupIds: string[], tenantId: string }`
- Behavior:
  - appends user in `tenants/{tid}/userGroups/*` (`memberIds` + legacy `members`)
  - updates `users/{uid}.userGroupIds` and `users/{uid}.tenantIds.{tid}.userGroupIds`
- Response: `{ success: true, message: string, groupIds: string[] }`

### 17.7 `enhancedChatWithGPT` (HTTP)
- Invoked by worker support UI
- Request body: `{ tenantId: string, userId: string, threadId: string, messages: Array<{role:string,content:string}> }`
- Response shape used: `{ reply: string, ... }`
- Caveat: endpoint contract is not strongly typed in frontend.

### 17.8 `parseResumeHttp` (HTTP)
- Invoked by resume upload components.
- Request includes auth bearer token and payload:
  - `fileUrl` (base64 data URL), `fileName`, `fileSize`, `userId`, `tenantId`
- Response expected: `{ success: boolean, parsedData?: any, error?: string }`

---

## 18) APPENDIX C — QUERY CHEAT SHEET (FLUTTER REPOSITORY IMPLEMENTATION)

### 18.1 Notifications repository
- Stream:
  - path: `users/{uid}/notifications`
  - query: `orderBy('createdAt', desc).limit(100)`
  - mode: realtime listener
- Unread count:
  - derive from loaded stream OR query `where('readAt', '==', null)` (one-time).

### 18.2 Inbox repository
- Conversations stream:
  - path: `tenants/{tenantId}/conversations`
  - query: `where('participantUids', 'array-contains', uid).orderBy('lastMessageAt', desc).limit(50)`
  - mode: realtime listener
- Messages stream:
  - path: `tenants/{tenantId}/conversations/{conversationId}/messages`
  - query: `orderBy('createdAt', asc).limit(200)`
  - mode: realtime listener

### 18.3 Assignments repository
- List:
  - path: `tenants/{tenantId}/assignments`
  - query: `where('userId', '==', uid)`
  - mode: one-time fetch in current web, can be stream in Flutter if desired.

### 18.4 Applications repository
- Primary source:
  - `users/{uid}.applicationIds`
  - per-id fetch from `tenants/{tenantId}/applications/{uid}_{jobId}`
- Overlay queries for offer/hired:
  - assignments proposed: `where('userId','==',uid).where('status','==','proposed')`
  - assignments hired: `where('userId','==',uid).where('status','in',['confirmed','active'])`

### 18.5 Jobs repository
- Public jobs:
  - path: `tenants/{tenantId}/job_postings`
  - current service often fetches broad set, client-filters active/public/restricted visibility.
- Detail:
  - path: `tenants/{tenantId}/job_postings/{postId}`
  - fallback logic for job-order-linked posts.

---

## 19) APPENDIX D — STATUS NORMALIZATION TABLE FOR FLUTTER

### 19.1 Suggested normalized application statuses

| Raw status | Suggested normalized |
|---|---|
| `submitted` | `applied` |
| `reviewed`, `pending`, `screened`, `advanced`, `interview` | `under_review` |
| `offer`, `offer_pending`, `offer_extended` | `offer_sent` |
| `accepted`, `confirmed`, `hired`, `hired_pending` | `hired_or_confirmed` |
| `waitlisted` | `waitlisted` |
| `rejected`, `declined`, `not accepted` | `declined` |
| `withdrawn` | `withdrawn` |
| `expired`, `cancelled`, `canceled` | `expired_or_cancelled` |

### 19.2 Suggested normalized assignment statuses

| Raw status | Suggested normalized |
|---|---|
| `proposed` | `offer_pending` |
| `confirmed` | `confirmed` |
| `active` | `active` |
| `declined` | `declined` |
| `cancelled`, `canceled` | `cancelled` |
| `completed` | `completed` |
| `no-show` | `no_show` |

Use normalized enums in Flutter domain layer; retain raw string in DTO for compatibility.

---

## 20) APPENDIX E — PRE-FLUTTER BACKEND STABILIZATION CHECKLIST

- [ ] Canonicalize worker messaging model (conversation-only vs dual conversation/thread support).
- [ ] Canonicalize push token path (`pushTokens`) across all helpers/docs.
- [ ] Publish status enum contract (application + assignment) used by backend automations.
- [ ] Publish canonical application document contract (required/optional fields).
- [ ] Publish deep-link contract used in notification payloads.
- [ ] Decide canonical worker post-login destination route.
- [ ] Align profile image upload path strategy.
- [ ] Decide whether documents tab should support worker uploads in v1 Flutter or remain read-only.

---

## 21) APPENDIX F — FLUTTER V1 DO NOT BUILD YET

Intentionally exclude the following from Flutter worker v1 to avoid overbuilding and preserve parity with stable worker-critical workflows only.

- **Placeholder document uploads**
  - Any upload UI that does not persist to a canonical worker document contract (or is stub-only/placeholder in web) should be deferred.
  - If needed in v1, keep documents page read-only and route users to existing web/profile completion paths.

- **Legacy threads UI**
  - Do not build legacy thread-based messaging surfaces where both legacy `threads` and tenant conversations overlap.
  - Prefer one canonical model for v1: `tenants/{tenantId}/conversations` + `messages`.

- **Admin/recruiter-only flows**
  - Do not implement recruiter/admin capabilities in Flutter worker app (job authoring, assignment management controls, worker group management, admin dashboards).
  - Only include worker-consumable outcomes of those flows (status updates, notifications, assignment/job visibility).

- **Unfinished support/messaging features**
  - Defer partially implemented support entry points that do not yet have stable backend contracts or complete routing/deep-link behavior.
  - Keep v1 support scope to stable inbox + conversation read/send + notification deep links only.

- **Web-only or unstable worker extras to skip in v1**
  - Defer UI patterns that rely on unresolved backend contract decisions in Appendix E (status contract drift, deep-link payload drift, mixed token path assumptions).
  - Defer non-critical experiments/heuristics that are not required for core worker outcomes: find work, apply, assignment clarity, readiness actions, and trusted notifications.

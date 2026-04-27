# Phase 0 & Phase 1 — Technical Execution Checklist

Use this checklist to execute Phase 0 (stabilize) and Phase 1 (reusable worker card system) in order. Check off items as completed.

---

## PHASE 0 — Stabilize

### 0.1 Routes

- [x] **Document worker routes** in one place (e.g. `docs/WORKER_ROUTES.md` or in plan).
  - `/c1` — worker layout outlet
  - `/c1/workers` — outlet
  - `/c1/workers/dashboard` — WorkerDashboard
  - `/c1/workers/assignments` — C1WorkerAssignments
  - `/c1/workers/assignments/:assignmentId` — AssignmentDetails
  - `/c1/workers/applications` — UserApplications
  - `/c1/workers/profile` — WorkerProfile
  - `/c1/workers/job-readiness` — JobReadinessFeed
  - `/c1/workers/documents` — WorkerDocuments
  - `/c1/workers/support` — WorkerSupport
  - `/c1/workers/settings` — PrivacySettings
  - `/c1/workers/notifications` — C1WorkerNotifications
  - `/c1/workers/inbox` — C1WorkerInbox
  - `/c1/jobs-board` — PublicJobsBoard (Find Work)
  - `/c1/jobs-board/:postId` — JobPostingDetail
  - `/c1/jobs/:postId` — JobPostingDetail
- [ ] **Verify** no duplicate or broken routes; redirects (`/applications` → `/c1/workers/applications`) work.

### 0.2 State handling (loading / error / empty)

- [ ] **Dashboard** (`src/pages/c1/workers/dashboard.tsx`): loading spinner while data loads; error state if fetch fails; empty state when no cards.
- [ ] **Assignments** (`src/pages/c1/workers/assignments.tsx`): loading + empty (upcoming/past) via `WorkerAssignmentsEmptyState`.
- [ ] **Applications** (`src/pages/UserApplications.tsx`): loading + empty state when no applications.
- [ ] **Documents** (`src/pages/c1/workers/documents.tsx`): loading + `WorkerDocumentsEmptyState`.
- [ ] **Notifications** (`src/pages/c1/workers/notifications.tsx`): loading + “No notifications yet” empty state.
- [ ] **Inbox** (`src/pages/c1/workers/.../inbox`): loading + empty state.
- [ ] **Find Work** (`PublicJobsBoard`): loading + empty when no jobs.
- [ ] **Job detail** (`JobPostingDetail`): loading + 404 or error when job not found.

### 0.3 Mobile responsiveness

- [ ] **C1WorkerLayout** / worker pages: max-width container; no horizontal scroll on 320px–428px.
- [ ] **Touch targets**: buttons and list rows ≥ 44px where possible.
- [ ] **WorkerNav** (bottom or drawer): usable on small screens.
- [ ] **Dashboard card rail**: swipe/dots work; “Swipe to see more” hint (optional, already implemented with localStorage).

### 0.4 Translations

- [ ] **EN** (`public/i18n/locales/en.json`): keys for `nav.*`, `dashboard.*`, `assignments.*`, `applications.*`, `jobs.*`, `support.*`, `notifications.*`, `inbox.*`, `jobReadiness.*`, `documents.*`.
- [ ] **ES** (`public/i18n/locales/es.json`): same keys translated; `backToJobsBoard` → “Volver a Buscar trabajo” (Find Work).
- [ ] **Usage**: Worker nav, dashboard, assignments, applications, job detail, support, notifications use `useT()` / `t()` for all user-facing strings.

### 0.5 Notifications

- [ ] **Inbox** at `/c1/workers/notifications`: list loads from Firestore `users/{uid}/notifications`; real-time updates.
- [ ] **Filters**: All, Unread, Assignments, Applications, Opportunities, Profile, System.
- [ ] **Deep link**: tap notification → `getNotificationUrlAsync` or `deepLink` → navigate.
- [ ] **Unread**: badge in nav/app bar; mark read (single + “Mark all read”).
- [ ] **Push**: backend creates inbox doc per push (unifiedWorkerNotifications).

### 0.6 Empty states

- [ ] **Dashboard**: message when no assignments, applications, or recommendations (e.g. “Nothing right now” + CTA to Find Work).
- [ ] **Assignments**: `WorkerAssignmentsEmptyState` for “no upcoming” (CTA Find Work) and “no past”.
- [ ] **Applications**: empty state + CTA to Find Work.
- [ ] **Documents**: `WorkerDocumentsEmptyState`.
- [ ] **Notifications**: “No notifications yet” + short explanation.
- [ ] **Inbox** (conversations): empty state when no threads.

---

## PHASE 1 — Reusable Worker Card System & Card Deck Engine

### 1.1 WorkerCardShell

- [ ] **Exists** at `src/components/worker/cards/WorkerCardShell.tsx`.
- [ ] **API**: label, title, subtitle, metadata[], status, primaryCta, optional secondaryCta/tertiaryCta, theme `{ bg, contrast }`, onCardClick, minHeight, children.
- [ ] **Style**: rounded card, no image, consistent padding; works with pastel `CARD_THEMES` from dashboard/cards/types.

### 1.2 WorkerCardDeck (deck engine)

- [ ] **CardDeck** exists at `src/components/worker/cards/CardDeck.tsx`: one-card-at-a-time, Prev/Next/Expand, optional section progress.
- [ ] **WorkerDashboardCardRail** exists: carousel with arrows + dots, swipe hint.
- [ ] **Document** in plan or README: use CardDeck for “one at a time” (e.g. profile sections, assignment detail); use WorkerDashboardCardRail for dashboard “deck” of cards.
- [x] **Optional**: add `WorkerCardDeck` as a named export that wraps CardDeck with worker-specific defaults (e.g. aria labels, section label) so both names work.

### 1.3 JobCard

- [ ] **Definition**: Job posting summary card — title, pay, location, job type, primary CTA (e.g. View / Apply).
- [ ] **Implementation**: Use or adapt `JobRecommendationCard` from `dashboard/cards/` for “job” semantics; or add `JobCard.tsx` in `cards/` that uses WorkerCardShell + job props. Export as JobCard (and keep JobRecommendationCard as dashboard-specific if desired).

### 1.4 ApplicationCard

- [ ] **Exists** at `src/components/worker/dashboard/cards/ApplicationCard.tsx`.
- [ ] **Uses** WorkerCardShell or same pastel pattern (CARD_THEMES); single primary CTA; payload from `ApplicationCardPayload`.
- [ ] **Export** from dashboard/cards/index and from worker cards index if added.

### 1.5 AssignmentCard

- [ ] **Exists** at `src/components/worker/dashboard/cards/AssignmentCard.tsx`.
- [ ] **Uses** pastel theme; single primary CTA; payload from `AssignmentCardPayload`.
- [ ] **Export** from dashboard/cards/index.

### 1.6 ProfileImprovementCard

- [ ] **Definition**: Card for profile/readiness improvement (title, short body, progress, primary CTA).
- [ ] **Implementation**: Map from `ProfileCompletionCard` and/or `JobReadinessCard`; or add `ProfileImprovementCard.tsx` that uses WorkerCardShell and accepts a generic “improvement” payload. Export for use in dashboard and job-readiness.

### 1.7 WorkerQuickNav

- [ ] **Exists** as `WorkerDashboardQuickActions` at `src/components/worker/dashboard/WorkerDashboardQuickActions.tsx`: Find Work, Assignments, Applications, Inbox, Profile.
- [x] **Expose** as `WorkerQuickNav`: either export alias from dashboard or add `WorkerQuickNav.tsx` that re-exports/uses same ACTIONS and layout so both names are valid.

### 1.8 WorkerNotificationListItem

- [x] **Create** `src/components/worker/WorkerNotificationListItem.tsx`.
- [ ] **Props**: notification (WorkerNotification & { id }), onMarkRead(id), onClick(notification), formatTime function or use internal.
- [ ] **Renders**: icon by type, title (bold if unread), body preview (ellipsis), relative time, unread dot, optional mark-read button; clickable row → onClick.
- [x] **Use** in `src/pages/c1/workers/notifications.tsx` to replace inline ListItemButton (refactor to use WorkerNotificationListItem).

### 1.9 Worker cards index / exports

- [x] **Single entry point** for worker card system: e.g. `src/components/worker/cards/index.ts` (or `worker/index.ts`) that exports:
  - WorkerCardShell, CardDeck (and WorkerCardDeck if added),
  - JobCard / JobRecommendationCard, ApplicationCard, AssignmentCard, ProfileCompletionCard, JobReadinessCard, ProfileImprovementCard (if separate), GatewayCard,
  - CARD_THEMES, payload types.
- [x] **Document** in plan: “Worker card system is available from `@/components/worker/cards` (or chosen path).”

---

## Completion criteria

- **Phase 0:** All checklist items checked; worker app loads, routes work, loading/error/empty states and mobile layout are consistent; EN/ES coverage for worker-facing strings; notifications and empty states in place.
- **Phase 1:** All components exist and are exported; notifications page uses WorkerNotificationListItem; WorkerQuickNav is the canonical name for quick actions; card deck usage (CardDeck vs WorkerDashboardCardRail) is documented.

After Phase 1, the codebase is ready to rebuild the dashboard (Phase 2) and Find Work (Phase 3) using these primitives.

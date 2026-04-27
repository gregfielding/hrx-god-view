# Worker Web App Transformation: Staffing Portal → AI-Guided Worker Platform

**North Star:** Build a worker experience that helps workers find the right jobs faster, avoid assignment confusion, unlock more jobs through profile improvements, earn more over time, and trust the app as the source of truth.

**Constraints:** Preserve current routes and data structures where possible; web app first; mobile-safe layouts; reusable shared worker components; cleaner pastel visual system; do not overbuild—phase features in order.

---

## PHASE 0 — Stabilize

**Goal:** Solid foundation. Current worker routes, states, mobile responsiveness, translations, notifications, and empty states are stable and consistent.

**Deliverables:**
- Worker routes documented and stable (`/c1`, `/c1/workers/*`, `/c1/jobs-board`, `/c1/jobs-board/:postId`).
- Loading and error states on all worker pages.
- Empty states for dashboard, assignments, applications, documents, inbox.
- Mobile-responsive layouts (max-width, touch targets, no horizontal scroll).
- Spanish (and EN) translations for jobs board, job detail, assignments, dashboard, nav, support.
- Notifications: inbox + push + deepLink for 7 event types; category filters; unread badge.
- Pastel card system and single primary CTA per card.

**Status:** Largely done (notifications, dashboard cards, translations, Help & Support). Checklist in `PHASE_0_1_CHECKLIST.md`.

---

## PHASE 1 — Reusable Worker Card System & Card Deck Engine

**Goal:** One coherent set of worker UI primitives: shell, deck, and domain cards.

**Components:**
- **WorkerCardShell** — Shared card layout (label, title, subtitle, metadata, primary/optional secondary CTA). Exists; align with pastel theme when used.
- **WorkerCardDeck** — Swipe/arrows + dots; one-card-at-a-time or carousel. Implement as wrapper around existing `CardDeck` + `WorkerDashboardCardRail` patterns.
- **JobCard** — Job posting summary (title, pay, location, type, primary CTA). Map from existing `JobRecommendationCard` / job list cards.
- **ApplicationCard** — Application status (job title, company, status, primary CTA). Exists in dashboard/cards.
- **AssignmentCard** — Assignment summary (shift, date/time, location, primary CTA). Exists in dashboard/cards.
- **ProfileImprovementCard** — Profile/readiness prompt (title, body, progress, primary CTA). Map from `ProfileCompletionCard` / `JobReadinessCard`.
- **WorkerQuickNav** — Shortcut links (Find Work, Assignments, Applications, Inbox, Profile). Exists as `WorkerDashboardQuickActions`; expose as `WorkerQuickNav`.
- **WorkerNotificationListItem** — Single notification row (icon, title, body preview, time, unread, click → deepLink). Extract from notifications page for reuse (e.g. app bar dropdown).

**Deliverables:**
- All components in `src/components/worker/` (cards/, dashboard/cards/); clear exports via index.
- Worker card system import surface: `src/components/worker/cards/index.ts`.
- Card deck engine supports both “one at a time” (CardDeck) and “carousel” (WorkerDashboardCardRail) modes.
- Pastel theme (CARD_THEMES) used consistently; single primary CTA per card.

**Status:** WorkerCardShell, CardDeck, dashboard cards exist. Add WorkerNotificationListItem; unify exports; document.

---

## PHASE 2 — Dashboard: State-Aware Smart Home

**Goal:** Rebuild dashboard into a state-aware smart home with clear priority.

**Priority order:**
1. Active/current assignment
2. Upcoming assignment
3. Action-needed application
4. Recommended jobs
5. Profile improvement

**Deliverables:**
- One “hero” or top card for highest-priority state (e.g. active assignment or action-needed application).
- Sections for upcoming assignment, applications needing action, recommended jobs (curated), profile improvement.
- Uses Phase 1 cards and deck; mobile swipe + dots; consistent empty states.

---

## PHASE 3 — Find Work: Recommendation-First

**Goal:** Rebuild Find Work into a recommendation-first experience.

**Deliverables:**
- Recommendation cards first (e.g. “3 jobs for you”).
- 3 curated jobs + “See all jobs” gateway.
- Card/list hybrid view; interaction tracking (view, apply, skip, save) for future recommendation logic.

---

## PHASE 4 — Job Detail & Apply Flow

**Goal:** Cleaner job detail and apply flow.

**Deliverables:**
- Cleaner header (no duplicate metadata).
- Contextual requirements (show only what’s needed to apply).
- Smarter post-apply transition (e.g. to next recommendation or back to Find Work).

---

## PHASE 5 — Job Readiness: Unlock-More-Jobs Engine

**Goal:** Rebuild Job Readiness into an unlock-more-jobs engine.

**Deliverables:**
- Readiness score prominent.
- Top blockers and top 3 profile fixes.
- Guided improvement cards.
- Section overview + guided edit (not just forms).

---

## PHASE 6 — Assignments: Worker Trust Center

**Goal:** Assignments as the worker’s trust center for shift operations.

**Deliverables:**
- List for quick scan (upcoming/past).
- Detail page for operations (parking, check-in, support, instructions).
- Clear source-of-truth for time, location, and instructions.

---

## PHASE 7 — Inbox / Notification Center Finalization

**Goal:** All pushes persist; deep links; unread state; filters; quality.

**Deliverables:**
- Every push creates an inbox record (already in place).
- Deep links from notifications to the right screen.
- Unread state and badge (done).
- Filters: All, Assignments, Applications, Opportunities, Profile, System (done).
- Copy and grouping improvements.

---

## PHASE 8 — Help & Support

**Goal:** AI-first support with recruiter escalation.

**Deliverables:**
- AI support entry (“Ask a question”) with placeholder and API. Done.
- Common questions (short links or pre-filled prompts). Done.
- “Contact recruiter” → inbox/support thread. Done.

---

## PHASE 9 — Recommendation Logic v1

**Goal:** First version of job recommendation logic.

**Signals:**
- Location
- Schedule/availability
- Skills
- Certifications
- Interaction history (viewed, applied, skipped, saved)
- Urgency (e.g. start date, spots left)
- Readiness blockers (e.g. incomplete profile)

**Deliverables:**
- Backend or client logic that scores/ranks jobs for the worker.
- Feed or list ordered by recommendation score (or blended with recency).

---

## PHASE 10 — Earnings Optimization / Shift Stacking Foundation

**Goal:** Foundation for helping workers earn more (e.g. shift stacking, higher-paying matches).

**Deliverables:** TBD; likely analytics and UI hints (e.g. “You could add a shift on…”).

---

## PHASE 11 — Worker Reputation / Reliability Foundation

**Goal:** Foundation for worker reputation (show-up rate, reliability, ratings).

**Deliverables:** TBD; likely profile badges or recruiter-facing signals.

---

## PHASE 12 — Career Pathing / Growth Recommendations

**Goal:** Career pathing and growth recommendations (e.g. “Jobs that match your path”).

**Deliverables:** TBD; likely new card types and recommendation signals.

---

## Execution Order Summary

| Phase | Focus |
|-------|--------|
| 0 | Stabilize routes, states, mobile, i18n, notifications, empty states |
| 1 | Worker card system + deck engine + WorkerNotificationListItem |
| 2 | Dashboard smart home (priority order) |
| 3 | Find Work recommendation-first |
| 4 | Job detail & apply flow |
| 5 | Job Readiness unlock engine |
| 6 | Assignments trust center |
| 7 | Inbox/notifications finalization |
| 8 | Help & Support (done) |
| 9 | Recommendation logic v1 |
| 10 | Earnings / shift stacking |
| 11 | Reputation / reliability |
| 12 | Career pathing |

Technical execution checklists for **Phase 0** and **Phase 1** are in `PHASE_0_1_CHECKLIST.md`.

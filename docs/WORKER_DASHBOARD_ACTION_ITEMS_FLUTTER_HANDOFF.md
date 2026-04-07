# Worker dashboard “Action Items” — Flutter parity handoff

> **Canonical contract:** `docs/WORKER_DASHBOARD_ACTION_ITEMS_SPEC.md` — IDs, predicates, sort order, dismiss/snooze, empty state, and home vs readiness. This handoff is a shorter migration note; if anything disagrees, **follow the spec**.

## What changed (web)

- **Removed** from `/c1/workers/dashboard`:
  - “Your Job Readiness” summary card (`ReadinessSummaryCard`)
  - “Complete these next” checklist (`NextStepsChecklist` tied to home readiness model)
  - `ProfileNudgesSection` (improvement tasks from `getImprovementTasks`)
  - **SMS warning banner** on this page only (SMS is now the first **action item** when applicable)
- **Added** a single **“Action items”** section built by `buildWorkerDashboardActionItems()` in `src/utils/workerDashboardActionItems.ts`, rendered by `src/components/worker/home/WorkerDashboardActionItems.tsx`.
- **Welcome subtitle** no longer promises “complete quick steps” / implied progress; it uses `dashboard.actionItems.welcomeSubtitle`.

## Old vs new behavior

| Before | After |
|--------|--------|
| Progress %, “X of Y key items complete”, “almost done”, plus a separate checklist that could disagree | No aggregate progress bar or contradictory copy on the home dashboard |
| Resume missing could show incorrectly | Resume uses shared `userDocHasStoredResume()` aligned with profile hub |
| SMS as standalone `SmsWarningBanner` | SMS folded into action stack when relevant (same enable + 24h snooze semantics) |
| Profile nudges (cert/education/bg) on dashboard | Not shown on dashboard until re-validated for this model |

**Note:** `SmsWarningBanner` remains on **assignments** and **assignment details** pages unchanged.

## Action item rules (source of truth)

Implement the same ordering and gating in Flutter.

| `id` | Shown when | Primary action | Secondary | Dismiss / snooze persistence |
|------|------------|----------------|-----------|----------------------------|
| `sms_opt_in` | `smsSystemAvailable` and SMS effectively disabled; not snoozed | With phone: enable SMS on `users` doc. Without phone: navigate to personal details | “Not now” | **Snooze only:** `localStorage` key `worker_sms_warning_dismiss_until_{uid}` = now + 24h (same as legacy banner) |
| `confirm_work_authorization` | Not `userDocHasCompleteWorkAuthorization()` | Open job readiness flow at `work_authorization` step (web: dialog + `JobReadinessFeed`) | None | Not dismissible |
| `add_profile_photo` | No photo in `workerProfile.photoUrl`, `user.avatar`, or Auth avatar URL | Navigate to `/c1/workers/profile/personal-details` | “Dismiss” | **Firestore:** `users.{uid}.workerProfile.dashboard.dismissedActionItems.add_profile_photo` = `true` |
| `upload_resume` | Not `userDocHasStoredResume()` | Navigate to `/c1/workers/profile/resume` | “Dismiss” | **Firestore:** `…dismissedActionItems.upload_resume` = `true` |

**Sort order:** `sms_opt_in` (10) → `confirm_work_authorization` (20) → `add_profile_photo` (30) → `upload_resume` (40).

## Resume detection (critical for parity)

**Root cause of the web false-positive:** `homeReadinessModel.hasResume` only checked `resume.fileUrl` and `resumeUrl`. Real uploads use `resume.storagePath`, `resume.downloadUrl`, and often `resume.fileName` (see `UserProfile` type and worker profile hub).

**Shared helper:** `userDocHasStoredResume()` in `src/utils/workerProfilePrerequisites.ts` — same logic as worker profile hub (`profile.tsx`) and `WorkerProfileAccordions`.

Flutter should treat a resume as present if **any** of these are non-empty on the user document:

- `resume.downloadUrl`
- `resume.storagePath`
- `resume.fileName`
- `resume.fileUrl` (legacy)
- `resumeStoragePath`
- `resumeUrl`

## Work authorization (parity)

Use `userDocHasCompleteWorkAuthorization()` (same file as resume helper): requires **both** authorized-to-work **and** sponsorship intent, via `workEligibilityAttestation` **or** legacy `workEligibility` / `requireSponsorship` booleans — aligned with the worker profile hub.

## Empty state

When **zero** action items after filtering:

- Do **not** show the old readiness UI.
- Show a single card: “You’re all set” / “No action items right now” with optional links **View profile** and **Find work** (i18n: `dashboard.actionItems.*`, `nav.findWork`).

## Web-specific vs cross-platform

| Web-specific | Cross-platform |
|--------------|----------------|
| Routes (`/c1/workers/...`) | Equivalent deep links / screens |
| `JobReadinessFeed` dialog for work auth | Same step content or native flow |
| `localStorage` SMS snooze | Prefer **shared prefs** / secure storage with same key pattern and 24h TTL |
| Firestore dismissals path | **Same** `workerProfile.dashboard.dismissedActionItems.{id}` |

## Files reference (web)

- Builder: `src/utils/workerDashboardActionItems.ts`
- Dismiss writes: `src/utils/workerDashboardDismissals.ts`
- SMS context: `src/utils/workerSmsAlertsContext.ts` (also used by `SmsWarningBanner.tsx`)
- Prerequisites: `src/utils/workerProfilePrerequisites.ts`
- UI: `src/components/worker/home/WorkerDashboardActionItems.tsx`
- Page: `src/pages/c1/workers/dashboard.tsx`
- i18n: `public/i18n/locales/en.json` / `es.json` → `dashboard.actionItems.*`
- Home readiness model resume fix: `src/utils/homeReadinessModel.ts` (still used elsewhere, not on dashboard)

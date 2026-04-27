# Worker dashboard action items — canonical specification

**Status:** Normative contract for **web** and **Flutter** (and any other clients).  
**Implements on web:** `buildWorkerDashboardActionItems()` in `src/utils/workerDashboardActionItems.ts`, helpers in `src/utils/workerProfilePrerequisites.ts`, `src/utils/workerSmsAlertsContext.ts`, `src/utils/workerDashboardDismissals.ts`.

**Non-goals for this spec:** Visual design, exact copy keys, routing paths per platform (web routes are examples only).

---

## 1. Action item IDs

Fixed enum (extend only with product review and a spec revision):

| `id` | Purpose |
|------|---------|
| `sms_opt_in` | Encourage enabling text/SMS alerts for job and shift updates. |
| `confirm_work_authorization` | Require explicit work-authorization attestation before treating the worker as eligible for matching. |
| `add_profile_photo` | Encourage a visible profile photo for employer recognition. |
| `upload_resume` | Encourage uploading a resume for faster recruiter review (optimization, not a hard compliance gate on the dashboard). |

---

## 2. Vocabulary: complete / incomplete / missing / surfaced

The **home dashboard** only shows a **vertical list of cards**; there is **no** per-item “in progress” chip on the home list.

| Term | Meaning |
|------|---------|
| **Surfaced** | The action item **appears** in the dashboard list after applying eligibility, dismissal, and snooze rules. |
| **Not surfaced** | The item does **not** appear (requirement satisfied, dismissed, snoozed, or system unavailable). |
| **Complete (requirement satisfied)** | Logical predicate for that item is **true** → item must **not** be surfaced (except where dismissal hides an otherwise incomplete optional item — see dismiss rules). |
| **Incomplete (requirement not satisfied)** | Predicate is **false** → item **may** be surfaced if other rules allow. |
| **Missing (data)** | User document or specific fields are absent or unloaded; predicates are defined per item (usually treated as **incomplete**). |

**Note:** Optional items (`upload_resume`, `add_profile_photo`) can be **permanently dismissed** while still **incomplete**; after dismiss they are **not surfaced**.

---

## 3. Source of truth by item

**Primary document:** Firestore `users/{uid}` (the signed-in worker), unless noted.

### 3.1 `sms_opt_in`

**Fields read**

| Path | Use |
|------|-----|
| `smsOptIn` | If **exactly** `false`, SMS is treated as **disabled** for eligibility. Any other value (including `undefined`) is **not** treated as opted-out by this rule. |
| `smsBlockedSystem` | If `true` (e.g. STOP), SMS is **disabled**. |
| `smsSystemUnavailable` | If `true`, SMS product is **unavailable** for this user. |
| `notificationSettings.smsUnavailable` | If `true`, same as system unavailable. |
| `phone` | Non-empty after trim ⇒ **has phone** for primary-action branching. |

**SMS “effectively enabled” (complete for hiding the card)**

- `smsOptIn !== false` **and**
- `smsBlockedSystem !== true`

**Incomplete (card may show)**

- Negation of the above **and** system is available (below).

**System available**

- `smsSystemUnavailable !== true` **and** `notificationSettings.smsUnavailable !== true`

**Missing**

- No `users/{uid}` loaded: treat as **incomplete** for SMS enabled check; **has phone** false.

**Primary actions (same `id`, different behavior)**

1. **Has phone:** primary = **enable SMS** (server write).  
2. **No phone:** primary = **navigate to phone / personal-details** (platform-specific route).

**Enable SMS write (web reference — replicate fields in Flutter)**

Merge update on `users/{uid}`:

- `notificationSettings.smsNotifications` = `true`
- `smsOptIn` = `true`
- `smsBlockedSystem` = `false`
- `updatedAt` = server timestamp (or client convention)

**Fallback rules**

- None beyond the above; do not infer opt-in from other notification flags unless product extends this spec.

---

### 3.2 `confirm_work_authorization`

**Fields read**

| Path | Use |
|------|-----|
| `workEligibilityAttestation.authorizedToWorkUS` | Must be **boolean** if used for this branch. |
| `workEligibilityAttestation.requireSponsorship` | Must be **boolean** if used for this branch. |
| `workEligibility` (top-level legacy) | May satisfy “authorized to work” if **boolean**. |
| `requireSponsorship` (top-level legacy) | May satisfy “sponsorship answered” if **boolean**. |

**Complete (requirement satisfied)**

- (**`typeof workEligibilityAttestation.authorizedToWorkUS === 'boolean'`** OR **`typeof workEligibility === 'boolean'`**)  
  **AND**  
  (**`typeof workEligibilityAttestation.requireSponsorship === 'boolean'`** OR **`typeof requireSponsorship === 'boolean'`**)

**Incomplete**

- Negation of complete.

**Missing**

- `users/{uid}` not loaded: treat as **incomplete** (surface card if other rules allow).

**Fallback rules**

- Attestation object missing: rely on legacy top-level booleans only if present as booleans.
- Do **not** treat string values as answered unless product extends this spec.

---

### 3.3 `add_profile_photo`

**Fields read (first non-empty trimmed string wins)**

1. `workerProfile.photoUrl`
2. `avatar`
3. **Platform auth profile photo URL** (web: Firebase Auth `photoURL` passed into builder as `authAvatarUrl`; Flutter: equivalent user photo URL)

**Complete**

- After coalescing, trimmed photo URL length **> 0**.

**Incomplete**

- No non-empty URL from any source.

**Missing**

- User doc not loaded: only `authAvatarUrl` may still complete the item.

**Dismissal interaction**

- Firestore dismiss (below) can hide the card while photo still **incomplete**.

---

### 3.4 `upload_resume`

**Fields read**

All on `users/{uid}`:

| Path | Complete if truthy (non-empty where string) |
|------|---------------------------------------------|
| `resume.downloadUrl` | yes |
| `resume.fileName` | yes |
| `resume.storagePath` | yes |
| `resume.fileUrl` | yes (legacy) |
| `resumeStoragePath` | yes (top-level legacy) |
| `resumeUrl` | yes (top-level) |

**Complete**

- **Any** of the above passes (OR of conditions).

**Incomplete**

- None of the above.

**Missing**

- `resume` object absent ⇒ same as incomplete unless top-level fields set.

**Historical bug (web)**

- Earlier readiness logic treated only `resume.fileUrl` and `resumeUrl` as proof of resume. **Canonical rule is the OR list above** (aligns with worker profile hub and `UserProfile` resume shape).

**Dismissal interaction**

- Firestore dismiss can hide the card while resume still **incomplete**.

---

## 4. Priority rules (display order)

Sort by numeric **`sortOrder`** ascending. Stable tie-break: original insertion order.

| `sortOrder` | `id` |
|-------------|------|
| 10 | `sms_opt_in` |
| 20 | `confirm_work_authorization` |
| 30 | `add_profile_photo` |
| 40 | `upload_resume` |

**Filtering before display**

1. Evaluate each item’s **surface** predicate (sections 3 + 5).  
2. Remove items hidden by **Firestore dismiss** (photo, resume only).  
3. Remove `sms_opt_in` if **snooze** active (section 5).  
4. Sort by `sortOrder`.

---

## 5. Dismiss rules

| `id` | Dismissible? | Secondary action | Persistence | Storage key / path |
|------|----------------|------------------|-------------|---------------------|
| `sms_opt_in` | No permanent dismiss | **“Not now”** = snooze | **Local only** | Key: `worker_sms_warning_dismiss_until_{uid}` — value: epoch ms = `now + 24h` (86400000 ms). While `Date.now() < value`, do **not** surface `sms_opt_in`. |
| `confirm_work_authorization` | No | None | — | — |
| `add_profile_photo` | Yes | **Dismiss** | **Server** | `users/{uid}.workerProfile.dashboard.dismissedActionItems.add_profile_photo` = `true` |
| `upload_resume` | Yes | **Dismiss** | **Server** | `users/{uid}.workerProfile.dashboard.dismissedActionItems.upload_resume` = `true` |

**Reading dismissals**

- Map `workerProfile.dashboard.dismissedActionItems` — treat key as dismissed if value is boolean `true` **or** string `"true"` (web parity).

**Writing dismissals**

- Merge set `workerProfile.dashboard.dismissedActionItems.{id}` = `true` plus `updatedAt` per app conventions.

**Re-surfacing**

- Optional items: only if product clears the dismiss flag or defines a campaign reset (out of scope unless documented).  
- `sms_opt_in`: after snooze expires, surface again if still incomplete.  
- Required items: cannot dismiss; only **complete** hides them.

**Security**

- Clients may only write their **own** `users/{uid}` dismiss flags; Firestore rules must allow this merge.

---

## 6. Empty state

**When:** After section 5, the list has **zero** items.

**Required UX**

- **No** legacy “job readiness” progress bar, **no** “X of Y complete”, **no** “almost done” on the home dashboard.
- Show a **single** positive empty state, e.g.:
  - Title: equivalent of “You’re all set” / “No action items right now”
  - Optional secondary links: **View profile**, **Find work** (or platform routes).

**i18n (web reference):** `dashboard.actionItems.allSetTitle`, `allSetBody`, `viewProfile`; reuse or mirror in Flutter.

---

## 7. Home vs detailed readiness

| Surface | Scope |
|---------|--------|
| **Worker home / dashboard** | **Action items only** per this spec — no aggregate readiness %, no duplicate checklist of the same four predicates mixed with other nudges. |
| **Profile hub** (`/c1/workers/profile` on web) | **Detailed** section completion (personal details, resume, certifications, etc.) — separate UX; may show checkmarks per section. |
| **Job readiness feed / modal** (`JobReadinessFeed` on web) | **Step-by-step** flow (work authorization step, photo, resume, skills, etc.) — may still exist; **primary** for `confirm_work_authorization` on web opens this flow at `work_authorization`. Flutter should use an equivalent deep link or screen stack. |

**Completed items**

- **Do not** show completed action items as cards on the home list.
- Completion may still be visible on **profile** sections, **readiness feed** progress, or other product surfaces — not duplicated as dashboard cards.

**Removed from web dashboard (replaced by action items + empty state)**

- “Your Job Readiness” summary (`ReadinessSummaryCard`) — conflicting progress copy.
- “Complete these next” checklist tied to `buildHomeReadinessModel` home checklist — same.
- `ProfileNudgesSection` improvement tasks (cert/education/background) — **not** part of the canonical four IDs; do not surface on home until added to this spec.
- Standalone `SmsWarningBanner` **on dashboard only** — SMS is `sms_opt_in` card; banner may remain on **other** routes (e.g. assignments) per product.

**Recommended jobs carousel**

- Removed from web dashboard separately; not part of action-item spec.

---

## 8. Old vs new behavior (summary)

| Old | New |
|-----|-----|
| Multiple sections could imply “all done” while still listing missing steps | Home list is **only** unresolved action items + snooze/dismiss rules |
| Resume false positives (`fileUrl`-only checks) | Canonical OR of `storagePath`, `downloadUrl`, `fileName`, `fileUrl`, `resumeUrl`, `resumeStoragePath` |
| SMS banner separate from checklist | SMS is first-class `sms_opt_in` with snooze + enable |
| Optional nudges mixed with required without clear dismiss rules | Only four IDs; dismiss/snooze per section 5 |

---

## 9. Reference implementation (web)

| Concern | File |
|---------|------|
| Build list | `src/utils/workerDashboardActionItems.ts` |
| Resume / photo / work auth predicates | `src/utils/workerProfilePrerequisites.ts` |
| SMS predicates | `src/utils/workerSmsAlertsContext.ts` |
| Firestore dismiss read/write | `src/utils/workerDashboardDismissals.ts` |
| UI shell | `src/components/worker/home/WorkerDashboardActionItems.tsx` |
| Page | `src/pages/c1/workers/dashboard.tsx` |

**Flutter / other clients:** Implement predicates and persistence **byte-for-byte logically equivalent** to this document; routes and widgets are platform-specific.

---

## 10. Document history

- Introduced as canonical spec for cross-platform parity.  
- Related narrative handoff: `docs/WORKER_DASHBOARD_ACTION_ITEMS_FLUTTER_HANDOFF.md` (should defer to **this** file for rules).

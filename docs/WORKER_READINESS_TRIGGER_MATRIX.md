# Worker Readiness Trigger Matrix (Deterministic, v1)

## Scope
- Defines **when** `users/{uid}.workerProfile.readiness.homeSnapshot` should be recomputed.
- Defines **when/how** readiness prompts should surface in the worker experience.
- No AI nudges in this phase.

## Source of Truth
- Snapshot doc: `users/{uid}.workerProfile.readiness.homeSnapshot`
- Fallback: frontend deterministic compute path in `buildHomeReadinessModel()` when snapshot is missing.

## Current Minimal Implementation (C1-only, Snapshot Writes Enabled)
- Function: `syncC1WorkerHomeReadinessSnapshot`
- File: `functions/src/readiness/homeSnapshotTrigger.ts`
- Scope guard:
  - tenant must be C1 (`BCiP2bQ9CgVOCTfV6MhD`) via `activeTenantId` / `tenantId` / `tenantIds`
  - worker security scope only (`securityLevel <= 4` or null)
- Trigger type: Firestore `onDocumentWritten('users/{uid}')`
- Behavior: recomputes and writes `users/{uid}.workerProfile.readiness.homeSnapshot` when tracked readiness-domain signals change.

---

## 1) Snapshot Recompute Triggers (Domain Changes)

Recompute whenever any of these worker domains change:

1. **Profile photo**
   - Paths:
     - `workerProfile.photoUrl`
     - `avatar` (legacy)
2. **Work authorization / attestation**
   - Paths:
     - `workEligibilityAttestation.authorizedToWorkUS`
     - `workEligibilityAttestation.requireSponsorship`
     - `workEligibility` (legacy boolean)
3. **Availability / schedule preferences**
   - Paths:
     - `workerProfile.preferences.scheduleIntentOptions`
     - `workerProfile.preferences.desiredWorkType`
4. **Certifications**
   - Paths:
     - `workerProfile.credentials.certifications`
     - `certifications` (legacy)
5. **Skills**
   - Paths:
     - `workerProfile.skills`
     - `skills` (legacy)
6. **Resume**
   - Paths:
     - `resume.fileUrl`
     - `resumeUrl` (legacy)
7. **Industry/work targeting**
   - Paths:
     - `workerProfile.preferences.targetIndustries`
     - `workerProfile.preferences.desiredWorkType`

---

## 2) UI/Product Triggers (When to Surface Readiness)

### A) Login / Dashboard Load
- Trigger: worker opens dashboard.
- Outcome:
  - Read snapshot if present.
  - If missing/stale, use fallback compute for immediate UI.
  - Show readiness summary card and ordered checklist.
  - No forced modal open.

### B) Job View (Missing Requirement Context)
- Trigger: worker opens job detail and one or more mapped readiness items are missing.
- Outcome:
  - Recompute snapshot silently if stale.
  - Show inline prompt/banner with deterministic action:
    - e.g. "Add certifications to improve eligibility for this job."
  - CTA opens wizard at mapped `launchStep`.

### C) After Apply
- Trigger: worker submits application.
- Outcome:
  - Silent recompute.
  - If top missing item remains required/high-impact, show non-blocking nudge card on next dashboard load.

### D) After Offer / Before Confirm
- Trigger: worker has an accepted/offer state and still has critical missing readiness items.
- Outcome:
  - Silent recompute.
  - Show contextual reminder (non-blocking) with CTA to relevant launch step.
  - Do not block confirm in this phase unless separate product rule is added.

### E) After Profile Updates
- Trigger: worker saves profile fields in mapped readiness domains.
- Outcome:
  - Silent recompute.
  - Update checklist ordering/status immediately in UI (optimistic + refresh).
  - If completed item was top blocker, collapse prompt.

### F) After Wizard Completion / Step Completion
- Trigger: worker completes or skips readiness wizard steps.
- Outcome:
  - Silent recompute.
  - Refresh summary/checklist.
  - If all required/high-impact complete, suppress prompt surfaces.

---

## 3) Trigger Outcomes (Deterministic)

For each trigger, choose exactly one deterministic action set:

1. **Silent recompute only**
   - default for data mutations
2. **Recompute + reorder checklist**
   - profile/wizard updates
3. **Recompute + show prompt/banner/card**
   - dashboard load, contextual job/app screens
4. **Recompute + deep-link launch step**
   - when user taps prompt CTA
5. **No-op**
   - if relevant items already complete and ordering unchanged

---

## 4) Versioning + Determinism

- Snapshot stays versioned (`version: 1`).
- Trigger reason should be explicit (e.g. `profile_photo_updated`, `wizard_completed`) and persisted in metadata when backend writer is added.
- Item IDs, weights, priorities, and status transitions are fixed by versioned rules.
- No heuristic/AI ranking in v1.

---

## 5) Responsibility Split

### Backend (authoritative snapshot writer)
- Watch user doc writes.
- Detect relevant path changes.
- Recompute and write `homeSnapshot`.
- Include metadata:
  - `version`
  - `updatedAt`
  - `triggerReason`
  - `computedBy`

### Frontend (render + fallback)
- Read snapshot and render Home readiness modules.
- If snapshot absent, compute via local deterministic fallback.
- Handle prompt display by route/screen context + current checklist status.
- Never block worker flow unless explicit product rule says so.

---

## 6) Rollout Recommendation

1. Keep current fallback compute path enabled.
2. Add backend recompute writer for C1 tenant first.
3. Observe snapshot coverage and staleness metrics.
4. Once stable, switch Home to snapshot-first with fallback only as safety net.

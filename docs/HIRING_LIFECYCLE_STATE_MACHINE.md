# Hiring lifecycle state machine

This document locks the **application hiring lifecycle** (recruiting + decision) and how it relates to **onboarding phases** (post-hire compliance). It is the contract for product, recruiters, and engineering.

**Scope**

- **Hiring lifecycle** — where a candidate sits in the funnel for a specific application (job order / placement context).
- **Legacy `status`** — existing `APPLICATION_STATUSES` on application documents; kept for integrations, reporting, and gradual migration.
- **Tenant defaults** — `aiPrescreen` / `aiHiring` on tenant, overridable on job orders and groups (see `docs/AI_HIRING_POLICY_CONTAINER_ARCHITECTURE.md`).

---

## 1. Application `hiringLifecycle` schema

Stored on the application record (exact Firestore path follows your application model). This is the **source of truth** for funnel position; `status` is derived or dual-written for compatibility.

```ts
/** Top-level hiring funnel (one application = one lifecycle). */
type HiringLifecycleStage =
  | 'applied'        // intent registered; may not have finished prescreen
  | 'prescreen'      // AI / eligibility gating in progress
  | 'interview'      // structured interview or async assessment in progress
  | 'qualified'      // meets score/policy bar; not yet a human or policy decision
  | 'review'         // paused for recruiter or compliance review
  | 'waitlisted'     // viable but not moving forward while capacity / ranking sorts out
  | 'offer_pending'  // offer extended or pending worker response (optional if you collapse to hired)
  | 'hired'          // offer accepted / hire decision recorded; pre-onboarding or handoff
  | 'onboarding'     // active post-hire pipeline (parallel phases below)
  | 'ready'          // onboarding complete for this placement; ready to work (terminal success)
  | 'rejected'       // terminal: not moving forward (policy, fit, or withdrawal)
  | 'abandoned';     // terminal: dropped out (ghosted, expired, worker withdrew before hire)

type HiringLifecycle = {
  /** Canonical stage (see §5 for legacy mapping). */
  stage: HiringLifecycleStage;

  /** Finer-grained label within stage (e.g. interview channel, review reason). */
  subStatus?: string;

  /**
   * Structured reasons the record cannot advance without action.
   * Use stable codes from §7; optional human text in metadata elsewhere.
   */
  blockers?: HiringLifecycleBlocker[];

  /**
   * Single primary cue for the next actor (system, recruiter, or worker).
   * Prefer the starter set in §6.
   */
  nextAction?: HiringLifecycleNextAction;

  /** ISO timestamps for SLA / analytics. */
  stageEnteredAt?: Partial<Record<HiringLifecycleStage, string>>;
  updatedAt?: string;
};

type HiringLifecycleBlocker = {
  code: string;           // e.g. 'RECRUITER_REVIEW_REQUIRED'
  scope?: 'application' | 'onboarding';
  phase?: OnboardingPhaseKey; // when scope === 'onboarding'
  since?: string;         // ISO
};
```

**Notes**

- **Terminal stages**: `ready`, `rejected`, `abandoned` (and optionally `withdrawn` if you model worker withdraw separately from abandoned).
- **`qualified` vs `review`**: `qualified` means automation/scoring says “good enough”; `review` means a person or policy must confirm before an offer or hire step.
- **`hired` vs `onboarding`**: `hired` is the **decision** (or offer acceptance); `onboarding` is **execution** of payroll, I-9, E-Verify, background, drug, etc.

---

## 2. Onboarding phases schema

Onboarding runs **inside** `stage === 'onboarding'` (and may begin at `hired` boundary depending on product choice — document the chosen rule in one place). Phases are **parallel** tracks with independent status.

```ts
type OnboardingPhaseState = 'not_started' | 'pending' | 'in_review' | 'cleared' | 'failed' | 'waived';

type OnboardingPhaseKey =
  | 'payroll'
  | 'i9'
  | 'everify'
  | 'background'
  | 'drug'
  | 'credentials'   // optional umbrella for license / cert verification
  | 'other';

type OnboardingPhases = Partial<
  Record<
    OnboardingPhaseKey,
    {
      state: OnboardingPhaseState;
      /** Blocker codes specific to this phase (may duplicate hiringLifecycle.blockers for UX). */
      blockers?: HiringLifecycleBlocker[];
      updatedAt?: string;
    }
  >
>;
```

**Attachment**: persist either embedded on the application or on a linked `worker_onboarding` document — but the **keys and states** above should stay consistent for queries and UI.

---

## 3. Transitions map

Allowed moves are **directed**; invalid transitions should be rejected or normalized at write time.

| From → To | Typical trigger |
|-----------|-----------------|
| `applied` → `prescreen` | Application submitted; prescreen enabled |
| `prescreen` → `interview` | Eligibility passed |
| `prescreen` → `rejected` / `abandoned` | Hard fail or drop-off |
| `interview` → `qualified` | Score/policy pass |
| `interview` → `review` | Borderline / compliance flag |
| `interview` → `rejected` / `abandoned` | Fail or withdraw |
| `qualified` → `review` | Always-on human gate or risk signal |
| `qualified` → `waitlisted` | Capacity / ranking / stopWhenTargetReached |
| `qualified` → `offer_pending` | Auto or manual advance |
| `review` → `qualified` | Cleared to continue |
| `review` → `waitlisted` / `rejected` | Decision |
| `waitlisted` → `qualified` / `offer_pending` | Slot opens / recalled |
| `offer_pending` → `hired` | Offer accepted |
| `offer_pending` → `rejected` / `abandoned` | Decline or expire |
| `hired` → `onboarding` | Hire recorded; onboarding opened |
| `onboarding` → `ready` | All required phases cleared or waived |
| `onboarding` → `rejected` | Rare: hire rescinded / compliance fail policy |
| Any non-terminal → `abandoned` | Expiry, ghosting, worker withdraw (pre-hire) |
| Any non-terminal → `rejected` | Explicit reject |

**Automation hooks** (tenant / job order `aiHiring`):

- **Auto-advance** from `interview` → `qualified` when `autoAdvanceEnabled` and scores ≥ thresholds.
- **Hold / review** when `jobFitFailAction` or score gates say so.
- **Waitlist** when `stopWhenTargetReached` or capacity rules apply.

---

## 4. Dead zones

**Dead zones** are states or combinations where automation is intentionally weak, reporting is ambiguous, or dual-write to legacy is easy to get wrong. Treat them explicitly in UI and migrations.

| Zone | Risk | Mitigation |
|------|------|------------|
| `qualified` without `nextAction` | Recruiters do not know who to touch | Require `nextAction` when entering `qualified` or `review` |
| `hired` while onboarding phases empty | “Hired” in UI but nothing to do | On enter `hired` or `onboarding`, initialize phases from job/tenant requirements |
| Legacy `status: accepted` but lifecycle not `hired`/`onboarding`/`ready` | Dashboard split-brain | Backfill or rule: canonical lifecycle wins for new UI |
| `waitlisted` + auto-advance on | Thrashing | Cooldown / explicit “promote” event |
| `review` + multiple blockers | Noise | Primary blocker drives `nextAction`; others listed |
| Terminal `abandoned` vs legacy `withdrawn` | Messaging triggers misfire | Map `abandoned` → `withdrawn` for legacy consumers (see §5) |

---

## 5. Compatibility with legacy `status`

Canonical application statuses live in `shared/applicationStatus.ts` (`submitted`, `under_review`, `interview`, `offer_pending`, `accepted`, `rejected`, `withdrawn`, `waitlisted`).

**Recommended mapping: lifecycle → legacy `status` (read path for exports)**

| `hiringLifecycle.stage` | Legacy `status` |
|-------------------------|-----------------|
| `applied`, `prescreen` | `submitted` |
| `interview`, `qualified`, `review` | `under_review` (or `interview` if you want stricter parity with legacy “interview”) |
| `waitlisted` | `waitlisted` |
| `offer_pending` | `offer_pending` |
| `hired`, `onboarding`, `ready` | `accepted` |
| `rejected` | `rejected` |
| `abandoned` | `withdrawn` |

**Recommended mapping: legacy → lifecycle (ingest / backfill)**

| Legacy | Lifecycle |
|--------|-----------|
| `submitted`, `new`, `applied`, `pending` | `applied` or `prescreen` (use prescreen flag / data presence) |
| `screening`, `screened`, `advanced`, `under_review` | `interview` or `qualified` / `review` (use scores / flags) |
| `interview` | `interview` |
| `offer_pending` | `offer_pending` |
| `hired`, `selected`, `accepted` | `hired` or `onboarding` / `ready` (use onboarding doc presence) |
| `waitlisted` | `waitlisted` |
| `rejected` | `rejected` |
| `withdrawn` | `abandoned` or `rejected` (use reason) |

Dual-write during migration: update **both** `hiringLifecycle` and `status` from the same domain function to avoid drift.

---

## 6. Recommended `nextAction` values

Use a small enumerated set for dashboards, worker app, and notifications.

| Value | Meaning |
|-------|---------|
| `none` | No immediate action (healthy inactivity) |
| `worker_complete_prescreen` | Worker must finish questions / eligibility |
| `worker_schedule_interview` | Worker must book or start interview |
| `worker_complete_onboarding_step` | Worker action on a specific phase (pair with blocker phase) |
| `recruiter_review` | Human decision in `review` |
| `recruiter_decide_waitlist` | Promote or release from waitlist |
| `recruiter_confirm_hire` | Confirm hire details / start date |
| `compliance_resolve` | Compliance team (I-9 / E-Verify / screening) |
| `system_wait` | Waiting on vendor / batch job (background, drug) |
| `offer_follow_up` | Offer outstanding |

---

## 7. Example blocker codes

Prefix by domain for analytics; keep stable.

| Code | Typical `nextAction` |
|------|----------------------|
| `ELIGIBILITY_RESUME_MISSING` | `worker_complete_prescreen` |
| `ELIGIBILITY_LOCATION_REQUIRED` | `worker_complete_prescreen` |
| `SCORE_BELOW_MINIMUM` | `recruiter_review` or terminal reject |
| `JOB_FIT_GATE_FAILED` | `recruiter_review` |
| `AUTO_ADVANCE_CAP_REACHED` | `recruiter_review` or `recruiter_decide_waitlist` |
| `TARGET_HEADCOUNT_REACHED` | `recruiter_decide_waitlist` |
| `RECRUITER_REVIEW_REQUIRED` | `recruiter_review` |
| `COMPLIANCE_HOLD` | `compliance_resolve` |
| `PHASE_PAYROLL_PENDING` | `worker_complete_onboarding_step` |
| `PHASE_I9_PENDING` | `worker_complete_onboarding_step` |
| `PHASE_EVERIFY_PENDING` | `system_wait` or `compliance_resolve` |
| `PHASE_BACKGROUND_PENDING` | `system_wait` |
| `PHASE_DRUG_PENDING` | `system_wait` |
| `OFFER_EXPIRED` | `recruiter_review` or `abandoned` |
| `WORKER_WITHDRAWN` | terminal path to `abandoned` |

---

## 8. Related settings surfaces

| Surface | Affects |
|---------|---------|
| Tenant **AI Interview & Hiring** (`aiPrescreen`, `aiHiring`) | Gates, questions, auto-advance, waitlist / targets |
| Job order / group **hiring overrides** | Same keys, narrower scope |
| Onboarding library / compliance | Which phases appear and which are required |
| Messaging triggers (legacy `status`) | Keep dual-write until triggers migrate to lifecycle |

---

## 9. Changelog

| Date | Change |
|------|--------|
| 2026-04-02 | Initial locked design for `hiringLifecycle`, onboarding phases, transitions, legacy mapping, and blocker/nextAction vocabulary |

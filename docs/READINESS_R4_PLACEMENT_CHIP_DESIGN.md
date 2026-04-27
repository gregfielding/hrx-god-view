# Readiness Rebuild — R.4 Planning Notes

**Status:** **Superseded** by `docs/READINESS_R4_HANDOFF.md` (2026-04-26 — R.4 implemented and in review). Kept here for the original UX spec and the open-question audit; where this doc and the handoff disagree, **the handoff wins** (it incorporates the R.1+R.2 ground-truth corrections that post-date this design note).

**Predecessor:** `docs/READINESS_R0_HANDOFF.md` (foundation, merged).
**Blocks (resolved):** R.1 (status field shapes + `severity` / `resolutionMethod`) and R.2 (willingness types + matchers) both landed before R.4. The "Dependencies" section below now reads as historical context.

**Successor:** **`docs/READINESS_R4_HANDOFF.md`** (active handoff — read this for current shape, schema, and surface wiring decisions).

---

## TL;DR

Greg supplied a detailed UI spec for the per-(worker, shift) Job Readiness chip on placement tiles. The spec is internally consistent and well-scoped. Three issues need resolution before this is coded:

1. **Existing aggregator collision.** `src/shared/buildAssignmentReadiness.ts` already produces a 4-state aggregate (`READY` / `READY_WITH_WARNINGS` / `BLOCKED` / `PENDING_INITIALIZATION`) that's persisted as `readinessSnapshotV1` and consumed by placement tiles via `readinessSnapByAssignmentId`. The R.4 chip is a different shape with different semantics (3 states, different color thresholds, count-suffix on yellow). Decision needed: replace or coexist?
2. **Status-vocabulary mismatch.** Spec uses `complete_pass / complete_fail / satisfied / csa_waived / pending / needs_review`. Actual `AssignmentReadinessItemStatus` is `incomplete / in_progress / complete_pass / complete_fail / needs_review / expired / blocked / not_applicable`. Several spec terms (`satisfied`, `csa_waived`, `pending`) don't exist as statuses. R.1 needs to either add them or the R.4 mapping needs to be expressed in actual-status terms.
3. **Hard/soft requirement bucketing isn't fully specified.** R.4 says cert / license / AccuSource / E-Verify are hard. The spec lists `skill_match` / `education_match` / `language_match` (which currently exist as match-type items) under "soft" alongside the new willingness types from R.2 — but match-type and willingness-type items have different resolution methods. Bucketing rule needs to live on the requirement-type definition, not in the chip aggregator's switch statement.

Also, the spec depends on R.2 adding new requirement types (`physical_willingness`, `uniform_willingness`, `ppe_willingness`, `language_willingness`) that don't exist yet, and R.3 adding the `csa_waived` resolution method (which today is `csa-waived` per the planning notes' resolution model but not yet a status value).

---

## Greg's spec (captured verbatim — April 2026)

### Two chips side-by-side

**Chip 1 — Employee Readiness (existing)** — driven by Everee for entity-level onboarding (I-9, payroll, tax, handbook, policies). Aggregate state `Ready / Onboarding / Not Ready`. The current "C1 Select LLC — Onboarding" chip. **Don't rebuild;** re-skin to match Job Readiness chip if needed.

**Chip 2 — Job Readiness (new)** — aggregates JO-level readiness items. Three states:

| Item state | Category | Chip contribution |
|---|---|---|
| `complete_pass` / `satisfied` / `csa_waived` | any | green |
| `complete_fail` (BG fail, E-Verify FNC, hard blocker) | hard | red |
| pending — required cert / license / AccuSource | hard | red (worker can't do the job) |
| pending — willingness (physical, uniform, PPE, language, skill, edu) | soft | yellow |
| `needs_review` — BG needs CSA adjudication, E-Verify TNC | external CSA action | yellow |

**Aggregate rule:**
- Any red contributor → Red "Job Not Ready"
- Else any yellow contributor → Yellow "Job Ready (N pending)" where N = yellow-contributor count
- Else → Green "Job Ready"

**Conceptual line:** missing cert/license/screening = genuinely blocking (red). Missing self-attestation = "we just haven't asked yet" (soft yellow). BG pending CSA adjudication = CSA's task, not a hard worker block (yellow).

### Chip text + color

| State | Text | Color | Notes |
|---|---|---|---|
| Green | Job Ready | green | All items resolved, no blockers |
| Yellow | Job Ready (N pending) | yellow | N = count of yellow contributors |
| Red | Job Not Ready | red | At least one hard blocker |

### Click / hover popover

- For Job Readiness chip: list each requirement category with current resolution status + count (e.g., "AccuSource Background: needs review (1)", "Uniform attestation: pending"). Sort: red first, yellow second, green last. Click an item → drills into worker's Readiness tab (R.7) filtered to that item.
- For Employee Readiness chip: existing Everee breakdown.

### Component re-use across R.4 / R.7 / R.8

Same chip component on:
- Placement tiles (R.4 — many small chips at scale)
- Worker view header (R.7 — large prominent chip)
- CSA cross-worker matrix (R.8 — column header per worker)

Build once with size variants (`sm` for tile, `lg` for worker header, `inline` for matrix). Aggregate computation in a single shared helper.

### Edge cases (Greg's list)

- **No items seeded yet:** show Yellow "Job Ready (computing…)" or spinner. Don't show green by accident.
- **Items expired** (R.10 365-day BG expiry fires): contributes red; worker no longer cleared.
- **Worker waived from soft requirement by CSA** (`csa_waived`): contributes green, same as satisfied. Waive note visible in popover.
- **Worker has zero items** (orphan placement, JO requirements changed but readiness wasn't re-seeded): show Red "Job Not Ready" with reason "Readiness not yet computed for this assignment" — surfaces a CSA action.

### Implementation note from Greg

```ts
type ReadinessChipState = 'green' | 'yellow' | 'red' | 'computing';

interface JobReadinessChipData {
  state: ReadinessChipState;
  text: string;             // 'Job Ready' | 'Job Ready (3 pending)' | 'Job Not Ready'
  pendingCount: number;     // yellow-contributor count (for the suffix)
  blockerCount: number;     // red-contributor count
  contributors: Array<{
    requirementType: string;
    requirementDisplay: string;
    contribution: 'green' | 'yellow' | 'red';
    detail: string;         // for popover; e.g. 'needs CSA adjudication' or 'pending'
  }>;
}

function computeJobReadinessChip(items: AssignmentReadinessItem[]): JobReadinessChipData;
```

Pure function, easy to unit-test. UI components consume the result and render at their size variant.

---

## What already exists (audit during R.4 design review)

### `AssignmentReadinessItem` (the input)

- Defined at `shared/assignmentReadinessItemV1.ts` (re-exported via `src/types/`).
- Persisted at `tenants/{tid}/assignmentReadinessItems/{itemId}` with deterministic ID.
- 14 requirement types today: `background_check / drug_screen / e_verify / required_certification / cert_match / license_match / skill_match / education_match / language_match / screening_package_match / orientation / ppe_acknowledgement / safety_briefing / shift_confirmation / custom`.
- 8 status values today: `incomplete / in_progress / complete_pass / complete_fail / needs_review / expired / blocked / not_applicable` (+ deprecated `complete`).
- Phase B matchers (cert/license/skill/edu/language/screening) seed and update these items.
- Phase C added `expiresAtMs` for license/screening/cert expiry tracking.

### Existing aggregate readiness on placement tiles — IMPORTANT COLLISION

`src/shared/buildAssignmentReadiness.ts` already aggregates an assignment's readiness into a snapshot. **This is what placement tiles read today** via `readinessSnapByAssignmentId` in `PlacementsTab.tsx:813`. It's NOT what R.4 wants:

| Aspect | Existing `buildAssignmentReadiness` | R.4 chip spec |
|---|---|---|
| Output state | `READY / READY_WITH_WARNINGS / BLOCKED / PENDING_INITIALIZATION` | `green / yellow / red / computing` |
| Input shape | Flat: `user.workAuthorization`, `employment.i9Complete`, `screening.backgroundComplete`, `certifications[]` | `AssignmentReadinessItem[]` |
| Semantics | Mixes employee-readiness (I-9, payroll) AND job-readiness (BG, certs) into one aggregate | Pure job-readiness; employee-readiness is a separate chip |
| Persistence | `readinessSnapshotV1` doc on assignment | None proposed — chip computed on read |
| Hard/soft distinction | Yes via `severity: 'hard_block' | 'warning'` per requirement | Yes via requirement-type bucket |

**Decision needed (spec author = Greg):**
- (a) **Replace.** Migrate placement tiles + `readinessSnapshotV1` to consume the new R.4 aggregator. `buildAssignmentReadiness` becomes the R.4 helper; existing snapshot model is rewritten or deprecated.
- (b) **Coexist.** R.4 chip is a NEW component with a NEW aggregator that operates only on `AssignmentReadinessItem[]`. The existing snapshot keeps existing consumers (Flutter app, `assignmentReadinessV1`). Two parallel readiness states on each assignment.
- (c) **Bridge.** R.4 aggregator becomes the single source of truth; the existing snapshot becomes a derived projection of it. Requires unifying the input shape — i.e. converting the flat `user/employment/screening` inputs into virtual `AssignmentReadinessItem`s OR rewriting the existing inputs as items.

I lean (c) long-term but (b) is cheapest for R.4 specifically. The existing snapshot has been live for a while and rewriting `buildAssignmentReadiness` risks regressions in Flutter consumers and `assignmentReadinessV1` (which is a different but related contract).

### Existing chip components

- `src/components/recruiter/WorkforceReadinessChip.tsx` — small/dot variants, but tied to `WorkerState` enum (separate concept: per-worker overall readiness in the Workforce tab, NOT per-(worker, shift)).
- `JobOrderHiringStatusSummary.tsx`, `UserGroupHiringSummaryCard.tsx`, `JobOrderHiringEffectivePolicyCard.tsx` — hiring-status surfaces, NOT readiness chips. Different domain.

The R.4 chip is a NEW component. Naming proposal: `JobReadinessChip.tsx` (parallel to `WorkforceReadinessChip.tsx`). Lives at `src/components/recruiter/readiness/JobReadinessChip.tsx`.

---

## Open questions (need answers before R.4 is buildable)

### Q1 — Existing `buildAssignmentReadiness` collision

Replace, coexist, or bridge? See decision sketch above. **Recommendation: coexist for R.4 (option b); revisit unification in a Phase-D ticket.**

### Q2 — Status vocabulary reconciliation

Greg's spec uses these statuses that don't exist today:
- `satisfied` — appears to be a synonym for `complete_pass`. **Resolution: use `complete_pass`.** Drop `satisfied` from the doc.
- `csa_waived` — does not exist as an `AssignmentReadinessItemStatus` today. R.3 adds CSA endpoints (`confirm / waive / markFailed`) but the actual status writes need to be specified. **Two options:**
  - (a) Add `csa_waived` as a new status value. Pro: explicit semantics. Con: schema migration for existing items + everywhere that switches on status.
  - (b) Keep status as `complete_pass` and add a new field `resolutionMethod: 'auto' | 'self_attest' | 'csa_confirmed' | 'csa_waived' | 'external'` (matches the planning notes' resolution model from `Readiness System Rebuild — Planning Notes` §"Resolution model"). Pro: keeps the status enum compact; provenance lives in its own field. Con: chip aggregator needs both `status` and `resolutionMethod` to make decisions.
  
  **Recommendation: (b).** Matches the locked I.1–I.3 audit terminology and avoids a status-enum migration.

- `pending` — Greg's spec uses `pending` for both "self-attestation not yet given" (soft) and "required cert not yet matched" (hard). Today's actual statuses for "not yet resolved" are `incomplete` (never started), `in_progress` (mid-flight, e.g. AccuSource ordered but no result), and `needs_review` (CSA action). **Recommendation: pending = `incomplete` OR `in_progress` for chip purposes.**

### Q3 — Hard vs soft requirement bucketing

The bucketing rule should live on the requirement-type definition, not in the chip aggregator's switch statement, so other surfaces (worker app, R.8 matrix) get the same answer. Proposed:

```ts
// shared/assignmentReadinessItemV1.ts (extension)
export const HARD_REQUIREMENT_TYPES: ReadonlySet<AssignmentReadinessRequirementType> = new Set([
  'background_check',
  'drug_screen',
  'e_verify',
  'cert_match',
  'license_match',
  'screening_package_match',
  'required_certification', // legacy
]);

export const SOFT_REQUIREMENT_TYPES: ReadonlySet<AssignmentReadinessRequirementType> = new Set([
  'skill_match',
  'education_match',
  'language_match',
  'ppe_acknowledgement',
  // R.2 additions:
  // 'physical_willingness',
  // 'uniform_willingness',
  // 'ppe_willingness',         // distinct from ppe_acknowledgement?
  // 'language_willingness',    // distinct from language_match?
]);

// orientation / safety_briefing / shift_confirmation / custom
// → not classified yet. Need spec input.
```

**Open:** are `skill_match` / `education_match` / `language_match` (existing match-type items) genuinely soft? Greg's spec lists them as soft. But they're auto-data-match resolutions — when missing, the worker doesn't have the skill/edu/language at all, which is potentially blocking depending on the JO. **Recommendation: make this configurable per-JO (`requirements.skill_match.severity: 'hard' | 'soft'`) with a soft default**, since most skill misses are coachable / can be worked around.

**Open:** `ppe_acknowledgement` (existing, shift-specific PPE confirmation) vs `ppe_willingness` (proposed R.2, willingness-from-application). Are these the same item type or two distinct items? Greg's planning notes treat PPE as one willingness category but the existing model has `ppe_acknowledgement` as a per-shift confirmation. R.2 spec needs to clarify.

**Open:** `orientation`, `safety_briefing`, `shift_confirmation`, `custom`, `required_certification` (legacy) are not in Greg's R.4 spec. What's their chip contribution?

### Q4 — "Computing" state detection

Spec says "no items seeded yet → Yellow 'Job Ready (computing…)'". Detection options:
- (a) Item count is zero AND assignment is recent (e.g. `createdAt < 5 minutes ago`). After 5 min, no items = orphan (red).
- (b) Read `assignment.readinessSeededAt` flag (would need to be stamped by the seeder).
- (c) Read `assignment.readinessV1.seedingState: 'pending' | 'seeded' | 'failed'`.

**Recommendation: (b).** Cheapest. Seeder stamps `readinessSeededAt: serverTimestamp()` after writing items. Chip reads: `if items.length === 0 && !assignment.readinessSeededAt → computing`. Stale orphan check: `if items.length === 0 && assignment.readinessSeededAt → red 'Readiness not yet computed for this assignment'`. (Yes, the message says "not yet computed" — the computing-but-zero-items case actually IS the orphan case if seeding finished and nothing was needed; but on a real shift you'd always have at least shift-level items. Worth confirming.)

### Q5 — Popover sort order / linking target

Spec says popover items are sorted: red first, yellow second, green last. Within a tier, sort order? Proposed: by requirement-type display order (predefined), then by item ID.

Spec says clicking an item drills into the worker's Readiness tab (R.7) filtered to that item. **Open:** the Readiness tab is R.7. Until R.7 is built, what's the click target? Proposed: deep-link to existing worker profile + scroll-to-tab-anchor; falls back to no-op until R.7 lands.

### Q6 — Snapshot persistence (or lack thereof)

Greg's helper signature is pure: `(items) → ChipData`. No persistence. **Implication:** every render of every placement tile recomputes the chip from items. For a shift with 100 worker pool entries × 10 items each = 1000 items computed per render. Cheap because items are already loaded for the placement matrix's other UI, but worth a note.

**Alternative:** persist a `readinessChipV1: ChipData` field on the `assignmentReadinessV1` doc, recomputed by the same triggers that update items. Saves render-time CPU; costs schema-keep-in-sync. **Recommendation: don't persist for R.4** — pure helper, recompute on render. Promote to persisted snapshot if perf becomes an issue.

---

## Dependencies (R.4 cannot ship until these land)

| Dep | What | Why R.4 needs it |
|---|---|---|
| **R.1** | Audit + add resolution-status fields on non-AccuSource/E-Verify item types | The chip's red/yellow/green mapping depends on stable resolution status across all 14 item types. Missing fields → chip can't compute. |
| **R.2** | Add new willingness requirement types (physical, uniform, PPE, languages) + matchers | The chip's soft-yellow contributors come from these types. Without them, the chip is missing half its signal. |
| **R.3** | Generalize CSA endpoints (confirm / waive / markFailed) for non-AccuSource items + the `csa_waived` resolution method | Greg's spec maps `csa_waived` to green. Until R.3, no item can carry that resolution. |
| **R.10** (parallel, not strictly blocking) | 365-day BG expiry enforcement | Spec edge case "Items expired → contributes red" relies on `expired` status being set by the daily reconciler. This already exists per Phase C work, but R.10 extends it to BG specifically. |

R.4's Cursor handoff spec should be drafted **after R.2 lands** (the willingness types are the trickiest dep), or **alongside R.1+R.2 in a combined PR sequence** (R.1 → R.2 → R.4 is the natural order; R.3 can ship in parallel with R.4).

---

## Proposed implementation outline (sketch — not yet a handoff spec)

### File layout

```
src/
  shared/
    jobReadinessChip/
      computeJobReadinessChip.ts       (pure helper)
      requirementCategorySeverity.ts   (HARD/SOFT bucketing rule + per-JO override)
      requirementDisplayLabels.ts      (display strings)
      __tests__/
        computeJobReadinessChip.test.ts
  components/
    recruiter/
      readiness/
        JobReadinessChip.tsx            (UI; size variants sm/lg/inline)
        JobReadinessChipPopover.tsx     (hover/click breakdown)
```

### Helper signature (refined from Greg's sketch)

```ts
import type { AssignmentReadinessItem } from '../../assignmentReadinessItemV1';

type ReadinessChipState = 'green' | 'yellow' | 'red' | 'computing';
type ChipContribution = 'green' | 'yellow' | 'red';

export interface JobReadinessChipContributor {
  itemId: string;
  requirementType: AssignmentReadinessRequirementType;
  requirementLabel: string;       // resolved display label (depends on Q5)
  contribution: ChipContribution;
  status: AssignmentReadinessItemStatus;
  resolutionMethod?: 'auto' | 'self_attest' | 'csa_confirmed' | 'csa_waived' | 'external';
  detail: string;                 // for popover
}

export interface JobReadinessChipData {
  state: ReadinessChipState;
  text: string;
  pendingCount: number;
  blockerCount: number;
  contributors: JobReadinessChipContributor[];
}

export interface ComputeJobReadinessChipArgs {
  items: AssignmentReadinessItem[];
  /** When false, return state='computing' regardless of items (per Q4). */
  readinessSeeded: boolean;
  /** Optional per-JO severity overrides for soft types (e.g. skill_match=hard). */
  severityOverrides?: Partial<Record<AssignmentReadinessRequirementType, 'hard' | 'soft'>>;
}

export function computeJobReadinessChip(args: ComputeJobReadinessChipArgs): JobReadinessChipData;
```

### UI integration points

1. **Placement tiles (R.4):** replace existing `PlacementTileReadinessIconRow` chip-row OR add a new chip alongside it. Decision pending Q1.
2. **Worker view header (R.7, future):** large variant.
3. **CSA cross-worker matrix (R.8, future):** inline variant.

### Tests

- Pure helper → trivially testable. ~30 cases:
  - Empty items + not seeded → computing
  - Empty items + seeded → red orphan
  - Single hard item complete_pass → green
  - Mix of pass + soft pending → yellow with N=count
  - Any complete_fail on hard → red
  - `csa_waived` resolution → green (regardless of status)
  - Severity override flips skill_match from soft to hard → red instead of yellow
  - Expired item → red

---

## Recommendation

**Defer the R.4 Cursor handoff spec until R.1 and R.2 are scoped.** R.4's helper signature, requirement-type bucketing, and status mapping all hinge on decisions made in R.1 (status fields) and R.2 (new willingness types). Drafting an R.4 handoff today would lock in answers to Q2/Q3 without seeing how R.1/R.2 specify them.

**Suggested next step:** draft the R.1+R.2 combined handoff spec (the parallel work of audit + new requirement types + matchers + new statuses/resolution-methods). R.4 lands as the third PR after those two.

If Greg wants to greenlight an R.4 spec earlier, the cheapest path is to (a) lock answers to Q1–Q5 in this doc, (b) declare R.4's helper an island that the R.1/R.2 PRs adapt to (rather than the other way around), and (c) accept that the chip ships in a "soft state" until the R.2 willingness types backfill the yellow contributors.

---

## Cross-references

- `Readiness System Rebuild — Planning Notes` (parent) — §"Resolution model" defines `auto-data-match / external-result / self-attest / csa-confirmed / csa-waived`.
- `docs/READINESS_R0_HANDOFF.md` — foundation; R.0a typed `workerAttestations`.
- `shared/assignmentReadinessItemV1.ts` — input type for the chip.
- `src/shared/buildAssignmentReadiness.ts` — existing aggregator (collision per Q1).
- `src/shared/readinessSnapshotV1.ts` — existing persisted snapshot.
- `src/components/recruiter/PlacementsTab.tsx:262` — `PlacementTileReadinessIconRow` (current placement-tile readiness UI; integration target).
- `src/components/recruiter/WorkforceReadinessChip.tsx` — existing chip (different scope: per-worker workforce state, not per-(worker, shift)).

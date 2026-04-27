# Readiness Rebuild — R.1 + R.2 (Item Resolution Foundation) Handoff Spec

**Status:** R.1 implemented (PR 1, merged). **R.2 implemented (PR 2, merged).** **R.4 implemented (PR 3, in review — see `READINESS_R4_HANDOFF.md`).**
**Predecessor:** `READINESS_R0_HANDOFF.md` (workerAttestations schema + sync trigger + backfill — merged).
**Successor:** `READINESS_R4_HANDOFF.md` (chip + aggregator bridge — landed) → `READINESS_R7_HANDOFF.md` (worker-view header wiring of the chip in `lg` + drill-in URL contract — landed) → `READINESS_R5_HANDOFF.md` (E-Verify TNC contestation flow + UI; adds `EmployeeReadinessItem.workerAction` marker — landed). Future PRs: R.6 (AccuSource adjudication CSA matrix UI), R.3 (generalize CSA action endpoints + mirror `severity` + `resolutionMethod` onto `EmployeeReadinessItem` — referenced by R.4 §D4 / D8 carry-overs), R.8 (CSA cross-worker matrix, `inline` chip size).

**PR sequence (locked):**

1. **R.1** — field shapes + audit + backfill, behaviorally a no-op. *Implemented + merged.*
2. **R.2** — willingness types + matchers. *Implemented + merged.*
3. **R.4** — chip aggregator + component. *Implemented (PR 3, in review). See `READINESS_R4_HANDOFF.md`.*

**R.4 outcome (cross-ref, 2026-04-26):**

- The "bridge approach" was honoured — `buildAssignmentReadiness` was extended additively with optional `assignmentReadinessItems` / `employeeReadinessItems` / `readinessSeeded` inputs and an optional `jobReadinessChip: JobReadinessChipData` output. No parallel aggregator was introduced. The persisted Firestore field name `readinessSnapshotV1` is preserved for back-compat with `PlacementsTab.tsx` and Flutter; the chip is an additive sub-field on the same document.
- Q-R1-3's two-collection split is now load-bearing: the snapshot loader (`hrxReadinessSnapshotLoadContext.ts`) reads BOTH `assignmentReadinessItems` AND `employeeReadinessItems` (filtered to the JOB-level subset — `background_check`, `drug_screen`, `e_verify`). A chip that read only the assignment side would have silently missed AccuSource / E-Verify status. Captured in `READINESS_R4_HANDOFF.md` §D3.R4.
- `ppe_acknowledgement` severity question (raised under D3.R1 above) was resolved to `'hard'` — implementation matches spec, with a clarifying comment on the seeder defaults table noting it's the per-shift acknowledgement (distinct from R.2's `ppe_willingness` self-attestation).

> **R.2 ground-truth corrections (2026-04-26)** discovered during code-grounding
> against `src/types/UserProfile.ts` and `src/components/apply/steps/RequirementsAcknowledgementStep.tsx`:
>
> - **Q-R2-2 resolved:** `AttestationWillingness = 'yes' | 'no' | 'maybe' | ''`
>   — empty string is the not-selected sentinel, NOT `'unknown'` as earlier
>   drafts of this doc claimed. The apply UI persists Title-Case strings
>   (`'Yes' | 'No' | 'Maybe'`); `normalizeWillingness` lowercases + trims
>   before mapping. `null` / `undefined` / unrecognized strings all collapse
>   to `null`, which the matcher maps to `'incomplete'` per D8.R2.
> - **Q-R2-4 resolved:** Several `JobOrder` requirement fields are typed
>   as `string` but persist as `string[]` in production (multi-select UIs).
>   Gates use `jobHasNonEmptyText` (accepts both shapes) and
>   `jobHasNonEmptyArray` (languages-only). Locked field map:
>   - `physical_willingness` ← `physicalRequirements` (str | str[])
>   - `ppe_willingness` ← `ppeRequirements` (str | str[]) — note: the actual
>     JO field is `ppeRequirements`, NOT `requiredPpe` as earlier drafts
>     suggested
>   - `language_willingness` ← `languagesRequired` (legacy str[]) OR
>     `languagesRequiredV2` (structured) — either populated triggers seeding
>   - `uniform_willingness` ← `dressCode` OR `uniformRequirements` (library
>     side) AND/OR `customUniformRequirements` (custom side); worse-of when
>     both gates active

> **Ops note (from greenlight, 2026-04-26):** the R.1 backfill callable ships
> deployable but **must not** be run with `dryRun: false` in production until
> the dry-run report is signed off. Audit script can run against staging
> anytime. Same safety pattern as R.0c.

R.4 design notes: `READINESS_R4_PLACEMENT_CHIP_DESIGN.md` (Q1/Q2/Q3 answers locked there too).

---

## TL;DR

R.1 lands the field shapes that R.2 (new willingness items) and R.4 (chip aggregator) both depend on. Two PRs:

| ID | Task | Effort | Touches |
|---|---|---|---|
| R.1 | Add `resolutionMethod` + `severity` fields; audit + backfill existing items; stamp matchers | 2–3 d | `shared/assignmentReadinessItemV1.ts`, `shared/seedAssignmentReadinessItems.ts`, `functions/src/readiness/jobRequirementMatcherHelpers.ts`, AccuSource/E-Verify readiness bridges, CSA action endpoints, JO requirement schemas, new backfill callable |
| R.2 | New willingness requirement types (physical / uniform / PPE / language) + matchers | 3–4 d | `shared/assignmentReadinessItemV1.ts` (enum), `shared/seedAssignmentReadinessItems.ts` (defaults), `shared/jobRequirementMatchers/` (4 new matchers), `functions/src/readiness/jobRequirementMatcherHelpers.ts` (integration), tests |

**Worker UI is still invisible.** R.1+R.2 only change item shape and add 4 new matchers. R.4 is what makes any of this user-visible.

---

## Decisions (locked from this conversation)

### D1.R1 — Status enum unchanged — LOCKED (Q2)

`AssignmentReadinessItemStatus` stays as the existing 9-value Firestore enum (`incomplete | in_progress | complete_pass | complete_fail | needs_review | expired | blocked | not_applicable | complete (legacy)`). No new statuses. R.1 does NOT touch the enum.

### D2.R1 — `resolutionMethod` is a new orthogonal axis — LOCKED (Q2)

New optional field on `AssignmentReadinessItem`:

```ts
resolutionMethod?: 'auto' | 'self_attest' | 'csa_confirmed' | 'csa_waived' | 'external' | null;
```

Semantics:

| Value | Set by | When |
|---|---|---|
| `'auto'` | Phase B matcher | Worker has matching record on profile (cert, license, skill, edu, lang, screening). |
| `'external'` | AccuSource webhook / E-Verify poll | Third-party result lands and is mapped onto a readiness item. |
| `'self_attest'` | R.2 willingness matcher OR R.9 worker profile edit | Worker answered the application or edited their profile. |
| `'csa_confirmed'` | CSA action endpoint (confirm / markPassed / markFailed) | Recruiter manually marked the item passed/failed. |
| `'csa_waived'` | CSA waive endpoint | Recruiter bypassed a soft requirement with a mandatory note. |
| `null` | seeder default for unresolved items | No resolution yet. Pairs with `status: 'incomplete' \| 'in_progress'`. |

Field is `null` (not absent) when intentionally unresolved — gives the chip aggregator a clean `null`-check.

### D3.R1 — `severity` is denormalized onto each item — LOCKED (Q3)

New required field on `AssignmentReadinessItem`:

```ts
severity: 'hard' | 'soft';
```

**Authoritative source:** the requirement on the JO (or override map; see D4.R1).
**Denormalization point:** seeder copies severity onto the item at seed time so the R.4 chip aggregator never needs to round-trip to the JO doc. Re-resolved during snapshot refresh if the JO requirement's severity changes.

**Type-level defaults (locked per Q3 table)**:

| Requirement type | Default severity | Notes |
|---|---|---|
| `background_check`, `drug_screen`, `screening_package_match` | `hard` | AccuSource — fail = job-blocking |
| `e_verify` | `hard` | FNC = job-blocking |
| `cert_match`, `required_certification` (legacy) | `hard` | Legal/safety vocabulary |
| `license_match` | `hard` | CDL etc. — required to do the job |
| `orientation`, `safety_briefing` | `hard` | OSHA-adjacent |
| `ppe_acknowledgement` | `hard` | Existing per-shift acknowledgement (distinct from R.2 `ppe_willingness`) |
| `skill_match`, `education_match`, `language_match` | `soft` | Some JOs have nice-to-haves; per-JO override flips to hard |
| `physical_willingness`, `uniform_willingness`, `ppe_willingness`, `language_willingness` (R.2) | `soft` | Self-attestations |
| `shift_confirmation` | `soft` | Worker hasn't confirmed yet — not a placement blocker |
| `custom` | NO default — must be explicitly set on the requirement | JO author's call |

### D4.R1 — Severity overrides live on the requirement instance — PROPOSED

**The hard part:** "the requirement instance" is a different shape per requirement type. Three categories:

**(a) Object-shaped requirement entries** — clean: just add `severity?: 'hard' | 'soft'` to the type. Affected:
- `RequiredLicenseV1` (`shared/licenseRecord.ts`)
- `RequiredLanguageV1` (`shared/languageProficiency.ts`)
- Certification requirement shapes (`shared/certifications/buildCertificationRequirementsFromJobOrder.ts` output)

**(b) String-array requirement entries** — `JobOrder.skillsRequired: string[]` is the only one. Two options:

- **Option (b.i)** — migrate the array to `Array<string | { skill: string; severity?: 'hard' | 'soft' }>`, normalize on read. Touches every read site.
- **Option (b.ii) — recommended** — leave `skillsRequired: string[]` untouched. Add a parallel optional map: `JobOrder.skillsRequiredSeverityOverrides?: Record<string, 'hard' | 'soft'>` keyed by the skill string. Seeder reads the override map; falls back to type default. Zero migration of existing string-array reads. JO author UI gets a per-skill toggle that just writes the map.

**(c) Singleton requirements** — `screeningPackageId`, `educationLevelRequiredV2`, plus the flag-based ones (`background_check`, `drug_screen`, `e_verify`, `orientation`, `safety_briefing`, `shift_confirmation`). At most one instance per JO. Per-JO override via:

```ts
JobOrder.requirementSeverityOverrides?: Partial<Record<AssignmentReadinessRequirementType, 'hard' | 'soft'>>;
```

Seeder reads `requirementSeverityOverrides[type] ?? <type default>`.

**Recommend:** (a) inline + (b.ii) parallel map + (c) override map. Three insertion points, no existing read-site migrations. JO authoring UI is a follow-on (R.1 doesn't ship UI; severity overrides will be writable via JO form in R.4 or a small follow-on; per the planning notes severity-config UI is part of the JO authoring flow).

### D5.R1 — Relationship to existing `blocking: boolean` — PROPOSED

`AssignmentReadinessItem.blocking: boolean` already exists. It gates worker confirmation (per ownership doc §9 #4): if any blocking item is incomplete when the worker tries to confirm, block the confirmation.

`severity` and `blocking` are **related but not synonymous**:

- `severity` is a STATIC property of the requirement → drives chip color (R.4).
- `blocking` is a DYNAMIC gate → drives the confirmation-time check.

For R.1, **derive `blocking` from `severity` at seed time** (`blocking = severity === 'hard'`) but keep `blocking` as its own field so future logic can diverge (e.g., a `severity: 'hard'` item with `status: 'complete_pass'` might still need `blocking: true` for some other gate).

Existing `DEFAULT_REQUIREMENT_DEFAULTS` table in `seedAssignmentReadinessItems.ts` keeps its `blocking` per-type default — just re-derive from severity for clarity. End state: identical behavior, additive field.

### D6.R1 — Backfill is a tenant-scoped admin callable — PROPOSED (mirrors R.0c)

Same shape as `backfillWorkerAttestationsCallable`:

- Auth gate: `securityLevel >= 7`.
- Args: `{ tenantId, dryRun?: boolean = true, limit?: number = 1000, pageToken?: string }`.
- Walks `tenants/{tid}/assignmentReadinessItems`. For each item, derives `severity` (type-default) and `resolutionMethod` (rules below). Patches with `{ merge: true }`.
- Returns the same report shape (counts, pagination cursor, sample diffs).

**`resolutionMethod` derivation rules** (in priority order — first match wins):

1. `requirementType ∈ {background_check, drug_screen, screening_package_match, e_verify}` → `'external'`.
2. Item has CSA action history (existing field — see audit task R.1.A) AND last action is "waive" → `'csa_waived'`.
3. Item has CSA action history AND last action is "confirm" / "markPassed" / "markFailed" → `'csa_confirmed'`.
4. `requirementType ∈ {cert_match, license_match, skill_match, education_match, language_match}` AND `status ∈ {complete_pass, complete_fail, needs_review}` → `'auto'`.
5. Else → `null`.

`severity` derivation: type-default lookup table only. Per-instance overrides are a forward-only concern; we don't try to look back at the JO doc.

### D7.R2 — Willingness types are 4 net-new requirement types — PROPOSED (Q-flag)

The user message asks "or whatever naming aligns with existing convention — flag if a different shape works better."

Recommended additions to `AssignmentReadinessRequirementType`:

- `physical_willingness` — reads `workerAttestations.physicalRequirementWillingness`.
- `uniform_willingness` — reads `workerAttestations.uniformRequirementWillingness` AND `customUniformRequirementWillingness` (whichever applies to the JO; matcher takes the worse answer if both apply).
- `ppe_willingness` — reads `workerAttestations.requiredPpeWillingness`. Distinct from existing `ppe_acknowledgement` (per-shift, severity hard) — the willingness matches against the worker's standing answer; the acknowledgement is "did you wear it on this shift."
- `language_willingness` — reads `workerAttestations.languageRequirementWillingness`. Distinct from existing `language_match` (proficiency check) — willingness is "are you comfortable in this JO's working language?"

**Naming flag:** existing convention uses `*_match` for auto-data-match types and bare nouns for direct items. `*_willingness` is a new third category but reads cleanly. Alternative `*_attestation` would collide with `workerAttestations` reads in code. **Recommend `*_willingness` — flagged for review.**

### D8.R2 — Mapping: Yes / Maybe / No → status + resolutionMethod — LOCKED (per user)

| Worker answer | `status` | `resolutionMethod` | Notes |
|---|---|---|---|
| Yes | `complete_pass` | `'self_attest'` | |
| Maybe | `needs_review` | `'self_attest'` | CSA can adjudicate via existing endpoints (R.3 territory). |
| No | `complete_fail` | `'self_attest'` | Severity defaults soft → contributes yellow to chip; CSA can override to red via `severity` override on the JO. |
| (missing / null) | `incomplete` | `null` | Application not yet submitted, or field never filled. |

### D9.R2 — Seed willingness items only when the JO declares a corresponding requirement — LOCKED (Q-R2-4 grounded)

**Don't blanket-seed all four on every assignment.** Each willingness item seeds only when the JO has a corresponding requirement field populated. Field names + shapes locked against runtime data after Q-R2-4 grounding (multi-select UIs persist `string[]` even where types say `string`):

| New item type | JO field gate (LOCKED) | Helper used | Notes |
|---|---|---|---|
| `physical_willingness` | `physicalRequirements` populated | `jobHasNonEmptyText` (str \| str[]) | |
| `ppe_willingness` | `ppeRequirements` populated | `jobHasNonEmptyText` (str \| str[]) | Field is `ppeRequirements`, NOT `requiredPpe` — earlier drafts of this doc were wrong. |
| `language_willingness` | `languagesRequired` (legacy) OR `languagesRequiredV2` populated | `jobHasNonEmptyArray` (either) | Co-seeds alongside `language_match` whenever `language_match` would seed. Q-R2-3 closed in favor of always co-seeding. |
| `uniform_willingness` | `dressCode` OR `uniformRequirements` (library) AND/OR `customUniformRequirements` (custom) | `jobHasNonEmptyText` per side | Worse-of (`worseOfWillingness`) when both library and custom gates active; the matcher itself ignores the side(s) the helper marked inactive. |

### D10.R2 — Default severity on willingness items: `'soft'` — LOCKED (per user)

All 4 default to `severity: 'soft'`. Per-JO override via `JobOrder.requirementSeverityOverrides[<type>]` (see D4.R1.c).

### D11.R1 — Bridge approach for R.4 readiness — DEFERRED to R.4 PR

Only logged here so R.1+R.2 field shapes align. R.4 will:

- Extend `buildAssignmentReadiness` to read `resolutionMethod` + `severity`.
- Extend its output with `pendingCount`, `blockerCount`, `contributors[]` for the chip.
- Map existing 4-state output (`READY` / `READY_WITH_WARNINGS` / `BLOCKED` / `PENDING_INITIALIZATION`) to chip states (green / yellow / red / computing).
- Existing consumers (`PlacementsTab.tsx`, Flutter) read the same field name (`readinessSnapshotV1`) — back-compat preserved.

Nothing for R.1/R.2 to do here besides ensuring the new fields exist on every item by the time R.4 ships.

---

## R.1 — Field shapes + audit + backfill

### Code changes

#### R.1.1 — Extend `AssignmentReadinessItem` shape

`shared/assignmentReadinessItemV1.ts`:

```ts
export type AssignmentReadinessResolutionMethod =
  | 'auto'
  | 'self_attest'
  | 'csa_confirmed'
  | 'csa_waived'
  | 'external'
  | null;

export type AssignmentReadinessSeverity = 'hard' | 'soft';

export type AssignmentReadinessItem = {
  // ...existing fields...
  /** R.4 chip color driver. Denormalized from the requirement at seed time. */
  severity: AssignmentReadinessSeverity;
  /**
   * R.4 chip metadata + audit. How was this item's current `status` reached?
   * `null` = unresolved (status is `incomplete` / `in_progress`).
   */
  resolutionMethod?: AssignmentReadinessResolutionMethod;
  // ...existing fields...
};
```

`severity` is required for new items; old items get backfilled (D6.R1). `resolutionMethod` is optional (`null`) for unresolved items.

#### R.1.2 — Extend `SeedAssignmentReadinessRequirementSpec` and seeder

`shared/seedAssignmentReadinessItems.ts`:

- Add `severity?: AssignmentReadinessSeverity` and `resolutionMethod?: AssignmentReadinessResolutionMethod` to the spec.
- Add a `DEFAULT_REQUIREMENT_SEVERITY: Record<AssignmentReadinessRequirementType, AssignmentReadinessSeverity>` table per the locked D3.R1 table.
- In `buildItem`: stamp `severity = spec.severity ?? DEFAULT_REQUIREMENT_SEVERITY[type]`. Stamp `resolutionMethod = spec.resolutionMethod ?? null`.
- Re-derive `blocking = spec.blocking ?? (severity === 'hard')` — keeps current `DEFAULT_REQUIREMENT_DEFAULTS.blocking` behavior intact since severity defaults match existing `blocking` defaults.

#### R.1.3 — Extend JO requirement schemas with severity

Per D4.R1:

- `RequiredLicenseV1.severity?: 'hard' | 'soft'` — `shared/licenseRecord.ts`.
- `RequiredLanguageV1.severity?: 'hard' | 'soft'` — `shared/languageProficiency.ts`.
- Certification requirement shape — wherever `buildCertificationRequirementsFromJobOrder` builds its output. Add `severity?: 'hard' | 'soft'` to the requirement record so the catalog manifest mapping can pass through any per-cert override.
- `JobOrder.skillsRequiredSeverityOverrides?: Record<string, 'hard' | 'soft'>` — `src/types/recruiter/jobOrder.ts`.
- `JobOrder.requirementSeverityOverrides?: Partial<Record<AssignmentReadinessRequirementType, 'hard' | 'soft'>>` — same file.

No write-side UI in R.1. JO authoring UI for severity overrides is deferred (likely R.4 or a small follow-on) — for R.1 the override map is reads-only by the seeder; JO authors continue with type defaults.

#### R.1.4 — Wire seeder integration to stamp `resolutionMethod: 'auto'` for Phase B matchers

`functions/src/readiness/jobRequirementMatcherHelpers.ts`:

- Update `pushIfApplicable` (line ~487) to stamp `resolutionMethod: 'auto'` and `severity` from the requirement (license/language/cert) or override map (skill) or type default.
- Per-spec severity resolution (priority order):
  1. Per-instance: `requirement.severity` (object-shaped requirements).
  2. Skill override map: `jo.skillsRequiredSeverityOverrides?.[skill]`.
  3. Type default: from `DEFAULT_REQUIREMENT_SEVERITY`.
- Same priority for non-Phase-B requirements (singletons / flag-based) when seeded by other code paths — search `seedAssignmentReadinessItems(` callers and stamp severity at every call site, falling back to type default.

#### R.1.5 — `resolutionMethod: 'external'` on AccuSource + E-Verify bridges (Q-R1-3 enumerated)

**Code-grounding result (2026-04-26):** the existing AccuSource +
E-Verify bridges (`onBackgroundCheckWriteUpdateReadiness.ts`,
`updateReadinessFromEverifyEvent.ts`) write to **`employeeReadinessItems`**,
*not* `assignmentReadinessItems`. There is currently no path that flips the
status of an `assignmentReadinessItems/{type ∈ {background_check, drug_screen,
e_verify, screening_package_match}}` row from a third-party event.

R.1 therefore handles the assignment-side `'external'` stamp in two places:

1. **Seed time** — `onAssignmentCreatedAutoSeed.ts` now stamps
   `resolutionMethod: 'external'` directly on the seeded specs for
   `background_check`, `drug_screen`, and `e_verify` (matcher-side
   `screening_package_match` gets it via `pushIfApplicable` instead).
2. **Backfill** — `backfillAssignmentReadinessItemsCallable` derives
   `'external'` for the same set of types per D6.R1 priority rules.

When R.3 builds the CSA-action surface that bridges third-party verdicts onto
the assignment-side rows, that code adopts `resolutionMethod` per the locked
table (write `'external'` on third-party-driven status flips,
`'csa_confirmed'` / `'csa_waived'` on manual ones).

#### R.1.6 — CSA action endpoints (Q-R1-3 enumerated)

**Code-grounding result (2026-04-26):** **NO CSA manual-mark surface for
`assignmentReadinessItems` exists today.** The only writers to that
collection are:

| Surface | File | What it writes |
|---|---|---|
| Phase A seeder | `functions/src/readiness/seedAssignmentReadinessItemsRunner.ts` (called from `onAssignmentCreatedAutoSeed`) | Initial creates |
| Phase C match-refresh | `functions/src/readiness/assignmentMatchRefreshHelpers.ts` | Re-stamps `status` + (R.1) `resolutionMethod: 'auto'` when matcher result changes |
| Daily expiry sweep | `functions/src/readiness/dailyReconcileExpiredReadiness.ts` | Flips `status: 'expired'` (intentionally **does not** touch `resolutionMethod` — that field describes the resolution pathway, not validity) |
| **R.1 backfill** | `functions/src/backfillAssignmentReadinessItemsCallable.ts` (this PR) | One-shot R.1 field fill |

There is no `csaWaiveAssignmentReadinessItemCallable` /
`csaMarkPassedCallable` / etc. on the assignment side — the AccuSource
adjudication endpoint
(`functions/src/integrations/accusource/setAccusourceServiceLineAdjudication.ts`)
operates on `employeeReadinessItems`. R.1 therefore stamps nothing on a CSA
manual-mark surface because none exists.

**R.3 generalises this**: builds the CSA action surface for
`assignmentReadinessItems` and adopts `resolutionMethod: 'csa_confirmed' |
'csa_waived'` from inception.

#### R.1.7 — Backfill callable

`functions/src/backfillAssignmentReadinessItemsCallable.ts` (new). Mirrors
`backfillWorkerAttestationsCallable` exactly (same arg shape, dry-run
default, doc-id pagination cursor, security-level-7-on-active-tenant gate):

- Args: `{ tenantId, dryRun?: boolean = true, limit?: number = 1000, pageToken?: string }`.
- Walks `tenants/{tid}/assignmentReadinessItems`. For each item:
  - **Severity:** if missing, derive from `DEFAULT_REQUIREMENT_SEVERITY[type]`. `'custom'` is skipped here (no type default — operator has to fix it manually if any exist).
  - **Resolution method:** if missing, derive per D6.R1 priority chain:
    - `{background_check, drug_screen, e_verify, screening_package_match}` → `'external'`
    - `{education_match, language_match, skill_match, license_match, cert_match}` → `'auto'`
    - everything else (`shift_confirmation`, `ppe_acknowledgement`, `safety_briefing`, `orientation`, `custom`, `required_certification`) → leave unset (R.2 / R.3 territory)
  - Items that already carry both fields skip unconditionally (idempotent re-run).
  - Touched items also get an `updatedAt: serverTimestamp()` bump for downstream consumers.
- Returns `{ tenantId, dryRun, limit, scanned, candidates, written, wouldWrite, skipped_already_complete, skipped_unknown_type, stampedSeverity, stampedResolutionMethod, resolutionMethodBreakdown, errors[], truncated, nextPageToken }`.
- **Does not** touch `blocking` — D5.R1 says historical consistency wins, the audit report surfaces conflicts (Q-R1-2).

CLI wrapper at `scripts/backfillAssignmentReadinessItems.js` (mirrors the R.0c
pattern). Same dry-run-by-default safety; service-account auth bypasses the
callable's security-level gate.

#### R.1.8 — Audit task: status field gaps + severity/blocking conflicts (Q-R1-2)

`scripts/auditAssignmentReadinessStatuses.js` (read-only) walks
`tenants/{tid}/assignmentReadinessItems` and reports four buckets:

1. **Status gaps** — missing / `undefined` / legacy `'complete'` / unknown values.
2. **Required-field gaps** — missing `actor` or `blocking`.
3. **R.1 backfill scope** — items missing `severity` or `resolutionMethod`. Sets the operator's expectation for the backfill callable's `wouldWrite`.
4. **Q-R1-2 severity/blocking conflicts** — `blockingTrueButSoft` (item with `blocking: true` whose effective severity is `'soft'`) and `blockingFalseButHard` (the reverse). Effective severity uses the item's explicit `severity` if present, else the type default. First 50 ids of each are sampled in the report so the operator can spot-check.

Output written to both stdout (full JSON) and `.scratch/assignment-readiness-audit-<tenant>-<YYYYMMDD>.json` (audit trail), with a one-line summary on stderr. Recommended workflow per greenlight:

```
# 1. staging audit — confirm conflict counts before any writes
node scripts/auditAssignmentReadinessStatuses.js --tenant=<tenant>

# 2. dry-run backfill — same scope
node scripts/backfillAssignmentReadinessItems.js --tenant=<tenant>

# 3. operator sign-off on conflict counts + dry-run report

# 4. real run
node scripts/backfillAssignmentReadinessItems.js --tenant=<tenant> --no-dry-run
```

Status gaps that the audit surfaces are *not* fixed by the backfill — they get a separate ticket if the count is non-zero (planning notes already promise: "Single tenant. Application count is in the low thousands at most.").

### R.1 verification

```bash
# Per-package type checks
( cd functions && npx tsc --noEmit )
( cd packages/contracts && npx tsc --noEmit )
npx tsc --noEmit  # root (CRA app)

# Lints
npm run lint -- --max-warnings=0
( cd functions && npm run lint )

# Existing matcher unit tests (must still pass — no behavioral change)
( cd functions && npm test -- --grep 'matchSkills|matchLicenses|matchCertifications|matchLanguages|matchEducation|matchScreeningPackage' )

# New tests
# - seedAssignmentReadinessItems stamps severity from default table when spec omits it
# - seedAssignmentReadinessItems honors spec.severity override
# - seedAssignmentReadinessItems honors jo.skillsRequiredSeverityOverrides for skill_match
# - seedAssignmentReadinessItems honors jo.requirementSeverityOverrides for singletons
# - seedAssignmentReadinessItems derives blocking from severity when blocking unspecified
# - jobRequirementMatcherHelpers stamps resolutionMethod: 'auto' on all Phase B specs
# - backfillAssignmentReadinessItemsCallable: dry-run reports diffs without writing
# - backfillAssignmentReadinessItemsCallable: actual run patches items with merge: true
```

### R.1 — PR 1 completion notes (2026-04-26)

**Implemented:**

- Added `severity` (required) + `resolutionMethod` (optional) to `AssignmentReadinessItem` (`shared/assignmentReadinessItemV1.ts`, mirrored to `src/shared/`).
- Added `DEFAULT_REQUIREMENT_SEVERITY` table and `severity` / `resolutionMethod` slots on `SeedAssignmentReadinessRequirementSpec`. `buildItem` derives `blocking = spec.blocking ?? (severity === 'hard')` per D5.R1 (validates explicit `severity` for `'custom'` requirements).
- Extended JO requirement schemas with optional `severity?: 'hard' | 'soft'`: `RequiredLicenseV1`, `RequiredLanguageV1`, `Phase1CertificationRequirement`. Added `JobOrder.skillsRequiredSeverityOverrides` (parallel slug map) and `JobOrder.requirementSeverityOverrides` (per-type) to `src/types/recruiter/jobOrder.ts`.
- Wired `pushIfApplicable` in `functions/src/readiness/jobRequirementMatcherHelpers.ts` to stamp `resolutionMethod: 'auto'` and `severity` per the D4.R1 chain (per-instance > parallel-skill-map > requirementSeverityOverrides[type] > DEFAULT_REQUIREMENT_SEVERITY[type]). Updated `pickLanguagesRequiredV2` + `pickRequiredLicensesV2` to thread `severity` through.
- Stamped `resolutionMethod: 'external'` on baseline `background_check` / `drug_screen` / `e_verify` specs in `functions/src/readiness/onAssignmentCreatedAutoSeed.ts`.
- Stamped `resolutionMethod: 'auto'` on Phase C status flips in `functions/src/readiness/assignmentMatchRefreshHelpers.ts` (intentionally overwrites prior `csa_*` when matcher data shifts; expiry sweep continues to leave the field alone).
- New backfill callable at `functions/src/backfillAssignmentReadinessItemsCallable.ts` (registered in `functions/src/index.ts`); CLI wrapper at `scripts/backfillAssignmentReadinessItems.js`. Both dry-run by default per the ops note.
- New read-only audit at `scripts/auditAssignmentReadinessStatuses.js` covering Q-R1-2 conflicts + status gaps + required-field gaps + R.1 backfill scope.
- Tests:
  - 13 R.1 tests in `src/shared/__tests__/seedAssignmentReadinessItems-r1.test.ts` (CRA/Jest).
  - R.1 matcher-resolution tests in `functions/src/__tests__/readiness/jobRequirementMatcherHelpers-r1.test.ts` (Mocha/Chai).
  - Updated `assignmentReadinessRequirementType.b2.test.ts` and `seedAssignmentReadinessItems.test.ts` to reflect D5.R1 (`blocking` derives from severity; `'custom'` requires explicit severity).

**CSA-stamping (Q-R1-3) — enumerated:** No CSA manual-mark surface for `assignmentReadinessItems` exists today; see R.1.6 for the table of what does write to that collection. Nothing to stamp on R.1; R.3 owns the new surface.

**Verification (final):**

- `cd functions && npx tsc --noEmit` → clean.
- Root `npx tsc --noEmit` → 0 net new errors (pre-existing 32 errors all pre-date R.1; see R.1.6 enumeration for the readiness-side touches).
- 376 / 376 `src/shared/__tests__/` tests pass.
- 82 / 82 `functions/src/__tests__/readiness/` tests pass.

### R.1 verification gate

- Type checks pass across all 3 tsconfigs.
- All existing matcher tests still pass (no behavioral change).
- New unit tests cover severity defaults + overrides + resolutionMethod stamping.
- Audit script runs locally without errors against emulator data.
- Dry-run of backfill callable on a staging tenant returns a sane report.

---

## R.2 — Willingness requirement types + matchers

### Code changes

#### R.2.1 — Extend the requirement type enum

`shared/assignmentReadinessItemV1.ts` — add to `AssignmentReadinessRequirementType`:

```ts
| 'physical_willingness'
| 'uniform_willingness'
| 'ppe_willingness'
| 'language_willingness'
```

(All exhaustive switches over the enum will surface — fix at compile time.)

#### R.2.2 — Add seeder defaults

`shared/seedAssignmentReadinessItems.ts` — add to `DEFAULT_REQUIREMENT_DEFAULTS`:

```ts
physical_willingness: { actor: 'worker', blocking: false }, // soft → derives blocking: false
uniform_willingness:  { actor: 'worker', blocking: false },
ppe_willingness:      { actor: 'worker', blocking: false },
language_willingness: { actor: 'worker', blocking: false },
```

And to `DEFAULT_REQUIREMENT_SEVERITY` (added in R.1):

```ts
physical_willingness: 'soft',
uniform_willingness:  'soft',
ppe_willingness:      'soft',
language_willingness: 'soft',
```

#### R.2.3 — Add 4 matchers in `shared/jobRequirementMatchers/`

One file per matcher, mirroring `matchSkills.ts` shape:

- `matchPhysicalWillingness.ts` — input `{ jobRequirementText: string; willingness: AttestationWillingness | null }`.
- `matchUniformWillingness.ts` — input `{ jobRequirementKind: 'standard' | 'custom'; standardWillingness; customWillingness }`. Matcher picks the relevant willingness based on JO requirement; if both populated and either is "no", returns `complete_fail` (worse-of rule).
- `matchPpeWillingness.ts` — input `{ requiredPpe: string[]; willingness: AttestationWillingness | null }`.
- `matchLanguageWillingness.ts` — input `{ languageRequirementText: string; willingness: AttestationWillingness | null }`.

All matchers return `MatcherResult` per existing `types.ts` contract. Mapping per D8.R2:

```ts
const map = (w: AttestationWillingness | null): MatchedReadinessStatus => {
  switch (w) {
    case 'yes':   return 'complete_pass';
    case 'maybe': return 'needs_review';
    case 'no':    return 'complete_fail';
    case null:
    case undefined:
    default:      return 'incomplete';
  }
};
```

`AttestationWillingness` was added in R.0a (`'yes' | 'no' | 'maybe' | 'unknown' | null`). Treat `'unknown'` as `'maybe'` for matcher purposes (or as `'incomplete'` — flag in Q-R2-2).

#### R.2.4 — Wire matchers into `jobRequirementMatcherHelpers.ts`

Add a new section in `buildPhaseBMatchSpecs` (or factor into a helper if the function gets large):

```ts
// Willingness items — only seed when the JO has a corresponding requirement.
if (jo.physicalRequirements && typeof jo.physicalRequirements === 'string' && jo.physicalRequirements.trim().length > 0) {
  const result = matchPhysicalWillingness({
    jobRequirementText: jo.physicalRequirements,
    willingness: worker.workerAttestations?.physicalRequirementWillingness ?? null,
  });
  pushIfApplicable(specs, result, {
    requirementType: 'physical_willingness',
    requirementLabel: 'Physical requirements',
    resolutionMethod: 'self_attest',
  });
}
// (similar for uniform / ppe / language)
```

Note the new `resolutionMethod: 'self_attest'` parameter on the spec — `pushIfApplicable` (R.1.4) needs to accept this and pass it through to the seeder.

`WorkerForMatching` (the projection type) needs a `workerAttestations?: WorkerAttestations | null` field; `loadWorkerForMatching` needs to read it from the user doc.

#### R.2.5 — Tests

Per matcher, mirror existing `matchSkills.test.ts` pattern:

- `'yes'` → `complete_pass`
- `'maybe'` → `needs_review`
- `'no'` → `complete_fail`
- `null` → `incomplete`
- (uniform-specific) `standard='no', custom='yes'` and JO is custom → `complete_pass`; same with worse-of for both-applicable case.

Plus integration test: `buildPhaseBMatchSpecs` correctly skips willingness items when the JO field is empty, seeds them when populated, and stamps `resolutionMethod: 'self_attest'`.

### R.2 verification

```bash
( cd functions && npx tsc --noEmit )
npx tsc --noEmit
( cd functions && npm test -- --grep 'matchPhysicalWillingness|matchUniformWillingness|matchPpeWillingness|matchLanguageWillingness|buildPhaseBMatchSpecs' )
```

### R.2 verification gate

- Existing matcher tests still pass.
- 4 new matcher test suites pass (yes/maybe/no/null + edge cases).
- `buildPhaseBMatchSpecs` integration test confirms willingness items only seed when JO field is populated.
- Type check confirms exhaustive switches over `AssignmentReadinessRequirementType` got updated where needed (planning note: there ARE switch statements over this enum in the readiness UI / Flutter shared code — they'll surface at compile time).

### R.2 — PR 2 completion notes (2026-04-26)

**What landed:**

- 4 new requirement types added to `AssignmentReadinessRequirementType` (3 mirrors: `shared/`, `src/shared/`, `functions/src/types/`).
- `DEFAULT_REQUIREMENT_DEFAULTS` + `DEFAULT_REQUIREMENT_SEVERITY` extended (all 4 default to `actor: 'worker'`, `blocking: false`, `severity: 'soft'`); JO `requirementSeverityOverrides[type]` flips an item to `'hard'` per D4.R1.
- Shared helper `shared/jobRequirementMatchers/willingness.ts` (mirrored to `src/shared/`) exports `normalizeWillingness`, `willingnessToStatus`, `worseOfWillingness`, plus type aliases (`WillingnessInput`, `NormalizedWillingness`, `AttestationWillingnessValue`).
- 4 matchers added (`matchPhysicalWillingness`, `matchUniformWillingness`, `matchPpeWillingness`, `matchLanguageWillingness`) — all pure, all dual-mirrored.
- `WorkerForMatching` extended with `workerAttestations: WorkerAttestationsForMatching | null`. `loadWorkerForMatching` calls a new `pickWorkerAttestations` projection helper.
- `pushIfApplicable` accepts an explicit `resolutionMethod` on the `base` arg (defaults to `'auto'` — backwards-compatible with R.1 specs); willingness specs stamp `'self_attest'`.
- `buildPhaseBMatchSpecs` wires the 4 matchers behind per-type JO gates using `jobHasNonEmptyText` (str | str[]) and `jobHasNonEmptyArray` (languages-only), per Q-R2-4 grounding.
- `backfillAssignmentReadinessItemsCallable.deriveResolutionMethod` recognizes the 4 new `*_willingness` types as `SELF_ATTEST_TYPES` for forward compatibility (a re-run after R.2 ships will correctly classify any future seeded willingness items, not lump them into `'auto'`).

**Test evidence:**

- `functions/src/__tests__/readiness/jobRequirementMatcherHelpers-r2.test.ts` — 17/17 passing. Covers gate-closed-no-seed (per type + array/text dual shape + empty-array/whitespace edge cases), `'self_attest'` stamping (positive + negative against `auto`), severity defaults + JO override, D8.R2 yes/maybe/no/empty mapping, Title-Case normalization, uniform worse-of (yes+no, yes+null).
- `src/shared/__tests__/matchPhysicalWillingness.test.ts` — 23 passing (status mapping + Title-Case + sentinel collapse + `worseOfWillingness` ranking matrix).
- `src/shared/__tests__/matchPpeWillingness.test.ts`, `matchLanguageWillingness.test.ts` — yes/maybe/no/null + Title-Case.
- `src/shared/__tests__/matchUniformWillingness.test.ts` — full worse-of matrix including single-gate active cases.
- Full functions readiness Mocha suite: **99/99 passing** after updating two pre-existing R.1 tests that newly co-seed `language_willingness` against `languagesRequiredV2` (commented inline).
- Full client `src/shared` jest suites for R.1 + R.2 + b2 schema lock: **88/88 passing**.
- `tsc --noEmit` on `functions/`: clean.
- `tsc --noEmit` on root: no R.2-related errors (10 pre-existing errors in `src/utils/certifications/__tests__/` and `src/utils/userActionItems/__tests__/deriveActionItemsV1.certEngine.test.ts` are unrelated and predate this PR).

**Audit script:** `scripts/auditAssignmentReadinessStatuses.js` automatically picks up new types via `DEFAULT_REQUIREMENT_SEVERITY` — no code change needed.

**Behavioral change in production after deploy:** none yet. Worker UI doesn't surface willingness items as their own slot (R.4 chip is what makes them visible). Until R.4 ships, willingness items will exist on assignments but only show up in the (existing) generic readiness list — `severity: 'soft'` + `blocking: false` means they don't gate hire actions today.

---

## Out of scope (separate tickets)

- **R.3 — Generalized CSA action endpoints** for non-AccuSource item types (confirm / waive / markFailed). R.1 stamps `resolutionMethod` on whatever endpoints exist today; R.3 builds the rest.
- **R.4 — Chip aggregator extension + chip component**. Already has its own design doc.
- **JO authoring UI for severity overrides.** R.1 makes the field shapes Firestore-writable; per-skill / per-singleton override toggles in the JO form are deferred.
- **Worker UI for re-attestation / profile edit.** R.9 (Flutter).
- **B.6 experience matcher.** Still deferred.

---

## Order of operations

1. **PR 1 — R.1 (field shapes, matcher stamping, audit + backfill)**
   - Land first. Field shapes settle. Existing items get backfilled.
   - Behavioral change: zero (severity drives `blocking` the same way today's defaults do; `resolutionMethod` is additive metadata).

2. **PR 2 — R.2 (willingness types + matchers)**
   - Lands on top of R.1 — uses the `severity` and `resolutionMethod` plumbing R.1 added.
   - Behavioral change: 4 new readiness items seed on assignments where the JO declares the corresponding requirement field. Items default `severity: 'soft'` → don't break confirmation gate (since `blocking = severity === 'hard'`).

3. **PR 3 — R.4 (chip aggregator + component)**
   - Reads the fields R.1 + R.2 added.
   - Surfaces on placement tiles + worker header + CSA matrix.

---

## Open questions for greenlight

R.1-side questions are all **resolved** (greenlight 2026-04-26). R.2-side
questions remain open and will be tackled in PR 2.

R.1 (resolved):

- **Q-R1-1 (D4.R1):** Confirmed — parallel `skillsRequiredSeverityOverrides` map for the slug → severity override on skills, plus the singleton `requirementSeverityOverrides` map keyed by requirement type. *Implemented in R.1.*
- **Q-R1-2 (D5.R1):** Confirmed — `blocking = spec.blocking ?? (severity === 'hard')` at seed time. The audit script in R.1.8 explicitly counts `blockingTrueButSoft` and `blockingFalseButHard` against effective severity (per-instance > type default) and lists the first 50 ids of each direction so the operator can spot-check before greenlighting backfill writes. *Implemented in R.1.*
- **Q-R1-3 (R.1.6):** Enumerated — see R.1.5 / R.1.6. Zero CSA manual-mark surfaces for `assignmentReadinessItems` today. R.1 stamps `'external'` on baseline BG/drug/E-Verify specs at seed time and on existing rows via the backfill; R.3 builds the CSA surface and adopts `resolutionMethod` from inception.
- **Q-R1-4 (R.1.8):** Confirmed — audit script lives in this PR. *Implemented in R.1.*

R.2 (still open):

- **Q-R2-1 (D7.R2):** Confirmed — `*_willingness` naming (locked).
- **Q-R2-2 (R.2.3):** Confirmed `'unknown' → 'maybe' → needs_review`, with the **caveat to verify in code-grounding**: confirm the application UX requires the worker to deliberately pick "Unknown" rather than it being a default-not-selected state. If it IS a default state, flip to `'incomplete'`. Verify before locking R.2.
- **Q-R2-3 (D9.R2):** Confirmed — seed both `language_match` and `language_willingness` when both JO fields are present (proficiency vs site-language comfort answer different questions; chip aggregator handles double-counting cleanly).
- **Q-R2-4:** Confirmed — code-grounding pass before coding R.2 to lock the exact JO field names. Drop the verified mapping into the R.2 PR description.

---

## Cross-references

- Predecessor handoff: `READINESS_R0_HANDOFF.md`
- R.4 design notes: `READINESS_R4_PLACEMENT_CHIP_DESIGN.md`
- Planning notes: pasted into chat (Apr 2026); audits I.1 / I.2 / I.3 referenced there.
- Type touchpoints:
  - `shared/assignmentReadinessItemV1.ts`
  - `shared/seedAssignmentReadinessItems.ts`
  - `shared/jobRequirementMatchers/types.ts`
  - `shared/licenseRecord.ts`, `shared/languageProficiency.ts`
  - `src/types/recruiter/jobOrder.ts`, `src/types/UserProfile.ts`
- Integration touchpoints:
  - `functions/src/readiness/jobRequirementMatcherHelpers.ts`
  - `functions/src/readiness/onBackgroundCheckWriteUpdateReadiness.ts`
  - `functions/src/readiness/onEverifyCaseWriteUpdateReadiness.ts`
  - `functions/src/integrations/accusource/setAccusourceLineAdjudication.ts`

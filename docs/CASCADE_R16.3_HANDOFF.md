# Cascade Propagation Policy — R.16.3 Drift Detection + Selective Repair (Override Visibility) Handoff Spec

**Status:**
- R.16.3 proper — **scope locks captured Apr 27, 2026**, **implementation deferred** per Q6 lock until CORT bakes ~1–2 weeks. See "Greenlight conditions" at the bottom.
- R.16.3 **interim ("Path 1 / Option B") — SHIPPED Apr 27, 2026** as a quick-win to unblock CORT operator workflow. See "R.16.3 Interim — Path 1 (Option B) — SHIPPED" section immediately below.

**Predecessor:** `docs/CASCADE_R16.2a_HANDOFF.md` (consumer rewire shipped, snapshot envelope read by financial / compliance critical paths). R.16.2b (post-CORT polish — `screeningPackageId` consolidation, remaining per-position fields, banner integrations) lands in parallel; R.16.3 doesn't depend on R.16.2b but will benefit from it.
**Successor:** R.16.4 (engine-level propagation enforcement + scheduled drift report — both deferred per Q5 + Q6 reasoning).

---

## R.16.3 Interim — Path 1 (Option B) — SHIPPED Apr 27, 2026

**Why this exists:** Greg requested a manual "Sync to active" affordance ahead of the full R.16.3 ship to unblock CORT operator workflow. The post-edit `PushToActiveBanner` only surfaces when an admin *just* changed a field; operators routinely need to re-push the *current* value (catch JOs that missed a prior push, sync after a child-account reorg) without making a fresh edit.

**Semantic (Option B — "re-push the last pushed value"):**
- The button reads the most recent `push_to_active_summary` row from `cascadeAuditLog` for `(accountId, fieldKey, positionId?)`.
- That row's `pushedField.value` (i.e. the value last pushed account-wide) becomes `previousValue` for the new push session.
- The R.16.1.1 child-override filter (`wouldChange = snapshot == previousValue && snapshot != newValue`) then ensures the push only catches JOs whose snapshot still matches the last pushed value — true stragglers, not child overrides.
- If no push history exists for the field, the dialog opens with `previousValue=undefined` (V1 push semantics — operator reviews and deselects per the R.16.1.1 mitigation pattern).

**What it is NOT (deferred to R.16.3 proper):**
- No drift detection (no three-way `in_sync` / `stale_value` / `child_override` classification per row).
- No unified "Audit & Sync" panel.
- No scheduled drift reports.
- No per-position pricing surface (5 fields × N rows). The per-edit banner still covers the "I just edited" case for pricing; manual re-push for pricing waits for the R.16.3 Audit & Sync panel.

**Implementation surface (shipped):**

| Layer | File | What changed |
|-------|------|--------------|
| Server | `functions/src/jobOrders/getLastPushedValueForField.ts` | New file. Pure helper `lookupLastPushedValue` + onCall `getLastPushedValueForFieldCallable`. Sec ≥ 7 (reuses exported `gatePushCallable`). |
| Server | `functions/src/jobOrders/pushToActive.ts` | Exported `gatePushCallable` so the new callable reuses the same auth gate. |
| Server | `functions/src/index.ts` | Added export for `getLastPushedValueForFieldCallable`. |
| Server | `functions/src/__tests__/jobOrders/getLastPushedValueForField.test.ts` | 16 mocha cases — input gating + audit-log scan semantics (history found / missing / fieldKey filter / positionId filter / null normalization / fallback / Timestamp serialization). |
| Index | `firestore.indexes.json` | New composite: `cascadeAuditLog (accountId ASC, action ASC, timestamp DESC)`. |
| Client | `src/components/recruiter/SyncToActiveButton.tsx` | New file. `<IconButton>` (sync icon + tooltip). On click: calls lookup → opens `PushToActiveDialog` with the right `previousValue`. Self-contained — parent passes `tenantId`, `accountId`, `fieldKey`, `getCurrentValue()`, `fieldLabel`, `enabled`. |
| Client | `src/components/recruiter/AccountOrderDetailsForm.tsx` | Imported `SyncToActiveButton` + `useAuth`. Added `canPushToActive = securityLevel === '7'` gate. Wired buttons next to AccuSource Screening Package + Additional Screenings selectors (Account-level only — location-level edits hide the button). |
| Client | `src/pages/RecruiterAccountDetails.tsx` | Imported `SyncToActiveButton`. Wired button next to the Hiring Entity Select using existing `canPushToActive` gate. |

**What this does NOT cover yet (in scope for R.16.3 proper, not the interim):**
- Per-position pricing fields (`payRate`, `billRate`, `markupPercent`, `workersCompRate`, `workersCompCode`) on the Pricing tab. Adding 5 inline buttons per position row would be visually noisy; the R.16.3 Audit & Sync panel is the right home for "verify all 5 fields × N positions are in sync" workflow.
- Top-level `eVerifyRequired` (driven by Hiring Entity, no edit surface here) and top-level `workersCompCode` (no current edit surface). Both deferred to R.16.2b.

**Verification (Apr 27, 2026):**
- ✅ `functions` mocha: 342/342 passing (16 new lookup tests + 326 existing — backfill / pushToActive / R.16.2a wraps / cascade / readiness / onboarding / prescreen).
- ✅ `client` jest (R.16.2a wraps): 17/17 passing — no regression.
- ✅ `tsc --noEmit` clean for both projects (only pre-existing certification + userActionItems test errors — unchanged).
- ✅ `bash scripts/check-cascade-mirror.sh` clean.
- ✅ Lints clean for all touched files.

**Deploy runbook:**

```bash
# 1. Indexes (composite on cascadeAuditLog; required before the
#    callable can read summary rows efficiently — without it the
#    callable will throw "FAILED_PRECONDITION: needs an index").
firebase deploy --only firestore:indexes

# 2. New callable.
firebase deploy --only functions:getLastPushedValueForFieldCallable

# 3. Frontend (the new SyncToActiveButton component + form wiring).
npm run deploy:hosting
```

**Smoke test (production):**
1. As `securityLevel === '7'` user, open a Recruiter Account → Settings → "Order Details" tab.
2. Confirm the new sync icon appears next to "AccuSource Screening Package" and "Additional Screenings" selectors. Hover for tooltip "Sync … to active job orders".
3. Click the icon. Dialog should open with the current parent value as "New value" + the affected JO list. If the field has prior push history, the row count should match the R.16.1.1 child-override filter (only JOs whose snapshot equals the last pushed value AND differs from the current parent value).
4. Repeat on the Hiring Entity selector at the top of the same page.
5. As a non-admin (`securityLevel < '7'`) user, confirm the button is hidden in both surfaces.

**Audit-log signal to watch:** Each manual sync emits the same `push_to_active` per-JO rows + `push_to_active_summary` row as the post-edit banner path. `triggeredBy` will be the operator's UID; `reason` will be whatever the operator types in the dialog. Filter on `pushedField.fieldKey` + `accountId` to see all sync activity per field per account.

**Forward path:** When R.16.3 proper ships (post-CORT bake per L6), the `SyncToActiveButton` stays as the per-field affordance; the Audit & Sync panel adds the multi-field overview; the dialog gets the `mode: 'edit' | 'drift'` extension. The per-position pricing surface lands with the panel, not as standalone buttons.

---

**Goal:** Provide a manual "Sync to active" affordance independent of the post-edit banner, that lets admins:
1. Audit drift between the activation snapshot on each active JO and the current parent value (per snapshot-policy field).
2. Distinguish three drift sources per JO: `in_sync`, `stale_value` (old parent value never updated post-edit), `child_override` (intentionally different per child-account decision).
3. Selectively push the current parent value to drifted JOs the admin chooses to repair, with the per-JO snapshot value used as `previousValue` for transactional safety.

This is the "let me audit and fix" affordance the V1 R.16.1.1 implementation acknowledged a need for ("a child that coincidentally overrode to the same value as the old National will have its JOs incorrectly included in the affected list"). R.16.1.1's mitigation was operator-reviews-and-deselects-before-submit; R.16.3 makes that audit step a first-class affordance with proper source attribution.

---

## Locked decisions (Apr 27, 2026)

> All six L# items below are **LOCKED** as of Apr 27, 2026 by Greg. Implementation must conform; any drift requires re-review before merging.

### L1 (LOCKED) — UI surface: hybrid (per-field button + unified panel) (Q1=c)

Two surfaces share the same Push-to-Active dialog (R.16.1 Phase 8 + R.16.2a Phase 3):

- **Per-field button** — a small "Sync to active" button next to each snapshot-policy field on the parent doc (`RecruiterAccountDetails.tsx`, plus any forms in scope post-R.16.2b). Discoverable, contextual; same UX as the post-edit banner. One field per dialog session.
- **Unified panel** — a new "Active JO Sync" tab on `RecruiterAccountDetails.tsx` with the matrix view: rows are active JOs, columns are snapshot-policy fields. Operational power-tool for "audit everything on this account." Still one field per push session (see L2); the panel is the discovery surface, the dialog is the action surface.

Per L4, both surfaces enumerate snapshot-policy fields off the cascade registry — no hand-curated list anywhere.

### L2 (LOCKED) — One field per push session (Q2=a)

Doubles down on the R.16.1 atomic-per-field-decision principle:
- Each push dialog session targets exactly one `(fieldKey, positionId?)` pair.
- An admin pushing 5 fields clicks the dialog 5 times — feature, not bug. Forces per-field review.
- Audit log stays clean: one `cascadeAuditLog` push entry per field per session.
- No multi-field "check all the boxes" UI — the implicit risk of batch-approval-without-review is real and operationally hazardous.

The unified panel from L1 still presents a multi-field overview, but every "push" link from that panel opens the per-field dialog.

### L3 (LOCKED) — Three-way source classification (Q3=b)

Each JO row in the preview is classified into one of three buckets:

| Bucket | Snapshot ↔ Parent | Snapshot ↔ Most-recent push | UX implication |
|--------|-------------------|-----------------------------|----------------|
| `in_sync` | Match | (n/a, no drift) | Hidden from "drifted" filter; visible in "show all" |
| `stale_value` | Differ | Match | Highlighted as actionable drift — admin probably wants to push |
| `child_override` | Differ | Differ | Flagged with badge; pushing here clobbers an intentional decision |

**Implementation approach (LOCKED, Q3 implementation note):** classification is computed at preview time via per-JO `cascadeAuditLog` lookup — read the most recent `push_to_active` row for `(joId, fieldKey)`; compare its `newValue` to the JO's current snapshot. No snapshot-envelope schema migration. Costs one Firestore read per JO at preview time, which is acceptable for a manual operation (max ~30 JOs per chunk × N chunks).

If a JO has no audit-log entry (snapshot from R.0c trigger or backfill, never push-to-active'd), classification falls back to a simpler binary: `in_sync` vs `stale_value` (no `child_override` distinguishable). That's correct — without a push history we can't tell the difference between "frozen at activation and never updated" and "intentional override," and both should be treated as "operator decides what to do."

### L4 (LOCKED) — Field scope: registry-driven (Q4=c)

R.16.3 enumerates snapshot-policy fields by reading `CASCADE_REGISTRY` and filtering for `propagation === 'snapshot-on-activation'`. No hand-curated list of supported fields. Adding a new snapshot-policy field to the registry automatically:
- Surfaces a per-field "Sync to active" button on the parent form (assuming Phase 3-equivalent banner wiring is done for that field).
- Adds a column to the unified panel matrix.
- Makes the field selectable in the dialog.

Field set at R.16.3 ship time depends on what R.16.2b consolidates. Worst-case minimum (just R.16.1 + R.16.2a):
- Top-level: `hiringEntityId`, `eVerifyRequired`, `workersCompCode`, `screeningPackageId`, `additionalScreenings`, `selectedPositionIds`
- Per-position (the R.16.1 `positions.itemFields`): `rateMode`, `payRate`, `billRate`, `markupPercentage`, `futa`, `suta`, `workersCompRate`

Engineering cost is the same regardless of field count.

### L5 (LOCKED) — Manual only for V1 (Q5=a, with Q5 revisit caveat)

V1 ships with no scheduled drift reports, no background drift collection, no notification surface. Admin clicks "Audit & Sync" or per-field "Sync to active" → preview → push.

**Revisit trigger (Q5 caveat):** once CORT data flows through the cascade for ~2–4 weeks, we'll have empirical signal on how often drift accumulates without operator action. If telemetry shows drift accumulating daily without admin action, R.16.4 (scheduled drift report + notification) jumps the queue ahead of other backlog. Add a one-line check to the post-CORT-bake review: "estimate drift accumulation rate from `cascadeAuditLog` + drift-preview manual runs."

Defer all auto-detection scaffolding (Pub/Sub trigger + `cascadeDriftReport` collection + notification fan-out) until that signal lands.

### L6 (LOCKED) — Sequence: after CORT push bakes (Q6=a, override of original default)

R.16.3 design + implementation both wait until R.16.2a has shipped to production, CORT downstream push (#32) has run, and we've watched drift behaviour in practice for ~1–2 weeks. Reasoning per Greg's Q6 answer:

1. **Cursor is sequential** — splitting attention across R.16.3 and CORT push slows both.
2. **CORT push is the highest-stakes near-term exercise** — full focus matters.
3. **No evidence yet that drift is a frequent operational issue** — R.16.1.1 fixed the National-account case; R.16.2a covered the financial-critical reads; manual smoke exercises the basic flow. The hypothesis that drift will be a daily ops pain point is unproven.
4. **CORT-informed design > theoretical design** — if CORT exposes drift hazards we didn't anticipate, the R.16.3 design is informed by real data instead of patterns we made up. Risk of designing for the wrong scenario > cost of skipping early server-side work.
5. **The lead-time saved by parallel work is small** — Phase 1 (server-side drift preview) is a few days, not weeks. Skipping it is cheap; doing the wrong thing is expensive.

**Escape hatch:** if CORT exposes a drift hazard severe enough to need urgent detection, R.16.3 jumps the queue and we drop other backlog to fast-track it.

---

## Implementation surface — TENTATIVE (not locked, awaits CORT signal)

These are the spots R.16.3 will most likely touch. Final list locks at brief-completion time post-CORT.

### Server (`functions/src/jobOrders/`)

- **Extend `previewPushToActiveCallable`** with a `mode: 'edit' | 'drift'` param. `'drift'` mode skips the `previousValue` filter (since there's no edit context), returns ALL active JOs in the fanout with three-way classification per row, and includes the audit-log-derived source attribution per JO.
- **`pushToActiveJobOrdersCallable`** — already accepts `previousValue` per-call, no shape change needed. The drift dialog passes each selected JO's *current* snapshot value as `previousValue` (transactional safety).
- **New helper `classifyJoDrift(jo, fieldKey, parentValue, lastPushAuditEntry)`** — pure function, classifies a JO into `in_sync` / `stale_value` / `child_override`. ~20 mocha cases.

### Client (`src/components/recruiter/` + `src/pages/`)

- **`PushToActiveDialog`** — extend with optional `mode: 'edit' | 'drift'` prop. Drift mode adds a per-row "Source" column with the three-way badge. Default stays `'edit'` for the existing banner/manual-button paths.
- **New `SyncToActiveButton`** small inline component — wraps the dialog open behavior, taking just `tenantId` + `accountId` + `fieldKey` + `positionId?` + current parent value as props. Renders next to each snapshot-policy field.
- **New `ActiveJoSyncPanel`** — the unified matrix tab on `RecruiterAccountDetails.tsx`. Shows fields × JOs grid; click a cell to open the dialog in drift mode for that field. Reads field set from the cascade registry per L4.

### Tests

Estimate ~25 mocha (server-side classification, drift-mode preview, audit-log integration) + ~20 jest (dialog drift mode, sync button, panel matrix). Real number locks when impl surface locks.

### Mirror script

Drift classification helper lives server-side only (no client need); no new mirror entry. The cascade registry stays the single source of truth for the field list (already mirrored).

---

## Open items pending CORT signal

These are the questions where the answer depends on what CORT exposes; I'm flagging them now so the post-CORT review knows what to look for.

| # | Question | Why it depends on CORT signal |
|---|----------|-------------------------------|
| O1 | Whether the unified panel needs a "filter to drifted only" toggle (probably yes, but default to on or off?) | Depends on typical drift density per account — if 80% of JOs are drifted on common fields, default-on hurts more than it helps |
| O2 | Whether per-row source classification needs more granularity than three-way (e.g., distinguish `child_override` set by `setDoc` vs `updateDoc`, or `stale_value` from R.0c backfill vs trigger snapshot) | Will CORT operators actually need that detail? Today it's a guess |
| O3 | Whether to surface a "history" affordance per JO (show last N audit entries inline, not just a count) | Depends on how often operators want to "see why this JO is in this state" |
| O4 | Whether the unified panel needs sorting / pagination for accounts with >50 active JOs | CORT will tell us the realistic upper bound on active JO count per account |
| O5 | Whether drift preview should batch-load all snapshot-policy fields in one server call (multi-field preview) or N calls per field | Depends on whether the panel auto-refreshes or requires manual "refresh" — if manual, multiple per-field calls are fine; if auto-refresh, batch makes sense |
| O6 | Whether `cascadeAuditLog` source attribution needs a new index for `(tenantId, joId, fieldKey, type='push_to_active')` reverse-lookup performance | Depends on audit-log row count per JO in practice — small JOs are fine on existing indexes; high-volume JOs may need a dedicated lookup index |

---

## Greenlight conditions

R.16.3 brief-completion + coding starts when **all** are met:

1. **R.16.2a deployed to production**, manual staging smoke clean, and CORT downstream push (#32) has run end-to-end.
2. **CORT operations baked for ~1–2 weeks**, with a documented review of:
   - How often drift is observed in practice (rough rate per account per week).
   - What operator actions correspond to the drift cases that DID occur (did they push? leave it? get blocked?).
   - Any drift hazards CORT exposed that R.16.1.1 didn't cover.
3. **R.16.3 brief drafted from these locks + CORT signal** — adds the implementation surface section, locks the open items O1–O6, follows the same R.16.2a structure (status / locked decisions / impl surface / verification gate / deploy runbook / deferred items table).
4. **Brief locks reviewed by Greg** — same review-then-build cadence as R.16.1.1 / R.16.2a.

Until all four are met, R.16.3 sits frozen at "scope locked, implementation surface pending CORT signal." The locks above (L1–L6) survive the wait — those are the decisions Greg can defend later. Everything below "Implementation surface" is intentionally provisional.

---

## Cross-references

- R.16.1.1 child-override edge case rationale (the proximate motivation for L3): `docs/CASCADE_PROPAGATION_R16.1_HANDOFF.md` §"R.16.1.1" → "Decisions" → `previousValue` filter section.
- Audit log shape (the data source for L3 source classification): `cascadeAuditLog` schema, see `functions/src/jobOrders/pushToActive.ts` `runPushToActivePage` audit emission.
- Cascade registry (the data source for L4 field enumeration): `shared/cascade/registry.ts` (mirrored to `src/shared/cascade/registry.ts`).
- Push-to-Active dialog (the surface L1 + L2 reuse): `src/components/recruiter/PushToActiveDialog.tsx`.
- Snapshot envelope schema (read by L3 to determine current snapshot value): `src/types/recruiter/jobOrder.ts` `JobOrderSnapshot` interface.

---

*End of R.16.3 scope-lock stub. Decisions L1–L6 LOCKED Apr 27, 2026. Implementation deferred per L6 / Q6 reasoning. Picks up post-CORT-bake.*

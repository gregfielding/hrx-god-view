# Readiness Rebuild — R.0 (Foundation) Handoff Spec

**Status:** PR 1 (R.0a + R.0d) merged and verified clean. PR 2 (R.0b) and PR 3 (R.0c) ready for review.

D1/D2/D3 locked; D4 flipped to soft-deprecate; R.0d scope reduced to three confirmed fields with `@deprecated` JSDoc + write-surface removal only (no Firestore migration).
**Predecessor:** `Readiness System Rebuild — Planning Notes` (audits I.1, I.2, I.3 + locked decisions).
**Successor:** `READINESS_R1_R4_HANDOFF.md` (item resolution — physical/uniform/PPE/languages matchers, CSA endpoints, aggregate compute).

---

## TL;DR

R.0 is the foundation under everything else. Four sub-tasks, ~5 person-days:

| ID | Task | Effort | Touches |
|---|---|---|---|
| R.0a | Type the `workerAttestations` schema; finish canonical mapping | 1–2 d | `src/types/UserProfile.ts`, `src/utils/workerReadinessWriteModel.ts` |
| R.0b | Server-side sync trigger (safety net for client-side writes) | 1 d | `functions/src/triggers/onApplicationSubmittedSyncProfile.ts` (new) |
| R.0c | Backfill callable + CLI wrapper for existing applications | 1–2 d | `functions/src/backfillWorkerAttestationsCallable.ts` (new), `scripts/backfillWorkerAttestations.js` (new) |
| R.0d | Soft-deprecate 3 confirmed JO fields (`@deprecated` JSDoc + write-surface removal; no Firestore migration) | 0.5–1 d | `src/types/recruiter/jobOrder.ts`, `JobOrderForm.tsx`, `DealStageForms.tsx`, `AccountOrderDetailsForm.tsx`, `ShiftPlacementsDrawer.tsx` |

**No worker-facing UI yet.** R.0 is invisible to recruiters and workers. R.1+ wire it up.

---

## Decisions (LOCKED)

### D1 — Schema shape: flat values + `_meta` sidecar — LOCKED

Flat values at `workerAttestations.<field>` (already the case in `workerReadinessWriteModel.ts`) **+** a metadata sidecar at `workerAttestations._meta.<field>.{ attestedAt, source }`.

`buildCanonicalWorkerProfileWritePatch` already writes flat to `workerAttestations.<field>` for 10 fields (line 9 `ATTESTATION_KEY_MAP`). The shape is settled — we just need to type it and add per-field provenance. The sidecar keeps value reads (`profile.workerAttestations.eVerifyWillingness`) trivial and matchers don't have to traverse a `{value}` wrapper.

### D2 — Sync conflict policy: profile-wins-once-set — LOCKED

R.0b trigger writes a field **only if the profile slot is null/missing**. Worker edits via the future Flutter R.9 path are sticky.

**Implementation note:** the trigger writes via `userRef.update(patch)` so partial patches don't stomp unrelated profile fields. **Do NOT use `userRef.set(patch, { merge: true })`** — the Admin SDK interprets dotted-string keys under `set/merge` as LITERAL field names with embedded dots, not as nested field paths. See the **Apr 26 2026 post-mortem** at the bottom of this doc for the full incident write-up and the integration test that pins this semantic.

### D3 — Backfill: dry-run-by-default admin callable — LOCKED

Admin-callable `backfillWorkerAttestationsCallable({ tenantId, dryRun, limit })`. Dry-run is the default; flip `dryRun: false` to actually write. Returns a per-tenant report `{ scanned, wouldWrite, errors }`.

We're single-tenant today so this is functionally one run, but the per-tenant scoping is good hygiene for when we're not.

### D4 — JO field deprecation: soft-deprecate (flipped from hard-remove)

**Drop from TypeScript types + UI; no Firestore migration in this PR.**

Reasoning:
- Hard-remove is irreversible — silent breakage risk if any background process / report / export quietly references these fields
- We don't have full forensic confidence the fields are unused
- Soft-deprecate achieves the user-facing goal (no new use, clean type) without destroying data
- Can promote to hard-remove in ~90 days after observing no issues, with much higher confidence

**Scope also reduced:** only three fields in this PR (see R.0d). The other three originally listed (`siteSpecificOrientation`, `vehicleRequirements`, `healthAttestations`) are deferred to a separate audit ticket — they may exist with informational data that should be migrated, not destroyed.

---

## R.0a — Type the `workerAttestations` schema

**Goal:** make the implicit `workerAttestations.*` shape explicit in TypeScript so consumers (matchers, CSA UI) can read fields with type safety, and add per-field provenance.

### File: `src/types/UserProfile.ts`

Add a new `WorkerAttestations` interface and slot it into `UserProfile`:

```ts
/**
 * Self-attestation answers collected on the application wizard
 * (`RequirementsAcknowledgementStep` + `EVerifyComfortStep` + `Wizard.tsx`).
 * Workers can also edit these post-application via the Flutter app (R.9).
 *
 * The flat values are written by `buildCanonicalWorkerProfileWritePatch`
 * (see `src/utils/workerReadinessWriteModel.ts` — `ATTESTATION_KEY_MAP`).
 * The `_meta` sidecar carries provenance per field so matchers + CSA UI
 * can show "self-attested on Apr 22" / "edited via Flutter" / etc.
 *
 * Shape evolution: ADD fields here BEFORE adding the legacy → canonical
 * mapping in `workerReadinessWriteModel.ts`. The map is allowed to write
 * fields the type doesn't know about today (silent schema), but new fields
 * landing in R.1+ should be typed first to avoid drift.
 */
export type AttestationWillingness = 'yes' | 'no' | 'maybe' | '';

export interface WorkerAttestations {
  /** E-Verify comfort (Yes / No). Sourced from `EVerifyComfortStep`. */
  eVerifyWillingness?: AttestationWillingness;

  /** Drug screening comfort (Yes / No / Maybe). */
  drugScreeningWillingness?: AttestationWillingness;
  /** Free-text explanation when drug = No or Maybe. */
  drugScreeningNotes?: string;

  /** Background check comfort (Yes / No). */
  backgroundCheckWillingness?: AttestationWillingness;
  /** Free-text explanation when background = No. */
  backgroundCheckNotes?: string;

  /** Per-screening-name map for `additionalScreenings` from the JO. */
  additionalScreenings?: Record<string, AttestationWillingness>;

  /** Comfortable working in the JO's required languages. */
  languageRequirementWillingness?: AttestationWillingness;

  /** Comfortable with JO's physical demands (lifting, standing, etc.). */
  physicalRequirementWillingness?: AttestationWillingness;

  /** Comfortable wearing the JO's uniform. */
  uniformRequirementWillingness?: AttestationWillingness;

  /** Comfortable with custom uniform notes (free-text on the JO). */
  customUniformRequirementWillingness?: AttestationWillingness;

  /** Comfortable wearing the JO's required PPE. */
  requiredPpeWillingness?: AttestationWillingness;

  /**
   * Per-field provenance sidecar. Keyed by the same key as the value above.
   * Matchers + CSA UI read from here; writes always go through the
   * canonical patch helper (which stamps `attestedAt`/`source` on the
   * fly via the trigger in R.0b).
   */
  _meta?: {
    [fieldKey: string]: {
      attestedAt?: import('firebase/firestore').Timestamp | Date | null;
      /**
       * Where the answer came from:
       *  - 'application'           — original wizard submission
       *  - 'application_backfill'  — R.0c backfill from existing app docs
       *  - 'worker_edit'           — Flutter / web profile edit (R.9)
       *  - 'csa_override'          — CSA edited on the worker's behalf
       */
      source?: 'application' | 'application_backfill' | 'worker_edit' | 'csa_override';
    };
  };
}

// Then inside `UserProfile`:
//   workerAttestations?: WorkerAttestations;
```

The `transportMethod` and `availableToStartDate` fields stay where they are (`workerProfile.preferences.*`) — those are preferences, not attestations.

### File: `src/utils/workerReadinessWriteModel.ts`

Two extensions:

1. **Add the missing canonical mapping for `additionalScreenings`** when keyed dynamically. Already partially there (line 142); confirm the dynamic `comfortableWith<Name>` fallback at line 150 still routes correctly with the new typed shape.
2. **Stamp `_meta` provenance.** `buildCanonicalWorkerProfileWritePatch` accepts an optional `source` argument (default `'application'`); for each attestation key it writes, it also stamps `workerAttestations._meta.<key>.attestedAt = serverTimestamp()` and `.source = source`.

```ts
export function buildCanonicalWorkerProfileWritePatch(
  partial: AnyMap,
  options: { source?: WorkerAttestationSource } = {},
): AnyMap {
  const source = options.source ?? 'application';
  // ... existing logic ...
  for (const [legacyKey, canonicalKey] of Object.entries(ATTESTATION_KEY_MAP)) {
    if (partial[legacyKey] !== undefined) {
      setIfDefined(patch, canonicalKey, partial[legacyKey]);
      const fieldKey = canonicalKey.replace(/^workerAttestations\./, '');
      setIfDefined(patch, `workerAttestations._meta.${fieldKey}.attestedAt`, serverTimestamp());
      setIfDefined(patch, `workerAttestations._meta.${fieldKey}.source`, source);
    }
  }
  // same _meta stamping for additionalScreenings + dynamic comfortableWith*
}
```

### Verify (R.0a done = these are true)

- [x] `tsc` passes against `src/` (only pre-existing test-fixture drift errors remain; none touch R.0a paths)
- [x] `RequirementsAcknowledgementStep.tsx` consumers compile (no `any` regressions on attestation reads)
- [x] Greg verified the `WorkerAttestations` interface, `_meta` stamping across all three paths (static map, `additionalScreenings`, dynamic `comfortableWith*`), and `ATTESTATION_NOTE_KEYS` exclusion of the two notes fields
- [ ] **R.2 follow-up:** the dynamic `comfortableWith*` fallback in `workerReadinessWriteModel.ts` lowercases the suffix's first char (`comfortableWithTBTest → additionalScreenings.tBTest`) while direct `additionalScreenings` writes preserve original casing. Pre-existing inconsistency; surfaced during PR 1 review. Matchers in R.2 should normalize on read.
- [ ] **Manual smoke check (deferred to staging deploy):** a wizard submission writes both the value AND `workerAttestations._meta.<key>.attestedAt`

---

## R.0b — Server-side sync trigger

**Goal:** if the client-side `setDoc(userRef, ...)` at `Wizard.tsx:2447` is interrupted (network drop after the application doc is created but before the profile is written), a server-side trigger replays the canonical mapping. Profile and application doc never drift.

### File: `functions/src/triggers/onApplicationSubmittedSyncProfile.ts` (new — PR 2)

**As built (April 2026):** the trigger uses `onDocumentWritten` (not `onDocumentCreated`) so it covers BOTH first-time submits (no draft mirror) AND draft-→-submitted transitions. Gates on `after.status === 'submitted' && before?.status !== 'submitted'` to fire exactly once per submission. Mirrors the gating used by `onApplicationStatusChanged` in `applicationSmsTriggers.ts`.

The form-key → canonical-path mapping is duplicated inline rather than shared with `src/utils/workerReadinessWriteModel.ts`. The client builds via the legacy `comfortablePassDrug` etc. intermediary (because some callers pass legacy keys); the server reads `application.data.requirements.<formKey>` directly. Consolidation into `packages/contracts` is a TODO once the mapping stabilizes.

**Sketch (matches the as-built file):**

```ts
/**
 * Safety net for the client-side application → profile sync.
 *
 * Wizard.tsx:2447 writes `buildCanonicalWorkerProfileWritePatch(...)` to
 * the user doc client-side, then writes the application doc at
 * `tenants/{tenantId}/applications/{uid}_{jobId}`. If the network drops
 * between those two writes, the application exists but the profile is stale.
 *
 * This trigger fires on application doc creates and re-runs the canonical
 * mapping server-side. Idempotent: profile-wins-once-set means a second
 * run is a no-op when the profile already has values.
 */
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

export const onApplicationSubmittedSyncProfile = onDocumentCreated(
  'tenants/{tenantId}/applications/{appId}',
  async (event) => {
    const data = event.data?.data();
    if (!data) return;
    const uid: string | undefined = data.workerId ?? data.userId ?? data.uid;
    if (!uid) {
      logger.warn('onApplicationSubmittedSyncProfile: no uid on application', {
        appId: event.params.appId,
      });
      return;
    }

    const userRef = admin.firestore().doc(`users/${uid}`);
    const userSnap = await userRef.get();
    const existing = userSnap.data() ?? {};
    const existingAttestations = (existing.workerAttestations ?? {}) as Record<string, unknown>;

    // Build the patch from the application doc's recorded answers (D2:
    // profile-wins-once-set means we filter out any field that already
    // has a value on the profile).
    const patch = buildCanonicalWorkerProfileWritePatchFromApplication(data, {
      source: 'application',
      skipExisting: existingAttestations,
    });
    if (Object.keys(patch).length === 0) return;

    // D2 requires merge: true so partial patches don't stomp unrelated
    // profile fields (skills, work history, certifications, etc.).
    await userRef.set(patch, { merge: true });
    logger.info('onApplicationSubmittedSyncProfile synced', {
      uid,
      appId: event.params.appId,
      fieldsWritten: Object.keys(patch).length,
    });
  },
);
```

The helper `buildCanonicalWorkerProfileWritePatchFromApplication` is a thin server-side mirror of `buildCanonicalWorkerProfileWritePatch` (or, ideally, lives in `packages/contracts` so client + server share it; if that's too much for R.0b, duplicate inline and TODO the consolidation).

### Register in `functions/src/index.ts`

```ts
export { onApplicationSubmittedSyncProfile } from './triggers/onApplicationSubmittedSyncProfile';
```

### Verify (R.0b done = these are true)

- [x] Trigger uses `userRef.set(patch, { merge: true })` (admin SDK; dotted-path keys preserve nested-map writes for `additionalScreenings.<name>`)
- [x] Profile-wins-once-set filter implemented via `isAttestationSet(existing[fieldKey])` check in `buildAttestationsSyncPatchFromApplication` — fields with non-empty existing values are excluded before write
- [x] `_meta.<field>.source = 'application'` and `.attestedAt = FieldValue.serverTimestamp()` stamped on all newly-written attestation fields (notes excluded per `ATTESTATION_NOTE_CANONICAL_KEYS`, mirroring R.0a's `ATTESTATION_NOTE_KEYS`)
- [x] Idempotent: second write of the same application is a no-op because the first write populated the profile (D2 filter rejects everything on retry)
- [x] Trigger registered in `functions/src/index.ts` (next to the existing `onApplicationCreatedPush` export)
- [ ] **Manual smoke check (deferred to staging deploy):** submit an application with the client-side write disabled → `workerAttestations.*` should still populate on the user doc with `_meta.<field>.source === 'application'`
- [ ] **Manual smoke check (deferred to staging deploy):** worker re-applies after their attestations have been written → no values change on the profile (only `_meta` would update if we let it; current implementation is "skip the entire field", so `_meta` is also untouched on re-apply)

---

## R.0c — Backfill existing applications

**Goal:** every application doc submitted before R.0a/b shipped has the answers but the profile may not. R.0c walks them and populates.

### File: `functions/src/backfillWorkerAttestationsCallable.ts` (new — PR 3)

**Path note:** the spec sketched `functions/src/admin/...`, but the codebase convention is to keep `backfill*Callable.ts` files at `functions/src/` top-level (e.g. `backfillNationalAccountChildAccountsCallable.ts`, `backfillJobPostingLocations.ts`). Filed at the conventional location.

**As built (April 2026):**

- **Auth gate:** matches `backfillSlackChannels` — caller must have `securityLevel >= 7` AND `activeTenantId === request.data.tenantId`. The spec sketch said `>= 6`; existing backfill convention is stricter and this writes to many user docs, so we lean conservative. One-line change to relax later.
- **Reuses `buildAttestationsSyncPatchFromApplication`** from R.0b. The R.0b helper's `attestedAt` type was widened to `FieldValue | Timestamp | Date` so the backfill can pass the application's original `submittedAt`.
- **`attestedAt` source:** prefers `application.submittedAt`, falls back to `appliedAt`, then `createdAt`, then `FieldValue.serverTimestamp()` (only if all three are absent — should never happen on real submitted apps).
- **Submitted-only filter:** apps without `submittedAt` (drafts, deletes-in-progress) are skipped via `appHasBeenSubmitted()`. We use the timestamp's presence as the gate rather than a status enum because the application status field has churned through several values over time (`submitted`, `reviewing`, `hired`, etc.).
- **Pagination:** doc-id cursor. Default `limit: 1000`, max `5000`. Response includes `truncated: boolean` and `nextPageToken: string | null` for resuming.
- **Concurrency:** 10 parallel user-doc reads + writes per chunk, sequenced across chunks. Bounds Firestore fan-out without serializing all 1000 ops.
- **Per-app error attribution:** errors are caught per-app and surfaced in `report.errors[]` rather than crashing the whole run.
- **Function options:** `timeoutSeconds: 540`, `memory: '1GiB'`, `maxInstances: 1` (single-tenant; no need for parallelism across instances).

**Sketch (matches the as-built file):**

```ts
/**
 * Admin-callable backfill: for each application doc under
 * `tenants/{tenantId}/applications/*`, replay the canonical mapping
 * onto the worker's user doc with `source = 'application_backfill'`
 * and `attestedAt = application.submittedAt ?? application.createdAt`.
 *
 * Dry-run is default. Set `dryRun: false` to actually write.
 */
export const backfillWorkerAttestationsCallable = onCall(
  { /* admin auth check; security level >= 6 */ },
  async (request) => {
    const tenantId = String(request.data?.tenantId ?? '').trim();
    const dryRun = request.data?.dryRun !== false; // default TRUE
    const limit = Number.isFinite(request.data?.limit) ? Number(request.data.limit) : 1000;

    const apps = await admin.firestore()
      .collection(`tenants/${tenantId}/applications`)
      .limit(limit)
      .get();

    const report = {
      tenantId,
      dryRun,
      scanned: apps.size,
      wouldWrite: 0,
      written: 0,
      skipped_profile_already_set: 0,
      errors: [] as Array<{ appId: string; error: string }>,
    };

    for (const appDoc of apps.docs) {
      try {
        // ... build patch, check profile, conditionally write ...
        // Tag every field with source: 'application_backfill'
        // attestedAt: prefer application.submittedAt, fall back to application.createdAt, then to now()
      } catch (e) {
        report.errors.push({ appId: appDoc.id, error: String(e) });
      }
    }

    return report;
  },
);
```

Per-tenant scoping is intentional. To backfill all tenants, run the callable once per tenant.

### CLI wrapper: `scripts/backfillWorkerAttestations.js`

Browser console invocation works for the first dry-run, but the call needs to be repeatable (dry-run → real write → idempotency confirm) and pagination-resumable when `truncated: true` comes back. The CLI script wraps the same query + loop + report shape, runs server-side under the existing service-account auth pattern (`GOOGLE_APPLICATION_CREDENTIALS`), and imports `buildAttestationsSyncPatchFromApplication` from the compiled functions output so the D2 filter stays single-sourced.

```bash
# Prereq: build functions so the helper module exists
cd functions && npm run build && cd ..

# 1. Dry run — get a sense of scale + scan for errors
node scripts/backfillWorkerAttestations.js \
  --tenant=BCiP2bQ9CgVOCTfV6MhD \
  --dry-run \
  --limit=1000 \
  > .scratch/backfill-attest-dryrun-1.json

# 2. Eyeball the report; sign off; actual write
node scripts/backfillWorkerAttestations.js \
  --tenant=BCiP2bQ9CgVOCTfV6MhD \
  --no-dry-run \
  --limit=1000 \
  > .scratch/backfill-attest-write-1.json

# 3. Idempotency check — re-run with --no-dry-run; should be a no-op
node scripts/backfillWorkerAttestations.js \
  --tenant=BCiP2bQ9CgVOCTfV6MhD \
  --no-dry-run \
  --limit=1000 \
  > .scratch/backfill-attest-idempotency-1.json

# Pagination resumption (when truncated: true on a prior response):
node scripts/backfillWorkerAttestations.js \
  --tenant=BCiP2bQ9CgVOCTfV6MhD \
  --dry-run \
  --limit=1000 \
  --page-token=<nextPageToken-from-prior-response>
```

Behavior contract:

- **Defaults:** `--dry-run` is true; pass `--no-dry-run` to actually write — symmetric with the callable.
- **stdout** is the full report as a single JSON object (machine-parseable).
- **stderr** is a one-line scannable summary: `tenant=… dryRun=… scanned=… candidates=… wouldWrite=… written=… skipped_profile_already_set=… errors=… truncated=… nextPageToken=…`.
- **Exit codes:** `0` on clean run, `1` if `errors.length > 0`, `2` for bad invocation (missing `--tenant`, unknown flag, missing helper module).
- **Auth bypass:** SA creds skip the callable's `securityLevel >= 7` gate by design — that gate protects end-user UI invocations; an offline operator running with SA creds is the equivalent of "the admin running it from the console."

#### Idempotency arithmetic (re-run #3 acceptance)

After a successful `--no-dry-run`, the next `--no-dry-run` on the same input MUST return:

- `written === 0` (or equivalently `wouldWrite === 0` if you re-run as `--dry-run`)
- `skipped_profile_already_set` ≈ `candidates` from the prior run
- `errors === []`

If a follow-up `--no-dry-run` ever shows `written > 0`, the D2 profile-wins-once-set filter let something through twice — that's a real bug, flag immediately. The audit trail is the JSON reports stashed in `.scratch/`.

### Verify (R.0c done = these are true)

- [x] Reuses the R.0b patch builder (`buildAttestationsSyncPatchFromApplication`) so backfill and live-trigger writes go through the same D2 filter and `_meta` stamping logic
- [x] `attestedAt` sourced from `application.submittedAt` → `appliedAt` → `createdAt` → `FieldValue.serverTimestamp()`
- [x] All written fields tagged with `source: 'application_backfill'`
- [x] `dryRun: true` is the default; the only way to actually write is `dryRun: false`
- [x] Auth gate enforced (`securityLevel >= 7` AND active tenant matches)
- [x] Pagination via doc-id cursor (`nextPageToken` in response when truncated)
- [x] Per-app error attribution in `report.errors[]`
- [x] Registered in `functions/src/index.ts`
- [ ] **Manual smoke check (deferred to staging deploy):** run with `dryRun: true` first → confirm `wouldWrite` count is sane and `errors[]` is empty
- [ ] **Manual smoke check (deferred to staging deploy):** run with `dryRun: false` → confirm `_meta.<field>.source === 'application_backfill'` on a sampled written user doc, AND `_meta.<field>.attestedAt` matches the original application's `submittedAt` (NOT a write-time `now()` value)
- [ ] **Manual smoke check (deferred to staging deploy):** re-run with `dryRun: false` → second run reports `wouldWrite: 0` / `written: 0` / `skipped_profile_already_set` equal to `candidates` from the first run (idempotency)

---

## R.0d — Soft-deprecate three confirmed JO fields

**Goal:** stop new writes and clean up UI for three confirmed-unused JO fields, without destroying any existing Firestore data. Promotion to hard-remove is a separate ticket in ~90 days after observing no issues.

### In scope (this PR)

| Field | Reason | Action |
|---|---|---|
| `drugScreeningPanels` | Subsumed by AccuSource package + `additionalScreenings` | Drop from type + UI |
| `additionalTrainingRequired` | Unused | Drop from type + UI |
| `onboardingRequirements` | Covered by Everee employee-readiness layer | Drop from type + UI |

### Out of scope (separate audit ticket — `READINESS_R0_LEGACY_FIELDS_AUDIT.md` follow-up)

| Field | Why deferred |
|---|---|
| `siteSpecificOrientation` | Informational, may hold legacy data — verify before touching |
| `vehicleRequirements` | Informational, may hold legacy data — verify before touching |
| `healthAttestations` | Conceptually subsumed by `additionalScreenings`, but legacy data may need migration rather than destruction |

These three are explicitly **left alone** in PR 1. The follow-up audit should: (1) confirm whether each field exists with non-empty data on any JO, (2) for fields with data, propose a migration plan (e.g. fold `healthAttestations` entries into `additionalScreenings`), (3) for fields without data, promote to soft-deprecate then hard-remove on the same 90-day clock.

### Approach: `@deprecated` JSDoc + write-surface removal — no consumer cascade

**Scope adjustment (April 2026):** the initial spec said "drop from type, then chase consumers." An audit during PR 1 revealed ~26 live consumers with ~110 references — including load-bearing paths (account-defaults cascade merge, AI job-description prompt builder, placement compute, screening-signals derivation). Removing those reads is exactly the silent-breakage risk D4 was flipped to avoid. Adjusted approach below preserves D4's intent.

1. **Type cleanup** — keep the three fields in `src/types/recruiter/jobOrder.ts` but mark each with `@deprecated` JSDoc that points at this doc. IDE renders strikethrough on every read site → "no new use" achieved without compile cascade.
2. **Write-surface removal** — remove the three fields from these UI surfaces only:
   - `src/components/JobOrderForm.tsx` (Compliance & Requirements + Onboarding form sections)
   - `src/components/DealStageForms.tsx` (deal scoping stage that seeds JO drafts)
   - `src/components/recruiter/AccountOrderDetailsForm.tsx` (account-level defaults that cascade into new JOs)
   - `RequirementsSummary` in `src/components/shifts/ShiftPlacementsDrawer.tsx` (read-side display tied to the form)
3. **Read-site policy** — leave all other read sites untouched. They render nothing on JOs without the fields (which is the new normal post-form-removal); existing JOs with data continue to render unchanged. The `@deprecated` markup makes every read site a reviewable IDE warning for the 90-day audit.
4. **No migration script.** Existing data on JO docs stays put. New JO writes won't include the fields (forms don't bind them anymore), so the fields just stop accumulating.
5. **Index check** — confirm no Firestore indexes reference the three fields. If any do, leave them (deleting indexes for soft-deprecated fields is a hard-remove concern).

### Verify (R.0d done = these are true)

- [ ] `tsc` passes (no type churn — fields stay typed)
- [ ] Each of the three fields in `src/types/recruiter/jobOrder.ts` carries an `@deprecated` JSDoc tag with a doc link
- [ ] `JobOrderForm.tsx` no longer renders inputs or write paths for the three fields
- [ ] `DealStageForms.tsx` no longer binds the three fields in the deal scoping stage
- [ ] `AccountOrderDetailsForm.tsx` no longer binds the three fields in account-level defaults
- [ ] `RequirementsSummary` in `ShiftPlacementsDrawer.tsx` no longer displays them
- [ ] Existing JO docs in Firestore are untouched (no migration ran)
- [ ] A `READINESS_R0_LEGACY_FIELDS_AUDIT.md` ticket exists covering the three deferred informational fields

---

## Out of scope for R.0 (deferred to R.1+)

- New requirement types in the readiness seeder (physical / uniform / PPE / languages willingness) → **R.2**
- CSA confirm/waive endpoints for non-AccuSource items → **R.3**
- Aggregate ready/blocked compute on placement tiles → **R.4**
- E-Verify TNC contestation UI + USCIS contest endpoint → **R.5**
- AccuSource adjudication matrix UI → **R.6**
- Worker-facing readiness chips and tab → **R.7**
- CSA cross-worker matrix → **R.8**
- Flutter profile-edit UI → **R.9**

---

## Order of operations (signed off)

1. **PR 1** — R.0a (types + canonical mapping `_meta` stamping) **+** R.0d (soft-deprecate three confirmed JO fields). **MERGED + verified clean (April 2026).**
2. **PR 2** — R.0b (server-side sync trigger). Uses the typed shape + `_meta` stamping from R.0a. **READY FOR REVIEW (April 2026).**
3. **PR 3** — R.0c (backfill callable). Uses the trigger logic from R.0b. Dry-run on the single tenant first; only write after Greg signs off on the dry-run report. **READY FOR REVIEW (April 2026).**

Greg reviews per-PR before the next PR starts.

---

## Resolved questions (logged for posterity)

1. **Backfill scale per tenant** — single tenant; low-thousands of application docs at most. Default `limit: 1000` is fine. **Follow-up flag:** if a dry-run report ever shows `>1000` candidates, R.0c should be re-run with a higher limit and/or paginated, and we should reassess whether to add cursor-based batching.
2. **Multi-tenant workers** — N/A (single-tenant today). Backfill stays per-tenant scoped for forward compatibility.
3. **`workerAttestations._meta` vs flat siblings** — sidecar (D1 locked).
4. **Hard-remove vs soft-deprecate JO fields** — soft-deprecate (D4 flipped). Three confirmed fields only; three informational fields deferred to a separate audit ticket.

---

## Cross-references

- `Readiness System Rebuild — Planning Notes` — parent planning doc.
- `src/types/UserProfile.ts:62` — current UserProfile shape.
- `src/utils/workerReadinessWriteModel.ts:9` — current `ATTESTATION_KEY_MAP`.
- `src/components/apply/Wizard.tsx:2447` — current client-side profile write site.
- `src/components/apply/steps/RequirementsAcknowledgementStep.tsx` — attestation answer source.
- `functions/src/integrations/everify/readinessStatusFromEverify.ts` — E-Verify status mapping (R.5 reference).
- `functions/src/integrations/accusource/accusourceAdjudication.ts` — AccuSource verdict logic (R.6 reference).

---

## Apr 26 2026 — Post-mortem: Admin SDK `set/merge` + dotted-key bug

**Status:** Resolved. Production data integrity restored on tenant `BCiP2bQ9CgVOCTfV6MhD`. Fix deployed to live trigger; cleanup migration ran clean; R.0c idempotency confirmed `written=0`.

### What happened

R.0c shipped per spec, dry-run reviewed and signed off, write phase ran 1054 user updates. Step 4 of the verification cadence (idempotency re-run) reported **`written=446`** — D2 had failed to filter previously-written candidates. That triggered diagnosis.

Probing user docs revealed the actual write shape: instead of populating the nested `workerAttestations` map, the trigger and CLI script had been writing top-level fields whose **literal names contained dots**, e.g.

```
"workerAttestations.eVerifyWillingness": "Yes"
"workerAttestations._meta.eVerifyWillingness.source": "application_backfill"
"workerAttestations._meta.eVerifyWillingness.attestedAt": <Timestamp>
```

The nested `workerAttestations` map remained empty, so D2's read-side check (`isAttestationSet(profile.workerAttestations[field])`) saw `undefined` every time and let every candidate write through on every run.

### Root cause

The Firebase Admin SDK and the Web Client SDK have **opposite semantics** for `set(data, { merge: true })` when the data object's keys are dotted strings:

| SDK | `set({ 'a.b': 'x' }, { merge: true })` |
|---|---|
| **Admin** (`firebase-admin/firestore`) | Writes a LITERAL top-level field named `'a.b'` with value `'x'`. |
| **Web Client** (`firebase/firestore` v9+) | Writes the nested path `a.b = 'x'`. |

`update({ 'a.b': 'x' })` on Admin SDK works the way you'd expect — dotted keys ARE field paths. Only `set/merge` has the literal-field semantics.

The trigger code was pattern-matched from `src/components/apply/Wizard.tsx:2447`, which uses the Web Client SDK. The pattern looked identical and was approved at review on both sides. Two SDKs, identical-looking syntax, opposite semantics — a classic Firebase footgun.

### Blast radius

Bounded to tenant `BCiP2bQ9CgVOCTfV6MhD` (single-tenant production today). Probed via `scripts/probeBlastRadius.js` (since deleted) and the cleanup script's first dry-run pass:

- **1,175 user docs** with one or more literal-dotted `workerAttestations.*` top-level fields.
- **10,712 garbage fields** total across those docs.
- 119 of the 1,175 were R.0b live-trigger pollution, not R.0c — applications submitted between the R.0b deploy and the discovery moment.

### Fix sequence (A → D)

| Step | Action | Outcome |
|---|---|---|
| **A — Stop the bleed** | Patched `onApplicationSubmittedSyncProfile.ts` with a kill-switch (`logger.warn` + early return). Deployed to prod. | Live trigger no longer corrupting new submissions. |
| **B — Fix the bug** | Replaced `userRef.set(patch, { merge: true })` with `userRef.update(patch)` in `onApplicationSubmittedSyncProfile.ts` and `scripts/backfillWorkerAttestations.js`. Audited `functions/src/` for other consumers; found and fixed `functions/src/parentChildCompanies.ts` (CRM company relationships — same set/merge + dotted-key pattern, transformed to nested object structure). `functions/src/gmailBulkImport.ts` audited and confirmed safe (uses `update()`). Added emulator integration test `functions/src/__tests__/firestore/adminSdkSetMergeDottedKeys.test.ts` that pins both the broken `set/merge` semantics AND the correct `update()` semantics so future-us can't accidentally regress. Deployed all fixed functions (`onApplicationSubmittedSyncProfile`, `registerChildCompany`, `setCompanyRelationship`, `removeCompanyRelationship`). | Bug fixed at source; regression test in place. |
| **C — Cleanup migration** | Wrote `scripts/cleanupLiteralDottedAttestationKeys.js` — iterates `users/*`, deflates literal-dotted `workerAttestations.*` keys into the nested map, deletes the literal keys. **D2-reverse semantics:** existing nested values always win at every depth (preserves the 122 dual-state users' client-side wizard writes). Single nested write per user via `update('workerAttestations', mergedTarget, FieldPath('literal.dotted.key'), FieldValue.delete(), …)` — this avoids parent/child conflicts that single-update Firestore rejects (e.g. when a user has both `workerAttestations.additionalScreenings` and `workerAttestations.additionalScreenings.<sub>`). Dry-run → write across 3 pages: **1,175 users cleaned, 9,758 fields deflated, 504 dropped (D2-reverse preserve), 0 errors.** Idempotency re-run dry: 0 dirty users across all 2,242 docs. | Existing pollution fully eradicated. |
| **D — Re-run R.0c** | R.0c with `--no-dry-run` against tenant `BCiP2bQ9CgVOCTfV6MhD`. Two pages, 2,268 applications scanned, 1,414 candidates. **`written=0`** on both pages — D2 caught every candidate after Step C. 0 errors. | R.0c is now idempotent in prod. |

### Final state

- R.0b live trigger writes correctly via `userRef.update()`.
- R.0c CLI script writes correctly via `userRef.update()`.
- `functions/src/parentChildCompanies.ts` no longer uses dotted-key set/merge.
- Emulator integration test gates future regressions on this exact pattern.
- Production tenant has zero literal-dotted `workerAttestations.*` keys.
- Re-running R.0c is a no-op.

### Lessons / guardrails

1. **SDK semantics differ between Admin and Web.** When pattern-matching write logic from client → server (or vice versa), `set/merge + dotted keys` is a deliberate verification step — never a skim. The integration test at `functions/src/__tests__/firestore/adminSdkSetMergeDottedKeys.test.ts` exists specifically to catch this in CI.
2. **Default to `update()` server-side for partial patches with field paths.** It interprets dotted keys as field paths under both SDKs and never silently mints literal-dotted top-level fields. Use `set(data, { merge: true })` only with **fully nested** patch objects (no dotted-string keys at all) when you specifically need create-or-merge semantics.
3. **The R.0c verification cadence (dry-run → sign-off → write → idempotency-check) is what caught this.** The bug was already in production for the duration of R.0b, but the idempotency tick in Step 4 of R.0c made it surface as a hard signal instead of a slow data-quality drift. Keep the cadence on every backfill.
4. **D2's read-side check was correct but the write-side never produced a value the read could see.** When designing idempotency filters, sanity-check that the field path the writer is targeting matches the field path the reader is checking — not just the variable name.

### Cross-references for the post-mortem

- `functions/src/triggers/onApplicationSubmittedSyncProfile.ts` — fixed live trigger (current).
- `scripts/backfillWorkerAttestations.js` — fixed CLI (current).
- `scripts/cleanupLiteralDottedAttestationKeys.js` — Step C migration (kept for reference; idempotent so safe to re-run).
- `functions/src/parentChildCompanies.ts` — adjacent fix in same audit pass.
- `functions/src/__tests__/firestore/adminSdkSetMergeDottedKeys.test.ts` — emulator integration test pinning the SDK semantic.

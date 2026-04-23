# Phase 6 — Real certification requirement sources (engineering map)

Short map of where **legacy string lists** feed certification gating today, before full automation.

## A. Public job postings (worker apply / jobs board)

- **`licensesCerts`**: string array on the posted job (see `JobsBoardPost` / `jobsBoardService`, `JobPostingDetail`, `PublicJobsBoard`).
- **Shown in apply flows** via `getRequirementsWithStatus` → category `licensesCerts` when `posting.showLicensesCerts` (`jobRequirementStatus.ts`).
- **Gap check**: `PublicJobsBoard` calls `checkMissingCertificationsWithEngine({ requiredCerts: selectedJob.licensesCerts, ... })`.

## B. Job orders (recruiter)

- **`requiredCertifications`**, **`requiredLicenses`**: `JobOrder` in `src/types/recruiter/jobOrder.ts`.
- **`requiredCertificationComplianceIds`**: optional Firestore `worker_compliance_items` ids; placement allowlist uses them (`placementQualificationChipsModel.ts`); **not** mapped to catalog strings in Phase 6 adapters (reserved for later id→catalog bridge).
- **Synthetic demands**: `mergeJobOrderSyntheticCertificationDemands` / `jobOrderSyntheticCertificationDemands.ts` when readiness rows omit a required cert.

## C. Assignments / placement

- **No separate cert array on assignment** in Phase 6: requirements come from the **linked job order** (`assignment.jobOrderId` → load `JobOrder` document).
- **Placement tiles**: `PlacementsTab` loads JO per assignment and runs `buildCertificationRequirementsFromJobOrder` → `computeEngineGapForPhase1Requirements` (shadow compare vs legacy in dev).
- **Blockers**: `selectPlacementBlockerLabelsWithOptionalEngine` merges snapshot non-cert blockers + engine cert labels.

## D. Legacy gating entry points (client)

| Surface | Role |
|--------|------|
| `checkMissingCertifications` / `checkMissingCertificationsWithEngine` | String match vs profile; engine path when `REACT_APP_CERT_ENGINE_READINESS` |
| `placementQualificationChipsModel` | Which `cert_*` keys count as red blockers vs JO strings |
| `readinessSnapshotV1` / HRX snapshots | Backend-built; client reads `requirements[]` |
| `evaluateCertificationsForLegacyRequirementStrings` | Bridge legacy strings → `Phase1CertificationRequirement[]` → engine |
| `mapCertificationEvaluationsToActionItems` / profile overview | Action items (separate from this adapter layer) |

## Adapters (Phase 6)

Canonical construction lives in `buildCertificationRequirementsFromLegacyStrings.ts` (manifest resolve, unmapped logging). Per-source modules **extract** the right string arrays from posting / job order / assignment+JO and delegate there.

## Shadow telemetry (Phase 6b)

- **Collection:** `cert_engine_shadow_events` — append-only; **create** = any authenticated client; **read** = `isHRX()` only.
- **Writes:** `REACT_APP_CERT_SHADOW_PERSISTENCE=true`; **100%** of mismatches + **20%** sample of matches (`CERT_ENGINE_SHADOW_SAMPLE_RATE`); gated with engine readiness.
- **Stats:** `buildCertificationShadowStats.ts` (pure); query hook `useCertificationShadowStats`; dev-only `CertEngineShadowDebugPanel` when `NODE_ENV=development` only (lazy-loaded in `App.tsx`, not in production bundle).
- **Automation gate (before Phase 7):** mismatch rate **&lt; 5–10%** over a solid sample, no dominant unmapped strings, critical certs not over-represented — see `buildCertificationShadowStatsThresholds.ts`.

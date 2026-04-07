# Placement cert blockers vs. required-cert snapshot gap

## Distinction (locked product understanding)

### What the current pass fixes (web / placement UI only)

- **Placement red chips** read existing `readinessSnapshotV1.requirements` and **filter** them with an **explicit allowlist**:
  - `hard_block` (minus payroll/tax/handbook/policies denylist),
  - screening keys `background_check` and `drug_screen` only,
  - `cert_*` rows **only** when the certification is **job-order required** (via `requiredCertifications` / `requiredLicenses` label matching and optional `requiredCertificationComplianceIds`),
  - future keys via `PLACEMENT_BLOCKER_EXPLICIT_EXTRA_KEYS`.
- **`readinessSnapshotV1` schema is unchanged** — no new fields on the snapshot document.

Placement chips still use an explicit allowlist; compliance-backed `cert_<docId>` rows only appear when a matching item exists. **Backend synthesis** (below) adds `cert_required_*` rows when the JO demands a cert/license but there is **no** matching compliance row.

### Backend synthesis (implemented)

- `functions/src/readiness/hrxReadinessSnapshotLoadContext.ts` calls `mergeJobOrderSyntheticCertificationDemands` (`src/shared/jobOrderSyntheticCertificationDemands.ts`) after building `certifications` from `worker_compliance_items`.
- Synthetic rows use inner keys `required_${slug}` → snapshot keys **`cert_required_${slug}`** (via `buildAssignmentReadiness`), `category: certification`, `status: missing`, `severity: warning`, `label` from the JO string or explicit id.
- Placement allowlist (`buildPlacementRequiredCertSuffixAllowlist`) adds `required_${stableCertRequiredSlug(...)}` for each JO id and each human requirement string so incomplete `cert_required_*` rows surface as red chips.

---

## Algorithm summary (implemented)

1. **Demand sources:** `requiredCertificationComplianceIds[]`, `requiredCertifications[]`, `requiredLicenses[]` on the assignment’s job order (`fetchJobOrderDataForReadiness`).
2. **Id demands first:** For each explicit id, if no compliance row with `key === id`, append synthetic `{ key: required_${slug(id)}, label: id, complete: false }`.
3. **String demands second:** For each cert/license string, if no compliance row matches via `certLabelMatchesJobOrderRequirement` (same rules as placement substring ≥ 4), append synthetic with that display string.
4. **`buildAssignmentReadiness`** maps inner `required_*` → requirement key `cert_required_*`; category `certification`, severity `warning`, status `missing` when `complete: false`.

---

## References

- Snapshot contract: [`READINESS_SNAPSHOT_V1.md`](./READINESS_SNAPSHOT_V1.md)
- Placement filter (UI): `src/utils/placementQualificationChipsModel.ts`
- Server cert input: `functions/src/readiness/hrxReadinessSnapshotLoadContext.ts` — compliance rows + `mergeJobOrderSyntheticCertificationDemands`
- Engine: `src/shared/buildAssignmentReadiness.ts` (`cert_${c.key}`)

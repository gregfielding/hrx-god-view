# Certifications — Final state (locked)

Concise reference for what exists today and what does not. **[No new features / no automation](.cursor/rules)** in the lock phase: this doc is descriptive only.

## 1. What exists

| Area | Role |
|------|------|
| **`users/{uid}/certification_records`** | Canonical storage for worker certifications (Phase 1 schema). |
| **Certification engine** | `evaluateCertificationRequirement.ts` + `evaluateCertificationsForRequirements.ts` — single evaluation contract (`certificationEnums.ts`). |
| **Requirement adapters** | Map job posting / job order / assignment strings → `Phase1CertificationRequirement[]` (see `buildCertificationRequirementsFrom*`, `PHASE6_REQUIREMENT_SOURCES.md`). |
| **Shadow telemetry** | Optional Firestore `cert_engine_shadow_events` + dev-only stats panel (see `certEngineShadowTelemetryConstants.ts`, `CertEngineShadowDebugPanel`). |

**Reads:** `getCanonicalCertificationRecords` / `getCanonicalCertificationRecordsWithIds` (required entry point for product logic).

**Writes:** `createOrUpdateCertificationRecord` as the primary entry point for canonical writes; dual-write/delete helpers sit alongside.

**Feature flags (stable):**

- `REACT_APP_CERT_ENGINE_READINESS`
- `REACT_APP_CERT_ENGINE_ACTION_ITEMS`
- `REACT_APP_CERT_ENGINE_TRUST_SURFACES`
- `REACT_APP_CERT_SHADOW_PERSISTENCE`
- `REACT_APP_CERT_RECORDS_DUAL_WRITE` (operational dual-write, not a “surface” flag)

**Aggregate helper:** `isCertificationEngineEnabled()` — true if readiness **or** action items **or** trust surfaces is on.

## 2. What is NOT used anymore for decisioning

- **String matching alone** as the long-term source of truth for “does this worker meet this cert?” — engine + canonical records supersede for gated surfaces.
- **`user.certifications` alone** for new product logic — legacy field may still exist for migration/UI; new paths should use canonical reads + dev warns when legacy is touched (see `warnLegacyCertUsageDetected`).
- **Package-style thinking** for certifications as a product model — packages apply to screenings/order flows, not to the certification catalog contract.

## 3. What certifications DO in the system

- **Readiness signals** — where engine + flags are enabled.
- **Action items** — when `REACT_APP_CERT_ENGINE_ACTION_ITEMS` is on.
- **Recruiter trust signals** — when trust surfaces flag is on.
- **Workforce intelligence** — panels/hooks built on the same records + engine outputs.

## 4. What certifications DO NOT do (yet)

- No **automated blocking** or **auto-reject** from the cert engine alone.
- No **auto-advance** hiring decisions driven only by certs.
- No **standalone hiring decisions** — scores and chips are signals, not policy.

## 5. Future phases (brief)

- **Phase 7:** Optional **gating** (explicit product policy + monitoring).
- **Phase 8:** Deeper **automation** / ordering / onboarding hooks — only after shadow parity and governance sign-off.

---

*Enum and engine files carry “LOCKED” headers; change only with version bump, migration, and test updates.*

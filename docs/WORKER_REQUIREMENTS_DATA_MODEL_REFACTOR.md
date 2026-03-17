# WORKER REQUIREMENTS DATA MODEL REFACTOR

## Goal

Define a canonical Firestore model that cleanly separates:

1. durable worker profile facts,
2. application-specific answers,
3. verified compliance and screening results.

This prevents willingness answers from being interpreted as completed compliance.

## Current Anti-Pattern

Current web flow writes fields such as:

- `users/{uid}.comfortablePassBackground`
- `users/{uid}.comfortablePassDrug`
- `users/{uid}.comfortableEVerify`

Then requirement UI computes "met/green" from these willingness fields in `src/utils/jobRequirementStatus.ts`.

This creates false completion states for background/drug/E-Verify.

---

## Canonical Data Domains

## 1) Durable Worker Profile Facts

Document:

- `users/{uid}`

Recommended durable namespaces:

- `workerProfile.identity.*`
- `workerProfile.contact.*`
- `workerProfile.location.*`
- `workerProfile.skills[]`
- `workerProfile.languages[]`
- `workerProfile.education[]`
- `workerProfile.certifications[]`
- `workerProfile.workExperience[]`
- `workerProfile.preferences.*`

Examples:

- `users/{uid}.workerProfile.skills[]`
- `users/{uid}.workerProfile.languages[]`
- `users/{uid}.workerProfile.preferences.shiftPreferences[]`
- `users/{uid}.workerProfile.preferences.transportMethod`

Notes:

- Keep existing top-level legacy fields during migration, but declare them read-only compatibility mirrors.

## 2) Application-Specific Answers

Document:

- `tenants/{tenantId}/applications/{applicationId}`

Recommended answer namespace:

- `answers.requirements.*` (or keep `data.requirements.*` as compatibility and add canonical alias)

Examples:

- `tenants/{tenantId}/applications/{id}.answers.requirements.backgroundCheck.willingness`
- `tenants/{tenantId}/applications/{id}.answers.requirements.drugScreen.willingness`
- `tenants/{tenantId}/applications/{id}.answers.requirements.eVerify.willingness`
- `tenants/{tenantId}/applications/{id}.answers.requirements.additionalScreenings.{screeningName}.willingness`
- `tenants/{tenantId}/applications/{id}.answers.requirements.transportMethod`

Notes:

- These answers are scoped to this application, this posting, this requirement context.
- They should not directly set verified status.

## 3) Verified Compliance / Screening Results

Documents (existing):

- `users/{uid}.onboarding.checklist.*` (status-driven compliance)
- `users/{uid}.backgroundCheckOrders[]`
- `users/{uid}.drugScreeningOrders[]`
- `users/{uid}.additionalScreeningOrders[]`
- `users/{uid}.eVerifyOrders[]`

Optional normalized namespace (recommended additive):

- `users/{uid}.workerCompliance.*`

Example normalized fields:

- `users/{uid}.workerCompliance.backgroundCheck.status` (`missing|ordered|in_progress|passed|failed|expired`)
- `users/{uid}.workerCompliance.backgroundCheck.lastCompletedAt`
- `users/{uid}.workerCompliance.drugScreen.status`
- `users/{uid}.workerCompliance.eVerify.status`
- `users/{uid}.workerCompliance.vaccination.{requirementKey}.status`

Green completion states must only read from this domain.

---

## Canonical Field Path Proposal

For minimum disruption, use additive nested paths while keeping current payloads:

- Durable facts
  - `users/{uid}.workerProfile.*`
- Attestations (willingness/self-report)
  - `users/{uid}.workerAttestations.*`
- Verified compliance
  - `users/{uid}.workerCompliance.*`
- Application answers
  - `tenants/{tenantId}/applications/{id}.answers.*`

### Attestation namespace examples

- `users/{uid}.workerAttestations.backgroundCheck = { willingness: 'yes|no|maybe', explanation, answeredAt, sourceApplicationId }`
- `users/{uid}.workerAttestations.drugScreen = { willingness: 'yes|no|maybe', explanation, answeredAt, sourceApplicationId }`
- `users/{uid}.workerAttestations.eVerify = { willingness: 'yes|no|maybe', answeredAt, sourceApplicationId }`
- `users/{uid}.workerAttestations.additionalScreenings.{slug} = { willingness, answeredAt, sourceApplicationId }`

### Compliance namespace examples

- `users/{uid}.workerCompliance.backgroundCheck = { status: 'passed', verifiedAt, providerOrderId, packageName }`
- `users/{uid}.workerCompliance.drugScreen = { status: 'passed', verifiedAt, providerOrderId, panelName }`
- `users/{uid}.workerCompliance.eVerify = { status: 'employment_authorized', verifiedAt, caseId }`
- `users/{uid}.workerCompliance.vaccination.covid19 = { status: 'verified', verifiedAt, expiresAt }`

---

## Explicit Category Examples

## Background checks

- Application answer:
  - `applications/{id}.answers.requirements.backgroundCheck.willingness = 'yes'`
- Attestation mirror:
  - `users/{uid}.workerAttestations.backgroundCheck.willingness = 'yes'`
- Verified record:
  - `users/{uid}.workerCompliance.backgroundCheck.status = 'passed'`
- UI rule:
  - Green only from `workerCompliance.backgroundCheck.status in ['passed','verified']`.

## Drug screens

- Application answer:
  - `applications/{id}.answers.requirements.drugScreen.willingness`
- Attestation mirror:
  - `users/{uid}.workerAttestations.drugScreen.*`
- Verified record:
  - `users/{uid}.workerCompliance.drugScreen.*` or `drugScreeningOrders[]`.
- UI rule:
  - "Willing" is not "Complete".

## E-Verify

- Application answer:
  - `applications/{id}.answers.requirements.eVerify.willingness`
- Attestation mirror:
  - `users/{uid}.workerAttestations.eVerify.willingness`
- Verified record:
  - `users/{uid}.workerCompliance.eVerify.status` and/or `eVerifyOrders[]`.

## Certifications

- Durable profile fact/evidence:
  - `users/{uid}.workerProfile.certifications[]`
  - each object contains `name`, optional `fileUrl`, optional `issuer`, optional `expirationDate`
- Verified compliance:
  - `users/{uid}.workerCompliance.certifications.{certSlug}.verificationStatus`
- Application snapshot:
  - `applications/{id}.data.qualifications.certifications[]`

## Vaccine requirements

- Application answer:
  - `applications/{id}.answers.requirements.additionalScreenings['COVID-19 Vaccine'].willingness`
- Verified compliance:
  - `users/{uid}.workerCompliance.vaccination.covid19.status`
- No path should infer verified vaccine completion from willingness.

## Skills

- Durable profile fact:
  - `users/{uid}.workerProfile.skills[]`
- Application snapshot:
  - `applications/{id}.data.qualifications.skills[]`
- Verified compliance:
  - Not applicable.

---

## Read Model Rules

- Requirement readiness for apply buttons:
  - use application answers for answer-required prompts,
  - use profile durable facts for fact requirements,
  - use compliance records for verified checks.
- Compliance badges and green chips:
  - read only compliance domain (`onboarding.checklist`, screening orders, normalized compliance map).
- Never compute compliance completion from `workerAttestations` or `comfortable*` fields.

---

## Migration Strategy (No Code Change Yet)

1. Introduce new namespaces (`workerProfile`, `workerAttestations`, `workerCompliance`, `answers`) as additive fields.
2. Start dual-write from existing flows:
  - keep legacy fields,
  - write canonical fields alongside.
3. Switch read paths for requirement/compliance UI to canonical fields.
4. Backfill historical data:
  - map `comfortable*` to `workerAttestations.*.willingness`,
  - do not map them to compliance completion.
5. Remove old read dependencies on `comfortablePassBackground`, `comfortablePassDrug`, `comfortableEVerify` in requirement met logic.

---

## Non-Negotiable Product Rule

- "Willing to do background check/drug screen/E-Verify" is attestation only.
- "Completed background check/drug screen/E-Verify" requires verified compliance/order/checklist evidence.
- Green UI is reserved for verified compliance only.

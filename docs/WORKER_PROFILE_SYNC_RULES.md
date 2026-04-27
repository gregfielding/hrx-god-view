# WORKER PROFILE SYNC RULES

## Objective

Define strict sync boundaries between:

- application answers,
- durable profile facts,
- verified compliance records.

This table is the product and engineering source of truth for sync behavior.

## Core Rule

Willingness is not completion.

- "Willing to do background check/drug screen/E-Verify" must never produce green completion status.
- Green completion can only come from verified compliance sources (orders/checklist/verified records).

---

## Rule Table

| Input from worker flow | Store on application | Sync to durable profile | Store as verified compliance | UI label (worker-facing) |
|---|---|---|---|---|
| First/last name | Yes | Yes | No | `Profile info` |
| Email/phone | Yes | Yes | No | `Contact info` |
| DOB | Yes | Yes | No | `Date of birth` |
| Address + coordinates | Yes | Yes | No | `Home address` |
| Work authorization answer | Yes | Yes (attestation object) | No | `Work authorization attested` |
| Requires sponsorship | Yes | Yes (attestation object) | No | `Sponsorship preference` |
| Gender/veteran/disability | Yes | Yes (optional demographics) | No | `Demographic info (optional)` |
| Profile picture | Optional in app snapshot | Yes | No | `Profile photo` |
| Resume upload | Optional in app snapshot | Yes (`resume`) | No | `Resume uploaded` |
| Skills | Yes | Yes | No | `Skills` |
| Languages list | Yes | Yes | No | `Languages` |
| Education entries | Yes | Yes | No | `Education` |
| Certifications list/evidence | Yes | Yes | Partial (verification status from admin/workflow) | `Certification uploaded` or `Certification verified` |
| Work experience | Yes | Yes | No | `Work experience` |
| Bio | Yes | Yes | No | `Bio` |
| Shift preferences | Yes | Yes | No | `Shift preferences` |
| Transport method | Yes | Yes | No | `Transportation` |
| Available start date | Yes | Yes | No | `Available to start` |
| Background check willingness | Yes | Yes (attestation only) | No | `Willing to complete background check` |
| Drug screening willingness | Yes | Yes (attestation only) | No | `Willing to complete drug screening` |
| E-Verify willingness | Yes | Yes (attestation only) | No | `Willing to complete E-Verify` |
| Additional screening willingness | Yes | Yes (attestation only) | No | `Willing to complete [screening]` |
| Vaccination willingness answer | Yes | Yes (attestation only) | No | `Willing to meet vaccination requirement` |
| Background/drug/E-Verify order result | No (unless denormalized snapshot) | Optional summary mirror | Yes | `Background check complete` / `Drug screen complete` / `E-Verify complete` |
| Onboarding checklist verified status | No (unless denormalized snapshot) | Optional summary mirror | Yes | `Verified` / `Expiring soon` / `Expired` |

---

## Sync Decision Matrix

## A) Should sync to profile (durable)

- Identity/contact/location fields
- Skills/languages/education/certifications/work experience
- Preferences (shift, transport, start date)
- Work authorization attestation

## B) Application-only (do not promote to durable profile by default)

- Posting-specific requirement acks (uniform comfort, PPE comfort, physical comfort)
- Requirement-specific "Yes/No/Maybe" tied to a single posting context
- Temporary notes used only during that application

## C) Attestation-only profile namespace (not compliance)

- Background/drug/E-Verify willingness
- Additional screening willingness
- Vaccine willingness answers

## D) Verified compliance-only namespace

- Screening completion statuses and provider results
- Onboarding checklist status (`verified`, `expired`, `expiring_soon`)
- Verification outcomes that power green status UI

---

## Required UI Language Rules

Use explicit wording that distinguishes willingness from completion.

- Willingness label examples:
  - `Willing to complete background check`
  - `Willing to complete drug screening`
  - `Willing to complete E-Verify`
- Verified completion label examples:
  - `Background check complete`
  - `Drug screen complete`
  - `E-Verify complete`
- Pending workflow labels:
  - `Background check ordered`
  - `Drug screen in progress`
  - `E-Verify pending`

Do not show green complete badges for willingness labels.

---

## Read/Write Guardrails

- Write guardrail:
  - Any field named `comfortable*`, `willing*`, or `*Comfort` must map to attestation domain only.
- Read guardrail:
  - Green completion components must ignore attestation domain and read only verified compliance domain.
- Contract guardrail:
  - Application documents keep immutable application answers.
  - Profile keeps durable facts and attestations.
  - Compliance keeps verified outcomes.

---

## Immediate Policy for Existing Fields

Treat these existing fields as attestation, not completion:

- `users/{uid}.comfortablePassBackground`
- `users/{uid}.comfortablePassDrug`
- `users/{uid}.comfortableEVerify`
- `users/{uid}.comfortableWith*`

Until migration is complete:

- UI text should prefix these as "Willing" or "Self-reported".
- Completion badges/chips should ignore these fields entirely.

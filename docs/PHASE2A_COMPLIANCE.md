# Phase 2A: Compliance Foundation

Summary of what was implemented and what remains (including Phase 2A.1).

## Implemented

### 1. Schema and helpers
- **`src/types/compliance.ts`**: Status model, category, source, `WorkerComplianceItem` type, `COMPLIANCE_ITEM_TYPES` config, `complianceItemIdForEmployment()`.
- **Firestore paths**: `workerComplianceItems(tid)`, `workerComplianceItem(tid, id)` in `src/data/firestorePaths.ts`.

### 2. Seed/create and sync
- **`src/utils/complianceSync.ts`**: `upsertComplianceItem()`, `syncComplianceItemsFromEmployments()`. Syncs from employments + pipeline steps and **onboarding_forms milestones** (Phase 2A.1): handbook_acknowledgment, policy_acknowledgment, contractor_agreement, w4/w9 (by workerType), in addition to i9, everify, background_check, drug_screen.

### 3. Admin read UI and CRUD
- **User Profile → Compliance tab**: List with category grouping, filter (All / Credentials & expiring / Onboarding), Issued / Expires / Renewal due columns, expired/expiring row highlight (left border), “Sync from onboarding”, “Add credential / permit”, Edit on credential rows.
- **ComplianceCredentialModal**: Add or edit compliance items for credential/permit types (drivers_license, work_permit, food_handler, cpr_bls, forklift_certification, tb_test). Fields: type, status, required, entity (optional), issuedAt, expiresAt, renewalDueAt, notes. New items use `addDoc`; edits use `updateDoc`. Source `admin_manual`.
- **Settings → Compliance Library**: Table of compliance item types (type key, label, category, expiration).

### 4. Status model
- Lifecycle: `not_started` | `pending` | `submitted` | `in_review` | `complete` | `expired` | `failed` | `waived`.

### 5. Expiration support (model and UI)
- **Schema**: `issuedAt`, `expiresAt`, `renewalDueAt` (Timestamps); status `expired`.
- **UI**: Compliance tab shows Issued, Expires, Renewal due; credential modal supports all three dates; rows with expiring credentials get a warning left border (within 30 days) or error left border (past); status chip shows `expired`. Ready for future alerts; no alert engine or worker renewal flow yet.

### 6. Onboarding/employment → compliance (additive only)
- **From employment**: everify, background_check, drug_screen.
- **From pipeline step i9**: i9.
- **From pipeline step onboarding_forms milestones** (Phase 2A.1): handbook_acknowledgment (handbook_signed/handbook_sent), policy_acknowledgment (policy_acknowledgment(s) if present), contractor_agreement (contractor_agreement_signed/sent), w4 or w9 (tax_forms, by employment workerType). No changes to pipeline or entity_employments behavior.

## Supported item types

- **Eligibility**: i9, everify, w4, w9  
- **Acknowledgment**: handbook_acknowledgment, policy_acknowledgment, contractor_agreement  
- **Screening**: background_check, drug_screen, tb_test  
- **Credential**: drivers_license, work_permit, food_handler, cpr_bls, forklift_certification  

## Phase 2A completion (2A.2)

Compliance is now **admin-usable** for:
- **Expiring credentials**: Add/edit driver’s license, work permit, food handler, CPR, forklift, TB test; set issued/expires/renewal due; scan expired and expiring (30-day) via row highlight and summary chips.
- **Onboarding-derived visibility**: Sync from onboarding creates/updates handbook, policy, contractor, w4/w9, i9, everify, background, drug screen; filter and category grouping make onboarding vs credential items easy to distinguish.

**Ready to pause** Compliance here and move on to another system. Remaining work below is deferred.

## Deferred to a later phase

1. **Worker uploads**: No UI or API for workers to upload documents for credentials.
2. **Renewals**: No renewal flow or auto-set `renewalDueAt` (e.g. 30 days before `expiresAt`).
3. **Firestore index**: Add composite index if using `orderBy('expiresAt')` or other composite queries.
4. **Backend sync trigger (optional)**: E-Verify or pipeline completion could call a Cloud Function to upsert compliance items.

## Compatibility

- No changes to `entity_employments`, `worker_onboarding`, or E-Verify triggers. Sync only writes to `worker_compliance_items`. Existing onboarding and employment flows are unchanged.

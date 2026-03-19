# Payroll Data Model Validation (TempWorks-First)

Recommended direction only. Validated against current database and onboarding/employment structures. Additive and backward-compatible only.

---

## 1. Does this model fit the current database and codebase cleanly?

**Yes, with one adjustment.**

- **Entities:** Today each entity has flat fields: `payrollProvider?: 'none' | 'everee'`, `evereeEnabled`, `evereeTenantId`, `evereeEnvironment`, `evereeApiBaseUrl`. There is no TempWorks option and no portal/onboarding URL. Adding a **payrollSettings** object (or equivalent new fields) is **additive**. Existing Everee reads/writes must keep working; new code should prefer `payrollSettings` when present and fall back to legacy fields.

- **entity_employments:** Doc ID is `userId__entityKey`; has optional `payrollStatus` (Phase 1 plan). No other payroll fields today. Keeping `payrollStatus` (and optionally a single link field) for backward compatibility and simple list views is fine; richer state belongs in **worker_payroll_accounts**.

- **worker_payroll_accounts:** Paths already exist in `firestorePaths.ts` (`workerPayrollAccounts(tid)`, `workerPayrollAccount(tid, id)`). No code writes to this collection yet. The recommended shape and doc ID `userId__entityKey` align with entity_employments and the pipeline; **no conflict**.

- **Pipeline / entity workflow:** Step **everee** and entity workflow steps (`payroll_invite_sent`, `payroll_setup_complete`, `direct_deposit_*`) already exist. Manual milestone confirmation is already the pattern (recruiter updates pipeline/employment). Adding worker_payroll_accounts and entity payrollSettings does not require changing pipeline step IDs or milestone behavior.

**Caveat:** Entity type in code currently has `payrollProvider: 'none' | 'everee'`. To support TempWorks without breaking existing saves, either (a) extend to `'none' | 'everee' | 'tempworks' | 'manual'` or (b) put provider only in `payrollSettings` and keep `payrollProvider` for backward compatibility (Everee UI continues to read/write legacy fields until migrated).

---

## 2. Best practical collection/field implementation path

- **worker_payroll_accounts:** Implement as its **own collection**, path `tenants/{tid}/worker_payroll_accounts/{userId}__{entityKey}`. Create or update a doc when an employment exists (e.g. when pipeline is created or when admin first sets payroll status). Use the recommended fields; optional fields can be added over time. **Do not** remove or rename existing `entity_employments` or `everee_workers` fields.

- **entity_employments:** Keep as-is. Optionally add `payrollAccountId` (reference to worker_payroll_accounts doc) or a single `payrollPortalUrl` for worker link if you want to avoid joining to entity for URL in worker UI. Prefer resolving URL from entity payrollSettings when possible so one place configures it.

- **Entities:** Add **payrollSettings** as an optional object. When reading: if `entity.payrollSettings` exists, use it for provider/mode/URLs; else fall back to `entity.payrollProvider` and `entity.everee*` for Everee. When saving from Entity settings UI: if user selects TempWorks (or manual), write `payrollSettings: { provider: 'tempworks', mode: 'portal_link_only', onboardingUrl, portalUrl, ... }` and leave `payrollProvider` as `'none'` (or introduce `payrollProvider: 'tempworks'` and keep Everee block for `everee`). That way existing Everee config and tests (e.g. evereePing) keep working.

- **Pipeline / milestones:** No schema change. Optionally add a milestone (e.g. `payroll_account_created`) to the **everee** step and to entity workflow options so admins can record “account created” for TempWorks. Map existing `everee_invite_sent` / `everee_setup_complete` to “payroll invite sent” / “payroll setup complete” in labels.

---

## 3. Should payrollSettings live on entities exactly as above or adjusted?

**Adjusted to current patterns.**

- Keep **existing** entity payroll fields: `payrollProvider`, `evereeEnabled`, `evereeTenantId`, `evereeEnvironment`, `evereeApiBaseUrl`. Do not remove them; Everee UI and callables rely on them.

- Add **payrollSettings** as an optional object on the entity document with the recommended shape (provider, mode, onboardingUrl, portalUrl, supportsEmbeddedFlow, inviteMethod, notes, updatedAt, updatedBy). Use **snake_case** for Firestore if the rest of the entity uses it (e.g. `onboarding_url`, `portal_url`, `updated_at`, `updated_by`); otherwise camelCase is fine for consistency with the Entity interface in code.

- **Defaulting:** For TempWorks, set `provider: 'tempworks'`, `mode: 'portal_link_only'` or `'manual_tracking'`, `supportsEmbeddedFlow: false`, `inviteMethod: 'manual'` or `'email_link'`. Leave `onboardingUrl` / `portalUrl` editable; one URL can serve both if the tenant uses a single TempWorks link.

- **UI:** In Entity overview (EntitiesPage), add a “Payroll (TempWorks)” or “Payroll settings” section: when provider is TempWorks (or when payrollSettings exists), show onboarding URL and portal URL. When provider is Everee, keep the existing Everee block. That way payrollSettings is written only when admin configures TempWorks or future providers; Everee continues to use legacy fields until you migrate that block to read/write payrollSettings.

---

## 4. worker_payroll_accounts: own collection or extension of entity_employments?

**Own collection.**

- **entity_employments** already carries employment lifecycle (status, onboarding, E-Verify, background, drug screen). Adding many payroll fields (invite sent at, account created at, completion source, link, etc.) would bloat it and mix concerns.

- **worker_payroll_accounts** with doc ID `userId__entityKey` matches entity_employments and pipeline; one doc per worker per entity for payroll state. Easy to query by userId or by entityKey; can be created/updated when employment is created or when admin/worker completes a payroll action.

- **Link:** Optionally set `entity_employments.payrollAccountId` to the worker_payroll_accounts doc ID for quick lookup, or resolve by (userId, entityKey) when needed. Keep `entity_employments.payrollStatus` as an optional cache for list views if you want to avoid joining on every list load; otherwise worker_payroll_accounts can be the single source of truth for payroll status.

---

## 5. Minimal admin UI to add now (TempWorks-first)

- **Entity settings (EntitiesPage):**
  - Add a payroll **provider** option: **TempWorks** (and keep **None** / **Everee**). When TempWorks is selected, show:
    - **Onboarding URL** (e.g. TempWorks signup/onboarding link)
    - **Portal URL** (e.g. TempWorks login portal; can be same as onboarding URL if one link is used)
  - Save into **payrollSettings** (and optionally set `payrollProvider` to a new value like `'tempworks'` if you extend the enum). Do not remove or change the existing Everee block.

- **Recruiter onboarding / Employment (User Profile):**
  - Already supports pipeline step **everee** and manual milestone completion. Optionally add an **“Open payroll portal”** (or “Open TempWorks”) link when the worker’s entity has `payrollSettings.onboardingUrl` or `portalUrl`, so recruiters can open the same link they send to workers.

- **Worker – My Employment detail:**
  - Show **payroll status** (from worker_payroll_accounts if present, else entity_employments.payrollStatus or derived from pipeline).
  - Show a single primary action: **“Open Payroll Setup”** or **“Open Payroll Portal”** that opens the entity’s onboarding URL or portal URL in a new tab. Do not add embedded payroll forms.

No new top-level admin tabs are required; entity-level settings and existing Employment/onboarding views are enough for TempWorks-first.

---

## 6. What to defer until Everee integration

- **Embedded payroll flow** in HRX (embedded forms, full onboarding inside the app).
- **Provider sync** (webhooks or API) that creates/updates worker_payroll_accounts from Everee (invite_sent, account_created, etc.).
- **Automatic** `invite_sent` / `account_created` from provider; for TempWorks these remain manual or email-link driven.
- **Everee-specific admin UI** beyond the existing “Test Everee config” and Everee entity fields (e.g. Everee dashboard deep links, sync status).
- **Pay history** or pay-stub display in HRX (unless Everee API is used for read-only display later).
- **Worker-facing “payroll account created” self-report** (e.g. “I completed setup”) unless you want a simple “I’ve completed TempWorks setup” button that sets completionSource to worker_confirmed; that can be done in TempWorks-first with minimal scope.

---

## References

- Phase 2 architecture: `docs/PHASE2_SYSTEMS_ARCHITECTURE.md` (Payroll section, worker_payroll_accounts, TempWorks-first)
- Entity type and workflow steps: `src/pages/TenantViews/settings/EntitiesPage.tsx`
- entity_employments and pipeline: `functions/src/onboarding/workerOnboardingPipeline.ts`, `docs/ONBOARDING_PHASE1_PLAN.md`
- Firestore paths: `src/data/firestorePaths.ts` (workerPayrollAccounts, workerPayrollAccount)
- Worker My Employment: `src/pages/c1/workers/myEmploymentDetail.tsx`

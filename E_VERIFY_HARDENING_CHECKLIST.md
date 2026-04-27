# E-Verify hardening checklist (HRX)

**Goal:** Valid before `POST /cases`, ICA-aligned, resilient document combinations, minimal USCIS/API rejections.

---

## PHASE 1 — Critical unknowns (confirm with ICA v31 PDF / USCIS support)

### 1. Company / employer ID in `i9_case_flat`

| Deliverable | Answer (HRX codebase audit — **verify in ICA PDF**) |
|-------------|-----------------------------------------------------|
| **A. Required?** | **NO** for the canonical ICA path in HRX today: `createDraftCase` sends **only** the merged `i9_case_flat` body; `everifyCompanyId` is **not** injected into JSON. Employer is expected to be **credentials-bound** (ICA login). |
| **B. Exact field name** | If your account type needs it: ICA lists optional **`client_company_id`** (employer-agent / client routing). Not merged in HRX unless added intentionally. |
| **C. When present** | Employer-agent / multi-client setups per ICA; confirm with USCIS. |
| **D. Inject location** | Would be `resolveI9PayloadForCreateCase` / `createAndSubmitCase` overrides in `everifyService.ts` — **only after** ICA confirms key + format. |

**Tasks:** Search ICA PDF for `client_company_id`, `employer_id`; correlate with live `ATTRIBUTE_*` / routing errors.

---

### 2. Case creator phone format

| Deliverable | Answer |
|-------------|--------|
| **A. Required format** | HRX normalizes NANP to **`###-###-####`** (10 digits, optional leading `1` stripped). |
| **B. Regex** | Not shipped from ICA in-repo; confirm against ICA schema / sample payloads (`^\d{3}-\d{3}-\d{4}$` after normalization). |
| **C. Extension** | `case_creator_phone_number_extension` passed through when provided (`everifyService.ts`). |

**Tasks:** Validate against ICA schema; adjust `normalizeCaseCreatorPhoneForEverifyRest` in `everifyI9Provider.ts` if USCIS expects `(###) ###-####`.

---

### 3. Placeholder creator phone

| Deliverable | Answer |
|-------------|--------|
| **A. Source of real phone** | **Entity:** `tenants/{tenantId}/entities/{entityId}.contacts.supportPhone` (see `EntitiesPage.tsx`). **Env fallback:** `EVERIFY_CASE_CREATOR_PHONE_FALLBACK` (10-digit US). **Auth path:** callable still passes token phone when usable. |
| **B. Fallback if missing** | Warn log `everify.case_creator_phone_placeholder`; use last-resort placeholder only if nothing else resolves (avoid hard-failing create). |
| **C. Files** | `everifyService.ts` (`resolveCaseCreatorForIca` + `createAndSubmitCase`). |

---

## PHASE 2 — Preflight validation

### 4. List A (non-preset / extended)

- Extended enums and required fields are in `everifyI9Preflight.ts`.
- **ICA PDF required** to finalize enum names for: receipt variants, foreign passport, visa, I-94, SEVIS.
- Env: `EVERIFY_PREFLIGHT_EXTENDED_LISTA=off|warn|error` (default **`warn`**) — uncommon types log or error without blocking legacy behavior when `off`.

### 5. List B / C

- Per-type: List B `DRIVERS_LICENSE` / `GOVERNMENT_ID_CARD` → `us_state_code` when B+C path.
- List C `SOCIAL_SECURITY_CARD` → optional format hint (non-blocking warn).

### 6. Citizenship ↔ document matrix

- Preset List A codes enforced in `CITIZENSHIP_TO_ALLOWED_LIST_A` / extended map in `everifyI9Preflight.ts`.
- Unknown `document_a_type_code` values: no citizenship alignment throw (USCIS validates).

---

## PHASE 3 — Payload integrity

### 7. Dates

- `date_of_birth`, `date_of_hire`, `expiration_date` (when present): **YYYY-MM-DD** in preflight.

### 8. SSN

- After normalization to `###-##-####`, reject obvious test / invalid patterns in preflight.

### 9. Invalid combinations

- `no_expiration_date` on `FORM_I551`: stripped in `applyRestDraftPayloadNormalization`.
- Employee email = case creator email: preflight error.

---

## PHASE 4 — Observability & tests

### 10. Structured logging

- `everifyRestClient.ts`: `everify.preflight_rejected` on preflight failure (no SSN / doc numbers).

### 11. Error catalog

- Messages prefixed `E-Verify preflight:` — map in `everifyI9Preflight.ts` and this doc.

### 12. Smoke script

- `functions/scripts/testEverifyI9Preflight.ts` — payload cases (pass/fail).

---

## PHASE 5 — Rollout

- Uncommon doc types: **`EVERIFY_PREFLIGHT_EXTENDED_LISTA=warn`** first; tighten to `error` after ICA confirmation.
- Incremental order: company id (confirm) → phone → common docs → edge cases.

---

## Success criteria

- Catch ≥90% of preventable errors before POST (target; measure via logs).
- Clear internal errors; minimal USCIS rejection handling for validation gaps.

---

## Appendix — Citizenship / document matrix (HRX preflight)

| `citizenship_status_code` | Allowed List A (preset enforcement) | Notes |
|---------------------------|--------------------------------------|--------|
| `US_CITIZEN` | `US_PASSPORT`, `US_PASSPORT_RECEIPT` | Hard-required number fields for non-extended codes |
| `NONCITIZEN` | `US_PASSPORT`, `US_PASSPORT_RECEIPT` | |
| `LAWFUL_PERMANENT_RESIDENT` | `FORM_I551` | |
| `ALIEN_AUTHORIZED_TO_WORK` | `FORM_I766`, `FOREIGN_PASSPORT`, `US_VISA`, `FORM_I94`, `SEVIS` | Extended enums: **confirm against ICA**; `EVERIFY_PREFLIGHT_EXTENDED_LISTA` default `warn` |
| `NONCITIZEN_AUTHORIZED_TO_WORK` | same as `ALIEN_AUTHORIZED_TO_WORK` | |

**Smoke tests:** `npm run test:everify-preflight` (payload-only; separate from `test:i9-extraction` Document AI).

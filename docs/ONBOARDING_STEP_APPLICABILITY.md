# Onboarding Step Applicability (MVP)

This launch-hardening pass reserves a lightweight applicability contract for worker onboarding steps without changing the backend pipeline model yet.

## Step field contract

For each onboarding step in:

- `tenants/{tenantId}/worker_onboarding/{pipelineId}.steps[]`

the UI now supports an optional field:

- `applicability: "required" | "not_required" | "pending"`

If `applicability` is missing, UI defaults to:

- `"required"`

## Current operational behavior

- `required`: step should be tracked as part of onboarding progress.
- `not_required`: step is shown as informational and not treated as pending critical work.
- `pending`: applicability decision has not been finalized yet.

## Critical-step visibility

Recruiter onboarding UI currently treats these steps as critical for launch visibility:

- `i9`
- `onboarding_forms`
- `e_verify`
- `background_check`
- `drug_screen`

If a critical step is blocked or still pending completion, the pipeline row highlights that state.

## Next pass (not in this change)

- Persist `applicability` directly from backend pipeline generation.
- Add entity- and role-based applicability rules server-side.
- Exclude `not_required` steps from completion denominator in pipeline status calculations.

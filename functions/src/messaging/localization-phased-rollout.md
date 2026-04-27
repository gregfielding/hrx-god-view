# Messaging-First Localization Rollout

This rollout keeps messaging progress moving while full site localization is staged.

## Phase 0: Immediate Shipping Baseline

- Keep app UI English-first.
- Capture `users/{userId}.preferredLanguage` at account creation.
- Default to `en` when preference is missing.
- Continue using template language fallback (`preferredLanguage` -> `en` -> any active template).

## Phase 1: Automation Trigger Foundation

- Add system trigger key `account_created`.
- Dispatch automation rules on user creation with `account_created`.
- Keep legacy welcome enqueue as fallback until rule adoption is stable.

## Phase 2: Bilingual Onboarding Templates

- Seed default onboarding SMS templates in both languages:
  - `System Onboarding Welcome (SMS EN)`
  - `System Onboarding Welcome (SMS ES)`
- Resolve onboarding body from `preferredLanguage` with English fallback.
- Validate with two new users (one EN, one ES) in staging.

## Phase 3: Messaging Coverage Expansion

- Add EN+ES template parity checks for active automation templates.
- Highlight missing ES variants in Messaging settings.
- Keep ES variants draft by default until business approval.

## Phase 4: Full Product Localization

- Introduce app-wide translation resources and route-level language switching.
- Move signup and onboarding UI copy to localized resources first.
- Expand to core app pages after messaging parity is stable.

## Validation Checklist

- `account_created` appears in trigger dropdown.
- New user creation runs automation dispatch.
- ES users receive Spanish onboarding message when ES template exists.
- Users without `preferredLanguage` still receive English without errors.

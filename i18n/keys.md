# Static UI i18n keys

Shared keys for worker portal + jobs board (Web; Flutter uses same keys when added).

## Naming

- Dot paths grouped by area: `common.*`, `nav.*`, `jobs.*`, `assignment.*`, `documents.*`, `forms.*`, `errors.*`, `toasts.*`, `empty.*`
- Placeholders: `{count}`, `{name}`, etc. — preserve in translations.

## Files

- `locales/en.json` — source of truth (English)
- `locales/es.json` — Spanish; must have same keys as en (enforced by `scripts/i18n/check-i18n.ts`)

## Usage (Web)

- `t('jobs.applyNow')` → "Apply now" / "Aplicar ahora"
- `t('jobs.applicantsCount', { count: 5 })` → "5 applicants" / "5 solicitantes"

## Rollout

1. Nav + sidebar labels
2. Jobs board list + detail
3. Assignment details
4. Toasts / errors
5. Remaining worker pages

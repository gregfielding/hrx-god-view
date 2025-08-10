# AI Scouts (Planned)

## Perf Scout (weekly)
- Run `scripts/bundleReport.sh` and parse slow bundles.
- Query `reports/functions_audit.json` and `reports/firestore_usages.json` for hotspots.
- Open issues with repro + fix sketch (code splitting, indexes, batching).

## Drift Scout (bi-weekly)
- Compare `reports/firestore_usages.json` paths vs `firestore.rules` and (future) `/docs/ai/data-models.md`.
- Open issues for mismatched paths/fields, propose codemods.

## UI Scout (nightly)
- Playwright screenshots of key routes; compare against last run; flag spacing/contrast/overflow.



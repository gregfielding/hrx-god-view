/**
 * Worker AI prescreen rescore — implementation and CLI live in the Cloud Functions package:
 *   `functions/src/scripts/rescoreWorkerAiPrescreenInterviews.ts`
 *
 * From repo root:
 *   npm run prescreen:rescore -- --dry-run --source=system --limit=50
 *   npm run prescreen:rescore -- --tenantId=T --source=system --limit=500
 *   cd functions && npx ts-node src/scripts/rescoreWorkerAiPrescreenInterviews.ts --help
 *
 * This file exists so the path matches ops docs; it does not execute code.
 */
export {};

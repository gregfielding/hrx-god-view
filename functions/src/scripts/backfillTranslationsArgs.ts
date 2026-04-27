/**
 * Parsed CLI args and collection-selection helpers for backfillTranslations.
 * Extracted so tests can assert collection=job_postings does not run job_orders.
 */

const ALLOWED_COLLECTIONS = [
  'job_postings',
  'job_orders',
  'shifts',
  'crm_companies',
  'crm_locations',
] as const;

export type CollectionKind = (typeof ALLOWED_COLLECTIONS)[number];

export function parseArgs(argv: string[] = process.argv.slice(2)): {
  tenantId?: string;
  collection: string;
  limit: number;
  dryRun: boolean;
  ratePerSec: number;
  since?: string;
  force: boolean;
  verbose: boolean;
  holdSeconds: number;
} {
  let tenantId: string | undefined;
  let collection = 'all';
  let limit = 0;
  let dryRun = true;
  let ratePerSec = 4;
  let since: string | undefined;
  let force = false;
  let verbose = false;
  let holdSeconds = 0;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--tenantId=')) tenantId = a.slice('--tenantId='.length).trim() || undefined;
    else if (a.startsWith('--collection=')) collection = a.slice('--collection='.length).trim() || 'all';
    else if (a === '--collection') collection = (argv[i + 1] ?? '').trim() || 'all';
    else if (a.startsWith('--limit=')) limit = parseInt(a.slice('--limit='.length), 10) || 0;
    else if (a.startsWith('--dryRun=')) dryRun = a.slice('--dryRun='.length).toLowerCase() !== 'false';
    else if (a.startsWith('--ratePerSec=')) ratePerSec = Math.max(1, Math.min(20, parseInt(a.slice('--ratePerSec='.length), 10) || 4));
    else if (a.startsWith('--since=')) since = a.slice('--since='.length).trim() || undefined;
    else if (a.startsWith('--force=')) force = a.slice('--force='.length).toLowerCase() === 'true';
    else if (a === '--verbose') verbose = true;
    else if (a.startsWith('--holdSeconds=')) holdSeconds = Math.max(0, parseInt(a.slice('--holdSeconds='.length), 10) || 0);
    else if (a === '--holdSeconds') holdSeconds = Math.max(0, parseInt(argv[i + 1] ?? '0', 10) || 0);
  }

  return { tenantId, collection, limit, dryRun, ratePerSec, since, force, verbose, holdSeconds };
}

/**
 * Returns which collections will be processed for a given --collection value.
 * When collection is "job_postings", result is ["job_postings"] only (no job_orders).
 */
export function getCollectionsToRun(collection: string): CollectionKind[] {
  if (collection === 'all') {
    return [...ALLOWED_COLLECTIONS];
  }
  if (ALLOWED_COLLECTIONS.includes(collection as CollectionKind)) {
    return [collection as CollectionKind];
  }
  return [];
}

/** Gate: only run job_orders EN backfill when requested collection is job_orders or all. */
export function shouldRunJobOrdersEnBackfill(requestedCollection: string): boolean {
  return requestedCollection === 'job_orders' || requestedCollection === 'all';
}

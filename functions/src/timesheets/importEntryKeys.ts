/**
 * Shared keying for CSV-import timesheet entries.
 *
 * Three jobs must agree byte-for-byte on these keys, or rows silently
 * fork into duplicate docs / fail to resume:
 *   - submitImportTimesheetBatch (Everee externalId + entry stamp)
 *   - saveImportTimesheetRows     (entry upsert)
 *   - the client (resume-load merge + void payload)
 *
 * The Everee externalId is the idempotency anchor used by the payables/
 * worked-shifts ledger; the entry doc id is the synthetic, assignment-free
 * id under which import rows persist in `timesheet_entries`.
 */

import { normalizeEmail, normalizeName } from './timesheetWorkerAliases';

export type ImportExternalIdKind = 'CONTRACTOR' | 'WORKED_SHIFT';

/** Lowercase + `[^a-z0-9]+ → _`, trimmed. Firestore-safe id segment. */
function slug(v: string): string {
  return String(v || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Firestore-safe doc id for an Everee externalId (which contains `::`). The
 *  id of a row's `timesheet_import_payables` ledger doc. */
export function payableStatusDocId(externalId: string): string {
  return slug(externalId).slice(0, 480);
}

/**
 * Stable identity key for a CSV row that has no HRX userId (blocked /
 * unmatched). Derived from the normalized name + email so it matches the
 * worker-alias keys and is identical on client + server. Name-only for
 * no-email customers (Connect Team).
 */
export function importCsvKey(args: { firstName?: string; lastName?: string; email?: string }): string {
  const name = slug(normalizeName(args.firstName || '', args.lastName || ''));
  const email = args.email && args.email.trim() ? slug(normalizeEmail(args.email)) : '';
  return [name, email].filter(Boolean).join('__').slice(0, 160) || 'unknown';
}

/**
 * Synthetic `timesheet_entries` doc id for an import row. Uses the HRX
 * userId when matched, else the CSV key — so a blocked row gets a stable id
 * that survives reload, and the `import__` prefix guarantees it never
 * collides with a real scheduled `{assignmentId}_{workDate}` entry.
 */
export function importEntryDocId(args: {
  customer: string;
  userId?: string | null;
  csvKey?: string | null;
  workDate: string;
}): string {
  const who = (args.userId && args.userId.trim()) || (args.csvKey && args.csvKey.trim()) || 'unknown';
  return `import__${slug(args.customer)}__${slug(who)}__${args.workDate}`.slice(0, 480);
}

/**
 * Deterministic Everee externalId for an import submission. Both kinds
 * share one shape so a re-submit targets the same payable / worked-shift
 * ledger entry: `{tenantId}::import-{customer}-{userId}::{workDate}::{kind}`.
 */
export function importExternalId(args: {
  tenantId: string;
  customer: string;
  userId: string;
  workDate: string;
  kind: ImportExternalIdKind;
}): string {
  return `${args.tenantId}::import-${args.customer}-${args.userId}::${args.workDate}::${args.kind}`;
}

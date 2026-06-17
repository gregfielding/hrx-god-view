/**
 * Client mirror of functions/src/timesheets/importEntryKeys.ts +
 * timesheetWorkerAliases.ts normalizers. The normalize logic MUST stay
 * byte-identical to the server's, or the resume-load merge (which joins a
 * freshly-parsed row to its persisted entry by `csvKey`) silently misses.
 */

export type ImportExternalIdKind = 'CONTRACTOR' | 'WORKED_SHIFT';

/** Mirror of timesheetWorkerAliases.normalizeEmail. */
export function normalizeEmail(email: string): string {
  const e = String(email || '').trim().toLowerCase();
  const at = e.indexOf('@');
  if (at <= 0) return e;
  let local = e.slice(0, at);
  const domain = e.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus >= 0) local = local.slice(0, plus);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.replace(/\./g, '');
  }
  return `${local}@${domain}`;
}

/** Mirror of timesheetWorkerAliases.normalizeName. */
export function normalizeName(firstName: string, lastName: string): string {
  return `${String(firstName || '')} ${String(lastName || '')}`
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function slug(v: string): string {
  return String(v || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function importCsvKey(args: { firstName?: string; lastName?: string; email?: string }): string {
  const name = slug(normalizeName(args.firstName || '', args.lastName || ''));
  const email = args.email && args.email.trim() ? slug(normalizeEmail(args.email)) : '';
  return [name, email].filter(Boolean).join('__').slice(0, 160) || 'unknown';
}

export function importEntryDocId(args: {
  customer: string;
  userId?: string | null;
  csvKey?: string | null;
  workDate: string;
}): string {
  const who = (args.userId && args.userId.trim()) || (args.csvKey && args.csvKey.trim()) || 'unknown';
  return `import__${slug(args.customer)}__${slug(who)}__${args.workDate}`.slice(0, 480);
}

export function importExternalId(args: {
  tenantId: string;
  customer: string;
  userId: string;
  workDate: string;
  kind: ImportExternalIdKind;
}): string {
  return `${args.tenantId}::import-${args.customer}-${args.userId}::${args.workDate}::${args.kind}`;
}

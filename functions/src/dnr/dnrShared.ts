/**
 * DNR (Do Not Return) — shared model + enforcement helpers.
 *
 * A worker can be marked DNR for a CRM account: a child account (one
 * worksite, e.g. "CORT Maryland Warehouse") or a national/standalone
 * account ("CORT"). A national-level DNR covers every child automatically
 * because job orders denormalize `parentAccountId` — enforcement checks the
 * worker's flattened `dnrAccountIds` against ALL account ids a job order
 * carries, child and parent alike.
 *
 * User-doc shape (written ONLY via the setWorkerDnr callable):
 *   dnr:            DnrEntry[]  — full audit history (active + removed)
 *   dnrAccountIds:  string[]    — flattened ACTIVE account ids; the single
 *                                 field every enforcement point reads
 *
 * Enforcement points:
 *   - placementsApi assignment creation  (reject by name)
 *   - jobOrderAutoMessaging recipients   (silent filter, logged count)
 *   - PublicJobsBoard signed-in filter   (client, via posting accountId/
 *     parentAccountId stamps)
 *   - apply flow                          (generic "not available")
 */

export interface DnrEntry {
  accountId: string;
  accountName: string;
  accountType?: 'national' | 'child' | 'standalone' | null;
  parentAccountId?: string | null;
  parentAccountName?: string | null;
  notes?: string;
  status: 'active' | 'removed';
  addedBy: string;
  addedByName?: string | null;
  /** ISO string — array elements can't hold serverTimestamp. */
  addedAt: string;
  removedBy?: string;
  removedByName?: string | null;
  removedAt?: string;
  removedNotes?: string;
}

/**
 * Every account id a job order might carry, across all creation paths
 * (fieldglass stamps accountId/recruiterAccountId/parentAccountId; the
 * auto-gig path stamps top-level companyId; manual JOs vary). Intersecting
 * this set with a worker's dnrAccountIds is the one enforcement rule.
 */
export function joAccountIdCandidates(jo: Record<string, unknown> | undefined | null): string[] {
  if (!jo) return [];
  const raw = [
    jo.accountId,
    jo.recruiterAccountId,
    jo.companyId,
    jo.parentAccountId,
    jo.nationalAccountId,
  ];
  const out = new Set<string>();
  for (const v of raw) {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s) out.add(s);
  }
  return [...out];
}

export function isDnrMatch(dnrAccountIds: unknown, candidateIds: string[]): boolean {
  if (!Array.isArray(dnrAccountIds) || dnrAccountIds.length === 0 || candidateIds.length === 0) {
    return false;
  }
  const set = new Set(dnrAccountIds.filter((v): v is string => typeof v === 'string'));
  return candidateIds.some((id) => set.has(id));
}

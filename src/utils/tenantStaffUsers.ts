/**
 * Tenant staff (security level 5–7) user lookups without reading the whole
 * `users` collection.
 *
 * Several admin surfaces used to `getDocs(collection(db, 'users'))` (14k+ docs
 * × ~15 KB ≈ 210 MB per load) or `limit(500)` per keystroke, then filter
 * client-side for "staff of this tenant". Staff are ~16 docs, so this runs
 * indexed queries whose UNION is a superset of every one of those filters:
 *   Q1  tenantIds.{tenantId}.securityLevel in ['5','6','7',5,6,7]
 *   Q2  root securityLevel               in ['5','6','7',5,6,7]
 *       (legacy docs whose level lives only at the root; spans ALL tenants)
 * and, for surfaces that also admit recruiter-flagged users below level 5:
 *   Q3  tenantIds.{tenantId}.recruiter in [true, 'true']
 *   Q4  root recruiter                in [true, 'true']
 *
 * ⚠️ Callers MUST keep applying their own tenant/level filter to the returned
 * docs — Q2 and Q4 are not tenant-scoped.
 *
 * Verified 2026-09-10 against a full prod scan
 * (functions/.scratch/staff_query_equivalence{,2}.ts): for all 4 tenants the
 * group-manager, RecruiterMultiSelect, mention-search, SenderManagement,
 * MessagingTab and ManageSalespeople (internal team) filters select identical
 * people from this union as from the full scan — zero misses.
 *
 * Rules: `isPlatformStaff()` is caller-centric, so these list queries are
 * allowed for exactly the callers that could run the old unfiltered scans
 * (docs/claude/feature_users_read_rules.md).
 */
import {
  collection,
  getDocs,
  query,
  where,
  type DocumentData,
  type Firestore,
  type Query,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';

const STAFF_SECURITY_LEVELS: Array<string | number> = ['5', '6', '7', 5, 6, 7];
const TRUE_VALUES: Array<string | boolean> = [true, 'true'];
const STAFF_CACHE_MS = 5 * 60 * 1000;

export type UserDocSnapshot = QueryDocumentSnapshot<DocumentData>;

export interface FetchTenantStaffOptions {
  /** Also include users flagged `recruiter` (tenant map or root), whatever their level. */
  includeRecruiterFlag?: boolean;
}

/**
 * Candidate staff docs for a tenant, de-duplicated and ordered by document id
 * (the order an unfiltered collection scan returns). Uncached — use for page
 * loads that must reflect edits immediately.
 */
export async function fetchTenantStaffCandidateDocs(
  db: Firestore,
  tenantId: string,
  options: FetchTenantStaffOptions = {},
): Promise<UserDocSnapshot[]> {
  if (!tenantId) return [];
  const users = collection(db, 'users');
  const queries: Query<DocumentData>[] = [
    query(users, where(`tenantIds.${tenantId}.securityLevel`, 'in', STAFF_SECURITY_LEVELS)),
    query(users, where('securityLevel', 'in', STAFF_SECURITY_LEVELS)),
  ];
  if (options.includeRecruiterFlag) {
    queries.push(query(users, where(`tenantIds.${tenantId}.recruiter`, 'in', TRUE_VALUES)));
    queries.push(query(users, where('recruiter', 'in', TRUE_VALUES)));
  }
  const snapshots = await Promise.all(queries.map((q) => getDocs(q)));
  const byId = new Map<string, UserDocSnapshot>();
  snapshots.forEach((snap) => {
    snap.docs.forEach((d) => {
      if (!byId.has(d.id)) byId.set(d.id, d);
    });
  });
  return Array.from(byId.values()).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const staffCache = new Map<string, { at: number; promise: Promise<UserDocSnapshot[]> }>();

/**
 * Same as {@link fetchTenantStaffCandidateDocs} but shared per tenant for 5
 * minutes — for per-keystroke search paths (mentions, recipient autocomplete).
 */
export function getTenantStaffCandidateDocsCached(
  db: Firestore,
  tenantId: string,
): Promise<UserDocSnapshot[]> {
  if (!tenantId) return Promise.resolve([]);
  const hit = staffCache.get(tenantId);
  if (hit && Date.now() - hit.at < STAFF_CACHE_MS) return hit.promise;
  const promise = fetchTenantStaffCandidateDocs(db, tenantId);
  staffCache.set(tenantId, { at: Date.now(), promise });
  promise.catch(() => {
    if (staffCache.get(tenantId)?.promise === promise) staffCache.delete(tenantId);
  });
  return promise;
}

/**
 * Tenant access + effective security level 5–7 (the tenant map level wins over
 * the root level). Same rule as the user-group manager picker.
 */
export function isTenantStaffUser(user: Record<string, any>, tenantId: string): boolean {
  const tid = user.tenantIds;
  const hasAccess =
    user.tenantId === tenantId ||
    user.activeTenantId === tenantId ||
    (Array.isArray(tid) ? tid.includes(tenantId) : !!tid && typeof tid === 'object' && tenantId in tid);
  if (!hasAccess) return false;
  const root = parseInt(String(user.securityLevel ?? '0'), 10) || 0;
  const tenantLevel = tid && !Array.isArray(tid) ? tid[tenantId]?.securityLevel : undefined;
  let level = root;
  if (tenantLevel !== undefined && tenantLevel !== null) {
    const n = typeof tenantLevel === 'number' ? tenantLevel : parseInt(String(tenantLevel), 10);
    level = Number.isNaN(n) ? root : n;
  }
  return level >= 5 && level <= 7;
}

/**
 * importTimesheetMatchWorkers — Phase 1 + 2 of the customer-CSV timesheet
 * importer. Given the parsed importable rows (email, name, workDate),
 * for each row:
 *   - match the email to an HRX user + check Everee linkage for the
 *     chosen paying entity (Phase 1 — the payable/blocked gate), and
 *   - best-effort pair an HRX assignment for that worker + work date and
 *     resolve pay rate / job title / worksite / workers-comp from the
 *     assignment + its job order + shift (Phase 2).
 *
 * Read-only (no writes). Server-side because matching arbitrary emails +
 * reading assignments/JOs/shifts isn't something the client can do under
 * Firestore rules. Emails are deduped + cached; JOs/shifts are cached
 * across rows so a week of one crew costs a handful of reads.
 *
 * Block semantics (per product decision — block + flag, never silently
 * drop): a row is hard-`block`ed when the entity isn't Everee-enabled, no
 * HRX user matches, the email is ambiguous, or the worker has no Everee
 * linkage (needs onboarding). A matched+linked row with no paired
 * assignment is NOT blocked — it's flagged `needsPayRate` so the
 * recruiter can enter a rate inline (Phase 3); pay rate otherwise comes
 * from the paired assignment.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

import {
  resolveExternalWorkerId,
  resolveEvereeWorkerUuid,
} from '../payroll/workerContextResolver';
import { getEvereeConfigForEntity } from '../integrations/everee/evereeConfig';
import { normalizeSite, siteMappingDocId } from './timesheetSiteMappings';
import { normalizeEmail, workerAliasDocId } from './timesheetWorkerAliases';
import {
  loadWorksiteFromChildLocation,
  type AccountDoc,
} from '../jobOrders/gigJobOrderFromChildAccount';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

interface MatchRowInput {
  rowIndex: number;
  email: string;
  firstName?: string;
  lastName?: string;
  /** YYYY-MM-DD — used to pair an assignment whose window contains it. */
  workDate?: string;
  site?: string;
  role?: string;
}

interface MatchRowResult {
  rowIndex: number;
  email: string;
  matched: boolean;
  ambiguous: boolean;
  userId: string | null;
  displayName: string | null;
  evereeWorkerId: string | null;
  evereeLinked: boolean;
  block: boolean;
  blockReason: string | null;
  // ── Phase 2: paired assignment + resolved pay context ──
  assignmentId: string | null;
  jobOrderId: string | null;
  shiftId: string | null;
  jobTitle: string | null;
  worksiteId: string | null;
  worksiteName: string | null;
  /** HRX worksite address — maps to Everee's flat work-location body
   *  (street→line1, city, state, zip→postalCode) resolved at submit. */
  worksiteAddress: { street: string; city: string; state: string; zip: string } | null;
  /** Everee workers-comp CLASS CODE (the only WC field Everee accepts). */
  workersCompCode: string | null;
  /** WC rate — internal billing figure (C1 Select); NOT sent to Everee. */
  workersCompRate: number | null;
  payRate: number | null;
  /** Where the resolved pay context came from. */
  payRateSource: 'assignment' | 'site_mapping' | 'none';
  /** True when matched+linked but no pay rate resolved (needs inline entry). */
  needsPayRate: boolean;
  /** Candidate HRX workers offered when the email doesn't resolve cleanly
   *  (no match → name fallback; ambiguous → the colliding records). The
   *  recruiter picks one to create a remembered email→worker alias. */
  suggestions?: WorkerSuggestion[];
}

/** A candidate HRX worker for resolving an unmatched / ambiguous email. */
interface WorkerSuggestion {
  userId: string;
  displayName: string | null;
  email: string | null;
  evereeLinked: boolean;
  reason: string;
}

interface MatchWorkersResponse {
  evereeTenantId: string | null;
  entityEvereeEnabled: boolean;
  results: MatchRowResult[];
}

type Assignment = Record<string, any> & { id: string };

/** sec 5–7 on the active tenant (or HRX). */
async function assertTimesheetEditor(
  uid: string,
  token: Record<string, unknown> | undefined,
  tenantId: string,
): Promise<void> {
  if (token?.hrx === true) return;
  const userSnap = await db.collection('users').doc(uid).get();
  const data = (userSnap.data() || {}) as Record<string, any>;
  const nested = data.tenantIds?.[tenantId]?.securityLevel;
  const level = Number.parseInt(String(nested ?? data.securityLevel ?? '0'), 10) || 0;
  if (level >= 5 && level <= 7) return;
  throw new HttpsError('permission-denied', 'Importing timesheets requires tenant security level 5–7.');
}

type EmailLookup =
  | { kind: 'none' }
  | { kind: 'one'; id: string; data: Record<string, any> }
  | { kind: 'ambiguous'; candidates: Array<{ id: string; data: Record<string, any> }> };

async function findUserByEmail(
  email: string,
  tenantId: string,
  evereeTenantId: string | null,
): Promise<EmailLookup> {
  // Expand the query set so a messy customer email still hits a clean HRX
  // record: raw, lowercased, trimmed, and the canonical form (+tag stripped,
  // Gmail dots removed). De-duplicated to keep the query count small.
  const variants = Array.from(
    new Set(
      [email, email.toLowerCase(), email.trim(), normalizeEmail(email)]
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  );
  const found = new Map<string, Record<string, any>>();
  for (const v of variants) {
    const snap = await db.collection('users').where('email', '==', v).limit(5).get();
    snap.forEach((d) => found.set(d.id, d.data() as Record<string, any>));
  }
  if (found.size === 0) return { kind: 'none' };
  if (found.size === 1) {
    const [id, data] = [...found.entries()][0];
    return { kind: 'one', id, data };
  }

  // Several users share this email (duplicate records). Narrow to the
  // ones attached to this tenant first.
  let candidates = [...found.entries()].filter(
    ([, data]) => data.tenantIds && typeof data.tenantIds === 'object' && data.tenantIds[tenantId],
  );
  if (candidates.length === 0) candidates = [...found.entries()];
  if (candidates.length === 1) {
    const [id, data] = candidates[0];
    return { kind: 'one', id, data };
  }

  // Still ambiguous — prefer the record that's actually Everee-linked for
  // the paying entity (the payable one). Resolves the common "two HRX
  // users, one onboarded" duplicate without guessing.
  if (evereeTenantId) {
    const linked: Array<[string, Record<string, any>]> = [];
    for (const [id, data] of candidates) {
      // eslint-disable-next-line no-await-in-loop
      if (await resolveExternalWorkerId(tenantId, id, evereeTenantId)) linked.push([id, data]);
    }
    if (linked.length === 1) {
      const [id, data] = linked[0];
      return { kind: 'one', id, data };
    }
  }
  return { kind: 'ambiguous', candidates: candidates.map(([id, data]) => ({ id, data })) };
}

/** Load a single user doc by id (for alias resolution). */
async function findUserById(uid: string): Promise<Record<string, any> | null> {
  const snap = await db.collection('users').doc(uid).get();
  return snap.exists ? (snap.data() as Record<string, any>) : null;
}

/**
 * Bounded name lookup for the suggestion fallback. Queries the indexed
 * `lastName` field (a few case variants), each capped — NEVER an unbounded
 * tenant-wide scan. Returns the raw candidates; the caller filters by first
 * name + tenant membership.
 */
async function queryUsersByLastName(
  lastName: string,
): Promise<Array<{ id: string; data: Record<string, any> }>> {
  const ln = String(lastName || '').trim();
  if (!ln) return [];
  const titleCase = ln.charAt(0).toUpperCase() + ln.slice(1).toLowerCase();
  const variants = Array.from(new Set([ln, ln.toLowerCase(), ln.toUpperCase(), titleCase]));
  const found = new Map<string, Record<string, any>>();
  for (const v of variants) {
    // eslint-disable-next-line no-await-in-loop
    const snap = await db.collection('users').where('lastName', '==', v).limit(10).get();
    snap.forEach((d) => found.set(d.id, d.data() as Record<string, any>));
  }
  return [...found.entries()].map(([id, data]) => ({ id, data }));
}

/** All of a worker's assignments (by userId + candidateId), deduped, with
 *  terminal-cancelled ones dropped. */
async function loadWorkerAssignments(tenantId: string, userId: string): Promise<Assignment[]> {
  const col = db.collection(`tenants/${tenantId}/assignments`);
  const [byUser, byCand] = await Promise.all([
    col.where('userId', '==', userId).get(),
    col.where('candidateId', '==', userId).get(),
  ]);
  const seen = new Map<string, Assignment>();
  for (const snap of [byUser, byCand]) {
    snap.forEach((d) => {
      const data = d.data() as Record<string, any>;
      const st = String(data.status || '').toLowerCase();
      if (st === 'cancelled' || st === 'canceled' || st === 'declined') return;
      seen.set(d.id, { id: d.id, ...data });
    });
  }
  return [...seen.values()];
}

const ISO = /^\d{4}-\d{2}-\d{2}/;
const dateOnly = (v: unknown): string => {
  if (typeof v === 'string' && ISO.test(v)) return v.slice(0, 10);
  return '';
};

/** Pick the assignment whose [startDate, endDate] window contains
 *  `workDate` (empty endDate = ongoing). Prefer a paying rate + the most
 *  recent start. */
function pairAssignment(assignments: Assignment[], workDate: string): Assignment | null {
  if (!workDate) return null;
  const inWindow = assignments.filter((a) => {
    const start = dateOnly(a.startDate);
    if (!start || workDate < start) return false;
    const end = dateOnly(a.endDate);
    return !end || workDate <= end;
  });
  if (inWindow.length === 0) return null;
  inWindow.sort((a, b) => {
    const ar = Number(a.payRate) > 0 ? 1 : 0;
    const br = Number(b.payRate) > 0 ? 1 : 0;
    if (ar !== br) return br - ar; // paying rate first
    return dateOnly(b.startDate).localeCompare(dateOnly(a.startDate)); // most recent start
  });
  return inWindow[0];
}

const pickStr = (...c: unknown[]): string | undefined => {
  for (const v of c) {
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return undefined;
};

/** First positive finite number among the candidates, else null. */
const pickNum = (...c: unknown[]): number | null => {
  for (const v of c) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
};

/** Normalize a JO's worksite address to the shape the worker-side import
 *  grid shows and Everee's flat work-location body consumes. Returns null
 *  when no address component is present. */
function joWorksiteAddress(
  jo: Record<string, any> | null,
): { street: string; city: string; state: string; zip: string } | null {
  const a = (jo?.worksiteAddress && typeof jo.worksiteAddress === 'object'
    ? jo.worksiteAddress
    : {}) as Record<string, any>;
  const street = String(a.street ?? a.line1 ?? a.addressLine1 ?? '').trim();
  const city = String(a.city ?? '').trim();
  const state = String(a.state ?? '').trim();
  const zip = String(a.zip ?? a.postalCode ?? a.postal ?? '').trim();
  if (!street && !city && !state && !zip) return null;
  return { street, city, state, zip };
}

/** Resolve pay context from a JO + role (no assignment/shift) — used for
 *  site-mapped rows. Picks the JO position matching the role when possible,
 *  else the first position / JO-level rate. */
function resolveJobOrderFields(
  jo: Record<string, any>,
  role: string,
): {
  payRate: number;
  jobTitle: string | null;
  worksiteId: string | null;
  worksiteName: string | null;
  worksiteAddress: { street: string; city: string; state: string; zip: string } | null;
  workersCompCode: string | null;
  workersCompRate: number | null;
} {
  const positions: Array<Record<string, any>> =
    (Array.isArray(jo.positions) && jo.positions.length
      ? jo.positions
      : Array.isArray(jo.gigPositions)
        ? jo.gigPositions
        : []) || [];
  const roleNorm = String(role || '').trim().toLowerCase();
  const pos =
    positions.find((p) => String(p?.jobTitle || '').trim().toLowerCase() === roleNorm) ||
    (roleNorm
      ? positions.find((p) => String(p?.jobTitle || '').trim().toLowerCase().includes(roleNorm))
      : undefined) ||
    positions[0] ||
    null;
  const payRate =
    Number(pos?.payRate) > 0
      ? Number(pos.payRate)
      : Number(jo.payRate) > 0
        ? Number(jo.payRate)
        : 0;
  const firstGig =
    Array.isArray(jo.gigPositions) && jo.gigPositions.length > 0 ? jo.gigPositions[0] : null;
  return {
    payRate,
    jobTitle: pickStr(pos?.jobTitle, jo.jobTitle, role) ?? null,
    worksiteId: pickStr(jo.worksiteId, jo.locationId) ?? null,
    worksiteName: pickStr(jo.worksiteName, jo.locationName) ?? null,
    worksiteAddress: joWorksiteAddress(jo),
    workersCompCode:
      pickStr(
        pos?.workersCompCode,
        pos?.workersCompClassCode,
        jo.workersCompCode,
        jo.workersCompClassCode,
        firstGig?.workersCompClassCode,
      ) ?? null,
    workersCompRate: pickNum(
      pos?.workersCompRate,
      jo.workersCompRate,
      firstGig?.workersCompRate,
    ),
  };
}

export const importTimesheetMatchWorkers = onCall(
  { cors: true },
  async (request): Promise<MatchWorkersResponse> => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const { tenantId, hiringEntityId, customer, rows } = (request.data || {}) as {
      tenantId?: string;
      hiringEntityId?: string;
      customer?: string;
      rows?: MatchRowInput[];
    };
    if (!tenantId || !hiringEntityId || !Array.isArray(rows)) {
      throw new HttpsError('invalid-argument', 'tenantId, hiringEntityId, and rows[] are required');
    }
    if (rows.length > 2000) {
      throw new HttpsError('invalid-argument', 'Too many rows in one match call (max 2000).');
    }
    await assertTimesheetEditor(
      request.auth.uid,
      request.auth.token as Record<string, unknown>,
      tenantId,
    );

    const evereeCfg = await getEvereeConfigForEntity(tenantId, hiringEntityId);
    const evereeTenantId = evereeCfg?.evereeTenantId ?? null;
    const entityEvereeEnabled = !!evereeTenantId;

    // ── Caches ──
    type Resolved =
      | { kind: 'none' }
      | { kind: 'ambiguous'; suggestions: WorkerSuggestion[] }
      | {
          kind: 'user';
          userId: string;
          displayName: string;
          evereeWorkerId: string | null;
          evereeLinked: boolean;
          assignments: Assignment[];
        };
    const emailCache = new Map<string, Resolved>();
    const aliasCache = new Map<string, string | null>();
    const nameCache = new Map<string, WorkerSuggestion[]>();
    const joCache = new Map<string, Record<string, any> | null>();
    const shiftCache = new Map<string, Record<string, any> | null>();

    const loadJobOrder = async (jobOrderId: string): Promise<Record<string, any> | null> => {
      if (joCache.has(jobOrderId)) return joCache.get(jobOrderId) ?? null;
      let jo: Record<string, any> | null = null;
      for (const path of [
        `tenants/${tenantId}/job_orders/${jobOrderId}`,
        `tenants/${tenantId}/jobOrders/${jobOrderId}`,
        `tenants/${tenantId}/recruiter_jobOrders/${jobOrderId}`,
      ]) {
        try {
          const snap = await db.doc(path).get();
          if (snap.exists) {
            jo = snap.data() as Record<string, any>;
            break;
          }
        } catch {
          /* walk next */
        }
      }
      joCache.set(jobOrderId, jo);
      return jo;
    };

    const loadShift = async (
      jobOrderId: string,
      shiftId: string,
    ): Promise<Record<string, any> | null> => {
      const key = `${jobOrderId}/${shiftId}`;
      if (shiftCache.has(key)) return shiftCache.get(key) ?? null;
      let shift: Record<string, any> | null = null;
      try {
        const snap = await db
          .doc(`tenants/${tenantId}/job_orders/${jobOrderId}/shifts/${shiftId}`)
          .get();
        shift = snap.exists ? (snap.data() as Record<string, any>) : null;
      } catch {
        shift = null;
      }
      shiftCache.set(key, shift);
      return shift;
    };

    // Account-level fallback: when the job order is silent on WC code/rate or
    // worksite address, fill from the child account (its top-level WC fields +
    // its CRM-location worksite). Lets a thin JO still produce a complete
    // Everee payload — mirrors how gigJobOrderFromChildAccount hydrates a JO.
    type AccountFallback = {
      workersCompCode: string | null;
      workersCompRate: number | null;
      worksiteId: string | null;
      worksiteName: string | null;
      worksiteAddress: { street: string; city: string; state: string; zip: string } | null;
    };
    const accountCache = new Map<string, AccountFallback | null>();
    const loadAccountFallback = async (accountId: string): Promise<AccountFallback | null> => {
      if (!accountId) return null;
      if (accountCache.has(accountId)) return accountCache.get(accountId) ?? null;
      let result: AccountFallback | null = null;
      try {
        const snap = await db.doc(`tenants/${tenantId}/accounts/${accountId}`).get();
        if (snap.exists) {
          const acc = snap.data() as AccountDoc;
          const worksite = await loadWorksiteFromChildLocation(db, tenantId, acc);
          result = {
            workersCompCode:
              typeof acc.workersCompCode === 'string' && acc.workersCompCode.trim()
                ? acc.workersCompCode.trim()
                : null,
            workersCompRate: pickNum(acc.workersCompRate),
            worksiteId: worksite?.worksiteId ?? null,
            worksiteName: worksite?.worksiteName ?? null,
            worksiteAddress: worksite
              ? {
                  street: worksite.worksiteAddress.street,
                  city: worksite.worksiteAddress.city,
                  state: worksite.worksiteAddress.state,
                  zip: worksite.worksiteAddress.zipCode,
                }
              : null,
          };
        }
      } catch {
        result = null;
      }
      accountCache.set(accountId, result);
      return result;
    };

    type ResolvedFields = ReturnType<typeof resolveJobOrderFields>;
    const backfillFromAccount = async (
      accountId: string | undefined,
      fields: ResolvedFields,
    ): Promise<ResolvedFields> => {
      const needWorksite = !fields.worksiteAddress;
      const needWc = !fields.workersCompCode;
      const needWcRate = fields.workersCompRate == null;
      if ((!needWorksite && !needWc && !needWcRate) || !accountId) return fields;
      const acc = await loadAccountFallback(accountId);
      if (!acc) return fields;
      const out = { ...fields };
      if (needWorksite && acc.worksiteAddress) {
        out.worksiteId = acc.worksiteId ?? fields.worksiteId;
        out.worksiteName = acc.worksiteName ?? fields.worksiteName;
        out.worksiteAddress = acc.worksiteAddress;
      }
      if (needWc && acc.workersCompCode) out.workersCompCode = acc.workersCompCode;
      if (needWcRate && acc.workersCompRate != null) out.workersCompRate = acc.workersCompRate;
      return out;
    };

    // Site → JO mapping resolution (for rows with no paired assignment).
    const siteMapCache = new Map<string, { jobOrderId: string } | null>();
    const resolveSiteMapping = async (
      site: string,
      role: string,
    ): Promise<Partial<MatchRowResult> | null> => {
      const c = String(customer || '').trim();
      const sNorm = normalizeSite(site);
      if (!c || !sNorm) return null;
      let mapping = siteMapCache.get(sNorm);
      if (mapping === undefined) {
        const docId = siteMappingDocId(c, site);
        const snap = await db.doc(`tenants/${tenantId}/timesheet_site_mappings/${docId}`).get();
        const data = snap.exists ? (snap.data() as Record<string, any>) : null;
        mapping = data?.jobOrderId ? { jobOrderId: String(data.jobOrderId) } : null;
        siteMapCache.set(sNorm, mapping);
      }
      if (!mapping) return null;
      const jo = await loadJobOrder(mapping.jobOrderId);
      if (!jo) return null;
      const accountId = pickStr(jo.recruiterAccountId, jo.accountId);
      const f = await backfillFromAccount(accountId, resolveJobOrderFields(jo, role));
      return {
        assignmentId: null,
        jobOrderId: mapping.jobOrderId,
        shiftId: null,
        jobTitle: f.jobTitle,
        worksiteId: f.worksiteId,
        worksiteName: f.worksiteName,
        worksiteAddress: f.worksiteAddress,
        workersCompCode: f.workersCompCode,
        workersCompRate: f.workersCompRate,
        payRate: f.payRate || null,
      };
    };

    const buildUserResolved = async (
      id: string,
      data: Record<string, any>,
    ): Promise<Resolved> => {
      const displayName =
        [data.firstName, data.lastName].filter(Boolean).join(' ') ||
        (data.displayName as string) ||
        id;
      let evereeLinked = false;
      let evereeWorkerId: string | null = null;
      if (evereeTenantId) {
        const ext = await resolveExternalWorkerId(tenantId, id, evereeTenantId);
        evereeLinked = !!ext;
        if (evereeLinked) {
          evereeWorkerId = await resolveEvereeWorkerUuid(tenantId, id, evereeTenantId);
        }
      }
      const assignments = await loadWorkerAssignments(tenantId, id);
      return { kind: 'user', userId: id, displayName, evereeWorkerId, evereeLinked, assignments };
    };

    const buildSuggestion = async (
      id: string,
      data: Record<string, any>,
      reason: string,
    ): Promise<WorkerSuggestion> => {
      let evereeLinked = false;
      if (evereeTenantId) {
        evereeLinked = !!(await resolveExternalWorkerId(tenantId, id, evereeTenantId));
      }
      return {
        userId: id,
        displayName:
          [data.firstName, data.lastName].filter(Boolean).join(' ') ||
          (typeof data.displayName === 'string' ? data.displayName : null),
        email: typeof data.email === 'string' ? data.email : null,
        evereeLinked,
        reason,
      };
    };

    // Name fallback (per row, cached by name) — when no email matched, offer
    // same-last-name workers whose first name is consistent. Suggestions are
    // never auto-applied; the recruiter confirms one to create an alias.
    const nameSuggestions = async (
      firstName: string,
      lastName: string,
    ): Promise<WorkerSuggestion[]> => {
      const ln = String(lastName || '').trim();
      if (!ln) return [];
      const fn = String(firstName || '').trim().toLowerCase();
      const cacheKey = `${ln.toLowerCase()}|${fn}`;
      const cached = nameCache.get(cacheKey);
      if (cached) return cached;
      const rows = await queryUsersByLastName(ln);
      const scored = rows
        .map((x) => {
          const dfn = String(x.data.firstName || '').trim().toLowerCase();
          const firstOk = !fn || !dfn || dfn === fn || dfn.startsWith(fn) || fn.startsWith(dfn);
          const tenantMember = !!(
            x.data.tenantIds &&
            typeof x.data.tenantIds === 'object' &&
            x.data.tenantIds[tenantId]
          );
          return { ...x, firstOk, tenantMember };
        })
        .filter((x) => x.firstOk)
        .sort((a, b) => Number(b.tenantMember) - Number(a.tenantMember))
        .slice(0, 5);
      const out: WorkerSuggestion[] = [];
      for (const x of scored) {
        // eslint-disable-next-line no-await-in-loop
        out.push(
          await buildSuggestion(
            x.id,
            x.data,
            x.tenantMember ? 'name match (this tenant)' : 'name match',
          ),
        );
      }
      nameCache.set(cacheKey, out);
      return out;
    };

    const resolveAlias = async (email: string): Promise<string | null> => {
      const norm = normalizeEmail(email);
      if (!norm) return null;
      if (aliasCache.has(norm)) return aliasCache.get(norm) ?? null;
      let uid: string | null = null;
      try {
        const snap = await db
          .doc(`tenants/${tenantId}/timesheet_worker_aliases/${workerAliasDocId(email)}`)
          .get();
        uid = snap.exists ? String((snap.data() as any).userId || '') || null : null;
      } catch {
        uid = null;
      }
      aliasCache.set(norm, uid);
      return uid;
    };

    const resolveEmail = async (email: string): Promise<Resolved> => {
      const key = email.toLowerCase().trim();
      const cached = emailCache.get(key);
      if (cached) return cached;
      let resolved: Resolved;

      // 1. A remembered email→worker alias wins outright.
      const aliasUid = await resolveAlias(email);
      if (aliasUid) {
        const data = await findUserById(aliasUid);
        if (data) {
          resolved = await buildUserResolved(aliasUid, data);
          emailCache.set(key, resolved);
          return resolved;
        }
      }

      // 2. Email lookup (expanded variants + duplicate tiebreak).
      const u = await findUserByEmail(key, tenantId, evereeTenantId);
      if (u.kind === 'one') {
        resolved = await buildUserResolved(u.id, u.data);
      } else if (u.kind === 'ambiguous') {
        const suggestions: WorkerSuggestion[] = [];
        for (const c of u.candidates) {
          // eslint-disable-next-line no-await-in-loop
          suggestions.push(await buildSuggestion(c.id, c.data, 'shares this email'));
        }
        resolved = { kind: 'ambiguous', suggestions };
      } else {
        resolved = { kind: 'none' };
      }
      emailCache.set(key, resolved);
      return resolved;
    };

    const EMPTY_FIELDS = {
      assignmentId: null,
      jobOrderId: null,
      shiftId: null,
      jobTitle: null,
      worksiteId: null,
      worksiteName: null,
      worksiteAddress: null,
      workersCompCode: null,
      workersCompRate: null,
      payRate: null,
      payRateSource: 'none' as const,
      needsPayRate: true,
    };

    const results: MatchRowResult[] = [];
    for (const row of rows) {
      const email = String(row.email || '').trim();
      const workDate = dateOnly(row.workDate);
      const base: MatchRowResult = {
        rowIndex: row.rowIndex,
        email,
        matched: false,
        ambiguous: false,
        userId: null,
        displayName: null,
        evereeWorkerId: null,
        evereeLinked: false,
        block: true,
        blockReason: null,
        ...EMPTY_FIELDS,
      };

      if (!email) {
        results.push({ ...base, blockReason: 'No email address.' });
        continue;
      }
      const r = await resolveEmail(email);
      if (r.kind === 'none') {
        const suggestions = await nameSuggestions(
          String(row.firstName || ''),
          String(row.lastName || ''),
        );
        results.push({
          ...base,
          blockReason: `No HRX worker found for ${email}.`,
          ...(suggestions.length ? { suggestions } : {}),
        });
        continue;
      }
      if (r.kind === 'ambiguous') {
        results.push({
          ...base,
          ambiguous: true,
          blockReason: 'Multiple HRX users share this email — resolve manually.',
          ...(r.suggestions.length ? { suggestions: r.suggestions } : {}),
        });
        continue;
      }

      // Matched to a user — resolve hard-block first.
      const matchedBase: MatchRowResult = {
        ...base,
        matched: true,
        userId: r.userId,
        displayName: r.displayName,
        evereeWorkerId: r.evereeWorkerId,
        evereeLinked: r.evereeLinked,
      };
      if (!entityEvereeEnabled) {
        results.push({
          ...matchedBase,
          blockReason: 'Selected hiring entity is not configured for Everee payroll.',
        });
        continue;
      }
      if (!r.evereeLinked) {
        results.push({
          ...matchedBase,
          blockReason: `${r.displayName} isn't linked to Everee for this entity — needs onboarding.`,
        });
        continue;
      }

      // Payable. Best-effort assignment pairing + field resolution.
      const assignment = pairAssignment(r.assignments, workDate);
      if (!assignment) {
        // No HRX assignment — fall back to a saved Site→JO mapping for this
        // customer + site, if one exists.
        const mapped = await resolveSiteMapping(String(row.site || ''), String(row.role || ''));
        if (mapped) {
          results.push({
            ...matchedBase,
            block: false,
            blockReason: null,
            ...mapped,
            payRateSource: 'site_mapping',
            needsPayRate: !(Number(mapped.payRate) > 0),
          });
        } else {
          results.push({ ...matchedBase, block: false, blockReason: null }); // needsPayRate stays true
        }
        continue;
      }
      const jobOrderId = pickStr(assignment.jobOrderId) ?? null;
      const shiftId = pickStr(assignment.shiftId) ?? null;
      const jo = jobOrderId ? await loadJobOrder(jobOrderId) : null;
      const shift = jobOrderId && shiftId ? await loadShift(jobOrderId, shiftId) : null;
      const firstGigPosition =
        Array.isArray(jo?.gigPositions) && jo!.gigPositions.length > 0
          ? (jo!.gigPositions[0] as Record<string, any>)
          : null;
      const payRate =
        Number(assignment.payRate) > 0
          ? Number(assignment.payRate)
          : Number(jo?.payRate) > 0
            ? Number(jo?.payRate)
            : 0;
      // Resolve from assignment/shift/JO, then backfill any gaps (WC code/rate,
      // worksite address) from the child account.
      const accountId = pickStr(jo?.recruiterAccountId, jo?.accountId, assignment.accountId);
      const f = await backfillFromAccount(accountId, {
        payRate,
        jobTitle: pickStr(assignment.jobTitle, shift?.defaultJobTitle, jo?.jobTitle) ?? null,
        worksiteId: pickStr(jo?.worksiteId, jo?.locationId) ?? null,
        worksiteName: pickStr(jo?.worksiteName, jo?.locationName) ?? null,
        worksiteAddress: joWorksiteAddress(jo),
        workersCompCode:
          pickStr(
            shift?.workersCompCode,
            jo?.workersCompCode,
            jo?.workersCompClassCode,
            firstGigPosition?.workersCompClassCode,
          ) ?? null,
        workersCompRate: pickNum(
          shift?.workersCompRate,
          jo?.workersCompRate,
          firstGigPosition?.workersCompRate,
        ),
      });
      results.push({
        ...matchedBase,
        block: false,
        blockReason: null,
        assignmentId: assignment.id,
        jobOrderId,
        shiftId,
        jobTitle: f.jobTitle,
        worksiteId: f.worksiteId,
        worksiteName: f.worksiteName,
        worksiteAddress: f.worksiteAddress,
        workersCompCode: f.workersCompCode,
        workersCompRate: f.workersCompRate,
        payRate: payRate || null,
        payRateSource: payRate > 0 ? 'assignment' : 'none',
        needsPayRate: !(payRate > 0),
      });
    }

    return { evereeTenantId, entityEvereeEnabled, results };
  },
);

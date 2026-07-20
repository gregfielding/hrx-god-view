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
import { getEvereeConfigForEntity, evereePaths } from '../integrations/everee/evereeConfig';
import { extractEvereeHomeAddressFromUserDoc } from '../integrations/everee/evereeUserAddress';
import { normalizeSite, siteMappingDocId } from './timesheetSiteMappings';
import { aliasKeyFor } from '../integrations/indeedFlex/matcher/venueAliases';
import {
  normalizeEmail,
  workerAliasDocId,
  normalizeName,
  nameAliasDocId,
} from './timesheetWorkerAliases';
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
  /** Recruiter manually picked this HRX worker for the row (worker-lookup
   *  pencil). When set, resolution skips email/name matching and binds this
   *  exact user — the rest of the cascade (Everee link, pay, WC) still runs. */
  forcedUserId?: string;
}

interface MatchRowResult {
  rowIndex: number;
  email: string;
  matched: boolean;
  ambiguous: boolean;
  userId: string | null;
  displayName: string | null;
  /** The matched HRX worker's contact info (NOT the CSV's) — shown on the row
   *  so the recruiter can confirm identity even when the CSV had no email. */
  matchedEmail: string | null;
  matchedPhone: string | null;
  evereeWorkerId: string | null;
  evereeLinked: boolean;
  /** Matched by name (no-email customers like Connect Team) — lower
   *  confidence than an email/alias match, shown "probable" in the grid. */
  matchedByName: boolean;
  /** Manually picked by the recruiter (worker-lookup pencil) — highest
   *  confidence; overrides any auto match for this row. */
  matchedManual: boolean;
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
  /** Client-billing rate from the same resolution chain (assignment →
   *  shift → JO position → JO). Import rows are worker-anchored with no
   *  assignment, so without this every imported hour reported $0 billed
   *  in the money views even when the venue's JO had a bill rate. */
  billRate: number | null;
  /** Where the resolved pay context came from. */
  payRateSource: 'assignment' | 'site_mapping' | 'none';
  /** Provenance of WC + worksite (assignment/JO = exact, site_mapping =
   *  probable, account = account-level fallback, none = unresolved). Drives
   *  the grid's confidence color-coding. */
  workersCompSource: 'assignment' | 'site_mapping' | 'account' | 'none';
  worksiteSource: 'assignment' | 'site_mapping' | 'account' | 'none';
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
  phone: string | null;
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

/** Accent/punctuation-insensitive name key for comparison. */
function nameKey(s: unknown): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics (José → jose)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Bounded name lookup. Queries the indexed `lastName` field for the full last
 * name AND its last token (so a CSV multi-token last name like "Martinez
 * Ramirez" still finds an HRX worker stored as "Ramirez"), each case variant
 * capped — NEVER an unbounded tenant-wide scan. Caller filters by first/last
 * name tokens + tenant membership.
 */
async function queryUsersByLastName(
  lastName: string,
): Promise<Array<{ id: string; data: Record<string, any> }>> {
  const ln = String(lastName || '').trim();
  if (!ln) return [];
  const tokens = ln.split(/\s+/).filter(Boolean);
  const bases = Array.from(new Set([ln, tokens[tokens.length - 1] || ln, tokens[0] || ln]));
  // Title-case + as-typed only (HRX stores names title-cased) — keeps the
  // per-name read count low for a 1000+ row batch.
  const tc = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  const variants = Array.from(new Set(bases.flatMap((b) => [b, tc(b)])));
  const found = new Map<string, Record<string, any>>();
  for (const v of variants) {
    // Prefix range (subsumes the exact match) — so a CSV "Santiago" also
    // finds an HRX "Santiago Guillén".
    // eslint-disable-next-line no-await-in-loop
    const pre = await db
      .collection('users')
      .where('lastName', '>=', v)
      .where('lastName', '<', `${v}`)
      .limit(15)
      .get();
    pre.forEach((d) => found.set(d.id, d.data() as Record<string, any>));
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
  billRate: number;
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
  const billRate =
    Number(pos?.billRate) > 0
      ? Number(pos.billRate)
      : Number(jo.billRate) > 0
        ? Number(jo.billRate)
        : 0;
  const firstGig =
    Array.isArray(jo.gigPositions) && jo.gigPositions.length > 0 ? jo.gigPositions[0] : null;
  return {
    payRate,
    billRate,
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
  // Large batches (1000+ rows) do many Firestore reads; give headroom beyond
  // the 60s default and more CPU for the concurrent per-row resolution.
  { cors: true, timeoutSeconds: 300, memory: '1GiB' },
  async (request): Promise<MatchWorkersResponse> => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const { tenantId, hiringEntityId, hiringEntityName, customer, customerAccount, rows } =
      (request.data || {}) as {
        tenantId?: string;
        hiringEntityId?: string;
        hiringEntityName?: string;
        customer?: string;
        /** Standing account for this customer (e.g. Connect Team → "VenueSmart").
         *  Used to break same-name ties toward a worker assigned to that account. */
        customerAccount?: string;
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
          email: string | null;
          phone: string | null;
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
    ): Promise<{ fields: ResolvedFields; filledWorksite: boolean; filledWc: boolean }> => {
      const needWorksite = !fields.worksiteAddress;
      const needWc = !fields.workersCompCode;
      const needWcRate = fields.workersCompRate == null;
      if ((!needWorksite && !needWc && !needWcRate) || !accountId) {
        return { fields, filledWorksite: false, filledWc: false };
      }
      const acc = await loadAccountFallback(accountId);
      if (!acc) return { fields, filledWorksite: false, filledWc: false };
      const out = { ...fields };
      let filledWorksite = false;
      let filledWc = false;
      if (needWorksite && acc.worksiteAddress) {
        out.worksiteId = acc.worksiteId ?? fields.worksiteId;
        out.worksiteName = acc.worksiteName ?? fields.worksiteName;
        out.worksiteAddress = acc.worksiteAddress;
        filledWorksite = true;
      }
      if (needWc && acc.workersCompCode) {
        out.workersCompCode = acc.workersCompCode;
        filledWc = true;
      }
      if (needWcRate && acc.workersCompRate != null) {
        out.workersCompRate = acc.workersCompRate;
        filledWc = true;
      }
      return { fields: out, filledWorksite, filledWc };
    };

    // Site → JO mapping resolution (for rows with no paired assignment).
    const siteMapCache = new Map<string, { jobOrderId: string; positionJobTitle: string } | null>();
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
        mapping = data?.jobOrderId
          ? { jobOrderId: String(data.jobOrderId), positionJobTitle: String(data.positionJobTitle || '') }
          : null;
        siteMapCache.set(sNorm, mapping);
      }
      if (!mapping) return null;
      const jo = await loadJobOrder(mapping.jobOrderId);
      if (!jo) return null;
      const accountId = pickStr(jo.recruiterAccountId, jo.accountId);
      // Prefer the position the recruiter picked when they mapped (JOs can have
      // multiple positions with different pay/WC); fall back to the CSV role.
      const { fields: f, filledWorksite, filledWc } = await backfillFromAccount(
        accountId,
        resolveJobOrderFields(jo, mapping.positionJobTitle || role),
      );
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
        billRate: f.billRate || null,
        workersCompSource: f.workersCompCode ? (filledWc ? 'account' : 'site_mapping') : 'none',
        worksiteSource: f.worksiteAddress ? (filledWorksite ? 'account' : 'site_mapping') : 'none',
      };
    };

    // Venue-alias fallback (2026-07-19 unification): when no manual site
    // mapping exists, consult the Indeed Flex `venue_aliases` store — the
    // "Link to account" teachings from the Shifts Log. An alias resolves the
    // CSV site to an ACCOUNT; the account's rolling Indeed Flex inbox gig JO
    // (same convention as the intake matcher) then supplies pay/WC/worksite.
    // On success we self-write the timesheet_site_mapping so the next import
    // takes the fast path — teach once anywhere, known everywhere.
    let venueAliasList: Array<{ key: string; accountId: string; accountName: string }> | null = null;
    const loadVenueAliases = async () => {
      if (venueAliasList) return venueAliasList;
      const snap = await db.collection(`tenants/${tenantId}/venue_aliases`).limit(500).get();
      venueAliasList = snap.docs
        .map((d) => {
          const a = d.data() as Record<string, any>;
          return {
            key: String(a.aliasKey || '').trim(),
            accountId: String(a.accountId || '').trim(),
            accountName: String(a.accountName || '').trim(),
          };
        })
        .filter((a) => a.key.length >= 8 && a.accountId);
      return venueAliasList;
    };
    const findInboxGigJo = async (
      accountId: string,
    ): Promise<{ id: string; jo: Record<string, any> } | null> => {
      for (const coll of ['job_orders', 'jobOrders', 'recruiter_jobOrders']) {
        try {
          const snap = await db
            .collection(`tenants/${tenantId}/${coll}`)
            .where('recruiterAccountId', '==', accountId)
            .where('jobType', '==', 'gig')
            .where('status', '==', 'open')
            .limit(5)
            .get();
          if (!snap.empty) {
            const docs = [...snap.docs].sort((a, b) => {
              const ua = (a.data().updatedAt?.toMillis?.() as number) ?? 0;
              const ub = (b.data().updatedAt?.toMillis?.() as number) ?? 0;
              return ub - ua;
            });
            return { id: docs[0].id, jo: docs[0].data() as Record<string, any> };
          }
        } catch {
          /* collection may not exist — walk next */
        }
      }
      return null;
    };
    // Cache the ROLE-INDEPENDENT half only (alias hit + inbox JO) — the
    // field resolution picks a JO position (pay/WC/title) BY ROLE, so
    // caching the final result under the site alone handed the first
    // row's rate to every other role at the same venue (review fix
    // 2026-07-19).
    const venueAliasTargetCache = new Map<
      string,
      { accountId: string; accountName: string; joId: string; jo: Record<string, any>; exact: boolean } | null
    >();
    const resolveViaVenueAlias = async (
      site: string,
      role: string,
    ): Promise<Partial<MatchRowResult> | null> => {
      const siteKey = aliasKeyFor(site);
      if (siteKey.length < 8) return null;
      let target = venueAliasTargetCache.get(siteKey);
      if (target === undefined) {
        const aliases = await loadVenueAliases();
        // Exact key first. Containment is a FALLBACK with guards (review
        // fix 2026-07-19 — unguarded substring matching could hijack a
        // different customer's similarly-named venue): the shorter string
        // must be ≥12 chars AND exactly ONE alias may match — any
        // ambiguity means no match.
        const exactHit = aliases.find((a) => a.key === siteKey) ?? null;
        let hit = exactHit;
        if (!hit) {
          const contains = aliases.filter(
            (a) =>
              Math.min(a.key.length, siteKey.length) >= 12 &&
              (a.key.includes(siteKey) || siteKey.includes(a.key)),
          );
          hit = contains.length === 1 ? contains[0] : null;
        }
        if (hit) {
          const inbox = await findInboxGigJo(hit.accountId);
          target = inbox
            ? {
                accountId: hit.accountId,
                accountName: hit.accountName,
                joId: inbox.id,
                jo: inbox.jo,
                exact: hit === exactHit,
              }
            : null;
        } else {
          target = null;
        }
        venueAliasTargetCache.set(siteKey, target);
        // Self-write the site mapping ONLY for exact alias matches — a
        // containment guess resolves today's rows but must not become a
        // permanent mapping without a human confirming it (the Import tab
        // mapping UI remains the way to lock it in).
        if (target?.exact) {
          const c = String(customer || '').trim();
          if (c) {
            db.doc(`tenants/${tenantId}/timesheet_site_mappings/${siteMappingDocId(c, site)}`)
              .set(
                {
                  tenantId,
                  customer: c,
                  site,
                  normalizedSite: normalizeSite(site),
                  jobOrderId: target.joId,
                  positionJobTitle: '',
                  accountId: target.accountId,
                  accountName: target.accountName || null,
                  source: 'venue_alias_auto',
                  createdAt: admin.firestore.FieldValue.serverTimestamp(),
                  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                },
                { merge: true },
              )
              .catch(() => undefined);
          }
        }
      }
      if (!target) return null;
      const { fields: f, filledWorksite, filledWc } = await backfillFromAccount(
        target.accountId,
        resolveJobOrderFields(target.jo, role),
      );
      return {
        assignmentId: null,
        jobOrderId: target.joId,
        shiftId: null,
        jobTitle: f.jobTitle,
        worksiteId: f.worksiteId,
        worksiteName: f.worksiteName,
        worksiteAddress: f.worksiteAddress,
        workersCompCode: f.workersCompCode,
        workersCompRate: f.workersCompRate,
        payRate: f.payRate || null,
        billRate: f.billRate || null,
        workersCompSource: f.workersCompCode ? (filledWc ? 'account' : 'site_mapping') : 'none',
        worksiteSource: f.worksiteAddress ? (filledWorksite ? 'account' : 'site_mapping') : 'none',
      };
    };

    // Auto JO-name match (for rows with no manual mapping): partial-match the
    // row's site (the customer's "Type"/event, e.g. "Railbird Music Festival")
    // against the customer account's (VenueSmart) job orders by name. Those
    // JOs carry the pay rate / WC / worksite on their positions, so a confident
    // name match resolves the row with no manual mapping. Marked "probable"
    // (site_mapping) — a name match, not a paired assignment.
    let accountJoCache: Array<{ id: string; name: string; jo: Record<string, any> }> | null = null;
    const loadCustomerAccountJobOrders = async () => {
      if (accountJoCache) return accountJoCache;
      const acct = String(customerAccount || '').trim();
      const byId = new Map<string, { id: string; name: string; jo: Record<string, any> }>();
      if (acct) {
        for (const coll of ['job_orders', 'jobOrders', 'recruiter_jobOrders']) {
          for (const field of ['recruiterAccountName', 'accountName', 'companyName']) {
            try {
              // eslint-disable-next-line no-await-in-loop
              const snap = await db
                .collection(`tenants/${tenantId}/${coll}`)
                .where(field, '==', acct)
                .limit(200)
                .get();
              snap.forEach((d) => {
                if (byId.has(d.id)) return;
                const jo = d.data() as Record<string, any>;
                const name = pickStr(jo.jobTitle, jo.title, jo.name, jo.positionTitle) || '';
                byId.set(d.id, { id: d.id, name, jo });
              });
            } catch {
              /* field/index may not exist on this collection — skip */
            }
          }
        }
      }
      accountJoCache = [...byId.values()];
      return accountJoCache;
    };

    const normJoName = (s: unknown): string =>
      String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const joNameMatchCache = new Map<string, Partial<MatchRowResult> | null>();
    const resolveByJobOrderName = async (
      site: string,
      role: string,
    ): Promise<Partial<MatchRowResult> | null> => {
      const target = normJoName(site);
      if (!target || !String(customerAccount || '').trim()) return null;
      if (joNameMatchCache.has(target)) return joNameMatchCache.get(target) ?? null;
      const jos = await loadCustomerAccountJobOrders();
      const tTokens = new Set(target.split(' ').filter((w) => w.length > 2));
      let best: { id: string; jo: Record<string, any> } | null = null;
      let bestScore = 0;
      for (const j of jos) {
        const n = normJoName(j.name);
        if (!n) continue;
        let score = 0;
        if (n === target) score = 1;
        else if (n.includes(target) || target.includes(n)) score = 0.9;
        else if (tTokens.size) {
          const shared = n.split(' ').filter((w) => tTokens.has(w)).length;
          score = shared / tTokens.size;
        }
        if (score > bestScore) {
          bestScore = score;
          best = { id: j.id, jo: j.jo };
        }
      }
      let result: Partial<MatchRowResult> | null = null;
      if (best && bestScore >= 0.8) {
        const accountId = pickStr(best.jo.recruiterAccountId, best.jo.accountId);
        const { fields: f, filledWorksite, filledWc } = await backfillFromAccount(
          accountId,
          resolveJobOrderFields(best.jo, role),
        );
        result = {
          assignmentId: null,
          jobOrderId: best.id,
          shiftId: null,
          jobTitle: f.jobTitle,
          worksiteId: f.worksiteId,
          worksiteName: f.worksiteName,
          worksiteAddress: f.worksiteAddress,
          workersCompCode: f.workersCompCode,
          workersCompRate: f.workersCompRate,
          payRate: f.payRate || null,
          billRate: f.billRate || null,
          workersCompSource: f.workersCompCode ? (filledWc ? 'account' : 'site_mapping') : 'none',
          worksiteSource: f.worksiteAddress ? (filledWorksite ? 'account' : 'site_mapping') : 'none',
        };
      }
      joNameMatchCache.set(target, result);
      return result;
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
      const email = typeof data.email === 'string' ? data.email : null;
      const phone =
        typeof data.phone === 'string'
          ? data.phone
          : typeof data.phoneNumber === 'string'
            ? data.phoneNumber
            : null;
      return { kind: 'user', userId: id, displayName, email, phone, evereeWorkerId, evereeLinked, assignments };
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
        phone:
          typeof data.phone === 'string'
            ? data.phone
            : typeof data.phoneNumber === 'string'
              ? data.phoneNumber
              : null,
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

    // ── Name-based matching (no-email customers, e.g. Connect Team) ──
    const nameAliasCache = new Map<string, string | null>();
    const resolveNameAlias = async (
      firstName: string,
      lastName: string,
    ): Promise<string | null> => {
      const c = String(customer || '').trim();
      if (!c || (!firstName && !lastName)) return null;
      const nk = normalizeName(firstName, lastName);
      if (nameAliasCache.has(nk)) return nameAliasCache.get(nk) ?? null;
      let uid: string | null = null;
      try {
        const snap = await db
          .doc(`tenants/${tenantId}/timesheet_worker_aliases/${nameAliasDocId(c, firstName, lastName)}`)
          .get();
        uid = snap.exists ? String((snap.data() as any).userId || '') || null : null;
      } catch {
        uid = null;
      }
      nameAliasCache.set(nk, uid);
      return uid;
    };

    // Does this worker have a (non-cancelled) assignment under a job order for
    // the customer's standing account (e.g. VenueSmart)? Used to break a
    // same-name tie toward the person actually staffed on that client's work.
    const normAcct = (s: unknown): string =>
      String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const accountNorm = normAcct(customerAccount);
    const assignedAccountCache = new Map<string, boolean>();
    const isAssignedToAccount = async (userId: string): Promise<boolean> => {
      if (!accountNorm) return false;
      if (assignedAccountCache.has(userId)) return assignedAccountCache.get(userId)!;
      let hit = false;
      try {
        const assignments = await loadWorkerAssignments(tenantId, userId);
        for (const a of assignments) {
          const aAcct = normAcct(pickStr(a.accountName, a.recruiterAccountName, a.companyName));
          if (aAcct && aAcct.includes(accountNorm)) {
            hit = true;
            break;
          }
          const joId = pickStr(a.jobOrderId);
          if (joId) {
            // eslint-disable-next-line no-await-in-loop
            const jo = await loadJobOrder(joId);
            const joAcct = normAcct(
              pickStr(jo?.recruiterAccountName, jo?.accountName, jo?.companyName),
            );
            if (joAcct && joAcct.includes(accountNorm)) {
              hit = true;
              break;
            }
          }
        }
      } catch {
        hit = false;
      }
      assignedAccountCache.set(userId, hit);
      return hit;
    };

    const nameMatchCache = new Map<string, Resolved>();
    const resolveByName = async (firstName: string, lastName: string): Promise<Resolved> => {
      const fn = firstName.trim();
      const ln = lastName.trim();
      const key = `${fn.toLowerCase()}|${ln.toLowerCase()}`;
      const cached = nameMatchCache.get(key);
      if (cached) return cached;

      let resolved: Resolved;
      // 1. A remembered name→worker alias for this customer wins.
      const aliasUid = await resolveNameAlias(fn, ln);
      if (aliasUid) {
        const data = await findUserById(aliasUid);
        if (data) {
          resolved = await buildUserResolved(aliasUid, data);
          nameMatchCache.set(key, resolved);
          return resolved;
        }
      }

      // 2. Conservative match: EXACT first+last among this tenant's workers.
      // One candidate → match. Multiple → disambiguate by active-Everee-account
      // and customer-account assignment (see below); auto-match only when a
      // signal uniquely identifies one, else surface candidates for a pick.
      const fnNorm = fn.toLowerCase();
      if (!ln || !fnNorm) {
        resolved = { kind: 'none' };
        nameMatchCache.set(key, resolved);
        return resolved;
      }
      const rows = await queryUsersByLastName(ln);
      // Anchor match: same first-token-of-first-name AND last-token-of-last-name
      // (accent/punctuation-insensitive). This catches middle names ("Alondra
      // Lucy Hernandez" ↔ "Alondra Hernandez"), multi-token last names
      // ("Aaron Barrios Hernandez"), and accents ("Alvarez" ↔ "Alvares")
      // without auto-matching unrelated people.
      const csvTokens = nameKey(`${fn} ${ln}`).split(' ').filter(Boolean);
      const csvFirst = csvTokens[0] || '';
      const csvSet = new Set(csvTokens);
      const candidates = rows.filter((x) => {
        const tenantMember = !!(
          x.data.tenantIds &&
          typeof x.data.tenantIds === 'object' &&
          x.data.tenantIds[tenantId]
        );
        if (!tenantMember || !csvFirst) return false;
        const hTokens = nameKey(
          `${x.data.firstName || ''} ${x.data.lastName || ''}`.trim() || x.data.displayName || '',
        )
          .split(' ')
          .filter(Boolean);
        if (hTokens.length < 2 || hTokens[0] !== csvFirst) return false;
        // First name anchors; then one name's token set ⊆ the other's. Catches
        // middle names ("Alondra Lucy Hernandez" ⊇ "Alondra Hernandez") AND
        // partial last names ("Doris Santiago" ⊆ "Doris Santiago Guillén")
        // without matching a different surname. When the looser rule yields
        // several people, the Everee + VenueSmart-assignment tiebreak (below)
        // or a manual pick decides — never a wrong auto-pay.
        const hSet = new Set(hTokens);
        const csvSubset = csvTokens.every((t) => hSet.has(t));
        const hSubset = hTokens.every((t) => csvSet.has(t));
        return csvSubset || hSubset;
      });
      if (candidates.length === 0) {
        resolved = { kind: 'none' };
      } else if (candidates.length === 1) {
        // Only one worker by that name — match them. (If they're not Everee-
        // linked they'll surface as blocked with the actionable reason.)
        resolved = await buildUserResolved(candidates[0].id, candidates[0].data);
      } else {
        // Multiple same-name workers — disambiguate by signal: who has an
        // active Everee account, and who's assigned to the customer's account
        // (e.g. VenueSmart). Auto-match only when a signal UNIQUELY identifies
        // one; otherwise present the candidates (annotated) for a manual pick.
        const scored: Array<{
          id: string;
          data: Record<string, any>;
          linked: boolean;
          vsAssigned: boolean;
        }> = [];
        for (const c of candidates) {
          // eslint-disable-next-line no-await-in-loop
          const linked = evereeTenantId
            ? !!(await resolveExternalWorkerId(tenantId, c.id, evereeTenantId))
            : false;
          // eslint-disable-next-line no-await-in-loop
          const vsAssigned = await isAssignedToAccount(c.id);
          scored.push({ id: c.id, data: c.data, linked, vsAssigned });
        }
        const strong = scored.filter((c) => c.linked && c.vsAssigned);
        const linkedOnly = scored.filter((c) => c.linked);
        let pick: (typeof scored)[number] | null = null;
        if (strong.length === 1) {
          pick = strong[0]; // active Everee account + assigned to this account
        } else if (linkedOnly.length === 1) {
          pick = linkedOnly[0]; // the only one with an active Everee account
        }
        if (pick) {
          resolved = await buildUserResolved(pick.id, pick.data);
        } else {
          // Surface candidates, strongest signal first, annotated so the
          // recruiter can pick the right one in the Resolve dialog.
          const order = (c: (typeof scored)[number]) =>
            (c.linked ? 2 : 0) + (c.vsAssigned ? 1 : 0);
          const sorted = [...scored].sort((a, b) => order(b) - order(a));
          const suggestions: WorkerSuggestion[] = [];
          for (const c of sorted) {
            const reason = [
              c.linked ? 'Everee active' : 'no Everee account',
              accountNorm ? (c.vsAssigned ? `assigned to ${customerAccount}` : `no ${customerAccount} job`) : '',
            ]
              .filter(Boolean)
              .join(' · ');
            // eslint-disable-next-line no-await-in-loop
            suggestions.push(await buildSuggestion(c.id, c.data, reason));
          }
          resolved = { kind: 'ambiguous', suggestions };
        }
      }
      nameMatchCache.set(key, resolved);
      return resolved;
    };

    // Actionable "not linked to the paying entity" reason. A matched worker
    // who isn't linked here may already be set up (or onboarding) on a
    // DIFFERENT entity, and/or be blocked from provisioning by an incomplete
    // home address. Surfacing both turns a dead-end "needs onboarding" into a
    // next step. Computed once per worker (cached) — only for blocked rows.
    const payingEntityLabel = String(hiringEntityName || '').trim() || 'this entity';
    const entityStateCache = new Map<string, 'complete' | 'provisioned' | 'none'>();
    const entityEvereeState = async (
      entityId: string,
      userId: string,
    ): Promise<'complete' | 'provisioned' | 'none'> => {
      const ck = `${entityId}__${userId}`;
      const hit = entityStateCache.get(ck);
      if (hit) return hit;
      let state: 'complete' | 'provisioned' | 'none' = 'none';
      try {
        const snap = await db.doc(evereePaths.worker(tenantId, entityId, userId)).get();
        if (snap.exists) {
          const d = (snap.data() || {}) as Record<string, any>;
          const mirror = (d.readinessMirror || {}) as Record<string, unknown>;
          state =
            mirror.onboardingComplete === true ||
            String(d.status || '').trim().toLowerCase() === 'onboarding_complete' ||
            d.apiObservedOnboardingCompleteAt != null
              ? 'complete'
              : 'provisioned';
        }
      } catch {
        state = 'none';
      }
      entityStateCache.set(ck, state);
      return state;
    };
    const notLinkedReasonCache = new Map<string, string>();
    const buildNotLinkedReason = async (userId: string, displayName: string): Promise<string> => {
      if (notLinkedReasonCache.has(userId)) return notLinkedReasonCache.get(userId)!;
      const who = displayName || 'This worker';
      let reason = `${who} isn't linked to Everee for ${payingEntityLabel} — needs onboarding.`;
      try {
        const empSnap = await db
          .collection(`tenants/${tenantId}/entity_employments`)
          .where('userId', '==', userId)
          .limit(10)
          .get();
        let completeElsewhere: string | null = null;
        let onboardingElsewhere: string | null = null;
        for (const d of empSnap.docs) {
          const e = d.data() as Record<string, any>;
          const eId = String(e.entityId || '').trim();
          if (!eId || eId === String(hiringEntityId || '').trim()) continue;
          const label =
            String(e.entityName || '').trim() ||
            String(e.entityKey || '').trim() ||
            'another entity';
          // eslint-disable-next-line no-await-in-loop
          const state = await entityEvereeState(eId, userId);
          if (state === 'complete' && !completeElsewhere) completeElsewhere = label;
          else if (state === 'provisioned' && !onboardingElsewhere) onboardingElsewhere = label;
        }
        if (completeElsewhere) {
          reason = `${who} is set up on ${completeElsewhere}, not ${payingEntityLabel} — likely the wrong paying entity (or needs ${payingEntityLabel} onboarding).`;
        } else if (onboardingElsewhere) {
          reason = `${who} isn't linked to ${payingEntityLabel}. Onboarding on ${onboardingElsewhere} (not finished).`;
        }
        const userSnap = await db.doc(`users/${userId}`).get();
        const addr = userSnap.exists ? extractEvereeHomeAddressFromUserDoc(userSnap.data()) : null;
        if (!addr) {
          reason += " Profile home address is incomplete — can't provision to Everee until it's set.";
        }
      } catch {
        /* keep the base reason */
      }
      notLinkedReasonCache.set(userId, reason);
      return reason;
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
      billRate: null,
      payRateSource: 'none' as const,
      workersCompSource: 'none' as const,
      worksiteSource: 'none' as const,
      needsPayRate: true,
    };

    const processRow = async (row: MatchRowInput): Promise<MatchRowResult> => {
      const email = String(row.email || '').trim();
      const firstName = String(row.firstName || '').trim();
      const lastName = String(row.lastName || '').trim();
      const fullName = [firstName, lastName].filter(Boolean).join(' ');
      const workDate = dateOnly(row.workDate);
      const base: MatchRowResult = {
        rowIndex: row.rowIndex,
        email,
        matched: false,
        ambiguous: false,
        userId: null,
        displayName: null,
        matchedEmail: null,
        matchedPhone: null,
        evereeWorkerId: null,
        evereeLinked: false,
        matchedByName: false,
        matchedManual: false,
        block: true,
        blockReason: null,
        ...EMPTY_FIELDS,
      };

      // A recruiter-forced worker (lookup pencil) wins over email/name
      // matching; everything downstream (Everee link, pay, WC) still runs.
      // Email is otherwise the primary key (Indeed Flex); no-email customers
      // (Connect Team) fall back to conservative name matching.
      const forcedUserId = String(row.forcedUserId || '').trim();
      let r: Resolved;
      let viaName = false;
      let viaManual = false;
      if (forcedUserId) {
        viaManual = true;
        const snap = await db.collection('users').doc(forcedUserId).get();
        if (!snap.exists) {
          return { ...base, blockReason: 'Selected HRX worker no longer exists.' };
        }
        r = await buildUserResolved(forcedUserId, (snap.data() || {}) as Record<string, any>);
      } else if (email) {
        r = await resolveEmail(email);
      } else if (firstName || lastName) {
        viaName = true;
        r = await resolveByName(firstName, lastName);
      } else {
        return { ...base, blockReason: 'No email or name on this row to match.' };
      }

      if (r.kind === 'none') {
        // Email path: offer name suggestions. Name path: candidates already
        // exhausted, so no suggestions — it's a genuine no-match.
        const suggestions = viaName ? [] : await nameSuggestions(firstName, lastName);
        return {
          ...base,
          blockReason: viaName
            ? `No HRX worker named ${fullName || '(unknown)'} in this tenant.`
            : `No HRX worker found for ${email}.`,
          ...(suggestions.length ? { suggestions } : {}),
        };
      }
      if (r.kind === 'ambiguous') {
        return {
          ...base,
          ambiguous: true,
          blockReason: viaName
            ? `Multiple HRX workers named ${fullName} — pick the right one.`
            : 'Multiple HRX users share this email — resolve manually.',
          ...(r.suggestions.length ? { suggestions: r.suggestions } : {}),
        };
      }

      // Matched to a user — resolve hard-block first.
      const matchedBase: MatchRowResult = {
        ...base,
        matched: true,
        matchedByName: viaName,
        matchedManual: viaManual,
        userId: r.userId,
        displayName: r.displayName,
        matchedEmail: r.email,
        matchedPhone: r.phone,
        evereeWorkerId: r.evereeWorkerId,
        evereeLinked: r.evereeLinked,
      };
      if (!entityEvereeEnabled) {
        return {
          ...matchedBase,
          blockReason: 'Selected hiring entity is not configured for Everee payroll.',
        };
      }
      if (!r.evereeLinked) {
        return {
          ...matchedBase,
          blockReason: await buildNotLinkedReason(r.userId, r.displayName),
        };
      }

      // Payable. Best-effort assignment pairing + field resolution.
      const assignment = pairAssignment(r.assignments, workDate);
      if (!assignment) {
        // No HRX assignment — resolve pay context from a saved Site→JO mapping
        // first, then (Connect Team / VenueSmart) an auto partial-name match of
        // the row's "Type" against the customer account's job orders.
        const mapped =
          (await resolveSiteMapping(String(row.site || ''), String(row.role || ''))) ||
          (await resolveViaVenueAlias(String(row.site || ''), String(row.role || ''))) ||
          (await resolveByJobOrderName(String(row.site || ''), String(row.role || '')));
        return mapped
          ? {
              ...matchedBase,
              block: false,
              blockReason: null,
              ...mapped,
              payRateSource: 'site_mapping',
              needsPayRate: !(Number(mapped.payRate) > 0),
            }
          : { ...matchedBase, block: false, blockReason: null }; // needsPayRate stays true
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
      const billRate =
        Number(assignment.billRate) > 0
          ? Number(assignment.billRate)
          : Number(shift?.billRate) > 0
            ? Number(shift?.billRate)
            : Number(jo?.billRate) > 0
              ? Number(jo?.billRate)
              : 0;
      // Resolve from assignment/shift/JO, then backfill any gaps (WC code/rate,
      // worksite address) from the child account.
      const accountId = pickStr(jo?.recruiterAccountId, jo?.accountId, assignment.accountId);
      const { fields: f, filledWorksite, filledWc } = await backfillFromAccount(accountId, {
        payRate,
        billRate,
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
      return {
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
        billRate: billRate || null,
        payRateSource: payRate > 0 ? 'assignment' : 'none',
        workersCompSource: f.workersCompCode ? (filledWc ? 'account' : 'assignment') : 'none',
        worksiteSource: f.worksiteAddress ? (filledWorksite ? 'account' : 'assignment') : 'none',
        needsPayRate: !(payRate > 0),
      };
    };

    // Process rows with bounded concurrency so a 1000+ row batch fits the
    // function deadline (sequential per-row Firestore reads were hitting
    // deadline-exceeded). Caches warm across chunks, so repeated workers /
    // sites don't re-query.
    const results: MatchRowResult[] = new Array(rows.length);
    const CONCURRENCY = 25;
    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const chunk = rows.slice(i, i + CONCURRENCY);
      // eslint-disable-next-line no-await-in-loop
      const settled = await Promise.all(chunk.map((row) => processRow(row)));
      settled.forEach((res, j) => {
        results[i + j] = res;
      });
    }

    return { evereeTenantId, entityEvereeEnabled, results };
  },
);

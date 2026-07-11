/**
 * Full Firestore scan for recruiter "All users" search — matches `RecruiterUsers` client filter semantics
 * without loading only the first 500 rows by `createdAt`.
 */
import * as admin from 'firebase-admin';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { FieldPath } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import {
  entityEmploymentDocHasQualifyingStatus,
  entityEmploymentDocMatchesStatus,
  normalizeRecruiterEmploymentStatus,
  normalizeRecruiterEntityKey,
} from './entityEmploymentRecruiterFilter';
import {
  firestoreUserDocMatchesRecruiterGroup,
  firestoreUserDocMatchesRecruiterSearch,
  firestoreUserDocMatchesRecruiterState,
} from './recruiterUsersSearchMatch';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Include a user in tenant-search results when they belong to THIS tenant (at
 * any security level) OR aren't attached to any tenant at all (orphan / mis-
 * provisioned records — e.g. an imported worker whose `tenantIds` was never
 * set, like the "William Amaro Rodriguez" case). EXCLUDES users who belong only
 * to a DIFFERENT tenant, so scanning the whole `users` collection can never leak
 * another tenant's people. (This instance is effectively single-tenant, but the
 * guard keeps it correct if that ever changes.)
 *
 * Replaces the old `tenantIds.{t}.securityLevel in [0..4]` scan filter, which
 * silently dropped orphans (no nested securityLevel) — the bug that made the
 * All-Users search miss people the global timesheet lookup could find.
 */
function userInTenantOrOrphan(data: Record<string, unknown>, tenantId: string): boolean {
  const t = data.tenantIds;
  if (!t || typeof t !== 'object') return true;
  const keys = Object.keys(t as Record<string, unknown>);
  if (keys.length === 0) return true;
  return Object.prototype.hasOwnProperty.call(t, tenantId);
}

const BATCH_SIZE = 500;
const MAX_MATCH_IDS = 2500;
/** Safety cap: 400 batches = 200k user docs scanned per request. */
const MAX_BATCHES = 400;

async function assertCallerCanSearchTenant(callerUid: string, tenantId: string): Promise<void> {
  const snap = await db.collection('users').doc(callerUid).get();
  if (!snap.exists) {
    throw new HttpsError('permission-denied', 'User not found');
  }
  const data = snap.data() as Record<string, unknown>;
  if (data.isHRX === true || data.hrx === true) {
    return;
  }
  const tenantMeta = (data.tenantIds as Record<string, unknown> | undefined)?.[tenantId] as
    | Record<string, unknown>
    | undefined;
  if (!tenantMeta) {
    throw new HttpsError('permission-denied', 'No access to this tenant');
  }
  const role = String(tenantMeta.role || '').trim().toLowerCase();
  if (['recruiter', 'manager', 'admin'].includes(role)) {
    return;
  }
  const secRaw = tenantMeta.securityLevel ?? data.securityLevel ?? '0';
  const sec = parseInt(String(secRaw), 10);
  if (!Number.isNaN(sec) && sec >= 4) {
    return;
  }
  throw new HttpsError('permission-denied', 'Not authorized to search tenant users');
}

export type SearchRecruiterTableUsersRequest = {
  tenantId: string;
  /** Empty string = no text filter (use with groupId and/or stateCode). */
  searchQuery: string;
  /** Tenant user group document id; omit or "all" for no filter. */
  groupId?: string;
  /** USPS state code or name; omit or "all" for no filter. */
  stateCode?: string;
  /** C1 entity key: select | workforce | events */
  entityKey?: string;
  /** Employment lifecycle filter: active | onboarding | terminated. Matches
   *  `entity_employments` rows (scoped to `entityKey` when both are set). */
  employmentStatus?: string;
};

export type SearchRecruiterTableUsersResponse = {
  userIds: string[];
  scannedDocuments: number;
  batches: number;
  capped: boolean;
};

/**
 * Scans `entity_employments` for the tenant; returns user ids with at least one
 * qualifying employment row, deduped. `entityKey` scopes the scan to one entity
 * (null = all entities); `employmentStatus` requires the row's lifecycle to
 * match (null = any meaningful status per `entityEmploymentDocHasQualifyingStatus`).
 */
async function loadEntityUserIdSet(
  tenantId: string,
  entityKey: string | null,
  employmentStatus: string | null,
): Promise<{ entityUserIds: Set<string>; scannedDocuments: number; batches: number }> {
  const entityUserIds = new Set<string>();
  let lastDoc: QueryDocumentSnapshot | null = null;
  let batches = 0;
  let scanned = 0;
  const coll = db.collection(`tenants/${tenantId}/entity_employments`);

  while (batches < MAX_BATCHES) {
    const base = entityKey ? coll.where('entityKey', '==', entityKey) : coll;
    const q = base.orderBy(FieldPath.documentId()).limit(BATCH_SIZE);
    const snap = await (lastDoc ? q.startAfter(lastDoc) : q).get();
    if (snap.empty) {
      break;
    }
    batches += 1;
    scanned += snap.docs.length;

    for (const doc of snap.docs) {
      const d = doc.data() as Record<string, unknown>;
      if (employmentStatus) {
        if (!entityEmploymentDocMatchesStatus(d, employmentStatus)) continue;
      } else if (!entityEmploymentDocHasQualifyingStatus(d)) {
        continue;
      }
      const uid = String(d.userId || '').trim();
      if (uid) entityUserIds.add(uid);
    }

    lastDoc = snap.docs[snap.docs.length - 1] ?? null;

    if (snap.docs.length < BATCH_SIZE) {
      break;
    }
  }

  return { entityUserIds, scannedDocuments: scanned, batches };
}

/** Assignment statuses that mean the worker is NOT on that assignment anymore. */
const ASSIGNMENT_TERMINAL_STATUSES = new Set([
  'canceled',
  'cancelled',
  'completed',
  'ended',
  'declined',
  'rejected',
  'withdrawn',
]);

/** YYYY-MM-DD "today" in the tenant's operating timezone (Pacific). */
function todayDateOnlyPacific(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
}

/** Best-effort YYYY-MM-DD from the mixed date shapes on assignment docs. */
function toDateOnlyLoose(v: unknown): string {
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : '';
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(v);
  }
  if (v && typeof v === 'object') {
    const ts = v as { toDate?: () => Date; _seconds?: number; seconds?: number };
    const secs = ts._seconds ?? ts.seconds;
    const d =
      typeof ts.toDate === 'function' ? ts.toDate() : typeof secs === 'number' ? new Date(secs * 1000) : null;
    if (d && !Number.isNaN(d.getTime())) {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(d);
    }
  }
  return '';
}

/**
 * "On Assignment" (Greg 2026-07-11): user ids with at least one live
 * assignment whose date range overlaps TODAY, scoped to the entity (via
 * assignment `hiringEntityId`/`entityId`, falling back to the job order's —
 * assignments often don't carry the field directly, mirroring the
 * separateWorker cascade). Deliberately NOT intersected with an
 * `entity_employments` lifecycle scan: workers on assignment with a missing
 * or wrong employment row should SURFACE here — this filter's first job is
 * exposing data to clean up. Coverage notes: day-scoped gig assignments
 * match by `startDate == today`; ranged (career / multi-day) by
 * `endDate >= today` + `startDate <= today`; ongoing open shifts by
 * `endDate == ''`. Rows whose dates aren't stored as YYYY-MM-DD strings are
 * missed by the range queries — accepted imprecision.
 */
async function loadOnAssignmentUserIdSet(
  tenantId: string,
  entityKey: string | null,
): Promise<{ entityUserIds: Set<string>; scannedDocuments: number; batches: number }> {
  const userIds = new Set<string>();
  let scanned = 0;
  let batches = 0;
  const today = todayDateOnlyPacific();

  // Resolve the entity id for the requested key from any employment row.
  let targetEntityId = '';
  if (entityKey) {
    const snap = await db
      .collection(`tenants/${tenantId}/entity_employments`)
      .where('entityKey', '==', entityKey)
      .limit(1)
      .get();
    const d = snap.docs[0]?.data() as Record<string, unknown> | undefined;
    targetEntityId = String(d?.entityId || d?.hiringEntityId || '');
    if (!targetEntityId) {
      return { entityUserIds: userIds, scannedDocuments: 0, batches: 0 };
    }
  }

  const coll = db.collection(`tenants/${tenantId}/assignments`);
  const seenDocIds = new Set<string>();
  const joEntityCache = new Map<string, string>();

  const matchesEntity = async (a: Record<string, unknown>): Promise<boolean> => {
    if (!targetEntityId) return true;
    const direct = [String(a.hiringEntityId || ''), String(a.entityId || '')];
    if (direct.includes(targetEntityId)) return true;
    const joId = String(a.jobOrderId || '');
    if (!joId) return false;
    if (!joEntityCache.has(joId)) {
      try {
        const jo = await db.doc(`tenants/${tenantId}/job_orders/${joId}`).get();
        const j = (jo.data() || {}) as Record<string, unknown>;
        joEntityCache.set(joId, `${String(j.hiringEntityId || '')} ${String(j.entityId || '')}`);
      } catch {
        joEntityCache.set(joId, '');
      }
    }
    return (joEntityCache.get(joId) || '').split(' ').includes(targetEntityId);
  };

  const consider = async (docId: string, a: Record<string, unknown>): Promise<void> => {
    if (seenDocIds.has(docId)) return;
    seenDocIds.add(docId);
    const status = String(a.status || '').trim().toLowerCase();
    if (ASSIGNMENT_TERMINAL_STATUSES.has(status)) return;
    const start = toDateOnlyLoose(a.startDate);
    if (!start || start > today) return;
    const end = toDateOnlyLoose(a.endDate);
    if (end && end < today) return;
    const uid = String(a.userId || '').trim();
    if (!uid || userIds.has(uid)) return;
    if (await matchesEntity(a)) userIds.add(uid);
  };

  // `orderField` must be the inequality field when one is used (Firestore
  // requires the first orderBy to match it); doc-id tiebreak keeps the
  // startAfter cursor stable either way.
  const runQuery = async (
    build: (c: FirebaseFirestore.Query) => FirebaseFirestore.Query,
    orderField?: string,
  ): Promise<void> => {
    let lastDoc: QueryDocumentSnapshot | null = null;
    while (batches < MAX_BATCHES) {
      const ordered = orderField
        ? build(coll).orderBy(orderField).orderBy(FieldPath.documentId())
        : build(coll).orderBy(FieldPath.documentId());
      const base = ordered.limit(BATCH_SIZE);
      const snap = await (lastDoc ? base.startAfter(lastDoc) : base).get();
      if (snap.empty) break;
      batches += 1;
      scanned += snap.docs.length;
      for (const doc of snap.docs) {
        await consider(doc.id, doc.data() as Record<string, unknown>);
      }
      lastDoc = snap.docs[snap.docs.length - 1] ?? null;
      if (snap.docs.length < BATCH_SIZE) break;
    }
  };

  await runQuery((c) => c.where('startDate', '==', today)); // day-scoped gigs today
  await runQuery((c) => c.where('endDate', '>=', today), 'endDate'); // ranged assignments still running
  await runQuery((c) => c.where('endDate', '==', '')); // ongoing / rolling (open shifts)

  return { entityUserIds: userIds, scannedDocuments: scanned, batches };
}

export const searchRecruiterTableUsers = onCall(
  {
    enforceAppCheck: false,
    /**
     * Reflect request origin (auth still required). Using `true` avoids Gen2 CORS regressions where a
     * curated list/RegExp misses the browser origin and the preflight returns no
     * `Access-Control-Allow-Origin` (client shows a misleading CORS error instead of the real failure).
     */
    cors: true,
    memory: '1GiB',
    timeoutSeconds: 300,
  },
  async (request): Promise<SearchRecruiterTableUsersResponse> => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const raw = (request.data || {}) as SearchRecruiterTableUsersRequest;
    const tenantId = typeof raw.tenantId === 'string' ? raw.tenantId.trim() : '';
    const searchQuery = typeof raw.searchQuery === 'string' ? raw.searchQuery.trim() : '';
    const groupIdRaw = typeof raw.groupId === 'string' ? raw.groupId.trim() : '';
    const stateCodeRaw = typeof raw.stateCode === 'string' ? raw.stateCode.trim() : '';
    const entityKeyNorm = normalizeRecruiterEntityKey(typeof raw.entityKey === 'string' ? raw.entityKey : '');
    const employmentStatusNorm = normalizeRecruiterEmploymentStatus(
      typeof raw.employmentStatus === 'string' ? raw.employmentStatus : '',
    );

    const hasGroup = groupIdRaw.length > 0 && groupIdRaw !== 'all';
    const hasState = stateCodeRaw.length > 0 && stateCodeRaw !== 'all';
    const hasSearch = searchQuery.length > 0;
    const hasEntity = entityKeyNorm != null;
    const hasStatus = employmentStatusNorm != null;

    if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required');
    }
    if (!hasSearch && !hasGroup && !hasState && !hasEntity && !hasStatus) {
      throw new HttpsError(
        'invalid-argument',
        'Provide searchQuery and/or groupId and/or stateCode and/or entityKey and/or employmentStatus (at least one filter)',
      );
    }
    if (searchQuery.length > 200) {
      throw new HttpsError('invalid-argument', 'searchQuery is too long');
    }

    try {
      await assertCallerCanSearchTenant(request.auth.uid, tenantId);

      let entityUserIds: Set<string> | null = null;
      let entityScanned = 0;
      let entityBatches = 0;

      if (hasEntity || hasStatus) {
        // 'on_assignment' derives the user set from live assignments
        // overlapping today (NOT from entity_employments — see
        // loadOnAssignmentUserIdSet for why there's no intersection).
        const loaded =
          employmentStatusNorm === 'on_assignment'
            ? await loadOnAssignmentUserIdSet(tenantId, entityKeyNorm)
            : await loadEntityUserIdSet(tenantId, entityKeyNorm, employmentStatusNorm);
        entityUserIds = loaded.entityUserIds;
        entityScanned = loaded.scannedDocuments;
        entityBatches = loaded.batches;
        if (entityUserIds.size === 0) {
          logger.info('searchRecruiterTableUsers.done', {
            tenantId,
            callerUid: request.auth.uid,
            hasSearch,
            hasGroup,
            hasState,
            hasEntity,
            hasStatus,
            entityKey: entityKeyNorm,
            employmentStatus: employmentStatusNorm,
            matchCount: 0,
            scannedDocuments: entityScanned,
            batches: entityBatches,
            capped: false,
            entityEmploymentScan: true,
          });
          return {
            userIds: [],
            scannedDocuments: entityScanned,
            batches: entityBatches,
            capped: false,
          };
        }
      }

      const userIds: string[] = [];
      let lastDoc: QueryDocumentSnapshot | null = null;
      let batches = 0;
      let scanned = 0;
      let capped = false;

      while (batches < MAX_BATCHES && userIds.length < MAX_MATCH_IDS) {
        // Scan the WHOLE users collection (ordered by doc id so every doc is
        // visited — orphans have no nested securityLevel and some lack
        // createdAt, both of which the old filtered+createdAt-ordered query
        // dropped). The per-doc `userInTenantOrOrphan` guard keeps it scoped to
        // this tenant + unattached users; the matcher does the name/email/phone
        // filtering. ~8.5k docs ≪ the 200k batch cap, so coverage is complete.
        const base = db
          .collection('users')
          .orderBy(FieldPath.documentId())
          .limit(BATCH_SIZE);
        const snap = await (lastDoc ? base.startAfter(lastDoc) : base).get();
        if (snap.empty) {
          break;
        }

        batches += 1;
        scanned += snap.docs.length;

        for (const doc of snap.docs) {
          const data = doc.data() as Record<string, unknown>;
          if (!userInTenantOrOrphan(data, tenantId)) continue;
          if (entityUserIds && !entityUserIds.has(doc.id)) continue;
          if (!firestoreUserDocMatchesRecruiterSearch(data, tenantId, searchQuery)) continue;
          if (hasGroup && !firestoreUserDocMatchesRecruiterGroup(data, tenantId, groupIdRaw)) continue;
          if (hasState && !firestoreUserDocMatchesRecruiterState(data, stateCodeRaw)) continue;
          userIds.push(doc.id);
          if (userIds.length >= MAX_MATCH_IDS) {
            capped = true;
            break;
          }
        }

        lastDoc = snap.docs[snap.docs.length - 1] ?? null;

        if (snap.docs.length < BATCH_SIZE) {
          break;
        }
        if (capped) {
          break;
        }
      }

      logger.info('searchRecruiterTableUsers.done', {
        tenantId,
        callerUid: request.auth.uid,
        hasSearch,
        hasGroup,
        hasState,
        hasEntity,
        hasStatus,
        entityKey: entityKeyNorm,
        employmentStatus: employmentStatusNorm,
        matchCount: userIds.length,
        scannedDocuments: scanned + entityScanned,
        batches: batches + entityBatches,
        capped,
        entityEmploymentScan: hasEntity || hasStatus,
      });

      return {
        userIds,
        scannedDocuments: scanned + entityScanned,
        batches: batches + entityBatches,
        capped,
      };
    } catch (e: unknown) {
      if (e instanceof HttpsError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      const rawCode =
        e && typeof e === 'object' && 'code' in e ? String((e as { code?: unknown }).code ?? '') : '';
      const isFailedPrecondition =
        rawCode === '9' ||
        rawCode === 'failed-precondition' ||
        /requires an index|The query requires an index|failed[- ]precondition/i.test(msg);
      logger.error('searchRecruiterTableUsers.failed', {
        tenantId,
        callerUid: request.auth.uid,
        message: msg,
        code: rawCode,
      });
      if (isFailedPrecondition) {
        throw new HttpsError(
          'failed-precondition',
          `Firestore needs a composite index for this search (or the query could not run). ${msg}`,
        );
      }
      throw new HttpsError('internal', `User search failed: ${msg}`);
    }
  },
);

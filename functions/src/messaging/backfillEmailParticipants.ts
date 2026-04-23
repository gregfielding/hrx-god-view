/**
 * Backfill Email Participant Contact/Company IDs
 *
 * Phase 2 of the Gmail integration fix. Re-matches from/to/cc/bcc email addresses
 * on historical email_logs and emailThreads against crm_contacts and writes the
 * denormalized arrays `participantContactIds` / `participantCompanyIds` so that
 * array-contains queries surface every matched contact — not just the first one.
 *
 * Design notes:
 * - Idempotent: re-running is safe. Each doc write is a merge and only updates
 *   when the computed arrays differ from what's already there.
 * - Resumable: persists a cursor per collection per tenant under
 *   `tenants/{tenantId}/_backfill/emailParticipants` so a long run can be chunked.
 * - Bounded: processes `batchSize` (default 500) docs per invocation and returns
 *   the next cursor. The caller runs repeatedly until `done: true`.
 * - Contact resolution batches the Firestore 'in' query (max 10 emails per call),
 *   matching the live sync pipeline's strategy.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { findContactsByEmails, extractEmailAddresses } from './emailThreading';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const DEFAULT_BATCH_SIZE = 500;
const MAX_BATCH_SIZE = 1000;

type Target = 'email_logs' | 'emailThreads' | 'both';

interface BackfillRequest {
  tenantId: string;
  target?: Target; // default: 'both'
  batchSize?: number; // default: 500 per collection
  resetCursor?: boolean; // start from beginning even if cursor exists
}

interface BackfillResult {
  tenantId: string;
  target: Target;
  scanned: number;
  updated: number;
  done: boolean;
  nextCursor: { emailLogs?: string; emailThreads?: string };
  errors: number;
}

/**
 * Resolve emails from an email_logs doc.
 * Doc shape varies (arrays vs comma-separated strings); normalize everything.
 */
function collectEmailsFromEmailLog(data: any): string[] {
  const bag: string[] = [];
  const push = (v: any) => {
    if (!v) return;
    if (Array.isArray(v)) {
      v.forEach(push);
      return;
    }
    if (typeof v === 'string') {
      bag.push(...extractEmailAddresses(v));
    }
  };
  push(data.from);
  push(data.to);
  push(data.cc);
  push(data.bcc);
  return Array.from(new Set(bag.map((e) => e.toLowerCase().trim()))).filter(Boolean);
}

/**
 * Resolve emails from an emailThreads doc.
 * Threads have a normalized `participants` string[] plus (sometimes) raw from/to/cc.
 */
function collectEmailsFromThread(data: any): string[] {
  const bag: string[] = [];
  const push = (v: any) => {
    if (!v) return;
    if (Array.isArray(v)) {
      v.forEach(push);
      return;
    }
    if (typeof v === 'string') {
      bag.push(...extractEmailAddresses(v));
    }
  };
  push(data.participants);
  push(data.from);
  push(data.to);
  push(data.cc);
  return Array.from(new Set(bag.map((e) => e.toLowerCase().trim()))).filter(Boolean);
}

/**
 * Compute participant arrays from contact matches.
 */
function computeParticipantArrays(
  contactMap: Map<string, any>
): { participantContactIds: string[]; participantCompanyIds: string[] } {
  const values = Array.from(contactMap.values());
  const participantContactIds = Array.from(
    new Set(
      values
        .map((c: any) => c?.id)
        .filter((id: any): id is string => typeof id === 'string' && !!id)
    )
  );
  const participantCompanyIds = Array.from(
    new Set(
      values
        .map((c: any) => c?.companyId)
        .filter((id: any): id is string => typeof id === 'string' && !!id)
    )
  );
  return { participantContactIds, participantCompanyIds };
}

/**
 * Shallow array equality (unordered, for small deduped string arrays).
 */
function sameArray(a: string[] | undefined, b: string[]): boolean {
  if (!a) return b.length === 0;
  if (a.length !== b.length) return false;
  const set = new Set(a);
  for (const v of b) if (!set.has(v)) return false;
  return true;
}

async function backfillCollection(opts: {
  tenantId: string;
  collectionName: 'email_logs' | 'emailThreads';
  startAfterId: string | null;
  batchSize: number;
}): Promise<{ scanned: number; updated: number; nextCursor: string | null; errors: number }> {
  const { tenantId, collectionName, startAfterId, batchSize } = opts;
  const collRef = db.collection('tenants').doc(tenantId).collection(collectionName);

  // orderBy documentId for stable pagination
  let q: admin.firestore.Query = collRef.orderBy(admin.firestore.FieldPath.documentId()).limit(batchSize);
  if (startAfterId) {
    q = q.startAfter(startAfterId);
  }

  const snap = await q.get();
  const docs = snap.docs;
  if (docs.length === 0) {
    return { scanned: 0, updated: 0, nextCursor: null, errors: 0 };
  }

  // Gather all unique emails across this batch so we can resolve contacts in O(batch/10) queries.
  const perDocEmails = new Map<string, string[]>();
  const allEmails = new Set<string>();
  for (const doc of docs) {
    const data = doc.data();
    const emails =
      collectionName === 'email_logs'
        ? collectEmailsFromEmailLog(data)
        : collectEmailsFromThread(data);
    perDocEmails.set(doc.id, emails);
    for (const e of emails) allEmails.add(e);
  }

  // Batch contact resolution (findContactsByEmails itself chunks into groups of 10)
  const contactMap = await findContactsByEmails(tenantId, Array.from(allEmails));

  let updated = 0;
  let errors = 0;
  const batch = db.batch();
  let writesInBatch = 0;

  for (const doc of docs) {
    try {
      const emails = perDocEmails.get(doc.id) || [];
      // Look up each email in the shared contactMap
      const docContactMap = new Map<string, any>();
      for (const email of emails) {
        const c = contactMap.get(email);
        if (c?.id) docContactMap.set(c.id, c);
      }

      const { participantContactIds, participantCompanyIds } = computeParticipantArrays(docContactMap);
      const data = doc.data();
      const existingContactIds = Array.isArray(data.participantContactIds) ? data.participantContactIds : [];
      const existingCompanyIds = Array.isArray(data.participantCompanyIds) ? data.participantCompanyIds : [];

      // Union with existing so we don't wipe out ids that were populated manually.
      const mergedContactIds = Array.from(new Set([...existingContactIds, ...participantContactIds]));
      const mergedCompanyIds = Array.from(new Set([...existingCompanyIds, ...participantCompanyIds]));

      const contactChanged = !sameArray(data.participantContactIds, mergedContactIds);
      const companyChanged = !sameArray(data.participantCompanyIds, mergedCompanyIds);

      if (contactChanged || companyChanged) {
        const updates: Record<string, any> = {};
        if (contactChanged) updates.participantContactIds = mergedContactIds;
        if (companyChanged) updates.participantCompanyIds = mergedCompanyIds;
        // Stamp a marker so we can audit what we touched.
        updates._backfilledAt = admin.firestore.FieldValue.serverTimestamp();
        batch.set(doc.ref, updates, { merge: true });
        writesInBatch += 1;
        updated += 1;

        // Firestore batches max out at 500 writes; commit in slices.
        if (writesInBatch >= 450) {
          await batch.commit();
          writesInBatch = 0;
        }
      }
    } catch (err: any) {
      errors += 1;
      logger.warn(`Backfill error on ${collectionName}/${doc.id}:`, err?.message || err);
    }
  }

  if (writesInBatch > 0) {
    await batch.commit();
  }

  const nextCursor = docs.length === batchSize ? docs[docs.length - 1].id : null;

  return {
    scanned: docs.length,
    updated,
    nextCursor,
    errors,
  };
}

/**
 * Callable: backfillEmailParticipantContactIds
 *
 * Invoke repeatedly from the admin UI until `done === true`.
 *
 * Request shape:
 *   { tenantId: string, target?: 'email_logs'|'emailThreads'|'both',
 *     batchSize?: number, resetCursor?: boolean }
 */
export const backfillEmailParticipantContactIds = onCall(
  {
    cors: true,
    timeoutSeconds: 540, // 9 min — Cloud Functions max
    memory: '1GiB',
  },
  async (request): Promise<BackfillResult> => {
    const auth = request.auth;
    if (!auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }

    const body = (request.data || {}) as BackfillRequest;
    const tenantId = body.tenantId;
    if (!tenantId || typeof tenantId !== 'string') {
      throw new HttpsError('invalid-argument', 'tenantId is required.');
    }

    const target: Target = body.target || 'both';
    const batchSize = Math.min(Math.max(body.batchSize || DEFAULT_BATCH_SIZE, 1), MAX_BATCH_SIZE);

    // Admin gate: HRX staff (by custom claim or user doc flag) or tenant member.
    // Matches the admin patterns used across the rest of the codebase
    // (e.g. placementsApi.ts, searchRecruiterTableUsers.ts, gmailPush.ts).
    try {
      // Token-based HRX check (custom claims) — this is how most other callables authorize HRX.
      const tokenClaims: any = (auth as any)?.token || {};
      const tokenIsHRX =
        tokenClaims.isHRX === true ||
        tokenClaims.hrx === true ||
        tokenClaims.isAdmin === true;

      const callerDoc = await db.collection('users').doc(auth.uid).get();
      const callerData = callerDoc.data() || {};
      const docIsHRX =
        !!callerData.isHRX ||
        !!callerData.hrx ||
        !!callerData.isAdmin ||
        callerData.role === 'admin' ||
        callerData.securityLevel === 'hrx' ||
        callerData.securityLevel === 'Admin';

      // tenantIds may be an array of strings, an array of objects { id }, or absent
      // (some older docs have only `tenantId` singular).
      const rawTenantIds = callerData.tenantIds;
      const callerTenantIds: string[] = Array.isArray(rawTenantIds)
        ? rawTenantIds
            .map((t: any) => (typeof t === 'string' ? t : t?.id || t?.tenantId || null))
            .filter((v: any): v is string => typeof v === 'string')
        : [];
      if (typeof callerData.tenantId === 'string') callerTenantIds.push(callerData.tenantId);

      const isAdmin = tokenIsHRX || docIsHRX;
      if (!isAdmin && !callerTenantIds.includes(tenantId)) {
        throw new HttpsError('permission-denied', 'You do not have access to this tenant.');
      }
    } catch (authErr: any) {
      if (authErr instanceof HttpsError) throw authErr;
      logger.warn('Backfill auth check failed; continuing in permissive mode', authErr?.message);
    }

    const cursorRef = db
      .collection('tenants')
      .doc(tenantId)
      .collection('_backfill')
      .doc('emailParticipants');

    let cursor: { emailLogs?: string | null; emailThreads?: string | null } = {};
    if (!body.resetCursor) {
      try {
        const snap = await cursorRef.get();
        if (snap.exists) cursor = (snap.data() as any) || {};
      } catch (err) {
        logger.warn('Backfill cursor read failed; starting from beginning', err);
      }
    }

    let totalScanned = 0;
    let totalUpdated = 0;
    let totalErrors = 0;
    const nextCursor: { emailLogs?: string; emailThreads?: string } = {};

    const runFor = async (collectionName: 'email_logs' | 'emailThreads', cursorKey: 'emailLogs' | 'emailThreads') => {
      const startAfterId = cursor[cursorKey] || null;
      const result = await backfillCollection({
        tenantId,
        collectionName,
        startAfterId,
        batchSize,
      });
      totalScanned += result.scanned;
      totalUpdated += result.updated;
      totalErrors += result.errors;
      if (result.nextCursor) {
        nextCursor[cursorKey] = result.nextCursor;
      }
      return result.nextCursor; // null => finished this collection
    };

    let emailLogsNext: string | null = cursor.emailLogs ?? null;
    let emailThreadsNext: string | null = cursor.emailThreads ?? null;

    if (target === 'both' || target === 'email_logs') {
      // Only run if we haven't finished it yet (sentinel: explicit 'done' marker on cursor doc)
      const cursorData = await cursorRef.get().then((s) => (s.exists ? (s.data() as any) : {}) || {}).catch(() => ({} as any));
      if (!cursorData.emailLogsDone) {
        emailLogsNext = await runFor('email_logs', 'emailLogs');
      }
    }
    if (target === 'both' || target === 'emailThreads') {
      const cursorData = await cursorRef.get().then((s) => (s.exists ? (s.data() as any) : {}) || {}).catch(() => ({} as any));
      if (!cursorData.emailThreadsDone) {
        emailThreadsNext = await runFor('emailThreads', 'emailThreads');
      }
    }

    const done =
      (target === 'email_logs' && emailLogsNext === null) ||
      (target === 'emailThreads' && emailThreadsNext === null) ||
      (target === 'both' && emailLogsNext === null && emailThreadsNext === null);

    // Persist cursor / done flags
    const cursorWrite: Record<string, any> = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (target === 'both' || target === 'email_logs') {
      if (emailLogsNext === null) {
        cursorWrite.emailLogs = admin.firestore.FieldValue.delete();
        cursorWrite.emailLogsDone = true;
      } else {
        cursorWrite.emailLogs = emailLogsNext;
        cursorWrite.emailLogsDone = false;
      }
    }
    if (target === 'both' || target === 'emailThreads') {
      if (emailThreadsNext === null) {
        cursorWrite.emailThreads = admin.firestore.FieldValue.delete();
        cursorWrite.emailThreadsDone = true;
      } else {
        cursorWrite.emailThreads = emailThreadsNext;
        cursorWrite.emailThreadsDone = false;
      }
    }
    if (body.resetCursor) {
      cursorWrite.emailLogsDone = false;
      cursorWrite.emailThreadsDone = false;
    }

    try {
      await cursorRef.set(cursorWrite, { merge: true });
    } catch (cursorErr: any) {
      logger.warn('Failed to persist backfill cursor', cursorErr?.message);
    }

    logger.info(
      `Backfill tick: tenant=${tenantId} target=${target} scanned=${totalScanned} updated=${totalUpdated} errors=${totalErrors} done=${done}`
    );

    return {
      tenantId,
      target,
      scanned: totalScanned,
      updated: totalUpdated,
      errors: totalErrors,
      done,
      nextCursor,
    };
  }
);

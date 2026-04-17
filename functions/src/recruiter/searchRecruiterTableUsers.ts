/**
 * Full Firestore scan for recruiter "All users" search — matches `RecruiterUsers` client filter semantics
 * without loading only the first 500 rows by `createdAt`.
 */
import * as admin from 'firebase-admin';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { CALLABLE_BROWSER_CORS } from '../integrations/callableBrowserCors';
import { firestoreUserDocMatchesRecruiterSearch } from './recruiterUsersSearchMatch';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/** Align with `src/constants/tenantWorkerSecurityLevels.ts` — Firestore `in` is type-sensitive. */
const TENANT_LISTABLE_SECURITY_LEVELS: Array<string | number> = ['0', '1', '2', '3', '4', 0, 1, 2, 3, 4];

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
  searchQuery: string;
};

export type SearchRecruiterTableUsersResponse = {
  userIds: string[];
  scannedDocuments: number;
  batches: number;
  capped: boolean;
};

export const searchRecruiterTableUsers = onCall(
  {
    enforceAppCheck: false,
    cors: CALLABLE_BROWSER_CORS,
    memory: '512MiB',
    timeoutSeconds: 120,
  },
  async (request): Promise<SearchRecruiterTableUsersResponse> => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const raw = (request.data || {}) as SearchRecruiterTableUsersRequest;
    const tenantId = typeof raw.tenantId === 'string' ? raw.tenantId.trim() : '';
    const searchQuery = typeof raw.searchQuery === 'string' ? raw.searchQuery.trim() : '';
    if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required');
    }
    if (!searchQuery) {
      throw new HttpsError('invalid-argument', 'searchQuery is required');
    }
    if (searchQuery.length > 200) {
      throw new HttpsError('invalid-argument', 'searchQuery is too long');
    }

    await assertCallerCanSearchTenant(request.auth.uid, tenantId);

    const userIds: string[] = [];
    let lastDoc: QueryDocumentSnapshot | null = null;
    let batches = 0;
    let scanned = 0;
    let capped = false;

    while (batches < MAX_BATCHES && userIds.length < MAX_MATCH_IDS) {
      const base = db
        .collection('users')
        .where(`tenantIds.${tenantId}.securityLevel`, 'in', TENANT_LISTABLE_SECURITY_LEVELS)
        .orderBy('createdAt', 'desc')
        .limit(BATCH_SIZE);
      const snap = await (lastDoc ? base.startAfter(lastDoc) : base).get();
      if (snap.empty) {
        break;
      }

      batches += 1;
      scanned += snap.docs.length;

      for (const doc of snap.docs) {
        const data = doc.data() as Record<string, unknown>;
        if (firestoreUserDocMatchesRecruiterSearch(data, tenantId, searchQuery)) {
          userIds.push(doc.id);
          if (userIds.length >= MAX_MATCH_IDS) {
            capped = true;
            break;
          }
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
      matchCount: userIds.length,
      scannedDocuments: scanned,
      batches,
      capped,
    });

    return {
      userIds,
      scannedDocuments: scanned,
      batches,
      capped,
    };
  },
);

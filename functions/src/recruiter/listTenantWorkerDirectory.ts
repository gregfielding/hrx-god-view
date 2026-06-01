/**
 * listTenantWorkerDirectory — returns a compact, denormalized array of
 * every listable worker on a tenant. Powers the client-side IndexedDB
 * cache that backs:
 *   - `/users/all` recruiter search (text path)
 *   - the "Add worker to timesheet" autocomplete
 *
 * Why a single bulk fetch:
 *   - ~8.5k workers in C1's tenant × ~100 bytes per entry = ~1 MB payload.
 *     One round trip vs. one per keystroke is a huge win for recruiter
 *     felt-latency, and the payload fits comfortably under the Cloud
 *     Functions 10 MB response cap.
 *   - The same `tenantIds.{tid}.securityLevel in [...]` filter the
 *     existing per-query search uses, so the result set is identical to
 *     what `searchRecruiterTableUsers` would have returned for an empty
 *     query — just shaped for client-side filtering.
 *
 * Permission gate matches `searchRecruiterTableUsers` (HRX, or recruiter
 * / manager / admin role, or securityLevel >= 4 on the tenant).
 */

import * as admin from 'firebase-admin';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { FieldPath } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

/** Same shape as `TENANT_LISTABLE_SECURITY_LEVELS` in
 *  `searchRecruiterTableUsers.ts` — Firestore `in` is type-sensitive. */
const TENANT_LISTABLE_SECURITY_LEVELS: Array<string | number> = [
  '0', '1', '2', '3', '4', 0, 1, 2, 3, 4,
];

/** 1000 is Firestore's hard max page size — each round-trip costs about
 *  the same regardless of size up to that ceiling, so going from 500 →
 *  1000 cuts cold-start time roughly in half (8.5k workers ~21s → ~11s
 *  observed locally). */
const BATCH_SIZE = 1000;
/** Safety cap: 400k user docs scanned per request. Tenant directories
 *  larger than this should paginate via cursor — out of scope for v1. */
const MAX_BATCHES = 400;

export interface TenantWorkerDirectoryEntry {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  /** Optional — for downstream UI that wants to render a star icon /
   *  skill chips. Omitted when empty to keep the payload small. */
  skills?: string[];
}

export interface ListTenantWorkerDirectoryRequest {
  tenantId: string;
}

export interface ListTenantWorkerDirectoryResponse {
  workers: TenantWorkerDirectoryEntry[];
  count: number;
  scannedDocuments: number;
  batches: number;
  /** ISO 8601, used by the client cache as the freshness marker. */
  fetchedAt: string;
}

async function assertCallerCanRead(callerUid: string, tenantId: string): Promise<void> {
  const snap = await db.collection('users').doc(callerUid).get();
  if (!snap.exists) throw new HttpsError('permission-denied', 'User not found');
  const data = snap.data() as Record<string, unknown>;
  if (data.isHRX === true || data.hrx === true) return;
  const tenantMeta = (data.tenantIds as Record<string, unknown> | undefined)?.[tenantId] as
    | Record<string, unknown>
    | undefined;
  if (!tenantMeta) {
    throw new HttpsError('permission-denied', 'No access to this tenant');
  }
  const role = String(tenantMeta.role || '').trim().toLowerCase();
  if (['recruiter', 'manager', 'admin'].includes(role)) return;
  const secRaw = tenantMeta.securityLevel ?? data.securityLevel ?? '0';
  const sec = parseInt(String(secRaw), 10);
  if (!Number.isNaN(sec) && sec >= 4) return;
  throw new HttpsError('permission-denied', 'Not authorized to read tenant workers');
}

function pickStr(o: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return '';
}

function extractEntry(id: string, data: Record<string, unknown>): TenantWorkerDirectoryEntry {
  const addr =
    (data.addressInfo as Record<string, unknown> | undefined) ?? {};
  const legacyAddr =
    (data.address as Record<string, unknown> | undefined) ?? {};
  const skillsRaw = Array.isArray(data.skills) ? (data.skills as unknown[]) : [];
  const skills: string[] = [];
  for (const s of skillsRaw) {
    if (typeof s === 'string' && s.trim()) {
      skills.push(s.trim());
    } else if (s && typeof s === 'object') {
      const o = s as Record<string, unknown>;
      const label = pickStr(o, 'label', 'name', 'value');
      if (label) skills.push(label);
    }
  }
  const entry: TenantWorkerDirectoryEntry = {
    id,
    firstName: pickStr(data, 'firstName'),
    lastName: pickStr(data, 'lastName'),
    displayName: pickStr(data, 'displayName'),
    email: pickStr(data, 'email', 'contactEmail', 'primaryEmail', 'profileEmail'),
    phone: pickStr(data, 'phone', 'phoneE164', 'phoneNumber'),
    city: pickStr(addr, 'city') || pickStr(legacyAddr, 'city') || pickStr(data, 'city'),
    state:
      pickStr(addr, 'state') || pickStr(legacyAddr, 'state') || pickStr(data, 'state'),
  };
  if (skills.length > 0) entry.skills = skills;
  return entry;
}

export const listTenantWorkerDirectory = onCall<
  ListTenantWorkerDirectoryRequest,
  Promise<ListTenantWorkerDirectoryResponse>
>(
  {
    enforceAppCheck: false,
    cors: true,
    memory: '1GiB',
    timeoutSeconds: 120,
  },
  async (req): Promise<ListTenantWorkerDirectoryResponse> => {
    if (!req.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const tenantId = typeof req.data?.tenantId === 'string' ? req.data.tenantId.trim() : '';
    if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required');
    }
    await assertCallerCanRead(req.auth.uid, tenantId);

    const workers: TenantWorkerDirectoryEntry[] = [];
    let lastDoc: QueryDocumentSnapshot | null = null;
    let scanned = 0;
    let batches = 0;

    while (batches < MAX_BATCHES) {
      const base = db
        .collection('users')
        .where(`tenantIds.${tenantId}.securityLevel`, 'in', TENANT_LISTABLE_SECURITY_LEVELS)
        .orderBy(FieldPath.documentId())
        .limit(BATCH_SIZE);
      const snap = await (lastDoc ? base.startAfter(lastDoc) : base).get();
      if (snap.empty) break;
      batches += 1;
      scanned += snap.docs.length;
      for (const d of snap.docs) {
        workers.push(extractEntry(d.id, d.data() as Record<string, unknown>));
      }
      lastDoc = snap.docs[snap.docs.length - 1] ?? null;
      if (snap.docs.length < BATCH_SIZE) break;
    }

    const fetchedAt = new Date().toISOString();
    logger.info('listTenantWorkerDirectory.done', {
      tenantId,
      callerUid: req.auth.uid,
      count: workers.length,
      scanned,
      batches,
    });

    return {
      workers,
      count: workers.length,
      scannedDocuments: scanned,
      batches,
      fetchedAt,
    };
  },
);

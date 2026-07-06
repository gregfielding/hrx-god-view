/**
 * **fieldglassEnsureSite — recruiter-facing callable wrapper around
 * `ensureSiteCore` (FG Slice 3).**
 *
 * The /shifts/log "Create site + account" dialog calls this twice: once
 * with `execute: false` for the dry-run preview, then with `execute: true`
 * (plus the client-geocoded street address) to perform the idempotent
 * site → CRM location → child account chain. All resolution/creation
 * logic lives in ensureSiteCore.ts — shared with the parse trigger's
 * auto mode (FG Slice 4).
 *
 * Permissions: HRX or recruiter/manager/admin or securityLevel >= 5 —
 * same gate as the rest of the shift-log surface
 * (linkVenueToAccountCallable.ts).
 */

import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

import {
  ensureSiteCore,
  EnsureSiteError,
  type EnsureSiteAddress,
  type EnsureSiteResult,
} from './ensureSiteCore';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

interface Input {
  tenantId: string;
  /** Site name as printed on the email (or corrected by the recruiter). */
  siteName: string;
  /** Explicit directory pick — required on execute when the name is
   *  ambiguous in the directory. */
  siteCode?: string;
  /** external_shift_requests doc to stamp with the resolved ids. */
  requestId?: string;
  /** false/absent = dry-run: report the plan, write nothing. */
  execute?: boolean;
  /** Client-side geocoded street address (create or street-backfill). */
  address?: EnsureSiteAddress;
}

async function assertCallerCanEdit(callerUid: string, tenantId: string): Promise<void> {
  const snap = await db.collection('users').doc(callerUid).get();
  if (!snap.exists) throw new HttpsError('permission-denied', 'User not found');
  const data = snap.data() as Record<string, unknown>;
  if (data.isHRX === true || data.hrx === true) return;
  const tenantMeta = (data.tenantIds as Record<string, unknown> | undefined)?.[tenantId] as
    | Record<string, unknown>
    | undefined;
  if (!tenantMeta) throw new HttpsError('permission-denied', 'No access to this tenant');
  const role = String(tenantMeta.role || '').trim().toLowerCase();
  if (['recruiter', 'manager', 'admin'].includes(role)) return;
  const secRaw = tenantMeta.securityLevel ?? data.securityLevel ?? '0';
  const sec = parseInt(String(secRaw), 10);
  if (!Number.isNaN(sec) && sec >= 5) return;
  throw new HttpsError('permission-denied', 'Not authorized to manage Fieldglass sites');
}

export const fieldglassEnsureSite = onCall<Input, Promise<EnsureSiteResult>>(
  {
    enforceAppCheck: false,
    cors: true,
    memory: '512MiB',
    timeoutSeconds: 120,
  },
  async (req): Promise<EnsureSiteResult> => {
    if (!req.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const { tenantId, siteName, siteCode, requestId, execute = false, address } =
      req.data || ({} as Input);
    if (!tenantId || !siteName?.trim()) {
      throw new HttpsError('invalid-argument', 'tenantId and siteName are required');
    }
    await assertCallerCanEdit(req.auth.uid, tenantId);

    try {
      return await ensureSiteCore(db, {
        tenantId,
        siteName,
        siteCode,
        requestId,
        execute,
        address,
        actor: req.auth.uid,
      });
    } catch (e) {
      if (e instanceof EnsureSiteError) {
        throw new HttpsError(
          e.code === 'failed_precondition' ? 'failed-precondition' : 'internal',
          e.message,
        );
      }
      throw e;
    }
  },
);

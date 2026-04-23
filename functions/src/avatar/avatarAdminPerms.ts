/**
 * Shared permission check for admin-level writes to `users/{uid}.avatarVerification`.
 *
 * Used by:
 *   - `reverifyAvatar`            — force-rerun Vision on a worker's current photo
 *   - `setAvatarVerificationDecision` — Phase 5 recruiter approve / reject / request reupload
 *
 * Rule: caller must be Manager (securityLevel 4) or Admin (5) AND share at least one tenant
 * with the target user. Self-edit isn't handled here — callers should short-circuit for
 * `callerUid === targetUid` before invoking if self-access should be allowed.
 */
import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Throws `HttpsError('permission-denied', ...)` unless `callerUid` has Manager/Admin rights
 * on the same tenant as the target user.
 */
export async function assertCallerCanManageAvatarTarget(
  callerUid: string,
  targetData: Record<string, unknown>,
): Promise<void> {
  const callerSnap = await db.doc(`users/${callerUid}`).get();
  if (!callerSnap.exists) {
    throw new HttpsError('permission-denied', 'Caller profile not found.');
  }
  const caller = callerSnap.data() as Record<string, unknown>;
  const callerLevel = String((caller as { securityLevel?: unknown }).securityLevel || '');
  if (callerLevel !== '4' && callerLevel !== '5') {
    throw new HttpsError(
      'permission-denied',
      "Requires Manager or Admin permissions to change another user's headshot status.",
    );
  }

  const callerTenants = toTenantIdSet(caller);
  const targetTenants = toTenantIdSet(targetData);
  const overlap = [...targetTenants].some((t) => callerTenants.has(t));
  if (!overlap) {
    throw new HttpsError('permission-denied', 'Target user is not in any of your tenants.');
  }
}

/**
 * Users can have a single `tenantId` (legacy) or a `tenantIds` array / map. Accept any
 * shape and return a Set of tenant ids so the overlap check is forgiving.
 */
export function toTenantIdSet(user: Record<string, unknown>): Set<string> {
  const ids = new Set<string>();
  const t = (user as { tenantId?: unknown }).tenantId;
  if (typeof t === 'string' && t) ids.add(t);
  const arr = (user as { tenantIds?: unknown }).tenantIds;
  if (Array.isArray(arr)) {
    for (const v of arr) if (typeof v === 'string' && v) ids.add(v);
  } else if (arr && typeof arr === 'object') {
    for (const k of Object.keys(arr as Record<string, unknown>)) ids.add(k);
  }
  return ids;
}

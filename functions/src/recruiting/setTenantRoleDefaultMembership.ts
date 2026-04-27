/**
 * Callable — add or remove a single user from a single tenant-role-default
 * array on `tenants/{tid}/settings/roleDefaults`.
 *
 * Powers the inline chip toggles on the Workforce settings table. Each
 * call atomically flips one user's membership in one of the four arrays
 * (HRX Operator, Payroll Coordinator, CSA fallback, Scheduler fallback)
 * via a transaction so concurrent admin edits don't lose each other's
 * writes.
 *
 * Contract:
 *   - Permission: tenant security level 5, 6, or 7 on `tenantId`. HRX
 *     auto-qualifies. No "must be the same role" gate — any admin can
 *     toggle anyone, no zero-coverage guard (per Greg's call —
 *     deliberately permissive).
 *   - Idempotent: adding a uid that's already present is a no-op;
 *     removing a uid that's already absent is a no-op. The result's
 *     `changed` flag tells the client whether anything actually moved.
 *   - Audit: writes `updatedAt` and `updatedByUid` on the doc, and
 *     emits a `recruiting_role_default_membership_change` activity log
 *     entry under `tenants/{tid}/activityLogs` so we can reconstruct
 *     "who put X on the HRX Operator list" months later.
 *
 * @see shared/tenantRoleDefaults.ts
 * @see docs/RECRUITING_ROLE_MODEL.md §3.4 (tenant-level role defaults)
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

import {
  TENANT_ROLE_DEFAULTS,
  TENANT_ROLE_DEFAULT_FIELD,
  TENANT_ROLE_DEFAULT_LABELS,
  tenantRoleDefaultMembershipForUser,
  type SetTenantRoleDefaultMembershipInput,
  type SetTenantRoleDefaultMembershipResult,
  type TenantRoleDefault,
  type TenantRoleDefaultsDoc,
} from '../shared/tenantRoleDefaults';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/**
 * Resolve the caller's effective security level for `tenantId`. Same
 * pattern as `setAccountWorkforceStatus.ts`:
 *   - prefer `users.{uid}.tenantIds[tenantId].securityLevel`
 *   - fall back to the legacy top-level `users.{uid}.securityLevel`
 *   - HRX auto-qualifies via `auth.token.hrx === true`
 */
async function resolveCallerSecurityLevel(
  uid: string,
  authToken: Record<string, unknown> | undefined,
  tenantId: string,
): Promise<{ securityLevel: number; isHrx: boolean }> {
  const isHrx = authToken?.hrx === true;

  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) {
    return { securityLevel: 0, isHrx };
  }
  const data = userSnap.data() as Record<string, unknown>;
  const tenantIds = data.tenantIds as Record<string, Record<string, unknown>> | undefined;
  const nested = tenantIds?.[tenantId];

  const raw =
    nested && nested.securityLevel != null && String(nested.securityLevel).trim() !== ''
      ? nested.securityLevel
      : data.securityLevel;
  const parsed = Number.parseInt(String(raw ?? '0'), 10);
  return { securityLevel: Number.isNaN(parsed) ? 0 : parsed, isHrx };
}

function isValidRole(value: unknown): value is TenantRoleDefault {
  return typeof value === 'string' && (TENANT_ROLE_DEFAULTS as readonly string[]).includes(value);
}

export const setTenantRoleDefaultMembership = onCall<
  SetTenantRoleDefaultMembershipInput,
  Promise<SetTenantRoleDefaultMembershipResult>
>(
  {
    region: 'us-central1',
    maxInstances: 5,
    timeoutSeconds: 30,
    // 256MiB OOM'd on cold start — this codebase's module bundle
    // (gmail integration, SendGrid, firestore triggers, dotenv) uses
    // ~200+ MiB just to boot, leaving no headroom for the actual call.
    // Match the convention used by setAccountWorkforceStatus and friends.
    memory: '512MiB',
    cors: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in.');
    }
    const callerUid = request.auth.uid;
    const authToken = request.auth.token as Record<string, unknown> | undefined;

    const input = request.data;
    if (!input || typeof input !== 'object') {
      throw new HttpsError('invalid-argument', 'Missing payload.');
    }
    const { tenantId, uid, role, isMember } = input;

    if (!tenantId || typeof tenantId !== 'string') {
      throw new HttpsError('invalid-argument', '`tenantId` is required.');
    }
    if (!uid || typeof uid !== 'string') {
      throw new HttpsError('invalid-argument', '`uid` is required.');
    }
    if (!isValidRole(role)) {
      throw new HttpsError(
        'invalid-argument',
        `\`role\` must be one of: ${TENANT_ROLE_DEFAULTS.join(', ')}.`,
      );
    }
    if (typeof isMember !== 'boolean') {
      throw new HttpsError('invalid-argument', '`isMember` must be a boolean.');
    }

    // Permission gate — admin band only on this tenant.
    const { securityLevel, isHrx } = await resolveCallerSecurityLevel(
      callerUid,
      authToken,
      tenantId,
    );
    if (!isHrx && securityLevel < 5) {
      throw new HttpsError(
        'permission-denied',
        'Tenant role defaults can only be edited by admins (security level 5+).',
      );
    }

    // Sanity check the target user exists. We don't gate on what level
    // they have — a tenant might want to flag a security-4 user as a
    // "Payroll Coordinator" even if they're not in the Workforce
    // directory yet — the resolver only cares about the uid being in
    // the array.
    const targetSnap = await db.collection('users').doc(uid).get();
    if (!targetSnap.exists) {
      throw new HttpsError('not-found', `User ${uid} not found.`);
    }

    const fieldName = TENANT_ROLE_DEFAULT_FIELD[role];
    const docRef = db.doc(`tenants/${tenantId}/settings/roleDefaults`);

    // Atomic flip — read the array, mutate, write back. Transaction
    // guards against two admins toggling the same user in the same
    // millisecond (e.g. one removing while another adds).
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      const data = (snap.exists ? (snap.data() as TenantRoleDefaultsDoc) : null) ?? {};
      const currentArray = Array.isArray((data as Record<string, unknown>)[fieldName])
        ? ((data as Record<string, unknown>)[fieldName] as string[])
        : [];
      const set = new Set(currentArray);
      const wasMember = set.has(uid);

      let changed = false;
      if (isMember && !wasMember) {
        set.add(uid);
        changed = true;
      } else if (!isMember && wasMember) {
        set.delete(uid);
        changed = true;
      }

      const nextArray = Array.from(set);
      const nextDoc: TenantRoleDefaultsDoc = {
        ...data,
        [fieldName]: nextArray,
        updatedAt: new Date().toISOString(),
        updatedByUid: callerUid,
      };

      if (changed) {
        // `set` with `merge: true` so we don't blow away other arrays
        // on a tenant whose doc has all four populated.
        tx.set(docRef, nextDoc, { merge: true });
      }

      return {
        membership: tenantRoleDefaultMembershipForUser(nextDoc, uid),
        changed,
      };
    });

    // Best-effort audit log — failures here don't fail the user-facing
    // write. Useful for "who flipped this on?" reconstruction months
    // later when nobody remembers.
    if (result.changed) {
      try {
        await db.collection(`tenants/${tenantId}/activityLogs`).add({
          eventType: 'recruiting_role_default_membership_change',
          tenantId,
          targetUid: uid,
          role,
          roleLabel: TENANT_ROLE_DEFAULT_LABELS[role],
          isMember,
          actorUid: callerUid,
          actorIsHrx: isHrx,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (err) {
        logger.warn('setTenantRoleDefaultMembership: audit log write failed', {
          tenantId,
          uid,
          role,
          err: (err as Error).message,
        });
      }
    }

    logger.info('setTenantRoleDefaultMembership', {
      tenantId,
      uid,
      role,
      isMember,
      changed: result.changed,
      callerUid,
    });

    return {
      ok: true,
      membership: result.membership,
      changed: result.changed,
    };
  },
);

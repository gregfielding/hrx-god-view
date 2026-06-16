/**
 * Worker email aliases for the timesheet importer.
 *
 * The CSV email is the only worker-match key, but the email a worker uses
 * on the customer platform (e.g. Indeed Flex) often differs from the one on
 * their HRX record — a personal vs. work address, a typo, or a +tag. When a
 * recruiter confirms "this customer email is actually this HRX worker," we
 * remember it here so every future import of that email auto-resolves
 * (mirrors the Site→job-order mapping + Indeed venue_aliases pattern).
 *
 * Doc: tenants/{t}/timesheet_worker_aliases/{normalizedEmail-sanitized}
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/**
 * Canonicalize an email for matching: lowercase + trim, strip a `+tag`, and
 * drop dots in the local part for Gmail/Googlemail (where they're ignored).
 * This is the comparison key — two emails that normalize the same are the
 * same inbox.
 */
export function normalizeEmail(email: string): string {
  const e = String(email || '').trim().toLowerCase();
  const at = e.indexOf('@');
  if (at <= 0) return e;
  let local = e.slice(0, at);
  const domain = e.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus >= 0) local = local.slice(0, plus);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.replace(/\./g, '');
  }
  return `${local}@${domain}`;
}

/** Deterministic, Firestore-safe doc id for a normalized email. */
export function workerAliasDocId(email: string): string {
  return normalizeEmail(email).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 480);
}

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
  throw new HttpsError('permission-denied', 'Resolving workers requires tenant security level 5–7.');
}

export const saveTimesheetWorkerAlias = onCall(
  { cors: true },
  async (request): Promise<{ ok: true; docId: string; displayName: string | null }> => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const { tenantId, email, userId } = (request.data || {}) as {
      tenantId?: string;
      email?: string;
      userId?: string;
    };
    if (!tenantId || !email || !userId) {
      throw new HttpsError('invalid-argument', 'tenantId, email, and userId are required');
    }
    await assertTimesheetEditor(
      request.auth.uid,
      request.auth.token as Record<string, unknown>,
      tenantId,
    );

    const userSnap = await db.collection('users').doc(userId).get();
    if (!userSnap.exists) throw new HttpsError('not-found', 'HRX worker not found');
    const u = (userSnap.data() || {}) as Record<string, any>;
    const displayName =
      [u.firstName, u.lastName].filter(Boolean).join(' ') ||
      (typeof u.displayName === 'string' ? u.displayName : null) ||
      null;

    const docId = workerAliasDocId(email);
    await db.doc(`tenants/${tenantId}/timesheet_worker_aliases/${docId}`).set(
      {
        tenantId,
        email,
        normalizedEmail: normalizeEmail(email),
        userId,
        displayName,
        mappedBy: request.auth.uid,
        mappedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return { ok: true, docId, displayName };
  },
);

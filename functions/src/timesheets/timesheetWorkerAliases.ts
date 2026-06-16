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

/** Canonical "first last" key — for customers (e.g. Connect Team) whose
 *  export has no email, so workers are matched/remembered by name. */
export function normalizeName(firstName: string, lastName: string): string {
  return `${String(firstName || '')} ${String(lastName || '')}`
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Doc id for a name alias, scoped per customer (name collisions are common,
 *  so a VenueSmart "John Smith" mapping shouldn't leak to another customer). */
export function nameAliasDocId(customer: string, firstName: string, lastName: string): string {
  const c = String(customer || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const n = normalizeName(firstName, lastName).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `name__${c}__${n}`.slice(0, 480);
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
    const { tenantId, email, userId, customer, firstName, lastName } = (request.data || {}) as {
      tenantId?: string;
      email?: string;
      userId?: string;
      customer?: string;
      firstName?: string;
      lastName?: string;
    };
    // Either an email alias (most customers) OR a name alias (Connect Team /
    // any no-email export). For a name alias we need customer + a name.
    const hasEmail = !!(email && email.trim());
    const hasName = !!(customer && (firstName || lastName));
    if (!tenantId || !userId || (!hasEmail && !hasName)) {
      throw new HttpsError(
        'invalid-argument',
        'tenantId, userId, and either email or (customer + name) are required',
      );
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

    const docId = hasEmail
      ? workerAliasDocId(email as string)
      : nameAliasDocId(customer as string, firstName || '', lastName || '');
    await db.doc(`tenants/${tenantId}/timesheet_worker_aliases/${docId}`).set(
      {
        tenantId,
        userId,
        displayName,
        ...(hasEmail
          ? { kind: 'email', email, normalizedEmail: normalizeEmail(email as string) }
          : {
              kind: 'name',
              customer,
              firstName: firstName || '',
              lastName: lastName || '',
              normalizedName: normalizeName(firstName || '', lastName || ''),
            }),
        mappedBy: request.auth.uid,
        mappedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return { ok: true, docId, displayName };
  },
);

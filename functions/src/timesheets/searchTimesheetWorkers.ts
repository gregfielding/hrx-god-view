/**
 * searchTimesheetWorkers — free-text HRX worker lookup for the CSV importer.
 *
 * Backs the per-row "look up worker" pencil: when an auto match is wrong or
 * missing (e.g. the CSV spells "Amy Chappell" but HRX has "Amy Chappelle"),
 * the recruiter searches by name / email / phone and picks the right person.
 * The pick is then applied to the row (and optionally all same-name rows) via
 * a forced re-match in importTimesheetMatchWorkers.
 *
 * This callable only resolves IDENTITY (userId + contact) — it deliberately
 * does NOT resolve Everee linkage / pay / WC. Those run in the forced re-match
 * so the row gets the same cascade as an auto match.
 *
 * Reads are bounded prefix-range queries on the indexed name/email fields —
 * never an unbounded tenant scan.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

interface WorkerHit {
  userId: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  /** Member of the requesting tenant — surfaced first + flagged in the UI. */
  inTenant: boolean;
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
  throw new HttpsError('permission-denied', 'Looking up workers requires tenant security level 5–7.');
}

function titleCase(w: string): string {
  return w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w;
}

function toHit(id: string, data: Record<string, any>, tenantId: string): WorkerHit {
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
    inTenant: !!(data.tenantIds && typeof data.tenantIds === 'object' && data.tenantIds[tenantId]),
  };
}

/** Prefix-range query on a single indexed field (case-sensitive, so callers
 *  pass title-cased + as-typed variants). */
async function prefixQuery(
  field: string,
  value: string,
  limit: number,
): Promise<Array<{ id: string; data: Record<string, any> }>> {
  if (!value) return [];
  const snap = await db
    .collection('users')
    .where(field, '>=', value)
    .where(field, '<', `${value}`)
    .limit(limit)
    .get();
  return snap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, any> }));
}

export const searchTimesheetWorkers = onCall(
  { cors: true, memory: '512MiB', timeoutSeconds: 30 },
  async (request): Promise<{ candidates: WorkerHit[] }> => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const { tenantId, query } = (request.data || {}) as { tenantId?: string; query?: string };
    if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required');
    }
    await assertTimesheetEditor(
      request.auth.uid,
      request.auth.token as Record<string, unknown>,
      tenantId,
    );

    const q = String(query || '').trim();
    if (q.length < 2) return { candidates: [] };

    const found = new Map<string, Record<string, any>>();
    const add = (rows: Array<{ id: string; data: Record<string, any> }>) =>
      rows.forEach((r) => found.set(r.id, r.data));

    if (q.includes('@')) {
      // Email lookup — lowercase prefix range + exact.
      const e = q.toLowerCase();
      add(await prefixQuery('email', e, 20));
    } else if (/\d/.test(q) && q.replace(/\D/g, '').length >= 7) {
      // Phone lookup — try the raw input and a digits-only variant on the two
      // common stored shapes. Exact match only (Firestore has no contains).
      const digits = q.replace(/\D/g, '');
      const variants = Array.from(new Set([q, digits]));
      for (const field of ['phone', 'phoneNumber']) {
        for (const v of variants) {
          // eslint-disable-next-line no-await-in-loop
          const snap = await db.collection('users').where(field, '==', v).limit(10).get();
          add(snap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, any> })));
        }
      }
    } else {
      // Name lookup — prefix-range on last name AND first name, for both the
      // as-typed and title-cased forms (HRX stores names title-cased). Each
      // query token is tried so "amy chap" and "chappelle" both work.
      const tokens = q.split(/\s+/).filter(Boolean);
      const last = tokens[tokens.length - 1];
      const first = tokens[0];
      const probes = Array.from(new Set([first, last, q].flatMap((t) => [t, titleCase(t)])));
      for (const field of ['lastName', 'firstName']) {
        for (const v of probes) {
          // eslint-disable-next-line no-await-in-loop
          add(await prefixQuery(field, v, 25));
        }
      }
      // Full "First Last" query: a prefix on a COMMON first or last name gets
      // truncated by the limit before reaching the target — e.g. >25 "Jeremy"s
      // and >25 "Walker"s, neither slice containing "Jeremy Walker", so the
      // token filter below drops everything. Add exact-match probes on each
      // name part (single-field equality → no composite index, generous limit)
      // so the intersection is captured; the token filter keeps only full hits.
      if (tokens.length >= 2) {
        const eqProbes = Array.from(new Set([first, last].flatMap((t) => [t, titleCase(t)])));
        for (const field of ['firstName', 'lastName']) {
          for (const v of eqProbes) {
            // eslint-disable-next-line no-await-in-loop
            const snap = await db.collection('users').where(field, '==', v).limit(150).get();
            add(snap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, any> })));
          }
        }
      }
    }

    const ql = q.toLowerCase();
    const qTokens = ql.split(/\s+/).filter(Boolean);
    const hits = [...found.entries()]
      .map(([id, data]) => toHit(id, data, tenantId))
      .filter((h) => {
        // For a name query, require every token to appear in the name/email so
        // a broad last-name prefix doesn't flood the list.
        if (q.includes('@') || /^\+?[\d().\-\s]+$/.test(q)) return true;
        const hay = `${h.displayName || ''} ${h.email || ''}`.toLowerCase();
        return qTokens.every((t) => hay.includes(t));
      })
      // Tenant members first, then by name.
      .sort(
        (a, b) =>
          Number(b.inTenant) - Number(a.inTenant) ||
          (a.displayName || '').localeCompare(b.displayName || ''),
      )
      .slice(0, 15);

    return { candidates: hits };
  },
);

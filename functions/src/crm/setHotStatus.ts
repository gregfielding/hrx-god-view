/**
 * setHotStatus — the 🔥 flag (Greg, 2026-07-08: "just hot or not").
 *
 * Semantics: hot is SHARED across the trio — job order ↔ child account ↔
 * deal contacts. Flipping it anywhere flips it everywhere, both ways:
 *
 *   - origin job_order  → that JO + its child account + its deal contacts
 *   - origin account    → that account + its non-terminal JOs + those JOs'
 *                         deal contacts
 *   - origin contact    → that contact + JOs listing them as a deal
 *                         contact + those JOs' child accounts
 *
 * Each affected doc gets `hot`, `hotUpdatedAt`, `hotUpdatedBy`. The
 * Fieldglass orchestrator reads `hot` on the child account so new orders
 * at a hot site are born hot and the recruiter alert leads with 🔥.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const TERMINAL_JO_STATUSES = new Set(['cancelled', 'canceled', 'completed', 'filled', 'filled_by_another_agency']);

async function assertStaff(uid: string, token: Record<string, unknown> | undefined, tenantId: string): Promise<void> {
  if (token?.hrx === true) return;
  const snap = await db.collection('users').doc(uid).get();
  const data = (snap.data() || {}) as Record<string, any>;
  const nested = data.tenantIds?.[tenantId]?.securityLevel;
  const level = Number.parseInt(String(nested ?? data.securityLevel ?? '0'), 10) || 0;
  if (level >= 5 && level <= 7) return;
  throw new HttpsError('permission-denied', 'Marking records hot requires tenant security level 5–7.');
}

function dealContactIds(jo: Record<string, unknown> | undefined): string[] {
  const contacts = (jo as any)?.deal?.associations?.contacts;
  if (!Array.isArray(contacts)) return [];
  return contacts
    .map((c: any) => (typeof c === 'string' ? c : c?.id))
    .filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0);
}

export const setHotStatus = onCall(
  { cors: true, memory: '512MiB', timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const { tenantId, originType, originId, hot } = (request.data || {}) as {
      tenantId?: string;
      originType?: 'job_order' | 'account' | 'contact';
      originId?: string;
      hot?: boolean;
    };
    if (!tenantId || !originId || typeof hot !== 'boolean' || !originType) {
      throw new HttpsError('invalid-argument', 'tenantId, originType, originId, and hot are required');
    }
    if (!['job_order', 'account', 'contact'].includes(originType)) {
      throw new HttpsError('invalid-argument', `Unknown originType: ${originType}`);
    }
    await assertStaff(request.auth.uid, request.auth.token as Record<string, unknown>, tenantId);
    const uid = request.auth.uid;

    const joIds = new Set<string>();
    const accountIds = new Set<string>();
    const contactIds = new Set<string>();

    const joCol = db.collection(`tenants/${tenantId}/job_orders`);

    const absorbJobOrder = (id: string, jo: Record<string, unknown> | undefined) => {
      joIds.add(id);
      // FG/auto JOs put the CHILD ACCOUNT id in `recruiterAccountId`;
      // `accountId` can hold the CRM COMPANY id (2026-07-08 bug: the
      // cascade stamped a phantom accounts doc and missed the child).
      // Collect both — the existence check before the write keeps a
      // company id from ever creating a stray accounts doc.
      for (const key of ['recruiterAccountId', 'accountId']) {
        const v = (jo as any)?.[key];
        if (typeof v === 'string' && v.trim()) accountIds.add(v.trim());
      }
      dealContactIds(jo).forEach((c) => contactIds.add(c));
    };

    if (originType === 'job_order') {
      const snap = await joCol.doc(originId).get();
      if (!snap.exists) throw new HttpsError('not-found', 'Job order not found');
      absorbJobOrder(snap.id, snap.data());
    } else if (originType === 'account') {
      accountIds.add(originId);
      // Both linkage generations (see absorbJobOrder).
      const [byRecruiterAccount, byAccount] = await Promise.all([
        joCol.where('recruiterAccountId', '==', originId).get(),
        joCol.where('accountId', '==', originId).get(),
      ]);
      for (const d of [...byRecruiterAccount.docs, ...byAccount.docs]) {
        const status = String(d.get('status') ?? '').toLowerCase();
        if (TERMINAL_JO_STATUSES.has(status)) continue;
        absorbJobOrder(d.id, d.data());
      }
    } else {
      contactIds.add(originId);
      // JOs listing this contact live in the embedded deal associations —
      // there's no index on nested arrays, so scan non-terminal JOs.
      // (Hundreds of docs; fine at this scale.)
      const jos = await joCol.where('status', 'in', ['open', 'on_hold', 'draft']).get();
      for (const d of jos.docs) {
        if (dealContactIds(d.data()).includes(originId)) {
          absorbJobOrder(d.id, d.data());
        }
      }
    }

    // Only stamp docs that actually exist — merge-set on a wrong id
    // (e.g. a CRM company id in the accounts collection) would otherwise
    // conjure a phantom doc.
    const accountRefs = [...accountIds].map((id) => db.doc(`tenants/${tenantId}/accounts/${id}`));
    const contactRefs = [...contactIds].map((id) => db.doc(`tenants/${tenantId}/crm_contacts/${id}`));
    const existing = await db.getAll(...accountRefs, ...contactRefs).catch(() => []);
    const existingPaths = new Set(existing.filter((s) => s.exists).map((s) => s.ref.path));

    const stamp = {
      hot,
      hotUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      hotUpdatedBy: uid,
    };
    const batch = db.batch();
    joIds.forEach((id) => batch.set(joCol.doc(id), stamp, { merge: true }));
    const stampedAccounts: string[] = [];
    const stampedContacts: string[] = [];
    for (const ref of accountRefs) {
      if (!existingPaths.has(ref.path)) continue;
      batch.set(ref, stamp, { merge: true });
      stampedAccounts.push(ref.id);
    }
    for (const ref of contactRefs) {
      if (!existingPaths.has(ref.path)) continue;
      batch.set(ref, stamp, { merge: true });
      stampedContacts.push(ref.id);
    }
    await batch.commit();

    return {
      ok: true,
      hot,
      jobOrderIds: [...joIds],
      accountIds: stampedAccounts,
      contactIds: stampedContacts,
    };
  },
);

/**
 * One-shot: create child accounts for all CRM locations under this national account's linked companies.
 * Skips duplicates (same rules as automation). Does not require autoCreateChildAccountsForLocations.
 */
import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { tryCreateChildAccountForNationalParent } from './autoChildAccountFromCompanyLocation';

const db = admin.firestore();

function assertTenantStaff(auth: { uid: string; token: Record<string, unknown> } | undefined, tenantId: string): void {
  if (!auth) throw new HttpsError('unauthenticated', 'Authentication required');
  if (auth.token.hrx === true) return;
  const roles = auth.token.roles as Record<string, { role?: string }> | undefined;
  const role = roles?.[tenantId]?.role;
  if (role && ['Recruiter', 'Manager', 'Admin'].includes(role)) return;
  throw new HttpsError('permission-denied', 'Recruiter or Manager access required for this tenant');
}

export const backfillNationalAccountChildAccountsFromLocations = onCall(
  {
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 300,
  },
  async (request) => {
    const { tenantId, nationalAccountId } = (request.data || {}) as {
      tenantId?: string;
      nationalAccountId?: string;
    };
    if (!tenantId?.trim() || !nationalAccountId?.trim()) {
      throw new HttpsError('invalid-argument', 'tenantId and nationalAccountId are required');
    }
    assertTenantStaff(request.auth as { uid: string; token: Record<string, unknown> }, tenantId);

    const accRef = db.doc(`tenants/${tenantId}/accounts/${nationalAccountId}`);
    const accSnap = await accRef.get();
    if (!accSnap.exists) {
      throw new HttpsError('not-found', 'Account not found');
    }
    const acc = accSnap.data() as Record<string, unknown>;
    if (acc.accountType !== 'national') {
      throw new HttpsError('failed-precondition', 'Account must be a national account');
    }
    const companyIds = (acc.associations as { companyIds?: string[] } | undefined)?.companyIds?.filter(
      (x): x is string => typeof x === 'string' && !!x.trim(),
    );
    if (!companyIds?.length) {
      throw new HttpsError('failed-precondition', 'National account has no linked companies');
    }

    const uid = request.auth!.uid;
    const counts: Record<string, number> = {
      created: 0,
      skipped_duplicate: 0,
      skipped_idempotent: 0,
      skipped_not_national: 0,
      skipped_toggle: 0,
      aborted: 0,
      transaction_failed: 0,
    };
    let locationsProcessed = 0;

    for (const companyId of companyIds) {
      const locsSnap = await db.collection(`tenants/${tenantId}/crm_companies/${companyId}/locations`).get();
      for (const locDoc of locsSnap.docs) {
        locationsProcessed += 1;
        const locationData = locDoc.data() as Record<string, unknown>;
        const outcome = await tryCreateChildAccountForNationalParent({
          db,
          tenantId,
          parentAccountId: nationalAccountId,
          companyId,
          locationId: locDoc.id,
          locationData,
          requireAutoCreateToggle: false,
          actorUid: uid,
          quiet: true,
        });
        counts[outcome] = (counts[outcome] || 0) + 1;
      }
    }

    console.log(
      JSON.stringify({
        msg: 'backfillNationalAccountChildAccounts: done',
        tenantId,
        nationalAccountId,
        locationsProcessed,
        counts,
        uid,
      }),
    );

    return {
      ok: true,
      locationsProcessed,
      ...counts,
    };
  },
);

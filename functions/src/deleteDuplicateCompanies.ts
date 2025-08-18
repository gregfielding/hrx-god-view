import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

const db = admin.firestore();

function normalizeName(name?: string): string {
  return (name || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDomain(urlOrDomain?: string): string {
  if (!urlOrDomain) return '';
  try {
    let d = urlOrDomain.toString().trim();
    if (!d) return '';
    if (!/^https?:\/\//.test(d)) d = 'http://' + d;
    const u = new URL(d);
    let host = u.hostname || '';
    if (host.startsWith('www.')) host = host.slice(4);
    return host.toLowerCase();
  } catch {
    return urlOrDomain.toString().toLowerCase();
  }
}

function hasDeals(company: any): boolean {
  const arr = (company?.associations?.deals || []) as any[];
  if (!Array.isArray(arr)) return false;
  return arr.filter(Boolean).length > 0;
}

function getTimestampValue(company: any): number {
  const updated = company?.updatedAt?.toDate?.() || company?.updatedAt || null;
  const created = company?.createdAt?.toDate?.() || company?.createdAt || null;
  return (updated || created || new Date(0)).getTime();
}

async function deleteInBatches(refs: FirebaseFirestore.DocumentReference[]): Promise<number> {
  let batch = db.batch();
  let count = 0;
  for (const ref of refs) {
    batch.delete(ref);
    count++;
    if (count % 400 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }
  if (count % 400 !== 0) await batch.commit();
  return count;
}

export const deleteDuplicateCompanies = onCall(async (req) => {
  const { tenantId, apply = false, mode = 'both' } = (req.data as any) || {};
  if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required');

  // Basic auth check
  if (!req.auth) throw new HttpsError('unauthenticated', 'Authentication required');

  const companiesSnap = await db.collection(`tenants/${tenantId}/crm_companies`).get();
  const groups = new Map<string, any[]>();

  companiesSnap.docs.forEach((doc) => {
    const data = { id: doc.id, ...doc.data() } as any;
    const nameKey = normalizeName(data.companyName || data.name || data.legalName || '');
    const domainKey = extractDomain(data.domain || data.websiteUrl || data.companyUrl || data.url || '');
    let key = nameKey;
    if (mode === 'domain' && domainKey) key = `domain:${domainKey}`;
    if (mode === 'both' && domainKey) key = `domain:${domainKey}`; // prefer domain when available
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(data);
  });

  let duplicateGroups = 0;
  const candidates: FirebaseFirestore.DocumentReference[] = [];
  const kept: any[] = [];
  const protectedWithDeals: any[] = [];

  for (const [key, list] of groups.entries()) {
    if (!key || list.length <= 1) continue;
    duplicateGroups++;
    const withDeals = list.filter(hasDeals);
    const withoutDeals = list.filter((c) => !hasDeals(c));
    protectedWithDeals.push(...withDeals.map((c) => ({ id: c.id, name: c.companyName || c.name })));
    if (withoutDeals.length > 1) {
      const sorted = withoutDeals.sort((a, b) => getTimestampValue(b) - getTimestampValue(a));
      const keep = sorted.shift();
      if (keep) kept.push({ id: keep.id, name: keep.companyName || keep.name });
      sorted.forEach((c) => candidates.push(db.doc(`tenants/${tenantId}/crm_companies/${c.id}`)));
    }
  }

  let deleted = 0;
  if (apply && candidates.length > 0) {
    deleted = await deleteInBatches(candidates);
  }

  return {
    ok: true,
    tenantId,
    duplicateGroups,
    candidates: candidates.length,
    deleted,
    kept,
    protectedWithDealsCount: protectedWithDeals.length,
  };
});



/**
 * Read-only validation: tenant applications invariants + optional user.applicationIds integrity.
 *
 * Usage:
 *   npm run validate:applications -- --tenantId=<TENANT_ID>
 *   npm run validate:applications -- --tenantId=<TENANT_ID> --user-scan-max=500
 *
 * Requires Firebase Admin credentials (service account or application default).
 *
 * Status logic must stay aligned with `shared/applicationStatus.ts` (scripts tsconfig rootDir cannot import ../shared).
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

const CANONICAL_STATUSES = new Set([
  'submitted',
  'under_review',
  'interview',
  'offer_pending',
  'accepted',
  'rejected',
  'withdrawn',
  'waitlisted',
]);

const TERMINAL = new Set(['accepted', 'rejected', 'withdrawn']);

const LEGACY_TO_CANONICAL: Record<string, string> = {
  new: 'submitted',
  applied: 'submitted',
  screening: 'under_review',
  screened: 'under_review',
  advanced: 'under_review',
  interviewed: 'interview',
  offer_pending: 'offer_pending',
  hired: 'accepted',
  selected: 'accepted',
  accepted: 'accepted',
  rejected: 'rejected',
  withdrawn: 'withdrawn',
  waitlisted: 'waitlisted',
  pending: 'submitted',
};

function normalizeApplicationStatus(raw: string | null | undefined): string | null {
  const k = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!k) return 'submitted';
  if (CANONICAL_STATUSES.has(k)) return k;
  return LEGACY_TO_CANONICAL[k] ?? null;
}

function isOpenApplicationStatusForInvariant(raw: string | null | undefined): boolean {
  const n = normalizeApplicationStatus(raw);
  if (n == null) return true;
  return !TERMINAL.has(n);
}

function parseArgs(): { tenantId: string; userScanMax: number } {
  const argv = process.argv.slice(2);
  let tenantId = '';
  let userScanMax = 0;
  for (const a of argv) {
    if (a.startsWith('--tenantId=')) tenantId = a.slice('--tenantId='.length).trim();
    if (a.startsWith('--user-scan-max=')) userScanMax = Math.max(0, parseInt(a.slice('--user-scan-max='.length), 10) || 0);
  }
  if (!tenantId) {
    console.error('Missing --tenantId=<TENANT_ID>');
    process.exit(1);
  }
  return { tenantId, userScanMax };
}

function initAdmin(): void {
  let credential: admin.credential.Credential | undefined;
  const possibleKeyPaths = [
    path.join(__dirname, '..', 'serviceAccountKey.json'),
    path.join(__dirname, '..', 'firebase-adminsdk.json'),
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
  ].filter(Boolean) as string[];

  for (const keyPath of possibleKeyPaths) {
    if (keyPath && fs.existsSync(keyPath)) {
      const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
      credential = admin.credential.cert(serviceAccount);
      console.log(`Using service account: ${keyPath}`);
      break;
    }
  }
  if (!credential) {
    credential = admin.credential.applicationDefault();
    console.log('Using application default credentials');
  }

  const projectId =
    process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || process.env.FIREBASE_PROJECT_ID || undefined;

  try {
    admin.initializeApp({ credential, ...(projectId ? { projectId } : {}) });
  } catch {
    // already initialized
  }
}

function applicantUserId(data: Record<string, unknown>): string {
  return String(data.userId || data.applicantId || data.candidateId || '').trim();
}

function jobOrderIdRaw(data: Record<string, unknown>): string | null {
  const v = data.jobOrderId;
  if (v == null || v === '') return null;
  return String(v).trim() || null;
}

function postIdRaw(data: Record<string, unknown>): string | null {
  const v = data.postId ?? data.jobId ?? data.jobBoardPostId;
  if (v == null || v === '') return null;
  return String(v).trim() || null;
}

interface DuplicateGroup {
  key: string;
  docIds: string[];
  rawStatuses: string[];
}

async function main(): Promise<void> {
  const { tenantId, userScanMax } = parseArgs();
  initAdmin();
  const db = admin.firestore();

  const appsRef = db.collection('tenants').doc(tenantId).collection('applications');
  const snapshot = await appsRef.get();

  const linkedOpen = new Map<string, string[]>();
  const standaloneOpen = new Map<string, string[]>();
  const statusSamples = new Map<string, string[]>();

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data() as Record<string, unknown>;
    const uid = applicantUserId(data);
    if (!uid) continue;

    const statusRaw = String(data.status ?? '');
    const open = isOpenApplicationStatusForInvariant(statusRaw);
    if (!open) continue;

    const jo = jobOrderIdRaw(data);
    const pid = postIdRaw(data);

    if (jo) {
      const key = `${uid}::jobOrder::${jo}`;
      const list = linkedOpen.get(key) || [];
      list.push(docSnap.id);
      linkedOpen.set(key, list);
    } else if (pid) {
      const key = `${uid}::post::${pid}`;
      const list = standaloneOpen.get(key) || [];
      list.push(docSnap.id);
      standaloneOpen.set(key, list);
    }

    const canon = normalizeApplicationStatus(statusRaw);
    const unk = canon == null ? `UNMAPPED:${statusRaw}` : canon;
    const ss = statusSamples.get(unk) || [];
    if (ss.length < 5) {
      ss.push(docSnap.id);
      statusSamples.set(unk, ss);
    }
  }

  const duplicateLinked: DuplicateGroup[] = [];
  for (const [key, docIds] of linkedOpen) {
    if (docIds.length > 1) {
      duplicateLinked.push({
        key,
        docIds,
        rawStatuses: docIds.map((id) => {
          const d = snapshot.docs.find((x) => x.id === id)?.data() as Record<string, unknown> | undefined;
          return String(d?.status ?? '');
        }),
      });
    }
  }

  const duplicateStandalone: DuplicateGroup[] = [];
  for (const [key, docIds] of standaloneOpen) {
    if (docIds.length > 1) {
      duplicateStandalone.push({
        key,
        docIds,
        rawStatuses: docIds.map((id) => {
          const d = snapshot.docs.find((x) => x.id === id)?.data() as Record<string, unknown> | undefined;
          return String(d?.status ?? '');
        }),
      });
    }
  }

  console.log('\n=== Applications invariant report ===');
  console.log(`Tenant: ${tenantId}`);
  console.log(`Total application docs scanned: ${snapshot.size}`);
  console.log(`Duplicate open (user × jobOrderId): ${duplicateLinked.length}`);
  for (const g of duplicateLinked) {
    console.log(`  ${g.key}`);
    console.log(`    docIds: ${g.docIds.join(', ')}`);
    console.log(`    statuses: ${g.rawStatuses.join(' | ')}`);
  }
  console.log(`Duplicate open (user × postId, jobOrderId null): ${duplicateStandalone.length}`);
  for (const g of duplicateStandalone) {
    console.log(`  ${g.key}`);
    console.log(`    docIds: ${g.docIds.join(', ')}`);
    console.log(`    statuses: ${g.rawStatuses.join(' | ')}`);
  }

  console.log('\nSample doc ids by normalized status (debug):');
  for (const [k, ids] of statusSamples) {
    console.log(`  ${k}: ${ids.join(', ')}`);
  }

  if (userScanMax > 0) {
    console.log(`\n=== user.applicationIds check (max ${userScanMax} users by document id) ===`);
    let scanned = 0;
    let orphans = 0;
    let last: admin.firestore.DocumentSnapshot | undefined;
    while (scanned < userScanMax) {
      const batch = 200;
      let q = db.collection('users').orderBy(admin.firestore.FieldPath.documentId()).limit(Math.min(batch, userScanMax - scanned));
      if (last) q = q.startAfter(last);
      const snap = await q.get();
      if (snap.empty) break;
      for (const u of snap.docs) {
        scanned++;
        const appIds: unknown = u.data()?.applicationIds;
        if (!Array.isArray(appIds)) continue;
        for (const rawId of appIds) {
          const appId = String(rawId || '').trim();
          if (!appId) continue;
          const ref = appsRef.doc(appId);
          const exists = (await ref.get()).exists;
          if (!exists) {
            orphans++;
            console.log(`  ORPHAN user=${u.id} applicationId=${appId} (missing in tenants/${tenantId}/applications)`);
          }
        }
        if (scanned >= userScanMax) break;
      }
      last = snap.docs[snap.docs.length - 1];
      if (snap.size < batch) break;
    }
    console.log(`Users scanned: ${scanned}, orphan references: ${orphans}`);
  } else {
    console.log('\n(Skipping user.applicationIds scan; pass --user-scan-max=N to enable.)');
  }

  const bad = duplicateLinked.length + duplicateStandalone.length;
  process.exitCode = bad > 0 ? 2 : 0;
  if (bad > 0) console.log('\nExit code 2: invariant violations reported (report-only).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

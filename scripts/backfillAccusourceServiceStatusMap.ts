/**
 * One-time backfill: convert literal dotted field names
 *   "providerServiceOrderStatus.68206" -> nested providerServiceOrderStatus.68206
 * across top-level `backgroundChecks` docs.
 *
 * Usage (dry run, prints what would change):
 *   GCLOUD_PROJECT=hrx1-d3beb npx ts-node scripts/backfillAccusourceServiceStatusMap.ts
 *
 * Usage (apply):
 *   GCLOUD_PROJECT=hrx1-d3beb APPLY=1 npx ts-node scripts/backfillAccusourceServiceStatusMap.ts
 */
import * as admin from 'firebase-admin';

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'hrx1-d3beb';
const APPLY = process.env.APPLY === '1';

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const PREFIX = 'providerServiceOrderStatus.';

async function main() {
  console.log(`\n=== backfill providerServiceOrderStatus map (project=${PROJECT_ID}, apply=${APPLY}) ===\n`);

  let scanned = 0;
  let needingFix = 0;
  let fixed = 0;
  let lastDoc: admin.firestore.QueryDocumentSnapshot | null = null;
  const BATCH = 400;

  while (true) {
    let q = db.collection('backgroundChecks').orderBy(admin.firestore.FieldPath.documentId()).limit(BATCH);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      scanned += 1;
      const data = doc.data();
      const dottedKeys = Object.keys(data).filter((k) => k.startsWith(PREFIX));
      if (dottedKeys.length === 0) continue;

      needingFix += 1;
      const existingNested =
        (data.providerServiceOrderStatus as Record<string, Record<string, unknown>> | undefined) ?? {};
      const nextNested: Record<string, Record<string, unknown>> = { ...existingNested };
      for (const k of dottedKeys) {
        const serviceKey = k.slice(PREFIX.length);
        if (!serviceKey) continue;
        const val = data[k];
        if (val && typeof val === 'object') nextNested[serviceKey] = val as Record<string, unknown>;
      }

      console.log(
        `- ${doc.ref.path}: merging ${dottedKeys.length} dotted key(s) -> nested map of ${Object.keys(nextNested).length}`,
      );
      if (!APPLY) continue;

      // 1. Write the new nested map via set({ merge: true }). This doesn't
      //    touch the literal dotted top-level fields.
      await doc.ref.set({ providerServiceOrderStatus: nextNested }, { merge: true });

      // 2. Delete the literal dotted top-level fields. We must use FieldPath
      //    with the variadic update() signature here: update({ "a.b": ... })
      //    would parse "a.b" as a nested path rather than a literal field name
      //    that contains a dot.
      const deleteArgs: unknown[] = [];
      for (const k of dottedKeys) {
        deleteArgs.push(new admin.firestore.FieldPath(k));
        deleteArgs.push(admin.firestore.FieldValue.delete());
      }
      if (deleteArgs.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (doc.ref.update as any)(...deleteArgs);
      }
      fixed += 1;
    }

    lastDoc = snap.docs[snap.docs.length - 1]!;
    if (snap.size < BATCH) break;
  }

  console.log(`\nscanned=${scanned} needingFix=${needingFix} fixed=${fixed} apply=${APPLY}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('fatal', err);
  process.exit(1);
});

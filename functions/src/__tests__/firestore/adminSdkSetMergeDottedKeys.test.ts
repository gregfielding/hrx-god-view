/**
 * Pinning test — Firebase Admin SDK semantic difference between
 * `set(data, { merge: true })` and `update(data)` for dotted-string keys.
 *
 * Background (post-mortem, Apr 26 2026):
 *   The R.0b live trigger (`onApplicationSubmittedSyncProfile`) and the R.0c
 *   CLI script (`scripts/backfillWorkerAttestations.js`) used
 *   `userRef.set(patch, { merge: true })` with a patch produced by
 *   `buildAttestationsSyncPatchFromApplication`, which returns dotted-string
 *   keys (e.g. `workerAttestations.eVerifyWillingness`,
 *   `workerAttestations._meta.eVerifyWillingness.source`).
 *
 *   The Web Client SDK (`firebase/firestore`) interprets dotted keys under
 *   `setDoc(..., { merge: true })` as nested field paths. The Admin SDK
 *   (`firebase-admin`) does NOT — it writes them as LITERAL top-level field
 *   names with embedded dots. Only `update()` treats dotted strings as field
 *   paths in the Admin SDK.
 *
 *   Pattern-matching from the wizard's client-side write to the trigger's
 *   server-side write without testing this difference caused production
 *   pollution: ~1056 user docs in tenant BCiP2bQ9CgVOCTfV6MhD ended up with
 *   garbage literal-dotted top-level keys instead of nested attestations.
 *
 * What this test does:
 *   - With Firestore emulator running, asserts the actual SDK semantic.
 *   - `set({ 'a.b': v }, { merge: true })` writes a LITERAL field "a.b".
 *   - `update({ 'a.b': v })` writes nested `a.b = v`.
 *   - Mock-based tests cannot catch this because mocks don't have the SDK's
 *     real write semantics. Hence the integration form.
 *
 * To run:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 \
 *     GCLOUD_PROJECT=demo-test \
 *     npx mocha -r ts-node/register -r src/__tests__/setup.ts \
 *     src/__tests__/firestore/adminSdkSetMergeDottedKeys.test.ts
 *
 * Without the emulator, the test is skipped.
 */

import { expect } from 'chai';
import * as admin from 'firebase-admin';

const USE_EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
const TEST_COLLECTION = 'admin_sdk_dotted_key_pinning_test';

function skipWithoutEmulator(this: { skip(): void }) {
  if (!USE_EMULATOR) this.skip();
}

describe('Admin SDK semantic — set/merge vs update with dotted-string keys', () => {
  afterEach(async function () {
    if (!USE_EMULATOR) return;
    const db = admin.firestore();
    const snap = await db.collection(TEST_COLLECTION).get();
    for (const doc of snap.docs) await doc.ref.delete();
  });

  it('set({"a.b": v}, { merge: true }) writes a LITERAL field "a.b" (NOT nested)', async function () {
    skipWithoutEmulator.call(this);
    const db = admin.firestore();
    const ref = db.collection(TEST_COLLECTION).doc('case-set-merge');

    await ref.set(
      { 'workerAttestations.eVerifyWillingness': 'Yes' } as any,
      { merge: true },
    );

    const snap = await ref.get();
    const data = snap.data() || {};

    // Bug behavior: literal top-level field with embedded dot exists.
    expect(data['workerAttestations.eVerifyWillingness']).to.equal('Yes');

    // Bug behavior: nested map is NOT created.
    const nestedExists =
      data.workerAttestations &&
      typeof data.workerAttestations === 'object' &&
      'eVerifyWillingness' in data.workerAttestations;
    expect(nestedExists, 'nested workerAttestations.eVerifyWillingness should NOT exist').to.equal(
      false,
    );
  });

  it('update({"a.b": v}) writes NESTED a.b = v (correct field-path semantic)', async function () {
    skipWithoutEmulator.call(this);
    const db = admin.firestore();
    const ref = db.collection(TEST_COLLECTION).doc('case-update');

    // `update()` requires the doc to exist.
    await ref.set({ _initialized: true });

    await ref.update({ 'workerAttestations.eVerifyWillingness': 'Yes' });

    const snap = await ref.get();
    const data = snap.data() || {};

    // Correct: nested map exists.
    expect(data.workerAttestations).to.be.an('object');
    expect((data.workerAttestations as any).eVerifyWillingness).to.equal('Yes');

    // Correct: NO literal top-level field with embedded dot.
    expect(
      Object.prototype.hasOwnProperty.call(data, 'workerAttestations.eVerifyWillingness'),
    ).to.equal(false);
  });

  it('update() supports deep dotted paths (3+ levels) as field paths', async function () {
    skipWithoutEmulator.call(this);
    const db = admin.firestore();
    const ref = db.collection(TEST_COLLECTION).doc('case-deep');

    await ref.set({ _initialized: true });

    await ref.update({
      'workerAttestations.eVerifyWillingness': 'Yes',
      'workerAttestations._meta.eVerifyWillingness.source': 'application_backfill',
      'workerAttestations._meta.eVerifyWillingness.attestedAt':
        admin.firestore.FieldValue.serverTimestamp(),
    });

    const snap = await ref.get();
    const data = snap.data() || {};

    expect((data.workerAttestations as any).eVerifyWillingness).to.equal('Yes');
    expect(
      (data.workerAttestations as any)._meta.eVerifyWillingness.source,
    ).to.equal('application_backfill');
    expect((data.workerAttestations as any)._meta.eVerifyWillingness.attestedAt).to.exist;

    // Confirm there are NO literal top-level dotted keys.
    const literalKeys = Object.keys(data).filter((k) => k.startsWith('workerAttestations.'));
    expect(literalKeys).to.deep.equal([]);
  });

  it('set with NESTED objects + merge:true correctly merges leaf-level (safe alternative pattern)', async function () {
    skipWithoutEmulator.call(this);
    const db = admin.firestore();
    const ref = db.collection(TEST_COLLECTION).doc('case-nested-set');

    // Pre-existing siblings: keep these on merge.
    await ref.set({ siblingsMap: { existing1: { id: 'existing1' } } });

    await ref.set(
      { siblingsMap: { newSibling: { id: 'newSibling' } } },
      { merge: true },
    );

    const snap = await ref.get();
    const data = snap.data() || {};

    expect((data.siblingsMap as any).existing1).to.deep.include({ id: 'existing1' });
    expect((data.siblingsMap as any).newSibling).to.deep.include({ id: 'newSibling' });

    // No literal "siblingsMap.newSibling" top-level field.
    expect(Object.prototype.hasOwnProperty.call(data, 'siblingsMap.newSibling')).to.equal(
      false,
    );
  });
});

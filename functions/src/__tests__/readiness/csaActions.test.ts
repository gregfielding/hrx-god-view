/**
 * **R.3** — emulator integration tests for the generalized CSA readiness
 * action helper (`applyCsaReadinessAction`).
 *
 * The three exported callables (`confirmReadinessItem`, `waiveReadinessItem`,
 * `markReadinessItemFailed`) are thin wrappers: they validate auth, run
 * `ensureReadinessCsaAdmin`, then call into `applyCsaReadinessAction` with a
 * fixed `kind`. Testing the helper covers the meat of the contract:
 *   - status / resolutionMethod transitions per kind
 *   - mandatory note enforcement on waive / markFailed
 *   - excluded-type rejection (E-Verify, AccuSource)
 *   - audit history append (parallel to AccuSource's `adjudication.history[]`)
 *   - idempotency short-circuit (same target state + same note → no-op)
 *
 * The auth/permission gate is exercised against the emulator separately by
 * the `'permission gate'` group at the bottom (writes a user doc, calls
 * `ensureReadinessCsaAdmin`, asserts the throw / pass).
 *
 * Without the emulator, every test is skipped — pure unit tests in this
 * area would mock the transaction round-trip and miss the very thing that
 * burned us in the R.0b/R.0c bug (the SDK semantic difference between
 * `set/merge` and `update` for nested fields). See `adminSdkSetMergeDottedKeys.test.ts`.
 *
 * To run:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 \
 *     GCLOUD_PROJECT=demo-test \
 *     npx mocha -r ts-node/register -r src/__tests__/setup.ts \
 *     src/__tests__/readiness/csaActions.test.ts
 */

import { expect } from 'chai';
import * as admin from 'firebase-admin';

import { applyCsaReadinessAction } from '../../readiness/csaActions/applyCsaReadinessAction';
import { ensureReadinessCsaAdmin } from '../../readiness/csaActions/ensureReadinessCsaAdmin';
import {
  CSA_READINESS_ACTION_EXCLUDED_TYPES,
  type CsaReadinessActionInput,
  type CsaReadinessActionsField,
  type CsaReadinessHistoryEntry,
} from '../../readiness/csaActions/csaActionTypes';

const USE_EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
const TENANT_ID = 'r3-tests-tenant';
const ACTOR_UID = 'r3-tests-actor';

function skipWithoutEmulator(this: { skip(): void }): void {
  if (!USE_EMULATOR) this.skip();
}

function db(): admin.firestore.Firestore {
  return admin.firestore();
}

interface SeedItemInput {
  collection: 'assignment' | 'employee';
  itemId: string;
  requirementType: string;
  status?: string;
  resolutionMethod?: string | null;
  csaActions?: CsaReadinessActionsField;
}

async function seedItem(input: SeedItemInput): Promise<admin.firestore.DocumentReference> {
  const path =
    input.collection === 'assignment'
      ? `tenants/${TENANT_ID}/assignmentReadinessItems`
      : `tenants/${TENANT_ID}/employeeReadinessItems`;
  const ref = db().collection(path).doc(input.itemId);
  const data: Record<string, unknown> = {
    tenantId: TENANT_ID,
    requirementType: input.requirementType,
    status: input.status ?? 'incomplete',
    resolutionMethod: input.resolutionMethod ?? null,
    createdAt: new Date('2026-04-26T00:00:00Z').toISOString(),
    updatedAt: new Date('2026-04-26T00:00:00Z').toISOString(),
  };
  if (input.csaActions) data.csaActions = input.csaActions;
  await ref.set(data);
  return ref;
}

async function clearAll(): Promise<void> {
  for (const collection of ['assignmentReadinessItems', 'employeeReadinessItems']) {
    const snap = await db().collection(`tenants/${TENANT_ID}/${collection}`).get();
    for (const doc of snap.docs) await doc.ref.delete();
  }
  const userSnap = await db().collection('users').where('__r3test', '==', true).get();
  for (const doc of userSnap.docs) await doc.ref.delete();
}

describe('R.3 applyCsaReadinessAction — confirm', () => {
  afterEach(async function () {
    if (!USE_EMULATOR) return;
    await clearAll();
  });

  it('flips an incomplete willingness item to complete_pass + csa_confirmed and appends history', async function () {
    skipWithoutEmulator.call(this);
    const ref = await seedItem({
      collection: 'assignment',
      itemId: 'asgmt-A__physical_willingness',
      requirementType: 'physical_willingness',
      status: 'incomplete',
      resolutionMethod: null,
    });

    const input: CsaReadinessActionInput = {
      tenantId: TENANT_ID,
      itemId: 'asgmt-A__physical_willingness',
      collection: 'assignment',
      note: 'verified verbally with worker',
    };
    const result = await applyCsaReadinessAction(input, ACTOR_UID, 'csa_confirm');
    expect(result.unchanged).to.equal(false);
    expect(result.status).to.equal('complete_pass');
    expect(result.resolutionMethod).to.equal('csa_confirmed');

    const after = (await ref.get()).data() || {};
    expect(after.status).to.equal('complete_pass');
    expect(after.resolutionMethod).to.equal('csa_confirmed');
    expect(after.completedAt, 'completedAt should be stamped on complete_pass').to.be.a('string');

    const history = (after.csaActions as CsaReadinessActionsField | undefined)?.history ?? [];
    expect(history).to.have.lengthOf(1);
    const entry = history[0] as CsaReadinessHistoryEntry;
    expect(entry.kind).to.equal('csa_confirm');
    expect(entry.fromStatus).to.equal('incomplete');
    expect(entry.toStatus).to.equal('complete_pass');
    expect(entry.by).to.equal(ACTOR_UID);
    expect(entry.reason).to.equal('verified verbally with worker');
  });

  it('confirm without note records null reason in history', async function () {
    skipWithoutEmulator.call(this);
    const ref = await seedItem({
      collection: 'assignment',
      itemId: 'asgmt-B__skill_match',
      requirementType: 'skill_match',
      status: 'incomplete',
    });
    const result = await applyCsaReadinessAction(
      { tenantId: TENANT_ID, itemId: 'asgmt-B__skill_match', collection: 'assignment' },
      ACTOR_UID,
      'csa_confirm',
    );
    expect(result.unchanged).to.equal(false);
    const after = (await ref.get()).data() || {};
    const history = (after.csaActions as CsaReadinessActionsField | undefined)?.history ?? [];
    expect(history[0]?.reason).to.equal(null);
  });

  it('is idempotent — second confirm with same note short-circuits', async function () {
    skipWithoutEmulator.call(this);
    const ref = await seedItem({
      collection: 'assignment',
      itemId: 'asgmt-C__uniform_willingness',
      requirementType: 'uniform_willingness',
      status: 'incomplete',
    });
    const input: CsaReadinessActionInput = {
      tenantId: TENANT_ID,
      itemId: 'asgmt-C__uniform_willingness',
      collection: 'assignment',
      note: 'same note',
    };
    const first = await applyCsaReadinessAction(input, ACTOR_UID, 'csa_confirm');
    expect(first.unchanged).to.equal(false);
    const updatedAtAfterFirst = ((await ref.get()).data() || {}).updatedAt as string;

    const second = await applyCsaReadinessAction(input, ACTOR_UID, 'csa_confirm');
    expect(second.unchanged).to.equal(true);

    const after = (await ref.get()).data() || {};
    expect(after.updatedAt).to.equal(updatedAtAfterFirst);
    const history = (after.csaActions as CsaReadinessActionsField | undefined)?.history ?? [];
    expect(history, 'no history append on idempotent re-call').to.have.lengthOf(1);
  });

  it('is NOT idempotent when the note changes — appends a fresh history entry', async function () {
    skipWithoutEmulator.call(this);
    const ref = await seedItem({
      collection: 'assignment',
      itemId: 'asgmt-D__language_willingness',
      requirementType: 'language_willingness',
      status: 'incomplete',
    });
    await applyCsaReadinessAction(
      {
        tenantId: TENANT_ID,
        itemId: 'asgmt-D__language_willingness',
        collection: 'assignment',
        note: 'first reason',
      },
      ACTOR_UID,
      'csa_confirm',
    );
    const second = await applyCsaReadinessAction(
      {
        tenantId: TENANT_ID,
        itemId: 'asgmt-D__language_willingness',
        collection: 'assignment',
        note: 'second reason — recruiter follow-up',
      },
      ACTOR_UID,
      'csa_confirm',
    );
    expect(second.unchanged).to.equal(false);
    const after = (await ref.get()).data() || {};
    const history = (after.csaActions as CsaReadinessActionsField | undefined)?.history ?? [];
    expect(history).to.have.lengthOf(2);
    expect(history[1]?.reason).to.equal('second reason — recruiter follow-up');
    expect(history[1]?.fromStatus).to.equal('complete_pass'); // already in target state
    expect(history[1]?.toStatus).to.equal('complete_pass');
  });
});

describe('R.3 applyCsaReadinessAction — waive', () => {
  afterEach(async function () {
    if (!USE_EMULATOR) return;
    await clearAll();
  });

  it('flips item to complete_pass + csa_waived with required note', async function () {
    skipWithoutEmulator.call(this);
    const ref = await seedItem({
      collection: 'assignment',
      itemId: 'asgmt-E__ppe_willingness',
      requirementType: 'ppe_willingness',
      status: 'incomplete',
    });
    const result = await applyCsaReadinessAction(
      {
        tenantId: TENANT_ID,
        itemId: 'asgmt-E__ppe_willingness',
        collection: 'assignment',
        note: 'client allows alternative PPE on this site',
      },
      ACTOR_UID,
      'csa_waive',
    );
    expect(result.status).to.equal('complete_pass');
    expect(result.resolutionMethod).to.equal('csa_waived');
    const after = (await ref.get()).data() || {};
    expect(after.status).to.equal('complete_pass');
    expect(after.resolutionMethod).to.equal('csa_waived');
    expect(after.completedAt).to.be.a('string');
    const history = (after.csaActions as CsaReadinessActionsField | undefined)?.history ?? [];
    expect(history[0]?.kind).to.equal('csa_waive');
    expect(history[0]?.reason).to.equal('client allows alternative PPE on this site');
  });

  it('rejects waive without note — invalid-argument', async function () {
    skipWithoutEmulator.call(this);
    await seedItem({
      collection: 'assignment',
      itemId: 'asgmt-F__ppe_willingness',
      requirementType: 'ppe_willingness',
    });
    let err: any = null;
    try {
      await applyCsaReadinessAction(
        {
          tenantId: TENANT_ID,
          itemId: 'asgmt-F__ppe_willingness',
          collection: 'assignment',
        },
        ACTOR_UID,
        'csa_waive',
      );
    } catch (e) {
      err = e;
    }
    expect(err).to.not.equal(null);
    expect(String(err?.code || err?.message || '')).to.match(/invalid-argument|note is required/i);
  });

  it('rejects waive with whitespace-only note — invalid-argument', async function () {
    skipWithoutEmulator.call(this);
    await seedItem({
      collection: 'assignment',
      itemId: 'asgmt-G__ppe_willingness',
      requirementType: 'ppe_willingness',
    });
    let err: any = null;
    try {
      await applyCsaReadinessAction(
        {
          tenantId: TENANT_ID,
          itemId: 'asgmt-G__ppe_willingness',
          collection: 'assignment',
          note: '   \n  ',
        },
        ACTOR_UID,
        'csa_waive',
      );
    } catch (e) {
      err = e;
    }
    expect(err).to.not.equal(null);
    expect(String(err?.code || err?.message || '')).to.match(/invalid-argument|note is required/i);
  });
});

describe('R.3 applyCsaReadinessAction — markFailed', () => {
  afterEach(async function () {
    if (!USE_EMULATOR) return;
    await clearAll();
  });

  it('flips item to complete_fail + csa_confirmed with required note (no completedAt)', async function () {
    skipWithoutEmulator.call(this);
    const ref = await seedItem({
      collection: 'employee',
      itemId: 'wkr1__entA__handbook_acknowledgement',
      requirementType: 'handbook_acknowledgement',
      status: 'incomplete',
    });
    const result = await applyCsaReadinessAction(
      {
        tenantId: TENANT_ID,
        itemId: 'wkr1__entA__handbook_acknowledgement',
        collection: 'employee',
        note: 'worker refused to sign handbook',
      },
      ACTOR_UID,
      'csa_mark_failed',
    );
    expect(result.status).to.equal('complete_fail');
    expect(result.resolutionMethod).to.equal('csa_confirmed');
    const after = (await ref.get()).data() || {};
    expect(after.status).to.equal('complete_fail');
    expect(after.resolutionMethod).to.equal('csa_confirmed');
    expect(after.completedAt, 'complete_fail should NOT stamp completedAt').to.equal(undefined);
    const history = (after.csaActions as CsaReadinessActionsField | undefined)?.history ?? [];
    expect(history[0]?.kind).to.equal('csa_mark_failed');
    expect(history[0]?.toStatus).to.equal('complete_fail');
    expect(history[0]?.reason).to.equal('worker refused to sign handbook');
  });

  it('rejects markFailed without note', async function () {
    skipWithoutEmulator.call(this);
    await seedItem({
      collection: 'employee',
      itemId: 'wkr2__entA__handbook_acknowledgement',
      requirementType: 'handbook_acknowledgement',
    });
    let err: any = null;
    try {
      await applyCsaReadinessAction(
        {
          tenantId: TENANT_ID,
          itemId: 'wkr2__entA__handbook_acknowledgement',
          collection: 'employee',
        },
        ACTOR_UID,
        'csa_mark_failed',
      );
    } catch (e) {
      err = e;
    }
    expect(err).to.not.equal(null);
  });
});

describe('R.3 applyCsaReadinessAction — excluded types', () => {
  afterEach(async function () {
    if (!USE_EMULATOR) return;
    await clearAll();
  });

  for (const excluded of CSA_READINESS_ACTION_EXCLUDED_TYPES) {
    it(`refuses ${excluded} with failed-precondition + dedicated-callable hint`, async function () {
      skipWithoutEmulator.call(this);
      const collection: 'assignment' | 'employee' =
        excluded === 'screening_package_match' ? 'assignment' : 'employee';
      const itemId = `excluded__${excluded}`;
      await seedItem({ collection, itemId, requirementType: excluded, status: 'needs_review' });
      let err: any = null;
      try {
        await applyCsaReadinessAction(
          { tenantId: TENANT_ID, itemId, collection, note: 'should fail' },
          ACTOR_UID,
          'csa_confirm',
        );
      } catch (e) {
        err = e;
      }
      expect(err).to.not.equal(null);
      const code = String(err?.code || '');
      const msg = String(err?.message || '');
      expect(code).to.contain('failed-precondition');
      expect(msg).to.contain(excluded);
      // hint to the right surface
      if (excluded === 'e_verify') {
        expect(msg.toLowerCase()).to.contain('everify');
      } else {
        expect(msg).to.match(/setAccusourceLineAdjudication|markAccusourceBackgroundCheckCompleteOutside/);
      }
    });
  }
});

describe('R.3 applyCsaReadinessAction — input validation + missing item', () => {
  afterEach(async function () {
    if (!USE_EMULATOR) return;
    await clearAll();
  });

  it('rejects missing tenantId', async function () {
    skipWithoutEmulator.call(this);
    let err: any = null;
    try {
      await applyCsaReadinessAction(
        { tenantId: '', itemId: 'x', collection: 'assignment' },
        ACTOR_UID,
        'csa_confirm',
      );
    } catch (e) {
      err = e;
    }
    expect(err).to.not.equal(null);
    expect(String(err?.code || '')).to.contain('invalid-argument');
  });

  it('rejects unknown collection value', async function () {
    skipWithoutEmulator.call(this);
    let err: any = null;
    try {
      await applyCsaReadinessAction(
        { tenantId: TENANT_ID, itemId: 'x', collection: 'unknown' as any },
        ACTOR_UID,
        'csa_confirm',
      );
    } catch (e) {
      err = e;
    }
    expect(err).to.not.equal(null);
    expect(String(err?.code || '')).to.contain('invalid-argument');
  });

  it('rejects when item does not exist — not-found', async function () {
    skipWithoutEmulator.call(this);
    let err: any = null;
    try {
      await applyCsaReadinessAction(
        { tenantId: TENANT_ID, itemId: 'does-not-exist', collection: 'assignment' },
        ACTOR_UID,
        'csa_confirm',
      );
    } catch (e) {
      err = e;
    }
    expect(err).to.not.equal(null);
    expect(String(err?.code || '')).to.contain('not-found');
  });
});

describe('R.3 ensureReadinessCsaAdmin permission gate', () => {
  afterEach(async function () {
    if (!USE_EMULATOR) return;
    await clearAll();
  });

  it('passes for security level >= 5 in tenant scope', async function () {
    skipWithoutEmulator.call(this);
    const uid = 'r3-admin-l5';
    await db().collection('users').doc(uid).set({
      __r3test: true,
      activeTenantId: TENANT_ID,
      tenantIds: { [TENANT_ID]: { securityLevel: '5' } },
    });
    let err: any = null;
    try {
      await ensureReadinessCsaAdmin(uid, TENANT_ID);
    } catch (e) {
      err = e;
    }
    expect(err).to.equal(null);
  });

  it('passes for admin role even without securityLevel', async function () {
    skipWithoutEmulator.call(this);
    const uid = 'r3-admin-role';
    await db().collection('users').doc(uid).set({
      __r3test: true,
      role: 'admin',
    });
    let err: any = null;
    try {
      await ensureReadinessCsaAdmin(uid);
    } catch (e) {
      err = e;
    }
    expect(err).to.equal(null);
  });

  it('rejects security level 4 with permission-denied', async function () {
    skipWithoutEmulator.call(this);
    const uid = 'r3-l4';
    await db().collection('users').doc(uid).set({
      __r3test: true,
      activeTenantId: TENANT_ID,
      tenantIds: { [TENANT_ID]: { securityLevel: '4' } },
    });
    let err: any = null;
    try {
      await ensureReadinessCsaAdmin(uid, TENANT_ID);
    } catch (e) {
      err = e;
    }
    expect(err).to.not.equal(null);
    expect(String(err?.code || '')).to.contain('permission-denied');
  });

  it('rejects when user profile is missing', async function () {
    skipWithoutEmulator.call(this);
    let err: any = null;
    try {
      await ensureReadinessCsaAdmin('nonexistent-user-uid', TENANT_ID);
    } catch (e) {
      err = e;
    }
    expect(err).to.not.equal(null);
    expect(String(err?.code || '')).to.contain('permission-denied');
  });
});

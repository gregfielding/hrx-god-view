/**
 * E.7 — `csaMarkI9Section2Complete` callable tests.
 *
 * Covers the contract the unified CSA action queue depends on:
 *
 *   - Happy path (W-2 worker, valid docs) → stamps timestamp + audit
 *   - Missing tenantId / entityId / userId → invalid-argument
 *   - Empty documentTypes array → invalid-argument
 *   - No matching entity_employment row → not-found
 *   - Worker is 1099 (not w2) → failed-precondition
 *   - Caller fails canManageOnboarding → permission-denied
 *   - Idempotent (second call with stamp already present → alreadyComplete: true,
 *     no second write to ref.update)
 *
 * Mirrors `__tests__/everee/mirrorEvereeOnboardingRa2.test.ts`'s Sinon
 * stub pattern: replace `admin.firestore().collection()` so the callable's
 * single Firestore read + write is fully observable. Auth is passed
 * directly (no auth-doc lookup) by setting `token.isHRX = true` —
 * `canManageOnboardingFromClaims` short-circuits HRX claims, so we don't
 * need to stub `users/{uid}`.
 *
 * Run via the functions package's mocha pipeline.
 */

import * as admin from 'firebase-admin';
import * as sinon from 'sinon';
import { expect } from 'chai';

import { __test__csaMarkI9Section2CompleteCore as core } from '../../onboarding/csaMarkI9Section2Complete';

interface EntityEmpDocStub {
  id: string;
  data: Record<string, unknown>;
  /** Captures the merged update() payload from the callable. */
  updateCalls: Array<Record<string, unknown>>;
}

interface Harness {
  /** Mirrors what would be at tenants/{tid}/entity_employments matching userId+entityId. */
  empDoc: EntityEmpDocStub | null;
  collectionStub: sinon.SinonStub;
}

function installFirestoreStubs(
  sandbox: sinon.SinonSandbox,
  empDoc: EntityEmpDocStub | null,
): Harness {
  const docSnap = empDoc
    ? {
        id: empDoc.id,
        data: () => ({ ...empDoc.data }),
        ref: {
          update: sandbox.stub().callsFake(async (frag: Record<string, unknown>) => {
            empDoc.updateCalls.push(frag);
            // Reflect the update into the local data so an idempotent
            // second call sees the stamped state.
            Object.assign(empDoc.data, frag);
          }),
        },
      }
    : null;

  const collectionStub = sandbox.stub(admin.firestore(), 'collection');
  collectionStub.callsFake((path: string) => {
    if (path.endsWith('/entity_employments')) {
      return {
        where: () => ({
          where: () => ({
            limit: () => ({
              get: async () => ({
                empty: docSnap == null,
                docs: docSnap ? [docSnap] : [],
              }),
            }),
          }),
        }),
      } as unknown as FirebaseFirestore.CollectionReference;
    }
    throw new Error(`unexpected collection path in test: ${path}`);
  });

  return { empDoc, collectionStub };
}

const HRX_AUTH = { uid: 'csa-1', token: { isHRX: true } };
const VALID_INPUT = {
  tenantId: 'tenant-1',
  entityId: 'entity-A',
  userId: 'worker-1',
  documentTypes: ['list_b_drivers_license', 'list_c_ssn_card'],
  notes: 'Inspected DL + SSN card on 2026-04-30.',
};

describe('E.7 — csaMarkI9Section2Complete callable', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('input validation', () => {
    it('throws unauthenticated when auth is null', async () => {
      let err: unknown = null;
      try {
        await core(VALID_INPUT, null);
      } catch (e) {
        err = e;
      }
      expect(err).to.exist;
      expect((err as { code: string }).code).to.equal('unauthenticated');
    });

    it('throws invalid-argument when tenantId is missing', async () => {
      let err: unknown = null;
      try {
        await core({ ...VALID_INPUT, tenantId: '' }, HRX_AUTH);
      } catch (e) {
        err = e;
      }
      expect((err as { code: string } | null)?.code).to.equal('invalid-argument');
    });

    it('throws invalid-argument when entityId is missing', async () => {
      let err: unknown = null;
      try {
        await core({ ...VALID_INPUT, entityId: '   ' }, HRX_AUTH);
      } catch (e) {
        err = e;
      }
      expect((err as { code: string } | null)?.code).to.equal('invalid-argument');
    });

    it('throws invalid-argument when userId is missing', async () => {
      let err: unknown = null;
      try {
        await core({ ...VALID_INPUT, userId: '' }, HRX_AUTH);
      } catch (e) {
        err = e;
      }
      expect((err as { code: string } | null)?.code).to.equal('invalid-argument');
    });

    it('throws invalid-argument when documentTypes is empty', async () => {
      let err: unknown = null;
      try {
        await core({ ...VALID_INPUT, documentTypes: [] }, HRX_AUTH);
      } catch (e) {
        err = e;
      }
      expect((err as { code: string } | null)?.code).to.equal('invalid-argument');
    });

    it('throws invalid-argument when documentTypes contains only blanks', async () => {
      let err: unknown = null;
      try {
        await core({ ...VALID_INPUT, documentTypes: ['', '   '] }, HRX_AUTH);
      } catch (e) {
        err = e;
      }
      expect((err as { code: string } | null)?.code).to.equal('invalid-argument');
    });
  });

  describe('permission gate', () => {
    it('throws permission-denied when canManageOnboarding returns false', async () => {
      installFirestoreStubs(sandbox, {
        id: 'emp-1',
        data: { workerType: 'w2', userId: 'worker-1', entityId: 'entity-A' },
        updateCalls: [],
      });

      // Non-HRX, non-recruiter, security level 0 in tenantIds map. The
      // claims check fails (no token.roles + no isHRX), so the helper
      // proceeds to the user doc lookup. Stub that to deny.
      const userDocStub = sandbox.stub(admin.firestore(), 'doc').returns({
        get: async () => ({
          exists: true,
          data: () => ({
            tenantIds: { 'tenant-1': { role: 'worker', securityLevel: 0 } },
          }),
        }),
      } as unknown as FirebaseFirestore.DocumentReference);

      let err: unknown = null;
      try {
        await core(VALID_INPUT, { uid: 'worker-x', token: {} });
      } catch (e) {
        err = e;
      }
      expect((err as { code: string } | null)?.code).to.equal('permission-denied');
      sinon.assert.called(userDocStub);
    });
  });

  describe('happy path', () => {
    it('stamps i9Section2CompletedAt + audit fields on a W-2 worker', async () => {
      const empDoc: EntityEmpDocStub = {
        id: 'emp-1',
        data: { workerType: 'w2', userId: 'worker-1', entityId: 'entity-A' },
        updateCalls: [],
      };
      installFirestoreStubs(sandbox, empDoc);

      const result = await core(VALID_INPUT, HRX_AUTH);

      expect(result).to.deep.include({
        ok: true,
        alreadyComplete: false,
        entityEmploymentId: 'emp-1',
      });
      expect(empDoc.updateCalls).to.have.lengthOf(1);
      const update = empDoc.updateCalls[0];
      expect(update.i9Section2CompletedBy).to.equal('csa-1');
      expect(update.i9Section2DocumentTypes).to.deep.equal([
        'list_b_drivers_license',
        'list_c_ssn_card',
      ]);
      expect(update.i9Section2Notes).to.equal('Inspected DL + SSN card on 2026-04-30.');
      // serverTimestamp() sentinel — we can't assert the exact value but
      // it's the FieldValue type. Assert that the field was set.
      expect(update.i9Section2CompletedAt).to.exist;
      expect(update.updatedAt).to.exist;
    });

    it('stores notes as null when caller omits or sends an empty string', async () => {
      const empDoc: EntityEmpDocStub = {
        id: 'emp-1',
        data: { workerType: 'w2', userId: 'worker-1', entityId: 'entity-A' },
        updateCalls: [],
      };
      installFirestoreStubs(sandbox, empDoc);

      await core({ ...VALID_INPUT, notes: '' }, HRX_AUTH);

      expect(empDoc.updateCalls[0].i9Section2Notes).to.equal(null);
    });
  });

  describe('precondition checks', () => {
    it('throws not-found when no matching entity_employment exists', async () => {
      installFirestoreStubs(sandbox, null);

      let err: unknown = null;
      try {
        await core(VALID_INPUT, HRX_AUTH);
      } catch (e) {
        err = e;
      }
      expect((err as { code: string } | null)?.code).to.equal('not-found');
    });

    it('throws failed-precondition when worker is 1099 (contractor)', async () => {
      installFirestoreStubs(sandbox, {
        id: 'emp-1',
        data: { workerType: '1099', userId: 'worker-1', entityId: 'entity-A' },
        updateCalls: [],
      });

      let err: unknown = null;
      try {
        await core(VALID_INPUT, HRX_AUTH);
      } catch (e) {
        err = e;
      }
      expect((err as { code: string } | null)?.code).to.equal('failed-precondition');
    });

    it('treats unknown workerType as ineligible (defensive)', async () => {
      installFirestoreStubs(sandbox, {
        id: 'emp-1',
        data: { workerType: 'pending', userId: 'worker-1', entityId: 'entity-A' },
        updateCalls: [],
      });

      let err: unknown = null;
      try {
        await core(VALID_INPUT, HRX_AUTH);
      } catch (e) {
        err = e;
      }
      expect((err as { code: string } | null)?.code).to.equal('failed-precondition');
    });
  });

  describe('idempotency', () => {
    it('returns alreadyComplete: true on a second call without re-writing the audit fields', async () => {
      const empDoc: EntityEmpDocStub = {
        id: 'emp-1',
        data: { workerType: 'w2', userId: 'worker-1', entityId: 'entity-A' },
        updateCalls: [],
      };
      installFirestoreStubs(sandbox, empDoc);

      const first = await core(VALID_INPUT, HRX_AUTH);
      expect(first.alreadyComplete).to.equal(false);
      expect(empDoc.updateCalls).to.have.lengthOf(1);

      // Pretend the trigger fired and `i9Section2CompletedAt` is now set.
      // (The stub's reflect-into-state already does this from the update
      // call — but the serverTimestamp() sentinel is truthy enough to be
      // != null for the idempotency branch.)
      const second = await core(
        { ...VALID_INPUT, notes: 'attempted re-attestation by another CSA' },
        { uid: 'csa-2', token: { isHRX: true } },
      );

      expect(second).to.deep.include({
        ok: true,
        alreadyComplete: true,
        entityEmploymentId: 'emp-1',
      });
      // No second write — original audit trail preserved.
      expect(empDoc.updateCalls).to.have.lengthOf(1);
      expect(empDoc.updateCalls[0].i9Section2CompletedBy).to.equal('csa-1');
    });
  });
});

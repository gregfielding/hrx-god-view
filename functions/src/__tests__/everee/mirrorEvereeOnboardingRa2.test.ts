/**
 * RA.2 — pin the server-side mirror's per-section status writes.
 *
 * Before RA.2, `mirrorEvereeOnboardingCompleteToEmployments` only wrote
 * the lifecycle bits (`onboardingComplete`, `active`, `status`,
 * `evereeOnboardingStatus`, `payrollOnboardingCompletedAt`) on Everee
 * onboarding completion. The per-section status fields the client uses
 * to derive Action Items + Readiness chips (`payrollStatus`,
 * `taxIdentityStatus`) were left at their stale wizard values, which is
 * why workers who finished payroll onboarding in Everee still saw
 * "Payroll or tax setup open — C1 Events" on the recruiter Action Items
 * list (Bug #2 in the action-items-readiness audit).
 *
 * RA.2 added writes to `payrollStatus: 'complete'` and
 * `taxIdentityStatus: 'complete'` when the source field isn't already
 * `complete`. These tests pin both the write-when-stale and
 * skip-when-already-complete behaviors so a future revert can't quietly
 * re-introduce the bug.
 */

import * as admin from 'firebase-admin';
import * as sinon from 'sinon';
import { expect } from 'chai';

import { __test__mirrorEvereeOnboardingCompleteToEmployments as mirror } from '../../integrations/everee/evereeCallables';

interface EntityEmpDocStub {
  data: Record<string, unknown>;
  /** Captures the merged set() payload from the mirror. */
  setCalls: Array<Record<string, unknown>>;
}

interface MirrorTestHarness {
  entityEmp: EntityEmpDocStub;
  /** Strip serverTimestamp sentinels from a captured fragment for stable assertions. */
  stable: (fragment: Record<string, unknown> | undefined) => Record<string, unknown>;
}

function installFirestoreStubs(
  sandbox: sinon.SinonSandbox,
  initialEntityEmpData: Record<string, unknown>,
): MirrorTestHarness {
  const entityEmp: EntityEmpDocStub = {
    data: { ...initialEntityEmpData },
    setCalls: [],
  };

  const entityEmpDocSnap = {
    data: () => ({ ...entityEmp.data }),
    ref: {
      set: sandbox.stub().callsFake(async (frag: Record<string, unknown>, _opts: unknown) => {
        entityEmp.setCalls.push(frag);
        // Reflect the merge back into our local state so reads (the
        // alreadyComplete branch) stay coherent across calls.
        Object.assign(entityEmp.data, frag);
      }),
    },
  };

  const collectionStub = sandbox.stub(admin.firestore(), 'collection');
  collectionStub.callsFake((path: string) => {
    if (path.endsWith('/entity_employments')) {
      return {
        where: () => ({
          where: () => ({
            limit: () => ({
              get: async () => ({ docs: [entityEmpDocSnap] }),
            }),
          }),
        }),
      } as unknown as FirebaseFirestore.CollectionReference;
    }
    if (path.endsWith('/user_employments')) {
      return {
        where: () => ({
          where: () => ({
            limit: () => ({
              get: async () => ({ docs: [] }),
            }),
          }),
        }),
      } as unknown as FirebaseFirestore.CollectionReference;
    }
    return {
      where: () => ({
        where: () => ({
          limit: () => ({
            get: async () => ({ docs: [] }),
          }),
        }),
      }),
    } as unknown as FirebaseFirestore.CollectionReference;
  });

  // The W.1 work-eligibility mirror reads
  // `tenants/{t}/everee_workers/{entityId}__{userId}` to figure out the
  // worker classification. Stub it as a missing doc so the helper bails
  // out without touching `users/*`.
  const docStub = sandbox.stub(admin.firestore(), 'doc');
  docStub.callsFake(
    () =>
      ({
        get: async () => ({ exists: false, data: () => undefined }),
        update: async () => undefined,
      } as unknown as FirebaseFirestore.DocumentReference),
  );

  return {
    entityEmp,
    stable(fragment) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fragment || {})) {
        if (
          v &&
          typeof v === 'object' &&
          'isEqual' in (v as Record<string, unknown>) &&
          // serverTimestamp sentinel — opaque object, just mark it.
          typeof (v as { isEqual?: unknown }).isEqual === 'function'
        ) {
          out[k] = '__server_timestamp__';
        } else {
          out[k] = v;
        }
      }
      return out;
    },
  };
}

describe('mirrorEvereeOnboardingCompleteToEmployments — RA.2 per-section status writes', () => {
  const sandbox = sinon.createSandbox();

  beforeEach(() => {
    sandbox.stub(console, 'log');
    sandbox.stub(console, 'warn');
    sandbox.stub(console, 'info');
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('writes payrollStatus:complete + taxIdentityStatus:complete when both are stale', async () => {
    const harness = installFirestoreStubs(sandbox, {
      payrollStatus: 'in_progress',
      taxIdentityStatus: 'not_started',
      status: 'onboarding',
      employmentState: 'onboarding',
      onboardingComplete: false,
    });

    await mirror({
      tenantId: 'BCiP2bQ9CgVOCTfV6MhD',
      entityId: 'c1_events_llc',
      userId: 'u-test',
    });

    expect(harness.entityEmp.setCalls).to.have.lengthOf(1);
    const frag = harness.stable(harness.entityEmp.setCalls[0]);
    expect(frag.payrollStatus).to.equal('complete');
    expect(frag.taxIdentityStatus).to.equal('complete');
    expect(frag.evereeOnboardingStatus).to.equal('complete');
    expect(frag.onboardingComplete).to.equal(true);
    expect(frag.active).to.equal(true);
    expect(frag.status).to.equal('active');
  });

  it('SKIPS payrollStatus + taxIdentityStatus writes when already complete (idempotent — no churn on cascade re-fires)', async () => {
    const harness = installFirestoreStubs(sandbox, {
      payrollStatus: 'complete',
      taxIdentityStatus: 'complete',
      status: 'active',
      active: true,
      employmentState: 'active',
      onboardingComplete: true,
      payrollOnboardingCompletedAt: { toDate: () => new Date() },
    });

    await mirror({
      tenantId: 'BCiP2bQ9CgVOCTfV6MhD',
      entityId: 'c1_select_llc',
      userId: 'u-test',
    });

    expect(harness.entityEmp.setCalls).to.have.lengthOf(1);
    const frag = harness.entityEmp.setCalls[0];
    expect('payrollStatus' in frag).to.equal(false);
    expect('taxIdentityStatus' in frag).to.equal(false);
    // The lifecycle write still bumps `evereeOnboardingStatus` + `updatedAt`
    // unconditionally — we only suppressed the per-section status duplicates.
    expect(frag.evereeOnboardingStatus).to.equal('complete');
  });

  it('writes payrollStatus when only payrollStatus is stale (mixed-staleness case)', async () => {
    const harness = installFirestoreStubs(sandbox, {
      payrollStatus: 'in_progress',
      taxIdentityStatus: 'complete', // already complete; mirror shouldn't rewrite
      status: 'onboarding',
      employmentState: 'onboarding',
      onboardingComplete: false,
    });

    await mirror({
      tenantId: 'BCiP2bQ9CgVOCTfV6MhD',
      entityId: 'c1_events_llc',
      userId: 'u-test',
    });

    const frag = harness.entityEmp.setCalls[0];
    expect(frag.payrollStatus).to.equal('complete');
    expect('taxIdentityStatus' in frag).to.equal(false);
  });

  it('does not resurrect a terminated employment (strong terminal state wins)', async () => {
    const harness = installFirestoreStubs(sandbox, {
      payrollStatus: 'in_progress',
      taxIdentityStatus: 'in_progress',
      status: 'terminated',
      employmentState: 'terminated',
      active: false,
    });

    await mirror({
      tenantId: 'BCiP2bQ9CgVOCTfV6MhD',
      entityId: 'c1_events_llc',
      userId: 'u-test',
    });

    expect(harness.entityEmp.setCalls).to.have.lengthOf(0);
  });
});

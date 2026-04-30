/**
 * EE.5 — pin the shape of the recovery docs so they stay drop-in
 * compatible with the canonical creators.
 *
 * Why this is worth pinning
 * --------------------------
 * Pre-EE.5 there was no recovery surface at all: a deleted
 * `worker_onboarding` doc meant the worker view rendered an empty
 * checklist forever, and a deleted `everee_workers` linkage meant
 * `/c1/workers/payroll` filtered the entity out of the picker (because
 * `buildPayrollEligibleEvereeTenantIdSet` requires both an active
 * `entity_employments` row AND a matching linkage). The recovery
 * callable rehydrates both from Firestore-side sources of truth.
 *
 * The contract these tests pin is "the recovered docs must be
 * indistinguishable from organic ones to downstream consumers" — the
 * worker view, eligibility filter, employment overview hook, etc. don't
 * have a "this was recovered" branch, and they shouldn't need one.
 * Audit metadata (`recoveredAt`, `recoveredBy`, `triggeredBy.source`)
 * lives in dedicated fields so anything that DOES care can opt in
 * without affecting the consumer surface.
 */

import { expect } from 'chai';
import * as admin from 'firebase-admin';

import {
  buildEvereeWorkerLinkageRecoveryDoc,
  buildWorkerOnboardingRecoveryDoc,
} from '../../integrations/everee/evereeAdminRecreateWorkerOnboarding';
import {
  PIPELINE_STEPS,
  STEP_MILESTONES,
  buildInitialTasks,
} from '../../onboarding/workerOnboardingPipeline';

const SERVER_TS = admin.firestore.FieldValue.serverTimestamp();
const NESTED_TS = admin.firestore.Timestamp.now();

const SAMPLE_INPUT = {
  tenantId: 'BCiP2bQ9CgVOCTfV6MhD',
  userId: 'TWXMM1mOJHepmk80Qsx128w9AiS2',
  userName: 'Greg Fielding',
  entityId: 'c1_select_llc',
  entityName: 'C1 Select LLC',
  entityKey: 'select' as const,
  entityData: {
    onboardingWorkflowSteps: { i9_sent: true, w4_sent: true, payroll_invite_sent: true },
    workerType: 'W2',
    everifyRequired: true,
  },
  triggeredByUid: 'admin-uid-abc',
  nestedTimestamp: NESTED_TS,
  serverTimestamp: SERVER_TS,
};

describe('buildWorkerOnboardingRecoveryDoc (EE.5)', () => {
  describe('schema parity with the canonical creator', () => {
    it('produces a step for every PIPELINE_STEPS entry, in order', () => {
      const doc = buildWorkerOnboardingRecoveryDoc(SAMPLE_INPUT);
      expect(doc.steps).to.have.length(PIPELINE_STEPS.length);
      doc.steps.forEach((step, i) => {
        expect(step.id).to.equal(PIPELINE_STEPS[i].id);
        expect(step.title).to.equal(PIPELINE_STEPS[i].title);
        expect(step.status).to.equal('not_started');
        // Always sets updatedBy/updatedAt — Firestore rejects undefined values
        // and the canonical creator stamps these on every step.
        expect(step.updatedBy).to.equal(SAMPLE_INPUT.triggeredByUid);
        expect(step.updatedAt).to.equal(NESTED_TS);
      });
    });

    it('attaches milestones with the canonical id+label, all defaulted to incomplete', () => {
      const doc = buildWorkerOnboardingRecoveryDoc(SAMPLE_INPUT);
      const i9 = doc.steps.find((s) => s.id === 'i9');
      const forms = doc.steps.find((s) => s.id === 'onboarding_forms');
      const everee = doc.steps.find((s) => s.id === 'everee');
      // Canonical creator never attaches milestones for e_verify / background_check / drug_screen.
      const everify = doc.steps.find((s) => s.id === 'e_verify');
      const bg = doc.steps.find((s) => s.id === 'background_check');
      const drug = doc.steps.find((s) => s.id === 'drug_screen');

      expect(i9?.milestones?.map((m) => m.id)).to.deep.equal(
        STEP_MILESTONES.i9!.map((m) => m.id),
      );
      expect(forms?.milestones?.map((m) => m.id)).to.deep.equal(
        STEP_MILESTONES.onboarding_forms!.map((m) => m.id),
      );
      expect(everee?.milestones?.map((m) => m.id)).to.deep.equal(
        STEP_MILESTONES.everee!.map((m) => m.id),
      );
      expect(everify?.milestones).to.equal(undefined);
      expect(bg?.milestones).to.equal(undefined);
      expect(drug?.milestones).to.equal(undefined);

      // No partial credit on recovery — even if the worker had completed
      // milestones in the pre-deletion universe, recovery starts clean
      // and lets the live Everee API + iframe events re-flip them.
      doc.steps.forEach((step) => {
        (step.milestones ?? []).forEach((m) => {
          expect(m.completed).to.equal(false);
          // `completedAt` is optional on `StepMilestone`; cast through
          // `unknown` so the Record-style read survives strict TS without
          // implying StepMilestone has an index signature.
          expect((m as unknown as Record<string, unknown>).completedAt).to.equal(undefined);
        });
      });
    });

    it('uses computeStepApplicability (entity workflow flags drive applicability)', () => {
      const doc = buildWorkerOnboardingRecoveryDoc(SAMPLE_INPUT);
      // entity has i9_sent + w4_sent + payroll_invite_sent flags, plus
      // everifyRequired=true and workerType=W2 → matches the canonical
      // applicability table for these step ids.
      expect(doc.steps.find((s) => s.id === 'i9')?.applicability).to.equal('required');
      expect(doc.steps.find((s) => s.id === 'onboarding_forms')?.applicability).to.equal(
        'required',
      );
      expect(doc.steps.find((s) => s.id === 'everee')?.applicability).to.equal('required');
      expect(doc.steps.find((s) => s.id === 'e_verify')?.applicability).to.equal('required');
      expect(doc.steps.find((s) => s.id === 'background_check')?.applicability).to.equal(
        'not_required',
      );
      expect(doc.steps.find((s) => s.id === 'drug_screen')?.applicability).to.equal('pending');
    });

    it('writes the same initial task list as the canonical creator', () => {
      const doc = buildWorkerOnboardingRecoveryDoc(SAMPLE_INPUT);
      const expected = buildInitialTasks();
      expect(doc.tasks).to.deep.equal(expected);
    });

    it('preserves required top-level fields (tenant/user/entity context)', () => {
      const doc = buildWorkerOnboardingRecoveryDoc(SAMPLE_INPUT);
      expect(doc.tenantId).to.equal(SAMPLE_INPUT.tenantId);
      expect(doc.userId).to.equal(SAMPLE_INPUT.userId);
      expect(doc.userName).to.equal(SAMPLE_INPUT.userName);
      expect(doc.entityId).to.equal(SAMPLE_INPUT.entityId);
      expect(doc.entityName).to.equal(SAMPLE_INPUT.entityName);
      expect(doc.entityKey).to.equal(SAMPLE_INPUT.entityKey);
      expect(doc.version).to.equal(1);
    });
  });

  describe('recovery-specific divergences from the canonical creator', () => {
    it('forces status: "not_started" — recovery cannot reconstruct partial progress', () => {
      const doc = buildWorkerOnboardingRecoveryDoc(SAMPLE_INPUT);
      expect(doc.status).to.equal('not_started');
    });

    it('forces assignmentIds: [] — recovery does not re-attach to assignments', () => {
      const doc = buildWorkerOnboardingRecoveryDoc(SAMPLE_INPUT);
      expect(doc.assignmentIds).to.deep.equal([]);
    });

    it('tags triggeredBy.source as admin_recovery_recreate (auditable)', () => {
      const doc = buildWorkerOnboardingRecoveryDoc(SAMPLE_INPUT);
      expect(doc.triggeredBy.source).to.equal('admin_recovery_recreate');
      expect(doc.triggeredBy.uid).to.equal(SAMPLE_INPUT.triggeredByUid);
    });

    it('records recoveredAt + recoveredBy audit fields', () => {
      const doc = buildWorkerOnboardingRecoveryDoc(SAMPLE_INPUT);
      expect(doc.recoveredBy).to.equal(SAMPLE_INPUT.triggeredByUid);
      expect(doc.recoveredAt).to.equal(SERVER_TS);
      // `createdAt` and `updatedAt` always come from the same sentinel —
      // matches the canonical creator's behavior on first creation.
      expect(doc.createdAt).to.equal(SERVER_TS);
      expect(doc.updatedAt).to.equal(SERVER_TS);
    });
  });

  describe('entity-shape edge cases (1099, no workflow flags)', () => {
    it('drops drug_screen + I9 to not_required for 1099 contractors', () => {
      const doc = buildWorkerOnboardingRecoveryDoc({
        ...SAMPLE_INPUT,
        entityData: {
          onboardingWorkflowSteps: {},
          workerType: '1099',
          everifyRequired: false,
        },
      });
      // computeStepApplicability rules for 1099 — pinned by
      // workerOnboardingPipeline tests; double-pinned here so a future
      // refactor breaking this also fails recovery loudly.
      expect(doc.steps.find((s) => s.id === 'i9')?.applicability).to.equal('not_required');
      expect(doc.steps.find((s) => s.id === 'drug_screen')?.applicability).to.equal(
        'not_required',
      );
      expect(doc.steps.find((s) => s.id === 'e_verify')?.applicability).to.equal(
        'not_required',
      );
    });

    it('handles missing entityData (treats as empty config)', () => {
      const doc = buildWorkerOnboardingRecoveryDoc({
        ...SAMPLE_INPUT,
        entityData: undefined,
      });
      // Should not throw, and applicability falls back to the
      // computeStepApplicability defaults (no checked flags → mostly
      // not_required, with i9/e_verify/drug_screen → pending under W2).
      expect(doc.steps).to.have.length(PIPELINE_STEPS.length);
    });
  });
});

describe('buildEvereeWorkerLinkageRecoveryDoc (EE.5)', () => {
  const LINK_INPUT = {
    tenantId: 'BCiP2bQ9CgVOCTfV6MhD',
    entityId: 'c1_select_llc',
    userId: 'TWXMM1mOJHepmk80Qsx128w9AiS2',
    firebaseUid: 'TWXMM1mOJHepmk80Qsx128w9AiS2',
    evereeWorkerId: 'a39debb3-9b79-4720-a50a-4436dd3f05c0',
    evereeTenantId: '3133',
    workerType: 'employee' as const,
    triggeredByUid: 'admin-uid-abc',
    serverTimestamp: SERVER_TS,
  };

  describe('schema parity with createWorkerIfNeeded link doc', () => {
    it('uses the same key field names downstream consumers read', () => {
      // `buildPayrollEligibleEvereeTenantIdSet` reads `evereeTenantId` +
      // `evereeWorkerId` || `externalWorkerId`. We write all three so it
      // doesn't matter which the consumer happens to read.
      const doc = buildEvereeWorkerLinkageRecoveryDoc(LINK_INPUT);
      expect(doc.tenantId).to.equal(LINK_INPUT.tenantId);
      expect(doc.entityId).to.equal(LINK_INPUT.entityId);
      expect(doc.userId).to.equal(LINK_INPUT.userId);
      expect(doc.firebaseUid).to.equal(LINK_INPUT.firebaseUid);
      expect(doc.evereeTenantId).to.equal(LINK_INPUT.evereeTenantId);
      expect(doc.evereeWorkerId).to.equal(LINK_INPUT.evereeWorkerId);
      expect(doc.externalWorkerId).to.equal(LINK_INPUT.evereeWorkerId);
      expect(doc.workerType).to.equal(LINK_INPUT.workerType);
    });
  });

  describe('recovery-specific safeguards', () => {
    it('forces status: "created" — never claims onboarding completion', () => {
      // Webhook owns `onboarding_complete`. If the worker is in fact
      // already complete on Everee's side, the next webhook event or
      // the next `evereeAdminGetWorker` call will flip the status; we
      // intentionally start at the neutral default so we never overwrite
      // a real completion stamp with a recovery one.
      const doc = buildEvereeWorkerLinkageRecoveryDoc(LINK_INPUT);
      expect(doc.status).to.equal('created');
    });

    it('records recoveredAt / recoveredBy + createdAt / updatedAt audit fields', () => {
      const doc = buildEvereeWorkerLinkageRecoveryDoc(LINK_INPUT);
      expect(doc.recoveredBy).to.equal(LINK_INPUT.triggeredByUid);
      expect(doc.recoveredAt).to.equal(SERVER_TS);
      expect(doc.createdAt).to.equal(SERVER_TS);
      expect(doc.updatedAt).to.equal(SERVER_TS);
    });
  });

  describe('worker-type variants', () => {
    it('accepts contractor', () => {
      const doc = buildEvereeWorkerLinkageRecoveryDoc({
        ...LINK_INPUT,
        workerType: 'contractor',
      });
      expect(doc.workerType).to.equal('contractor');
    });
  });
});

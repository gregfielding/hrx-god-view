import type { PipelineStepRow } from '../../pages/UserProfile/components/employment-v2/employmentV2Types';
import { deriveWorkflowStepStatus, getWorkflowStepRuntimeDefinition } from '../employmentOnboardingStepRuntimeMap';

describe('deriveWorkflowStepStatus worker/admin parity (TempWorks)', () => {
  it('keeps machine status and source for both audiences; statusLabel differs', () => {
    const def = getWorkflowStepRuntimeDefinition('handbook_signed');
    expect(def).toBeTruthy();

    const pipelineSteps: PipelineStepRow[] = [
      { id: 'onboarding_forms', status: 'in_progress', title: 'Forms' } as PipelineStepRow,
    ];
    const externalOnboardingSteps = {
      handbook_acknowledgment: {
        status: 'pending_admin_verification' as const,
        externalSource: 'tempworks' as const,
      },
    };

    const baseArgs = {
      entityKey: 'workforce' as const,
      definition: def!,
      pipelineSteps,
      everifySummary: null,
      payrollAccount: null,
      backgroundChecksForEntity: [],
      entityLinkedJobOrderIds: new Set<string>(),
      allTenantWorkerChecks: [],
      externalOnboardingSteps,
      externalOnboardingWorkerType: 'w2' as const,
    };

    const admin = deriveWorkflowStepStatus({ ...baseArgs, labelAudience: 'admin' });
    const worker = deriveWorkflowStepStatus({ ...baseArgs, labelAudience: 'worker' });

    expect(admin.status).toBe(worker.status);
    expect(admin.effectiveSourceType).toBe('external_onboarding');
    expect(worker.effectiveSourceType).toBe('external_onboarding');
    expect(admin.sourceRef.externalStepKey).toBe('handbook_acknowledgment');
    expect(worker.sourceRef.externalStepKey).toBe('handbook_acknowledgment');
    expect(admin.statusLabel).toContain('C1');
    expect(worker.statusLabel.toLowerCase()).toContain('hiring');
    expect(admin.statusLabel).not.toBe(worker.statusLabel);
  });
});

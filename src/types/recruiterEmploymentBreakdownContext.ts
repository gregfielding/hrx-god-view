import type { EntityEmploymentRecord, WorkerOnboardingPipeline } from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import type { WorkerPayrollAccount } from './payroll';

/**
 * Primary entity row + pipeline + payroll account — same inputs as Employment tab checklist
 * (`employmentMinimalChecklistModel`).
 */
export type RecruiterUserEmploymentBreakdownContext = {
  entityEmployment: EntityEmploymentRecord;
  workerOnboarding: WorkerOnboardingPipeline | null;
  workerPayrollAccount: (WorkerPayrollAccount & { id: string }) | null;
};

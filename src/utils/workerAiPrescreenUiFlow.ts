import type { WorkerAiPrescreenStepId } from '../constants/workerAiPrescreenQuestions';

/** Client-only section buckets for headers + progress labels (does not affect submit). */
export type WorkerAiPrescreenUiSection = 'preferences' | 'experience' | 'reliability' | 'wrapUp' | 'job_fit';

export function prescreenUiSectionForCoreStepId(id: WorkerAiPrescreenStepId): WorkerAiPrescreenUiSection {
  if (id === 'confirm_legal_first_name') return 'preferences';
  if (id.startsWith('opening_')) return 'preferences';
  if (['work_confidence', 'motivation', 'experience_details', 'pressure_situation'].includes(id)) {
    return 'experience';
  }
  if (
    [
      'attendance_issues',
      'attendance_explanation',
      'transportation_plan',
      'backup_transportation',
      'physical_comfort',
      'drug_screen',
      'background_check',
    ].includes(id)
  ) {
    return 'reliability';
  }
  if (['supervisor_feedback', 'additional_notes'].includes(id)) return 'wrapUp';
  return 'experience';
}

export function prescreenUiSectionAtStepIndex(params: {
  stepIndex: number;
  totalSteps: number;
  coreLen: number;
  visibleCoreSteps: { id: WorkerAiPrescreenStepId }[];
}): WorkerAiPrescreenUiSection | null {
  const { stepIndex, totalSteps, coreLen, visibleCoreSteps } = params;
  if (totalSteps <= 0 || stepIndex < 0 || stepIndex >= totalSteps) return null;
  if (stepIndex < coreLen) {
    const id = visibleCoreSteps[stepIndex]?.id;
    return id ? prescreenUiSectionForCoreStepId(id) : null;
  }
  return 'job_fit';
}

export function prescreenPreviousCoreStepId(params: {
  stepIndex: number;
  coreLen: number;
  visibleCoreSteps: { id: WorkerAiPrescreenStepId }[];
}): WorkerAiPrescreenStepId | null {
  const { stepIndex, coreLen, visibleCoreSteps } = params;
  if (stepIndex <= 0 || stepIndex > coreLen) return null;
  return visibleCoreSteps[stepIndex - 1]?.id ?? null;
}

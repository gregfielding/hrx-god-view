/**
 * Onboarding pipeline progress for worker/admin UI and readiness.
 *
 * C1 product rule: E-Verify is a native, blocking part of **C1 Select** onboarding only.
 * Workforce and Events do not use E-Verify in the employment UX; `e_verify` must not
 * count toward progress or readiness for those entity keys (even if a step exists on the doc).
 */

export interface PipelineStepLike {
  id?: string;
  status?: string;
  applicability?: string;
}

/** Steps that participate in "X of Y complete" and readiness for a given entity. */
export function pipelineStepsForProgressEntity(
  steps: PipelineStepLike[],
  entityKey: string | undefined
): PipelineStepLike[] {
  const key = String(entityKey || '').toLowerCase();
  const everifyAppliesOnlyToSelect = key !== 'select';

  return steps.filter((s) => {
    const id = String(s.id || '');
    if (everifyAppliesOnlyToSelect && id === 'e_verify') return false;
    const app = s.applicability ?? 'required';
    return app !== 'not_required';
  });
}

export function countPipelineProgressForEntity(
  steps: unknown,
  entityKey: string | undefined
): { complete: number; total: number } {
  const arr = Array.isArray(steps) ? (steps as PipelineStepLike[]) : [];
  const filtered = pipelineStepsForProgressEntity(arr, entityKey);
  return {
    complete: filtered.filter((s) => s.status === 'complete').length,
    total: filtered.length,
  };
}

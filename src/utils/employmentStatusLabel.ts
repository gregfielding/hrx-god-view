/**
 * Worker-facing display labels for entity_employments.
 *
 * Backend status (entity_employments.status): onboarding | active | inactive | terminated
 * Backend workerType: w2 | 1099
 *
 * UI mapping (worker-side "My Employment" only):
 * - w2  + active → "Active Employee"
 * - 1099 + active → "Active Contractor"
 * - onboarding | inactive | terminated → same label for both worker types (e.g. "Onboarding", "Inactive", "Terminated")
 *
 * Do NOT add backend statuses like active_employee or active_contractor.
 */

export type EntityEmploymentStatus = 'onboarding' | 'active' | 'inactive' | 'terminated';
export type EntityEmploymentWorkerType = 'w2' | '1099';

const STATUS_LABEL: Record<EntityEmploymentStatus, string> = {
  onboarding: 'Onboarding',
  active: 'Active', // overridden below when workerType is known
  inactive: 'Inactive',
  terminated: 'Terminated',
};

/**
 * Returns the worker-facing label for an entity employment (status + workerType).
 * Use for "My Employment" / worker UI only. Admin UI can continue to show raw status if desired.
 */
export function getEmploymentStatusLabel(
  status: EntityEmploymentStatus | string,
  workerType?: EntityEmploymentWorkerType | string | null
): string {
  const s = status as EntityEmploymentStatus;
  if (s === 'active' && workerType) {
    const wt = String(workerType).toLowerCase();
    if (wt === '1099') return 'Active Contractor';
    if (wt === 'w2') return 'Active Employee';
  }
  return STATUS_LABEL[s] ?? status;
}

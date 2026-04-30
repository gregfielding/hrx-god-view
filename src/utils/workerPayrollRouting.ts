/**
 * Pure routing helpers for `/c1/workers/payroll` (multi-Everee-tenant picker).
 */

export type WorkerPayrollLanding =
  | { kind: 'empty' }
  | { kind: 'redirect'; evereeTenantId: string }
  | { kind: 'picker'; evereeTenantIds: string[] };

export function getWorkerPayrollLanding(
  evereeWorkerIds: Record<string, string> | null | undefined,
): WorkerPayrollLanding {
  const entries = Object.entries(evereeWorkerIds ?? {}).filter(([k, v]) => k && String(v).trim());
  if (entries.length === 0) return { kind: 'empty' };
  if (entries.length === 1) return { kind: 'redirect', evereeTenantId: entries[0][0] };
  return {
    kind: 'picker',
    evereeTenantIds: entries.map(([tid]) => tid),
  };
}

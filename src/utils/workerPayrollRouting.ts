/**
 * Pure routing helpers for `/c1/workers/payroll` (multi-Everee-tenant picker).
 */

export type WorkerPayrollLanding =
  | { kind: 'empty' }
  | { kind: 'picker'; evereeTenantIds: string[] };

export function getWorkerPayrollLanding(
  evereeWorkerIds: Record<string, string> | null | undefined,
): WorkerPayrollLanding {
  const entries = Object.entries(evereeWorkerIds ?? {}).filter(([k, v]) => k && String(v).trim());
  if (entries.length === 0) return { kind: 'empty' };
  // 2026-08-28 (Payroll-hub IA): single-employer workers used to be
  // auto-redirected into the entity page, which would now skip the hub
  // (recent pay, direct deposit, tax-form rows). Everyone gets the hub.
  return {
    kind: 'picker',
    evereeTenantIds: entries.map(([tid]) => tid),
  };
}

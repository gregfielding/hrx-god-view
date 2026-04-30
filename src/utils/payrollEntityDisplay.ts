/**
 * Worker-facing labels for payroll entity cards on the C1 worker `/payroll`
 * picker. Keep in sync with `functions/src/integrations/everee/evereeEntityWorkerType.ts`
 * — both decide W-2 vs contractor classification from the same fields and
 * fall back to the C1 Events product lock when nothing else is set.
 */

export type PayrollWorkerKind = 'employee' | 'contractor';

export interface ResolvePayrollWorkerKindArgs {
  /** `tenants/{tid}/entities/{entityId}` doc id (e.g. `c1_events_llc`). */
  entityId?: string | null;
  /** Explicit Everee classification override on the entity doc. */
  evereeWorkerKind?: unknown;
  /** Legacy classification field; treated as a fallback before `workerType`. */
  payrollWorkerClassification?: unknown;
  /** HRX entity-level worker type (often `"W2"` / `"1099"`). */
  workerType?: unknown;
}

/** Mirrors `resolveEvereeWorkerTypeForOnCall` server-side; defaults to W-2. */
export function resolvePayrollWorkerKind(args: ResolvePayrollWorkerKindArgs): PayrollWorkerKind {
  const candidates = [args.evereeWorkerKind, args.payrollWorkerClassification, args.workerType];
  for (const c of candidates) {
    if (typeof c !== 'string') continue;
    const s = c.trim().toLowerCase();
    if (!s) continue;
    if (s === 'contractor' || s === '1099') return 'contractor';
    if (s === 'employee' || s === 'w2' || s === 'w-2') return 'employee';
  }
  if ((args.entityId || '').trim().toLowerCase() === 'c1_events_llc') return 'contractor';
  return 'employee';
}

/** Worker-facing description shown beneath the entity name on the payroll picker. */
export function payrollEntityDescription(kind: PayrollWorkerKind): string {
  return kind === 'contractor'
    ? 'Gig work for Independent Contractors'
    : 'W-2 Employees with regular weekly payroll';
}

/**
 * Decide Everee API worker classification (employee vs contractor) from the
 * hiring entity. C1 Events is always 1099/contractor per product locks.
 */

export function resolveEvereeWorkerTypeForOnCall(
  entityId: string,
  entityDoc: Record<string, unknown>,
): 'employee' | 'contractor' {
  const kind = entityDoc.evereeWorkerKind ?? entityDoc.payrollWorkerClassification;
  const s = typeof kind === 'string' ? kind.trim().toLowerCase() : '';
  if (s === 'contractor' || s === '1099') return 'contractor';
  if (s === 'employee' || s === 'w2' || s === 'w-2') return 'employee';
  if (entityId === 'c1_events_llc') return 'contractor';
  return 'employee';
}

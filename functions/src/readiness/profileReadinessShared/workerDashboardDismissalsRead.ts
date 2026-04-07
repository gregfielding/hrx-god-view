export function readDismissedWorkerDashboardActionIds(userDoc: Record<string, unknown> | null | undefined): Set<string> {
  const set = new Set<string>();
  if (!userDoc || typeof userDoc !== 'object') return set;
  const dashboard = (userDoc.workerProfile as Record<string, unknown> | undefined)?.dashboard as
    | Record<string, unknown>
    | undefined;
  const dismissed = (dashboard?.dismissedActionItems || {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(dismissed)) {
    if (v === true || v === 'true') set.add(k);
  }
  return set;
}

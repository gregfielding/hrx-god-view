/**
 * Canonical assignment statuses (functions). Keep in sync with src/utils/assignmentStatusNormalize.ts.
 */
export type AssignmentStatusCanonical = 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';

const LEGACY_TO_CANONICAL: Record<string, AssignmentStatusCanonical> = {
  proposed: 'pending',
  pending: 'pending',
  confirmed: 'confirmed',
  active: 'in_progress',
  in_progress: 'in_progress',
  completed: 'completed',
  ended: 'completed',
  declined: 'cancelled',
  canceled: 'cancelled',
  cancelled: 'cancelled',
  // Worker-initiated pull-out ("I can no longer work" / cancel application).
  // Distinct raw status so the jobs board can offer "Re-apply to Shift",
  // but canonically terminal (treated as cancelled everywhere else).
  'worker-cancelled': 'cancelled',
  worker_cancelled: 'cancelled',
};

export function normalizeAssignmentStatus(raw: string | null | undefined): AssignmentStatusCanonical {
  const k = String(raw || '')
    .trim()
    .toLowerCase();
  return LEGACY_TO_CANONICAL[k] ?? 'pending';
}

export function isAssignmentTerminalNormalized(raw: string | null | undefined): boolean {
  const n = normalizeAssignmentStatus(raw);
  return n === 'completed' || n === 'cancelled';
}

export const ASSIGNMENT_STATUS_QUERY_LIVE: readonly string[] = [
  'pending',
  'proposed',
  'confirmed',
  'in_progress',
  'active',
];

/**
 * Canonical assignment statuses for HRX. Legacy Firestore values are normalized on read.
 * Writes from new code should use only the canonical set.
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

/** Normalize any stored status string to the canonical five-value model. */
export function normalizeAssignmentStatus(raw: string | null | undefined): AssignmentStatusCanonical {
  const k = String(raw || '')
    .trim()
    .toLowerCase();
  return LEGACY_TO_CANONICAL[k] ?? 'pending';
}

/** True if assignment should not be treated as “current” for staffing / primary pick. */
export function isAssignmentTerminalNormalized(raw: string | null | undefined): boolean {
  const n = normalizeAssignmentStatus(raw);
  return n === 'completed' || n === 'cancelled';
}

/** Firestore queries: match both legacy and canonical “live” statuses during migration. */
export const ASSIGNMENT_STATUS_QUERY_LIVE: readonly string[] = [
  'pending',
  'proposed',
  'confirmed',
  'in_progress',
  'active',
];

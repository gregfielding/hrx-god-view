/**
 * Sprint 4: duplicate application consolidation policy (pure logic).
 * Keep in sync with `functions/src/utils/applicationConsolidationPolicy.ts`.
 *
 * Rules (locked):
 * - Auto-merge only on strong key: same non-empty userId + same jobOrderId (pair scope).
 * - Email + jobOrderId auto-merge only if allowEmailFallbackMerge AND both userIds empty AND same normalized email.
 * - No auto-merge on name-only, phone-only, or fuzzy similarity — requires_review.
 * - One-sided userId vs missing / email-only ambiguous → requires_review.
 * - PR2 winner: if both identities set `storage` to tenant vs nested, tenant always wins; else createdAt/docId (see suggestWinnerLosersForPair).
 * - Deterministic `clusterId`: `src/utils/applicationConsolidationClusterId.ts`.
 *
 * @see docs/APPLICATION_SPRINT4_EXECUTION.md
 */

export type CandidateDocIdentity = {
  docId: string;
  /** When set for both sides, tenant storage always wins over nested (PR2 lock). */
  storage?: 'tenant' | 'nested' | null;
  userId?: string | null;
  emailRaw?: string | null;
  phoneRaw?: string | null;
  candidateFirstName?: string | null;
  candidateLastName?: string | null;
  createdAtMs?: number | null;
};

export type ClassifyPairOptions = {
  /** Explicit opt-in for email+jobOrderId path (tenant-approved / scripted only). */
  allowEmailFallbackMerge?: boolean;
  /** If set, never auto-merge; human review (name/phone/fuzzy signals). */
  weakSignal?: 'name_only' | 'phone_only' | 'fuzzy';
};

export type ConsolidationClassification =
  | {
      outcome: 'auto_merge';
      basis: 'userId_jobOrderId' | 'email_jobOrderId';
      suggestedWinnerId: string;
      suggestedLoserIds: string[];
      matchBasis: string;
    }
  | {
      outcome: 'requires_review';
      reason: string;
      matchBasis: string;
      suggestedWinnerId: string | null;
      suggestedLoserIds: string[];
    };

const EMAIL_MAX = 320;

/** Lowercase + trim; returns null if empty or invalid-looking. */
export function normalizeConsolidationEmail(raw: string | null | undefined): string | null {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!s || s.length > EMAIL_MAX) return null;
  if (!s.includes('@')) return null;
  return s;
}

function trimUserId(raw: string | null | undefined): string {
  return String(raw ?? '').trim();
}

function displayNameFromCandidate(d: CandidateDocIdentity): string | null {
  const a = String(d.candidateFirstName ?? '').trim();
  const b = String(d.candidateLastName ?? '').trim();
  const full = `${a} ${b}`.trim();
  return full || null;
}

/**
 * Winner selection (PR2):
 * - If both `storage` values are set and one is tenant and one is nested → tenant doc always wins.
 * - Otherwise (same storage, or either storage missing) → newer createdAt wins; tie-breaker: lexicographic docId.
 */
export function suggestWinnerLosersForPair(
  a: CandidateDocIdentity,
  b: CandidateDocIdentity
): { suggestedWinnerId: string; suggestedLoserIds: string[] } {
  const sa = a.storage ?? null;
  const sb = b.storage ?? null;
  if (sa === 'tenant' && sb === 'nested') {
    return { suggestedWinnerId: a.docId, suggestedLoserIds: [b.docId] };
  }
  if (sa === 'nested' && sb === 'tenant') {
    return { suggestedWinnerId: b.docId, suggestedLoserIds: [a.docId] };
  }

  const aT = a.createdAtMs ?? 0;
  const bT = b.createdAtMs ?? 0;
  if (aT > bT || (aT === bT && a.docId >= b.docId)) {
    return { suggestedWinnerId: a.docId, suggestedLoserIds: [b.docId] };
  }
  return { suggestedWinnerId: b.docId, suggestedLoserIds: [a.docId] };
}

/**
 * Classify a pair of application docs under the same jobOrderId.
 */
export function classifyPairMerge(
  jobOrderId: string,
  docA: CandidateDocIdentity,
  docB: CandidateDocIdentity,
  options: ClassifyPairOptions = {}
): ConsolidationClassification {
  const jo = String(jobOrderId ?? '').trim();
  if (!jo) {
    return {
      outcome: 'requires_review',
      reason: 'missing_job_order_id',
      matchBasis: 'invalid',
      suggestedWinnerId: null,
      suggestedLoserIds: [docA.docId, docB.docId].sort(),
    };
  }

  if (docA.docId === docB.docId) {
    return {
      outcome: 'requires_review',
      reason: 'same_document_id',
      matchBasis: 'none',
      suggestedWinnerId: docA.docId,
      suggestedLoserIds: [],
    };
  }

  if (options.weakSignal) {
    const { suggestedWinnerId, suggestedLoserIds } = suggestWinnerLosersForPair(docA, docB);
    return {
      outcome: 'requires_review',
      reason: `weak_signal_${options.weakSignal}`,
      matchBasis: options.weakSignal,
      suggestedWinnerId,
      suggestedLoserIds,
    };
  }

  const uidA = trimUserId(docA.userId);
  const uidB = trimUserId(docB.userId);
  const emailA = normalizeConsolidationEmail(docA.emailRaw);
  const emailB = normalizeConsolidationEmail(docB.emailRaw);

  // Strong key: both have same userId
  if (uidA && uidB && uidA === uidB) {
    const { suggestedWinnerId, suggestedLoserIds } = suggestWinnerLosersForPair(docA, docB);
    return {
      outcome: 'auto_merge',
      basis: 'userId_jobOrderId',
      suggestedWinnerId,
      suggestedLoserIds,
      matchBasis: 'userId_jobOrderId',
    };
  }

  // One has userId, other does not (or different uid) — never auto-merge on email alone here
  if ((uidA && !uidB) || (!uidA && uidB) || (uidA && uidB && uidA !== uidB)) {
    const { suggestedWinnerId, suggestedLoserIds } = suggestWinnerLosersForPair(docA, docB);
    return {
      outcome: 'requires_review',
      reason:
        uidA && uidB && uidA !== uidB ? 'conflicting_user_ids' : 'asymmetric_or_missing_user_id',
      matchBasis: 'ambiguous_identity',
      suggestedWinnerId,
      suggestedLoserIds,
    };
  }

  // Both userIds empty: gated email fallback only
  if (options.allowEmailFallbackMerge && emailA && emailB && emailA === emailB) {
    const { suggestedWinnerId, suggestedLoserIds } = suggestWinnerLosersForPair(docA, docB);
    return {
      outcome: 'auto_merge',
      basis: 'email_jobOrderId',
      suggestedWinnerId,
      suggestedLoserIds,
      matchBasis: 'email_jobOrderId',
    };
  }

  // Name / phone hints without strong key — review (do not auto-merge)
  const nameA = displayNameFromCandidate(docA);
  const nameB = displayNameFromCandidate(docB);
  const phoneA = String(docA.phoneRaw ?? '').trim();
  const phoneB = String(docB.phoneRaw ?? '').trim();
  if (nameA && nameB && nameA.toLowerCase() === nameB.toLowerCase() && !emailA && !emailB) {
    const { suggestedWinnerId, suggestedLoserIds } = suggestWinnerLosersForPair(docA, docB);
    return {
      outcome: 'requires_review',
      reason: 'name_only_insufficient',
      matchBasis: 'name_only',
      suggestedWinnerId,
      suggestedLoserIds,
    };
  }
  if (phoneA && phoneB && phoneA === phoneB && !emailA && !emailB) {
    const { suggestedWinnerId, suggestedLoserIds } = suggestWinnerLosersForPair(docA, docB);
    return {
      outcome: 'requires_review',
      reason: 'phone_only_insufficient',
      matchBasis: 'phone_only',
      suggestedWinnerId,
      suggestedLoserIds,
    };
  }

  const { suggestedWinnerId, suggestedLoserIds } = suggestWinnerLosersForPair(docA, docB);
  return {
    outcome: 'requires_review',
    reason: 'insufficient_identity_signal',
    matchBasis: 'none',
    suggestedWinnerId,
    suggestedLoserIds,
  };
}

/**
 * Duplicate application consolidation policy — mirror of `src/utils/applicationConsolidationPolicy.ts`.
 * Functions package cannot import `../src`; keep in sync manually.
 *
 * @see docs/APPLICATION_SPRINT4_EXECUTION.md
 */

export type CandidateDocIdentity = {
  docId: string;
  storage?: 'tenant' | 'nested' | null;
  userId?: string | null;
  emailRaw?: string | null;
  phoneRaw?: string | null;
  candidateFirstName?: string | null;
  candidateLastName?: string | null;
  createdAtMs?: number | null;
};

export type ClassifyPairOptions = {
  allowEmailFallbackMerge?: boolean;
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

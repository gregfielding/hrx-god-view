import type { Timestamp } from 'firebase/firestore';
import type {
  AccusourceLineAdjudication,
  AccusourceLineVerdict,
  BackgroundCheckRecord,
  ServiceOrderStatusEntry,
} from '../types/backgroundCheck';

export type AccusourceScreeningLineItem = {
  id: string;
  name: string;
  type?: string;
  status: string;
  /** Set when AccuSource has reported `service_status_change` for this line. */
  updatedAt?: Timestamp | null;
  providerPrice?: number | null;
  providerPriceFormatted?: string | null;
  jurisdiction?: string | null;
  assignmentLabel?: string | null;
  orderedAt?: Timestamp | null;
  submittedAt?: Timestamp | null;
  startedAt?: Timestamp | null;
  completedAt?: Timestamp | null;
  receivedAt?: Timestamp | null;
  reviewedAt?: Timestamp | null;
  providerReportedAt?: Timestamp | null;
  reportUrl?: string | null;
  decision?: string | null;
  decisionAt?: Timestamp | null;
  /** Drug-screen / lab context from webhooks (only populated for lab service lines). */
  providerOrderId?: string | number | null;
  providerRegistrationId?: string | number | null;
  labName?: string | null;
  labCode?: number | null;
  labShortDescription?: string | null;
  labLongDescription?: string | null;
  /**
   * True when the UI should treat `completedAt` as inherited from `updatedAt` (vendor didn't send
   * a dedicated `completion_date` but the line status is a completion synonym). Lets the
   * Lifecycle block label the timestamp "Completed" instead of "Line updated".
   */
  completedAtDerived?: boolean;
  /** True when `orderedAt` was inherited from the parent record's `createdAt`. */
  orderedAtDerived?: boolean;
  /** Raw adjudication doc from Firestore (auto + override + history). */
  adjudication?: AccusourceLineAdjudication | null;
  /** Effective verdict = manual override if set, else autoVerdict, else 'PENDING'. */
  verdict: AccusourceLineVerdict;
  /** True when `verdict` reflects a manual recruiter override. */
  verdictOverridden: boolean;
};

/** Effective verdict — manual override wins when set. Exported for header aggregate. */
export function resolveEffectiveVerdict(
  adjudication: AccusourceLineAdjudication | null | undefined,
): AccusourceLineVerdict {
  if (!adjudication) return 'PENDING';
  if (adjudication.verdict != null) return adjudication.verdict;
  return adjudication.autoVerdict ?? 'PENDING';
}

/** Status synonyms we treat as a "completed" per-item line. Kept loose to match vendor variation. */
function statusLooksComplete(status: string | null | undefined): boolean {
  if (status == null) return false;
  const s = String(status).toLowerCase();
  return s.includes('complete') || s.includes('closed') || s === 'pass' || s.includes('clear');
}

/**
 * One row per ordered catalog screen: name + webhook status (or Pending until AccuSource reports).
 */
export function accusourceScreeningLineItems(r: BackgroundCheckRecord): AccusourceScreeningLineItem[] {
  const byId = (r.providerServiceOrderStatus ?? {}) as Record<string, ServiceOrderStatusEntry>;
  const catalog = Array.isArray(r.requestedServicesCatalog) ? r.requestedServicesCatalog : [];
  const idsFromReq = Array.isArray(r.requestedServices) ? r.requestedServices.map(String) : [];

  const parentCreatedAt = r.createdAt ?? null;

  function buildLine(
    id: string,
    name: string,
    entry: ServiceOrderStatusEntry | undefined,
    type?: string,
  ): AccusourceScreeningLineItem {
    const status = String(entry?.status ?? '').trim() || 'Pending';
    // Fallback 1: inherit `orderedAt` from the parent record's `createdAt` when the vendor didn't
    // send a per-line order date (common for Sodexo Basic Package — only `updated_at` comes back).
    const rawOrderedAt = entry?.orderedAt ?? null;
    const orderedAt = rawOrderedAt ?? parentCreatedAt;
    const orderedAtDerived = rawOrderedAt == null && parentCreatedAt != null;
    // Fallback 2: treat `updatedAt` as `completedAt` when status indicates completion and the
    // vendor never sent a dedicated `completion_date`.
    const rawCompletedAt = entry?.completedAt ?? null;
    const derivedCompletedAt =
      rawCompletedAt == null && statusLooksComplete(status) ? entry?.updatedAt ?? null : null;
    const completedAt = rawCompletedAt ?? derivedCompletedAt;
    const completedAtDerived = rawCompletedAt == null && derivedCompletedAt != null;
    const adjudication = entry?.adjudication ?? null;
    const verdict = resolveEffectiveVerdict(adjudication);
    const verdictOverridden = adjudication != null && adjudication.verdict != null;
    return {
      id,
      name,
      type,
      status,
      updatedAt: entry?.updatedAt ?? null,
      providerPrice: entry?.providerPrice ?? null,
      providerPriceFormatted: entry?.providerPriceFormatted ?? null,
      jurisdiction: entry?.jurisdiction ?? null,
      assignmentLabel: entry?.assignmentLabel ?? null,
      orderedAt,
      orderedAtDerived,
      submittedAt: entry?.submittedAt ?? null,
      startedAt: entry?.startedAt ?? null,
      completedAt,
      completedAtDerived,
      receivedAt: entry?.receivedAt ?? null,
      reviewedAt: entry?.reviewedAt ?? null,
      providerReportedAt: entry?.providerReportedAt ?? null,
      reportUrl: entry?.reportUrl ?? null,
      decision: entry?.decision ?? null,
      decisionAt: entry?.decisionAt ?? null,
      providerOrderId:
        entry?.providerOrderId != null
          ? (entry.providerOrderId as string | number)
          : null,
      providerRegistrationId:
        entry?.providerRegistrationId != null
          ? (entry.providerRegistrationId as string | number)
          : null,
      labName: entry?.labName ?? null,
      labCode: entry?.labCode ?? null,
      labShortDescription: entry?.labShortDescription ?? null,
      labLongDescription: entry?.labLongDescription ?? null,
      adjudication,
      verdict,
      verdictOverridden,
    };
  }

  if (catalog.length > 0) {
    return catalog.map((s) => {
      const id = String(s.id).trim();
      const entry = byId[id];
      const name = String(s.name || '').trim() || id;
      const type = s.type != null ? String(s.type).trim() : undefined;
      return buildLine(id, name, entry, type);
    });
  }

  const ids = idsFromReq.length > 0 ? idsFromReq : Object.keys(byId);
  if (ids.length === 0) return [];

  return ids.map((id) => {
    const entry = byId[id];
    const name = String(entry?.serviceName ?? '').trim() || id;
    return buildLine(id, name, entry, undefined);
  });
}

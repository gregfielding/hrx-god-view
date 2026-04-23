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
 *
 * Rows are unioned across every available source so any service seen by ANY source renders:
 *   1. `requestedServicesCatalog` (ordered list with names + types; source-of-truth for row order).
 *   2. `requestedServices` (list of ids; fills in when catalog entries are missing names).
 *   3. `providerServiceOrderStatus` nested map (correct post-fix webhook format).
 *   4. Legacy top-level dotted fields like `providerServiceOrderStatus.68206` from the pre-fix
 *      bug where `set({ merge: true })` stored dot-notation literally instead of nested. Those
 *      don't show up in the typed `providerServiceOrderStatus` map on read, so we rescue them
 *      defensively without requiring a backfill to have run first.
 *
 * Downstream, `buildLine(id, ...)` resolves display name from (catalog entry) → (entry.serviceName)
 * → id, so rows that exist only in the status map still get a human name when the webhook
 * included `service_name`.
 */
export function accusourceScreeningLineItems(r: BackgroundCheckRecord): AccusourceScreeningLineItem[] {
  const byId: Record<string, ServiceOrderStatusEntry> = {
    ...((r.providerServiceOrderStatus ?? {}) as Record<string, ServiceOrderStatusEntry>),
  };

  // Rescue legacy literal dotted fields (e.g. `providerServiceOrderStatus.68206`) that Firestore
  // surfaces as top-level keys rather than nested-map entries. The nested map wins when both exist.
  const recordAsRecord = r as unknown as Record<string, unknown>;
  for (const key of Object.keys(recordAsRecord)) {
    if (!key.startsWith('providerServiceOrderStatus.')) continue;
    const legacyId = key.slice('providerServiceOrderStatus.'.length);
    if (!legacyId) continue;
    if (byId[legacyId]) continue; // nested map already has this id
    const value = recordAsRecord[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      byId[legacyId] = value as ServiceOrderStatusEntry;
    }
  }

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

  // Build the ordered id list as a union of every source so a service that appears in ANY of
  // them renders as its own row. Preserve catalog order first (most human-sensible), then append
  // ids from `requestedServices`, then any remaining ids that only exist in the status map.
  type SeedEntry = { id: string; name?: string; type?: string };
  const seeds: SeedEntry[] = [];
  const seen = new Set<string>();

  for (const s of catalog) {
    const id = String(s.id ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    seeds.push({
      id,
      name: s.name != null ? String(s.name).trim() : undefined,
      type: s.type != null ? String(s.type).trim() : undefined,
    });
  }

  for (const id of idsFromReq) {
    const trimmed = String(id ?? '').trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    seeds.push({ id: trimmed });
  }

  for (const id of Object.keys(byId)) {
    const trimmed = String(id ?? '').trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    seeds.push({ id: trimmed });
  }

  if (seeds.length === 0) return [];

  // Detect the backend's generic fallback name `Order <id>` (used when the webhook included no
  // service_id / service_name, e.g. for per-county criminal searches). When we recognize that
  // pattern and the webhook carried a jurisdiction, compose a more informative label so two
  // otherwise-identical rows don't read as "Order 8534895" / "Order 8534896".
  const genericOrderLabel = /^order\s+\S+$/i;

  const rawLines = seeds.map(({ id, name, type }) => {
    const entry = byId[id];
    const catalogName = name && name.length > 0 ? name : '';
    const webhookName = entry?.serviceName != null ? String(entry.serviceName).trim() : '';
    const jurisdiction = entry?.jurisdiction != null ? String(entry.jurisdiction).trim() : '';

    let resolvedName: string;
    if (catalogName) {
      // Catalog name wins; it came from the order-creation request and is the canonical label.
      resolvedName = catalogName;
    } else if (webhookName && !genericOrderLabel.test(webhookName)) {
      resolvedName = webhookName;
    } else if (jurisdiction) {
      // Either no stored name or a generic `Order <id>` — surface the jurisdiction so recruiters
      // can still tell per-county rows apart. Prefix with webhookName when we have it so the
      // order id stays visible alongside the location.
      resolvedName = webhookName ? `${webhookName} — ${jurisdiction}` : jurisdiction;
    } else {
      resolvedName = webhookName || id;
    }

    return buildLine(id, resolvedName, entry, type);
  });

  // Collapse duplicate `order:<id>` rows that are really the SAME logical service already
  // represented by a named (service_id-keyed) row. AccuSource emits `service_status_change`
  // (keyed here by `<service_id>`) AND `order_status_change` (keyed `order:<order_id>`) for
  // every named service; the backend persists both since there's no explicit linkage in the
  // webhook payload. Named rows win; we suppress any `order:*` row whose status + updatedAt
  // lines up with a named row within a 90s window.
  //
  // Drug-lab rows (labName / labCode present) and rows that carry jurisdiction info are NEVER
  // suppressed — those are real per-line services (per-county criminal, drug screens) that
  // AccuSource doesn't mirror via service_status_change.
  const ORDER_KEY_PREFIX = 'order:';
  const DEDUP_WINDOW_MS = 90 * 1000;

  function entryUpdatedAtMs(line: AccusourceScreeningLineItem): number | null {
    const sources: Array<Timestamp | null | undefined> = [
      line.updatedAt,
      line.completedAt,
      line.providerReportedAt,
    ];
    for (const src of sources) {
      if (src == null) continue;
      try {
        return src.toDate().getTime();
      } catch {
        // fall through to next source
      }
    }
    return null;
  }

  const namedRows = rawLines.filter((l) => !l.id.startsWith(ORDER_KEY_PREFIX));
  const orderRows = rawLines.filter((l) => l.id.startsWith(ORDER_KEY_PREFIX));

  const keptOrderRows = orderRows.filter((orderRow) => {
    // Preserve rows that carry information the named rows don't: lab context or jurisdiction.
    const hasLabContext =
      orderRow.labName != null ||
      orderRow.labCode != null ||
      orderRow.providerRegistrationId != null;
    if (hasLabContext) return true;
    const hasJurisdiction =
      orderRow.jurisdiction != null && String(orderRow.jurisdiction).trim() !== '';
    if (hasJurisdiction) return true;

    const orderStatus = orderRow.status.toLowerCase();
    const orderTs = entryUpdatedAtMs(orderRow);
    if (orderTs == null) return true; // can't time-correlate — keep it to be safe

    // Suppress if any named row shares the status + is within the dedup window.
    const duplicate = namedRows.some((named) => {
      if (named.status.toLowerCase() !== orderStatus) return false;
      const namedTs = entryUpdatedAtMs(named);
      if (namedTs == null) return false;
      return Math.abs(namedTs - orderTs) <= DEDUP_WINDOW_MS;
    });
    return !duplicate;
  });

  return [...namedRows, ...keptOrderRows];
}

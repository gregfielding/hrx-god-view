import type { ActionItem, ActionItemType, ActionSeverity } from '../../types/actionItems';

const SEVERITY_RANK: Record<ActionSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const BLOCKING_RANK: Record<ActionItem['blocking'], number> = {
  hard: 0,
  soft: 1,
  informational: 2,
};

/** Specific types win over generic onboarding for the same entity prefix. */
const GENERIC_ONBOARDING = 'onboarding_incomplete_entity';

function specificityRank(t: ActionItem['type']): number {
  if (t === 'i9_incomplete' || t === 'everify_action_required') return 0;
  if (t.startsWith('everify_')) return 1;
  if (t === 'payroll_or_tax_or_deposit_incomplete') return 2;
  if (
    t === 'background_review_required' ||
    t === 'background_pending' ||
    t === 'cert_required_missing' ||
    t === 'missing_certification' ||
    t === 'certification_pending_review' ||
    t === 'certification_rejected' ||
    t === 'certification_expired' ||
    t === 'certification_attested_only' ||
    t === 'certification_expiring_soon' ||
    t === 'certification_preferred_unmet'
  ) {
    return 3;
  }
  if (t === GENERIC_ONBOARDING) return 5;
  return 4;
}

/**
 * Recruiter display order: live assignment → entity path → interview → compliance → watchouts → profile polish.
 */
function displayTier(t: ActionItemType): number {
  switch (t) {
    case 'assignment_readiness_blocked':
    case 'assignment_action_required':
      return 0;
    case 'onboarding_incomplete_entity':
    case 'payroll_or_tax_or_deposit_incomplete':
      return 1;
    case 'interview_missing':
      return 2;
    case 'i9_incomplete':
    case 'everify_not_started':
    case 'everify_pending':
    case 'everify_action_required':
    case 'background_pending':
    case 'background_review_required':
    case 'cert_required_missing':
    case 'missing_certification':
    case 'certification_pending_review':
    case 'certification_rejected':
    case 'certification_expired':
    case 'certification_attested_only':
    case 'certification_expiring_soon':
    case 'certification_preferred_unmet':
      return 3;
    case 'risk_watchout':
    case 'score_review_recommended':
    case 'score_auto_advance_blocked':
      return 4;
    case 'phone_verification_required':
      return 5;
    default:
      return 50;
  }
}

/**
 * Merge items that share the same dedupeKey — keep the strongest by severity, blocking, specificity.
 */
export function dedupeActionItems(items: ActionItem[]): ActionItem[] {
  const byKey = new Map<string, ActionItem>();

  for (const item of items) {
    const existing = byKey.get(item.dedupeKey);
    if (!existing) {
      byKey.set(item.dedupeKey, item);
      continue;
    }

    const win =
      BLOCKING_RANK[item.blocking] < BLOCKING_RANK[existing.blocking]
        ? item
        : BLOCKING_RANK[item.blocking] > BLOCKING_RANK[existing.blocking]
          ? existing
          : SEVERITY_RANK[item.severity] < SEVERITY_RANK[existing.severity]
            ? item
            : SEVERITY_RANK[item.severity] > SEVERITY_RANK[existing.severity]
              ? existing
              : specificityRank(item.type) < specificityRank(existing.type)
                ? item
                : item.priority < existing.priority
                  ? item
                  : existing;

    byKey.set(item.dedupeKey, win);
  }

  /** Cross-key suppression: if I-9 or E-Verify action exists for entity, drop generic onboarding for same entity. */
  const entityI9 = new Set<string>();
  const entityEv = new Set<string>();
  byKey.forEach((v) => {
    if (v.type === 'i9_incomplete' && v.scope.kind === 'entity') entityI9.add(v.scope.entityId);
    if (v.type === 'everify_action_required' && v.scope.kind === 'entity') entityEv.add(v.scope.entityId);
  });

  const toDelete = new Set<string>();
  byKey.forEach((v, k) => {
    if (v.type !== GENERIC_ONBOARDING || v.scope.kind !== 'entity') return;
    const id = v.scope.entityId;
    if (entityI9.has(id) || entityEv.has(id)) toDelete.add(k);
  });
  toDelete.forEach((k) => byKey.delete(k));

  /** If payroll/tax is already called out for an entity, drop generic “onboarding open” for that entity. */
  const entityPayroll = new Set<string>();
  byKey.forEach((v) => {
    if (v.type === 'payroll_or_tax_or_deposit_incomplete' && v.scope.kind === 'entity') {
      entityPayroll.add(String(v.scope.entityId).toLowerCase());
    }
  });
  const dropGenericForPayroll = new Set<string>();
  byKey.forEach((v, k) => {
    if (v.type !== GENERIC_ONBOARDING || v.scope.kind !== 'entity') return;
    const id = String(v.scope.entityId).toLowerCase();
    if (entityPayroll.has(id)) dropGenericForPayroll.add(k);
  });
  dropGenericForPayroll.forEach((k) => byKey.delete(k));

  /** background_review beats background_pending for same id */
  const bgReview = new Set<string>();
  byKey.forEach((v) => {
    if (v.type === 'background_review_required' && v.sourceId) bgReview.add(v.sourceId);
  });
  const bgDel = new Set<string>();
  byKey.forEach((v, k) => {
    if (v.type === 'background_pending' && bgReview.has(v.sourceId)) bgDel.add(k);
  });
  bgDel.forEach((k) => byKey.delete(k));

  return Array.from(byKey.values());
}

export function sortActionItemsForDisplay(items: ActionItem[]): ActionItem[] {
  return [...items].sort((a, b) => {
    const ba = BLOCKING_RANK[a.blocking];
    const bb = BLOCKING_RANK[b.blocking];
    if (ba !== bb) return ba - bb;
    const ta = displayTier(a.type);
    const tb = displayTier(b.type);
    if (ta !== tb) return ta - tb;
    if (SEVERITY_RANK[a.severity] !== SEVERITY_RANK[b.severity]) {
      return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    }
    return a.priority - b.priority;
  });
}

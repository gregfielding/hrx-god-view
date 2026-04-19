import type { ActionItem } from '../../types/actionItems';
import { entityLabelForKey, normalizeEntityKey } from '../employmentEntityPresentation';

/** Recruiter-facing scope line: C1 entities by key; application/assignment badges — no raw ids. */
export function scopeBadgeLabelForActionItem(item: ActionItem): string | null {
  const s = item.scope;
  if (s.kind === 'entity') {
    const k = normalizeEntityKey(s.entityId);
    if (k) return entityLabelForKey(k);
    const lbl = s.entityLabel?.trim();
    return lbl || null;
  }
  if (s.kind === 'application') return 'Application';
  if (s.kind === 'assignment') return 'Assignment';
  return null;
}

/** Whether the Employment tab link is relevant to at least one current action item. */
export function anyActionItemSuggestsEmploymentTab(items: ActionItem[]): boolean {
  return items.some((item) => {
    if (item.category === 'entity_onboarding' || item.category === 'work_eligibility') return true;
    if (item.type === 'assignment_readiness_blocked') return true;
    if (item.scope.kind === 'entity' && (item.type === 'i9_incomplete' || item.type.startsWith('everify_'))) return true;
    return false;
  });
}

export function actorLabel(actor: ActionItem['actor']): string {
  switch (actor) {
    case 'worker':
      return 'Worker';
    case 'recruiter':
      return 'Recruiter';
    case 'employer':
      return 'Employer';
    case 'system':
      return 'System';
    default:
      return actor;
  }
}

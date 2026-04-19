import type { ActionItem } from '../../../types/actionItems';
import { makeActionItem } from '../actionItemFactory';
import type { ActionItemsV1Input } from '../actionItemsV1Input';

function assignmentNeedsAction(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return (
    s.includes('pending') ||
    s.includes('awaiting') ||
    s.includes('offer') ||
    s === 'draft' ||
    s.includes('confirm')
  );
}

function readinessBlocked(onboardingPercent: number | null | undefined, onboardingStatus: string | null | undefined): boolean {
  if (onboardingPercent != null && onboardingPercent > 0 && onboardingPercent < 100) return true;
  const s = String(onboardingStatus || '').toLowerCase();
  return s.includes('block') || s.includes('incomplete') || s.includes('action');
}

export function runApplicationsAssignmentsRules(input: ActionItemsV1Input): ActionItem[] {
  if (!input.enabled) return [];
  const out: ActionItem[] = [];

  for (const s of input.entitySignals) {
    for (const a of s.assignments) {
      if (assignmentNeedsAction(a.status)) {
        out.push(
          makeActionItem({
            dedupeKey: `assign:${a.assignmentId}:action`,
            type: 'assignment_action_required',
            category: 'assignments',
            severity: 'medium',
            actor: 'worker',
            title: a.title ? `Assignment: ${a.title}` : 'Assignment needs action',
            shortDescription: `Status: ${a.status || 'open'}. Confirm or complete next steps in Employment.`,
            scope: { kind: 'assignment', assignmentId: a.assignmentId },
            blocking: 'soft',
            sourceType: 'assignment',
            sourceId: a.assignmentId,
            ctaLabel: 'Assignments',
            ctaTarget: { kind: 'profileTab', tab: 'Assignments' },
            priority: 38,
          }),
        );
      }
      if (readinessBlocked(a.onboardingPercent ?? null, a.onboardingStatus ?? null)) {
        out.push(
          makeActionItem({
            dedupeKey: `assign:${a.assignmentId}:ready`,
            type: 'assignment_readiness_blocked',
            category: 'assignments',
            severity: 'high',
            actor: 'worker',
            title: a.title ? `Readiness blocked — ${a.title}` : 'Assignment readiness blocked',
            shortDescription: 'Onboarding or readiness steps are not complete for this assignment.',
            scope: { kind: 'assignment', assignmentId: a.assignmentId },
            blocking: 'hard',
            sourceType: 'assignment',
            sourceId: a.assignmentId,
            ctaLabel: 'Employment',
            ctaTarget: { kind: 'profileTab', tab: 'Employment' },
            priority: 16,
          }),
        );
      }
    }
  }

  return out;
}

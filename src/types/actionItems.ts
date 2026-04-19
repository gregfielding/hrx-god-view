/**
 * Action Items v1 — normalized item shape for recruiter Overview and future surfaces.
 * @see docs/product/action-items-v1.md
 */

export const ACTION_ITEMS_RULES_VERSION = 'action_items_v1' as const;

export type ActionCategory =
  | 'profile'
  | 'entity_onboarding'
  | 'compliance'
  | 'work_eligibility'
  | 'applications'
  | 'assignments'
  | 'watchout';

export type ActionSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type ActionBlocking = 'hard' | 'soft' | 'informational';

export type ActionActor = 'worker' | 'recruiter' | 'employer' | 'system';

export type ActionSourceType =
  | 'user_doc'
  | 'subcollection'
  | 'interview'
  | 'application'
  | 'assignment'
  | 'derived';

export type ActionItemScope =
  | { kind: 'global' }
  | { kind: 'entity'; entityId: string; entityLabel?: string }
  | { kind: 'application'; applicationId: string }
  | { kind: 'assignment'; assignmentId: string };

export type CtaTarget =
  | { kind: 'profileTab'; tab: string }
  | { kind: 'route'; path: string }
  | { kind: 'anchor'; tab?: string; hash: string };

/** Tight enum for v1 shipped types */
export type ActionItemType =
  | 'phone_verification_required'
  | 'interview_missing'
  | 'onboarding_incomplete_entity'
  | 'payroll_or_tax_or_deposit_incomplete'
  | 'i9_incomplete'
  | 'everify_not_started'
  | 'everify_pending'
  | 'everify_action_required'
  | 'background_pending'
  | 'background_review_required'
  | 'cert_required_missing'
  | 'assignment_action_required'
  | 'assignment_readiness_blocked'
  | 'risk_watchout'
  | 'score_review_recommended'
  | 'score_auto_advance_blocked';

export interface ActionItem {
  id: string;
  dedupeKey: string;
  type: ActionItemType;
  category: ActionCategory;
  severity: ActionSeverity;
  actor: ActionActor;
  title: string;
  shortDescription: string;
  scope: ActionItemScope;
  blocking: ActionBlocking;
  sourceType: ActionSourceType;
  sourceId: string;
  ctaLabel: string;
  ctaTarget: CtaTarget;
  /** Lower = higher precedence after dedupe */
  priority: number;
  rulesVersion: typeof ACTION_ITEMS_RULES_VERSION;
}

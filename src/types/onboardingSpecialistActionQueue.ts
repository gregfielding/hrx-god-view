/**
 * **E.7** — Unified Onboarding Specialist action-queue item shape.
 *
 * The `/staff-onboarding` "To-Do" tab is a single tenant-wide queue that
 * surfaces (worker × action) pairs the Onboarding Specialist needs to
 * act on. Each row is derived from multiple data sources —
 * `entity_employments`, `everee_workers`, plus user/entity display
 * lookups — and joined into this single shape so the UI can render
 * uniformly and sort across types.
 *
 * Per-action contracts live in
 * `src/hooks/useOnboardingSpecialistActionQueueItems.ts` (the
 * aggregator) and
 * `src/components/staffOnboarding/OnboardingSpecialistActionQueue.tsx`
 * (the renderer). When a new action type is added (e.g. AccuSource
 * adjudication needs-review), extend `OnboardingSpecialistActionType`
 * here, set a priority in `ONBOARDING_SPECIALIST_ACTION_PRIORITY`, and
 * the queue scaffolding picks it up automatically.
 *
 * History: this module was renamed from `csaActionQueue` when the CSA
 * role was renamed to Onboarding Specialist. Behavior is unchanged.
 */

import type { Timestamp } from 'firebase/firestore';

/**
 * v1 action types — strict union (so the renderer can switch
 * exhaustively). Adding a new action type forces compile-time updates
 * everywhere downstream.
 */
export type OnboardingSpecialistActionType =
  | 'i9_section_2'
  | 'start_everify'
  | 'address_tnc';

/**
 * Sort priority — lower value = higher priority (renders first).
 * TNC items first because federal law gives the worker only 8 working
 * days to contest. I-9 Section 2 next because it's also federally
 * time-bound (3 business days from hire). Start E-Verify last — also
 * 3 business days, but only after Section 2 is complete, so volume is
 * higher and the deadline is downstream of the other two.
 */
export const ONBOARDING_SPECIALIST_ACTION_PRIORITY: Record<
  OnboardingSpecialistActionType,
  number
> = {
  address_tnc: 0,
  i9_section_2: 1,
  start_everify: 2,
};

/**
 * Display labels (renderer source of truth). Kept here so renaming a
 * label requires touching a single file rather than hunting through the
 * UI tree.
 */
export const ONBOARDING_SPECIALIST_ACTION_LABELS: Record<
  OnboardingSpecialistActionType,
  { title: string; primaryButton: string }
> = {
  i9_section_2: {
    title: 'Complete I-9 Section 2',
    primaryButton: 'Mark complete',
  },
  start_everify: {
    title: 'Start E-Verify case',
    primaryButton: 'Start E-Verify',
  },
  address_tnc: {
    title: 'Address E-Verify TNC',
    primaryButton: 'Open TNC flow',
  },
};

export interface OnboardingSpecialistActionItem {
  /**
   * Composite id — `${actionType}__${entityId}__${userId}`. Stable
   * across renders (no UUIDs) so React's reconciliation diffs cleanly
   * when the queue mutates.
   */
  id: string;
  actionType: OnboardingSpecialistActionType;

  /** The worker the action is about. */
  workerUid: string;
  workerName: string;
  workerEmail: string | null;
  workerPhone: string | null;
  workerAvatarUrl: string | null;

  /** The hiring entity the action is scoped to. */
  entityId: string;
  entityName: string;
  /**
   * Denormalized entity key (`'select'` / `'workforce'` / `'events'` /
   * other) — used by the queue's "open profile" navigation to anchor on
   * the right Employment tab without an extra Firestore read at render
   * time. May be empty when the row predates the denormalization.
   */
  entityKey: string;
  /** Doc id of the underlying `entity_employments` row — needed by the action callable. */
  entityEmploymentId: string;

  /**
   * Action-specific context, surfaced in the row sub-line. Each
   * action type uses one or two of these — the rest are null/undef.
   */
  context: {
    /** I-9 Section 2 — when the worker hired (for the row sub-line). */
    hireDate: Timestamp | null;
    /** I-9 Section 2 — when the worker signed Section 1 (Everee mirror). */
    i9Section1SignedAt: Timestamp | null;
    /** Start E-Verify — when both I-9 sections completed (later of the two). */
    i9FullySignedAt: Timestamp | null;
    /** Address TNC — when the TNC verdict landed. */
    everifyTncReceivedAt: Timestamp | null;
    /** Address TNC — current `everifyStatus` value (covers both `tnc` + `further_action_required`). */
    everifyStatus: string | null;
  };

  /**
   * Milliseconds since the action became actionable. Used as the
   * secondary sort key within a priority band so the oldest row in
   * each band rises to the top. Computed at aggregation time, not at
   * render time, to keep sort stable across re-renders.
   */
  ageMs: number;

  /** Mirror of `ONBOARDING_SPECIALIST_ACTION_PRIORITY[actionType]` for inline sort access. */
  priority: number;
}

/**
 * Comparator for the rendered queue — priority band first, then oldest
 * actionable within each band. Ties broken by composite id for stable
 * ordering.
 */
export function compareOnboardingSpecialistActionItems(
  a: OnboardingSpecialistActionItem,
  b: OnboardingSpecialistActionItem,
): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  if (a.ageMs !== b.ageMs) return b.ageMs - a.ageMs;
  return a.id.localeCompare(b.id);
}

/**
 * Substring matcher for the search bar — case-insensitive on
 * name/email/phone. Returns true when `query` is empty (no filtering).
 */
export function onboardingSpecialistActionItemMatchesSearch(
  item: OnboardingSpecialistActionItem,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return true;
  const haystacks = [item.workerName, item.workerEmail ?? '', item.workerPhone ?? ''];
  return haystacks.some((h) => h.toLowerCase().includes(q));
}

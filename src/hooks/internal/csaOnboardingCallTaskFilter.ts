/**
 * RD.1 — pure predicates for the "onboarding call" task surface.
 *
 * Lives separately from the React hook so it can be unit-tested without a
 * Firestore client. The task type system at `src/types/Tasks.ts` doesn't
 * have a dedicated `'onboarding_call'` type — the closest matches are:
 *   - `Task.type === 'onboarding'` (broadest — any onboarding-flavored work)
 *   - `Task.category === 'onboarding'` (canonical for onboarding-purpose
 *     phone calls / follow-ups, regardless of `Task.type`)
 *
 * Per RD.1 spec §3 §3 ("If no `onboarding_call` task type exists yet,
 * document that and either (a) use a generic 'call' task type filtered by
 * some context flag, or (b) flag this as needing a new task type
 * definition before this section can fully work"), this v1 takes path (a):
 * we surface tasks that match EITHER the type or the category, so
 * recruiting code that creates onboarding tasks under either convention
 * surfaces correctly. Once a dedicated `'onboarding_call'` task type
 * lands, narrow this predicate to that single value.
 *
 * Open-task definition: NOT in a terminal state. The Task.status union
 * has `'completed' | 'cancelled' | 'dismissed'` as terminal states.
 */
import type { Task, TaskStatus } from '../../types/Tasks';

const TERMINAL_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  'completed',
  'cancelled',
  'dismissed',
]);

/** True when the task is still actionable (not in a terminal state). */
export function isOpenTask(task: Pick<Task, 'status'>): boolean {
  return !TERMINAL_TASK_STATUSES.has(task.status);
}

/**
 * True when the task is an onboarding-flavored call/touchpoint surface for
 * the CSA. See file-header rationale for the OR predicate.
 */
export function isOnboardingCallTask(
  task: Pick<Task, 'type' | 'category'>,
): boolean {
  return task.type === 'onboarding' || task.category === 'onboarding';
}

/**
 * Compose: open + onboarding-call. Used by the live listener to drop
 * tasks the moment they're completed (or cancelled / dismissed).
 */
export function isPendingOnboardingCallTask(
  task: Pick<Task, 'status' | 'type' | 'category'>,
): boolean {
  return isOpenTask(task) && isOnboardingCallTask(task);
}

/**
 * Resolve the worker uid the task is "about" — used by the section row
 * to render worker info. Tasks have multiple shapes for "the user this
 * task concerns":
 *   - `associations.users[0]` (newer, generic users association)
 *   - `associations.salespeople[0]` (legacy — the field is named for CRM
 *     salespeople but recruiting uses it for the worker too)
 *   - top-level `userId` field on some recruiting-created tasks
 *
 * Returns the first non-empty match, or null if none of the conventions
 * surface a uid (in which case the row falls back to "unknown worker").
 */
export function resolveWorkerUidFromTask(task: {
  associations?: {
    users?: ReadonlyArray<string>;
    salespeople?: ReadonlyArray<string>;
  };
  userId?: string;
  workerId?: string;
}): string | null {
  const usersArr = task.associations?.users;
  if (usersArr && usersArr.length > 0 && usersArr[0]) return usersArr[0];

  const spArr = task.associations?.salespeople;
  if (spArr && spArr.length > 0 && spArr[0]) return spArr[0];

  if (typeof task.userId === 'string' && task.userId) return task.userId;
  if (typeof task.workerId === 'string' && task.workerId) return task.workerId;
  return null;
}

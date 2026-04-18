/**
 * Deterministic overlap rules for worker AI prescreen dynamic steps (core vs job-aware).
 * Keep in sync with `src/shared/prescreenDynamicDedupe.ts`.
 *
 * Future UX (“strong candidate” / interview shortening) — deferred; do not expand this file into a
 * broad auto-finish or silent fast-pass without product/legal sign-off. Safe later directions include
 * tighter narrative requirements, fewer optional follow-ups, and compressing `additional_notes`—not
 * skipping compliance or job-required dynamics, and not diverging client vs server step lists.
 */

export const DYN_SHIFT_PUNCTUALITY_ID = 'dyn_shift_punctuality';
export const DYN_WORKSITE_COMMUTE_ID = 'dyn_worksite_commute';
export const DYN_PHYSICAL_JOB_FIT_ID = 'dyn_physical_job_fit';

export type PrescreenDedupeCoreAnswers = {
  attendance_issues?: string;
  transportation_plan?: string;
  backup_transportation?: string;
  physical_comfort?: string;
};

export type PrescreenDynamicDedupeSkip = {
  id: string;
  reason: string;
  synthetic: 'yes' | 'no' | 'not_sure';
};

function normLower(s: unknown): string {
  return String(s ?? '').trim().toLowerCase();
}

const ALLOWED_TRANSPORT_MODES = new Set([
  'own_vehicle',
  'ride_from_someone_else',
  'public_transportation',
  'walk_bike',
  'other',
]);

export function isTransportReliableForDedupe(a: PrescreenDedupeCoreAnswers): boolean {
  const tp = normLower(a.transportation_plan);
  const bu = normLower(a.backup_transportation);
  if (tp === 'not_sure_yet' || tp === '') return false;
  if (bu !== 'yes') return false;
  return ALLOWED_TRANSPORT_MODES.has(tp);
}

type DecideResult =
  | { omit: false }
  | { omit: true; synthetic: 'yes' | 'no' | 'not_sure'; reason: string };

function decideDynamicStep(
  id: string,
  answers: PrescreenDedupeCoreAnswers,
  mergedDynamic: Record<string, string>,
): DecideResult {
  if (id === DYN_PHYSICAL_JOB_FIT_ID) {
    if (normLower(answers.physical_comfort) === 'yes') {
      return { omit: true, synthetic: 'yes', reason: 'dedupe:physical_comfort_yes' };
    }
    return { omit: false };
  }

  if (id === DYN_SHIFT_PUNCTUALITY_ID) {
    if (normLower(answers.attendance_issues) === 'no' && isTransportReliableForDedupe(answers)) {
      return { omit: true, synthetic: 'yes', reason: 'dedupe:attendance_clear_and_transport_reliable' };
    }
    return { omit: false };
  }

  if (id === DYN_WORKSITE_COMMUTE_ID) {
    if (isTransportReliableForDedupe(answers)) {
      return { omit: true, synthetic: 'yes', reason: 'dedupe:transport_reliable' };
    }
    const shiftAns = normLower(mergedDynamic[DYN_SHIFT_PUNCTUALITY_ID] ?? '').replace(/\s+/g, '_');
    if (shiftAns === 'yes') {
      return { omit: true, synthetic: 'yes', reason: 'dedupe:after_shift_punctuality_yes' };
    }
    return { omit: false };
  }

  return { omit: false };
}

export function applyPrescreenDynamicDedupe<
  T extends {
    id: string;
  },
>(fullSteps: ReadonlyArray<T>, answers: PrescreenDedupeCoreAnswers, clientDynamic: Record<string, string>): {
  mergedDynamicAnswers: Record<string, string>;
  visibleSteps: T[];
  skipped: PrescreenDynamicDedupeSkip[];
} {
  const merged: Record<string, string> = { ...clientDynamic };
  const visible: T[] = [];
  const skipped: PrescreenDynamicDedupeSkip[] = [];

  for (const step of fullSteps) {
    const d = decideDynamicStep(step.id, answers, merged);
    if (d.omit) {
      merged[step.id] = d.synthetic;
      skipped.push({ id: step.id, reason: d.reason, synthetic: d.synthetic });
    } else {
      visible.push(step);
    }
  }

  return { mergedDynamicAnswers: merged, visibleSteps: visible, skipped };
}

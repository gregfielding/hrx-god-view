/**
 * Deterministic first-step routing for Worker AI prescreen (no ML).
 * Hydrates opening preferences from `users/{uid}.workerProfile.preferences` when present
 * so workers with saved prefs can skip ahead to the next unanswered step.
 */

import type { WorkerAiPrescreenAnswers } from './workerAiPrescreenScore';
import { resolveWorkerPreferences } from './workerPreferencesCanonical';
import {
  validatePrescreenNavEntry,
  navEntryStepId,
  PRESCREEN_FAST_PATH_V2,
  type PrescreenNavEntry,
} from './workerAiPrescreenV2Flow';
import type { WorkerAiPrescreenDynamicStep } from '../types/workerAiPrescreenDynamic';

export type AdaptiveEntryReason =
  | 'default_start'
  | 'prefs_hydrated_skip'
  | 'application_context_prioritize_job_fit';

/** Merge canonical profile preferences into prescreen answer shape (opening steps only). */
export function buildAnswersPatchFromUserPreferences(
  userDoc: Record<string, unknown> | null | undefined,
): Partial<WorkerAiPrescreenAnswers> {
  if (!userDoc || typeof userDoc !== 'object') return {};
  const wp = userDoc.workerProfile as Record<string, unknown> | undefined;
  const prefsRaw = wp && typeof wp === 'object' ? (wp.preferences as Record<string, unknown>) : {};
  const resolved = resolveWorkerPreferences(prefsRaw || {});
  const patch: Partial<WorkerAiPrescreenAnswers> = {};
  if (resolved.targetWorkTypes.length > 0) {
    patch.opening_target_work_types = [...resolved.targetWorkTypes];
  }
  if (resolved.schedulePreferences.length > 0) {
    patch.opening_schedule_preferences = [...resolved.schedulePreferences];
  }
  return patch;
}

function mergeAnswers(base: WorkerAiPrescreenAnswers, patch: Partial<WorkerAiPrescreenAnswers>): WorkerAiPrescreenAnswers {
  return { ...base, ...patch };
}

export function computeAdaptiveFirstNavIndex(params: {
  navEntries: PrescreenNavEntry[];
  baseAnswers: WorkerAiPrescreenAnswers;
  patchFromProfile: Partial<WorkerAiPrescreenAnswers>;
  dynamicAnswers: Record<string, string>;
  experienceFollowupOptional: string;
  pressureFollowupOptional: string;
  supervisorFollowupOptional: string;
  dynamicStepValid: (step: WorkerAiPrescreenDynamicStep, da: Record<string, string>) => boolean;
  hasApplicationId: boolean;
}): { index: number; reason: AdaptiveEntryReason; firstStepId: string | null } {
  const {
    navEntries,
    baseAnswers,
    patchFromProfile,
    dynamicAnswers,
    experienceFollowupOptional,
    pressureFollowupOptional,
    supervisorFollowupOptional,
    dynamicStepValid,
    hasApplicationId,
  } = params;

  if (navEntries.length === 0) {
    return { index: 0, reason: 'default_start', firstStepId: null };
  }

  const merged = mergeAnswers(baseAnswers, patchFromProfile);

  for (let i = 0; i < navEntries.length; i += 1) {
    const entry = navEntries[i];
    const ok = validatePrescreenNavEntry(
      entry,
      merged,
      dynamicAnswers,
      experienceFollowupOptional,
      PRESCREEN_FAST_PATH_V2,
      dynamicStepValid,
      pressureFollowupOptional,
      supervisorFollowupOptional,
    );
    if (!ok) {
      let reason: AdaptiveEntryReason = 'default_start';
      if (i > 0 && Object.keys(patchFromProfile).length > 0) {
        reason = 'prefs_hydrated_skip';
      } else if (hasApplicationId && entry.kind === 'dynamic') {
        reason = 'application_context_prioritize_job_fit';
      }
      return { index: i, reason, firstStepId: navEntryStepId(entry) };
    }
  }

  const last = navEntries[navEntries.length - 1];
  return {
    index: navEntries.length - 1,
    reason: 'default_start',
    firstStepId: last ? navEntryStepId(last) : null,
  };
}

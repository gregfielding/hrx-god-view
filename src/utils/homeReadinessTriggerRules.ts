import type { HomeReadinessViewModel } from '../types/homeReadiness';
import type { HomeReadinessLaunchStep } from '../components/worker/home/types';

export type ReadinessTriggerReason =
  | 'dashboard_load'
  | 'job_viewed'
  | 'apply_submitted'
  | 'offer_received'
  | 'before_shift_confirm'
  | 'profile_updated'
  | 'wizard_step_completed'
  | 'wizard_completed';

export interface ReadinessTriggerContext {
  reason: ReadinessTriggerReason;
  changedPaths?: string[];
  // Optional job context for contextual nudges (job detail / apply / offer surfaces)
  jobRequiredItemIds?: string[];
}

export interface ReadinessSurfaceDecision {
  recomputeSnapshot: boolean;
  showPrompt: boolean;
  launchStep?: HomeReadinessLaunchStep;
  promptLabel?: string;
}

const RECOMPUTE_PATH_PREFIXES = [
  'workerProfile.photoUrl',
  'avatar',
  'workEligibilityAttestation.authorizedToWorkUS',
  'workEligibilityAttestation.requireSponsorship',
  'workEligibility',
  'workerProfile.preferences.scheduleIntentOptions',
  'workerProfile.preferences.schedulePreferences',
  'workerProfile.preferences.targetWorkTypes',
  'workerProfile.preferences.openToGigWork',
  'workerProfile.preferences.desiredWorkType',
  'workerProfile.preferences.targetIndustries',
  'workerProfile.credentials.certifications',
  'certifications',
  'workerProfile.skills',
  'skills',
  'resume.fileUrl',
  'resumeUrl',
];

const ITEM_TO_LAUNCH_STEP: Record<string, HomeReadinessLaunchStep> = {
  profile_photo: 'profile_photo',
  work_authorization: 'work_authorization',
  certifications: 'certifications',
  skills: 'skills',
  resume: 'resume',
};

function pathMatchesPrefix(path: string): boolean {
  return RECOMPUTE_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}.`) || prefix.startsWith(`${path}.`),
  );
}

export function shouldRecomputeReadinessSnapshot(changedPaths: string[] = []): boolean {
  if (!changedPaths.length) return false;
  return changedPaths.some(pathMatchesPrefix);
}

function firstIncompleteStep(model: HomeReadinessViewModel): HomeReadinessLaunchStep | undefined {
  const first = model.orderedChecklist.find((item) => item.status !== 'complete');
  return first ? ITEM_TO_LAUNCH_STEP[first.id] || 'start' : undefined;
}

export function decideReadinessSurface(
  model: HomeReadinessViewModel,
  context: ReadinessTriggerContext,
): ReadinessSurfaceDecision {
  const recomputeByPath = shouldRecomputeReadinessSnapshot(context.changedPaths || []);
  const hasIncomplete = model.orderedChecklist.some((item) => item.status !== 'complete');

  if (!hasIncomplete) {
    return {
      recomputeSnapshot: recomputeByPath,
      showPrompt: false,
    };
  }

  if (context.reason === 'dashboard_load') {
    return {
      recomputeSnapshot: true,
      showPrompt: true,
      launchStep: firstIncompleteStep(model),
      promptLabel: 'Continue setup',
    };
  }

  if (
    context.reason === 'job_viewed' &&
    Array.isArray(context.jobRequiredItemIds) &&
    context.jobRequiredItemIds.length > 0
  ) {
    const missingJobItem = model.orderedChecklist.find(
      (item) => context.jobRequiredItemIds?.includes(item.id) && item.status !== 'complete',
    );
    if (missingJobItem) {
      return {
        recomputeSnapshot: true,
        showPrompt: true,
        launchStep: ITEM_TO_LAUNCH_STEP[missingJobItem.id] || 'start',
        promptLabel: `Complete: ${missingJobItem.title}`,
      };
    }
  }

  if (
    context.reason === 'profile_updated' ||
    context.reason === 'wizard_step_completed' ||
    context.reason === 'wizard_completed'
  ) {
    return {
      recomputeSnapshot: recomputeByPath || true,
      showPrompt: false,
    };
  }

  if (context.reason === 'apply_submitted' || context.reason === 'offer_received' || context.reason === 'before_shift_confirm') {
    return {
      recomputeSnapshot: true,
      showPrompt: true,
      launchStep: firstIncompleteStep(model),
      promptLabel: 'Complete next step',
    };
  }

  return {
    recomputeSnapshot: recomputeByPath,
    showPrompt: false,
  };
}

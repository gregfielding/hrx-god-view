/**
 * Maps prescreen opening answers → `workerProfile.preferences` durable fields (merge-safe).
 */
import type { WorkerAiPrescreenAnswers } from './scoreWorkerAiPrescreen';

function arr(a: unknown): string[] {
  if (!Array.isArray(a)) return [];
  return a.map((x) => String(x).trim()).filter(Boolean);
}

/** Flatten category experience selections with stable `category:token` strings for search/filter. */
function flattenExperienceCategories(answers: WorkerAiPrescreenAnswers): string[] {
  const tw = new Set(arr(answers.opening_target_work_types));
  const out: string[] = [];
  const push = (prefix: string, values: string[]) => {
    for (const v of values) out.push(`${prefix}:${v}`);
  };
  if (tw.has('industrial')) push('industrial', arr(answers.opening_experience_industrial));
  if (tw.has('hospitality')) push('hospitality', arr(answers.opening_experience_hospitality));
  if (tw.has('events')) push('events', arr(answers.opening_experience_events));
  if (tw.has('clerical_admin')) push('clerical_admin', arr(answers.opening_experience_clerical));
  if (tw.has('healthcare')) push('healthcare', arr(answers.opening_experience_healthcare));
  return [...new Set(out)];
}

/**
 * Schedule keys compatible with Job Readiness `scheduleIntentOptions` (full_time | part_time | gig).
 * temp_to_hire / seasonal are only on `schedulePreferences`.
 */
function scheduleIntentOptionsFromOpening(schedule: string[]): string[] {
  const out: string[] = [];
  if (schedule.includes('full_time')) out.push('full_time');
  if (schedule.includes('part_time')) out.push('part_time');
  if (schedule.includes('gig_work')) out.push('gig');
  return [...new Set(out)];
}

/** Narrow target industries for existing readiness engine (hospitality | industrial only). */
function targetIndustriesLegacySubset(workTypes: string[]): string[] {
  const out: string[] = [];
  if (workTypes.includes('hospitality')) out.push('hospitality');
  if (workTypes.includes('industrial')) out.push('industrial');
  return out;
}

export function buildPrescreenOpeningProfilePatch(answers: WorkerAiPrescreenAnswers): Record<string, unknown> {
  const targetWorkTypes = arr(answers.opening_target_work_types);
  const schedulePreferences = arr(answers.opening_schedule_preferences);
  const experienceCategories = flattenExperienceCategories(answers);
  const gigWorkInterestCategories = schedulePreferences.includes('gig_work') ? arr(answers.opening_gig_types) : [];
  const openToGigWork = schedulePreferences.includes('gig_work');

  const legacyIndustries = targetIndustriesLegacySubset(targetWorkTypes);
  const scheduleIntentOpts = scheduleIntentOptionsFromOpening(schedulePreferences);

  const patch: Record<string, unknown> = {
    'workerProfile.preferences.targetWorkTypes': targetWorkTypes,
    'workerProfile.preferences.schedulePreferences': schedulePreferences,
    'workerProfile.preferences.experienceCategories': experienceCategories,
    'workerProfile.preferences.gigWorkInterestCategories': gigWorkInterestCategories,
    'workerProfile.preferences.openToGigWork': openToGigWork,
  };

  if (legacyIndustries.length > 0) {
    patch['workerProfile.preferences.targetIndustries'] = legacyIndustries;
  }

  if (scheduleIntentOpts.length > 0) {
    patch['workerProfile.preferences.scheduleIntentOptions'] = scheduleIntentOpts;
    patch['jobReadiness.intent.scheduleIntentOptions'] = scheduleIntentOpts;
  }

  return patch;
}

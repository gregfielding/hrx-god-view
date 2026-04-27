/**
 * Opening preference section for worker AI prescreen (v1).
 * Values are **multi-select arrays** (comma-joined in stored interview `questions` rows);
 * do not treat these keys as single-choice. Keep aligned with
 * `src/constants/workerAiPrescreenOpeningSteps.ts`.
 */

export const PRESCREEN_OPENING_MULTI_SELECT_KEYS = [
  'opening_target_work_types',
  'opening_schedule_preferences',
  'opening_experience_industrial',
  'opening_experience_hospitality',
  'opening_experience_events',
  'opening_experience_clerical',
  'opening_experience_healthcare',
  'opening_gig_types',
] as const;

export type PrescreenOpeningMultiSelectKey = (typeof PRESCREEN_OPENING_MULTI_SELECT_KEYS)[number];

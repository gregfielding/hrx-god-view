/**
 * Worker AI pre-screen steps — prompts aligned with `functions/.../prescreenQuestionLabels.ts`.
 */

import { WORKER_AI_PRESCREEN_OPENING_STEPS } from './workerAiPrescreenOpeningSteps';

export type WorkerAiPrescreenQuestionType = 'text' | 'single_select' | 'multi_select';

export type WorkerAiPrescreenStepId =
  | 'confirm_legal_first_name'
  | 'opening_target_work_types'
  | 'opening_schedule_preferences'
  | 'opening_experience_industrial'
  | 'opening_experience_hospitality'
  | 'opening_experience_events'
  | 'opening_experience_clerical'
  | 'opening_experience_healthcare'
  | 'opening_gig_types'
  | 'motivation'
  | 'experience_details'
  | 'pressure_situation'
  | 'work_confidence'
  | 'attendance_issues'
  | 'attendance_explanation'
  | 'transportation_plan'
  | 'backup_transportation'
  | 'physical_comfort'
  | 'drug_screen'
  | 'drug_screen_detail'
  | 'background_check'
  | 'background_check_detail'
  | 'background_offense_class'
  | 'background_offense_when'
  | 'supervisor_feedback'
  | 'additional_notes';

export interface WorkerAiPrescreenStep {
  id: WorkerAiPrescreenStepId;
  type: WorkerAiPrescreenQuestionType;
  prompt: string;
  /** single_select / multi_select options: value is sent to the server */
  options?: { value: string; label: string }[];
}

export const WORKER_AI_PRESCREEN_STEPS: WorkerAiPrescreenStep[] = [
  /** Shown only when profile `firstName` looks like numbers; see `userDocNeedsLegalFirstNameConfirm`. */
  {
    id: 'confirm_legal_first_name',
    type: 'text',
    prompt:
      'Your profile shows a number where your first name should be. What is your legal first name as it appears on your ID?',
  },
  ...(WORKER_AI_PRESCREEN_OPENING_STEPS as unknown as WorkerAiPrescreenStep[]),
  /** Structured multi-select before first long text — reduces early “essay” friction (order is UI-only; same answer keys). */
  {
    id: 'work_confidence',
    type: 'multi_select',
    prompt: 'What kinds of work do you feel confident doing? (Select all that apply)',
    options: [
      { value: 'warehouse_hands_on', label: 'Warehouse / hands-on' },
      { value: 'customer_facing', label: 'Customer-facing / retail' },
      { value: 'office_computer', label: 'Office / computer work' },
      { value: 'driving_delivery', label: 'Driving / delivery' },
      { value: 'food_service', label: 'Food service' },
      { value: 'healthcare', label: 'Healthcare' },
      { value: 'other', label: 'Other' },
    ],
  },
  {
    id: 'motivation',
    type: 'text',
    prompt:
      'What kind of work are you looking for next? Share one goal you have for the next few months, too.',
  },
  {
    id: 'experience_details',
    type: 'text',
    prompt:
      'Tell us about your recent work. Include:\n- where (employer or type of workplace)\n- about how long (approximate is fine)\n- your main responsibilities',
  },
  {
    id: 'pressure_situation',
    type: 'text',
    prompt:
      'Tell us about a time work got stressful or extra busy. What happened, and what did you do?',
  },
  {
    id: 'attendance_issues',
    type: 'single_select',
    prompt:
      'In the past year, were there times you couldn\'t make it to work or arrived late?',
    options: [
      { value: 'No', label: 'No' },
      { value: 'Yes', label: 'Yes' },
    ],
  },
  {
    id: 'attendance_explanation',
    type: 'text',
    prompt:
      'What happened, and what\'s different now? A sentence or two is plenty.',
  },
  {
    id: 'transportation_plan',
    type: 'single_select',
    prompt:
      'How will you usually get to work?',
    options: [
      { value: 'own_vehicle', label: 'I drive myself' },
      { value: 'ride_from_someone_else', label: 'Ride from someone else' },
      { value: 'public_transportation', label: 'Public transportation' },
      { value: 'walk_bike', label: 'Walk or bike' },
      { value: 'not_sure_yet', label: 'Not sure yet' },
      { value: 'other', label: 'Other' },
    ],
  },
  {
    id: 'backup_transportation',
    type: 'single_select',
    prompt:
      'If your usual way to work falls through, do you have a backup plan?',
    options: [
      { value: 'Yes', label: 'Yes' },
      { value: 'No', label: 'No' },
    ],
  },
  {
    id: 'physical_comfort',
    type: 'single_select',
    prompt:
      'Many of our roles involve standing, lifting, or repetitive tasks. Are you able to do this kind of work, with or without a reasonable accommodation?',
    options: [
      { value: 'Yes', label: 'Yes' },
      { value: 'No', label: 'No' },
    ],
  },
  {
    id: 'drug_screen',
    type: 'single_select',
    prompt:
      'Some jobs require a drug screen. If you took one this week, would anything come up that we should know about?',
    options: [
      { value: 'no', label: 'No' },
      { value: 'yes', label: 'Yes' },
      { value: 'not_sure', label: 'Not sure' },
    ],
  },
  {
    id: 'drug_screen_detail',
    type: 'text',
    prompt:
      'Thanks for being upfront — context helps us place you well. Briefly, what should we know? Rough dates help.',
  },
  {
    id: 'background_check',
    type: 'single_select',
    prompt:
      'Some jobs require a background check. Is there anything that might appear that you\'d like to tell us about first?',
    options: [
      { value: 'no', label: 'No' },
      { value: 'yes', label: 'Yes' },
      { value: 'not_sure', label: 'Not sure' },
    ],
  },
  {
    id: 'background_check_detail',
    type: 'text',
    prompt:
      'Thanks for being upfront — context helps us find the right fit. Briefly, what should we know?',
  },
  {
    id: 'background_offense_class',
    type: 'text',
    prompt:
      'Optional: was it generally a misdemeanor or a felony? You can skip this if you prefer.',
  },
  {
    id: 'background_offense_when',
    type: 'text',
    prompt:
      'Optional: roughly when did that happen? A year or timeframe is fine — for staffing, the last 7–10 years matter most.',
  },
  {
    id: 'supervisor_feedback',
    type: 'text',
    prompt:
      'What would your most recent supervisor say about you? Include:\n- one strength they\'d mention\n- one thing you were working on (if any)',
  },
  {
    id: 'additional_notes',
    type: 'text',
    prompt: 'Anything else you want us to know? (Optional — specific details help.)',
  },
];

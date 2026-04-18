/**
 * Worker AI pre-screen steps — prompts aligned with `functions/.../prescreenQuestionLabels.ts`.
 */

import { WORKER_AI_PRESCREEN_OPENING_STEPS } from './workerAiPrescreenOpeningSteps';

export type WorkerAiPrescreenQuestionType = 'text' | 'single_select' | 'multi_select';

export type WorkerAiPrescreenStepId =
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
      'What drew you to this kind of work — and what are you hoping for next? Include:\n' +
      '- what kind of role or industry you want\n' +
      '- one goal for the next few months',
  },
  {
    id: 'experience_details',
    type: 'text',
    prompt:
      'In a few words, what kind of work have you done recently? Include:\n' +
      '- where (employer or type of workplace)\n' +
      '- about how long (approximate is fine)\n' +
      '- your main responsibilities',
  },
  {
    id: 'pressure_situation',
    type: 'text',
    prompt:
      'Tell us about a time work got stressful — what happened, what did you do, and how did it turn out?',
  },
  {
    id: 'attendance_issues',
    type: 'single_select',
    prompt: 'Have you had attendance or lateness issues at past jobs?',
    options: [
      { value: 'No', label: 'No' },
      { value: 'Yes', label: 'Yes' },
    ],
  },
  {
    id: 'attendance_explanation',
    type: 'text',
    prompt:
      'If you answered Yes above, explain what happened and how you handle reliability now. If No, you may write “N/A”.',
  },
  {
    id: 'transportation_plan',
    type: 'single_select',
    prompt: 'Do you have a reliable way to get to work?',
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
    prompt: 'Do you have a backup plan if your usual ride or transit is unavailable?',
    options: [
      { value: 'Yes', label: 'Yes' },
      { value: 'No', label: 'No' },
    ],
  },
  {
    id: 'physical_comfort',
    type: 'single_select',
    prompt: 'Are you comfortable with jobs that may involve standing, lifting, or repetitive tasks?',
    options: [
      { value: 'Yes', label: 'Yes' },
      { value: 'No', label: 'No' },
    ],
  },
  {
    id: 'drug_screen',
    type: 'single_select',
    prompt: 'If a role requires a drug screen, would anything show up that we should know about?',
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
      'You indicated something may show on a drug screen. Briefly explain what we should know (dates/context help). ' +
      'If you tapped Yes by mistake, go Back to change your answer.',
  },
  {
    id: 'background_check',
    type: 'single_select',
    prompt: 'If a role requires a background check, is there anything that might appear?',
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
      'You indicated something may appear on a background check. Briefly explain what we should know. ' +
      'If you tapped Yes by mistake, go Back to change your answer.',
  },
  {
    id: 'background_offense_class',
    type: 'text',
    prompt:
      'Optional: if you shared a criminal record, was it generally a misdemeanor or a felony? ' +
      '(You can skip this if you prefer.)',
  },
  {
    id: 'background_offense_when',
    type: 'text',
    prompt:
      'Optional: roughly when did that happen (year or timeframe)? We focus on roughly the last 7–10 years for staffing.',
  },
  {
    id: 'supervisor_feedback',
    type: 'text',
    prompt:
      'What would your last supervisor say about you? Include:\n' +
      '- one strength they might mention\n' +
      '- one area you were working on (if any)',
  },
  {
    id: 'additional_notes',
    type: 'text',
    prompt: 'Anything else you want us to know? (Optional — specific details help.)',
  },
];

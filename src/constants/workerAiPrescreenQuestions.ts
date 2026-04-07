/**
 * Worker AI pre-screen steps — prompts aligned with `functions/.../prescreenQuestionLabels.ts`.
 */

export type WorkerAiPrescreenQuestionType = 'text' | 'single_select' | 'multi_select';

export type WorkerAiPrescreenStepId =
  | 'motivation'
  | 'similar_experience'
  | 'experience_details'
  | 'work_confidence'
  | 'attendance_issues'
  | 'attendance_explanation'
  | 'transportation_plan'
  | 'backup_transportation'
  | 'physical_comfort'
  | 'drug_screen'
  | 'background_check'
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
  {
    id: 'motivation',
    type: 'text',
    prompt:
      'What made you interested in this type of work, and what are you hoping to get from your next job?',
  },
  {
    id: 'similar_experience',
    type: 'single_select',
    prompt: 'Have you done work similar to what you are applying for?',
    options: [
      { value: 'Yes', label: 'Yes' },
      { value: 'No', label: 'No' },
    ],
  },
  {
    id: 'experience_details',
    type: 'text',
    prompt: 'Briefly describe your most relevant experience.',
  },
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
    prompt: 'If you answered Yes above, explain briefly. Otherwise you can skip or write “N/A”.',
  },
  {
    id: 'transportation_plan',
    type: 'single_select',
    prompt: 'How do you plan to get to work reliably?',
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
    id: 'supervisor_feedback',
    type: 'text',
    prompt: 'What would your last supervisor say about your work?',
  },
  {
    id: 'additional_notes',
    type: 'text',
    prompt: 'Anything else you want us to know?',
  },
];

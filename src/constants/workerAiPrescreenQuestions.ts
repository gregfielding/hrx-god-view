/**
 * Worker AI pre-screen steps — prompts aligned with `functions/.../prescreenQuestionLabels.ts`.
 */

export type WorkerAiPrescreenQuestionType = 'text' | 'single_select' | 'multi_select';

export type WorkerAiPrescreenStepId =
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
      'What drew you to this type of work, and what are you hoping for in your next job? Include:\n' +
      '- what kind of role or industry you want\n' +
      '- one goal you have for the next 3–6 months',
  },
  {
    id: 'experience_details',
    type: 'text',
    prompt:
      'Describe your most relevant experience. Include:\n' +
      '- where you worked (employer or type of workplace)\n' +
      '- how long you were there (approximate is fine)\n' +
      '- what your main responsibilities were',
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
    id: 'pressure_situation',
    type: 'text',
    prompt:
      'Tell us about a time you had to work under pressure or meet a tight deadline. What happened, what did you do, and how did it turn out?',
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
    prompt:
      'What would your last supervisor say about your work? Include:\n' +
      '- one strength they might mention\n' +
      '- one area you were working to improve (if any)',
  },
  {
    id: 'additional_notes',
    type: 'text',
    prompt: 'Anything else you want us to know? (Optional — specific details help.)',
  },
];

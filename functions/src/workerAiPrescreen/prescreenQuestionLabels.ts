/**
 * **Keep aligned** with `src/constants/workerAiPrescreenQuestions.ts` (`prompt` per id).
 */

export const WORKER_AI_PRESCREEN_PROMPTS: Record<string, string> = {
  motivation:
    'What made you interested in this type of work, and what are you hoping to get from your next job?',
  similar_experience: 'Have you done work similar to what you are applying for?',
  experience_details: 'Briefly describe your most relevant experience.',
  work_confidence: 'What kinds of work do you feel confident doing? (Select all that apply)',
  attendance_issues: 'Have you had attendance or lateness issues at past jobs?',
  attendance_explanation:
    'If you answered Yes above, explain briefly. Otherwise you can skip or write “N/A”.',
  transportation_plan: 'How do you plan to get to work reliably?',
  backup_transportation: 'Do you have a backup plan if your usual ride or transit is unavailable?',
  physical_comfort:
    'Are you comfortable with jobs that may involve standing, lifting, or repetitive tasks?',
  drug_screen: 'If a role requires a drug screen, would anything show up that we should know about?',
  background_check: 'If a role requires a background check, is there anything that might appear?',
  supervisor_feedback: 'What would your last supervisor say about your work?',
  additional_notes: 'Anything else you want us to know?',
};

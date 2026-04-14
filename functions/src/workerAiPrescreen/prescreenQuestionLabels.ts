/**
 * **Keep aligned** with `src/constants/workerAiPrescreenQuestions.ts` (`prompt` per id).
 */

export const WORKER_AI_PRESCREEN_PROMPTS: Record<string, string> = {
  motivation:
    'What drew you to this type of work, and what are you hoping for in your next job? Include:\n' +
    '- what kind of role or industry you want\n' +
    '- one goal you have for the next 3–6 months',
  experience_details:
    'Describe your most relevant experience. Include:\n' +
    '- where you worked (employer or type of workplace)\n' +
    '- how long you were there (approximate is fine)\n' +
    '- what your main responsibilities were',
  work_confidence: 'What kinds of work do you feel confident doing? (Select all that apply)',
  pressure_situation:
    'Tell us about a time you had to work under pressure or meet a tight deadline. What happened, what did you do, and how did it turn out?',
  attendance_issues: 'Have you had attendance or lateness issues at past jobs?',
  attendance_explanation:
    'If you answered Yes above, explain what happened and how you handle reliability now. If No, you may write “N/A”.',
  transportation_plan: 'How do you plan to get to work reliably?',
  backup_transportation: 'Do you have a backup plan if your usual ride or transit is unavailable?',
  physical_comfort:
    'Are you comfortable with jobs that may involve standing, lifting, or repetitive tasks?',
  drug_screen: 'If a role requires a drug screen, would anything show up that we should know about?',
  background_check: 'If a role requires a background check, is there anything that might appear?',
  supervisor_feedback:
    'What would your last supervisor say about your work? Include:\n' +
    '- one strength they might mention\n' +
    '- one area you were working to improve (if any)',
  additional_notes: 'Anything else you want us to know? (Optional — specific details help.)',
};

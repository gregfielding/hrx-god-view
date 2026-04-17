/**
 * **Keep aligned** with `src/constants/workerAiPrescreenQuestions.ts` (`prompt` per id).
 */

export const WORKER_AI_PRESCREEN_PROMPTS: Record<string, string> = {
  opening_target_work_types: 'What type of work are you interested in?',
  opening_schedule_preferences: 'What kind of schedule are you open to?',
  opening_experience_industrial: 'Which types of industrial work have you done before?',
  opening_experience_hospitality: 'Which hospitality roles have you worked in?',
  opening_experience_events: 'What kind of event work have you done?',
  opening_experience_clerical: 'Which clerical or admin work have you done?',
  opening_experience_healthcare: 'Which healthcare support roles have you done?',
  opening_gig_types: 'What kinds of gig work are you open to?',
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
  drug_screen_detail:
    'You indicated something may show on a drug screen. Briefly explain what we should know (dates/context help).',
  background_check: 'If a role requires a background check, is there anything that might appear?',
  background_check_detail:
    'You indicated something may appear on a background check. Briefly explain what we should know.',
  supervisor_feedback:
    'What would your last supervisor say about your work? Include:\n' +
    '- one strength they might mention\n' +
    '- one area you were working to improve (if any)',
  additional_notes: 'Anything else you want us to know? (Optional — specific details help.)',
};

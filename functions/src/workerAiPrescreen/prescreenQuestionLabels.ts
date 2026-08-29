/**
 * **Keep aligned** with `src/constants/workerAiPrescreenQuestions.ts` (`prompt` per id).
 */

/**
 * Server-stored transcript labels for core prescreen questions.
 *
 * REGENERATED VERBATIM from src/constants/workerAiPrescreenQuestions.ts +
 * workerAiPrescreenOpeningSteps.ts on 2026-08-29 (interview review F9 —
 * these had drifted from the client copy on 7+ questions, so transcripts
 * stored questions the worker never saw). If you edit the client prompts,
 * update this map to match, verbatim.
 */
export const WORKER_AI_PRESCREEN_PROMPTS: Record<string, string> = {
  confirm_legal_first_name:
    'Your profile shows a number where your first name should be. What is your legal first name as it appears on your ID?',
  opening_target_work_types:
    'What type of work are you interested in?',
  opening_schedule_preferences:
    'What kind of schedule are you open to?',
  opening_experience_industrial:
    'Which types of industrial work have you done before?',
  opening_experience_hospitality:
    'Which hospitality roles have you worked in?',
  opening_experience_events:
    'What kind of event work have you done?',
  opening_experience_clerical:
    'Which clerical or admin work have you done?',
  opening_experience_healthcare:
    'Which healthcare support roles have you done?',
  opening_gig_types:
    'What kinds of gig work are you open to?',
  work_confidence:
    'What kinds of work do you feel confident doing? (Select all that apply)',
  motivation:
    'What kind of work are you looking for next? Share one goal you have for the next few months, too.',
  experience_details:
    'Tell us about your recent work. Include:\\n- where (employer or type of workplace)\\n- about how long (approximate is fine)\\n- your main responsibilities',
  pressure_situation:
    'Tell us about a time work got stressful or extra busy. What happened, and what did you do?',
  attendance_issues:
    'In the past year, were there times you couldn\\\'t make it to work or arrived late?',
  attendance_explanation:
    'What happened, and what\\\'s different now? A sentence or two is plenty.',
  transportation_plan:
    'How will you usually get to work?',
  backup_transportation:
    'If your usual way to work falls through, do you have a backup plan?',
  physical_comfort:
    'Many of our roles involve standing, lifting, or repetitive tasks. Are you able to do this kind of work, with or without a reasonable accommodation?',
  drug_screen:
    'Some jobs require a drug screen. If you took one this week, would anything come up that we should know about?',
  drug_screen_detail:
    'Thanks for being upfront — context helps us place you well. Briefly, what should we know? Rough dates help.',
  background_check:
    'Some jobs require a background check. Is there anything that might appear that you\\\'d like to tell us about first?',
  background_check_detail:
    'Thanks for being upfront — context helps us find the right fit. Briefly, what should we know?',
  background_offense_class:
    'Optional: was it generally a misdemeanor or a felony? You can skip this if you prefer.',
  background_offense_when:
    'Optional: roughly when did that happen? A year or timeframe is fine — for staffing, the last 7–10 years matter most.',
  supervisor_feedback:
    'What would your most recent supervisor say about you? Include:\\n- one strength they\\\'d mention\\n- one thing you were working on (if any)',
  additional_notes:
    'Anything else you want us to know? (Optional — specific details help.)',
};

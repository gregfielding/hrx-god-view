/**
 * Default prompts for User Profile → Interview tab (“Conduct Interview”).
 * Edit the `question` strings (and add/remove rows) here; keep `id` stable if you care about
 * comparing historical Firestore interview docs across template versions.
 */

export type InterviewQuestionTemplate = {
  id: string;
  question: string;
  type: 'text';
  /** MUI TextField `rows` (default 3 in InterviewTab). */
  multilineRows?: number;
  /** Shown under the field as MUI `helperText`. */
  helperText?: string;
};

export const DEFAULT_INTERVIEW_QUESTION_TEMPLATES: InterviewQuestionTemplate[] = [
  {
    id: '1',
    question: 'What made you apply for this job specifically, and what are you hoping to get out of it?',
    type: 'text',
  },
  {
    id: '2',
    question:
      "Tell me about the most similar job you've had. What were your day-to-day responsibilities?",
    type: 'text',
  },
  {
    id: '3',
    question: 'What kind of work do you feel most confident doing without supervision?',
    type: 'text',
  },
  {
    id: '4',
    question:
      'This job requires consistent attendance. Have you had any issues with attendance or being late in past jobs?',
    type: 'text',
  },
  {
    id: '5',
    question:
      "How will you reliably get to work every day, and what's your backup plan if something goes wrong?",
    type: 'text',
  },
  {
    id: '6',
    question: 'This role may require a drug screen. Would anything come up that we should be aware of?',
    type: 'text',
  },
  {
    id: '7',
    question:
      'Some roles require a background check. Is there anything that could come up that might affect job placement?',
    type: 'text',
  },
  {
    id: '9',
    question:
      'This job may involve standing for long periods, lifting, and repetitive work. Are you comfortable with that?',
    type: 'text',
  },
  {
    id: '10',
    question: 'What would your last supervisor say about you?',
    type: 'text',
  },
  {
    id: '8',
    question: 'Additional Notes',
    type: 'text',
    multilineRows: 4,
    helperText:
      'For CORT, we may have only gig work available before we can place you in a full-time role. Are you willing to do gig work?',
  },
];

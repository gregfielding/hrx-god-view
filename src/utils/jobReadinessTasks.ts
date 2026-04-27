/**
 * Job Readiness improvement tasks — which profile fields block job visibility.
 * Returns top N tasks ordered by impact so the feed shows the most impactful fixes first.
 */

import type { OnboardingChecklist } from '../types/onboarding';
import { getReadinessPrompts, READINESS_SECTION_IDS } from '../components/worker/profile/readinessPrompts';

export type ImprovementTaskType = 'certification' | 'education' | 'background_check';

/** Single improvement task for the job readiness card feed. */
export interface ImprovementTask {
  id: string;
  type: ImprovementTaskType;
  /** i18n key or literal title */
  titleKey: string;
  /** i18n key or literal body (optional) */
  bodyKey?: string;
  /** i18n key or literal question */
  questionKey: string;
  /** For certification: Yes / No / Upload Certificate */
  actionType: 'yes_no_upload' | 'dropdown' | 'yes_no';
  /** For dropdown: option value -> i18n key or label */
  options?: Array<{ value: string; labelKey: string }>;
  /** Profile section to open when "full details" (e.g. profile hash). */
  profileSectionId?: string;
}

const MAX_TASKS = 3;

/** Education dropdown options (value matches experienceOptions / profile). */
export const EDUCATION_OPTIONS: Array<{ value: string; labelKey: string }> = [
  { value: 'none', labelKey: 'jobReadiness.educationNone' },
  { value: 'high_school', labelKey: 'jobReadiness.educationHighSchool' },
  { value: 'some_college', labelKey: 'jobReadiness.educationSomeCollege' },
  { value: 'associate', labelKey: 'jobReadiness.educationAssociate' },
  { value: 'bachelor', labelKey: 'jobReadiness.educationBachelor' },
  { value: 'master', labelKey: 'jobReadiness.educationGraduate' },
];

/**
 * Returns the top N improvement tasks that are blocking job visibility.
 * Order: certifications (e.g. Food Handler), education, background check.
 */
export function getImprovementTasks(
  userDoc: Record<string, unknown> | null,
  checklist: OnboardingChecklist
): ImprovementTask[] {
  void checklist;
  const out: ImprovementTask[] = [];

  if (!userDoc || typeof userDoc !== 'object') {
    // No profile: suggest all three in fixed order
    out.push(certificationTask());
    out.push(educationTask());
    out.push(backgroundCheckTask());
    return out.slice(0, MAX_TASKS);
  }

  const prompts = getReadinessPrompts(userDoc);
  const jobReadinessResponses = (userDoc.jobReadinessResponses ?? {}) as Record<string, unknown>;
  const wasAnswered = (taskId: string): boolean => {
    const response = jobReadinessResponses[taskId];
    if (!response || typeof response !== 'object') return false;
    const value = (response as Record<string, unknown>).value;
    return value !== undefined && value !== null && String(value).trim().length > 0;
  };
  const certs = userDoc.certifications;
  const hasCerts = Array.isArray(certs) && certs.length > 0;
  const needsCert = !hasCerts && !wasAnswered('certification-food-handler');

  const educationLevel = userDoc.educationLevel as string | undefined;
  const hasEducation = typeof educationLevel === 'string' && educationLevel.trim().length > 0;
  const needsEducation = !hasEducation && !wasAnswered('education');

  const bg = userDoc.backgroundCheckComfort ?? userDoc.backgroundCheck;
  const hasBackgroundAnswer =
    (typeof bg === 'boolean' && bg !== undefined) ||
    (typeof bg === 'object' && bg != null && (bg as Record<string, unknown>).comfortable != null) ||
    (typeof bg === 'string' && bg.trim().length > 0);
  const needsBackground = !hasBackgroundAnswer && !wasAnswered('background-check');

  if (needsCert) {
    out.push(certificationTask());
  }
  if (needsEducation) {
    out.push(educationTask());
  }
  if (needsBackground) {
    out.push(backgroundCheckTask());
  }

  // If we have fewer than 3, add from a secondary list (e.g. work experience) so we always show up to 3
  const workExpMissing = prompts.some((p) => p.id === 'work-experience');
  if (out.length < MAX_TASKS && workExpMissing && !wasAnswered('work-experience')) {
    out.push({
      id: 'work-experience',
      type: 'certification',
      titleKey: 'jobReadiness.workExperienceTitle',
      bodyKey: 'jobReadiness.workExperienceBody',
      questionKey: 'jobReadiness.workExperienceQuestion',
      actionType: 'yes_no',
      profileSectionId: 'readiness-work-experience',
    });
  }

  return out.slice(0, MAX_TASKS);
}

function certificationTask(): ImprovementTask {
  return {
    id: 'certification-food-handler',
    type: 'certification',
    titleKey: 'jobReadiness.certificationTitle',
    bodyKey: 'jobReadiness.certificationBody',
    questionKey: 'jobReadiness.certificationQuestion',
    actionType: 'yes_no_upload',
    profileSectionId: READINESS_SECTION_IDS.certifications,
  };
}

function educationTask(): ImprovementTask {
  return {
    id: 'education',
    type: 'education',
    titleKey: 'jobReadiness.educationTitle',
    questionKey: 'jobReadiness.educationQuestion',
    actionType: 'dropdown',
    options: EDUCATION_OPTIONS,
    profileSectionId: 'readiness-work-experience',
  };
}

function backgroundCheckTask(): ImprovementTask {
  return {
    id: 'background-check',
    type: 'background_check',
    titleKey: 'jobReadiness.backgroundCheckTitle',
    questionKey: 'jobReadiness.backgroundCheckQuestion',
    actionType: 'yes_no',
    profileSectionId: 'readiness-certifications',
  };
}

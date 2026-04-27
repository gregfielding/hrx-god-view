/**
 * Phase 1 translatable fields for job_postings.
 */

export const PHASE1_TRANSLATABLE_FIELDS = [
  'postTitle_i18n',
  'jobTitle_i18n',
  'jobDescription_i18n',
  'requirements_i18n',
  'payDetails_i18n',
] as const;

export type Phase1Field = (typeof PHASE1_TRANSLATABLE_FIELDS)[number];

export function isPhase1Field(key: string): key is Phase1Field {
  return (PHASE1_TRANSLATABLE_FIELDS as readonly string[]).includes(key);
}

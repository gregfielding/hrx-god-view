/**
 * Display rule for job posting worker-facing fields: use _i18n[lang] ?? _i18n.en ?? legacy.
 * Use for postTitle, jobTitle, jobDescription, requirements, payDetails.
 */

export type LanguageCode = 'en' | 'es';

type I18nValue = { en?: string; es?: string } | undefined;

/**
 * Returns the display string for a job posting field in the given language.
 * Use: posting.field_i18n?.[lang] ?? posting.field_i18n?.en ?? posting.field ?? ''
 */
export function getJobPostingDisplayText(
  posting: Record<string, unknown> | null | undefined,
  field: 'postTitle' | 'jobTitle' | 'jobDescription' | 'requirements' | 'payDetails',
  lang: LanguageCode
): string {
  if (!posting) return '';
  const i18n = posting[`${field}_i18n`] as I18nValue | undefined;
  const legacy = posting[field];
  const value = (i18n?.[lang] ?? i18n?.en ?? (typeof legacy === 'string' ? legacy : undefined))?.trim();
  return value ?? '';
}

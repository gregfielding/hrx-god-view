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

/**
 * Many job descriptions use English template labels (Job Title:, Location:, Pay Rate:, Zip Code:).
 * When the UI is in Spanish, rewrite those lines so the template reads naturally.
 * Full paragraph translation still comes from jobDescription_i18n.es when recruiters provide it.
 */
export function localizeJobDescriptionEmbeddedLabels(text: string, lang: LanguageCode): string {
  if (lang !== 'es' || !text?.trim()) return text;
  let s = text;
  // Longer / more specific patterns first
  const replacements: [RegExp, string][] = [
    [/\(Zip Code:\s*/gi, '(Código postal: '],
    [/Zip Code:\s*/gi, 'Código postal: '],
    [/Job Title:\s*/gi, 'Puesto: '],
    [/Location:\s*/gi, 'Ubicación: '],
    [/Pay Rate:\s*/gi, 'Salario: '],
    [/Company:\s*/gi, 'Empresa: '],
    [/Hours:\s*/gi, 'Horas: '],
    [/Schedule:\s*/gi, 'Horario: '],
    [/\$([\d,.]+)\s*\/\s*hour\b/gi, '$$$1/hora'],
    [/\$([\d,.]+)\/hour\b/gi, '$$$1/hora'],
    [/\$([\d,.]+)\/hr\b/gi, '$$$1/h'],
  ];
  for (const [re, repl] of replacements) {
    s = s.replace(re, repl);
  }
  return s;
}

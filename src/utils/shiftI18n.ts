/**
 * Display rule for shift worker-facing fields: use _i18n[lang] ?? _i18n.en ?? legacy.
 * Use for shiftTitle, defaultJobTitle, shiftDescription, emailIntro.
 */

export type ShiftI18nField = 'shiftTitle' | 'defaultJobTitle' | 'shiftDescription' | 'emailIntro';

export type LanguageCode = 'en' | 'es';

/** Shape of _i18n on a shift doc (or JobBoardShift) for a single field */
export type ShiftFieldI18n = { en?: string; es?: string } | undefined;

/**
 * Returns the display string for a shift field in the given language.
 * Use: shift.field_i18n?.[lang] ?? shift.field_i18n?.en ?? shift.field ?? ''
 */
export function getShiftDisplayText(
  shift: Record<string, unknown> | null | undefined,
  field: ShiftI18nField,
  lang: LanguageCode
): string {
  if (!shift) return '';
  const i18n = shift[`${field}_i18n`] as ShiftFieldI18n | undefined;
  const legacy = shift[field];
  const value = (i18n?.[lang] ?? i18n?.en ?? (typeof legacy === 'string' ? legacy : undefined))?.trim();
  return value ?? '';
}

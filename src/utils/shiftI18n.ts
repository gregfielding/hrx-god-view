/**
 * Display rule for shift worker-facing fields: use _i18n[lang] ?? _i18n.en ?? legacy.
 * Use for shiftTitle, defaultJobTitle, shiftDescription, emailIntro.
 */

export type ShiftI18nField = 'shiftTitle' | 'defaultJobTitle' | 'shiftDescription' | 'emailIntro';

export type LanguageCode = 'en' | 'es';

/** Shape of _i18n on a shift doc (or JobBoardShift) for a single field */
export type ShiftFieldI18n = { en?: string; es?: string } | undefined;

function nonEmptyTrimmed(s: string | undefined): string | undefined {
  if (typeof s !== 'string') return undefined;
  const t = s.trim();
  return t.length > 0 ? t : undefined;
}

/**
 * Returns the display string for a shift field in the given language.
 * Prefer _i18n[lang], then _i18n.en, then legacy field — but treat empty i18n strings as missing so
 * legacy text (e.g. shiftDescription from Add Shift) still shows before translations exist.
 */
export function getShiftDisplayText(
  shift: Record<string, unknown> | null | undefined,
  field: ShiftI18nField,
  lang: LanguageCode
): string {
  if (!shift) return '';
  const i18n = shift[`${field}_i18n`] as ShiftFieldI18n | undefined;
  const legacy = shift[field];
  const fromI18n = nonEmptyTrimmed(i18n?.[lang]) ?? nonEmptyTrimmed(i18n?.en);
  if (fromI18n) return fromI18n;
  return typeof legacy === 'string' ? legacy.trim() : '';
}

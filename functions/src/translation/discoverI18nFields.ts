/**
 * Auto-discover translatable fields: any key ending in _i18n with non-empty value.en.
 * Used by needsTranslation when autoDiscover is true (vNext).
 */

const I18N_SUFFIX = '_i18n';

function isI18nKey(key: string): boolean {
  return key.endsWith(I18N_SUFFIX);
}

function hasNonEmptyEn(value: unknown): value is { en: string } {
  if (value == null || typeof value !== 'object') return false;
  const en = (value as Record<string, unknown>).en;
  return typeof en === 'string' && en.trim().length > 0;
}

/**
 * Returns field paths that are translatable: keys ending in _i18n with non-empty .en.
 * Excludes any field in manualFields.
 */
export function discoverI18nFields(
  afterData: Record<string, unknown>,
  manualFields: string[] = []
): string[] {
  const manualSet = new Set(manualFields);
  const out: string[] = [];

  for (const key of Object.keys(afterData)) {
    if (!isI18nKey(key)) continue;
    if (manualSet.has(key)) continue;
    const value = afterData[key];
    if (!hasNonEmptyEn(value)) continue;
    out.push(key);
  }

  return out;
}

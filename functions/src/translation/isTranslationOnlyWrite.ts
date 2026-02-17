/**
 * Loop-safety: detect writes that only touch *_i18n.es, staffInstructions_i18n.*.es, or translationMeta.
 * Trigger must NOT enqueue when the translation worker wrote back.
 * Supports any key ending in _i18n (auto-discovery vNext) and job-order staffInstructions_i18n.
 */

export type DocumentData = Record<string, unknown>;

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isI18nKey(key: string): boolean {
  return key.endsWith('_i18n');
}

/** staffInstructions_i18n: only .es (or new sections with only .es) changed; .en unchanged per section */
function isStaffInstructionsI18nTranslationOnly(
  before: DocumentData | undefined,
  after: DocumentData
): boolean {
  const b = before?.staffInstructions_i18n as Record<string, { en?: string; es?: string }> | undefined;
  const a = after?.staffInstructions_i18n as Record<string, { en?: string; es?: string }> | undefined;
  if (!a) return true;
  for (const section of Object.keys(a)) {
    const aSection = a[section];
    const bSection = b?.[section];
    if (aSection?.en !== bSection?.en) return false;
  }
  return true;
}

/**
 * Returns true when the only changes are to *_i18n.es, staffInstructions_i18n.*.es, or translationMeta.
 * EN must be unchanged for any *_i18n field; staffInstructions_i18n.*.en unchanged per section.
 */
export function isTranslationOnlyWrite(
  before: DocumentData | undefined,
  after: DocumentData
): boolean {
  if (!before) return false;

  const changedKeys = Object.keys(after).filter((key) => !deepEqual(before[key], after[key]));
  if (changedKeys.length === 0) return false;

  return changedKeys.every((key) => {
    if (key === 'translationMeta') return true;

    if (key === 'staffInstructions_i18n') {
      return isStaffInstructionsI18nTranslationOnly(before, after);
    }

    if (isI18nKey(key)) {
      const b = before[key] as { en?: string | string[]; es?: string | string[] } | undefined;
      const a = after[key] as { en?: string | string[]; es?: string | string[] } | undefined;
      if (!a) return false;
      if (!b) return true; // new _i18n key (e.g. chip array) written by worker
      return JSON.stringify(b.en) === JSON.stringify(a.en);
    }

    return false;
  });
}

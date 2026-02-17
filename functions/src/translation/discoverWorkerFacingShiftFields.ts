/**
 * Shift worker-facing translation: scalar string fields shown to workers.
 * Same pattern as job-order scalar: legacy field → field_i18n.en / field_i18n.es.
 * Matches ShiftSetupTab form: shiftTitle, defaultJobTitle, shiftDescription, emailIntro.
 */

/** Shift scalar fields that can be shown to workers; translate legacy value → <field>_i18n.es */
export const SHIFT_SCALAR_WORKER_FACING_FIELDS = [
  'shiftTitle',
  'defaultJobTitle',
  'shiftDescription',
  'emailIntro',
] as const;

/**
 * Returns _i18n field paths for shift scalar worker-facing fields that have
 * a non-empty source (legacy field or existing .en).
 */
export function discoverShiftScalarI18nCandidates(
  afterData: Record<string, unknown>,
  manualFields: string[] = []
): string[] {
  const manualSet = new Set(manualFields);
  const out: string[] = [];

  for (const field of SHIFT_SCALAR_WORKER_FACING_FIELDS) {
    const i18nKey = `${field}_i18n`;
    if (manualSet.has(i18nKey)) continue;

    const legacy = afterData[field];
    const i18n = afterData[i18nKey] as { en?: string; es?: string } | undefined;
    const source = (i18n?.en ?? (typeof legacy === 'string' ? legacy : undefined))?.trim();
    if (!source) continue;

    out.push(i18nKey);
  }

  return out;
}

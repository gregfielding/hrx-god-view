/**
 * Job-order worker-facing translation: discover staffInstructions.*.text paths and
 * top-level scalar string fields (jobTitle, jobOrderName, policies, etc.).
 * Staff instructions write to staffInstructions_i18n.<section>.es; scalar fields to <field>_i18n.es.
 */

const STAFF_INSTRUCTIONS_KEY = 'staffInstructions';
const TEXT_KEY = 'text';

/** Top-level job order scalar fields that can be shown to workers; translate legacy value → <field>_i18n.es */
export const JOB_ORDER_SCALAR_WORKER_FACING_FIELDS = [
  'jobTitle',
  'jobOrderName',
  'jobOrderDescription',
  'jobDescriptionFromClient',
  'customUniformRequirements',
  'attendancePolicy',
  'callOffPolicy',
  'noShowPolicy',
  'overtimePolicy',
  'injuryHandlingPolicy',
  'requirements',
  'shiftTimes',
  'notes',
] as const;

/**
 * Returns field paths to translate for worker-facing staff instructions:
 * staffInstructions.firstDay.text, staffInstructions.parking.text, etc.
 * Only includes sections that have a non-empty .text string.
 */
export function discoverWorkerFacingJobOrderFields(
  afterData: Record<string, unknown>,
  manualFields: string[] = []
): string[] {
  const manualSet = new Set(manualFields);
  const out: string[] = [];

  const staff = afterData[STAFF_INSTRUCTIONS_KEY];
  if (staff == null || typeof staff !== 'object') return out;

  const sections = staff as Record<string, unknown>;
  for (const sectionKey of Object.keys(sections)) {
    const section = sections[sectionKey];
    if (section == null || typeof section !== 'object') continue;

    const text = (section as Record<string, unknown>)[TEXT_KEY];
    if (typeof text !== 'string' || text.trim() === '') continue;

    const fieldPath = `${STAFF_INSTRUCTIONS_KEY}.${sectionKey}.${TEXT_KEY}`;
    if (manualSet.has(fieldPath)) continue;

    out.push(fieldPath);
  }

  return out;
}

/** Section name from path e.g. staffInstructions.firstDay.text -> firstDay */
export function staffInstructionPathToSection(fieldPath: string): string | null {
  if (!fieldPath.startsWith(`${STAFF_INSTRUCTIONS_KEY}.`) || !fieldPath.endsWith(`.${TEXT_KEY}`))
    return null;
  const middle = fieldPath.slice(STAFF_INSTRUCTIONS_KEY.length + 1, -TEXT_KEY.length - 1);
  return middle || null;
}

/** Write target for worker: staffInstructions.firstDay.text -> staffInstructions_i18n.firstDay.es */
export function staffInstructionPathToI18nWriteKey(fieldPath: string, targetLang: 'es' | 'en'): string | null {
  const section = staffInstructionPathToSection(fieldPath);
  if (section == null) return null;
  return `staffInstructions_i18n.${section}.${targetLang}`;
}

/**
 * Whether the given fieldPath is a worker-facing staff instruction path
 * (contains dots and ends in .text under staffInstructions).
 */
export function isWorkerFacingStaffInstructionPath(fieldPath: string): boolean {
  return staffInstructionPathToSection(fieldPath) !== null;
}

/**
 * Returns _i18n field paths for job-order scalar worker-facing fields that have
 * a non-empty source (legacy field or existing .en). Used to feed translation
 * alongside discoverI18nFields so legacy jobTitle, jobOrderName, etc. get .es.
 */
export function discoverJobOrderScalarI18nCandidates(
  afterData: Record<string, unknown>,
  manualFields: string[] = []
): string[] {
  const manualSet = new Set(manualFields);
  const out: string[] = [];

  for (const field of JOB_ORDER_SCALAR_WORKER_FACING_FIELDS) {
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

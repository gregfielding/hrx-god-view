/**
 * Stable keys for RecruiterJobOrderDetail tab state (URL ?tab=, localStorage).
 * Order matches the tab strip left-to-right; do not reorder without migrating stored state.
 */
export const JOB_ORDER_DETAIL_TAB_KEYS = [
  'overview',
  'checklist',
  'cascading_data',
  'hiring',
  'defaults',
  'staff_instructions',
  'jobs_board',
  'auto_messaging',
  'shift_setup',
  'applications',
  'placements',
  'notes',
  'activity',
] as const;

export type JobOrderDetailTabKey = (typeof JOB_ORDER_DETAIL_TAB_KEYS)[number];

const KEY_SET = new Set<string>(JOB_ORDER_DETAIL_TAB_KEYS);

export function isJobOrderDetailTabKey(s: string): s is JobOrderDetailTabKey {
  return KEY_SET.has(s);
}

export function tabKeyFromLegacyIndex(i: number): JobOrderDetailTabKey | null {
  if (Number.isInteger(i) && i >= 0 && i < JOB_ORDER_DETAIL_TAB_KEYS.length) {
    return JOB_ORDER_DETAIL_TAB_KEYS[i];
  }
  return null;
}

export const DEFAULT_JOB_ORDER_DETAIL_TAB: JobOrderDetailTabKey = 'checklist';

/** Tab strip: order must match JOB_ORDER_DETAIL_TAB_KEYS. */
export const JOB_ORDER_DETAIL_TAB_STRIP: ReadonlyArray<{ key: JobOrderDetailTabKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'checklist', label: 'Checklist' },
  { key: 'cascading_data', label: 'Cascading Data' },
  { key: 'hiring', label: 'Hiring' },
  { key: 'defaults', label: 'Defaults' },
  { key: 'staff_instructions', label: 'Staff Instructions' },
  { key: 'jobs_board', label: 'Jobs Board' },
  { key: 'auto_messaging', label: 'Auto Messaging' },
  { key: 'shift_setup', label: 'Shift Setup' },
  { key: 'applications', label: 'Applications' },
  { key: 'placements', label: 'Placements' },
  { key: 'notes', label: 'Notes' },
  { key: 'activity', label: 'Activity' },
];

const LS_KEY_PREFIX = 'recruiter_job_order_tab_';

export function jobOrderDetailTabStorageKey(jobOrderId: string): string {
  return `${LS_KEY_PREFIX}${jobOrderId}`;
}

/** Parse localStorage value: legacy numeric string or tab key. */
export function parseStoredJobOrderTab(raw: string | null): JobOrderDetailTabKey {
  if (raw == null || raw === '') return DEFAULT_JOB_ORDER_DETAIL_TAB;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    const k = tabKeyFromLegacyIndex(parseInt(trimmed, 10));
    return k ?? DEFAULT_JOB_ORDER_DETAIL_TAB;
  }
  if (isJobOrderDetailTabKey(trimmed)) return trimmed;
  return DEFAULT_JOB_ORDER_DETAIL_TAB;
}

/**
 * Parse ?tab= query: named key (e.g. applications, checklist) or legacy numeric index string.
 */
export function parseJobOrderDetailTabQueryParam(tabParam: string | null): JobOrderDetailTabKey | null {
  if (tabParam == null || !tabParam.trim()) return null;
  const t = tabParam.trim().toLowerCase();
  if (isJobOrderDetailTabKey(t)) return t;
  if (/^\d+$/.test(t)) {
    return tabKeyFromLegacyIndex(parseInt(t, 10));
  }
  return null;
}

/** Auto Messaging tab + shift-based SMS/push: enabled for Gig and Careers job orders. */
export function jobOrderSupportsAutoMessagingTab(jobType: unknown): boolean {
  const j = String(jobType || '').toLowerCase();
  return j === 'gig' || j === 'career';
}

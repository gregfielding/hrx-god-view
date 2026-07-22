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
  // New tabs appended at end so legacy numeric URLs / localStorage values
  // (e.g. ?tab=4 → defaults) keep resolving to their original target.
  // Visual order is controlled separately by JOB_ORDER_DETAIL_TAB_STRIP.
  'positions',
  'requirements',
  // Assignment history (Greg, 2026-07-22) — audit/maintain surface;
  // rows open the admin AssignmentDrawer.
  'assignments',
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

// Checklist tab is hidden from the strip (May 2026), so default
// landing tab is `overview`. The `checklist` key is kept in
// JOB_ORDER_DETAIL_TAB_KEYS and its TabPanel is still rendered, so
// any bookmarked `?tab=checklist` URLs continue to work — they just
// aren't reachable from the visible strip until we re-enable it.
export const DEFAULT_JOB_ORDER_DETAIL_TAB: JobOrderDetailTabKey = 'overview';

/** Tab strip: visual left-to-right order. Independent of
 *  JOB_ORDER_DETAIL_TAB_KEYS, which is the canonical key list and
 *  preserves legacy numeric indices. */
export const JOB_ORDER_DETAIL_TAB_STRIP: ReadonlyArray<{ key: JobOrderDetailTabKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'positions', label: 'Positions' },
  // Slice 2 (May 2026): JO-level Compliance & Requirements are
  // *defaults* that apply to every position; per-position
  // overrides live on the Positions tab. Label reflects that
  // hierarchy so recruiters know where the source of truth is.
  { key: 'requirements', label: 'Default Requirements' },
  // Checklist hidden from the strip (May 2026). Same hidden-but-routable
  // pattern as cascading_data / hiring / defaults below: the key stays in
  // JOB_ORDER_DETAIL_TAB_KEYS and the TabPanel still renders, so old
  // links / localStorage entries pointing at `checklist` keep working
  // even though it's not in the visible nav.
  // { key: 'checklist', label: 'Checklist' },
  // Cascading Data + Hiring + Activity tabs hidden from the nav strip.
  // Their keys remain in JOB_ORDER_DETAIL_TAB_KEYS and their TabPanels
  // are still rendered so any bookmarked URLs (e.g. `?tab=hiring`) and
  // any stored localStorage values don't break — they just aren't
  // reachable from the strip until we re-enable them.
  // { key: 'cascading_data', label: 'Cascading Data' },
  // { key: 'hiring', label: 'Hiring' },
  // { key: 'defaults', label: 'Defaults' },
  { key: 'staff_instructions', label: 'Staff Instructions' },
  { key: 'jobs_board', label: 'Jobs Board' },
  { key: 'auto_messaging', label: 'Auto Messaging' },
  // Renamed from "Shift Setup" → "Shifts" (May 2026). Underlying tab
  // key stays `shift_setup` for storage / URL backward-compat.
  { key: 'shift_setup', label: 'Shifts' },
  { key: 'applications', label: 'Applications' },
  { key: 'placements', label: 'Placements' },
  { key: 'assignments', label: 'Assignments' },
  { key: 'notes', label: 'Notes' },
  // { key: 'activity', label: 'Activity' },
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

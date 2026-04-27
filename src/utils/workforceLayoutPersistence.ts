/**
 * Persists Workforce CSA workspace state per-user across sessions.
 *
 * Keyed by current user's uid (per Phase D spec §2: "save scope + filter
 * selections to `localStorage` keyed by user id"). Different from
 * `usersLayoutPersistence` which uses sessionStorage and a global key —
 * Workforce is a daily workspace that should restore exactly where the CSA
 * left off, including across browser restarts and tab closes.
 *
 * Anything that's not a user-level preference (e.g. drawer open state,
 * snackbar) lives in component state, not here.
 */

import {
  DEFAULT_WORKFORCE_STATUS_FILTERS,
  type WorkforceStatusFilterId,
} from './readinessQueue';

export type WorkforceTabId = 'employee-readiness' | 'job-readiness';

export type WorkforceScope = 'all' | 'mine';

export type WorkforceEntityFilter = string | 'all';

export interface WorkforcePersistedState {
  v: 1;
  /** Last tab the user looked at — restores them there on next visit. */
  lastTab: WorkforceTabId;
  /** All / My toggle. */
  scope: WorkforceScope;
  /** Multi-select status chip ids (Employee Readiness tab). */
  statusFilters: WorkforceStatusFilterId[];
  /** Show `complete_pass` / `complete` rows? Spec §3 — off by default. */
  showComplete: boolean;
  /** Hiring entity dropdown — `'all'` or a specific hiring entity id. */
  entityFilter: WorkforceEntityFilter;
  /**
   * Last search box value. Restored so a CSA mid-investigation who navigates
   * away (worker profile, JO drawer) returns to the same filtered view.
   */
  searchText: string;
}

const STORAGE_KEY_PREFIX = 'hrx_workforce_layout_v1__';

/**
 * Spec §3 default — `My + Needs Review + Failed`. Optimizes for the
 * highest-urgency action set on first visit.
 */
const DEFAULT_STATE: WorkforcePersistedState = {
  v: 1,
  lastTab: 'employee-readiness',
  scope: 'mine',
  statusFilters: [...DEFAULT_WORKFORCE_STATUS_FILTERS],
  showComplete: false,
  entityFilter: 'all',
  searchText: '',
};

/**
 * Anonymous fallback key used when there's no signed-in user (e.g. between
 * auth redeems). Prevents the read from throwing on uid lookup. Not exposed
 * publicly because the fallback bucket isn't tied to anyone's preferences.
 */
const ANON_KEY_SUFFIX = '__anon';

function storageKeyFor(uid: string | null | undefined): string {
  return STORAGE_KEY_PREFIX + (uid && uid.trim() !== '' ? uid : ANON_KEY_SUFFIX);
}

export function loadWorkforceLayoutPersisted(
  uid: string | null | undefined,
): WorkforcePersistedState {
  try {
    const raw = window.localStorage.getItem(storageKeyFor(uid));
    if (!raw) return cloneDefault();
    const parsed = JSON.parse(raw) as Partial<WorkforcePersistedState>;
    return {
      ...DEFAULT_STATE,
      ...parsed,
      v: 1,
      // Be defensive — older versions may have missing / malformed fields,
      // and arrays need to be re-cloned so callers can mutate safely.
      statusFilters: Array.isArray(parsed.statusFilters)
        ? (parsed.statusFilters as WorkforceStatusFilterId[])
        : [...DEFAULT_WORKFORCE_STATUS_FILTERS],
    };
  } catch {
    return cloneDefault();
  }
}

export function persistWorkforceLayout(
  uid: string | null | undefined,
  updates: Partial<WorkforcePersistedState>,
): void {
  try {
    const prev = loadWorkforceLayoutPersisted(uid);
    const next = { ...prev, ...updates, v: 1 as const };
    window.localStorage.setItem(storageKeyFor(uid), JSON.stringify(next));
  } catch {
    // Quota / private mode / SSR — silently ignore.
  }
}

/** Convenience: returns the user's last-used tab id, falling back to default. */
export function getInitialWorkforceTab(uid: string | null | undefined): WorkforceTabId {
  return loadWorkforceLayoutPersisted(uid).lastTab;
}

function cloneDefault(): WorkforcePersistedState {
  return { ...DEFAULT_STATE, statusFilters: [...DEFAULT_WORKFORCE_STATUS_FILTERS] };
}

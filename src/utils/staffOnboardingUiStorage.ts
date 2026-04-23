/**
 * Persists Staff Onboarding hub UI (active tab, per-table page/size, worker search) in sessionStorage
 * so leaving `/staff-onboarding` and returning restores the same view.
 */

const KEY_PREFIX = 'hrx:staffOnboardingUi:';

export type StaffOnboardingUiState = {
  tab: number;
  taxPage: number;
  taxPageSize: number;
  taxSearch: string;
  /** Vertical scroll offset inside the queue table container */
  taxScrollTop: number;
  evPage: number;
  evPageSize: number;
  evSearch: string;
  evScrollTop: number;
  bgPage: number;
  bgPageSize: number;
  bgSearch: string;
  bgScrollTop: number;
};

const PAGE_SIZES = new Set([10, 20, 50, 100]);

const MAX_SEARCH_LEN = 200;

export function defaultStaffOnboardingUi(): StaffOnboardingUiState {
  return {
    tab: 0,
    taxPage: 0,
    taxPageSize: 20,
    taxSearch: '',
    taxScrollTop: 0,
    evPage: 0,
    evPageSize: 20,
    evSearch: '',
    evScrollTop: 0,
    bgPage: 0,
    bgPageSize: 20,
    bgSearch: '',
    bgScrollTop: 0,
  };
}

function clampSearch(s: unknown, fallback: string): string {
  if (typeof s !== 'string') return fallback;
  return s.slice(0, MAX_SEARCH_LEN);
}

function clampInt(n: unknown, fallback: number, min: number, max: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function mergeSaved(o: Partial<StaffOnboardingUiState>): StaffOnboardingUiState {
  const d = defaultStaffOnboardingUi();
  return {
    tab: clampInt(o.tab, d.tab, 0, 2),
    taxPage: clampInt(o.taxPage, d.taxPage, 0, 1_000_000),
    taxPageSize: typeof o.taxPageSize === 'number' && PAGE_SIZES.has(o.taxPageSize) ? o.taxPageSize : d.taxPageSize,
    taxSearch: clampSearch(o.taxSearch, d.taxSearch),
    taxScrollTop: clampInt(o.taxScrollTop, d.taxScrollTop, 0, 2_000_000),
    evPage: clampInt(o.evPage, d.evPage, 0, 1_000_000),
    evPageSize: typeof o.evPageSize === 'number' && PAGE_SIZES.has(o.evPageSize) ? o.evPageSize : d.evPageSize,
    evSearch: clampSearch(o.evSearch, d.evSearch),
    evScrollTop: clampInt(o.evScrollTop, d.evScrollTop, 0, 2_000_000),
    bgPage: clampInt(o.bgPage, d.bgPage, 0, 1_000_000),
    bgPageSize: typeof o.bgPageSize === 'number' && PAGE_SIZES.has(o.bgPageSize) ? o.bgPageSize : d.bgPageSize,
    bgSearch: clampSearch(o.bgSearch, d.bgSearch),
    bgScrollTop: clampInt(o.bgScrollTop, d.bgScrollTop, 0, 2_000_000),
  };
}

export function loadStaffOnboardingUi(tenantId: string): StaffOnboardingUiState | null {
  try {
    const raw = sessionStorage.getItem(KEY_PREFIX + tenantId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StaffOnboardingUiState>;
    return mergeSaved(parsed);
  } catch {
    return null;
  }
}

export function saveStaffOnboardingUi(tenantId: string, state: StaffOnboardingUiState): void {
  try {
    sessionStorage.setItem(KEY_PREFIX + tenantId, JSON.stringify(state));
  } catch {
    /* quota / private mode */
  }
}

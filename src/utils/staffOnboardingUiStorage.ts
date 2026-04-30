/**
 * Persists Staff Onboarding hub UI (active tab, per-table page/size, worker search) in sessionStorage
 * so leaving `/staff-onboarding` and returning restores the same view.
 *
 * **E.7** — Tab layout collapsed from 3 → 2:
 *   - Old tab 0 (Tax + Payroll) and tab 1 (E-Verify) both now map to
 *     the unified "To-Do" tab (new index 0).
 *   - Old tab 2 (Background Checks) maps to new index 1.
 *
 * The legacy `tax*` / `ev*` fields are kept on the state shape so a
 * cached state object from before E.7 deserialises without throwing.
 * They're no longer read by the page itself but staying lossless avoids
 * a Surprise Behavior on user A coming back after the deploy.
 */

const KEY_PREFIX = 'hrx:staffOnboardingUi:';

/**
 * Schema version. Bump when a stored field's *meaning* changes in a way
 * that can't be detected from the value alone. E.7 bumped 1 → 2 because
 * the `tab` index now spans 0–1 instead of 0–2 and we can't tell from
 * `tab: 1` alone whether the user last had pre-E.7 E-Verify or post-E.7
 * Background Checks open. Cached states from version 1 reset their tab
 * to 0 on first load.
 */
const SCHEMA_VERSION = 2;

export type StaffOnboardingUiState = {
  /** Schema version — internal use; consumers ignore. */
  v?: number;
  /** 0 = To-Do (E.7), 1 = Background Checks. */
  tab: number;
  /** @deprecated Pre-E.7 Tax+Payroll tab pagination — kept for backwards compat. */
  taxPage: number;
  /** @deprecated */
  taxPageSize: number;
  /** @deprecated */
  taxSearch: string;
  /** @deprecated */
  taxScrollTop: number;
  /** @deprecated Pre-E.7 E-Verify tab pagination — kept for backwards compat. */
  evPage: number;
  /** @deprecated */
  evPageSize: number;
  /** @deprecated */
  evSearch: string;
  /** @deprecated */
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
    v: SCHEMA_VERSION,
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

/**
 * E.7 migration: a cached `tab` index from the pre-E.7 3-tab layout is
 * ambiguous when it equals `1` (could be old E-Verify or new Background).
 * Rather than guess, reset to the default (To-Do) when the schema
 * version is missing or stale. Less clever, more correct.
 */
function migrateTab(raw: unknown, fallback: number, schemaVersion: number): number {
  if (schemaVersion < SCHEMA_VERSION) return fallback;
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : fallback;
  if (n < 0 || n > 1) return fallback;
  return n;
}

function mergeSaved(o: Partial<StaffOnboardingUiState>): StaffOnboardingUiState {
  const d = defaultStaffOnboardingUi();
  const savedVersion = typeof o.v === 'number' && Number.isFinite(o.v) ? Math.floor(o.v) : 0;
  return {
    v: SCHEMA_VERSION,
    tab: migrateTab(o.tab, d.tab, savedVersion),
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

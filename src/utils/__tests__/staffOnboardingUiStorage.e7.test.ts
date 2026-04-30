/**
 * E.7 — pin the schema-versioned tab migration on
 * `staffOnboardingUiStorage`.
 *
 * The `/staff-onboarding` page collapsed from a 3-tab layout (Tax /
 * E-Verify / Background) to a 2-tab layout (To-Do / Background). A
 * cached `tab: 1` is ambiguous between pre-E.7 E-Verify and post-E.7
 * Background — so the schema bumped 1 → 2 and unversioned states reset
 * their tab on first load. This test pins both the migration behavior
 * and the round-trip preservation for already-versioned states.
 */

import {
  defaultStaffOnboardingUi,
  loadStaffOnboardingUi,
  saveStaffOnboardingUi,
} from '../staffOnboardingUiStorage';

const TENANT = 'test-tenant';
const KEY = `hrx:staffOnboardingUi:${TENANT}`;

describe('E.7 — staffOnboardingUiStorage tab migration', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('returns a fresh default with v=2 when there is no saved state', () => {
    expect(loadStaffOnboardingUi(TENANT)).toBeNull();
    const fresh = defaultStaffOnboardingUi();
    expect(fresh.v).toBe(2);
    expect(fresh.tab).toBe(0);
  });

  it('resets tab=0 when loading a pre-E.7 (unversioned) state where tab was 0 (Tax)', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ tab: 0, taxPage: 3, taxPageSize: 50 }));
    const loaded = loadStaffOnboardingUi(TENANT);
    expect(loaded?.tab).toBe(0);
  });

  it('resets tab=0 when loading a pre-E.7 state where tab was 1 (E-Verify, ambiguous)', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ tab: 1, evPage: 3, evPageSize: 50 }));
    const loaded = loadStaffOnboardingUi(TENANT);
    // Without the schema version, tab=1 could mean old E-Verify or new
    // Background. Reset to To-Do to avoid accidentally landing on Background.
    expect(loaded?.tab).toBe(0);
  });

  it('resets tab=0 when loading a pre-E.7 state where tab was 2 (Background)', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ tab: 2, bgPage: 3 }));
    const loaded = loadStaffOnboardingUi(TENANT);
    expect(loaded?.tab).toBe(0);
  });

  it('preserves tab=1 when loading an already-E.7-versioned state (Background tab)', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ v: 2, tab: 1, bgPage: 3, bgPageSize: 100 }));
    const loaded = loadStaffOnboardingUi(TENANT);
    expect(loaded?.tab).toBe(1);
    expect(loaded?.bgPage).toBe(3);
    expect(loaded?.bgPageSize).toBe(100);
  });

  it('clamps tab to 0..1 even with v=2', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ v: 2, tab: 5 }));
    const loaded = loadStaffOnboardingUi(TENANT);
    expect(loaded?.tab).toBe(0);
  });

  it('round-trips: save then load preserves the tab and page state', () => {
    const state = { ...defaultStaffOnboardingUi(), tab: 1, bgPage: 7 };
    saveStaffOnboardingUi(TENANT, state);
    const reloaded = loadStaffOnboardingUi(TENANT);
    expect(reloaded?.tab).toBe(1);
    expect(reloaded?.bgPage).toBe(7);
    expect(reloaded?.v).toBe(2);
  });
});

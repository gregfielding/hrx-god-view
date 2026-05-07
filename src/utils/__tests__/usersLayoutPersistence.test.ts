/**
 * Tests for the visibility filter on the users-layout tab pill row.
 *
 * Specifically asserts the `bulk-import` tab is gated at sec >= 7
 * (BI.1 Appendix A.E). The route gate (`<ProtectedRoute>`) is the
 * load-bearing security boundary; this filter is only the UI hint
 * that hides the pill from non-admin users.
 */

import {
  USERS_LAYOUT_TAB_CONFIG,
  getActiveUsersTab,
  getVisibleUsersTabs,
} from '../usersLayoutPersistence';
import { SecurityLevel } from '../AccessRoles';

describe('usersLayoutPersistence', () => {
  describe('USERS_LAYOUT_TAB_CONFIG', () => {
    it('includes the bulk-import tab gated at sec 7', () => {
      const row = USERS_LAYOUT_TAB_CONFIG.find((r) => r.tab === 'bulk-import');
      expect(row).toBeDefined();
      expect(row?.path).toBe('/users/bulk-import');
      expect(row?.minSecurityLevel).toBe('7');
    });

    it('leaves common list tabs ungated', () => {
      const all = USERS_LAYOUT_TAB_CONFIG.find((r) => r.tab === 'all');
      const my = USERS_LAYOUT_TAB_CONFIG.find((r) => r.tab === 'my');
      expect(all?.minSecurityLevel).toBeUndefined();
      expect(my?.minSecurityLevel).toBeUndefined();
    });
  });

  describe('getVisibleUsersTabs', () => {
    function tabs(level: SecurityLevel | null | undefined): string[] {
      return getVisibleUsersTabs(level).map((r) => r.tab);
    }

    it('hides bulk-import for sec < 7', () => {
      const levels: SecurityLevel[] = ['0', '1', '2', '3', '4', '5', '6'];
      for (const lvl of levels) {
        expect(tabs(lvl)).not.toContain('bulk-import');
      }
    });

    it('shows bulk-import for sec 7', () => {
      expect(tabs('7')).toContain('bulk-import');
    });

    it('treats null / undefined securityLevel as 0 (hides bulk-import)', () => {
      expect(tabs(null)).not.toContain('bulk-import');
      expect(tabs(undefined)).not.toContain('bulk-import');
    });

    it('always includes ungated tabs regardless of level', () => {
      for (const lvl of ['0', '5', '7'] as SecurityLevel[]) {
        const visible = tabs(lvl);
        expect(visible).toContain('all');
        expect(visible).toContain('my');
        expect(visible).toContain('user-groups');
      }
    });
  });

  describe('getActiveUsersTab', () => {
    it('returns bulk-import for /users/bulk-import', () => {
      expect(getActiveUsersTab('/users/bulk-import')).toBe('bulk-import');
    });

    it('returns bulk-import for child paths under bulk-import', () => {
      expect(getActiveUsersTab('/users/bulk-import/new')).toBe('bulk-import');
      expect(getActiveUsersTab('/users/bulk-import/imports')).toBe('bulk-import');
    });

    it('does not collide with the canonical all/my matchers', () => {
      expect(getActiveUsersTab('/users/all')).toBe('all');
      expect(getActiveUsersTab('/users/my')).toBe('my');
    });
  });
});

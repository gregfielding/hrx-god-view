/**
 * Persists Users hub tab path + header search/favorites across navigations that unmount
 * UsersLayout (e.g. /users/user-groups → /usergroups/:id).
 */

export type UsersTab =
  | 'all'
  | 'my'
  | 'invite-users'
  | 'user-groups'
  | 'my-user-groups'
  | 'smart-groups'
  | 'all-smart-groups'
  | 'my-smart-groups';

export const USERS_LAYOUT_TAB_CONFIG: { tab: UsersTab; path: string; label: string }[] = [
  { tab: 'all', path: '/users/all', label: 'All Users' },
  { tab: 'my', path: '/users/my', label: 'My Users' },
  // Hidden from the toolbar — the route still exists for direct navigation
  // and any in-flight links, but the pill is suppressed per product request.
  // Re-enable by uncommenting the row below.
  // { tab: 'invite-users', path: '/users/invite-users', label: 'Invite Users' },
  { tab: 'user-groups', path: '/users/user-groups', label: 'User Groups' },
  { tab: 'my-user-groups', path: '/users/my-user-groups', label: 'My User Groups' },
  { tab: 'smart-groups', path: '/users/smart-groups', label: 'Add Smart Group' },
  { tab: 'all-smart-groups', path: '/users/all-smart-groups', label: 'Smart Groups' },
  { tab: 'my-smart-groups', path: '/users/my-smart-groups', label: 'My Smart Groups' },
];

const STORAGE_KEY = 'hrx_users_layout_v1';

export type UsersLayoutPersistedState = {
  v: 1;
  /** Last Users hub list route (exact path), e.g. /users/user-groups */
  lastListPath: string;
  /** Shared header search for All Users + My Users */
  usersListSearch: string;
  usersListFavoritesOnly: boolean;
  userGroupsSearch: string;
  userGroupsFavoritesOnly: boolean;
  /**
   * Shared header search for the Smart Groups list tabs (All Smart Groups +
   * My Smart Groups). Smart Groups don't have a favorites concept yet, so
   * there's no `smartGroupsFavoritesOnly` companion.
   */
  smartGroupsSearch: string;
};

const DEFAULT_STATE: UsersLayoutPersistedState = {
  v: 1,
  lastListPath: '/users/all',
  usersListSearch: '',
  usersListFavoritesOnly: false,
  userGroupsSearch: '',
  userGroupsFavoritesOnly: false,
  smartGroupsSearch: '',
};

export function pathIsUsersListPath(pathname: string): boolean {
  return USERS_LAYOUT_TAB_CONFIG.some((t) => t.path === pathname);
}

export function loadUsersLayoutPersisted(): UsersLayoutPersistedState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const p = JSON.parse(raw) as Partial<UsersLayoutPersistedState>;
    return { ...DEFAULT_STATE, ...p, v: 1 };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function persistUsersLayout(updates: Partial<UsersLayoutPersistedState>): void {
  try {
    const prev = loadUsersLayoutPersisted();
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...prev, ...updates, v: 1 }));
  } catch {
    // ignore quota / private mode
  }
}

/** Target for `<Route index>` under `/users`. */
export function getUsersIndexRedirectPath(): string {
  const { lastListPath } = loadUsersLayoutPersisted();
  return pathIsUsersListPath(lastListPath) ? lastListPath : DEFAULT_STATE.lastListPath;
}

export function getActiveUsersTab(pathname: string): UsersTab {
  // Order matters — match the longest / most specific path first so
  // `/users/my-user-groups` doesn't accidentally resolve to `user-groups`.
  if (pathname.includes('/users/my-user-groups')) return 'my-user-groups';
  if (pathname.includes('/users/user-groups')) return 'user-groups';
  if (pathname.includes('/users/my-smart-groups')) return 'my-smart-groups';
  if (pathname.includes('/users/all-smart-groups')) return 'all-smart-groups';
  if (pathname.includes('/users/smart-groups')) return 'smart-groups';
  if (pathname.includes('/users/invite-users')) return 'invite-users';
  if (pathname.includes('/users/my')) return 'my';
  if (pathname.includes('/users/all')) return 'all';
  return 'all';
}

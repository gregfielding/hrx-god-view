/**
 * Users Layout
 *
 * Single header with tabs: All Users | My Users | Invite Users | User Groups | Smart Groups | All Smart Groups | My Smart Groups.
 * Search (with Favorites) and, for User Groups, Create button are in the header, right-justified.
 *
 * Tab path + header search/favorites persist in sessionStorage so leaving the layout (e.g. opening
 * /usergroups/:id) and returning via /users restores the prior list tab and filters.
 */

import React, { useEffect, useState } from 'react';
import { Box, Button, Divider, IconButton, Tooltip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import PersonAddAlt1OutlinedIcon from '@mui/icons-material/PersonAddAlt1Outlined';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
// import { OnCallI9SupportingReminderDialog } from '../components/staffOnboarding/OnCallI9SupportingReminderDialog';
import UniversalSearchBar from '../components/UniversalSearchBar';
import AddWorkerManuallyWizard from '../components/users/AddWorkerManuallyWizard';
import {
  USERS_LAYOUT_TAB_CONFIG,
  getActiveUsersTab,
  loadUsersLayoutPersisted,
  pathIsUsersListPath,
  persistUsersLayout,
  type UsersTab,
} from '../utils/usersLayoutPersistence';
import { useAuth } from '../contexts/AuthContext';

export type { UsersTab };

export interface UsersLayoutOutletContext {
  usersTab: UsersTab;
  /** Live value of the search input — updates on every keystroke. Use for
   *  cheap in-memory filters that run over already-loaded rows. */
  search?: string;
  setSearch?: (value: string) => void;
  /** Committed query — only updates on Enter, Clear (X), or suggestion-pick.
   *  Use for expensive paths (full-collection scans, server callables). When
   *  not provided, callers should fall back to `search`. */
  submittedSearch?: string;
  setSubmittedSearch?: (value: string) => void;
  showFavoritesOnly?: boolean;
  setShowFavoritesOnly?: (value: boolean) => void;
  openCreateGroupForm?: boolean;
  setOpenCreateGroupForm?: (value: boolean) => void;
  /**
   * Show/hide state for the inline filter row on the All Users / My Users
   * tabs. Lifted up here (mirrors `/jobs/job-orders` and `/shifts/list`) so
   * the toggle button can live in the layout's tab strip rather than the
   * page body. Optional because list pages without inline filters (Smart
   * Groups, etc.) don't surface a button. The button only appears when
   * `usersTab === 'all' || usersTab === 'my'`.
   */
  filtersExpanded?: boolean;
  setFiltersExpanded?: (value: boolean) => void;
  /**
   * Detail outlet pages (e.g. `SavedSmartGroupDetailPage`) can register a node
   * here to be rendered in the tabs row's right-actions slot. When set, this
   * overrides the layout's default search/create actions for that route.
   * Pass `null` to clear (the child should call this on unmount).
   */
  setOutletRightActions: (node: React.ReactNode | null) => void;
}

const UsersLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;
  const activeTab = getActiveUsersTab(pathname);
  const { activeTenant, isHRX, currentClaimsRole, securityLevel } = useAuth();
  // const [i9MasterReminderOpen, setI9MasterReminderOpen] = useState(false);

  // "Create Worker on Behalf" wizard — opens from the Users tab right-actions
  // slot when the active tab is All Users / My Users. Server-side
  // permission gate (`canManageEveree`) is the source of truth; mirror
  // it here so the button is hidden when the recruiter wouldn't be able
  // to use it. Numeric coercion tolerates the historical string/number
  // mix on `securityLevel` (see `evereeAccessGate.ts`).
  const [showCreateWorkerWizard, setShowCreateWorkerWizard] = useState(false);
  const numericSecurityLevel = (() => {
    const n = parseInt(String(securityLevel ?? '0').trim(), 10);
    return Number.isFinite(n) ? n : 0;
  })();
  const canCreateWorkerOnBehalf =
    isHRX ||
    currentClaimsRole === 'Admin' ||
    currentClaimsRole === 'Manager' ||
    currentClaimsRole === 'Recruiter' ||
    numericSecurityLevel >= 5;

  /* Temporary prescreen backfill (triggerRecentUserInterviewBackfill) — restore if needed:
  const [backfillLoading, setBackfillLoading] = useState(false);
  const runInterviewBackfill = useCallback(async (dryRun: boolean) => { ... }, [activeTenant?.id]);
  + imports: httpsCallable, functions, formatFirebaseHttpsError, Alert, CircularProgress
  + JSX Alert banner below PageHeader
  */

  const persisted = loadUsersLayoutPersisted();
  const [usersSearch, setUsersSearch] = useState(persisted.usersListSearch);
  /**
   * Committed search — only updated on Enter, Clear, or suggestion-pick.
   * Drives the expensive full-collection `searchRecruiterTableUsers` callable
   * in `RecruiterUsers`, so we don't burn a 8.5k-doc server scan on every
   * keystroke. Initialized from the same persisted slot as the live value so
   * that returning to the tab restores both halves consistently.
   */
  const [usersSearchCommitted, setUsersSearchCommitted] = useState(persisted.usersListSearch);
  const [usersShowFavoritesOnly, setUsersShowFavoritesOnly] = useState(persisted.usersListFavoritesOnly);
  const [groupsSearch, setGroupsSearch] = useState(persisted.userGroupsSearch);
  const [groupsShowFavoritesOnly, setGroupsShowFavoritesOnly] = useState(persisted.userGroupsFavoritesOnly);
  // Smart Groups list tabs share a single search box (All Smart Groups + My
  // Smart Groups). No favorites companion — see `usersLayoutPersistence.ts`.
  const [smartGroupsSearch, setSmartGroupsSearch] = useState(persisted.smartGroupsSearch);
  const [openCreateGroupForm, setOpenCreateGroupForm] = useState(false);
  // Mirrors `/jobs/job-orders`: the inline filter row on All Users / My
  // Users is collapsed by default and toggled from this layout's tab
  // strip. Resets when the user switches between the two tabs so each
  // starts clean.
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  // Slot for child outlet pages to inject their own right-side actions into
  // the tabs row. Cleared when the child unmounts. See `UsersLayoutOutletContext`.
  const [outletRightActions, setOutletRightActions] = useState<React.ReactNode | null>(null);

  useEffect(() => {
    if (pathIsUsersListPath(pathname)) {
      persistUsersLayout({ lastListPath: pathname });
    }
  }, [pathname]);

  useEffect(() => {
    persistUsersLayout({
      usersListSearch: usersSearch,
      usersListFavoritesOnly: usersShowFavoritesOnly,
      userGroupsSearch: groupsSearch,
      userGroupsFavoritesOnly: groupsShowFavoritesOnly,
      smartGroupsSearch,
    });
  }, [usersSearch, usersShowFavoritesOnly, groupsSearch, groupsShowFavoritesOnly, smartGroupsSearch]);

  const isUsersTab = activeTab === 'all' || activeTab === 'my';
  // The "All / Mine" pair for user groups shares the same search +
  // favorites state so toggling between them feels seamless. Only the
  // canonical `user-groups` tab gets the Create button.
  const isUserGroupsTab = activeTab === 'user-groups' || activeTab === 'my-user-groups';
  const isCreatableUserGroupsTab = activeTab === 'user-groups';
  // The "All / Mine" pair for smart-group LISTS share a search box too.
  // The standalone Add Smart Group builder (`/users/smart-groups`) is its
  // own thing and doesn't get a header search.
  const isSmartGroupsListTab = activeTab === 'all-smart-groups' || activeTab === 'my-smart-groups';

  // Reset filter visibility when the user crosses the Users boundary
  // (entering or leaving All / My Users) so the next visit always starts
  // collapsed — mirrors the parallel reset in <RecruiterDashboard>.
  useEffect(() => {
    if (!isUsersTab && filtersExpanded) {
      setFiltersExpanded(false);
    }
    // Intentionally only depends on `isUsersTab` so we don't keep
    // re-collapsing while the user toggles within Users tabs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUsersTab]);

  const outletContext: UsersLayoutOutletContext = {
    usersTab: activeTab,
    ...(isUsersTab && {
      search: usersSearch,
      setSearch: setUsersSearch,
      submittedSearch: usersSearchCommitted,
      setSubmittedSearch: setUsersSearchCommitted,
      showFavoritesOnly: usersShowFavoritesOnly,
      setShowFavoritesOnly: setUsersShowFavoritesOnly,
      filtersExpanded,
      setFiltersExpanded,
    }),
    ...(isUserGroupsTab && {
      search: groupsSearch,
      setSearch: setGroupsSearch,
      showFavoritesOnly: groupsShowFavoritesOnly,
      setShowFavoritesOnly: setGroupsShowFavoritesOnly,
      openCreateGroupForm,
      setOpenCreateGroupForm,
    }),
    ...(isSmartGroupsListTab && {
      search: smartGroupsSearch,
      setSearch: setSmartGroupsSearch,
    }),
    setOutletRightActions,
  };

  // Detail outlet pages (e.g. Smart Group detail) can take over the right
  // side of the tabs row by calling `setOutletRightActions(...)`. When they
  // do, their node wins over the layout's default search/create actions.
  const rightActions = outletRightActions ?? (
    isUsersTab ? (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        {/* I-9 reminders (all onboarding) — hidden per product request; restore with OnCallI9SupportingReminderDialog + state above
        <Tooltip title="Temporary: SMS workers in W-2 onboarding who still need I-9 supporting uploads (not on-call only). Preview first.">
          <Button
            variant="outlined"
            color="warning"
            size="small"
            onClick={() => setI9MasterReminderOpen(true)}
            sx={{ textTransform: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            I-9 reminders (all onboarding)
          </Button>
        </Tooltip>
        */}
        {canCreateWorkerOnBehalf && (
          <Tooltip title="Create the worker's HRX account directly (no email link). Use when the worker can't sign up themselves.">
            <Button
              variant="outlined"
              color="primary"
              size="small"
              startIcon={<PersonAddAlt1OutlinedIcon />}
              onClick={() => setShowCreateWorkerWizard(true)}
              sx={{ textTransform: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              Create Worker on Behalf
            </Button>
          </Tooltip>
        )}
        <UniversalSearchBar
          value={usersSearch}
          onChange={setUsersSearch}
          // Enter / Clear / suggestion-pick → commit. The expensive
          // full-collection scan only fires on commit; live keystrokes
          // drive only the in-memory filter on already-loaded rows.
          onSearch={setUsersSearchCommitted}
          placeholder="Search workers — press Enter"
          favoriteType="users"
          showFavoritesOnly={usersShowFavoritesOnly}
          onToggleFavorites={setUsersShowFavoritesOnly}
        />
      </Box>
    ) : isSmartGroupsListTab ? (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <UniversalSearchBar
          value={smartGroupsSearch}
          onChange={setSmartGroupsSearch}
          onSearch={setSmartGroupsSearch}
          placeholder={
            activeTab === 'my-smart-groups'
              ? 'Search my smart groups...'
              : 'Search smart groups...'
          }
          // No favorites concept on smart groups yet — the universal bar
          // gracefully shows the ⌘K hint where the star would be.
        />
      </Box>
    ) : isUserGroupsTab ? (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <UniversalSearchBar
          value={groupsSearch}
          onChange={setGroupsSearch}
          onSearch={setGroupsSearch}
          placeholder={activeTab === 'my-user-groups' ? 'Search my groups...' : 'Search groups...'}
          favoriteType="userGroups"
          showFavoritesOnly={groupsShowFavoritesOnly}
          onToggleFavorites={setGroupsShowFavoritesOnly}
        />
        {/* Create button is only meaningful on the unfiltered All view —
            on /users/my-user-groups the user is just reviewing their own
            managed groups, so we omit it. */}
        {isCreatableUserGroupsTab && (
          <Tooltip title="Create new group">
            <IconButton
              onClick={() => setOpenCreateGroupForm(true)}
              sx={{
                width: 32,
                height: 32,
                bgcolor: '#0057B8',
                color: '#fff',
                '&:hover': { bgcolor: '#004a9f' },
              }}
            >
              <AddIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    ) : null
  );

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      {/* <OnCallI9SupportingReminderDialog
        open={i9MasterReminderOpen}
        onClose={() => setI9MasterReminderOpen(false)}
        tenantId={activeTenant?.id}
        audience="all_w2_onboarding"
      /> */}
      {/* Tab row matches compact User Profile header tabs (UserProfile/index.tsx). */}
      {/* was: title="Users" · subtitle="All users, groups, and smart groups" (duplicated top bar; use hideHeading) */}
      <PageHeader
        hideHeading
        dense
        // No divider line under the toolbar — the table below already
        // provides enough visual separation, and removing it gives the
        // page a cleaner "single surface" feel.
        showDivider={false}
        // Uniform 8px gutter above and below the tabs row — keeps the
        // header area visually balanced with the tabbed navigation pills
        // sitting in the middle.
        sx={{ pt: '8px', pb: '8px' }}
        title=""
        filters={
          <Box sx={{ display: 'flex', gap: 0.35, alignItems: 'center', flexWrap: 'wrap' }}>
            {USERS_LAYOUT_TAB_CONFIG.map(({ tab, path, label }) => {
              const isActive = activeTab === tab;
              return (
                <Button
                  key={tab}
                  onClick={() => navigate(path)}
                  variant="text"
                  sx={{
                    textTransform: 'none',
                    borderRadius: '999px',
                    fontSize: '13px',
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? 'white' : 'rgba(0, 0, 0, 0.7)',
                    bgcolor: isActive ? '#0057B8' : 'rgba(0, 0, 0, 0.04)',
                    px: 1.25,
                    py: 0.5,
                    minHeight: 30,
                    minWidth: 'auto',
                    whiteSpace: 'nowrap',
                    '&:hover': {
                      bgcolor: isActive ? '#004a9f' : 'rgba(0, 0, 0, 0.08)',
                    },
                  }}
                >
                  {label}
                </Button>
              );
            })}

            {/* Show/Hide filters — design copied from `/jobs/job-orders`
                (which itself mirrors `/shifts/list`). The matching
                collapsible filter row lives in <RecruiterUsers> and
                reads `filtersExpanded` from outlet context. The toggle
                only appears on the All Users / My Users tabs because
                User Groups / Smart Groups don't have an inline filter
                row. */}
            {isUsersTab && (
              <>
                <Divider
                  orientation="vertical"
                  flexItem
                  sx={{ mx: 0.5, my: 0.5, borderColor: 'rgba(0, 0, 0, 0.08)' }}
                />
                <Button
                  variant="text"
                  onClick={() => setFiltersExpanded(!filtersExpanded)}
                  sx={{
                    textTransform: 'none',
                    borderRadius: '999px',
                    fontSize: '13px',
                    fontWeight: 500,
                    color: '#0057B8',
                    bgcolor: 'rgba(0, 87, 184, 0.06)',
                    px: 1.25,
                    py: 0.5,
                    minHeight: 30,
                    minWidth: 'auto',
                    lineHeight: 1.2,
                    '&:hover': {
                      bgcolor: 'rgba(0, 87, 184, 0.1)',
                    },
                  }}
                >
                  {filtersExpanded ? 'Hide Filters' : 'Show Filters'}
                </Button>
              </>
            )}
          </Box>
        }
        rightActions={rightActions}
      />
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          overflowY: 'auto',
          overflowX: 'auto',
          display: 'flex',
          flexDirection: 'column',
          paddingTop: 0,
          // 4px of bottom padding — small breathing room above the global
          // Layout outlet pb (src/components/Layout.tsx adds 16px of pb to
          // every authenticated page), without double-stacking.
          pb: '4px',
          '&::-webkit-scrollbar': { width: '8px', height: '8px' },
          '&::-webkit-scrollbar-track': {
            background: 'rgba(0, 0, 0, 0.02)',
            borderRadius: '4px',
          },
          '&::-webkit-scrollbar-thumb': {
            background: 'rgba(0, 0, 0, 0.15)',
            borderRadius: '4px',
            '&:hover': { background: 'rgba(0, 0, 0, 0.25)' },
          },
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(0, 0, 0, 0.15) rgba(0, 0, 0, 0.02)',
        }}
      >
        <Outlet context={outletContext} />
      </Box>
      {/* Wizard for "Create Worker on Behalf". Mounted at the layout level
          so it's available from any of the Users tabs (All / My / etc.).
          Active tenant is sourced from `useAuth().activeTenant.id` — every
          callable invocation needs a tenantId, and the layout already
          gates the button on the tenant being present. */}
      {activeTenant?.id && (
        <AddWorkerManuallyWizard
          open={showCreateWorkerWizard}
          onClose={() => setShowCreateWorkerWizard(false)}
          tenantId={activeTenant.id}
        />
      )}
    </Box>
  );
};

export default UsersLayout;

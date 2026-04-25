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
import { Box, Button, IconButton, Tooltip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
// import { OnCallI9SupportingReminderDialog } from '../components/staffOnboarding/OnCallI9SupportingReminderDialog';
import UniversalSearchBar from '../components/UniversalSearchBar';
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
  search?: string;
  setSearch?: (value: string) => void;
  showFavoritesOnly?: boolean;
  setShowFavoritesOnly?: (value: boolean) => void;
  openCreateGroupForm?: boolean;
  setOpenCreateGroupForm?: (value: boolean) => void;
}

const UsersLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;
  const activeTab = getActiveUsersTab(pathname);
  const { activeTenant } = useAuth();
  // const [i9MasterReminderOpen, setI9MasterReminderOpen] = useState(false);

  /* Temporary prescreen backfill (triggerRecentUserInterviewBackfill) — restore if needed:
  const [backfillLoading, setBackfillLoading] = useState(false);
  const runInterviewBackfill = useCallback(async (dryRun: boolean) => { ... }, [activeTenant?.id]);
  + imports: httpsCallable, functions, formatFirebaseHttpsError, Alert, CircularProgress
  + JSX Alert banner below PageHeader
  */

  const persisted = loadUsersLayoutPersisted();
  const [usersSearch, setUsersSearch] = useState(persisted.usersListSearch);
  const [usersShowFavoritesOnly, setUsersShowFavoritesOnly] = useState(persisted.usersListFavoritesOnly);
  const [groupsSearch, setGroupsSearch] = useState(persisted.userGroupsSearch);
  const [groupsShowFavoritesOnly, setGroupsShowFavoritesOnly] = useState(persisted.userGroupsFavoritesOnly);
  const [openCreateGroupForm, setOpenCreateGroupForm] = useState(false);

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
    });
  }, [usersSearch, usersShowFavoritesOnly, groupsSearch, groupsShowFavoritesOnly]);

  const isUsersTab = activeTab === 'all' || activeTab === 'my';
  // The "All / Mine" pair for user groups shares the same search +
  // favorites state so toggling between them feels seamless. Only the
  // canonical `user-groups` tab gets the Create button.
  const isUserGroupsTab = activeTab === 'user-groups' || activeTab === 'my-user-groups';
  const isCreatableUserGroupsTab = activeTab === 'user-groups';

  const outletContext: UsersLayoutOutletContext = {
    usersTab: activeTab,
    ...(isUsersTab && {
      search: usersSearch,
      setSearch: setUsersSearch,
      showFavoritesOnly: usersShowFavoritesOnly,
      setShowFavoritesOnly: setUsersShowFavoritesOnly,
    }),
    ...(isUserGroupsTab && {
      search: groupsSearch,
      setSearch: setGroupsSearch,
      showFavoritesOnly: groupsShowFavoritesOnly,
      setShowFavoritesOnly: setGroupsShowFavoritesOnly,
      openCreateGroupForm,
      setOpenCreateGroupForm,
    }),
  };

  const rightActions =
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
        <UniversalSearchBar
          value={usersSearch}
          onChange={setUsersSearch}
          onSearch={setUsersSearch}
          placeholder="Search by name, email, or phone..."
          favoriteType="users"
          showFavoritesOnly={usersShowFavoritesOnly}
          onToggleFavorites={setUsersShowFavoritesOnly}
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
    ) : null;

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
        // Dense pt is 7px (0.875 * 8); bump it by 2px so the tab pills
        // don't sit flush against the app bar.
        sx={{ pt: '9px' }}
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
          paddingTop: '8px',
          // No bottom padding here — the global Layout outlet
          // (src/components/Layout.tsx) already adds 16px of pb to every
          // authenticated page, so anything here would double-stack.
          pb: 0,
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
    </Box>
  );
};

export default UsersLayout;

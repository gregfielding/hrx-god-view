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
import { Box, Button, Tooltip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { useAuth } from '../contexts/AuthContext';
import { OnCallI9SupportingReminderDialog } from '../components/staffOnboarding/OnCallI9SupportingReminderDialog';
import InboxSearchBar from '../components/InboxSearchBar';
import FavoritesFilter from '../components/FavoritesFilter';
import {
  USERS_LAYOUT_TAB_CONFIG,
  getActiveUsersTab,
  loadUsersLayoutPersisted,
  pathIsUsersListPath,
  persistUsersLayout,
  type UsersTab,
} from '../utils/usersLayoutPersistence';

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
  const [i9MasterReminderOpen, setI9MasterReminderOpen] = useState(false);

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
  const isUserGroupsTab = activeTab === 'user-groups';

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
        <InboxSearchBar
          value={usersSearch}
          onChange={setUsersSearch}
          onSearch={setUsersSearch}
          placeholder="Search by name, email, or phone..."
        />
        <FavoritesFilter
          favoriteType="users"
          showFavoritesOnly={usersShowFavoritesOnly}
          onToggle={setUsersShowFavoritesOnly}
          showText={false}
          size="small"
          sx={{
            minWidth: '32px',
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            '&:hover': {
              backgroundColor: usersShowFavoritesOnly ? 'primary.dark' : 'action.hover',
            },
          }}
        />
      </Box>
    ) : isUserGroupsTab ? (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <InboxSearchBar
          value={groupsSearch}
          onChange={setGroupsSearch}
          onSearch={setGroupsSearch}
          placeholder="Search groups..."
        />
        <FavoritesFilter
          favoriteType="userGroups"
          showFavoritesOnly={groupsShowFavoritesOnly}
          onToggle={setGroupsShowFavoritesOnly}
          showText={false}
          size="small"
          sx={{
            minWidth: '32px',
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            '&:hover': {
              backgroundColor: groupsShowFavoritesOnly ? 'primary.dark' : 'action.hover',
            },
          }}
        />
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setOpenCreateGroupForm(true)}
          sx={{
            textTransform: 'none',
            borderRadius: '24px',
            px: 2.5,
            py: 1,
            height: '40px',
            fontWeight: 500,
            fontSize: '14px',
            bgcolor: '#0057B8',
            boxShadow: '0 2px 8px rgba(0, 87, 184, 0.25)',
            '&:hover': {
              bgcolor: '#004a9f',
              boxShadow: '0 4px 12px rgba(0, 87, 184, 0.35)',
            },
            whiteSpace: 'nowrap',
          }}
        >
          Create New Group
        </Button>
      </Box>
    ) : null;

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <OnCallI9SupportingReminderDialog
        open={i9MasterReminderOpen}
        onClose={() => setI9MasterReminderOpen(false)}
        tenantId={activeTenant?.id}
        audience="all_w2_onboarding"
      />
      <PageHeader
        title="Users"
        subtitle="All users, groups, and smart groups"
        filters={
          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
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
                    fontSize: '14px',
                    fontWeight: isActive ? 500 : 400,
                    color: isActive ? 'white' : 'rgba(0, 0, 0, 0.7)',
                    bgcolor: isActive ? '#0057B8' : 'rgba(0, 0, 0, 0.04)',
                    px: 1.5,
                    py: 0.75,
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
          overflowY: 'auto',
          overflowX: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          pb: 2,
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

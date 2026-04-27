import React from 'react';
import { Box } from '@mui/material';
import { useOutletContext } from 'react-router-dom';

import { useAuth } from '../../contexts/AuthContext';
import UserGroupsTab from '../AgencyProfile/components/UserGroupsTab';
import type { UsersLayoutOutletContext } from '../../pages/UsersLayout';

export interface TenantUserGroupsProps {
  hideHeader?: boolean;
  /**
   * `'all'` (default) shows every user group in the tenant.
   * `'mine'` filters down to groups where the current viewer's uid is
   * present in `groupManagerIds` — used by the `/users/my-user-groups`
   * tab to give group managers a focused view of their own groups.
   */
  scope?: 'all' | 'mine';
}

const TenantUserGroups: React.FC<TenantUserGroupsProps> = ({
  hideHeader = false,
  scope = 'all',
}) => {
  const { tenantId } = useAuth();
  const layoutContext = useOutletContext<UsersLayoutOutletContext>();
  if (!tenantId) return null;
  return (
    // `flex: 1, minHeight: 0` (instead of height: 100%) so the inner table
    // can stretch to fill the UsersLayout outlet's flex column container —
    // height percentages don't reliably propagate through a scrollable
    // flex parent in all browsers.
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <UserGroupsTab
        tenantId={tenantId}
        hideHeader={hideHeader}
        scope={scope}
        layoutSearch={hideHeader ? layoutContext.search : undefined}
        layoutSetSearch={hideHeader ? layoutContext.setSearch : undefined}
        layoutShowFavoritesOnly={hideHeader ? layoutContext.showFavoritesOnly : undefined}
        layoutSetShowFavoritesOnly={hideHeader ? layoutContext.setShowFavoritesOnly : undefined}
        layoutOpenCreateForm={hideHeader ? layoutContext.openCreateGroupForm : undefined}
        layoutSetOpenCreateForm={hideHeader ? layoutContext.setOpenCreateGroupForm : undefined}
      />
    </Box>
  );
};

export default TenantUserGroups; 
import React from 'react';
import { Box } from '@mui/material';
import { useOutletContext } from 'react-router-dom';

import { useAuth } from '../../contexts/AuthContext';
import UserGroupsTab from '../AgencyProfile/components/UserGroupsTab';
import type { UsersLayoutOutletContext } from '../../pages/UsersLayout';

export interface TenantUserGroupsProps {
  hideHeader?: boolean;
}

const TenantUserGroups: React.FC<TenantUserGroupsProps> = ({ hideHeader = false }) => {
  const { tenantId } = useAuth();
  const layoutContext = useOutletContext<UsersLayoutOutletContext>();
  if (!tenantId) return null;
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <UserGroupsTab
        tenantId={tenantId}
        hideHeader={hideHeader}
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
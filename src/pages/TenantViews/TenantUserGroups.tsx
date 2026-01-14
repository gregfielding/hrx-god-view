import React from 'react';
import { Box } from '@mui/material';

import { useAuth } from '../../contexts/AuthContext';
import UserGroupsTab from '../AgencyProfile/components/UserGroupsTab';

const TenantUserGroups: React.FC = () => {
  const { tenantId } = useAuth();
  if (!tenantId) return null;
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <UserGroupsTab tenantId={tenantId} />
    </Box>
  );
};

export default TenantUserGroups; 
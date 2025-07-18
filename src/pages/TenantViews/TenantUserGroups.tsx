import React from 'react';
import { Box, Typography } from '@mui/material';
import { useAuth } from '../../contexts/AuthContext';
import UserGroupsTab from '../AgencyProfile/components/UserGroupsTab';

const TenantUserGroups: React.FC = () => {
  const { tenantId } = useAuth();
  if (!tenantId) return null;
  return (
    <Box sx={{ p: 0, width: '100%' }}>
      {/* <Box display="flex" alignItems="center" justifyContent="space-between" mb={3}>
        <Typography variant="h4" component="h1">
          User Groups
        </Typography>
      </Box> */}
      <UserGroupsTab tenantId={tenantId} />
    </Box>
  );
};

export default TenantUserGroups; 
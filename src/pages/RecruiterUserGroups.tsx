import React from 'react';
import { Box, Typography } from '@mui/material';

import TenantUserGroups from './TenantViews/TenantUserGroups';

const RecruiterUserGroups: React.FC = () => {
  return (
    <Box sx={{ p: 0 }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h3" gutterBottom>
          User Groups
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Organize and manage staff groups across assignments and talent pools.
        </Typography>
      </Box>

      <TenantUserGroups />
    </Box>
  );
};

export default RecruiterUserGroups;


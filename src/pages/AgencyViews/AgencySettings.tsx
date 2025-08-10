import React from 'react';
import { Box, Typography } from '@mui/material';

import { useAuth } from '../../contexts/AuthContext';
import SettingsTab from '../AgencyProfile/components/SettingsTab';

const AgencySettings: React.FC = () => {
  const { tenantId } = useAuth();
  if (!tenantId) return null;
  return (
    <Box sx={{ p: 0, width: '100%' }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={3} mt={0}>
        <Typography variant="h4" component="h1">
          Settings
        </Typography>
      </Box>
      <SettingsTab tenantId={tenantId} />
    </Box>
  );
};

export default AgencySettings; 
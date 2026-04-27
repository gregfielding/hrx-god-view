import React from 'react';
import { Box } from '@mui/material';

import { useAuth } from '../../contexts/AuthContext';
import LocationsTab from '../AgencyProfile/components/LocationsTab';

const TenantLocations: React.FC = () => {
  const { tenantId } = useAuth();
  if (!tenantId) return null;
  return (
    <Box sx={{ p: 0, width: '100%' }}>
      {/* <Box display="flex" alignItems="center" justifyContent="space-between" mb={3} mt={0}>
        <Typography variant="h4" component="h1">
          Locations
        </Typography>
      </Box> */}
      <LocationsTab tenantId={tenantId} />
    </Box>
  );
};

export default TenantLocations; 
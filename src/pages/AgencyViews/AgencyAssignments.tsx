import React from 'react';
import { Box } from '@mui/material';

import { useAuth } from '../../contexts/AuthContext';
import AgencyAssignmentsTab from '../AgencyProfile/components/AgencyAssignmentsTab';

const AgencyAssignments: React.FC = () => {
  const { tenantId } = useAuth();
  if (!tenantId) return null;
  return (
    <Box sx={{ p: 0, width: '100%' }}>
      {/* <Box display="flex" alignItems="center" justifyContent="space-between" mb={3} mt={2}>
        <Typography variant="h4" component="h1">
          Assignments
        </Typography>
      </Box> */}
      <AgencyAssignmentsTab tenantId={tenantId} />
    </Box>
  );
};

export default AgencyAssignments; 
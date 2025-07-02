import React from 'react';
import { Box, Typography } from '@mui/material';

const ModulesTab: React.FC<{ agencyId: string }> = ({ agencyId }) => {
  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h6" gutterBottom>
        Modules
      </Typography>
      <Typography variant="body1" color="textSecondary">
        Module management features coming soon for agency: <b>{agencyId}</b>
      </Typography>
    </Box>
  );
};

export default ModulesTab; 
import React from 'react';
import { Box, Typography } from '@mui/material';

interface EVerifyTabProps {
  tenantId: string;
}

const EVerifyTab: React.FC<EVerifyTabProps> = ({ tenantId }) => {
  return (
    <Box sx={{ p: 0 }}>
      <Typography variant="h6" fontWeight={700}>E-Verify</Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mt: 2 }}>
        E-Verify configuration will be available here.
      </Typography>
    </Box>
  );
};

export default EVerifyTab;

import React from 'react';
import { Alert } from '@mui/material';

const MissingDocsBanner: React.FC = () => {
  return (
    <Alert severity="info" sx={{ mb: 2 }}>
      No missing documents at this time.
    </Alert>
  );
};

export default MissingDocsBanner;

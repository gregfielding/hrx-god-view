import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { canAccessModule } from '../utils/canAccessModule';
import { Box, Typography, Alert } from '@mui/material';

const Dashboard: React.FC = () => {
  console.log('Dashboard component rendering');
  const { modules } = useAuth();

  return (
    <Box>
      <Typography variant="h3" gutterBottom>
        Welcome to the HRX Dashboard
      </Typography>

      {canAccessModule('schedules', modules) ? (
        <Alert severity="success" sx={{ mb: 2 }}>
          ✅ You have access to the <strong>Schedules</strong> module.
        </Alert>
      ) : (
        <Alert severity="warning" sx={{ mb: 2 }}>
          🚫 You <strong>do not</strong> have access to the Schedules module.
        </Alert>
      )}

      {canAccessModule('payroll', modules) ? (
        <Alert severity="success" sx={{ mb: 2 }}>
          ✅ You have access to the <strong>Payroll</strong> module.
        </Alert>
      ) : (
        <Alert severity="warning" sx={{ mb: 2 }}>
          🚫 You <strong>do not</strong> have access to the Payroll module.
        </Alert>
      )}
    </Box>
  );
};

export default Dashboard;

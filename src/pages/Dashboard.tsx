import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { canAccessModule } from '../utils/canAccessModule';
import { Box, Typography, Alert, Paper, Divider, Button } from '@mui/material';
import { Logout as LogoutIcon } from '@mui/icons-material';
import SalesNewsFeed from '../components/SalesNewsFeed';

const Dashboard: React.FC = () => {
  console.log('Dashboard component rendering');
  const { modules, role, securityLevel, accessRole, orgType, activeTenant, loading, logout } = useAuth();

  return (
    <Box>
      <Typography variant="h3" gutterBottom>
        Welcome to the HRX Dashboard
      </Typography>

      {/* Debug Information */}
      <Paper sx={{ p: 2, mb: 2, backgroundColor: '#f5f5f5' }}>
        <Typography variant="h6" gutterBottom>
          🔍 Debug Information
        </Typography>
        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
          <strong>Loading:</strong> {loading ? 'Yes' : 'No'}<br />
          <strong>Role:</strong> {role}<br />
          <strong>Security Level:</strong> {securityLevel}<br />
          <strong>Access Role:</strong> {accessRole}<br />
          <strong>Org Type:</strong> {orgType}<br />
          <strong>Active Tenant ID:</strong> {activeTenant?.id || 'None'}<br />
          <strong>Active Tenant Name:</strong> {activeTenant?.name || 'None'}<br />
          <strong>Modules Count:</strong> {modules.length}<br />
          <strong>Modules:</strong> {modules.length > 0 ? modules.join(', ') : 'None'}
        </Typography>
      </Paper>

      <Divider sx={{ my: 2 }} />

      {/* Module Access Checks */}
      <Typography variant="h6" gutterBottom>
        Module Access Status
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

      {/* Additional Module Checks */}
      {canAccessModule('crm', modules) ? (
        <Alert severity="success" sx={{ mb: 2 }}>
          ✅ You have access to the <strong>CRM</strong> module.
        </Alert>
      ) : (
        <Alert severity="info" sx={{ mb: 2 }}>
          ℹ️ You <strong>do not</strong> have access to the CRM module.
        </Alert>
      )}

      {canAccessModule('flex', modules) ? (
        <Alert severity="success" sx={{ mb: 2 }}>
          ✅ You have access to the <strong>Flex</strong> module.
        </Alert>
      ) : (
        <Alert severity="info" sx={{ mb: 2 }}>
          ℹ️ You <strong>do not</strong> have access to the Flex module.
        </Alert>
      )}

      <Divider sx={{ my: 2 }} />

      {/* Sales News Feed - Only show if user has CRM access */}
      {canAccessModule('crm', modules) && (
        <>
          <Typography variant="h6" gutterBottom>
            📰 Sales News Feed
          </Typography>
          <Box sx={{ mb: 3 }}>
            <SalesNewsFeed />
          </Box>
          <Divider sx={{ my: 2 }} />
        </>
      )}

      {/* Logout Button */}
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
        <Button
          variant="outlined"
          color="error"
          startIcon={<LogoutIcon />}
          onClick={logout}
          sx={{ px: 3, py: 1.5 }}
        >
          Logout
        </Button>
      </Box>
    </Box>
  );
};

export default Dashboard;

/**
 * Slack Admin Page
 * 
 * Central admin interface for managing Slack integration.
 * Only accessible to users with securityLevel 5-7.
 */

import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Grid,
  Paper,
  CircularProgress,
  Alert,
} from '@mui/material';
import { useAuth } from '../../contexts/AuthContext';
import { canUserAccessSlack, getSecurityLevelForActiveTenant } from '../../utils/security';
import SlackMappingsPanel from './components/SlackMappingsPanel';
import SlackConnectionStatusCard from './components/SlackConnectionStatusCard';
import SlackRecentMessagesPanel from './components/SlackRecentMessagesPanel';
import SlackTrafficLogsPanel from './components/SlackTrafficLogsPanel';

const SlackAdminPage: React.FC = () => {
  const { tenantId, user, loading, activeTenant, currentClaimsSecurityLevel, securityLevel } = useAuth();
  const [accessDenied, setAccessDenied] = useState(false);

  // Ensure the object passed into security helpers includes activeTenantId + tenantIds security level.
  // `useAuth().user` is a Firebase Auth user (doesn't have tenantIds/securityLevel), so without this,
  // access checks incorrectly fall back to level 1.
  const userAny = user as any;
  const userWithTenant = user
    ? {
        ...userAny,
        activeTenantId: userAny.activeTenantId || activeTenant?.id,
        tenantIds:
          userAny.tenantIds ||
          (activeTenant?.id
            ? {
                [activeTenant.id]: {
                  securityLevel: currentClaimsSecurityLevel || securityLevel,
                },
              }
            : {}),
      }
    : null;

  useEffect(() => {
    if (!loading && !canUserAccessSlack(userWithTenant as any)) {
      setAccessDenied(true);
    } else if (!loading) {
      setAccessDenied(false);
    }
  }, [loading, userWithTenant]);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (accessDenied || !canUserAccessSlack(userWithTenant as any)) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          <Typography variant="h6">Access Denied</Typography>
          <Typography variant="body2">
            You must have security level 5-7 (Staff Manager, Manager, or Admin) for your active tenant to access Slack integration management.
          </Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>
            Your current security level: {userWithTenant ? getSecurityLevelForActiveTenant(userWithTenant as any) : 'Unknown'}
          </Typography>
        </Alert>
      </Box>
    );
  }

  if (!tenantId) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">
          No tenant selected. Please select a tenant to manage Slack integration.
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ px: { xs: 2, md: 3 }, py: 2 }}>
      <Grid container spacing={3}>
        {/* Left Column: Mappings */}
        <Grid item xs={12} md={7}>
          <SlackMappingsPanel tenantId={tenantId} />
        </Grid>

        {/* Right Column: Status & Recent Messages */}
        <Grid item xs={12} md={5}>
          <SlackConnectionStatusCard tenantId={tenantId} />
          <Box mt={3}>
            <SlackRecentMessagesPanel tenantId={tenantId} />
          </Box>
          <Box mt={3}>
            <SlackTrafficLogsPanel tenantId={tenantId} />
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
};

export default SlackAdminPage;

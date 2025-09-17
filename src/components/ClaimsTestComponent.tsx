import React from 'react';
import { useAuth, useIsHRX, useIsTenantAdmin, useHasRole, useTenantRole, useRefreshClaims, useHasRoleInTenant } from '../contexts/AuthContext';
import { ClaimsRole } from '../contexts/AuthContext';
import { Box, Typography, Chip, Paper, Button } from '@mui/material';

export const ClaimsTestComponent: React.FC = () => {
  const { 
    user, 
    isHRX, 
    claimsRoles, 
    currentClaimsRole, 
    currentClaimsSecurityLevel,
    tenantIds,
    activeTenant 
  } = useAuth();
  
  const isHRXUser = useIsHRX();
  const isAdmin = useIsTenantAdmin();
  const isRecruiter = useHasRole('Recruiter');
  const refreshClaims = useRefreshClaims();
  
  const handleRefreshClaims = async () => {
    try {
      await refreshClaims();
      console.log('Claims refreshed successfully');
    } catch (error) {
      console.error('Failed to refresh claims:', error);
    }
  };

  if (!user) {
    return (
      <Paper sx={{ p: 2, m: 2 }}>
        <Typography variant="h6">Claims Test Component</Typography>
        <Typography>No user logged in</Typography>
      </Paper>
    );
  }

  return (
    <Paper sx={{ p: 2, m: 2 }}>
      <Typography variant="h6" gutterBottom>Claims Test Component</Typography>
      
      <Box sx={{ mb: 2 }}>
        <Typography variant="subtitle1">User Info:</Typography>
        <Typography>Email: {user.email}</Typography>
        <Typography>UID: {user.uid}</Typography>
      </Box>

      <Box sx={{ mb: 2 }}>
        <Typography variant="subtitle1">Claims Status:</Typography>
        <Chip 
          label={isHRXUser ? 'HRX User' : 'Tenant User'} 
          color={isHRXUser ? 'primary' : 'default'} 
          sx={{ mr: 1 }} 
        />
        <Chip 
          label={isAdmin ? 'Admin' : 'Not Admin'} 
          color={isAdmin ? 'success' : 'default'} 
          sx={{ mr: 1 }} 
        />
        <Chip 
          label={isRecruiter ? 'Recruiter' : 'Not Recruiter'} 
          color={isRecruiter ? 'info' : 'default'} 
        />
        <Button 
          variant="outlined" 
          size="small" 
          onClick={handleRefreshClaims}
          sx={{ ml: 2 }}
        >
          Refresh Claims
        </Button>
      </Box>

      <Box sx={{ mb: 2 }}>
        <Typography variant="subtitle1">Current Role:</Typography>
        <Typography>Role: {currentClaimsRole || 'None'}</Typography>
        <Typography>Security Level: {currentClaimsSecurityLevel || 'None'}</Typography>
      </Box>

      <Box sx={{ mb: 2 }}>
        <Typography variant="subtitle1">Active Tenant:</Typography>
        <Typography>ID: {activeTenant?.id || 'None'}</Typography>
        <Typography>Name: {activeTenant?.name || 'None'}</Typography>
      </Box>

      <Box sx={{ mb: 2 }}>
        <Typography variant="subtitle1">All Tenant Roles:</Typography>
        {Object.entries(claimsRoles).map(([tenantId, role]) => (
          <Box key={tenantId} sx={{ mb: 1 }}>
            <Typography variant="body2">
              Tenant {tenantId}: {role.role} (Level {role.securityLevel})
            </Typography>
          </Box>
        ))}
        {Object.keys(claimsRoles).length === 0 && (
          <Typography variant="body2" color="text.secondary">No tenant roles found</Typography>
        )}
      </Box>

      <Box>
        <Typography variant="subtitle1">All Tenant IDs:</Typography>
        <Typography>{tenantIds.join(', ') || 'None'}</Typography>
      </Box>
    </Paper>
  );
};

import React from 'react';
import { 
  RequireRoles, 
  RequireAdmin, 
  RequireRecruiter, 
  RequireManager,
  RequireRecruiterOrManager,
  useRequireRoles 
} from './RequireRoles';
import { Box, Typography, Paper, Button, Chip } from '@mui/material';

/**
 * Example component demonstrating how to use RequireRoles HOC
 * This shows different ways to protect content based on user roles
 */
export const RequireRolesExample: React.FC = () => {
  const { hasAccess: canAccessAdmin } = useRequireRoles(['Admin']);
  const { hasAccess: canAccessRecruiter } = useRequireRoles(['Recruiter']);

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        RequireRoles HOC Examples
      </Typography>

      {/* Example 1: Using the hook for conditional rendering */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Example 1: Using useRequireRoles Hook
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          This content is conditionally rendered based on user roles using the hook.
        </Typography>
        
        {canAccessAdmin && (
          <Chip label="Admin Access Granted" color="success" sx={{ mr: 1 }} />
        )}
        
        {canAccessRecruiter && (
          <Chip label="Recruiter Access Granted" color="info" sx={{ mr: 1 }} />
        )}
        
        {!canAccessAdmin && !canAccessRecruiter && (
          <Chip label="No Special Access" color="default" />
        )}
      </Paper>

      {/* Example 2: RequireAdmin HOC */}
      <RequireAdmin>
        <Paper sx={{ p: 2, mb: 3, bgcolor: 'success.light' }}>
          <Typography variant="h6" gutterBottom>
            Example 2: RequireAdmin HOC
          </Typography>
          <Typography variant="body2">
            This content is only visible to users with Admin role.
            If you can see this, you have Admin access!
          </Typography>
        </Paper>
      </RequireAdmin>

      {/* Example 3: RequireRecruiter HOC */}
      <RequireRecruiter>
        <Paper sx={{ p: 2, mb: 3, bgcolor: 'info.light' }}>
          <Typography variant="h6" gutterBottom>
            Example 3: RequireRecruiter HOC
          </Typography>
          <Typography variant="body2">
            This content is only visible to users with Recruiter role.
            If you can see this, you have Recruiter access!
          </Typography>
        </Paper>
      </RequireRecruiter>

      {/* Example 4: RequireRecruiterOrManager HOC */}
      <RequireRecruiterOrManager>
        <Paper sx={{ p: 2, mb: 3, bgcolor: 'warning.light' }}>
          <Typography variant="h6" gutterBottom>
            Example 4: RequireRecruiterOrManager HOC
          </Typography>
          <Typography variant="body2">
            This content is visible to users with either Recruiter OR Manager role.
            If you can see this, you have one of these roles!
          </Typography>
        </Paper>
      </RequireRecruiterOrManager>

      {/* Example 5: Custom RequireRoles with multiple roles */}
      <RequireRoles roles={['Admin', 'Recruiter']} requireAll={false}>
        <Paper sx={{ p: 2, mb: 3, bgcolor: 'primary.light' }}>
          <Typography variant="h6" gutterBottom>
            Example 5: Custom RequireRoles (Admin OR Recruiter)
          </Typography>
          <Typography variant="body2">
            This content is visible to users with either Admin OR Recruiter role.
            Using the main RequireRoles component with custom configuration.
          </Typography>
        </Paper>
      </RequireRoles>

      {/* Example 6: RequireRoles with custom fallback */}
      <RequireRoles 
        roles={['Admin']} 
        fallback={
          <Paper sx={{ p: 2, mb: 3, bgcolor: 'error.light' }}>
            <Typography variant="h6" gutterBottom>
              Example 6: Custom Fallback
            </Typography>
            <Typography variant="body2">
              This is a custom fallback component shown when user doesn't have Admin role.
              The default access denied component is replaced with this custom one.
            </Typography>
          </Paper>
        }
      >
        <Paper sx={{ p: 2, mb: 3, bgcolor: 'success.light' }}>
          <Typography variant="h6" gutterBottom>
            Example 6: Admin Only Content
          </Typography>
          <Typography variant="body2">
            This content is only visible to Admin users.
            If you can see this, you have Admin access!
          </Typography>
        </Paper>
      </RequireRoles>

      {/* Example 7: RequireRoles with specific tenant */}
      <RequireRoles roles={['Manager']} tenantId="TENANT_A">
        <Paper sx={{ p: 2, mb: 3, bgcolor: 'secondary.light' }}>
          <Typography variant="h6" gutterBottom>
            Example 7: Tenant-Specific Role Check
          </Typography>
          <Typography variant="body2">
            This content is only visible to users with Manager role in TENANT_A.
            This demonstrates how to check roles in a specific tenant.
          </Typography>
        </Paper>
      </RequireRoles>

      {/* Example 8: RequireRoles with requireAll */}
      <RequireRoles roles={['Admin', 'Recruiter']} requireAll={true}>
        <Paper sx={{ p: 2, mb: 3, bgcolor: 'error.light' }}>
          <Typography variant="h6" gutterBottom>
            Example 8: Require ALL Roles
          </Typography>
          <Typography variant="body2">
            This content is only visible to users who have BOTH Admin AND Recruiter roles.
            This is very restrictive and likely won't be visible to most users.
          </Typography>
        </Paper>
      </RequireRoles>

      <Paper sx={{ p: 2, bgcolor: 'grey.100' }}>
        <Typography variant="h6" gutterBottom>
          Usage Notes
        </Typography>
        <Typography variant="body2" component="div">
          <ul>
            <li><strong>HRX users</strong> have access to all protected content</li>
            <li><strong>Role checks</strong> are based on the active tenant by default</li>
            <li><strong>Custom fallbacks</strong> can be provided for better UX</li>
            <li><strong>requireAll</strong> flag changes behavior from "ANY role" to "ALL roles"</li>
            <li><strong>Loading states</strong> are handled automatically</li>
            <li><strong>Claims refresh</strong> button is available in access denied screens</li>
          </ul>
        </Typography>
      </Paper>
    </Box>
  );
};

export default RequireRolesExample;

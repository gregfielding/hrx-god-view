import React from 'react';
import { useAuth, useActiveTenantId, useIsHRX, useHasRoleInTenant } from '../contexts/AuthContext';
import { ClaimsRole } from '../contexts/AuthContext';
import { Box, Typography, Button, Paper, Alert } from '@mui/material';
import { Lock as LockIcon, Refresh as RefreshIcon } from '@mui/icons-material';

interface RequireRolesProps {
  children: React.ReactNode;
  roles: ClaimsRole[];
  tenantId?: string; // Optional: if not provided, uses active tenant
  fallback?: React.ReactNode; // Custom fallback component
  showRefreshButton?: boolean; // Show refresh claims button
  requireAll?: boolean; // If true, user must have ALL roles; if false, user needs ANY role
}

interface RequireRolesState {
  hasAccess: boolean;
  missingRoles: ClaimsRole[];
  error?: string;
}

/**
 * Higher-Order Component for route protection based on claims-based roles
 * 
 * Usage examples:
 * 
 * // Require Admin role in active tenant
 * <RequireRoles roles={['Admin']}>
 *   <AdminPanel />
 * </RequireRoles>
 * 
 * // Require Recruiter OR Manager role in specific tenant
 * <RequireRoles roles={['Recruiter', 'Manager']} tenantId="TENANT_A">
 *   <RecruiterDashboard />
 * </RequireRoles>
 * 
 * // Require ALL roles (Admin AND Recruiter)
 * <RequireRoles roles={['Admin', 'Recruiter']} requireAll={true}>
 *   <SuperAdminPanel />
 * </RequireRoles>
 * 
 * // Custom fallback component
 * <RequireRoles 
 *   roles={['Admin']} 
 *   fallback={<CustomAccessDenied />}
 * >
 *   <AdminContent />
 * </RequireRoles>
 */
export const RequireRoles: React.FC<RequireRolesProps> = ({
  children,
  roles,
  tenantId,
  fallback,
  showRefreshButton = true,
  requireAll = false
}) => {
  const { 
    user, 
    loading, 
    refreshUserClaims,
    isHRX,
    currentClaimsRole,
    currentClaimsSecurityLevel 
  } = useAuth();
  
  const activeTenantId = useActiveTenantId();
  const isHRXUser = useIsHRX();
  const targetTenantId = tenantId || activeTenantId;
  
  // Check if user has required roles in the target tenant
  const hasRequiredRole = useHasRoleInTenant(targetTenantId || '', roles);

  const [state, setState] = React.useState<RequireRolesState>({
    hasAccess: false,
    missingRoles: []
  });

  // Update access state when dependencies change
  React.useEffect(() => {
    if (loading) {
      setState({ hasAccess: false, missingRoles: [] });
      return;
    }

    if (!user) {
      setState({ 
        hasAccess: false, 
        missingRoles: roles,
        error: 'User not authenticated'
      });
      return;
    }

    if (!targetTenantId) {
      setState({ 
        hasAccess: false, 
        missingRoles: roles,
        error: 'No tenant selected'
      });
      return;
    }

    // HRX users have access to everything
    if (isHRXUser) {
      setState({ hasAccess: true, missingRoles: [] });
      return;
    }

    // Check role requirements
    let hasAccess = false;
    let missingRoles: ClaimsRole[] = [];

    if (requireAll) {
      // User must have ALL specified roles
      hasAccess = roles.every(role => hasRequiredRole);
      missingRoles = roles.filter(role => !hasRequiredRole);
    } else {
      // User needs ANY of the specified roles
      hasAccess = hasRequiredRole;
      missingRoles = hasAccess ? [] : roles;
    }

    setState({ hasAccess, missingRoles });
  }, [
    loading, 
    user, 
    targetTenantId, 
    isHRXUser, 
    hasRequiredRole, 
    roles, 
    requireAll
  ]);

  const handleRefreshClaims = async () => {
    try {
      await refreshUserClaims();
    } catch (error) {
      console.error('Failed to refresh claims:', error);
    }
  };

  // Show loading state
  if (loading) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography>Loading...</Typography>
      </Box>
    );
  }

  // Show access denied
  if (!state.hasAccess) {
    // Use custom fallback if provided
    if (fallback) {
      return <>{fallback}</>;
    }

    // Default access denied component
    return (
      <Box sx={{ p: 3 }}>
        <Paper sx={{ p: 3, textAlign: 'center' }}>
          <LockIcon sx={{ fontSize: 48, color: 'error.main', mb: 2 }} />
          
          <Typography variant="h5" gutterBottom>
            Access Denied
          </Typography>
          
          <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
            You don't have the required permissions to access this page.
          </Typography>

          {state.error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {state.error}
            </Alert>
          )}

          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Required roles:
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', flexWrap: 'wrap' }}>
              {roles.map(role => (
                <Typography 
                  key={role}
                  variant="body2"
                  sx={{ 
                    px: 1, 
                    py: 0.5, 
                    bgcolor: 'grey.100', 
                    borderRadius: 1,
                    color: state.missingRoles.includes(role) ? 'error.main' : 'success.main'
                  }}
                >
                  {role}
                </Typography>
              ))}
            </Box>
          </Box>

          {state.missingRoles.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" gutterBottom>
                Missing roles:
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', flexWrap: 'wrap' }}>
                {state.missingRoles.map(role => (
                  <Typography 
                    key={role}
                    variant="body2"
                    sx={{ 
                      px: 1, 
                      py: 0.5, 
                      bgcolor: 'error.light', 
                      color: 'error.contrastText',
                      borderRadius: 1
                    }}
                  >
                    {role}
                  </Typography>
                ))}
              </Box>
            </Box>
          )}

          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Current role: {currentClaimsRole || 'None'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Security level: {currentClaimsSecurityLevel || 'None'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Tenant: {targetTenantId || 'None'}
            </Typography>
            {isHRXUser && (
              <Typography variant="body2" color="primary.main">
                HRX Platform Access: Enabled
              </Typography>
            )}
          </Box>

          {showRefreshButton && (
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={handleRefreshClaims}
              sx={{ mt: 1 }}
            >
              Refresh Claims
            </Button>
          )}
        </Paper>
      </Box>
    );
  }

  // User has access, render children
  return <>{children}</>;
};

/**
 * Convenience HOC for requiring a single role
 */
export const RequireRole: React.FC<Omit<RequireRolesProps, 'roles'> & { role: ClaimsRole }> = ({
  role,
  ...props
}) => {
  return <RequireRoles roles={[role]} {...props} />;
};

/**
 * Convenience HOC for requiring Admin role
 */
export const RequireAdmin: React.FC<Omit<RequireRolesProps, 'roles'>> = (props) => {
  return <RequireRoles roles={['Admin']} {...props} />;
};

/**
 * Convenience HOC for requiring Recruiter role
 */
export const RequireRecruiter: React.FC<Omit<RequireRolesProps, 'roles'>> = (props) => {
  return <RequireRoles roles={['Recruiter']} {...props} />;
};

/**
 * Convenience HOC for requiring Manager role
 */
export const RequireManager: React.FC<Omit<RequireRolesProps, 'roles'>> = (props) => {
  return <RequireRoles roles={['Manager']} {...props} />;
};

/**
 * Convenience HOC for requiring Recruiter OR Manager role
 */
export const RequireRecruiterOrManager: React.FC<Omit<RequireRolesProps, 'roles'>> = (props) => {
  return <RequireRoles roles={['Recruiter', 'Manager']} {...props} />;
};

/**
 * Hook for checking if user has required roles (useful for conditional rendering)
 */
export const useRequireRoles = (roles: ClaimsRole[], tenantId?: string, requireAll = false) => {
  const { user, loading, isHRX } = useAuth();
  const activeTenantId = useActiveTenantId();
  const targetTenantId = tenantId || activeTenantId;
  const hasRequiredRole = useHasRoleInTenant(targetTenantId || '', roles);

  if (loading || !user || !targetTenantId) {
    return { hasAccess: false, loading: true };
  }

  if (isHRX) {
    return { hasAccess: true, loading: false };
  }

  const hasAccess = requireAll 
    ? roles.every(role => hasRequiredRole)
    : hasRequiredRole;

  return { hasAccess, loading: false };
};

export default RequireRoles;

import React from 'react';
import { useAuth, useActiveTenantId, useIsHRX, useHasRoleInTenant } from '../contexts/AuthContext';
import { ClaimsRole } from '../contexts/AuthContext';
import { Box, Typography, Alert, Button } from '@mui/material';
import { Lock as LockIcon, Refresh as RefreshIcon } from '@mui/icons-material';

interface RequireRolesProps {
  children: React.ReactNode;
  tenantId?: string; // Optional: if not provided, uses active tenant
  anyOf: ClaimsRole[]; // Required roles (user needs ANY of these)
  fallback?: React.ReactNode; // Custom fallback component
  showRefreshButton?: boolean; // Show refresh claims button
}

/**
 * Route/Menu Guard Component
 * 
 * A focused guard component for protecting routes and menu items based on claims-based roles.
 * This is a simplified version of the main RequireRoles HOC, optimized for navigation guards.
 * 
 * Usage examples:
 * 
 * // Protect recruiter area
 * <RequireRoles anyOf={['Recruiter', 'Manager', 'Admin']}>
 *   <RecruiterDashboard />
 * </RequireRoles>
 * 
 * // Protect job orders create/edit
 * <RequireRoles anyOf={['Admin']}>
 *   <JobOrderForm />
 * </RequireRoles>
 * 
 * // Protect applications write actions
 * <RequireRoles anyOf={['Recruiter', 'Manager', 'Admin']}>
 *   <CreateApplication />
 * </RequireRoles>
 */
export const RequireRoles: React.FC<RequireRolesProps> = ({
  children,
  tenantId,
  anyOf,
  fallback,
  showRefreshButton = true
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
  
  // Check if user has any of the required roles in the target tenant
  const hasRequiredRole = useHasRoleInTenant(targetTenantId || '', anyOf);

  // Show loading state
  if (loading) {
    return (
      <Box sx={{ p: 2, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          Loading...
        </Typography>
      </Box>
    );
  }

  // Show access denied
  if (!user) {
    return (
      <Alert severity="warning" sx={{ m: 2 }}>
        <Typography variant="body2">
          Please log in to access this area.
        </Typography>
      </Alert>
    );
  }

  if (!targetTenantId) {
    return (
      <Alert severity="warning" sx={{ m: 2 }}>
        <Typography variant="body2">
          No tenant selected. Please select a tenant to access this area.
        </Typography>
      </Alert>
    );
  }

  // HRX users have access to everything
  if (isHRXUser) {
    return <>{children}</>;
  }

  // Check if user has any of the required roles
  if (!hasRequiredRole) {
    // Use custom fallback if provided
    if (fallback) {
      return <>{fallback}</>;
    }

    // Default access denied component
    return (
      <Box sx={{ p: 2 }}>
        <Alert 
          severity="error" 
          icon={<LockIcon />}
          action={
            showRefreshButton ? (
              <Button
                size="small"
                startIcon={<RefreshIcon />}
                onClick={refreshUserClaims}
              >
                Refresh
              </Button>
            ) : undefined
          }
        >
          <Typography variant="body2" gutterBottom>
            <strong>Access Denied</strong>
          </Typography>
          <Typography variant="body2" color="text.secondary">
            You need one of these roles: {anyOf.join(', ')}
          </Typography>
          <Typography variant="caption" display="block" sx={{ mt: 1 }}>
            Current role: {currentClaimsRole || 'None'} | 
            Tenant: {targetTenantId}
          </Typography>
        </Alert>
      </Box>
    );
  }

  // User has access, render children
  return <>{children}</>;
};

/**
 * Hook for checking if user has any of the required roles
 * Useful for conditional rendering in components
 */
export const useRequireRoles = (anyOf: ClaimsRole[], tenantId?: string) => {
  const { user, loading, isHRX } = useAuth();
  const activeTenantId = useActiveTenantId();
  const targetTenantId = tenantId || activeTenantId;
  const hasRequiredRole = useHasRoleInTenant(targetTenantId || '', anyOf);

  if (loading || !user || !targetTenantId) {
    return { hasAccess: false, loading: true };
  }

  if (isHRX) {
    return { hasAccess: true, loading: false };
  }

  return { hasAccess: hasRequiredRole, loading: false };
};

/**
 * Convenience hook for checking specific role combinations
 */
export const useRoleGuards = () => {
  const { user, loading, isHRX } = useAuth();
  const activeTenantId = useActiveTenantId();
  
  // Helper function to check roles
  const checkRoles = (roles: ClaimsRole[], tenantId?: string) => {
    if (loading || !user || isHRX) return isHRX;
    const targetTenantId = tenantId || activeTenantId;
    return useHasRoleInTenant(targetTenantId || '', roles);
  };

  return {
    // Common role checks
    canAccessRecruiterArea: checkRoles(['Recruiter', 'Manager', 'Admin']),
    canCreateEditJobOrders: checkRoles(['Admin']),
    canWriteApplications: checkRoles(['Recruiter', 'Manager', 'Admin']),
    canManageUsers: checkRoles(['Admin']),
    canViewReports: checkRoles(['Admin', 'Manager']),
    canAccessSettings: checkRoles(['Admin']),
    
    // Individual role checks
    isAdmin: checkRoles(['Admin']),
    isRecruiter: checkRoles(['Recruiter']),
    isManager: checkRoles(['Manager']),
    isWorker: checkRoles(['Worker']),
    isCustomer: checkRoles(['Customer']),
    
    // Utility
    loading,
    isHRX,
    activeTenantId
  };
};

export default RequireRoles;

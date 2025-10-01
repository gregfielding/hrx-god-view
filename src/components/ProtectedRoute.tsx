import React from 'react';
import { Navigate } from 'react-router-dom';
import { Box, Typography, CircularProgress } from '@mui/material';

import { useAuth } from '../contexts/AuthContext';
import { Role, SecurityLevel, getAccessRole, hasAccess } from '../utils/AccessRoles';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredAccessRole?: string;
  requiredRole?: Role;
  requiredSecurityLevel?: SecurityLevel;
  requiredOrgType?: 'Agency' | 'Customer' | 'HRX';
  fallbackPath?: string;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  requiredAccessRole,
  requiredRole,
  requiredSecurityLevel,
  requiredOrgType,
  fallbackPath = '/login',
}) => {
  const { user, role, securityLevel, orgType, loading, crmSalesEnabled, recruiterEnabled } = useAuth();

  // Show loading spinner while auth state is being determined
  if (loading) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        minHeight="100vh"
        flexDirection="column"
        gap={2}
      >
        <CircularProgress />
        <Typography variant="body2" color="text.secondary">
          Loading...
        </Typography>
      </Box>
    );
  }

  // Redirect to login if not authenticated
  if (!user) {
    return <Navigate to={fallbackPath} replace />;
  }

  // Check role requirements
  if (requiredRole && role !== requiredRole) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        minHeight="100vh"
        flexDirection="column"
        gap={2}
      >
        <Typography variant="h5" color="error">
          Access Denied
        </Typography>
          <Typography variant="body1" color="text.secondary">
            You don&apos;t have the required role to access this page.
          </Typography>
        <Typography variant="body2" color="text.secondary">
          Required: {requiredRole} | Your role: {role}
        </Typography>
      </Box>
    );
  }

  // Check security level requirements
  if (requiredSecurityLevel) {
    // Define security level hierarchy (higher number = higher access)
    const securityLevels: Record<SecurityLevel, number> = {
      '0': 0, // Suspended
      '1': 1, // Dismissed
      '2': 2, // Applicant
      '3': 3, // Flex
      '4': 4, // Hired Staff
      '5': 5, // Worker
      '6': 6, // Manager
      '7': 7, // Admin
    };
    
    const userLevel = securityLevels[securityLevel] || 0;
    const requiredLevel = securityLevels[requiredSecurityLevel] || 0;
    
    if (userLevel < requiredLevel) {
      return (
        <Box
          display="flex"
          justifyContent="center"
          alignItems="center"
          minHeight="100vh"
          flexDirection="column"
          gap={2}
        >
          <Typography variant="h5" color="error">
            Access Denied
          </Typography>
          <Typography variant="body1" color="text.secondary">
            You don&apos;t have sufficient security level to access this page.
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Required: {requiredSecurityLevel} | Your level: {securityLevel}
          </Typography>
        </Box>
      );
    }
  }

  // Check org type requirements
  if (requiredOrgType && orgType !== requiredOrgType) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        minHeight="100vh"
        flexDirection="column"
        gap={2}
      >
        <Typography variant="h5" color="error">
          Access Denied
        </Typography>
        <Typography variant="body1" color="text.secondary">
          This page is only accessible to {requiredOrgType} users.
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Your organization type: {orgType}
        </Typography>
      </Box>
    );
  }

  // Check access role requirements (legacy support)
  if (requiredAccessRole) {
    const userAccessRole = getAccessRole(role, securityLevel);
    
    if (!hasAccess(requiredAccessRole, role, securityLevel)) {
      return (
        <Box
          display="flex"
          justifyContent="center"
          alignItems="center"
          minHeight="100vh"
          flexDirection="column"
          gap={2}
        >
          <Typography variant="h5" color="error">
            Access Denied
          </Typography>
          <Typography variant="body1" color="text.secondary">
            You don&apos;t have the required access level to view this page.
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Required: {requiredAccessRole} | Your access: {userAccessRole}
          </Typography>
        </Box>
      );
    }
  }

  // Specific route gating examples
  // CRM pages require crmSalesEnabled true
  // This component doesn't know the current path; we gate in App routes by wrapping with a small guard component.
  // Kept here for future extension if we decide to pass a feature flag prop.

  // All checks passed, render the protected content
  return <>{children}</>;
};

export default ProtectedRoute;

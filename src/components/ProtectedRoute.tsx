import React, { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { CircularProgress, Box } from '@mui/material';
import { getAccessRole, hasAccess } from '../utils/AccessRoles';
import { canAccessModule } from '../utils/canAccessModule';

type Props = {
  children: ReactNode;
  requiredAccessRole?: string;
  requiredModules?: string[];
};

const ProtectedRoute = ({
  children,
  requiredAccessRole = 'hrx_1',
  requiredModules = [],
}: Props) => {
  const { user, role, securityLevel, loading, modules } = useAuth();

  if (loading) {
    return (
      <Box
        sx={{
          height: '100vh',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  const userAccessRole = getAccessRole(role, securityLevel);
  const hasRoleAccess = hasAccess(requiredAccessRole, role, securityLevel);
  const hasModuleAccess =
    requiredModules.length === 0 || requiredModules.every((mod) => canAccessModule(mod, modules));

  if (!user || !hasRoleAccess || !hasModuleAccess) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;

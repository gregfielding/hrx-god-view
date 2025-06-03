import React, { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { CircularProgress, Box } from '@mui/material';
import { getAccessRole, hasAccess } from '../utils/AccessRoles';

type Props = {
  children: ReactNode;
  requiredAccessRole?: string; // Optional, default access
};

const ProtectedRoute = ({ children, requiredAccessRole = 'hrx_1' }: Props) => {
  const { user, role, securityLevel, loading } = useAuth();

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

  if (!user || !hasAccess(requiredAccessRole, role, securityLevel)) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;

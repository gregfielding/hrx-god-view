import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Box, Typography, CircularProgress } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { isStaffAllowedPublicJobBoardPath } from '../utils/publicJobBoardPaths';

/**
 * Guard for /c1/* worker shell routes. Workers (0–4) always pass. Staff (5+) are redirected
 * to /dashboard except on public job board URLs (see isStaffAllowedPublicJobBoardPath).
 */
const WorkerRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, securityLevel, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh" flexDirection="column" gap={2}>
        <CircularProgress />
        <Typography variant="body2" color="text.secondary">Loading...</Typography>
      </Box>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  const level = Number.parseInt(String(securityLevel ?? '0'), 10) || 0;
  if (level >= 5 && !isStaffAllowedPublicJobBoardPath(location.pathname)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};

export default WorkerRoute;

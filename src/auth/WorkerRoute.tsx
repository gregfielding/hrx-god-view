import React from 'react';
import { Navigate } from 'react-router-dom';
import { Box, Typography, CircularProgress } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';

/**
 * Guard for /c1/workers/* routes. Allows access only for workers (security 0–4).
 * Redirects others to /dashboard. Does not modify ProtectedRoute or admin logic.
 */
const WorkerRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, securityLevel, loading } = useAuth();

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh" flexDirection="column" gap={2}>
        <CircularProgress />
        <Typography variant="body2" color="text.secondary">Loading...</Typography>
      </Box>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const level = Number.parseInt(String(securityLevel ?? '0'), 10) || 0;
  if (level >= 5) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};

export default WorkerRoute;

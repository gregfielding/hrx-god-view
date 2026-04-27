/**
 * Legacy route: `/users/:uid/readiness` (and nested variants). Redirects into User Profile with Readiness tab open.
 */

import React, { useEffect } from 'react';
import { Box, CircularProgress } from '@mui/material';
import { useNavigate, useLocation } from 'react-router-dom';

function profilePathWithoutReadiness(pathname: string): string {
  return pathname.replace(/\/readiness\/?$/, '') || '/';
}

const UserReadinessPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const base = profilePathWithoutReadiness(location.pathname);
    const q = new URLSearchParams();
    q.set('readinessFocus', 'Readiness');
    navigate(`${base}?${q.toString()}`, { replace: true });
  }, [location.pathname, navigate]);

  return (
    <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}>
      <CircularProgress />
    </Box>
  );
};

export default UserReadinessPage;

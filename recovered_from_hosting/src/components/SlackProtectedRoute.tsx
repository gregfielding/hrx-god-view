/**
 * Slack Protected Route
 * 
 * Specialized route protection for Slack features that requires
 * securityLevel >= 5 for the user's active tenant.
 */

import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Box, Typography, CircularProgress } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { normalizeSecurityLevel } from '../utils/security';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

interface SlackProtectedRouteProps {
  children: React.ReactNode;
  fallbackPath?: string;
}

const SlackProtectedRoute: React.FC<SlackProtectedRouteProps> = ({
  children,
  fallbackPath = '/inbox',
}) => {
  const { user, loading, activeTenant, securityLevel, currentClaimsSecurityLevel } = useAuth();
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [effectiveSecurityLevel, setEffectiveSecurityLevel] = useState<number>(1);
  const [hasAccess, setHasAccess] = useState(false);

  // Fetch tenant-specific security level directly from Firestore as fallback
  useEffect(() => {
    const checkAccess = async () => {
      if (loading || !user) {
        setCheckingAccess(false);
        return;
      }

      // First, try to use the security level from AuthContext
      let level = normalizeSecurityLevel(currentClaimsSecurityLevel || securityLevel);

      // If we have an active tenant, try to get the tenant-specific security level from Firestore
      if (activeTenant?.id) {
        try {
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          if (userDoc.exists()) {
            const userData = userDoc.data();
            const tenantSettings = userData.tenantIds?.[activeTenant.id];
            if (tenantSettings?.securityLevel !== undefined) {
              // Use tenant-specific security level
              level = normalizeSecurityLevel(tenantSettings.securityLevel);
            }
          }
        } catch (error) {
          console.warn('Failed to fetch tenant-specific security level:', error);
          // Fall back to AuthContext value
        }
      }

      setEffectiveSecurityLevel(level);
      setHasAccess(level >= 5);
      setCheckingAccess(false);
    };

    checkAccess();
  }, [user, loading, activeTenant, securityLevel, currentClaimsSecurityLevel]);

  if (loading || checkingAccess) {
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

  if (!user || !hasAccess) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        minHeight="100vh"
        flexDirection="column"
        gap={2}
        sx={{ p: 3 }}
      >
        <Typography variant="h5" color="error">
          Access Denied
        </Typography>
        <Typography variant="body1" color="text.secondary">
          You must have security level 5-7 (Staff Manager, Manager, or Admin) for your active tenant to access Slack features.
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Your current security level: {effectiveSecurityLevel}
          {activeTenant && ` (Active tenant: ${activeTenant.name || activeTenant.id})`}
        </Typography>
        <Navigate to={fallbackPath} replace />
      </Box>
    );
  }

  return <>{children}</>;
};

export default SlackProtectedRoute;


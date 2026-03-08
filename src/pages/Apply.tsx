/**
 * C1 Apply Page
 *
 * Uses the shared application wizard so public applicants are prompted
 * for the same home-address step used elsewhere in the app.
 */

import React, { useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { Box, CircularProgress, Typography, Alert } from '@mui/material';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useAuth } from '../contexts/AuthContext';
import Wizard from '../components/apply/Wizard';

const C1_TENANT_ID = 'BCiP2bQ9CgVOCTfV6MhD';

type ApplyRouteParams = {
  groupId?: string;
};

const Apply: React.FC = () => {
  const { user } = useAuth();
  const location = useLocation();
  const params = useParams<ApplyRouteParams>();

  const [signupGroupId, setSignupGroupId] = useState<string | null>(null);
  const [signupGroupTitle, setSignupGroupTitle] = useState<string | null>(null);
  const [groupLoading, setGroupLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fromParam = params.groupId ? String(params.groupId).trim() : '';
    const searchParams = new URLSearchParams(location.search);
    const fromQuery = searchParams.get('groupId') ? String(searchParams.get('groupId')).trim() : '';
    const resolved = fromParam || fromQuery || '';
    setSignupGroupId(resolved || null);
  }, [params.groupId, location.search]);

  useEffect(() => {
    let cancelled = false;
    const gid = signupGroupId ? signupGroupId.trim() : '';
    if (!gid) {
      setSignupGroupTitle(null);
      setGroupLoading(false);
      setError(null);
      return;
    }

    (async () => {
      setGroupLoading(true);
      setError(null);
      try {
        const fn = httpsCallable(getFunctions(), 'validateUserGroupSignup');
        const res = await fn({ tenantId: C1_TENANT_ID, groupId: gid });
        const data = (res as any)?.data || {};
        if (!cancelled) setSignupGroupTitle(String(data?.title || '').trim() || 'User Group');
      } catch {
        if (!cancelled) {
          setSignupGroupTitle(null);
          setError('Unable to validate this signup link. Please try again.');
        }
      } finally {
        if (!cancelled) setGroupLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [signupGroupId]);

  if (groupLoading) {
    return (
      <Box display="flex" alignItems="center" justifyContent="center" minHeight="40vh">
        <CircularProgress size={28} />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3, maxWidth: 720, mx: 'auto' }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ px: 0, py: 0 }}>
      {signupGroupTitle && (
        <Box
          sx={{
            px: { xs: 2, md: 3 },
            pt: { xs: 2, md: 3 },
            maxWidth: { xs: '100%', md: '1200px' },
            mx: { xs: 0, md: 'auto' },
          }}
        >
          <Typography variant="body2" color="text.secondary">
            Signing up for: <strong>{signupGroupTitle}</strong>
          </Typography>
        </Box>
      )}
      <Wizard
        tenantId={C1_TENANT_ID}
        tenantSlug="c1"
        tenantName="C1 Staffing"
        uid={user?.uid || null}
        signupGroupId={signupGroupId}
      />
    </Box>
  );
};

export default Apply;

/**
 * C1 Apply Page
 *
 * Uses the shared application wizard so public applicants are prompted
 * for the same home-address step used elsewhere in the app.
 */

import React, { useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { Box, CircularProgress, Typography, Alert, Button, Stack } from '@mui/material';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useAuth } from '../contexts/AuthContext';
import Wizard from '../components/apply/Wizard';
import { useGuestLanguage } from '../hooks/useGuestLanguage';
import { loadLocale, setLanguage } from '../i18n';

const C1_TENANT_ID = 'BCiP2bQ9CgVOCTfV6MhD';

type ApplyRouteParams = {
  groupId?: string;
};

const Apply: React.FC = () => {
  const { user } = useAuth();
  const location = useLocation();
  const params = useParams<ApplyRouteParams>();
  const [guestLanguage, setGuestLanguage] = useGuestLanguage();

  const [signupGroupId, setSignupGroupId] = useState<string | null>(null);
  const [signupGroupTitle, setSignupGroupTitle] = useState<string | null>(null);
  const [groupLoading, setGroupLoading] = useState(false);
  const [localeLoading, setLocaleLoading] = useState(true);
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
    // Public apply route runs outside worker layout language setup.
    // Ensure locale is loaded before rendering wizard to avoid raw i18n keys.
    setLocaleLoading(true);
    setLanguage(guestLanguage);
    loadLocale(guestLanguage)
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLocaleLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [guestLanguage]);

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

  if (groupLoading || localeLoading) {
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
      <Box
        sx={{
          px: { xs: 2, md: 3 },
          pt: { xs: 2, md: 3 },
          maxWidth: { xs: '100%', md: '1200px' },
          mx: { xs: 0, md: 'auto' },
        }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
          <Typography variant="body2" color="text.secondary">
            {signupGroupTitle ? (
              <>
                Signing up for: <strong>{signupGroupTitle}</strong>
              </>
            ) : (
              'Sign up'
            )}
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant={guestLanguage === 'en' ? 'contained' : 'outlined'}
              onClick={() => setGuestLanguage('en')}
            >
              EN
            </Button>
            <Button
              size="small"
              variant={guestLanguage === 'es' ? 'contained' : 'outlined'}
              onClick={() => setGuestLanguage('es')}
            >
              ES
            </Button>
          </Stack>
        </Stack>
      </Box>
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

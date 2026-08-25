/**
 * C1 Apply Page
 *
 * Uses the shared application wizard so public applicants are prompted
 * for the same home-address step used elsewhere in the app.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { Box, CircularProgress, Typography, Alert, Stack, ThemeProvider } from '@mui/material';
import { getWorkerTheme } from '../theme/workerTheme';
import { langToggleStyle } from './authMinimalStyles';
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
  // Worker canon (Greg 2026-08-25): the public signup runs on the same
  // design language as the worker app — system fonts, ink, hairline inputs.
  const workerTheme = useMemo(() => getWorkerTheme(), []);
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
    <ThemeProvider theme={workerTheme}>
      <Box sx={{ bgcolor: 'background.default', minHeight: '100vh', pb: 4 }}>
        <Box
          sx={{
            px: { xs: 2, sm: 3 },
            pt: { xs: 2, sm: 3 },
            pb: 1,
            maxWidth: 760,
            mx: 'auto',
          }}
        >
          <Stack direction="row" alignItems="baseline" justifyContent="space-between" spacing={1}>
            <Box>
              {/* Once the OTP gate signs the worker in, the remaining steps
                  are profile completion — "Sign up" would be wrong. */}
              <Typography variant="h5" component="h1">
                {user
                  ? guestLanguage === 'es'
                    ? 'Completa tu perfil'
                    : 'Finish your profile'
                  : guestLanguage === 'es'
                    ? 'Crear cuenta'
                    : 'Sign up'}
              </Typography>
              {signupGroupTitle ? (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {guestLanguage === 'es' ? 'Registrándote para: ' : 'Signing up for: '}
                  <strong>{signupGroupTitle}</strong>
                </Typography>
              ) : null}
            </Box>
            {/* Quiet EN | ES toggle — same language picker as /login/phone. */}
            <Box sx={{ whiteSpace: 'nowrap' }}>
              <button type="button" style={langToggleStyle(guestLanguage === 'en')} onClick={() => setGuestLanguage('en')}>EN</button>
              <span style={{ color: '#ccc', margin: '0 8px' }}>|</span>
              <button type="button" style={langToggleStyle(guestLanguage === 'es')} onClick={() => setGuestLanguage('es')}>ES</button>
            </Box>
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
    </ThemeProvider>
  );
};

export default Apply;

import React, { useEffect, useMemo, useState } from 'react';
import { Box, CircularProgress, Stack, ThemeProvider, Typography } from '@mui/material';
import { useParams } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import Wizard from '../components/apply/Wizard';
import { getWorkerTheme } from '../theme/workerTheme';
import { langToggleStyle } from './authMinimalStyles';
import { useGuestLanguage } from '../hooks/useGuestLanguage';
import { loadLocale, setLanguage } from '../i18n';

type RouteParams = {
  tenantSlug?: string;
  jobId?: string;
};

const ApplyWizardPage: React.FC = () => {
  const { tenantSlug, jobId } = useParams<RouteParams>();
  const { user } = useAuth();
  // Same shell as /c1/apply (Greg 2026-08-25): the jobs-board apply ran the
  // shared wizard on the ADMIN theme — blue buttons, wrong fonts. Worker
  // canon + the quiet EN|ES toggle now wrap this route too.
  const workerTheme = useMemo(() => getWorkerTheme(), []);
  const [guestLanguage, setGuestLanguage] = useGuestLanguage();
  const [localeLoading, setLocaleLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
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

  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [actualSlug, setActualSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keep the raw slug for ID detection (Firestore IDs are case sensitive)
  const rawTenantSlug = tenantSlug || '';
  const effectiveTenantSlug = useMemo(() => rawTenantSlug.toLowerCase(), [rawTenantSlug]);

  useEffect(() => {
    let cancelled = false;
    const timeoutMs = 15000;

    const resolveTenant = async () => {
      try {
        setLoading(true);
        setError(null);

        if (!rawTenantSlug) {
          setError('Missing tenant slug');
          return;
        }

        const finish = () => {
          if (!cancelled) setLoading(false);
        };

        const timeoutId = setTimeout(() => {
          if (!cancelled) {
            setError('Request timed out. Check your connection or try again.');
            setLoading(false);
          }
        }, timeoutMs);

        try {
          // If the param looks like a Firestore ID (no dashes and length >= 20),
          // use it AS-IS. Proceed with this ID even if we can't read the tenant doc
          // (e.g. unauthenticated users may not have read access to tenants collection).
          const looksLikeId = /^[A-Za-z0-9]{20,}$/.test(rawTenantSlug);
          if (looksLikeId) {
            setTenantId(rawTenantSlug);
            try {
              const tenantRef = doc(db, 'tenants', rawTenantSlug);
              const tenantSnap = await getDoc(tenantRef);
              if (cancelled) return;
              if (tenantSnap.exists()) {
                const data = tenantSnap.data() as any;
                setTenantName(data?.name || null);
                setActualSlug(data?.slug || null);
              }
            } catch (_) {
              // Permission denied or network error: still proceed with tenantId from URL
              if (!cancelled) {
                setTenantName(null);
                setActualSlug(null);
              }
            }
            return;
          }

          // Resolve by slug (requires read on tenants collection)
          const q = query(collection(db, 'tenants'), where('slug', '==', effectiveTenantSlug), limit(1));
          const snap = await getDocs(q);
          if (cancelled) return;
          if (!snap.empty) {
            const docSnap = snap.docs[0];
            setTenantId(docSnap.id);
            const data = docSnap.data() as any;
            setTenantName(data?.name || null);
            setActualSlug(data?.slug || effectiveTenantSlug);
            return;
          }

          setError('Tenant not found');
        } finally {
          clearTimeout(timeoutId);
          finish();
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || 'Failed to load tenant');
          setLoading(false);
        }
      }
    };
    resolveTenant();
    return () => { cancelled = true; };
  }, [effectiveTenantSlug, rawTenantSlug]);

  if (loading || localeLoading) {
    return (
      <Box display="flex" alignItems="center" justifyContent="center" minHeight="40vh">
        <CircularProgress size={28} />
      </Box>
    );
  }

  if (error || !tenantId) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h6" fontWeight={700}>Application</Typography>
        <Typography variant="body2" color="error" sx={{ mt: 1 }}>{error || 'Unknown error'}</Typography>
      </Box>
    );
  }

  return (
    <ThemeProvider theme={workerTheme}>
      <Box sx={{ bgcolor: 'background.default', minHeight: '100vh', pb: 4 }}>
        <Box
          sx={{
            // Signed-in: C1WorkerLayout already provides the gutter, top
            // padding, and 720 width — adding our own stacked them (the
            // Apply/EN|ES row sat low and narrower than the card, Greg
            // 2026-08-25). Guests get the full shell from this page.
            px: user ? 0 : { xs: 2, sm: 3 },
            pt: user ? 0.5 : { xs: 2, sm: 3 },
            pb: 1.5,
            maxWidth: user ? 'none' : { sm: 720 },
            mx: 'auto',
          }}
        >
          <Stack direction="row" alignItems="baseline" justifyContent="space-between" spacing={1}>
            {/* Job applies get their title from the wizard's posting header;
                the generic route mirrors /c1/apply's auth-aware title. */}
            <Typography variant="h5" component="h1">
              {jobId
                ? guestLanguage === 'es'
                  ? 'Aplicar'
                  : 'Apply'
                : user
                  ? guestLanguage === 'es'
                    ? 'Completa tu perfil'
                    : 'Finish your profile'
                  : guestLanguage === 'es'
                    ? 'Crear cuenta'
                    : 'Sign up'}
            </Typography>
            <Box sx={{ whiteSpace: 'nowrap' }}>
              <button type="button" style={langToggleStyle(guestLanguage === 'en')} onClick={() => setGuestLanguage('en')}>EN</button>
              <span style={{ color: '#ccc', margin: '0 8px' }}>|</span>
              <button type="button" style={langToggleStyle(guestLanguage === 'es')} onClick={() => setGuestLanguage('es')}>ES</button>
            </Box>
          </Stack>
        </Box>
        <Wizard
          tenantId={tenantId}
          tenantSlug={actualSlug || rawTenantSlug}
          tenantName={tenantName || undefined}
          jobId={jobId}
          uid={user?.uid || null}
        />
      </Box>
    </ThemeProvider>
  );
};

export default ApplyWizardPage;



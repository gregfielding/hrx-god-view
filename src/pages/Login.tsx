import React, { useRef, useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';
import { Box, Button, TextField, Typography, Paper, Alert, CircularProgress, Link as MuiLink } from '@mui/material';

import { auth } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { setLanguage } from '../i18n';
import { useGuestLanguage } from '../hooks/useGuestLanguage';


const Login = () => {
  const { user, loading, securityLevel, activeTenant } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localLoading, setLocalLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [guestLanguage, setGuestLanguage] = useGuestLanguage();
  const didRedirectRef = useRef(false);
  const didConsumeLocationStateRef = useRef(false);

  const copy = guestLanguage === 'es'
    ? {
        title: 'Iniciar sesión',
        email: 'Correo electrónico',
        password: 'Contraseña',
        submit: 'Iniciar sesión',
        language: 'Idioma',
        forgotPassword: '¿Olvidaste tu contraseña?',
        firstTimePrompt: '¿Primera vez?',
        firstTimeAction: 'Configura tu cuenta',
        forgotEnterEmail: 'Ingresa tu correo electrónico arriba primero, luego haz clic en "¿Olvidaste tu contraseña?".',
        forgotSent: 'Te enviamos un enlace para restablecer tu contraseña. Revisa tu correo.',
        forgotError: 'No se pudo enviar el enlace de restablecimiento. Verifica el correo electrónico e inténtalo de nuevo.',
      }
    : {
        title: 'Platform Login',
        email: 'Email',
        password: 'Password',
        submit: 'Login',
        language: 'Language',
        forgotPassword: 'Forgot password?',
        firstTimePrompt: 'First time here?',
        firstTimeAction: 'Set up your account',
        forgotEnterEmail: 'Enter your email above first, then tap "Forgot password?".',
        forgotSent: "We've sent you a password reset link. Check your email.",
        forgotError: "Couldn't send reset link. Double-check the email and try again.",
      };

  // Redirect once fully authenticated and role is loaded
  useEffect(() => {
    if (didRedirectRef.current) return;
    if (!loading && user && securityLevel != null && String(securityLevel).trim() !== '') {
      try {
        const secLevel = parseInt(String(securityLevel), 10);
        didRedirectRef.current = true;
        const state = location.state as { from?: { pathname?: string; search?: string; hash?: string } } | null;
        const from = state?.from;
        const deepLink =
          from && typeof from.pathname === 'string' && from.pathname.startsWith('/c1/')
            ? `${from.pathname}${from.search || ''}${from.hash || ''}`
            : '';
        if (secLevel >= 0 && secLevel <= 4) {
          if (deepLink) {
            navigate(deepLink, { replace: true });
          } else {
            const tenantSlug = activeTenant?.slug || 'c1';
            navigate(`/${tenantSlug}/users/${user.uid}`, { replace: true });
          }
        } else {
          navigate('/', { replace: true });
        }
      } catch (error) {
        console.error('Error during login redirect:', error);
        didRedirectRef.current = true;
        navigate('/', { replace: true });
      }
    }
  }, [user, loading, securityLevel, activeTenant, navigate, location]);

  // Check for success message from password setup
  useEffect(() => {
    if (didConsumeLocationStateRef.current) return;
    const state = location.state as any;
    const msg = state?.message ? String(state.message) : '';
    const stateEmail = state?.email ? String(state.email) : '';
    if (msg) {
      didConsumeLocationStateRef.current = true;
      setSuccessMessage(msg);
      if (stateEmail && !email) setEmail(stateEmail);
      // Clear location.state; navigating to the same route without overriding `state`
      // can cause a render loop on some React Router versions.
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.key, location.pathname, navigate, email]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalLoading(true);
    setError('');
    try {
      await signInWithEmailAndPassword(auth, email, password);
      // don't navigate here — wait for role to resolve in useEffect
      setLocalLoading(false);
    } catch (err: any) {
      setError(err.message);
      setLocalLoading(false);
    }
  };

  /**
   * BI.0 RECOVERY (PR #6 Fix D — login UX hardening): "Forgot password?" sends
   * a password-reset email via Firebase. Same flow as `inviteUser.ts` server-
   * side; the resulting link lands on `/setup-password?oobCode=...` which the
   * worker can use to set a new password and auto-sign-in (Fix B). For the
   * 4,400 migration workers this also doubles as a "claim my account" path:
   * once `createAuthForMigrants.ts --write` runs, every migrant has an Auth
   * account, so triggering Forgot password by email just regenerates a fresh
   * setup-password oobCode.
   */
  const handleForgotPassword = async () => {
    setError('');
    setSuccessMessage('');
    if (!email || !email.includes('@')) {
      setError(copy.forgotEnterEmail);
      return;
    }
    setLocalLoading(true);
    try {
      await sendPasswordResetEmail(auth, email.trim().toLowerCase(), {
        url: 'https://app.hrxone.com/setup-password?continueUrl=/c1/workers/payroll',
        handleCodeInApp: true,
      });
      setSuccessMessage(copy.forgotSent);
    } catch (err: unknown) {
      console.warn('sendPasswordResetEmail failed:', err);
      setError(copy.forgotError);
    } finally {
      setLocalLoading(false);
    }
  };

  useEffect(() => {
    setLanguage(guestLanguage);
  }, [guestLanguage]);

  return (
    <Box display="flex" justifyContent="center" alignItems="center" height="100vh">
      <Paper elevation={3} sx={{ p: 4, width: 400 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'flex-end', mb: 1 }}>
          <Typography variant="caption" color="text.secondary">
            {copy.language}
          </Typography>
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
        </Box>
        <Typography variant="h5" gutterBottom>
          {copy.title}
        </Typography>

        {successMessage && (
          <Alert severity="success" sx={{ mb: 2 }}>
            {successMessage}
          </Alert>
        )}

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <form onSubmit={handleLogin}>
          <TextField
            label={copy.email}
            type="email"
            name="email"
            autoComplete="email"
            fullWidth
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            margin="normal"
          />
          <TextField
            label={copy.password}
            type="password"
            name="password"
            autoComplete="current-password"
            fullWidth
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            margin="normal"
          />

          <Button
            type="submit"
            variant="contained"
            color="primary"
            fullWidth
            sx={{ mt: 2 }}
            disabled={localLoading || loading}
          >
            {localLoading || loading ? <CircularProgress size={24} /> : copy.submit}
          </Button>

          <Box sx={{ mt: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
            <MuiLink
              component="button"
              type="button"
              variant="body2"
              underline="hover"
              onClick={handleForgotPassword}
              disabled={localLoading || loading}
              sx={{ cursor: 'pointer' }}
            >
              {copy.forgotPassword}
            </MuiLink>
            <Box sx={{ textAlign: 'right' }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {copy.firstTimePrompt}
              </Typography>
              <MuiLink
                component="button"
                type="button"
                variant="body2"
                underline="hover"
                onClick={handleForgotPassword}
                disabled={localLoading || loading}
                sx={{ cursor: 'pointer' }}
              >
                {copy.firstTimeAction}
              </MuiLink>
            </Box>
          </Box>
        </form>
      </Paper>
    </Box>
  );
};

export default Login;

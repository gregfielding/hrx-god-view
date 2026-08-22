import React, { useRef, useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { sendPasswordReset } from '../services/sendPasswordResetCallable';
import { A, langToggleStyle } from './authMinimalStyles';

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
        phoneLogin: 'Iniciar sesión con tu celular',
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
        phoneLogin: 'Sign in with your phone instead',
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
      // Trim: iOS autocomplete appends a trailing space to emails, which
      // Firebase reports as auth/invalid-credential (2026-08-17, two
      // candidates locked out on mobile).
      await signInWithEmailAndPassword(auth, email.trim(), password);
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
      // Routes through our authenticated SendGrid sender (deliverable),
      // not Firebase's built-in mailer which was getting spam-foldered.
      await sendPasswordReset(email, '/c1/workers/payroll');
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

  const busy = localLoading || loading;
  const primaryStyle = { ...A.button, ...(busy ? A.buttonDisabled : {}) };

  return (
    <div style={A.page}>
      <div style={A.top}>
        <button type="button" style={langToggleStyle(guestLanguage === 'en')} onClick={() => setGuestLanguage('en')}>EN</button>
        <span style={{ color: '#ccc', margin: '0 8px' }}>|</span>
        <button type="button" style={langToggleStyle(guestLanguage === 'es')} onClick={() => setGuestLanguage('es')}>ES</button>
      </div>

      <main style={A.main}>
        <h1 style={A.h1}>{copy.title}</h1>

        <form onSubmit={handleLogin}>
          <div style={A.field}>
            <label style={A.label} htmlFor="login-email">{copy.email}</label>
            <input
              id="login-email"
              style={A.input}
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div style={A.field}>
            <label style={A.label} htmlFor="login-password">{copy.password}</label>
            <input
              id="login-password"
              style={A.input}
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button type="submit" style={primaryStyle} disabled={busy}>
            {busy ? '…' : copy.submit}
          </button>

          {successMessage && <p style={A.success}>{successMessage}</p>}
          {error && <p style={A.error}>{error}</p>}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, marginTop: 28 }}>
            <button type="button" style={A.linkBtn} onClick={handleForgotPassword} disabled={busy}>
              {copy.forgotPassword}
            </button>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 12, color: '#777', marginBottom: 2 }}>{copy.firstTimePrompt}</div>
              <button type="button" style={A.linkBtn} onClick={handleForgotPassword} disabled={busy}>
                {copy.firstTimeAction}
              </button>
            </div>
          </div>
        </form>
      </main>

      <footer style={A.footer}>
        <img src="/C1.png" alt="C1 Staffing" style={A.logo} />
        <button type="button" style={A.quietLink} onClick={() => navigate('/login/phone')}>
          {copy.phoneLogin}
        </button>
      </footer>
    </div>
  );
};

export default Login;

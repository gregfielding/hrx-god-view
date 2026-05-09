import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  confirmPasswordReset,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  verifyPasswordResetCode,
} from 'firebase/auth';
import {
  Box,
  Button,
  Stack,
  TextField,
  Typography,
  Paper,
  Alert,
  CircularProgress,
  Container,
} from '@mui/material';

import { auth } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

const SetupPassword = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [email, setEmail] = useState('');

  /**
   * BI.0 RECOVERY (PR #7): when the Firebase password-reset oobCode is
   * invalid or expired, replace the dead-end "Please contact your administrator"
   * message with an inline self-recovery panel. The user enters their email
   * and we call `sendPasswordResetEmail` to issue a fresh code — same flow as
   * the Login page's "Forgot password" affordance, but without a round-trip
   * back to /login. The vast majority of "invalid invitation" hits are TTL
   * expiry (Firebase's 1-hour wall) or single-use consumption — both fully
   * recoverable by the user without admin intervention.
   *
   * - `linkInvalid`: set true when verifyPasswordResetCode or
   *   confirmPasswordReset reports `auth/invalid-action-code` /
   *   `auth/expired-action-code`. Hides the password form and shows the
   *   recovery panel instead.
   * - `recoveryEmail`: separate state from `email` because verifyPasswordResetCode
   *   only returns the canonical email when the code is valid; on invalid
   *   codes we have to ask the user.
   * - `recoverySent`: flips after a successful sendPasswordResetEmail call so
   *   the panel can swap to the "check your email" confirmation.
   */
  const [linkInvalid, setLinkInvalid] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoverySent, setRecoverySent] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');

  const searchParams = new URLSearchParams(location.search);
  const actionCode = searchParams.get('oobCode');
  /**
   * BI.0 RECOVERY (PR #6 Fix B): one-tap migration flow honors a same-origin
   * `continueUrl` query param so the post-set-password redirect can land the
   * worker directly on `/c1/workers/payroll` (or any same-origin path) instead
   * of the generic `/dashboard`. Safelist:
   *   - same-origin only (path must begin with `/`, no scheme, no double-slash);
   *   - max 256 chars to avoid open-redirect-style abuse;
   *   - falls back to `/dashboard` on validation failure.
   * The migration `createAuthForMigrants.ts` script bakes
   * `?continueUrl=/c1/workers/payroll` into the Firebase action code URL; the
   * Firebase auth handler appends `oobCode` etc. and then redirects here.
   */
  const rawContinueUrl = searchParams.get('continueUrl');
  const continueUrl = (() => {
    if (!rawContinueUrl) return '/dashboard';
    if (rawContinueUrl.length > 256) return '/dashboard';
    if (!rawContinueUrl.startsWith('/')) return '/dashboard';
    if (rawContinueUrl.startsWith('//')) return '/dashboard';
    return rawContinueUrl;
  })();

  useEffect(() => {
    // If user is already authenticated, redirect to continueUrl (or `/` if none).
    // This also catches the post-auto-sign-in race after `confirmPasswordReset`
    // (BI.0 RECOVERY one-tap flow): if AuthContext rerenders with the new
    // `user` before our explicit `navigate(continueUrl)` call commits, this
    // useEffect's redirect lands on the correct destination instead of `/`.
    if (user) {
      navigate(continueUrl !== '/dashboard' ? continueUrl : '/', { replace: true });
      return;
    }

    if (actionCode) {
      verifyPasswordResetCode(auth, actionCode)
        .then((email) => {
          setEmail(email);
        })
        .catch(() => {
          // Firebase password-reset codes expire after 1h or after a single
          // use. Flip into the recovery panel rather than showing a dead-end
          // "contact your administrator" message — the user can request a
          // fresh link inline (PR #7).
          setLinkInvalid(true);
        });
    } else {
      setLinkInvalid(true);
    }
  }, [actionCode, user, navigate, continueUrl]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!actionCode) {
      setError('No invitation code found');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters long');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await confirmPasswordReset(auth, actionCode, password);

      /**
       * BI.0 RECOVERY (PR #6 Fix B): one-tap migration flow auto-signs the
       * worker in immediately after a successful password set, so the
       * continueUrl redirect lands them on `/c1/workers/payroll` already
       * authenticated. Without this, `/dashboard` would bounce to `/login`
       * and the worker would have to type their just-set password a second
       * time — defeating the purpose of the one-tap pattern. The sign-in is
       * best-effort: if it fails we fall through to the success screen and
       * the worker can still navigate manually (legacy UX preserved).
       *
       * `email` is set by the prior `verifyPasswordResetCode` call (line ~58),
       * so it's the canonical Firebase-recognized email tied to this oobCode.
       */
      let autoSignedIn = false;
      if (email) {
        try {
          await signInWithEmailAndPassword(auth, email, password);
          autoSignedIn = true;
        } catch (signInErr) {
          console.warn('Auto-sign-in after password reset failed; user can sign in manually:', signInErr);
        }
      }

      if (autoSignedIn) {
        // One-tap success: skip the legacy "Password changed → CONTINUE" screen
        // entirely and navigate the (now authenticated) worker straight to the
        // continueUrl. The AuthContext-driven `useEffect` above will fire on
        // the next render with `user` set, but `navigate(continueUrl, { replace })`
        // wins because it's synchronous in this same React batch.
        navigate(continueUrl, { replace: true });
        return;
      }

      setSuccess(true);

    } catch (err: any) {
      console.error('Password reset error:', err);

      // Handle specific Firebase Auth errors
      if (err.code === 'auth/invalid-action-code' || err.code === 'auth/expired-action-code') {
        // Code may have been valid on initial verify but expired between
        // page-load and submit (1h TTL is generous but we've seen workers
        // sit on the form). Or the user navigated back and re-submitted
        // after a previous successful set. Either way: drop into recovery
        // mode and prefill the email since we already have it from the
        // initial verify call.
        setLinkInvalid(true);
        if (email) setRecoveryEmail(email);
      } else if (err.code === 'auth/weak-password') {
        setError('Password is too weak. Please choose a stronger password.');
      } else {
        setError(err.message || 'Failed to set password. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  /**
   * Recovery panel: send a fresh password-reset email to the user. We use the
   * same `actionCodeSettings` as the Login page's "Forgot password" so the
   * generated link lands the user back at /setup-password — keeping them on
   * the same flow rather than bouncing through /login.
   */
  const handleSendFreshLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecoveryError('');
    const trimmed = recoveryEmail.trim().toLowerCase();
    if (!trimmed || !trimmed.includes('@')) {
      setRecoveryError('Please enter the email address you used to sign up.');
      return;
    }
    setRecoveryLoading(true);
    try {
      // Preserve the user's original `continueUrl` so a recruiter / agency-admin
      // invite that hit the dead-link → recovery loop doesn't get force-routed
      // into the worker payroll surface. The component-level `continueUrl`
      // value is already validated (same-origin, length-capped) at line ~77.
      await sendPasswordResetEmail(auth, trimmed, {
        url: `https://app.hrxone.com/setup-password?continueUrl=${encodeURIComponent(continueUrl)}`,
        handleCodeInApp: true,
      });
      // Firebase intentionally does not signal whether the email is registered
      // (to prevent enumeration attacks). We always show success — if the
      // address is unknown, no email is sent and the user will eventually
      // contact support.
      setRecoverySent(true);
    } catch (err: any) {
      console.warn('sendPasswordResetEmail failed:', err);
      setRecoveryError('Could not send a new link right now. Please try again in a moment.');
    } finally {
      setRecoveryLoading(false);
    }
  };

  if (success) {
    return (
      <Container maxWidth="sm">
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
          <Paper elevation={3} sx={{ p: 4, width: '100%', textAlign: 'center' }}>
            <Typography variant="h5" gutterBottom color="success.main">
              Password changed
            </Typography>
            <Typography variant="body1" sx={{ mb: 3 }}>
              You can now sign in with your new password
            </Typography>
            <Button
              variant="contained"
              color="primary"
              onClick={() => navigate(continueUrl)}
              sx={{ minWidth: 120 }}
            >
              CONTINUE
            </Button>
          </Paper>
        </Box>
      </Container>
    );
  }

  if (linkInvalid) {
    return (
      <Container maxWidth="sm">
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
          <Paper elevation={3} sx={{ p: 4, width: '100%' }}>
            {recoverySent ? (
              <>
                <Typography variant="h5" gutterBottom>
                  Check your email
                </Typography>
                <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
                  We sent a fresh setup link to <strong>{recoveryEmail.trim().toLowerCase()}</strong>.
                  Open it on this phone to finish setting your password.
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                  If you don&rsquo;t see it within a few minutes, check your spam folder or try
                  again with a different email address.
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                  <Button
                    variant="outlined"
                    onClick={() => {
                      setRecoverySent(false);
                      setRecoveryError('');
                    }}
                  >
                    Try a different email
                  </Button>
                  <Button variant="text" onClick={() => navigate('/login')}>
                    Sign in instead
                  </Button>
                </Stack>
              </>
            ) : (
              <>
                <Typography variant="h5" gutterBottom>
                  This link has expired
                </Typography>
                <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
                  Setup links work for a limited time and only once. Enter your email and
                  we&rsquo;ll send you a fresh one.
                </Typography>

                {recoveryError && (
                  <Alert severity="error" sx={{ mb: 2 }}>
                    {recoveryError}
                  </Alert>
                )}

                <form onSubmit={handleSendFreshLink}>
                  <TextField
                    label="Email"
                    type="email"
                    fullWidth
                    value={recoveryEmail}
                    onChange={(e) => setRecoveryEmail(e.target.value)}
                    margin="normal"
                    autoComplete="email"
                    autoFocus
                    required
                    helperText="Use the email your employer has on file."
                  />
                  <Button
                    type="submit"
                    variant="contained"
                    color="primary"
                    fullWidth
                    sx={{ mt: 2 }}
                    disabled={recoveryLoading}
                  >
                    {recoveryLoading ? <CircularProgress size={24} /> : 'Send me a new link'}
                  </Button>
                </form>

                <Box sx={{ mt: 2, textAlign: 'center' }}>
                  <Typography variant="body2" color="text.secondary">
                    Already set your password?{' '}
                    <Button variant="text" size="small" onClick={() => navigate('/login')}>
                      Sign In
                    </Button>
                  </Typography>
                </Box>
              </>
            )}
          </Paper>
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="sm">
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
        <Paper elevation={3} sx={{ p: 4, width: '100%' }}>
          <Typography variant="h5" gutterBottom>
            Set Your Password
          </Typography>

          {email && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Setting up account for: {email}
            </Typography>
          )}

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <form onSubmit={handleSubmit}>
            <TextField
              label="New Password"
              type="password"
              fullWidth
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              margin="normal"
              required
              helperText="Password must be at least 6 characters long"
            />

            <TextField
              label="Confirm Password"
              type="password"
              fullWidth
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              margin="normal"
              required
              error={password !== confirmPassword && confirmPassword !== ''}
              helperText={
                password !== confirmPassword && confirmPassword !== ''
                  ? "Passwords don't match"
                  : ''
              }
            />

            <Button
              type="submit"
              variant="contained"
              color="primary"
              fullWidth
              sx={{ mt: 3 }}
              disabled={loading || !actionCode || !email}
            >
              {loading ? <CircularProgress size={24} /> : 'Set Password'}
            </Button>
          </form>

          <Box sx={{ mt: 2, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              Already have an account?{' '}
              <Button
                variant="text"
                size="small"
                onClick={() => navigate('/login')}
              >
                Sign In
              </Button>
            </Typography>
          </Box>
        </Paper>
      </Box>
    </Container>
  );
};

export default SetupPassword; 
import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { confirmPasswordReset, signInWithEmailAndPassword, verifyPasswordResetCode } from 'firebase/auth';
import {
  Box,
  Button,
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
        .catch((err) => {
          setError('Invalid or expired invitation link. Please contact your administrator for a new invitation.');
        });
    } else {
      setError('No invitation code found. Please use the link from your invitation email.');
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
      if (err.code === 'auth/invalid-action-code') {
        setError('Invalid or expired invitation link. Please contact your administrator for a new invitation.');
      } else if (err.code === 'auth/weak-password') {
        setError('Password is too weak. Please choose a stronger password.');
      } else {
        setError(err.message || 'Failed to set password. Please try again.');
      }
    } finally {
      setLoading(false);
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
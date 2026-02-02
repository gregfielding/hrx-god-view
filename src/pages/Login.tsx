import React, { useRef, useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { Box, Button, TextField, Typography, Paper, Alert, CircularProgress } from '@mui/material';

import { auth } from '../firebase';
import { useAuth } from '../contexts/AuthContext';


const Login = () => {
  const { user, role, loading, securityLevel, activeTenant } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localLoading, setLocalLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const didRedirectRef = useRef(false);
  const didConsumeLocationStateRef = useRef(false);

  // Redirect once fully authenticated and role is loaded
  useEffect(() => {
    if (didRedirectRef.current) return;
    if (!loading && user && securityLevel != null && String(securityLevel).trim() !== '') {
      try {
        // Staff (security levels 0-4) go to their profile
        const secLevel = parseInt(String(securityLevel), 10);
        didRedirectRef.current = true;
        if (secLevel >= 0 && secLevel <= 4) {
          const tenantSlug = activeTenant?.slug || 'c1';
          navigate(`/${tenantSlug}/users/${user.uid}`, { replace: true });
        } else {
          // Admins go to dashboard
          navigate('/', { replace: true });
        }
      } catch (error) {
        console.error('Error during login redirect:', error);
        // Fallback to dashboard
        didRedirectRef.current = true;
        navigate('/', { replace: true });
      }
    }
  }, [user, loading, securityLevel, activeTenant, navigate]);

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

  return (
    <Box display="flex" justifyContent="center" alignItems="center" height="100vh">
      <Paper elevation={3} sx={{ p: 4, width: 400 }}>
        <Typography variant="h5" gutterBottom>
          Platform Login
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
            label="Email"
            type="email"
            name="email"
            fullWidth
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            margin="normal"
          />
          <TextField
            label="Password"
            type="password"
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
            {localLoading || loading ? <CircularProgress size={24} /> : 'Login'}
          </Button>
        </form>
      </Paper>
    </Box>
  );
};

export default Login;

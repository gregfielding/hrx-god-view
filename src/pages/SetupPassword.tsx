import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import { auth } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
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

  // Get the action code from URL parameters
  const searchParams = new URLSearchParams(location.search);
  const actionCode = searchParams.get('oobCode');

  useEffect(() => {
    // If user is already authenticated, redirect to dashboard
    if (user) {
      navigate('/');
      return;
    }

    // Verify the password reset code and get the email
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
  }, [actionCode, user, navigate]);

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
      // Confirm the password reset
      await confirmPasswordReset(auth, actionCode, password);
      
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
              onClick={() => navigate('/dashboard')}
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
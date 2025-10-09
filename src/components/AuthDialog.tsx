import React, { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  Alert,
  CircularProgress,
  Tabs,
  Tab,
  IconButton,
  InputAdornment,
  Link,
} from '@mui/material';
import {
  Close as CloseIcon,
  Email as EmailIcon,
  Lock as LockIcon,
  Visibility,
  VisibilityOff,
} from '@mui/icons-material';
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile
} from 'firebase/auth';
import { auth, db } from '../firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';

interface AuthDialogProps {
  open: boolean;
  onClose: () => void;
  onAuthSuccess: () => void;
}

const AuthDialog: React.FC<AuthDialogProps> = ({ open, onClose, onAuthSuccess }) => {
  const [activeTab, setActiveTab] = useState(0);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  // Refs for focus management
  const emailRef = useRef<HTMLInputElement>(null);
  const firstNameRef = useRef<HTMLInputElement>(null);

  // Auto-focus first field when modal opens
  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => {
        if (activeTab === 0 && firstNameRef.current) {
          firstNameRef.current.focus();
        } else if (activeTab === 1 && emailRef.current) {
          emailRef.current.focus();
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [open, activeTab]);

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
    setError(null);
    setSuccess(null);
    // Focus appropriate field after tab change
    setTimeout(() => {
      if (newValue === 0 && firstNameRef.current) {
        firstNameRef.current.focus();
      } else if (newValue === 1 && emailRef.current) {
        emailRef.current.focus();
      }
    }, 100);
  };

  const handleClose = () => {
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setFirstName('');
    setLastName('');
    setError(null);
    setSuccess(null);
    setShowPassword(false);
    setShowConfirmPassword(false);
    setActiveTab(0);
    onClose();
  };

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validatePassword = (password: string): boolean => {
    // At least 8 characters, 1 uppercase, 1 lowercase, 1 number
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d@$!%*?&]{8,}$/;
    return passwordRegex.test(password);
  };

  const handleKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      if (activeTab === 0) {
        handleSignUp();
      } else {
        handleSignIn();
      }
    }
  };

  const handleSignUp = async () => {
    setError(null);
    setSuccess(null);

    // Validation
    if (!email || !password || !firstName || !lastName) {
      setError('All fields are required');
      return;
    }

    if (!validateEmail(email)) {
      setError('Please enter a valid email address');
      return;
    }

    if (!validatePassword(password)) {
      setError('Password must be at least 8 characters with uppercase, lowercase, and number');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      // Create user account
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // Update user profile with display name
      await updateProfile(user, {
        displayName: `${firstName} ${lastName}`.trim()
      });

      // Get the tenantId from the current route (C1 tenant)
      const isC1Route = window.location.pathname.startsWith('/c1/');
      const tenantId = isC1Route ? 'BCiP2bQ9CgVOCTfV6MhD' : null;
      
      if (!tenantId) {
        throw new Error('Unable to determine tenant for user registration');
      }

      // Create user profile in Firestore
      const userProfile = {
        uid: user.uid,
        email: user.email,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        displayName: `${firstName} ${lastName}`.trim(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastLogin: serverTimestamp(),
        // Default values for new users from public jobs board
        securityLevel: '2' as const, // Applicant level
        role: 'Tenant' as const,
        orgType: 'Tenant' as const,
        activeTenantId: tenantId,
        tenantIds: {
          [tenantId]: {
            role: 'Applicant',
            securityLevel: '2'
          }
        },
        isActive: true,
        avatar: null,
        phone: '',
        address: {
          street: '',
          city: '',
          state: '',
          zipCode: '',
          coordinates: null
        },
        // Work status and eligibility
        workStatus: 'Active',
        workEligibility: false, // Gate that must be verified before job applications
        dob: undefined, // Date of birth in YYYY-MM-DD format
        phoneE164: undefined, // Phone number in E.164 format
        phoneVerified: false, // Phone verification status
        // Employment details
        employmentType: undefined, // Leave blank as per requirement
        departmentId: '',
        divisionId: '',
        locationId: '',
        regionId: '',
        managerId: '',
        startDate: null,
        workerId: '',
        // Job/Profile fields
        jobTitle: '',
        linkedinUrl: '',
        preferredName: '',
        // Languages and skills
        languages: [],
        skills: [],
        certifications: [],
        // User associations
        userGroupIds: [],
        // Module access flags - explicitly set to false for applicants
        crm_sales: false,
        recruiter: false,
        jobsBoard: false,
        // Job application related fields
        applications: [],
        favorites: [],
        // Profile completion tracking
        profileComplete: false,
        onboarded: false,
        // Public jobs board specific
        source: 'public_jobs_board'
      };

      await setDoc(doc(db, 'users', user.uid), userProfile);

      setSuccess('✅ Account created! Redirecting you to available jobs…');
      
      // Close dialog and refresh page state after a brief delay
      setTimeout(() => {
        onAuthSuccess();
        handleClose();
      }, 2000);

    } catch (error: any) {
      console.error('Sign up error:', error);
      
      // Handle specific Firebase errors
      switch (error.code) {
        case 'auth/email-already-in-use':
          setError('An account with this email already exists. Try signing in instead.');
          break;
        case 'auth/weak-password':
          setError('Password is too weak. Please choose a stronger password.');
          break;
        case 'auth/invalid-email':
          setError('Please enter a valid email address.');
          break;
        default:
          setError('Failed to create account. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async () => {
    setError(null);
    setSuccess(null);

    if (!email || !password) {
      setError('Email and password are required');
      return;
    }

    if (!validateEmail(email)) {
      setError('Please enter a valid email address');
      return;
    }

    setLoading(true);

    try {
      await signInWithEmailAndPassword(auth, email, password);
      setSuccess('Welcome back!');
      
      // Close dialog and refresh page state after a brief delay
      setTimeout(() => {
        onAuthSuccess();
        handleClose();
      }, 1000);

    } catch (error: any) {
      console.error('Sign in error:', error);
      
      // Handle specific Firebase errors
      switch (error.code) {
        case 'auth/user-not-found':
          setError('No account found with this email. Please create an account first.');
          break;
        case 'auth/wrong-password':
          setError('Incorrect password. Please try again.');
          break;
        case 'auth/invalid-email':
          setError('Please enter a valid email address.');
          break;
        case 'auth/too-many-requests':
          setError('Too many failed attempts. Please try again later.');
          break;
        default:
          setError('Failed to sign in. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      setError('Please enter your email address first');
      return;
    }

    if (!validateEmail(email)) {
      setError('Please enter a valid email address');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await sendPasswordResetEmail(auth, email);
      setSuccess('Password reset email sent! Check your inbox.');
    } catch (error: any) {
      console.error('Password reset error:', error);
      setError('Failed to send reset email. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const switchToSignIn = () => {
    setActiveTab(1);
    setError(null);
    setSuccess(null);
    setTimeout(() => {
      if (emailRef.current) {
        emailRef.current.focus();
      }
    }, 100);
  };

  const switchToSignUp = () => {
    setActiveTab(0);
    setError(null);
    setSuccess(null);
    setTimeout(() => {
      if (firstNameRef.current) {
        firstNameRef.current.focus();
      }
    }, 100);
  };

  return (
    <Dialog 
      open={open} 
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: { 
          borderRadius: 3,
          maxWidth: '520px',
          width: '100%'
        }
      }}
      aria-labelledby="auth-dialog-title"
      aria-describedby="auth-dialog-description"
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h5" sx={{ fontWeight: 600 }} id="auth-dialog-title">
            {activeTab === 0 ? 'Create Your Account' : 'Welcome Back'}
          </Typography>
          <IconButton onClick={handleClose} size="small" aria-label="Close dialog">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent>
        {/* Subheader */}
        <Typography 
          variant="body2" 
          sx={{ 
            color: 'text.secondary', 
            mb: 3,
            fontSize: '0.95rem'
          }}
          id="auth-dialog-description"
        >
          {activeTab === 0 
            ? 'Start applying in seconds. Save jobs and track your progress.'
            : 'Sign in to apply for jobs, save listings, and track your applications.'
          }
        </Typography>

        <Box sx={{ mb: 3 }}>
          <Tabs 
            value={activeTab} 
            onChange={handleTabChange}
            variant="fullWidth"
            sx={{ 
              borderBottom: 1, 
              borderColor: 'divider',
              '& .MuiTab-root': {
                fontWeight: 600,
                fontSize: '1rem',
                textTransform: 'none',
                '&.Mui-selected': {
                  color: 'primary.main'
                }
              },
              '& .MuiTabs-indicator': {
                height: 3,
                borderRadius: '3px 3px 0 0'
              }
            }}
          >
            <Tab label="Create Account" />
            <Tab label="Sign In" />
          </Tabs>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {success && (
          <Alert severity="success" sx={{ mb: 2 }}>
            {success}
          </Alert>
        )}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          {activeTab === 0 && (
            <>
              <Box sx={{ display: 'flex', gap: 2 }}>
                <TextField
                  ref={firstNameRef}
                  fullWidth
                  label="First Name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  disabled={loading}
                  required
                  onKeyPress={handleKeyPress}
                />
                <TextField
                  fullWidth
                  label="Last Name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  disabled={loading}
                  required
                  onKeyPress={handleKeyPress}
                />
              </Box>
            </>
          )}

          <TextField
            ref={emailRef}
            fullWidth
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            required
            onKeyPress={handleKeyPress}
            InputProps={{
              startAdornment: <EmailIcon sx={{ mr: 1, color: 'text.secondary', opacity: 0.7 }} />
            }}
          />

          <TextField
            fullWidth
            label="Password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            required
            onKeyPress={handleKeyPress}
            InputProps={{
              startAdornment: <LockIcon sx={{ mr: 1, color: 'text.secondary', opacity: 0.7 }} />,
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    onClick={() => setShowPassword(!showPassword)}
                    edge="end"
                    disabled={loading}
                    aria-label="toggle password visibility"
                  >
                    {showPassword ? <VisibilityOff /> : <Visibility />}
                  </IconButton>
                </InputAdornment>
              )
            }}
            helperText={activeTab === 0 ? "At least 8 characters, including uppercase, lowercase, and a number." : ""}
          />

          {activeTab === 0 && (
            <TextField
              fullWidth
              label="Confirm Password"
              type={showConfirmPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={loading}
              required
              onKeyPress={handleKeyPress}
              InputProps={{
                startAdornment: <LockIcon sx={{ mr: 1, color: 'text.secondary', opacity: 0.7 }} />,
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      edge="end"
                      disabled={loading}
                      aria-label="toggle confirm password visibility"
                    >
                      {showConfirmPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                )
              }}
            />
          )}

          {activeTab === 1 && (
            <Box sx={{ textAlign: 'right' }}>
              <Link
                component="button"
                variant="body2"
                onClick={handleForgotPassword}
                disabled={loading || !email}
                sx={{ 
                  textDecoration: 'none',
                  '&:hover': { textDecoration: 'underline' },
                  opacity: loading || !email ? 0.6 : 1
                }}
              >
                Forgot your password?
              </Link>
            </Box>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 3, flexDirection: 'column', gap: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2, width: '100%' }}>
          <Button 
            onClick={handleClose} 
            disabled={loading}
            variant="outlined"
            sx={{ minWidth: 100 }}
          >
            Cancel
          </Button>
          <Button
            onClick={activeTab === 0 ? handleSignUp : handleSignIn}
            variant="contained"
            disabled={loading}
            startIcon={loading ? <CircularProgress size={20} /> : null}
            sx={{ minWidth: 140 }}
          >
            {loading ? 'Please wait...' : (activeTab === 0 ? 'Create Account' : 'Sign In')}
          </Button>
        </Box>

        {/* Footer microcopy */}
        <Box sx={{ textAlign: 'center', width: '100%' }}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {activeTab === 0 ? (
              <>
                Already have an account?{' '}
                <Link
                  component="button"
                  onClick={switchToSignIn}
                  sx={{ 
                    textDecoration: 'none',
                    '&:hover': { textDecoration: 'underline' },
                    fontWeight: 500
                  }}
                >
                  Sign in
                </Link>
              </>
            ) : (
              <>
                Don't have an account yet?{' '}
                <Link
                  component="button"
                  onClick={switchToSignUp}
                  sx={{ 
                    textDecoration: 'none',
                    '&:hover': { textDecoration: 'underline' },
                    fontWeight: 500
                  }}
                >
                  Create one here
                </Link>
              </>
            )}
          </Typography>
        </Box>
      </DialogActions>
    </Dialog>
  );
};

export default AuthDialog;
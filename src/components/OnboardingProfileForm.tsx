import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  createUserWithEmailAndPassword,
  updateProfile,
  sendEmailVerification,
} from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  Button,
  Stepper,
  Step,
  StepLabel,
  CircularProgress,
  Alert,
  Container,
  Avatar,
  IconButton,
  FormControlLabel,
  Checkbox,
  Divider,
  Paper,
} from '@mui/material';
import { PhotoCamera, CheckCircle } from '@mui/icons-material';

import { auth, db } from '../firebase';

interface OnboardingState {
  token: string;
  orgData: {
    id: string;
    name: string;
    type: string;
  } | null;
  role: 'Worker' | 'Applicant';
  type: 'Customer' | 'Agency';
  orgId: string;
}

interface FormData {
  email: string;
  password: string;
  confirmPassword: string;
  firstName: string;
  lastName: string;
  phone: string;
  photoUrl: string;
  acceptTerms: boolean;
  acceptPrivacy: boolean;
}

const steps = ['Account Setup', 'Profile Information', 'Verification'];

const OnboardingProfileForm: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [activeStep, setActiveStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Form data
  const [formData, setFormData] = useState<FormData>({
    email: '',
    password: '',
    confirmPassword: '',
    firstName: '',
    lastName: '',
    phone: '',
    photoUrl: '',
    acceptTerms: false,
    acceptPrivacy: false,
  });

  const [onboardingData, setOnboardingData] = useState<OnboardingState | null>(null);

  useEffect(() => {
    if (location.state) {
      setOnboardingData(location.state as OnboardingState);
    } else {
      navigate('/');
    }
  }, [location.state, navigate]);

  const handleInputChange = (field: keyof FormData, value: string | boolean) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value as any,
    }));
  };

  const validateStep = (step: number): boolean => {
    switch (step) {
      case 0: // Account Setup
        return Boolean(
          formData.email &&
            formData.password &&
            formData.confirmPassword &&
            formData.password === formData.confirmPassword &&
            formData.password.length >= 6,
        );
      case 1: // Profile Information
        return Boolean(formData.firstName && formData.lastName && formData.phone);
      case 2: // Verification
        return formData.acceptTerms && formData.acceptPrivacy;
      default:
        return false;
    }
  };

  const handleNext = () => {
    if (validateStep(activeStep)) {
      setActiveStep((prev) => prev + 1);
      setError(null);
    }
  };

  const handleBack = () => {
    setActiveStep((prev) => prev - 1);
    setError(null);
  };

  const handlePhotoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // For now, we'll use a placeholder URL
      // In production, you'd upload to Firebase Storage
      const reader = new FileReader();
      reader.onload = (e) => {
        setFormData((prev) => ({
          ...prev,
          photoUrl: e.target?.result as string,
        }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async () => {
    if (!onboardingData) return;

    setLoading(true);
    setError(null);

    try {
      // Create Firebase Auth user
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        formData.email,
        formData.password,
      );

      const user = userCredential.user;

      // Update profile with display name and photo
      await updateProfile(user, {
        displayName: `${formData.firstName} ${formData.lastName}`,
        photoURL: formData.photoUrl || undefined,
      });

      // Send email verification
      await sendEmailVerification(user);

      // Create user profile in Firestore
      const userProfile = {
        uid: user.uid,
        email: formData.email,
        phone: formData.phone,
        firstName: formData.firstName,
        lastName: formData.lastName,
        photoUrl: formData.photoUrl || null,
        role: onboardingData.role,
        securityLevel:
          onboardingData.role === 'Applicant'
            ? 'Applicant_Worker'
            : onboardingData.type === 'Customer'
            ? 'Customer_Worker'
            : 'Agency_Worker',
        onboarded: false,
        createdAt: new Date(),
        // Org assignment will be handled by assignOrgToUser function
      };

      await setDoc(doc(db, 'users', user.uid), userProfile);

      // Mark invite token as used
      const functions = getFunctions();
      const markInviteTokenUsed = httpsCallable(functions, 'markInviteTokenUsed');
      await markInviteTokenUsed({
        token: onboardingData.token,
        userId: user.uid,
      });

      // Assign user to organization
      const assignOrgToUser = httpsCallable(functions, 'assignOrgToUser');
      await assignOrgToUser({
        userId: user.uid,
        orgId: onboardingData.orgId,
        type: onboardingData.type,
        role: onboardingData.role,
      });

      setSuccess(true);

      // Navigate to completion screen after a brief delay
      setTimeout(() => {
        navigate('/onboarding/complete', {
          state: {
            userProfile,
            orgData: onboardingData.orgData,
          },
        });
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to create account');
    } finally {
      setLoading(false);
    }
  };

  const renderStepContent = (step: number) => {
    switch (step) {
      case 0:
        return (
          <Box sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Create Your Account
            </Typography>
            <TextField
              fullWidth
              label="Email Address"
              type="email"
              value={formData.email}
              onChange={(e) => handleInputChange('email', e.target.value)}
              margin="normal"
              required
            />
            <TextField
              fullWidth
              label="Password"
              type="password"
              value={formData.password}
              onChange={(e) => handleInputChange('password', e.target.value)}
              margin="normal"
              required
              helperText="Password must be at least 6 characters"
            />
            <TextField
              fullWidth
              label="Confirm Password"
              type="password"
              value={formData.confirmPassword}
              onChange={(e) => handleInputChange('confirmPassword', e.target.value)}
              margin="normal"
              required
              error={
                formData.password !== formData.confirmPassword && formData.confirmPassword !== ''
              }
              helperText={
                formData.password !== formData.confirmPassword && formData.confirmPassword !== ''
                  ? "Passwords don't match"
                  : ''
              }
            />
          </Box>
        );

      case 1:
        return (
          <Box sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Profile Information
            </Typography>

            <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
              <TextField
                fullWidth
                label="First Name"
                value={formData.firstName}
                onChange={(e) => handleInputChange('firstName', e.target.value)}
                required
              />
              <TextField
                fullWidth
                label="Last Name"
                value={formData.lastName}
                onChange={(e) => handleInputChange('lastName', e.target.value)}
                required
              />
            </Box>

            <TextField
              fullWidth
              label="Phone Number"
              type="tel"
              value={formData.phone}
              onChange={(e) => handleInputChange('phone', e.target.value)}
              margin="normal"
              required
              helperText="We'll send you a verification code"
            />

            <Box sx={{ mt: 3, textAlign: 'center' }}>
              <Typography variant="subtitle1" gutterBottom>
                Profile Photo (Optional)
              </Typography>
              <Box sx={{ position: 'relative', display: 'inline-block' }}>
                <Avatar src={formData.photoUrl} sx={{ width: 100, height: 100, mb: 2 }} />
                <input
                  accept="image/*"
                  style={{ display: 'none' }}
                  id="photo-upload"
                  type="file"
                  onChange={handlePhotoUpload}
                />
                <label htmlFor="photo-upload">
                  <IconButton
                    color="primary"
                    aria-label="upload picture"
                    component="span"
                    sx={{ position: 'absolute', bottom: 0, right: 0 }}
                  >
                    <PhotoCamera />
                  </IconButton>
                </label>
              </Box>
            </Box>
          </Box>
        );

      case 2:
        return (
          <Box sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Terms & Privacy
            </Typography>

            <Box sx={{ mb: 3 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={formData.acceptTerms}
                    onChange={(e) => handleInputChange('acceptTerms', e.target.checked)}
                  />
                }
                label="I accept the HRX Terms of Service"
              />
            </Box>

            <Box sx={{ mb: 3 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={formData.acceptPrivacy}
                    onChange={(e) => handleInputChange('acceptPrivacy', e.target.checked)}
                  />
                }
                label="I accept the HRX Privacy Policy"
              />
            </Box>

            <Divider sx={{ my: 2 }} />

            <Box sx={{ bgcolor: 'grey.50', p: 2, borderRadius: 1 }}>
              <Typography variant="subtitle2" gutterBottom>
                Organization Details:
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {onboardingData?.orgData?.name} ({onboardingData?.orgData?.type})
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Role: {onboardingData?.role}
              </Typography>
            </Box>
          </Box>
        );

      default:
        return null;
    }
  };

  if (!onboardingData) {
    return (
      <Container maxWidth="sm" sx={{ mt: 8 }}>
        <CircularProgress />
      </Container>
    );
  }

  if (success) {
    return (
      <Container maxWidth="sm" sx={{ mt: 8 }}>
        <Card>
          <CardContent sx={{ textAlign: 'center', py: 4 }}>
            <CheckCircle color="success" sx={{ fontSize: 64, mb: 2 }} />
            <Typography variant="h5" gutterBottom>
              Account Created Successfully!
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Redirecting to completion screen...
            </Typography>
          </CardContent>
        </Card>
      </Container>
    );
  }

  return (
    <Container maxWidth="md" sx={{ mt: 4 }}>
      <Paper elevation={3} sx={{ p: 4 }}>
        <Box sx={{ mb: 4, textAlign: 'center' }}>
          <Typography variant="h4" gutterBottom>
            Welcome to HRX
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Complete your profile to get started
          </Typography>
        </Box>

        <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
          {steps.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        {renderStepContent(activeStep)}

        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 4 }}>
          <Button disabled={activeStep === 0} onClick={handleBack}>
            Back
          </Button>

          <Box>
            {activeStep === steps.length - 1 ? (
              <Button
                variant="contained"
                onClick={handleSubmit}
                disabled={loading || !validateStep(activeStep)}
                startIcon={loading ? <CircularProgress size={20} /> : null}
              >
                {loading ? 'Creating Account...' : 'Create Account'}
              </Button>
            ) : (
              <Button variant="contained" onClick={handleNext} disabled={!validateStep(activeStep)}>
                Next
              </Button>
            )}
          </Box>
        </Box>
      </Paper>
    </Container>
  );
};

export default OnboardingProfileForm;

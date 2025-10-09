import React, { useState, useEffect } from 'react';
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
  Stepper,
  Step,
  StepLabel,
  IconButton,
  InputAdornment,
} from '@mui/material';
import {
  Close as CloseIcon,
  CheckCircle as CheckCircleIcon,
} from '@mui/icons-material';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { validateDob } from '../utils/dobValidation';
import {
  startPhoneVerification,
  confirmPhoneCode,
  initRecaptcha,
  cleanupRecaptcha,
  formatPhoneForDisplay,
} from '../utils/phoneVerification';

interface EligibilityModalProps {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
  needDOB: boolean;
  needPhone: boolean;
  jobId?: string;
}

const EligibilityModal: React.FC<EligibilityModalProps> = ({
  open,
  onClose,
  onComplete,
  needDOB,
  needPhone,
}) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // DOB state
  const [dobInput, setDobInput] = useState('');
  const [dobError, setDobError] = useState<string | null>(null);
  const [dobCompleted, setDobCompleted] = useState(false);

  // Phone state
  const [phoneInput, setPhoneInput] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [codeSent, setCodeSent] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [phoneCompleted, setPhoneCompleted] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);

  // Determine steps needed
  const steps = [];
  if (needDOB) steps.push('Date of Birth');
  if (needPhone) steps.push('Phone Verification');

  // Initialize reCAPTCHA when modal opens
  useEffect(() => {
    if (open && needPhone) {
      // Small delay to ensure DOM is ready
      const timer = setTimeout(() => {
        try {
          initRecaptcha();
        } catch (err) {
          console.error('Failed to initialize reCAPTCHA:', err);
        }
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [open, needPhone]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupRecaptcha();
    };
  }, []);

  // Resend countdown timer
  useEffect(() => {
    if (resendCountdown > 0) {
      const timer = setTimeout(() => {
        setResendCountdown(resendCountdown - 1);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCountdown]);

  const handleClose = () => {
    setDobInput('');
    setDobError(null);
    setPhoneInput('');
    setPhoneError(null);
    setCodeInput('');
    setCodeError(null);
    setCodeSent(false);
    setCurrentStep(0);
    setError(null);
    setSuccess(null);
    setDobCompleted(false);
    setPhoneCompleted(false);
    cleanupRecaptcha();
    onClose();
  };

  const handleDobSubmit = async () => {
    setDobError(null);
    setError(null);

    // Validate DOB
    const validation = validateDob(dobInput);

    if (!validation.ok) {
      setDobError(validation.error || 'Invalid date of birth');
      return;
    }

    setLoading(true);

    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error('Must be signed in');
      }

      // Save DOB to Firestore
      await updateDoc(doc(db, 'users', user.uid), {
        dob: validation.iso,
        updatedAt: serverTimestamp(),
      });

      setDobCompleted(true);
      setSuccess('Date of birth verified!');

      // If phone verification is not needed, check eligibility and complete
      if (!needPhone) {
        // Check if phone was already verified
        // If so, set workEligibility to true
        setTimeout(() => {
          onComplete();
        }, 1500);
      } else {
        // Move to phone verification step
        setTimeout(() => {
          setCurrentStep(1);
          setSuccess(null);
        }, 1500);
      }
    } catch (err: any) {
      console.error('DOB save error:', err);
      setError('Failed to save date of birth. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSendCode = async () => {
    setPhoneError(null);
    setCodeError(null);
    setError(null);

    // Validate phone format (basic check)
    if (!phoneInput || phoneInput.trim() === '') {
      setPhoneError('Phone number is required');
      return;
    }

    // Format to E.164 (assuming US number for now)
    let e164 = phoneInput.trim();
    if (!e164.startsWith('+')) {
      // Remove all non-digits
      const digits = e164.replace(/\D/g, '');
      // Add +1 for US numbers
      e164 = `+1${digits}`;
    }

    setLoading(true);

    try {
      await startPhoneVerification(e164);
      setCodeSent(true);
      setResendCountdown(60);
      setSuccess('Code sent! Check your phone.');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      console.error('Send code error:', err);
      setPhoneError(err.message || 'Failed to send code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    setCodeError(null);
    setError(null);

    if (!codeInput || codeInput.length !== 6) {
      setCodeError('Enter a 6-digit code');
      return;
    }

    // Format phone to E.164
    let e164 = phoneInput.trim();
    if (!e164.startsWith('+')) {
      const digits = e164.replace(/\D/g, '');
      e164 = `+1${digits}`;
    }

    setLoading(true);

    try {
      await confirmPhoneCode(codeInput, e164);
      setPhoneCompleted(true);
      setSuccess('✅ Phone verified! You can now apply for jobs.');

      // Complete the flow after a brief delay
      setTimeout(() => {
        onComplete();
        handleClose();
      }, 2000);
    } catch (err: any) {
      console.error('Verify code error:', err);
      setCodeError(err.message || 'Incorrect code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (resendCountdown > 0) return;
    await handleSendCode();
  };

  const getStepContent = () => {
    const actualStep = needDOB ? currentStep : currentStep - 1;

    // DOB Step
    if (needDOB && actualStep === 0) {
      return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Typography variant="body1" sx={{ color: 'text.secondary' }}>
            To apply for jobs, we need to verify you're at least 18 years old.
          </Typography>

          <TextField
            fullWidth
            label="Date of Birth"
            placeholder="MM/DD/YYYY"
            value={dobInput}
            onChange={(e) => setDobInput(e.target.value)}
            error={!!dobError}
            helperText={dobError || 'Format: MM/DD/YYYY'}
            disabled={loading || dobCompleted}
            autoFocus
            onKeyPress={(e) => {
              if (e.key === 'Enter' && !loading) {
                handleDobSubmit();
              }
            }}
          />

          {dobCompleted && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'success.main' }}>
              <CheckCircleIcon />
              <Typography variant="body2">Date of birth verified</Typography>
            </Box>
          )}
        </Box>
      );
    }

    // Phone Verification Step
    if (needPhone && (needDOB ? actualStep === 1 : actualStep === 0)) {
      return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {!codeSent ? (
            <>
              <Typography variant="body1" sx={{ color: 'text.secondary' }}>
                Enter your mobile phone number. We'll send you a verification code.
              </Typography>

              <TextField
                fullWidth
                label="Phone Number"
                placeholder="(702) 555-0147"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                error={!!phoneError}
                helperText={phoneError || 'Use a mobile number that can receive SMS'}
                disabled={loading || phoneCompleted}
                autoFocus={!needDOB || currentStep > 0}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && !loading) {
                    handleSendCode();
                  }
                }}
              />

              {/* reCAPTCHA container */}
              <div id="recaptcha-container"></div>
            </>
          ) : (
            <>
              <Typography variant="body1" sx={{ color: 'text.secondary' }}>
                Enter the 6-digit code we sent to {formatPhoneForDisplay(phoneInput)}
              </Typography>

              <TextField
                fullWidth
                label="Verification Code"
                placeholder="000000"
                value={codeInput}
                onChange={(e) => {
                  // Only allow digits, max 6
                  const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                  setCodeInput(value);
                }}
                error={!!codeError}
                helperText={codeError || 'Enter the 6-digit code'}
                disabled={loading || phoneCompleted}
                autoFocus
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && !loading && codeInput.length === 6) {
                    handleVerifyCode();
                  }
                }}
                InputProps={{
                  endAdornment: codeInput.length === 6 && (
                    <InputAdornment position="end">
                      <CheckCircleIcon color="success" />
                    </InputAdornment>
                  ),
                }}
              />

              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Button
                  variant="text"
                  onClick={handleResendCode}
                  disabled={loading || resendCountdown > 0}
                  size="small"
                >
                  {resendCountdown > 0 ? `Resend code in ${resendCountdown}s` : 'Resend code'}
                </Button>

                <Button
                  variant="text"
                  onClick={() => {
                    setCodeSent(false);
                    setCodeInput('');
                    setCodeError(null);
                  }}
                  size="small"
                  disabled={loading}
                >
                  Change number
                </Button>
              </Box>

              {phoneCompleted && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'success.main' }}>
                  <CheckCircleIcon />
                  <Typography variant="body2">Phone verified</Typography>
                </Box>
              )}
            </>
          )}
        </Box>
      );
    }

    return null;
  };

  const getActionButton = () => {
    const actualStep = needDOB ? currentStep : currentStep - 1;

    // DOB Step
    if (needDOB && actualStep === 0) {
      return (
        <Button
          onClick={handleDobSubmit}
          variant="contained"
          disabled={loading || dobCompleted || !dobInput}
          startIcon={loading ? <CircularProgress size={20} /> : null}
          sx={{ minWidth: 120 }}
        >
          {loading ? 'Saving...' : needPhone ? 'Continue' : 'Complete'}
        </Button>
      );
    }

    // Phone Verification Step
    if (needPhone && (needDOB ? actualStep === 1 : actualStep === 0)) {
      if (!codeSent) {
        return (
          <Button
            onClick={handleSendCode}
            variant="contained"
            disabled={loading || phoneCompleted || !phoneInput}
            startIcon={loading ? <CircularProgress size={20} /> : null}
            sx={{ minWidth: 120 }}
          >
            {loading ? 'Sending...' : 'Send Code'}
          </Button>
        );
      } else {
        return (
          <Button
            onClick={handleVerifyCode}
            variant="contained"
            disabled={loading || phoneCompleted || codeInput.length !== 6}
            startIcon={loading ? <CircularProgress size={20} /> : null}
            sx={{ minWidth: 120 }}
          >
            {loading ? 'Verifying...' : 'Verify'}
          </Button>
        );
      }
    }

    return null;
  };

  return (
    <Dialog
      open={open}
      onClose={!loading ? handleClose : undefined}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: { borderRadius: 3 },
      }}
      aria-labelledby="eligibility-dialog-title"
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h5" sx={{ fontWeight: 600 }} id="eligibility-dialog-title">
            Verification Required
          </Typography>
          <IconButton onClick={handleClose} size="small" disabled={loading} aria-label="Close dialog">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent>
        {/* Progress Stepper */}
        {steps.length > 1 && (
          <Box sx={{ mb: 4 }}>
            <Stepper activeStep={currentStep}>
              {steps.map((label) => (
                <Step key={label}>
                  <StepLabel>{label}</StepLabel>
                </Step>
              ))}
            </Stepper>
          </Box>
        )}

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

        {getStepContent()}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button onClick={handleClose} disabled={loading} variant="outlined">
          Cancel
        </Button>
        {getActionButton()}
      </DialogActions>
    </Dialog>
  );
};

export default EligibilityModal;


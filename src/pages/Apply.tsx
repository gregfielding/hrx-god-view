/**
 * Apply Page - Public Signup Form
 * 
 * Twilio-ready public signup page at /c1/apply
 * Creates user profile with explicit SMS consent
 */

import React, { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Box,
  Container,
  Typography,
  TextField,
  Button,
  Checkbox,
  FormControlLabel,
  Alert,
  Link,
  CircularProgress,
  Paper,
  MenuItem,
} from '@mui/material';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { auth, db } from '../firebase';
import { logSMSConsent, getUserAgent } from '../utils/consentLogging';

const C1_TENANT_ID = 'BCiP2bQ9CgVOCTfV6MhD';
const detectDefaultLanguage = (): 'en' | 'es' => {
  if (typeof navigator === 'undefined') return 'en';
  return navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en';
};

const Apply: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ groupId?: string }>();
  const firstNameRef = useRef<HTMLInputElement>(null);
  
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [preferredLanguage, setPreferredLanguage] = useState<'en' | 'es'>(detectDefaultLanguage());
  const [smsConsent, setSmsConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [signupGroupId, setSignupGroupId] = useState<string | null>(null);
  const [signupGroupTitle, setSignupGroupTitle] = useState<string | null>(null);
  const [groupLoading, setGroupLoading] = useState(false);
  const [pendingGroupAdd, setPendingGroupAdd] = useState<{ userId: string; groupId: string } | null>(null);

  // Resolve optional groupId from route param or query string
  useEffect(() => {
    const fromParam = params.groupId ? String(params.groupId).trim() : '';
    const searchParams = new URLSearchParams(location.search);
    const fromQuery = searchParams.get('groupId') ? String(searchParams.get('groupId')).trim() : '';
    const resolved = fromParam || fromQuery || '';
    setSignupGroupId(resolved || null);
  }, [params.groupId, location.search]);

  // If this is a group-specific signup, validate the group and load its title for display.
  useEffect(() => {
    let cancelled = false;
    const gid = signupGroupId ? signupGroupId.trim() : '';
    if (!gid) {
      setSignupGroupTitle(null);
      setGroupLoading(false);
      return;
    }

    (async () => {
      setGroupLoading(true);
      try {
        const fn = httpsCallable(getFunctions(), 'validateUserGroupSignup');
        const res = await fn({ tenantId: C1_TENANT_ID, groupId: gid });
        const data = (res as any)?.data || {};
        if (!cancelled) setSignupGroupTitle(String(data?.title || '').trim() || 'User Group');
      } catch (e) {
        if (!cancelled) {
          setSignupGroupTitle(null);
          setError('Unable to validate this signup link. Please try again.');
        }
      } finally {
        if (!cancelled) setGroupLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [signupGroupId]);

  // Auto-focus first field
  useEffect(() => {
    if (firstNameRef.current) {
      firstNameRef.current.focus();
    }
  }, []);

  // Format phone number as user types
  const formatPhoneNumber = (value: string): string => {
    const digits = value.replace(/\D/g, '');
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '');
    if (digits.length <= 10) {
      const formatted = digits.length === 10 
        ? formatPhoneNumber(digits)
        : digits;
      setPhone(formatted);
    }
  };

  const validateEmail = (email: string): boolean => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const validatePassword = (password: string): boolean => {
    return password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password);
  };

  const validateDateOfBirth = (dob: string): boolean => {
    if (!dob) return false;
    const birthDate = new Date(dob);
    const today = new Date();
    const age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      return age - 1 >= 18;
    }
    return age >= 18;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setPendingGroupAdd(null);

    // Validation
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !dateOfBirth || !phone.trim() || !password.trim()) {
      setError('All fields are required');
      return;
    }

    const phoneDigits = phone.replace(/\D/g, '');
    if (phoneDigits.length !== 10) {
      setError('Please enter a valid 10-digit phone number');
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

    if (!validateDateOfBirth(dateOfBirth)) {
      setError('You must be at least 18 years old to apply');
      return;
    }

    if (!smsConsent) {
      setError('You must agree to receive text messages to complete this form. If you prefer not to receive SMS, you can apply through other channels.');
      return;
    }

    if (groupLoading) {
      setError('Validating signup link… please wait.');
      return;
    }
    if (signupGroupId && !signupGroupTitle) {
      setError('This signup link is invalid or expired. Please request a new link.');
      return;
    }

    setLoading(true);

    try {
      // Create Firebase Auth user
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // Update profile with display name
      await updateProfile(user, {
        displayName: `${firstName} ${lastName}`.trim()
      });

      const userRef = doc(db, 'users', user.uid);

      // Prepare user profile data
      const phoneE164 = `+1${phoneDigits}`;
      // Convert date of birth string to Firestore Timestamp
      const dobTimestamp = dateOfBirth ? Timestamp.fromDate(new Date(dateOfBirth)) : null;
      
      const userProfile: any = {
        uid: user.uid,
        email: user.email,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        displayName: `${firstName} ${lastName}`.trim(),
        phone: phoneDigits,
        phoneE164: phoneE164,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastLogin: serverTimestamp(),
        // Signup source
        signupSource: signupGroupId ? 'apply_group_landing' : 'apply_landing',
        signupGroupId: signupGroupId || null,
        // Default values for new users from apply page
        securityLevel: '2' as const, // Applicant level
        role: 'Tenant' as const,
        orgType: 'Tenant' as const,
        activeTenantId: C1_TENANT_ID,
        tenantIds: {
          [C1_TENANT_ID]: {
            role: 'Applicant',
            securityLevel: '2'
          }
        },
        isActive: true,
        avatar: null,
        address: {
          street: '',
          city: '',
          state: '',
          zipCode: '',
          coordinates: null
        },
        // Work status and eligibility
        workStatus: 'Active',
        workEligibility: false,
        dob: dobTimestamp,
        phoneVerified: false,
        // Employment details
        employmentType: null,
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
        preferredLanguage,
        // Languages and skills
        languages: [],
        skills: [],
        certifications: [],
        // User associations
        userGroupIds: [],
        // Module access flags
        crm_sales: false,
        recruiter: false,
        jobsBoard: false,
        // Job application related fields
        applications: [],
        favorites: [],
        // Profile completion tracking
        profileComplete: false,
        onboarded: false,
        // Consent tracking
        userAgreements: {
          termsOfUse: {
            agreed: true,
            version: "2025-10-21",
            timestamp: new Date().toISOString()
          },
          smsConsent: {
            agreed: true,
            version: "2025-10-21",
            timestamp: new Date().toISOString()
          },
          privacyPolicy: {
            acknowledged: true,
            version: "2025-10-21",
            timestamp: new Date().toISOString()
          }
        },
        // Default privacy and notification settings
        locationSettings: {
          locationSharingEnabled: true,
          locationGranularity: 'precise',
          locationUpdateFrequency: 'realtime',
        },
        notificationSettings: {
          pushNotifications: true,
          emailNotifications: true,
          smsNotifications: true,
          companionMessages: true,
          shiftReminders: true,
          safetyAlerts: true,
          performanceUpdates: true,
          quietHours: {
            enabled: false,
            startTime: '22:00',
            endTime: '08:00',
          },
        },
        privacySettings: {
          profileVisibility: 'managers',
          showContactInfo: true,
          showLocation: true,
          showPerformanceMetrics: true,
          allowDataAnalytics: true,
          allowAIInsights: true,
        },
      };

      // Create or update user document
      await setDoc(userRef, userProfile, { merge: true });

      // If this is a group-specific signup, add the user to that group via Cloud Function.
      if (signupGroupId) {
        try {
          const fn = httpsCallable(getFunctions(), 'addUsersToGroups');
          await fn({ tenantId: C1_TENANT_ID, userId: user.uid, groupIds: [signupGroupId] });
        } catch (groupErr) {
          console.error('Error adding user to group:', groupErr);
          setPendingGroupAdd({ userId: user.uid, groupId: signupGroupId });
          setError('Your profile was created, but we could not finish adding you to the group. Please click “Finish signup” to try again.');
          return;
        }
      }

      // Log SMS consent to userConsents collection (compliance requirement)
      try {
        await logSMSConsent({
          uid: user.uid,
          phone: phoneE164,
          smsOptIn: true,
          source: 'apply_landing',
          termsVersion: '2025-10-21',
          ip: undefined, // Will be captured server-side if needed
          userAgent: getUserAgent(),
        });
      } catch (consentError) {
        // Log error but don't block signup
        console.error('Error logging SMS consent:', consentError);
      }

      setSuccess(true);
      
      // Redirect to login or success page after a brief delay
      setTimeout(() => {
        navigate('/login', { 
          state: { 
            message: 'Profile created successfully! Please sign in to continue.',
            email 
          } 
        });
      }, 2000);

    } catch (error: any) {
      console.error('Signup error:', error);
      
      // Handle specific Firebase errors
      switch (error.code) {
        case 'auth/email-already-in-use':
          setError('An account with this email already exists. Please log in instead.');
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

  const isFormValid = 
    firstName.trim() &&
    lastName.trim() &&
    email.trim() &&
    dateOfBirth &&
    validateDateOfBirth(dateOfBirth) &&
    phone.replace(/\D/g, '').length === 10 &&
    password.trim() &&
    confirmPassword.trim() &&
    password === confirmPassword &&
    validateEmail(email) &&
    validatePassword(password) &&
    smsConsent &&
    !groupLoading &&
    (!signupGroupId || !!signupGroupTitle);

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 4, md: 6 } }}>
      <Paper
        elevation={2}
        sx={{
          p: { xs: 3, md: 4 },
          borderRadius: 2,
        }}
      >
        {/* Logo/Header */}
        <Box sx={{ textAlign: 'center', mb: 3 }}>
          <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
            Get Started with C1 Staffing
          </Typography>
          {signupGroupTitle && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Signing up for: <strong>{signupGroupTitle}</strong>
            </Typography>
          )}
          <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
            Create your worker profile so we can match you with jobs, shifts, and opportunities. If you agree to received them, you'll receive updates by text message once you give consent below.
          </Typography>
        </Box>

        {/* Error/Success Messages */}
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span>{error}</span>
              {pendingGroupAdd && (
                <Box>
                  <Button
                    variant="contained"
                    size="small"
                    disabled={loading}
                    onClick={async () => {
                      if (!pendingGroupAdd) return;
                      setError(null);
                      setLoading(true);
                      try {
                        const fn = httpsCallable(getFunctions(), 'addUsersToGroups');
                        await fn({ tenantId: C1_TENANT_ID, userId: pendingGroupAdd.userId, groupIds: [pendingGroupAdd.groupId] });
                        setPendingGroupAdd(null);
                        setSuccess(true);
                        setTimeout(() => {
                          navigate('/login', {
                            state: {
                              message: 'Profile created successfully! Please sign in to continue.',
                              email,
                            },
                          });
                        }, 1000);
                      } catch (e) {
                        console.error('Retry add-to-group failed:', e);
                        setError('Still unable to finish group signup. Please try again in a moment.');
                      } finally {
                        setLoading(false);
                      }
                    }}
                    sx={{ textTransform: 'none' }}
                  >
                    Finish signup
                  </Button>
                </Box>
              )}
            </Box>
          </Alert>
        )}

        {success && (
          <Alert severity="success" sx={{ mb: 2 }}>
            Profile created successfully! Redirecting to sign in...
          </Alert>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            {/* Name Fields */}
            <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
              <TextField
                inputRef={firstNameRef}
                fullWidth
                label="First Name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                disabled={loading}
                required
                size="medium"
              />
              <TextField
                fullWidth
                label="Last Name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                disabled={loading}
                required
                size="medium"
              />
            </Box>

            {/* Email */}
            <TextField
              fullWidth
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              required
              size="medium"
            />

            {/* Date of Birth */}
            <TextField
              fullWidth
              select
              label="Preferred Message Language"
              value={preferredLanguage}
              onChange={(e) => setPreferredLanguage(e.target.value as 'en' | 'es')}
              disabled={loading}
              helperText="This controls SMS/email language. App UI remains in English for now."
              size="medium"
            >
              <MenuItem value="en">English</MenuItem>
              <MenuItem value="es">Spanish</MenuItem>
            </TextField>

            {/* Date of Birth */}
            <TextField
              fullWidth
              label="Date of Birth"
              type="date"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              disabled={loading}
              required
              InputLabelProps={{
                shrink: true,
              }}
              inputProps={{
                max: new Date().toISOString().split('T')[0], // Prevent future dates
              }}
              helperText="You must be at least 18 years old to apply"
              size="medium"
            />

            {/* Phone */}
            <TextField
              fullWidth
              label="Mobile Phone Number"
              type="tel"
              value={phone}
              onChange={handlePhoneChange}
              disabled={loading}
              required
              placeholder="(555) 123-4567"
              helperText="Please double-check that you enter the number correctly."
              size="medium"
            />

            {/* Password */}
            <TextField
              fullWidth
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              required
              helperText="At least 8 characters, including uppercase, lowercase, and a number."
              size="medium"
            />

            {/* Confirm Password */}
            <TextField
              fullWidth
              label="Confirm Password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={loading}
              required
              size="medium"
            />

            {/* SMS Consent Checkbox */}
            <Box sx={{ mt: 1 }}>
              <label>Optional:</label>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={smsConsent}
                    onChange={(e) => setSmsConsent(e.target.checked)}
                    disabled={loading}
                  />
                }
                label={
                  <Typography variant="body2" sx={{ fontSize: '0.875rem', lineHeight: 1.5 }}>
                    By checking this box, I agree to receive employment-related text messages from C1 Staffing / HRX One, including application updates, interview scheduling, onboarding reminders, shift notifications, payroll alerts, and account security messages. Message & data rates may apply. Message frequency varies. Reply STOP to opt out, or HELP for help. Consent is not a condition of employment, and you may create your profile without checking this box. See our <Link href="/privacy" target="_blank" rel="noopener">Privacy Policy</Link>, <Link href="/terms" target="_blank" rel="noopener">Terms of Use</Link>, and <Link href="/consent" target="_blank" rel="noopener">SMS Consent</Link>.
                  </Typography>
                }
                sx={{ alignItems: 'flex-start' }}
              />
            </Box>

            {/* Submit Button */}
            <Button
              type="submit"
              variant="contained"
              fullWidth
              size="large"
              disabled={!isFormValid || loading}
              sx={{
                mt: 2,
                py: 1.5,
                fontSize: '1rem',
                fontWeight: 600,
              }}
            >
              {loading ? (
                <>
                  <CircularProgress size={20} sx={{ mr: 1, color: 'white' }} />
                  Creating Profile...
                </>
              ) : (
                'Create My Profile'
              )}
            </Button>

            {/* Login Link */}
            <Box sx={{ textAlign: 'center', mt: 1 }}>
              <Typography variant="body2" color="text.secondary">
                Already have an account?{' '}
                <Link href="/login" sx={{ fontWeight: 500 }}>
                  Log in
                </Link>
              </Typography>
            </Box>
          </Box>
        </form>

        {/* Footer Links */}
        <Box sx={{ mt: 4, pt: 3, borderTop: 1, borderColor: 'divider' }}>
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
            <Link href="/privacy">Privacy Policy</Link> |{' '}
            <Link href="/terms">Terms of Use</Link> |{' '}
            <Link href="/consent">SMS Consent</Link> |{' '}
            <Link href="/sms-privacy">SMS Privacy Notice</Link>
          </Typography>
        </Box>
      </Paper>
    </Container>
  );
};

export default Apply;


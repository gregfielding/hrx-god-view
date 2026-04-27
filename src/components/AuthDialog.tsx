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
  Checkbox,
  FormControlLabel,
  MenuItem,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import {
  Close as CloseIcon,
  Email as EmailIcon,
  Lock as LockIcon,
  Visibility,
  VisibilityOff,
  Language as LanguageIcon,
} from '@mui/icons-material';
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile
} from 'firebase/auth';
import { auth, db } from '../firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { logSMSConsent, getUserAgent } from '../utils/consentLogging';
import { useAuth } from '../contexts/AuthContext';
import { executeRecaptcha, waitForRecaptcha } from '../utils/recaptchaEnterprise';
import { formatPhoneNumber } from '../utils/formatPhone';
import { setLanguage } from '../i18n';
import { readLocalLanguage, writeLocalLanguage } from '../utils/languagePreference';

interface AuthDialogProps {
  open: boolean;
  onClose: () => void;
  onAuthSuccess: () => void;
  /** When provided (e.g. from Jobs Board guest language), dialog opens with this language. */
  initialPreferredLanguage?: 'en' | 'es';
}

const detectDefaultLanguage = (): 'en' | 'es' => readLocalLanguage();

const AUTH_COPY: Record<'en' | 'es', Record<string, string>> = {
  en: {
    titleCreate: 'Create Your Account',
    titleSignIn: 'Welcome Back',
    subtitleCreate: 'Start applying in seconds. Save jobs and track your progress.',
    subtitleSignIn: 'Sign in to apply for jobs, save listings, and track your applications.',
    tabCreate: 'Create Account',
    tabSignIn: 'Sign In',
    firstName: 'First Name',
    lastName: 'Last Name',
    email: 'Email',
    password: 'Password',
    passwordHint: 'At least 8 characters, including uppercase, lowercase, and a number.',
    confirmPassword: 'Confirm Password',
    preferredLanguage: 'Preferred Message Language',
    preferredLanguageHelp: 'Message templates can send in this language.',
    phone: 'Phone Number',
    phonePlaceholder: '(555) 123-4567',
    phoneHelp: "We'll use this to send you job updates and verification codes.",
    smsConsent: 'By checking this box, I agree to receive employment-related text messages from C1 Staffing / HRX One, including application updates, interview scheduling, onboarding reminders, shift notifications, payroll alerts, and account security messages. Message & data rates may apply. Message frequency varies. Reply STOP to opt out, or HELP for help. Consent is not a condition of employment. See our Privacy Policy, Terms of Use, and SMS Consent.',
    termsAgree: 'I agree to the Terms of Use.',
    termsAgreePrefix: 'I agree to the ',
    termsAgreeLink: 'Terms of Use',
    privacyAck: 'By creating an account, you acknowledge that you have read our Privacy Policy.',
    privacyAckPrefix: 'By creating an account, you acknowledge that you have read our ',
    privacyAckLink: 'Privacy Policy',
    forgotPassword: 'Forgot your password?',
    cancel: 'Cancel',
    createAccount: 'Create Account',
    signIn: 'Sign In',
    verifying: 'Verifying...',
    pleaseWait: 'Please wait...',
    consentNotRequired: 'Consent to receive text messages is not a condition of employment.',
    alreadyHaveAccount: 'Already have an account?',
    signInLink: 'Sign in',
    dontHaveAccount: "Don't have an account yet?",
    createOneHere: 'Create one here',
    languageLabel: 'Language',
    errorAllFields: 'All fields are required',
    errorPhone: 'Please enter a valid 10-digit phone number',
    errorEmail: 'Please enter a valid email address',
    errorEmailShort: 'Please enter a valid email address.',
    errorPassword: 'Password must be at least 8 characters with uppercase, lowercase, and number',
    errorPasswordMatch: 'Passwords do not match',
    successCreated: '✅ Account created! Redirecting you to available jobs…',
    errorEmailExists: 'An account with this email already exists. Try signing in instead.',
    errorPasswordWeak: 'Password is too weak. Please choose a stronger password.',
    errorCreateFailed: 'Failed to create account. Please try again.',
    errorEmailPasswordRequired: 'Email and password are required',
    successWelcome: 'Welcome back!',
    errorNoAccount: 'No account found with this email. Please create an account first.',
    errorWrongPassword: 'Incorrect password. Please try again.',
    errorTooManyAttempts: 'Too many failed attempts. Please try again later.',
    errorSignInFailed: 'Failed to sign in. Please try again.',
    errorEmailFirst: 'Please enter your email address first',
    successResetSent: 'Password reset email sent! Check your inbox.',
    errorResetFailed: 'Failed to send reset email. Please try again.',
  },
  es: {
    titleCreate: 'Crea tu cuenta',
    titleSignIn: 'Bienvenido de nuevo',
    subtitleCreate: 'Empieza a aplicar en segundos. Guarda trabajos y sigue tu progreso.',
    subtitleSignIn: 'Inicia sesión para aplicar a trabajos, guardar ofertas y ver tus solicitudes.',
    tabCreate: 'Crear cuenta',
    tabSignIn: 'Iniciar sesión',
    firstName: 'Nombre',
    lastName: 'Apellido',
    email: 'Correo electrónico',
    password: 'Contraseña',
    passwordHint: 'Al menos 8 caracteres, con mayúscula, minúscula y un número.',
    confirmPassword: 'Confirmar contraseña',
    preferredLanguage: 'Idioma preferido para mensajes',
    preferredLanguageHelp: 'Las plantillas de mensajes se pueden enviar en este idioma.',
    phone: 'Número de teléfono',
    phonePlaceholder: '(555) 123-4567',
    phoneHelp: 'Lo usaremos para enviarte actualizaciones de trabajos y códigos de verificación.',
    smsConsent: 'Al marcar esta casilla, acepto recibir mensajes de texto relacionados con el empleo de C1 Staffing / HRX One, incluyendo actualizaciones de solicitudes, citas para entrevistas, recordatorios de incorporación, avisos de turnos, alertas de nómina y mensajes de seguridad de la cuenta. Pueden aplicar tarifas de mensajes y datos. La frecuencia varía. Responde STOP para cancelar o HELP para ayuda. El consentimiento no es condición de empleo. Consulta nuestra Política de privacidad, Términos de uso y Consentimiento SMS.',
    termsAgree: 'Acepto los Términos de uso.',
    termsAgreePrefix: 'Acepto los ',
    termsAgreeLink: 'Términos de uso',
    privacyAck: 'Al crear una cuenta, confirmas que has leído nuestra Política de privacidad.',
    privacyAckPrefix: 'Al crear una cuenta, confirmas que has leído nuestra ',
    privacyAckLink: 'Política de privacidad',
    forgotPassword: '¿Olvidaste tu contraseña?',
    cancel: 'Cancelar',
    createAccount: 'Crear cuenta',
    signIn: 'Iniciar sesión',
    verifying: 'Verificando...',
    pleaseWait: 'Espera un momento...',
    consentNotRequired: 'El consentimiento para recibir mensajes de texto no es condición de empleo.',
    alreadyHaveAccount: '¿Ya tienes una cuenta?',
    signInLink: 'Iniciar sesión',
    dontHaveAccount: '¿Aún no tienes cuenta?',
    createOneHere: 'Crea una aquí',
    languageLabel: 'Idioma',
    errorAllFields: 'Todos los campos son obligatorios',
    errorPhone: 'Por favor ingresa un número de teléfono válido de 10 dígitos',
    errorEmail: 'Por favor ingresa un correo electrónico válido',
    errorEmailShort: 'Por favor ingresa un correo electrónico válido.',
    errorPassword: 'La contraseña debe tener al menos 8 caracteres con mayúscula, minúscula y número',
    errorPasswordMatch: 'Las contraseñas no coinciden',
    successCreated: '✅ ¡Cuenta creada! Redirigiendo a trabajos disponibles…',
    errorEmailExists: 'Ya existe una cuenta con este correo. Intenta iniciar sesión.',
    errorPasswordWeak: 'La contraseña es muy débil. Elige una más segura.',
    errorCreateFailed: 'Error al crear la cuenta. Intenta de nuevo.',
    errorEmailPasswordRequired: 'Correo y contraseña son obligatorios',
    successWelcome: '¡Bienvenido de nuevo!',
    errorNoAccount: 'No hay cuenta con este correo. Crea una cuenta primero.',
    errorWrongPassword: 'Contraseña incorrecta. Intenta de nuevo.',
    errorTooManyAttempts: 'Demasiados intentos fallidos. Intenta más tarde.',
    errorSignInFailed: 'Error al iniciar sesión. Intenta de nuevo.',
    errorEmailFirst: 'Ingresa tu correo electrónico primero',
    successResetSent: '¡Correo de restablecimiento enviado! Revisa tu bandeja.',
    errorResetFailed: 'Error al enviar el correo de restablecimiento. Intenta de nuevo.',
  },
};

const AuthDialog: React.FC<AuthDialogProps> = ({ open, onClose, onAuthSuccess, initialPreferredLanguage }) => {
  const { setCreatingUserProfile } = useAuth();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
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
  const [recaptchaToken, setRecaptchaToken] = useState<string | null>(null);
  const [recaptchaLoading, setRecaptchaLoading] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [acknowledgedPrivacy, setAcknowledgedPrivacy] = useState(false);
  const [phone, setPhone] = useState('');
  const [smsConsent, setSmsConsent] = useState(false);
  const [preferredLanguage, setPreferredLanguage] = useState<'en' | 'es'>(detectDefaultLanguage());

  const t = AUTH_COPY[preferredLanguage];

  // When dialog opens with a guest language (e.g. from Jobs Board), use it
  useEffect(() => {
    if (open && initialPreferredLanguage !== undefined) {
      setPreferredLanguage(initialPreferredLanguage);
      setLanguage(initialPreferredLanguage);
      writeLocalLanguage(initialPreferredLanguage, { markChangedThisSession: true });
    }
  }, [open, initialPreferredLanguage]);

  const applyPreferredLanguage = (lang: 'en' | 'es') => {
    setPreferredLanguage(lang);
    setLanguage(lang);
    writeLocalLanguage(lang, { markChangedThisSession: true });
  };
  
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
    setPhone('');
    setPreferredLanguage(detectDefaultLanguage());
    setError(null);
    setSuccess(null);
    setShowPassword(false);
    setShowConfirmPassword(false);
    setRecaptchaToken(null);
    setRecaptchaLoading(false);
    setAgreedToTerms(false);
    setSmsConsent(false);
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

  const executeRecaptchaVerification = async (action: string): Promise<string> => {
    setRecaptchaLoading(true);
    setError(null);
    
    try {
      // Wait for reCAPTCHA to be ready
      await waitForRecaptcha(10000);
      
      // Execute reCAPTCHA
      const token = await executeRecaptcha(action);
      setRecaptchaToken(token);
      setRecaptchaLoading(false);
      return token;
    } catch (error: any) {
      setRecaptchaLoading(false);
      throw new Error(`reCAPTCHA verification failed: ${error.message}`);
    }
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
    if (!email || !password || !firstName || !lastName || !phone) {
      setError(t.errorAllFields);
      return;
    }

    // Validate phone number (should be 10 digits)
    const phoneDigits = phone.replace(/\D/g, '');
    if (phoneDigits.length !== 10) {
      setError(t.errorPhone);
      return;
    }

    if (!validateEmail(email)) {
      setError(t.errorEmail);
      return;
    }

    if (!validatePassword(password)) {
      setError(t.errorPassword);
      return;
    }

    if (password !== confirmPassword) {
      setError(t.errorPasswordMatch);
      return;
    }

    setLoading(true);

    // Set flag to prevent AuthContext from creating default user document
    setCreatingUserProfile(true);

    try {
      // Execute reCAPTCHA verification
      await executeRecaptchaVerification('SIGNUP');
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
        phone: phone.replace(/\D/g, ''),
        phoneE164: `+1${phone.replace(/\D/g, '')}`,
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
        dob: null, // Date of birth in YYYY-MM-DD format (nullable until provided)
        phoneVerified: false, // Phone verification status
        // Employment details
        employmentType: null as string | null, // Use null; Firestore rejects undefined
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
        jobsBoard: false, // Module access flag for managers/admins only
        // Job application related fields
        applications: [],
        favorites: [],
        // Profile completion tracking
        profileComplete: false,
        onboarded: false,
        // Public jobs board specific
        source: 'public_jobs_board',
        preferredLanguage,
        // Consent tracking
        userAgreements: {
          termsOfUse: {
            agreed: true,
            version: "2025-10-21",
            timestamp: new Date().toISOString()
          },
          smsConsent: {
            agreed: smsConsent,
            version: "2025-10-21",
            timestamp: smsConsent ? new Date().toISOString() : null
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

      await setDoc(doc(db, 'users', user.uid), userProfile);

      setSuccess(t.successCreated);
      
      // Close dialog and refresh page state after a brief delay
      setTimeout(() => {
        try {
          onAuthSuccess();
        } catch (err) {
          console.error('Error in onAuthSuccess callback:', err);
        }
        handleClose();
      }, 2000);

      // Clear flag after a longer delay to ensure AuthContext has processed
      setTimeout(() => {
        setCreatingUserProfile(false);
      }, 5000);

    } catch (error: any) {
      console.error('Sign up error:', error);
      
      // Clear flag on error
      setCreatingUserProfile(false);
      
      // Handle specific Firebase errors
      switch (error.code) {
        case 'auth/email-already-in-use':
          setError(t.errorEmailExists);
          break;
        case 'auth/weak-password':
          setError(t.errorPasswordWeak);
          break;
        case 'auth/invalid-email':
          setError(t.errorEmailShort);
          break;
        default:
          setError(t.errorCreateFailed);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async () => {
    setError(null);
    setSuccess(null);

    if (!email || !password) {
      setError(t.errorEmailPasswordRequired);
      return;
    }

    if (!validateEmail(email)) {
      setError(t.errorEmail);
      return;
    }

    setLoading(true);

    try {
      // Execute reCAPTCHA verification
      await executeRecaptchaVerification('LOGIN');
      
      await signInWithEmailAndPassword(auth, email, password);
      setSuccess(t.successWelcome);
      
      // Close dialog and refresh page state after a brief delay
      setTimeout(() => {
        try {
          onAuthSuccess();
        } catch (err) {
          console.error('Error in onAuthSuccess callback:', err);
        }
        handleClose();
      }, 1000);

    } catch (error: any) {
      console.error('Sign in error:', error);
      
      // Handle specific Firebase errors
      switch (error.code) {
        case 'auth/user-not-found':
          setError(t.errorNoAccount);
          break;
        case 'auth/wrong-password':
          setError(t.errorWrongPassword);
          break;
        case 'auth/invalid-email':
          setError(t.errorEmailShort);
          break;
        case 'auth/too-many-requests':
          setError(t.errorTooManyAttempts);
          break;
        default:
          setError(t.errorSignInFailed);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      setError(t.errorEmailFirst);
      return;
    }

    if (!validateEmail(email)) {
      setError(t.errorEmail);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await sendPasswordResetEmail(auth, email);
      setSuccess(t.successResetSent);
    } catch (error: any) {
      console.error('Password reset error:', error);
      setError(t.errorResetFailed);
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
      fullScreen={isMobile}
      PaperProps={{
        sx: { 
          borderRadius: isMobile ? 0 : 3,
          maxWidth: isMobile ? '100%' : '520px',
          width: '100%',
          m: isMobile ? 0 : 2,
          maxHeight: isMobile ? '100%' : '90vh'
        }
      }}
      aria-labelledby="auth-dialog-title"
      aria-describedby="auth-dialog-description"
    >
      <DialogTitle sx={{ pb: 1, px: isMobile ? 2 : 3, pt: isMobile ? 2 : 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography 
            variant={isMobile ? 'h6' : 'h5'} 
            sx={{ fontWeight: 600, fontSize: isMobile ? '1.25rem' : undefined }} 
            id="auth-dialog-title"
          >
            {activeTab === 0 ? t.titleCreate : t.titleSignIn}
          </Typography>
          <IconButton 
            onClick={handleClose} 
            size={isMobile ? 'medium' : 'small'} 
            aria-label="Close dialog"
            sx={{ ml: 1 }}
          >
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ px: isMobile ? 2 : 3 }}>
        {/* Language selector — above subtitle */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <LanguageIcon sx={{ fontSize: 20, color: 'text.secondary' }} />
          <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
            {t.languageLabel}:
          </Typography>
          <Button
            size="small"
            variant={preferredLanguage === 'en' ? 'contained' : 'outlined'}
            onClick={() => applyPreferredLanguage('en')}
            sx={{ minWidth: 56, textTransform: 'none' }}
          >
            EN
          </Button>
          <Button
            size="small"
            variant={preferredLanguage === 'es' ? 'contained' : 'outlined'}
            onClick={() => applyPreferredLanguage('es')}
            sx={{ minWidth: 56, textTransform: 'none' }}
          >
            ES
          </Button>
        </Box>
        {/* Subheader */}
        <Typography 
          variant="body2" 
          sx={{ 
            color: 'text.secondary', 
            mb: isMobile ? 2 : 3,
            fontSize: isMobile ? '0.875rem' : '0.95rem'
          }}
          id="auth-dialog-description"
        >
          {activeTab === 0 ? t.subtitleCreate : t.subtitleSignIn}
        </Typography>

        <Box sx={{ mb: isMobile ? 2 : 3 }}>
          <Tabs 
            value={activeTab} 
            onChange={handleTabChange}
            variant="fullWidth"
            sx={{ 
              borderBottom: 1, 
              borderColor: 'divider',
              '& .MuiTab-root': {
                fontWeight: 600,
                fontSize: isMobile ? '0.875rem' : '1rem',
                textTransform: 'none',
                minHeight: isMobile ? 48 : 48,
                padding: isMobile ? '12px 8px' : '12px 16px',
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
            <Tab label={t.tabCreate} />
            <Tab label={t.tabSignIn} />
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

        <form onSubmit={activeTab === 0 ? handleSignUp : handleSignIn}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 2 : 2.5 }}>
            {activeTab === 0 && (
              <>
                <Box sx={{ 
                  display: 'flex', 
                  flexDirection: isMobile ? 'column' : 'row',
                  gap: isMobile ? 2 : 2 
                }}>
                  <TextField
                    ref={firstNameRef}
                    fullWidth
                    label={t.firstName}
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    disabled={loading}
                    required
                    onKeyPress={handleKeyPress}
                    size={isMobile ? 'medium' : 'medium'}
                  />
                  <TextField
                    fullWidth
                    label={t.lastName}
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    disabled={loading}
                    required
                    onKeyPress={handleKeyPress}
                    size={isMobile ? 'medium' : 'medium'}
                  />
                </Box>
              </>
            )}

            <TextField
              ref={emailRef}
              fullWidth
              label={t.email}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              required
              onKeyPress={handleKeyPress}
              size={isMobile ? 'medium' : 'medium'}
              InputProps={{
                startAdornment: <EmailIcon sx={{ mr: 1, color: 'text.secondary', opacity: 0.7 }} />
              }}
            />

            <TextField
              fullWidth
              label={t.password}
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              required
              onKeyPress={handleKeyPress}
              size={isMobile ? 'medium' : 'medium'}
              InputProps={{
                startAdornment: <LockIcon sx={{ mr: 1, color: 'text.secondary', opacity: 0.7 }} />,
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      onClick={() => setShowPassword(!showPassword)}
                      edge="end"
                      disabled={loading}
                      aria-label="toggle password visibility"
                      size={isMobile ? 'medium' : 'small'}
                    >
                      {showPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                )
              }}
              helperText={activeTab === 0 ? t.passwordHint : ''}
            />

            {activeTab === 0 && (
              <TextField
                fullWidth
                label={t.confirmPassword}
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={loading}
                required
                onKeyPress={handleKeyPress}
                size={isMobile ? 'medium' : 'medium'}
                InputProps={{
                  startAdornment: <LockIcon sx={{ mr: 1, color: 'text.secondary', opacity: 0.7 }} />,
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        edge="end"
                        disabled={loading}
                        aria-label="toggle confirm password visibility"
                        size={isMobile ? 'medium' : 'small'}
                      >
                        {showConfirmPassword ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  )
                }}
              />
            )}

            {activeTab === 0 && (
              <TextField
                fullWidth
                select
                label={t.preferredLanguage}
                value={preferredLanguage}
                onChange={(e) => applyPreferredLanguage(e.target.value as 'en' | 'es')}
                disabled={loading}
                helperText={t.preferredLanguageHelp}
                size={isMobile ? 'medium' : 'medium'}
              >
                <MenuItem value="en">English</MenuItem>
                <MenuItem value="es">Español</MenuItem>
              </TextField>
            )}

            {activeTab === 0 && (
              <TextField
                fullWidth
                label={t.phone}
                type="tel"
                value={phone}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '');
                  if (digits.length <= 10) {
                    const formatted = digits.length === 10 
                      ? formatPhoneNumber(digits)
                      : digits;
                    setPhone(formatted);
                  }
                }}
                disabled={loading}
                required
                onKeyPress={handleKeyPress}
                size={isMobile ? 'medium' : 'medium'}
                placeholder={t.phonePlaceholder}
                helperText={t.phoneHelp}
              />
            )}

          {activeTab === 0 && (
            <Box sx={{ mt: isMobile ? 1 : 2 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={smsConsent}
                    onChange={(e) => setSmsConsent(e.target.checked)}
                    required
                    size={isMobile ? 'medium' : 'small'}
                  />
                }
                label={
                  <Typography variant={isMobile ? 'body2' : 'body2'} sx={{ fontSize: isMobile ? '0.8rem' : undefined }}>
                    {t.smsConsent}{' '}
                    {preferredLanguage === 'en' ? 'View our ' : 'Ver nuestros '}
                    <Link href="/terms" target="_blank" rel="noopener">{t.termsAgreeLink}</Link>
                    {preferredLanguage === 'en' ? ' and ' : ' y '}
                    <Link href="/privacy" target="_blank" rel="noopener">{t.privacyAckLink}</Link>.
                  </Typography>
                }
              />
            </Box>
          )}

          {activeTab === 0 && (
            <Box sx={{ mt: isMobile ? 1 : 2 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={agreedToTerms}
                    onChange={(e) => setAgreedToTerms(e.target.checked)}
                    required
                    size={isMobile ? 'medium' : 'small'}
                  />
                }
                label={
                  <Typography variant={isMobile ? 'body2' : 'body2'} sx={{ fontSize: isMobile ? '0.8rem' : undefined }}>
                    {t.termsAgreePrefix}
                    <Link href="/terms" target="_blank" rel="noopener">{t.termsAgreeLink}</Link>.
                  </Typography>
                }
              />
              <Typography 
                variant="body2" 
                color="text.secondary" 
                sx={{ mt: 1, ml: isMobile ? 5 : 4, fontSize: isMobile ? '0.75rem' : undefined }}
              >
                {t.privacyAckPrefix}
                <Link href="/privacy" target="_blank" rel="noopener">{t.privacyAckLink}</Link>.
              </Typography>
            </Box>
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
                {t.forgotPassword}
              </Link>
            </Box>
          )}
          </Box>
        </form>
      </DialogContent>

      <DialogActions sx={{ 
        px: isMobile ? 2 : 3, 
        pb: isMobile ? 3 : 3, 
        pt: isMobile ? 2 : 2,
        flexDirection: 'column', 
        gap: isMobile ? 2 : 2 
      }}>
        <Box sx={{ 
          display: 'flex', 
          flexDirection: isMobile ? 'column-reverse' : 'row',
          justifyContent: 'flex-end', 
          gap: isMobile ? 1.5 : 2, 
          width: '100%' 
        }}>
          <Button 
            onClick={handleClose} 
            disabled={loading}
            variant="outlined"
            fullWidth={isMobile}
            sx={{ 
              minWidth: isMobile ? '100%' : 100,
              py: isMobile ? 1.5 : undefined
            }}
          >
            {t.cancel}
          </Button>
          <Button
            onClick={activeTab === 0 ? handleSignUp : handleSignIn}
            variant="contained"
            disabled={
              loading || 
              recaptchaLoading || 
              (activeTab === 0 && (!agreedToTerms || !smsConsent || !firstName.trim() || !lastName.trim() || !email.trim() || !password.trim() || !phone.trim() || password !== confirmPassword))
            }
            startIcon={(loading || recaptchaLoading) ? <CircularProgress size={20} /> : null}
            fullWidth={isMobile}
            sx={{ 
              minWidth: isMobile ? '100%' : 140,
              py: isMobile ? 1.5 : undefined
            }}
          >
            {recaptchaLoading ? t.verifying : loading ? t.pleaseWait : (activeTab === 0 ? t.createAccount : t.signIn)}
          </Button>
        </Box>

        {/* Optional statement for SMS consent */}
        {activeTab === 0 && (
          <Box sx={{ textAlign: 'center', width: '100%', pt: 1 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: isMobile ? '0.75rem' : '0.8rem' }}>
              {t.consentNotRequired}
            </Typography>
          </Box>
        )}

        {/* Footer microcopy */}
        <Box sx={{ textAlign: 'center', width: '100%', pt: isMobile ? 1 : 0 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: isMobile ? '0.875rem' : undefined }}>
            {activeTab === 0 ? (
              <>
                {t.alreadyHaveAccount}{' '}
                <Link
                  component="button"
                  onClick={switchToSignIn}
                  sx={{ 
                    textDecoration: 'none',
                    '&:hover': { textDecoration: 'underline' },
                    fontWeight: 500,
                    fontSize: isMobile ? '0.875rem' : undefined
                  }}
                >
                  {t.signInLink}
                </Link>
              </>
            ) : (
              <>
                {t.dontHaveAccount}{' '}
                <Link
                  component="button"
                  onClick={switchToSignUp}
                  sx={{ 
                    textDecoration: 'none',
                    '&:hover': { textDecoration: 'underline' },
                    fontWeight: 500,
                    fontSize: isMobile ? '0.875rem' : undefined
                  }}
                >
                  {t.createOneHere}
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
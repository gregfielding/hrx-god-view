import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Divider, Stack, Step, StepLabel, Stepper, Typography, Alert, Snackbar, LinearProgress, useMediaQuery, useTheme, Paper, TextField } from '@mui/material';
import { addDoc, arrayUnion, collection, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../../firebase';
import { updateEmail } from 'firebase/auth';
import { db } from '../../firebase';

import PersonalInfoStep from './steps/PersonalInfoStep';
import AddressStep from './steps/AddressStep';
import WorkEligibilityStep from './steps/WorkEligibilityStep';
import ProfilePictureStep from './steps/ProfilePictureStep';
import ResumeStep from './steps/ResumeStep';
import SkillsStep from './steps/SkillsStep';
import EducationStep from './steps/EducationStep';
import WorkExperienceStep from './steps/WorkExperienceStep';
import BioStep from './steps/BioStep';
import JobPreferencesStep from './steps/JobPreferencesStep';
import RequirementsAcknowledgementStep from './steps/RequirementsAcknowledgementStep';
import MilestoneProgress from '../common/MilestoneProgress';
import EligibilityModal from '../../components/EligibilityModal';
import { geocodeAddress } from '../../utils/geocodeAddress';
import { checkShiftDateConflict, checkMultipleShiftDateConflicts, extractDateFromShiftDate } from '../../utils/gigShiftApplicationLimits';

type WizardProps = {
  tenantId: string;
  tenantSlug?: string;
  tenantName?: string;
  jobId?: string;
  uid: string | null;
};

type DraftApplication = {
  status: 'draft' | 'submitted';
  createdAt?: any;
  updatedAt?: any;
  tenantId: string;
  jobId?: string;
  uid?: string | null;
  data: any;
};

const steps = ['Personal Info', 'Address', 'Work Eligibility', 'Profile Picture', 'Resume', 'Skills', 'Education', 'Work Experience', 'Bio', 'Preferences', 'Requirements'];

const Wizard: React.FC<WizardProps> = ({ tenantId, tenantSlug, tenantName, jobId, uid }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = useMemo(() => {
    try {
      const val = searchParams.get('returnTo');
      return val && val.startsWith('/') ? val : null;
    } catch {
      return null;
    }
  }, [searchParams]);
  
  // Extract selected shifts from query params (for Gig jobs)
  // Support both 'shifts' (comma-separated) and 'shiftId' (single shift)
  const selectedShifts = useMemo(() => {
    const shiftsParam = searchParams.get('shifts');
    const shiftIdParam = searchParams.get('shiftId');
    
    if (shiftsParam) {
      return shiftsParam.split(',').filter(Boolean);
    } else if (shiftIdParam) {
      return [shiftIdParam];
    }
    return [];
  }, [searchParams]);
  
  
  // Create a unique key for this application session
  const sessionKey = `app-wizard-${tenantId}-${jobId}-${uid}`;
  
  // Initialize activeStep from localStorage if available
  const [activeStep, setActiveStep] = useState(() => {
    try {
      const saved = localStorage.getItem(`${sessionKey}-step`);
      return saved ? parseInt(saved, 10) : 0;
    } catch {
      return 0;
    }
  });
  const [saving, setSaving] = useState(false);
  const [appId, setAppId] = useState<string | null>(null);
  const [formData, setFormData] = useState<any>({});
  const [userProfile, setUserProfile] = useState<any>(null);
  const [requirements, setRequirements] = useState<{
    licenses?: string[];
    certifications?: string[];
    screenings?: string[];
    ppe?: string[];
    physical?: string[];
    education?: string[];
  }>({});
  const [posting, setPosting] = useState<any>(null);
  const prefilledRef = useRef(false);
  const [tenantAppId, setTenantAppId] = useState<string | null>(null);
  const [stepRestored, setStepRestored] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Check if step was restored from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`${sessionKey}-step`);
      if (saved && parseInt(saved, 10) > 0) {
        setStepRestored(true);
      }
    } catch (error) {
      console.warn('Failed to check saved step:', error);
    }
  }, [sessionKey]);

  // Create draft doc on first load (user-owned path; fallback to localStorage if rules block)
  useEffect(() => {
    const createDraft = async () => {
      if (!uid || appId) return;
      const now = serverTimestamp();
      const draft: DraftApplication = {
        status: 'draft',
        createdAt: now,
        updatedAt: now,
        tenantId,
        jobId,
        uid,
        data: {}
      };
      // In local dev, avoid Firestore writes that may be blocked by rules; use localStorage draft instead
      try {
        const isLocalDev = typeof window !== 'undefined' && window.location.hostname === 'localhost' && process.env.NODE_ENV === 'development';
        if (isLocalDev) {
          const key = `appDraft:${uid}:${tenantId || 'na'}:${jobId || 'na'}`;
          try { localStorage.setItem(key, JSON.stringify({ ...draft, createdAt: Date.now(), updatedAt: Date.now() })); } catch {}
          setAppId(key);
          return;
        }
      } catch {}
      try {
        // Save under tenant so all applications are in one place for recruiters
        const colRef = collection(db, 'tenants', tenantId, 'applicationDrafts');
        const draftWithUser = { ...draft, userId: uid };
        const docRef = await addDoc(colRef, draftWithUser as any);
        setAppId(docRef.id);
      } catch {
        const key = `appDraft:${uid}:${tenantId || 'na'}:${jobId || 'na'}`;
        try { localStorage.setItem(key, JSON.stringify({ ...draft, createdAt: Date.now(), updatedAt: Date.now() })); } catch {}
        setAppId(key);
      }

      // Mirror to tenant applications (best-effort) so recruiters can see in-progress
      try {
        const isLocalDev = typeof window !== 'undefined' && window.location.hostname === 'localhost' && process.env.NODE_ENV === 'development';
        if (!isLocalDev && tenantId && jobId && uid) {
          const tidAppId = `${uid}_${jobId}`;
          const tRef = doc(db, 'tenants', tenantId, 'applications', tidAppId);
          await setDoc(tRef, {
            status: 'in_progress',
            uid,
            jobId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }, { merge: true });
          setTenantAppId(tidAppId);
        }
      } catch {}
    };
    createDraft();
  }, [tenantId, jobId, uid, appId]);

  // Load job posting requirements (fallback merges can be added later)
  useEffect(() => {
    const loadPosting = async () => {
      try {
        
        if (!tenantId || !jobId) {
          
          return;
        }
        const postRef = doc(db, 'tenants', tenantId, 'job_postings', jobId);
        
        const snap = await getDoc(postRef);
        if (!snap.exists()) {
          
          return;
        }
        const data = snap.data() as any;
        
        const merged = {
          licenses: Array.isArray(data?.licensesCerts) ? data.licensesCerts.filter(Boolean) : [],
          certifications: Array.isArray(data?.licensesCerts) ? data.licensesCerts.filter(Boolean) : [],
          screenings: [
            ...(Array.isArray(data?.drugScreeningPanels) ? data.drugScreeningPanels : []),
            ...(Array.isArray(data?.backgroundCheckPackages) ? data.backgroundCheckPackages : []),
            ...(Array.isArray(data?.additionalScreenings) ? data.additionalScreenings : []),
            ...(data?.eVerifyRequired ? ['E-Verify'] : []),
          ].filter(Boolean),
          ppe: Array.isArray(data?.requiredPpe) ? data.requiredPpe.filter(Boolean) : [],
          physical: Array.isArray(data?.physicalRequirements) ? data.physicalRequirements.filter(Boolean) : [],
        };
        setRequirements(merged);
        setPosting(data);
        
        

        // Prefill preferences from posting if empty
        setFormData((prev: any) => {
          const next = { ...prev };
          if (!next.preferences) {
            next.preferences = {
              targetPay: typeof data?.payRate === 'number' ? data.payRate : '',
              shift: Array.isArray(data?.shift) && data.shift.length ? data.shift[0] : '',
              availabilityNotes: ''
            };
          }
          return next;
        });
      } catch (error) {
        
        // ignore; requirements UI will just be empty
      }
    };
    loadPosting();
  }, [tenantId, jobId]);

  // Load user profile for validation
  useEffect(() => {
    const loadUser = async () => {
      try {
        if (!uid) return;
        const uref = doc(db, 'users', uid);
        const usnap = await getDoc(uref);
        if (usnap.exists()) setUserProfile(usnap.data());
      } catch {}
    };
    loadUser();
  }, [uid]);

  // Prefill wizard from user profile (runs when profile or posting loads)
  useEffect(() => {
    if (!userProfile) return;

    const addressInfo = userProfile.addressInfo || {};
    // Merge with existing formData.personal to preserve user input
    const existingPersonal = formData.personal || {};
    const personal = {
      firstName: existingPersonal.firstName || userProfile.firstName || '',
      lastName: existingPersonal.lastName || userProfile.lastName || '',
      email: existingPersonal.email || userProfile.email || '',
      phone: existingPersonal.phone || userProfile.phone || userProfile.phoneE164 || '',
      dob: existingPersonal.dob || userProfile.dob || '',
      street: existingPersonal.street || addressInfo.streetAddress || '',
      unit: existingPersonal.unit || addressInfo.unitNumber || '',
      city: existingPersonal.city || userProfile.city || addressInfo.city || '',
      state: existingPersonal.state || userProfile.state || addressInfo.state || '',
      zip: existingPersonal.zip || userProfile.zipCode || addressInfo.zip || '',
      // Include coordinates from addressInfo for validation
      homeLat: existingPersonal.homeLat !== undefined ? existingPersonal.homeLat : (addressInfo.homeLat !== undefined ? addressInfo.homeLat : undefined),
      homeLng: existingPersonal.homeLng !== undefined ? existingPersonal.homeLng : (addressInfo.homeLng !== undefined ? addressInfo.homeLng : undefined),
    };

    const eligibility = {
      workAuthorized: !!userProfile.workEligibility,
      gender: userProfile.gender || '',
      veteranStatus: userProfile.veteranStatus || '',
      disabilityStatus: userProfile.disabilityStatus || '',
    };

    const profilePicture = {
      profilePicture: userProfile.avatar || '',
    };

    const qualifications = {
      skills: Array.isArray(userProfile.skills) ? userProfile.skills : [],
      certifications: Array.isArray(userProfile.certifications) ? userProfile.certifications : [],
      languages: Array.isArray(userProfile.languages) ? userProfile.languages : [],
      education: Array.isArray(userProfile.education) ? userProfile.education : [],
      workHistory: Array.isArray(userProfile.workHistory) ? userProfile.workHistory : [],
      salaryExpectations: userProfile.salaryExpectations || undefined,
      bio: userProfile.bio || '',
      experienceSummary: userProfile.experienceSummary || '',
    };

    // Preferences: prefer existing profile preferences if available; otherwise fall back to posting and defaults
    const preferencesBase = (userProfile && userProfile.preferences) ? { ...(userProfile.preferences || {}) } : {};
    const existingPrefs = formData.preferences || {};
    const prefDefaults = {
      targetPay: '',
      shift: '',
      availabilityNotes: ''
    };
    const preferences = {
      ...prefDefaults,
      ...preferencesBase,
      ...existingPrefs,
    };
    // If posting has values and preference is empty, lightly prefill
    if (typeof preferences.targetPay !== 'number' && typeof posting?.payRate === 'number') {
      (preferences as any).targetPay = posting.payRate;
    }
    if (!preferences.shift && Array.isArray(posting?.shift) && posting.shift.length) {
      (preferences as any).shift = posting.shift[0];
    }

    // Requirements prefill from user profile - only prefill once on initial load
    // This prevents overwriting user input when they're actively editing
    const existingRequirements = formData.requirements || {};
    const hasExistingRequirements = Object.keys(existingRequirements).length > 0 && (
      existingRequirements.drugScreeningComfort ||
      existingRequirements.backgroundScreeningComfort ||
      existingRequirements.eVerifyComfort ||
      existingRequirements.transportMethod ||
      existingRequirements.languagesComfort ||
      existingRequirements.physicalRequirementsComfort ||
      existingRequirements.uniformRequirementsComfort ||
      existingRequirements.customUniformRequirementsComfort ||
      existingRequirements.requiredPpeComfort ||
      (existingRequirements.additionalScreenings && Object.keys(existingRequirements.additionalScreenings).length > 0)
    );

    // Only prefill if there's no existing requirements data and we haven't prefilled yet
    if (!hasExistingRequirements && !prefilledRef.current) {
      const requirementsPrefill = {
        ...existingRequirements,
        drugScreeningComfort: existingRequirements.drugScreeningComfort || userProfile.comfortablePassDrug || '',
        drugExplanation: existingRequirements.drugExplanation || userProfile.passDrugExplanation || '',
        backgroundScreeningComfort: existingRequirements.backgroundScreeningComfort || userProfile.comfortablePassBackground || '',
        backgroundExplanation: existingRequirements.backgroundExplanation || userProfile.passBackgroundExplanation || '',
        additionalScreenings: {
          ...existingRequirements.additionalScreenings,
        },
        eVerifyComfort: existingRequirements.eVerifyComfort || userProfile.comfortableEVerify || '',
        transportMethod: existingRequirements.transportMethod || userProfile.transportMethod || '',
        languagesComfort: existingRequirements.languagesComfort || userProfile.comfortableWithLanguages || '',
        physicalRequirementsComfort: existingRequirements.physicalRequirementsComfort || userProfile.comfortableWithPhysicalRequirements || '',
        uniformRequirementsComfort: existingRequirements.uniformRequirementsComfort || userProfile.comfortableWithUniformRequirements || '',
        customUniformRequirementsComfort: existingRequirements.customUniformRequirementsComfort || userProfile.comfortableWithCustomUniformRequirements || '',
        requiredPpeComfort: existingRequirements.requiredPpeComfort || userProfile.comfortableWithRequiredPpe || '',
      };

      // Prefill additional screenings from user profile with dynamic field names
      if (Array.isArray(posting?.additionalScreenings)) {
        console.log('📋 Prefilling additional screenings from posting:', posting.additionalScreenings);
        console.log('📋 User profile data:', userProfile);
        posting.additionalScreenings.forEach((name: string) => {
          const key = `comfortableWith${name.replace(/[^a-zA-Z0-9]+/g,'')}`;
          const userValue = (userProfile as any)[key];
          console.log(`  → ${name}: key=${key}, userValue=${userValue}, alreadyInForm=${requirementsPrefill.additionalScreenings[name]}`);
          if (userValue && !requirementsPrefill.additionalScreenings[name]) {
            requirementsPrefill.additionalScreenings[name] = userValue;
            console.log(`  ✅ Set additionalScreenings["${name}"] = ${userValue}`);
          }
        });
        console.log('📋 Final requirementsPrefill.additionalScreenings:', requirementsPrefill.additionalScreenings);
      }

      // Only prefill if formData doesn't already have meaningful data
      // This prevents overwriting user input after account creation
      const hasExistingPersonalData = formData.personal && (
        formData.personal.firstName || 
        formData.personal.lastName || 
        formData.personal.email ||
        formData.personal.phone
      );
      
      // Only persist prefill if we don't have existing personal data
      // This ensures user input is preserved after account creation
      if (!hasExistingPersonalData) {
        persist({ personal, eligibility, profilePicture, qualifications, preferences, requirements: requirementsPrefill });
        prefilledRef.current = true;
      } else {
        // Merge personal data instead of replacing it
        persist({ 
          personal: { ...personal, ...formData.personal },
          eligibility, 
          profilePicture, 
          qualifications, 
          preferences, 
          requirements: requirementsPrefill 
        });
        prefilledRef.current = true;
      }
    }
  }, [userProfile, posting]);

  // Compute missing required items for Requirements step based on new card UX
  const computeMissing = () => {
    const req = (formData.requirements || {}) as any;
    const uploaded = (req.uploaded || {}) as Record<string, boolean>;
    const profileCerts: string[] = Array.isArray(userProfile?.certifications)
      ? userProfile.certifications.map((c: any) => (typeof c === 'string' ? c : c?.name)).filter(Boolean)
      : [];

    // 1) Certifications must be uploaded or already present on profile
    const showLicensesCerts = posting?.showLicensesCerts === true;
    const missingCerts = showLicensesCerts
      ? (requirements.certifications || []).filter((name) => !profileCerts.includes(name) && !uploaded[name])
      : [];

    // 2) Drug screening
    const needsDrug = !!posting?.showDrugScreening;
    const drugAnswered = typeof req.drugScreeningComfort === 'string' && req.drugScreeningComfort.length > 0;
    const drugNeedsExplanation = req.drugScreeningComfort === 'Maybe' && !(req.drugExplanation || '').trim();

    // 3) Background screening
    const needsBackground = !!posting?.showBackgroundChecks;
    const backgroundAnswered = typeof req.backgroundScreeningComfort === 'string' && req.backgroundScreeningComfort.length > 0;
    const backgroundNeedsExplanation = req.backgroundScreeningComfort === 'Maybe' && !(req.backgroundExplanation || '').trim();

    // 4) E-Verify
    const needsEVerify = !!posting?.eVerifyRequired;
    const eVerifyAnswered = typeof req.eVerifyComfort === 'string' && req.eVerifyComfort.length > 0;

    // 5) Additional screenings (only if enabled)
    const showAdditional = posting?.showAdditionalScreenings === true;
    const addList: string[] = showAdditional && Array.isArray(posting?.additionalScreenings) ? posting.additionalScreenings : [];
    const addMap = (req.additionalScreenings || {}) as Record<string, string>;
    const missingAdditional = showAdditional ? addList.filter((name) => !(addMap[name] && String(addMap[name]).length > 0)) : [];

    return {
      certs: missingCerts,
      drug: needsDrug && (!drugAnswered || drugNeedsExplanation),
      background: needsBackground && (!backgroundAnswered || backgroundNeedsExplanation),
      everify: needsEVerify && !eVerifyAnswered,
      additional: missingAdditional,
    } as const;
  };

  const missing = computeMissing();

  const ensurePersonalCoordinates = async (personalData: any) => {
    if (!personalData) return personalData;
    if (personalData.homeLat !== undefined && personalData.homeLng !== undefined) {
      return personalData;
    }
    const street = personalData.street?.trim();
    const city = personalData.city?.trim();
    const state = personalData.state?.trim();
    if (!street || !city || !state) {
      return personalData;
    }
    try {
      const coords = await geocodeAddress(
        `${street}, ${city}, ${state} ${personalData.zip ? String(personalData.zip).trim() : ''}`.trim()
      );
      setFormData((prev: any) => ({
        ...prev,
        personal: {
          ...(prev.personal || {}),
          homeLat: coords.lat,
          homeLng: coords.lng,
        },
      }));
      return {
        ...personalData,
        homeLat: coords.lat,
        homeLng: coords.lng,
      };
    } catch (error) {
      console.warn('Failed to geocode address while ensuring coordinates:', error);
      return personalData;
    }
  };

  const persist = async (partial: any) => {
    setSaving(true);
    try {
      setFormData((prev: any) => {
        const updated = { ...prev, ...partial };
        // Debug logging for address data persistence
        if (partial.personal) {
          console.log('💾 persist - saving personal data:', {
            partial: partial.personal,
            updatedPersonal: updated.personal,
            hasAddress: !!(updated.personal?.street || updated.personal?.city),
            hasCoordinates: !!(updated.personal?.homeLat && updated.personal?.homeLng)
          });
        }
        return updated;
      });
      if (!uid || !appId) {
        // Draft not created yet; defer backend write but keep local state
        return;
      }
      if (appId.startsWith('appDraft:')) {
        const existing = localStorage.getItem(appId);
        const parsed = existing ? JSON.parse(existing) : {};
        try { localStorage.setItem(appId, JSON.stringify({ ...parsed, data: { ...formData, ...partial }, updatedAt: Date.now() })); } catch {}
      } else {
        const appRef = doc(db, 'tenants', tenantId, 'applicationDrafts', appId);
        await updateDoc(appRef, { data: { ...formData, ...partial }, updatedAt: serverTimestamp() });
      }

      // Best-effort mirror to tenant application
      try {
        const isLocalDev = typeof window !== 'undefined' && window.location.hostname === 'localhost' && process.env.NODE_ENV === 'development';
        if (!isLocalDev && tenantId && (tenantAppId || (uid && jobId))) {
          const tidAppId = tenantAppId || `${uid}_${jobId}`;
          const tRef = doc(db, 'tenants', tenantId, 'applications', tidAppId);
          const personal = (partial.personal || formData.personal) || {};
          await setDoc(tRef, {
            updatedAt: serverTimestamp(),
            applicant: {
              firstName: personal.firstName || null,
              lastName: personal.lastName || null,
              email: personal.email || null,
              phone: personal.phone || null,
            },
          }, { merge: true });
          if (!tenantAppId) setTenantAppId(tidAppId);
        }
      } catch {}
    } finally {
      setSaving(false);
    }
  };

  const handleNext = async () => {
    // Save-and-continue: persist current step into user profile where applicable
    setSaving(true);
    try {
      // Create account after Personal Info step if not authenticated
      if (activeStep === 0 && !auth.currentUser) {
        const email = String(formData?.personal?.email || '').trim();
        if (!email) {
          alert('Please enter your email address.');
          setSaving(false);
          return;
        }
        if (!password || password.length < 6) {
          alert('Please create a password (minimum 6 characters) to continue.');
          setSaving(false);
          return;
        }
        if (password !== confirmPassword) {
          alert('Passwords do not match. Please try again.');
          setSaving(false);
          return;
        }
        try {
          const cred = await createUserWithEmailAndPassword(auth, email, password);
          // Account created successfully - continue with next step
          // The uid will be available via auth.currentUser.uid in subsequent steps
        } catch (e: any) {
          const errorMessage = e?.message || 'unknown error';
          if (errorMessage.includes('email-already-in-use')) {
            alert('This email is already registered. Please sign in instead.');
          } else {
            alert(`We could not create your account: ${errorMessage}`);
          }
          setSaving(false);
          return;
        }
      }

      const effectiveUid = auth.currentUser?.uid || uid;
      if (effectiveUid) {
        const userRef = doc(db, 'users', effectiveUid);
        if (activeStep === 0) {
          // Personal Info → save name/email/phone/dob/address
          const p = await ensurePersonalCoordinates({ ...(formData.personal || {}) });
          const update: any = { updatedAt: serverTimestamp() };
          if (p.firstName) update.firstName = String(p.firstName).trim();
          if (p.lastName) update.lastName = String(p.lastName).trim();
          if (p.email) update.email = String(p.email).trim();
          // If email changed from auth user, update Firebase Auth email as well
          try {
            const user = auth.currentUser;
            if (user && p.email && user.email !== String(p.email).trim()) {
              await updateEmail(user, String(p.email).trim());
            }
          } catch (e) {
            // ignore auth update failure; profile still updates
          }
          if (p.phone) update.phone = String(p.phone).trim();
          if (p.dob) update.dob = String(p.dob).trim();
          
          const addr: any = {};
          if (p.street) addr.street = String(p.street).trim();
          if (p.unit) addr.unit = String(p.unit).trim();
          if (p.city) addr.city = String(p.city).trim();
          if (p.state) addr.state = String(p.state).trim();
          if (p.zip) addr.zipCode = String(p.zip).trim();
          if (p.homeLat !== undefined && p.homeLng !== undefined) {
            addr.coordinates = {
              lat: Number(p.homeLat),
              lng: Number(p.homeLng),
            };
          }
          if (Object.keys(addr).length > 0) {
            update.address = addr;
            if (addr.city) update.city = addr.city;
            if (addr.state) update.state = addr.state;
            if (addr.zipCode) update.zipCode = addr.zipCode;

            // Keep Profile page Home Address (AddressFormFields) in sync
            // That component reads/writes users/{uid}.addressInfo.{streetAddress,unitNumber,city,state,zip}
            if (p.street) update['addressInfo.streetAddress'] = String(p.street).trim();
            if (p.unit) update['addressInfo.unitNumber'] = String(p.unit).trim();
            if (p.city) update['addressInfo.city'] = String(p.city).trim();
            if (p.state) update['addressInfo.state'] = String(p.state).trim();
            if (p.zip) update['addressInfo.zip'] = String(p.zip).trim();
            
            // Save coordinates for location-based job matching and candidate proximity searches
            if (p.homeLat !== undefined && p.homeLng !== undefined) {
              update.homeLat = Number(p.homeLat);
              update.homeLng = Number(p.homeLng);
              update['addressInfo.homeLat'] = Number(p.homeLat);
              update['addressInfo.homeLng'] = Number(p.homeLng);
            }
          }
          
          // Use upsertUserFromWizard to save personal info AND set tenantIds/activeTenantId
          // This ensures proper nested structure: tenantIds.{tenantId}.{securityLevel, role}
          // and always sets activeTenantId to current tenant when applying through wizard
          if (tenantId) {
            try {
              const functions = getFunctions();
              const upsertUserFromWizard = httpsCallable(functions as any, 'upsertUserFromWizard');
              await upsertUserFromWizard({
                tenantId,
                profileUpdate: update
              });
              console.log('✅ upsertUserFromWizard succeeded - tenantIds and activeTenantId set');
            } catch (err) {
              console.warn('upsertUserFromWizard callable failed, falling back to direct write:', err);
              // Fallback: set tenantIds and activeTenantId directly
              const userSnap = await getDoc(userRef);
              const existingData = userSnap.exists() ? userSnap.data() : {};
              update.tenantIds = {
                ...(existingData?.tenantIds || {}),
                [tenantId]: {
                  ...(existingData?.tenantIds?.[tenantId] || {}),
                  role: 'Applicant',
                  securityLevel: '2',
                  addedAt: serverTimestamp(),
                },
              };
              // Always set activeTenantId to current tenant
              update.activeTenantId = tenantId;
              if (Object.keys(update).length > 1) {
                await setDoc(userRef, update, { merge: true });
                console.log('✅ Fallback direct write succeeded - tenantIds and activeTenantId set');
              }
            }
          } else {
            // No tenantId, just save personal info directly
            if (Object.keys(update).length > 1) {
              await setDoc(userRef, update, { merge: true });
            }
          }

          // Reload userProfile immediately after saving to ensure Address step has the latest data
          try {
            const updatedSnap = await getDoc(userRef);
            if (updatedSnap.exists()) {
              setUserProfile(updatedSnap.data());
              console.log('✅ User profile reloaded after personal info save');
            }
          } catch (err) {
            console.warn('Failed to reload user profile:', err);
          }

          // If phone changed, enforce Twilio verification via modal
          const onlyDigits = (v: string) => (v || '').replace(/\D/g, '');
          const currentPhone = userProfile?.phone || userProfile?.phoneE164 || '';
          if (onlyDigits(p.phone || '') !== onlyDigits(currentPhone)) {
            setVerifyOpen(true);
            return; // pause progression until verification completes
          }
        } else if (activeStep === 1) {
          // Address → save address data with coordinates
          const p = await ensurePersonalCoordinates({ ...(formData.personal || {}) });
          const update: any = { updatedAt: serverTimestamp() };
          
          const addr: any = {};
          if (p.street) addr.street = String(p.street).trim();
          if (p.unit) addr.unit = String(p.unit).trim();
          if (p.city) addr.city = String(p.city).trim();
          if (p.state) addr.state = String(p.state).trim();
          if (p.zip) addr.zipCode = String(p.zip).trim();
          if (p.homeLat !== undefined && p.homeLng !== undefined) {
            addr.coordinates = {
              lat: Number(p.homeLat),
              lng: Number(p.homeLng),
            };
          }
          if (Object.keys(addr).length > 0) {
            update.address = addr;
            if (addr.city) update.city = addr.city;
            if (addr.state) update.state = addr.state;
            if (addr.zipCode) update.zipCode = addr.zipCode;

            // Keep Profile page Home Address (AddressFormFields) in sync
            if (p.street) update['addressInfo.streetAddress'] = String(p.street).trim();
            if (p.unit) update['addressInfo.unitNumber'] = String(p.unit).trim();
            if (p.city) update['addressInfo.city'] = String(p.city).trim();
            if (p.state) update['addressInfo.state'] = String(p.state).trim();
            if (p.zip) update['addressInfo.zip'] = String(p.zip).trim();
            
            // Save coordinates for location-based job matching
            if (p.homeLat !== undefined && p.homeLng !== undefined) {
              update.homeLat = Number(p.homeLat);
              update.homeLng = Number(p.homeLng);
              update['addressInfo.homeLat'] = Number(p.homeLat);
              update['addressInfo.homeLng'] = Number(p.homeLng);
            }
          }
          
          if (Object.keys(update).length > 1) {
            await setDoc(userRef, update, { merge: true });
          }
        } else if (activeStep === 2) {
          // Work Eligibility → save EEO fields
          const e = formData.eligibility || {};
          const update: any = { updatedAt: serverTimestamp() };
          if (typeof e.workAuthorized === 'boolean') update.workEligibility = !!e.workAuthorized;
          if (typeof e.requireSponsorship === 'boolean') update.requireSponsorship = !!e.requireSponsorship;
          if (e.gender !== undefined) update.gender = String(e.gender || '');
          if (e.veteranStatus !== undefined) update.veteranStatus = String(e.veteranStatus || '');
          if (e.disabilityStatus !== undefined) update.disabilityStatus = String(e.disabilityStatus || '');
          if (Object.keys(update).length > 1) {
            await setDoc(userRef, update, { merge: true });
          }
        } else if (activeStep === 3) {
          // Profile Picture → save profile picture URL
          const p = formData.profilePicture || {};
          const update: any = { updatedAt: serverTimestamp() };
          if (p.profilePicture) update.avatar = p.profilePicture;
          if (Object.keys(update).length > 1) {
            await setDoc(userRef, update, { merge: true });
          }
              } else if (activeStep === 5) {
                // Skills → save skills, certifications, languages to profile
                const q = formData.qualifications || {};
                const update: any = { updatedAt: serverTimestamp() };
                if (Array.isArray(q.skills)) update.skills = q.skills;
                if (Array.isArray(q.certifications)) update.certifications = q.certifications;
                if (Array.isArray(q.languages)) update.languages = normalizeLanguageList(q.languages);
                if (Object.keys(update).length > 1) await setDoc(userRef, update, { merge: true });
              } else if (activeStep === 6) {
                // Education → save education and certifications to profile
                const q = formData.qualifications || {};
                const update: any = { updatedAt: serverTimestamp() };
                if (Array.isArray(q.education)) update.education = q.education;
                if (Array.isArray(q.certifications)) update.certifications = q.certifications;
                if (Object.keys(update).length > 1) await setDoc(userRef, update, { merge: true });
              } else if (activeStep === 7) {
                // Work Experience → save work experience to profile
                const q = formData.qualifications || {};
                const update: any = { updatedAt: serverTimestamp() };
                if (Array.isArray(q.workHistory)) update.workHistory = q.workHistory;
                if (Array.isArray(q.workExperience)) {
                  update.workExperience = q.workExperience;
                  update.workHistory = q.workExperience; // Also save to workHistory for backward compatibility
                }
                if (Object.keys(update).length > 1) await setDoc(userRef, update, { merge: true });
              } else if (activeStep === 8) {
                // Bio → save professional bio to profile
                const b = formData.bio || {};
                const update: any = { updatedAt: serverTimestamp() };
                if (typeof b.professionalBio === 'string' && b.professionalBio.trim()) {
                  update.professionalBio = b.professionalBio.trim();
                }
                if (Object.keys(update).length > 1) await setDoc(userRef, update, { merge: true });
              } else if (activeStep === 9) {
                // Preferences → persist to user profile under a nested preferences object
                const p = formData.preferences || {};
                const update: any = { updatedAt: serverTimestamp() };
                update.preferences = {
                  targetPay: typeof p.targetPay === 'number' ? p.targetPay : null,
                  shift: typeof p.shift === 'string' ? p.shift : '',
                  shiftPreferences: Array.isArray(p.shiftPreferences) ? p.shiftPreferences : [],
                };
                // Also store flat fields for easy querying if needed
                if (Array.isArray(update.preferences.shiftPreferences)) {
                  update['preferences.shiftPreferences'] = update.preferences.shiftPreferences;
                }
                await setDoc(userRef, update, { merge: true });
              } else if (activeStep === 10) {
                // Requirements → save screening responses and availability to user profile
                const r = formData.requirements || {};
                const p = formData.preferences || {};
                const update: any = { updatedAt: serverTimestamp() };
                if (r.drugScreeningComfort) update.comfortablePassDrug = r.drugScreeningComfort;
                if (r.drugExplanation) update.passDrugExplanation = r.drugExplanation;
                if (r.backgroundScreeningComfort) update.comfortablePassBackground = r.backgroundScreeningComfort;
                if (r.backgroundExplanation) update.passBackgroundExplanation = r.backgroundExplanation;
                if (r.eVerifyComfort) update.comfortableEVerify = r.eVerifyComfort;
                if (r.languagesComfort) update.comfortableWithLanguages = r.languagesComfort;
                if (r.physicalRequirementsComfort) update.comfortableWithPhysicalRequirements = r.physicalRequirementsComfort;
                if (r.uniformRequirementsComfort) update.comfortableWithUniformRequirements = r.uniformRequirementsComfort;
                if (r.customUniformRequirementsComfort) update.comfortableWithCustomUniformRequirements = r.customUniformRequirementsComfort;
                if (r.requiredPpeComfort) update.comfortableWithRequiredPpe = r.requiredPpeComfort;
                if (r.transportMethod) update.transportMethod = r.transportMethod;
                
                // Save additional screenings with dynamic field names
                if (r.additionalScreenings && Array.isArray(posting?.additionalScreenings)) {
                  posting.additionalScreenings.forEach((name: string) => {
                    const key = `comfortableWith${name.replace(/[^a-zA-Z0-9]+/g,'')}`;
                    if (r.additionalScreenings[name]) {
                      update[key] = r.additionalScreenings[name];
                    }
                  });
                }
                
                // Save availability to start (moved from Preferences step)
                if (typeof p.availableToStartDate === 'string') {
                  update.availableToStartDate = p.availableToStartDate;
                }
                if (typeof p.availabilityNotes === 'string') {
                  update['preferences.availabilityNotes'] = p.availabilityNotes;
                }
                // Also save in nested preferences object
                if (typeof p.availableToStartDate === 'string' || typeof p.availabilityNotes === 'string') {
                  if (!update.preferences) update.preferences = {};
                  if (typeof p.availableToStartDate === 'string') update.preferences.availableToStartDate = p.availableToStartDate;
                  if (typeof p.availabilityNotes === 'string') update.preferences.availabilityNotes = p.availabilityNotes;
                }
                
                if (Object.keys(update).length > 1) {
                  await setDoc(userRef, update, { merge: true });
                }
        }
      }
    } finally {
      setSaving(false);
      const newStep = Math.min(activeStep + 1, steps.length - 1);
      setActiveStep(newStep);
      // Save current step to localStorage
      try {
        localStorage.setItem(`${sessionKey}-step`, newStep.toString());
      } catch (error) {
        console.warn('Failed to save step to localStorage:', error);
      }
    }
  };
  
  const handleBack = () => {
    const newStep = Math.max(activeStep - 1, 0);
    setActiveStep(newStep);
    // Save current step to localStorage
    try {
      localStorage.setItem(`${sessionKey}-step`, newStep.toString());
    } catch (error) {
      console.warn('Failed to save step to localStorage:', error);
    }
  };

  const handleSubmit = async () => {
    setSaving(true);
    try {
      // Account should already be created after Personal Info step
      const effectiveUid: string | null = auth.currentUser?.uid || (uid || null);
      if (!effectiveUid) {
        alert('Please complete the Personal Info step to create your account before submitting.');
        setSaving(false);
        return;
      }

      // Final guard: ensure all required requirement fields are answered
      const m = computeMissing();
      if (m.drug || m.background || m.everify || (m.additional && m.additional.length > 0)) {
        setSaving(false);
        try {
          alert('Please complete all required items (Drug, Background, E‑Verify, and Additional screenings) before submitting.');
        } catch {}
        return;
      }

      // Ensure we have a draft id even if initial draft creation hasn't completed yet
      let effectiveAppId = appId;
      if (!effectiveAppId) {
        const key = `appDraft:${effectiveUid}:${tenantId || 'na'}:${jobId || 'na'}`;
        try {
          const draft = {
            status: 'draft',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            tenantId,
            jobId,
            uid: effectiveUid,
            data: formData || {},
          };
          localStorage.setItem(key, JSON.stringify(draft));
        } catch {}
        effectiveAppId = key;
        setAppId(key);
      }
      // Check for shift date conflicts if this is a gig job with shifts
      if (selectedShifts.length > 0 && posting?.jobOrderId) {
        let conflict: any = null;
        
        if (selectedShifts.length === 1) {
          // Single shift - get the shift date and check
          try {
            const shiftRef = doc(db, 'tenants', tenantId, 'job_orders', posting.jobOrderId, 'shifts', selectedShifts[0]);
            const shiftSnap = await getDoc(shiftRef);
            
            if (shiftSnap.exists()) {
              const shiftData = shiftSnap.data();
              if (shiftData.shiftDate) {
                conflict = await checkShiftDateConflict(effectiveUid, tenantId, shiftData.shiftDate);
              }
            }
          } catch (error) {
            console.error('Error checking shift date conflict:', error);
          }
        } else {
          // Multiple shifts - check all of them
          conflict = await checkMultipleShiftDateConflicts(
            effectiveUid,
            tenantId,
            selectedShifts,
            posting.jobOrderId
          );
        }
        
        if (conflict?.hasConflict) {
          setSaving(false);
          // Show error message using Snackbar
          const conflictDate = conflict.conflictingApplication?.shiftDate 
            ? new Date(conflict.conflictingApplication.shiftDate).toLocaleDateString()
            : 'this date';
          
          setSubmitOpen(true);
          // Store error message in state for display
          const errorMsg = `You already have an active application for a shift on ${conflictDate}. ` +
            `You can only apply to one shift per day. ` +
            `Please withdraw your existing application or wait for it to be processed.`;
          
          // Use setTimeout to show error after state updates
          setTimeout(() => {
            alert(errorMsg); // Fallback to alert for now, can be improved with proper error state
          }, 100);
          return;
        }
      }
      
      if ((effectiveAppId || '').startsWith('appDraft:')) {
        const existing = localStorage.getItem(effectiveAppId!);
        const parsed = existing ? JSON.parse(existing) : {};
        try { localStorage.setItem(effectiveAppId!, JSON.stringify({ ...parsed, status: 'submitted', submittedAt: Date.now() })); } catch {}
      } else {
        // Mark draft as submitted in tenants/{tenantId}/applicationDrafts
        const draftRef = doc(db, 'tenants', tenantId, 'applicationDrafts', effectiveAppId!);
        await updateDoc(draftRef, { status: 'submitted', submittedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      }

      // Merge selected profile fields into users/{uid}
      const userRef = doc(db, 'users', effectiveUid!);
      const personal = await ensurePersonalCoordinates({ ...(formData.personal || {}) });
      
      // Debug logging for address data
      console.log('🔍 handleSubmit - formData.personal:', personal);
      console.log('🔍 handleSubmit - address fields:', {
        street: personal.street,
        city: personal.city,
        state: personal.state,
        zip: personal.zip,
        homeLat: personal.homeLat,
        homeLng: personal.homeLng
      });
      
      const eligibility = formData.eligibility || {};
      const profilePicture = formData.profilePicture || {};
      const quals = formData.qualifications || {};
      const normalizedLanguages = normalizeLanguageList(quals.languages || []);
      const certifications = Array.isArray(quals.certifications)
        ? quals.certifications
        : [];
      const skills = Array.isArray(quals.skills)
        ? (quals.skills.map((s: any) => (typeof s === 'string' ? s : s?.name)).filter(Boolean))
        : [];
      const profileUpdate: any = {
        updatedAt: serverTimestamp(),
      };
      if (personal.firstName) profileUpdate.firstName = String(personal.firstName).trim();
      if (personal.lastName) profileUpdate.lastName = String(personal.lastName).trim();
      if (personal.email) profileUpdate.email = String(personal.email).trim();
      if (personal.phone) profileUpdate.phone = String(personal.phone).trim();
      if (personal.dob) profileUpdate.dob = String(personal.dob).trim();
      
      // Save address data
      if (personal.street || personal.city || personal.state || personal.zip) {
        const addr: any = {};
        if (personal.street) addr.street = String(personal.street).trim();
        if (personal.unit) addr.unit = String(personal.unit).trim();
        if (personal.city) addr.city = String(personal.city).trim();
        if (personal.state) addr.state = String(personal.state).trim();
        if (personal.zip) addr.zipCode = String(personal.zip).trim();
        if (personal.homeLat !== undefined && personal.homeLng !== undefined) {
          addr.coordinates = {
            lat: Number(personal.homeLat),
            lng: Number(personal.homeLng),
          };
        }
        if (Object.keys(addr).length > 0) {
          profileUpdate.address = addr;
          if (addr.city) profileUpdate.city = addr.city;
          if (addr.state) profileUpdate.state = addr.state;
          if (addr.zipCode) profileUpdate.zipCode = addr.zipCode;
          
          // Save to addressInfo structure (used by Profile page) as nested object
          profileUpdate.addressInfo = {
            ...(profileUpdate.addressInfo || {}),
            ...(personal.street ? { streetAddress: String(personal.street).trim() } : {}),
            ...(personal.unit ? { unitNumber: String(personal.unit).trim() } : {}),
            ...(personal.city ? { city: String(personal.city).trim() } : {}),
            ...(personal.state ? { state: String(personal.state).trim() } : {}),
            ...(personal.zip ? { zip: String(personal.zip).trim() } : {}),
            ...(personal.homeLat !== undefined && personal.homeLng !== undefined ? {
              homeLat: Number(personal.homeLat),
              homeLng: Number(personal.homeLng)
            } : {})
          };

          if (personal.homeLat !== undefined && personal.homeLng !== undefined) {
            profileUpdate.homeLat = Number(personal.homeLat);
            profileUpdate.homeLng = Number(personal.homeLng);
          }
          
          console.log('✅ Address data being saved:', {
            address: profileUpdate.address,
            addressInfo: profileUpdate.addressInfo,
            city: profileUpdate.city,
            state: profileUpdate.state,
            zipCode: profileUpdate.zipCode
          });
        }
      } else {
        console.warn('⚠️ No address data found in personal object');
      }
      
      if (normalizedLanguages.length) profileUpdate.languages = normalizedLanguages;
      if (certifications.length) profileUpdate.certifications = certifications;
      if (skills.length) profileUpdate.skills = skills;
      
      // Save education and work experience
      if (Array.isArray(quals.education) && quals.education.length > 0) {
        profileUpdate.education = quals.education;
      }
      if (Array.isArray(quals.workExperience) && quals.workExperience.length > 0) {
        profileUpdate.workExperience = quals.workExperience;
        // Also save to workHistory for backward compatibility
        profileUpdate.workHistory = quals.workExperience;
      } else if (Array.isArray(quals.workHistory) && quals.workHistory.length > 0) {
        profileUpdate.workHistory = quals.workHistory;
        profileUpdate.workExperience = quals.workHistory;
      }
      if (typeof eligibility.workAuthorized === 'boolean') profileUpdate.workEligibility = !!eligibility.workAuthorized;
      if (eligibility.gender) profileUpdate.gender = String(eligibility.gender);
      if (eligibility.veteranStatus) profileUpdate.veteranStatus = String(eligibility.veteranStatus);
      if (eligibility.disabilityStatus) profileUpdate.disabilityStatus = String(eligibility.disabilityStatus);
      if (profilePicture.profilePicture) profileUpdate.avatar = String(profilePicture.profilePicture);
      
      // Save requirements data (screenings)
      const requirements = formData.requirements || {};
      if (requirements.drugScreeningComfort) profileUpdate.comfortablePassDrug = requirements.drugScreeningComfort;
      if (requirements.drugExplanation) profileUpdate.passDrugExplanation = requirements.drugExplanation;
      if (requirements.backgroundScreeningComfort) profileUpdate.comfortablePassBackground = requirements.backgroundScreeningComfort;
      if (requirements.backgroundExplanation) profileUpdate.passBackgroundExplanation = requirements.backgroundExplanation;
      if (requirements.eVerifyComfort) profileUpdate.comfortableEVerify = requirements.eVerifyComfort;
      
      // Save additional screenings with dynamic field names
      if (requirements.additionalScreenings && Array.isArray(posting?.additionalScreenings)) {
        posting.additionalScreenings.forEach((name: string) => {
          const key = `comfortableWith${name.replace(/[^a-zA-Z0-9]+/g,'')}`;
          if (requirements.additionalScreenings[name]) {
            profileUpdate[key] = requirements.additionalScreenings[name];
          }
        });
      }
      
      // Upsert via callable function for server-side creation, then merge on client as fallback
      try {
        const functions = getFunctions();
        const upsertUserFromWizard = httpsCallable(functions as any, 'upsertUserFromWizard');
        await upsertUserFromWizard({
          tenantId,
          profileUpdate: {
            ...profileUpdate,
            ...(tenantId ? { [`tenantIds.${tenantId}.securityLevel`]: '2', [`tenantIds.${tenantId}.role`]: 'Applicant' } : {}),
            // Keep security level scoped to tenant map; do not override root securityLevel
          }
        });
      } catch (err) {
        console.warn('upsertUserFromWizard callable failed, falling back to client merge:', err);
      }
      await setDoc(userRef, profileUpdate, { merge: true });

      // Create final submitted application in tenants/{tenantId}/applications
      try {
        if (tenantId && effectiveUid && jobId) {
          const tidAppId = `${effectiveUid}_${jobId}`;
          const tRef = doc(db, 'tenants', tenantId, 'applications', tidAppId);
          
          // Get shift dates for gig jobs (for one-shift-per-day validation)
          let shiftDate: string | null = null;
          const shiftDates: string[] = [];
          
          if (selectedShifts.length > 0 && posting?.jobOrderId) {
            for (const shiftId of selectedShifts) {
              try {
                const shiftRef = doc(db, 'tenants', tenantId, 'job_orders', posting.jobOrderId, 'shifts', shiftId);
                const shiftSnap = await getDoc(shiftRef);
                
                if (shiftSnap.exists()) {
                  const shiftData = shiftSnap.data();
                  if (shiftData.shiftDate) {
                    const dateStr = extractDateFromShiftDate(shiftData.shiftDate);
                    if (selectedShifts.length === 1) {
                      shiftDate = dateStr;
                    } else {
                      shiftDates.push(dateStr);
                    }
                  }
                }
              } catch (error) {
                console.error(`Error getting shift date for ${shiftId}:`, error);
              }
            }
          }
          
          await setDoc(tRef, {
            userId: effectiveUid,
            tenantId,
            jobId,
            jobOrderId: posting?.jobOrderId || null, // CRITICAL: Link to job order if posting is connected
            status: 'submitted',
            submittedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            data: formData,
            applicant: {
              firstName: personal.firstName || null,
              lastName: personal.lastName || null,
              email: personal.email || null,
              phone: personal.phone || null,
            },
            // Store shift information for gig jobs
            ...(selectedShifts.length === 1 ? { shiftId: selectedShifts[0] } : {}),
            ...(selectedShifts.length > 1 ? { shiftIds: selectedShifts } : {}),
            // Store shift date(s) for one-shift-per-day validation
            ...(shiftDate ? { shiftDate } : {}),
            ...(shiftDates.length > 0 ? { shiftDates: [...new Set(shiftDates)] } : {}),
          }, { merge: true });
          
          // Prepare denormalized application data for quick lookups
          const applicationId = `${tenantId}_${jobId}`;
          
          // Get company name - fallback to CRM if not on posting
          let companyName = posting?.companyName || null;
          const companyId = posting?.companyId || null;
          
          // If companyName is missing but we have companyId, fetch from CRM
          if (!companyName && companyId && tenantId) {
            try {
              const companyRef = doc(db, 'tenants', tenantId, 'crm_companies', companyId);
              const companySnap = await getDoc(companyRef);
              if (companySnap.exists()) {
                const companyData = companySnap.data();
                companyName = companyData.companyName || companyData.name || null;
              }
            } catch (err) {
              console.warn('Failed to fetch company name from CRM:', err);
            }
          }
          
          // Build shift assignments map for Gig jobs
          const shiftAssignments: Record<string, string> = {};
          if (selectedShifts.length > 0) {
            selectedShifts.forEach(shiftId => {
              shiftAssignments[shiftId] = 'pending'; // All start as pending
            });
          }

          const applicationQuickData: any = {
            applicationId: applicationId, // Include the application ID for reference
            jobId: jobId,
            jobOrderId: posting?.jobOrderId || null, // CRITICAL: Link to job order if posting is connected
            jobTitle: posting?.jobTitle || posting?.postTitle || null,
            jobOrderName: posting?.postTitle || posting?.jobTitle || null, // Full job order name like "Janitor - Parker Plastics Offer - New"
            postTitle: posting?.postTitle || null,
            companyName: companyName,
            companyId: companyId,
            jobPostId: posting?.jobPostId || null,
            payRate: posting?.payRate || null,
            status: 'submitted',
            appliedAt: serverTimestamp(),
            startDate: posting?.startDate || null,
            location: posting?.worksiteName || posting?.city || null,
            updatedAt: serverTimestamp(),
            // Shift selection (for Gig jobs only)
            ...(selectedShifts.length > 0 ? {
              selectedShifts: selectedShifts,
              shiftAssignments: shiftAssignments
            } : {})
          };
          
          // Add application ID to user's applicationIds array AND applicationData map
          try {
            console.log('Updating user document with application data:', {
              userId: effectiveUid,
              applicationId,
              applicationQuickData
            });
            
            await setDoc(userRef, {
              applicationIds: arrayUnion(applicationId),
              [`applicationData.${applicationId}`]: applicationQuickData,
              updatedAt: serverTimestamp()
            }, { merge: true });
            
            console.log('Successfully updated user document with application data');

            try {
              const functions = getFunctions();
              const enqueueApplicantScore = httpsCallable(functions as any, 'enqueueApplicantScore');
              await enqueueApplicantScore({
                userId: effectiveUid,
                applicationId,
                tenantId,
                source: 'wizard_submit'
              });
              console.log('🧠 Applicant score queued for processing');
            } catch (queueErr) {
              console.warn('Failed to enqueue applicant score:', queueErr);
            }
          } catch (userUpdateError) {
            console.error('Failed to update user document with application data:', userUpdateError);
            // Don't throw here - we still want the application to be created
            // The user can be updated later via the migration script if needed
          }
          
          // Auto-add to user groups if specified in job posting
          // Support both new array format (autoAddToUserGroups) and legacy single value (autoAddToUserGroup)
          console.log('🔍 Checking auto-add to user groups:', {
            posting: posting ? {
              autoAddToUserGroups: posting.autoAddToUserGroups,
              autoAddToUserGroup: posting.autoAddToUserGroup,
            } : null,
            tenantId,
            uid: effectiveUid,
          });
          
          const groupIdsToAdd: string[] = [];
          if (posting?.autoAddToUserGroups && Array.isArray(posting.autoAddToUserGroups) && posting.autoAddToUserGroups.length > 0) {
            groupIdsToAdd.push(...posting.autoAddToUserGroups);
            console.log('✅ Found autoAddToUserGroups array:', posting.autoAddToUserGroups);
          } else if (posting?.autoAddToUserGroup && typeof posting.autoAddToUserGroup === 'string') {
            // Legacy support for single group ID
            groupIdsToAdd.push(posting.autoAddToUserGroup);
            console.log('✅ Found legacy autoAddToUserGroup:', posting.autoAddToUserGroup);
          }
          
          if (groupIdsToAdd.length > 0) {
            console.log(`🚀 Adding user ${effectiveUid} to ${groupIdsToAdd.length} group(s):`, groupIdsToAdd);
            try {
              // Use Firebase Function to add user to groups (has admin privileges)
              const functions = getFunctions();
              const addUsersToGroups = httpsCallable(functions as any, 'addUsersToGroups');
              
              await addUsersToGroups({
                userId: effectiveUid,
                groupIds: groupIdsToAdd,
                tenantId: tenantId,
              });
              
              console.log(`✅ Successfully added user ${effectiveUid} to ${groupIdsToAdd.length} user group(s):`, groupIdsToAdd);
            } catch (groupErr) {
              console.error('❌ Error adding user to group(s):', groupErr);
              console.error('Error details:', {
                message: groupErr instanceof Error ? groupErr.message : String(groupErr),
                stack: groupErr instanceof Error ? groupErr.stack : undefined,
                groupIdsToAdd,
                tenantId,
                uid,
              });
            }
          } else {
            console.log('⚠️ No group IDs found to add user to');
          }
        }
      } catch (e) {
        console.error('Error saving application:', e);
      }
      
      // Redirect immediately (no flicker back to step 1). Prefer explicit returnTo.
      const redirectPath = returnTo || (tenantSlug ? `/${tenantSlug}/jobs-board` : '/c1/jobs-board');
      try {
        window.location.replace(redirectPath);
        return;
      } catch {
        navigate(redirectPath, { replace: true });
        return;
      }
    } catch (err: any) {
      console.error('Submit error:', err);
      try {
        alert(`We couldn't submit your application. Please try again in a moment. ${err?.message ? '\n\nDetails: ' + err.message : ''}`);
      } catch {}
    } finally {
      setSaving(false);
    }
  };

  const renderStep = () => {
    switch (activeStep) {
      case 0:
        return (
          <PersonalInfoStep 
            value={formData.personal || {}} 
            onChange={(v) => persist({ personal: v })} 
            onPasswordChange={(pwd, confirmPwd) => {
              setPassword(pwd);
              setConfirmPassword(confirmPwd);
            }}
          />
        );
      case 1:
        return <AddressStep value={formData.personal || {}} onChange={(v) => persist({ personal: v })} />;
      case 2:
        return <WorkEligibilityStep value={formData.eligibility || {}} onChange={(v) => persist({ eligibility: v })} />;
      case 3:
        return <ProfilePictureStep value={formData.profilePicture || {}} onChange={(v) => persist({ profilePicture: v })} />;
      case 4:
        return <ResumeStep value={{ ...(formData.resume || {}), userId: uid || '' }} onChange={(v) => persist({ resume: v })} tenantId={tenantId} />;
      case 5:
        return (
          <SkillsStep
            value={formData.qualifications || {}}
            onChange={(v) => persist({ qualifications: v })}
            context="application"
            tenantId={tenantId}
            jobId={jobId}
            jobPosting={posting}
          />
        );
      case 6:
        return (
          <EducationStep
            value={formData.qualifications || {}}
            onChange={(v) => persist({ qualifications: v })}
            context="application"
            tenantId={tenantId}
            jobId={jobId}
            jobPosting={posting}
          />
        );
      case 7:
        return (
          <WorkExperienceStep
            value={formData.qualifications || {}}
            onChange={(v) => persist({ qualifications: v })}
            context="application"
            tenantId={tenantId}
            jobId={jobId}
            jobPosting={posting}
          />
        );
      case 8:
        return <BioStep value={formData.bio || {}} onChange={(v) => persist({ bio: v })} jobPosting={posting} />;
      case 9:
        return <JobPreferencesStep value={formData.preferences || {}} onChange={(v) => persist({ preferences: v })} jobPosting={posting} />;
      case 10:
        return (
          <Box>
            <RequirementsAcknowledgementStep
              requirements={requirements}
              profile={userProfile}
              uid={uid || ''}
              value={formData.requirements || { acks: {}, uploaded: {} }}
              onChange={(v) => {
                // Check if this is a preferences update
                if (v._preferencesUpdate) {
                  persist({ preferences: v._preferencesUpdate });
                  // Remove the flag and persist requirements normally
                  const { _preferencesUpdate, ...requirementsData } = v;
                  persist({ requirements: requirementsData });
                } else {
                  persist({ requirements: v });
                }
              }}
              jobPosting={posting}
              preferences={formData.preferences || {}}
            />
          </Box>
        );
      default:
        return null;
    }
  };

  const pctComplete = Math.round(((activeStep + 1) / steps.length) * 100);

  const conversationalTitles = [
    'Tell us a bit about you',
    'Work authorization',
    'Add a profile picture',
    'Upload your resume (optional)',
    'Qualifications & skills',
    'Education',
    'Work experience',
    'Tell us about yourself',
    'Job preferences',
    'Requirements'
  ];

  // Require Twilio re-verification if phone differs from profile
  const phoneNeedsVerification = (() => {
    const newPhone = formData?.personal?.phone || '';
    const currentPhone = userProfile?.phone || userProfile?.phoneE164 || '';
    if (!newPhone) return false;
    // Simple compare on digits only
    const onlyDigits = (v: string) => (v || '').replace(/\D/g, '');
    const newDigits = onlyDigits(newPhone);
    const currentDigits = onlyDigits(currentPhone);
    
    // If the new phone is the same as current phone (ignoring formatting), don't require verification
    if (newDigits === currentDigits) return false;
    
    // If the new phone is empty or just formatting differences, don't require verification
    if (newDigits.length < 10) return false;
    
    return true;
  })();

  // Personal Info validation (step 0) - no address required
  const personalValid = !!(
    formData?.personal?.firstName?.trim() &&
    formData?.personal?.lastName?.trim() &&
    formData?.personal?.email?.trim() &&
    formData?.personal?.phone?.trim() &&
    formData?.personal?.phone?.replace(/\D/g, '').length >= 10 && // Phone must have at least 10 digits
    formData?.personal?.dob?.trim() && // Must be in YYYY-MM-DD format
    formData?.personal?.dob?.length === 10 // YYYY-MM-DD format is exactly 10 characters
  );

  // Address validation (step 1) - coordinates required
  const addressValid = !!(
    formData?.personal?.street?.trim() &&
    formData?.personal?.city?.trim() &&
    formData?.personal?.state?.trim() &&
    formData?.personal?.zip?.trim() &&
    formData?.personal?.homeLat !== undefined && // Coordinates must be present
    formData?.personal?.homeLng !== undefined // Coordinates must be present
  );

  const normalizeLanguageList = (languages: any): string[] => {
    if (!Array.isArray(languages)) return [];
    return languages
      .map((lang) => {
        if (typeof lang === 'string') return lang.trim();
        if (lang && typeof lang === 'object') {
          const text = typeof lang.language === 'string' ? lang.language : '';
          return text.trim();
        }
        return '';
      })
      .filter(Boolean);
  };

  // Require a photo on the Profile Picture step unless one already exists
  const hasProfilePicture = !!(
    (formData?.profilePicture?.profilePicture && String(formData.profilePicture.profilePicture).trim()) ||
    (userProfile?.avatar && String(userProfile.avatar).trim())
  );

  // Debug logging for form validation
  if (activeStep === 0) {
    console.log('🔍 Personal Info Validation Debug:', {
      personalValid,
      phoneNeedsVerification,
      formData: formData?.personal,
      missingFields: {
        firstName: !formData?.personal?.firstName,
        lastName: !formData?.personal?.lastName,
        email: !formData?.personal?.email,
        phone: !formData?.personal?.phone,
        dob: !formData?.personal?.dob,
        street: !formData?.personal?.street,
        city: !formData?.personal?.city,
        state: !formData?.personal?.state,
        zip: !formData?.personal?.zip
      }
    });
  }

  return (
    <Box sx={{ 
      px: 0, 
      py: 0,
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Job Details Header */}
      {posting && (
        <Box sx={{ 
          px: { xs: 2, md: 3 }, 
          py: { xs: 2, md: 2.5 }, 
          backgroundColor: 'background.paper', 
          borderBottom: 1, 
          borderColor: 'divider',
          flexShrink: 0
        }}>
          <Box sx={{ 
            maxWidth: { xs: '100%', md: '1200px' },
            mx: { xs: 0, md: 'auto' }
          }}>
            <Typography variant={isMobile ? 'h6' : 'h5'} sx={{ fontWeight: 600, mb: 0.5 }}>
              {posting.jobTitle || posting.postTitle || 'Job Application'}
            </Typography>
            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
              <Typography variant="body2" color="text.secondary">
                {posting.city && posting.state ? `${posting.city}, ${posting.state}` : posting.worksiteName || ''}
              </Typography>
              {posting.payRate && (
                <>
                  <Typography variant="body2" color="text.secondary">•</Typography>
                  <Typography variant="body2" color="text.secondary">
                    ${posting.payRate}/hr
                  </Typography>
                </>
              )}
            </Stack>
          </Box>
        </Box>
      )}
      
      {/* Main content area - framed on desktop, fullscreen on mobile */}
      <Box sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        maxWidth: { xs: '100%', md: '1200px' },
        mx: { xs: 0, md: 'auto' },
        width: '100%',
        px: { xs: 0, md: 3 },
        py: { xs: 0, md: 2 }
      }}>
        <Paper 
          elevation={isMobile ? 0 : 2}
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            borderRadius: { xs: 0, md: 2 },
            overflow: 'hidden',
            backgroundColor: 'background.paper'
          }}
        >
          {/* Full-bleed sticky progress under top bar (no side spacing) */}
          <MilestoneProgress
            total={steps.length}
            completed={activeStep}
            labels={steps}
            sticky="top"
            onJump={undefined}
            sx={{ px: { xs: 2, md: 3 }, py: 1 }}
          />
          {saving && (
            <Box sx={{ mb: 2 }} aria-live="polite" aria-atomic>
              <LinearProgress />
            </Box>
          )}

          {/* Keep stepper for structure but hide visually to reduce clutter (a11y preserved) */}
          <Box sx={{ display: { xs: 'none', md: 'none' } }} aria-hidden>
            <Stepper activeStep={activeStep} alternativeLabel>
            {steps.map((label) => (
              <Step key={label}><StepLabel>{label}</StepLabel></Step>
            ))}
            </Stepper>
          </Box>

          <Box sx={{ mt: 2, mb: 4, mx: 0, px: { xs: 1, md: 3 }, py: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>
            {renderStep()}
          </Box>

          {/* Bottom navigation bar - inside Paper, below content */}
          <Box
            sx={{
              width: '100%',
              mt: 'auto',
              bgcolor: 'background.paper',
              borderTop: 1,
              borderColor: 'divider',
              py: 1.5,
              px: { xs: 2, md: 3 },
            }}
          >
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Button onClick={handleBack} disabled={activeStep === 0}>Back</Button>
              <Button
                variant="contained"
                onClick={activeStep === 10 ? handleSubmit : handleNext}
                disabled={
                  (activeStep === 10 && (
                    missing.drug || missing.background || missing.everify || missing.additional.length > 0
                  )) ||
                  (activeStep === 0 && (!personalValid || (!auth.currentUser && (password.length < 6 || password !== confirmPassword)))) ||
                  (activeStep === 1 && !addressValid) ||
                  (activeStep === 2 && formData?.eligibility?.workAuthorized !== true) ||
                  (activeStep === 3 && !hasProfilePicture) ||
                  saving
                }
              >
                {activeStep === 10 ? 'Submit Application' : activeStep === 4 ? 'Skip' : 'Next'}
              </Button>
            </Stack>
          </Box>
        </Paper>
      </Box>

      {/* Phone verification modal when phone changes */}
      <EligibilityModal
        open={verifyOpen}
        onClose={() => setVerifyOpen(false)}
        onComplete={() => {
          setVerifyOpen(false);
          // advance to next step after successful verification
          setActiveStep((s) => Math.min(s + 1, steps.length - 1));
        }}
        needDOB={false}
        needPhone={true}
      />

      {/* Optional sticky bottom bar (kept for future, hidden) */}
      <Box
        sx={{
          display: 'none',
        }}
      >
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Button onClick={handleBack} disabled={activeStep === 0} aria-label="Back">
            Back
          </Button>
          <Button
            variant="contained"
            onClick={activeStep === 10 ? handleSubmit : handleNext}
            aria-label={activeStep === 10 ? 'Submit Application' : activeStep === 4 ? 'Skip' : 'Next'}
            disabled={
              (activeStep === 10 && (
                missing.drug || missing.background || missing.everify || missing.additional.length > 0
              )) ||
              saving
            }
          >
            {activeStep === 10 ? 'Submit Application' : activeStep === 4 ? 'Skip' : 'Next'}
          </Button>
        </Stack>
      </Box>
      <Snackbar open={submitOpen} autoHideDuration={4000} onClose={() => setSubmitOpen(false)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert onClose={() => setSubmitOpen(false)} severity="success" sx={{ width: '100%' }}>
          Thanks — your application has been submitted!
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default Wizard;



import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Divider, Stack, Step, StepLabel, Stepper, Typography, Alert, Snackbar, LinearProgress, useMediaQuery, useTheme } from '@mui/material';
import { addDoc, arrayUnion, collection, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { auth } from '../../firebase';
import { updateEmail } from 'firebase/auth';
import { db } from '../../firebase';

import PersonalInfoStep from './steps/PersonalInfoStep';
import WorkEligibilityStep from './steps/WorkEligibilityStep';
import ProfilePictureStep from './steps/ProfilePictureStep';
import ResumeStep from './steps/ResumeStep';
import QualificationsStep from './steps/QualificationsStep';
import JobPreferencesStep from './steps/JobPreferencesStep';
import RequirementsAcknowledgementStep from './steps/RequirementsAcknowledgementStep';
import MilestoneProgress from '../common/MilestoneProgress';
import EligibilityModal from '../../components/EligibilityModal';

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

const steps = ['Personal Info', 'Work Eligibility', 'Profile Picture', 'Resume', 'Qualifications', 'Preferences', 'Requirements'];

const Wizard: React.FC<WizardProps> = ({ tenantId, tenantSlug, tenantName, jobId, uid }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const navigate = useNavigate();
  
  
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
    // Only mark as prefilled after both userProfile AND posting have been processed
    if (!prefilledRef.current) {
      prefilledRef.current = true;
    }

    const address = userProfile.address || {};
    const personal = {
      firstName: userProfile.firstName || '',
      lastName: userProfile.lastName || '',
      email: userProfile.email || '',
      phone: userProfile.phone || '',
      dob: userProfile.dob || '',
      street: address.street || '',
      unit: address.unit || '',
      city: userProfile.city || address.city || '',
      state: userProfile.state || address.state || '',
      zip: userProfile.zipCode || address.zipCode || '',
      transportMethod: userProfile.transportMethod || '',
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

    // Requirements prefill from user profile
    const requirementsPrefill = {
      ...(formData.requirements || {}),
      drugScreeningComfort: userProfile.comfortablePassDrug || (formData.requirements || {}).drugScreeningComfort || '',
      drugExplanation: userProfile.passDrugExplanation || (formData.requirements || {}).drugExplanation || '',
      backgroundScreeningComfort: userProfile.comfortablePassBackground || (formData.requirements || {}).backgroundScreeningComfort || '',
      backgroundExplanation: userProfile.passBackgroundExplanation || (formData.requirements || {}).backgroundExplanation || '',
      additionalScreenings: {
        ...(formData.requirements || {}).additionalScreenings,
      },
      eVerifyComfort: userProfile.comfortableEVerify || (formData.requirements || {}).eVerifyComfort || '',
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

    // Persist prefill to draft if possible
    persist({ personal, eligibility, profilePicture, qualifications, preferences, requirements: requirementsPrefill });
  }, [userProfile, posting]);

  // Compute missing required items for Requirements step based on new card UX
  const computeMissing = () => {
    const req = (formData.requirements || {}) as any;
    const uploaded = (req.uploaded || {}) as Record<string, boolean>;
    const profileCerts: string[] = Array.isArray(userProfile?.certifications)
      ? userProfile.certifications.map((c: any) => (typeof c === 'string' ? c : c?.name)).filter(Boolean)
      : [];

    // 1) Certifications must be uploaded or already present on profile
    const missingCerts = (requirements.certifications || []).filter((name) => !profileCerts.includes(name) && !uploaded[name]);

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

    // 5) Additional screenings
    const addList: string[] = Array.isArray(posting?.additionalScreenings) ? posting.additionalScreenings : [];
    const addMap = (req.additionalScreenings || {}) as Record<string, string>;
    const missingAdditional = addList.filter((name) => !(addMap[name] && String(addMap[name]).length > 0));

    return {
      certs: missingCerts,
      drug: needsDrug && (!drugAnswered || drugNeedsExplanation),
      background: needsBackground && (!backgroundAnswered || backgroundNeedsExplanation),
      everify: needsEVerify && !eVerifyAnswered,
      additional: missingAdditional,
    } as const;
  };

  const missing = computeMissing();

  const persist = async (partial: any) => {
    setSaving(true);
    try {
      setFormData((prev: any) => ({ ...prev, ...partial }));
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
    try {
      if (uid) {
        const userRef = doc(db, 'users', uid);
        if (activeStep === 0) {
          // Personal Info → save name/email/phone/dob/address
          const p = formData.personal || {};
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
          if (p.transportMethod) update.transportMethod = String(p.transportMethod).trim();
          const addr: any = {};
          if (p.street) addr.street = String(p.street).trim();
          if (p.unit) addr.unit = String(p.unit).trim();
          if (p.city) addr.city = String(p.city).trim();
          if (p.state) addr.state = String(p.state).trim();
          if (p.zip) addr.zipCode = String(p.zip).trim();
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
              update['addressInfo.homeLat'] = Number(p.homeLat);
              update['addressInfo.homeLng'] = Number(p.homeLng);
            }
          }
          if (Object.keys(update).length > 1) {
            await updateDoc(userRef, update);
          }

          // If phone changed, enforce Twilio verification via modal
          const onlyDigits = (v: string) => (v || '').replace(/\D/g, '');
          if (onlyDigits(p.phone || '') !== onlyDigits(userProfile?.phone || '')) {
            setVerifyOpen(true);
            return; // pause progression until verification completes
          }
        } else if (activeStep === 1) {
          // Work Eligibility → save EEO fields
          const e = formData.eligibility || {};
          const update: any = { updatedAt: serverTimestamp() };
          if (typeof e.workAuthorized === 'boolean') update.workEligibility = !!e.workAuthorized;
          if (typeof e.requireSponsorship === 'boolean') update.requireSponsorship = !!e.requireSponsorship;
          if (e.gender !== undefined) update.gender = String(e.gender || '');
          if (e.veteranStatus !== undefined) update.veteranStatus = String(e.veteranStatus || '');
          if (e.disabilityStatus !== undefined) update.disabilityStatus = String(e.disabilityStatus || '');
          if (Object.keys(update).length > 1) {
            await updateDoc(userRef, update);
          }
        } else if (activeStep === 2) {
          // Profile Picture → save profile picture URL
          const p = formData.profilePicture || {};
          const update: any = { updatedAt: serverTimestamp() };
          if (p.profilePicture) update.avatar = p.profilePicture;
          if (Object.keys(update).length > 1) {
            await updateDoc(userRef, update);
          }
        } else if (activeStep === 4) {
          // Qualifications → save key arrays to profile
          const q = formData.qualifications || {};
          const update: any = { updatedAt: serverTimestamp() };
          if (Array.isArray(q.skills)) update.skills = q.skills;
          if (Array.isArray(q.certifications)) update.certifications = q.certifications;
          if (Array.isArray(q.languages)) update.languages = q.languages;
          if (Array.isArray(q.education)) update.education = q.education;
          if (Array.isArray(q.workHistory)) update.workHistory = q.workHistory;
          if (Object.keys(update).length > 1) await updateDoc(userRef, update);
        } else if (activeStep === 5) {
          // Preferences → persist to user profile under a nested preferences object
          const p = formData.preferences || {};
          const update: any = { updatedAt: serverTimestamp() };
          update.preferences = {
            targetPay: typeof p.targetPay === 'number' ? p.targetPay : null,
            shift: typeof p.shift === 'string' ? p.shift : '',
            availabilityNotes: typeof p.availabilityNotes === 'string' ? p.availabilityNotes : '',
            shiftPreferences: Array.isArray(p.shiftPreferences) ? p.shiftPreferences : [],
            industryPreferences: Array.isArray(p.industryPreferences) ? p.industryPreferences : [],
          };
          if (typeof p.availableToStartDate === 'string') {
            update.availableToStartDate = p.availableToStartDate;
          }
          // Also store flat fields for easy querying if needed
          if (Array.isArray(update.preferences.shiftPreferences)) {
            update['preferences.shiftPreferences'] = update.preferences.shiftPreferences;
          }
          if (Array.isArray(update.preferences.industryPreferences)) {
            update['preferences.industryPreferences'] = update.preferences.industryPreferences;
          }
          await updateDoc(userRef, update);
        } else if (activeStep === 6) {
          // Requirements → save screening responses to user profile
          const r = formData.requirements || {};
          const update: any = { updatedAt: serverTimestamp() };
          if (r.drugScreeningComfort) update.comfortablePassDrug = r.drugScreeningComfort;
          if (r.drugExplanation) update.passDrugExplanation = r.drugExplanation;
          if (r.backgroundScreeningComfort) update.comfortablePassBackground = r.backgroundScreeningComfort;
          if (r.backgroundExplanation) update.passBackgroundExplanation = r.backgroundExplanation;
          if (r.eVerifyComfort) update.comfortableEVerify = r.eVerifyComfort;
          
          // Save additional screenings with dynamic field names
          if (r.additionalScreenings && Array.isArray(posting?.additionalScreenings)) {
            posting.additionalScreenings.forEach((name: string) => {
              const key = `comfortableWith${name.replace(/[^a-zA-Z0-9]+/g,'')}`;
              if (r.additionalScreenings[name]) {
                update[key] = r.additionalScreenings[name];
              }
            });
          }
          
          if (Object.keys(update).length > 1) {
            await updateDoc(userRef, update);
          }
        }
      }
    } finally {
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
    if (!uid || !appId) return;
    setSaving(true);
    try {
      if (appId.startsWith('appDraft:')) {
        const existing = localStorage.getItem(appId);
        const parsed = existing ? JSON.parse(existing) : {};
        try { localStorage.setItem(appId, JSON.stringify({ ...parsed, status: 'submitted', submittedAt: Date.now() })); } catch {}
      } else {
        // Mark draft as submitted in tenants/{tenantId}/applicationDrafts
        const draftRef = doc(db, 'tenants', tenantId, 'applicationDrafts', appId);
        await updateDoc(draftRef, { status: 'submitted', submittedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      }

      // Merge selected profile fields into users/{uid}
      const userRef = doc(db, 'users', uid!);
      const personal = formData.personal || {};
      const eligibility = formData.eligibility || {};
      const profilePicture = formData.profilePicture || {};
      const quals = formData.qualifications || {};
      const languages = Array.isArray(quals.languages)
        ? quals.languages
        : [];
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
      if (languages.length) profileUpdate.languages = languages;
      if (certifications.length) profileUpdate.certifications = certifications;
      if (skills.length) profileUpdate.skills = skills;
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
      
      await updateDoc(userRef, profileUpdate);

      // Create final submitted application in tenants/{tenantId}/applications
      try {
        if (tenantId && uid && jobId) {
          const tidAppId = `${uid}_${jobId}`;
          const tRef = doc(db, 'tenants', tenantId, 'applications', tidAppId);
          await setDoc(tRef, {
            userId: uid,
            tenantId,
            jobId,
            status: 'submitted',
            submittedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            data: formData,
            applicant: {
              firstName: personal.firstName || null,
              lastName: personal.lastName || null,
              email: personal.email || null,
              phone: personal.phone || null,
            }
          }, { merge: true });
          
          // Prepare denormalized application data for quick lookups
          const applicationId = `${tenantId}_${jobId}`;
          const applicationQuickData: any = {
            applicationId: applicationId, // Include the application ID for reference
            jobId: jobId,
            jobTitle: posting?.jobTitle || posting?.postTitle || null,
            postTitle: posting?.postTitle || null,
            companyName: posting?.companyName || null,
            companyId: posting?.companyId || null, // CRM company ID from tenant subcollection
            jobPostId: posting?.jobPostId || null,
            payRate: posting?.payRate || null,
            status: 'submitted',
            appliedAt: serverTimestamp(),
            startDate: posting?.startDate || null,
            location: posting?.worksiteName || posting?.city || null,
            updatedAt: serverTimestamp()
          };
          
          // Add application ID to user's applicationIds array AND applicationData map
          await updateDoc(userRef, {
            applicationIds: arrayUnion(applicationId),
            [`applicationData.${applicationId}`]: applicationQuickData,
            updatedAt: serverTimestamp()
          });
          
          // Auto-add to user group if specified in job posting
          if (posting?.autoAddToUserGroup) {
            try {
              const userGroupRef = doc(db, 'tenants', tenantId, 'userGroups', posting.autoAddToUserGroup);
              // Add user ID to group's memberIds array
              await updateDoc(userGroupRef, {
                memberIds: arrayUnion(uid),
                updatedAt: serverTimestamp()
              });
              
              // Add group ID to user's userGroupIds array
              await updateDoc(userRef, {
                userGroupIds: arrayUnion(posting.autoAddToUserGroup)
              });
            } catch (groupErr) {
              console.error('Error adding user to group:', groupErr);
            }
          }
        }
      } catch (e) {
        console.error('Error saving application:', e);
      }
      
      // Clear saved step from localStorage after successful submission
      try {
        localStorage.removeItem(`${sessionKey}-step`);
      } catch (error) {
        console.warn('Failed to clear step from localStorage:', error);
      }
      setSubmitOpen(true);
      
      // Redirect to jobs board after successful submission
      setTimeout(() => {
        // Use tenant slug if available, fallback to c1
        const redirectPath = tenantSlug ? `/${tenantSlug}/jobs-board` : '/c1/jobs-board';
        navigate(redirectPath);
      }, 2000); // Wait 2 seconds to show the success message
    } finally {
      setSaving(false);
    }
  };

  const renderStep = () => {
    switch (activeStep) {
      case 0:
        return <PersonalInfoStep value={formData.personal || {}} onChange={(v) => persist({ personal: v })} />;
      case 1:
        return <WorkEligibilityStep value={formData.eligibility || {}} onChange={(v) => persist({ eligibility: v })} />;
      case 2:
        return <ProfilePictureStep value={formData.profilePicture || {}} onChange={(v) => persist({ profilePicture: v })} />;
      case 3:
        return <ResumeStep value={{ ...(formData.resume || {}), userId: uid || '' }} onChange={(v) => persist({ resume: v })} tenantId={tenantId} />;
      case 4:
        return (
          <QualificationsStep
            value={formData.qualifications || {}}
            onChange={(v) => persist({ qualifications: v })}
            context="application"
            tenantId={tenantId}
            jobId={jobId}
            jobPosting={posting}
          />
        );
      case 5:
        return <JobPreferencesStep value={formData.preferences || {}} onChange={(v) => persist({ preferences: v })} jobPosting={posting} />;
      case 6:
        return (
          <RequirementsAcknowledgementStep
            requirements={requirements}
            profile={userProfile}
            uid={uid || ''}
            value={formData.requirements || { acks: {}, uploaded: {} }}
            onChange={(v) => persist({ requirements: v })}
            jobPosting={posting}
          />
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
    'Job preferences',
    'Requirements'
  ];

  const personalValid = !!(
    formData?.personal?.firstName &&
    formData?.personal?.lastName &&
    formData?.personal?.email &&
    formData?.personal?.phone &&
    formData?.personal?.dob &&
    formData?.personal?.street &&
    formData?.personal?.city &&
    formData?.personal?.state &&
    formData?.personal?.zip &&
    formData?.personal?.transportMethod
  );

  // Require Twilio re-verification if phone differs from profile
  const phoneNeedsVerification = (() => {
    const newPhone = formData?.personal?.phone || '';
    const currentPhone = userProfile?.phone || '';
    if (!newPhone) return false;
    // Simple compare on digits only
    const onlyDigits = (v: string) => (v || '').replace(/\D/g, '');
    return onlyDigits(newPhone) !== onlyDigits(currentPhone);
  })();

  return (
    <Box sx={{ px: 0, py: 0 }}>
      {/* Job Details Header */}
      {posting && (
        <Box sx={{ px: 3, py: 2, backgroundColor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="h5" sx={{ fontWeight: 600, mb: 0.5 }}>
            {posting.jobTitle || posting.postTitle || 'Job Application'}
          </Typography>
          <Stack direction="row" spacing={2} alignItems="center">
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
      )}
      
      {/* Full-bleed sticky progress under top bar (no side spacing) */}
      <MilestoneProgress
        total={steps.length}
        completed={activeStep}
        labels={steps}
        sticky="top"
        onJump={undefined}
        sx={{ px: 2, py: 1 }}
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

      <Box sx={{ mt: 2, mb: 12, mx: 0, px: 0, py: 0 }}>
        {renderStep()}
      </Box>

      {/* Bottom content bar (fixed to bottom; 24px offset on md+, 0 on mobile) */}
      <Box
        sx={{
          position: 'fixed',
          // Use CSS var set by Layout for current drawer width if available; fallback to 64px collapsed width
          left: { xs: 0, md: 'calc(var(--drawer-width, 64px) + 32px)' },
          right: { xs: 0, md: 32 },
          bottom: { xs: 0, md: 24 },
          width: { xs: '100%', md: 'calc(100% - (var(--drawer-width, 64px) + 64px))' },
          bgcolor: 'background.paper',
          borderTop: 1,
          borderColor: 'divider',
          px: { xs: 2, md: 4 },
          py: 1.5,
          zIndex: (t) => t.zIndex.appBar,
          boxShadow: 1,
          borderTopLeftRadius: { xs: 0, md: 8 },
          borderBottomLeftRadius: { xs: 0, md: 8 },
          borderTopRightRadius: { xs: 0, md: 8 },
          borderBottomRightRadius: { xs: 0, md: 8 },
        }}
      >
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Button onClick={handleBack} disabled={activeStep === 0}>Back</Button>
          <Button
            variant="contained"
            onClick={activeStep === 6 ? handleSubmit : handleNext}
            disabled={
              (activeStep === 6 && (
                missing.certs.length > 0 || missing.drug || missing.background || missing.everify || missing.additional.length > 0
              )) ||
              (activeStep === 0 && (!personalValid || phoneNeedsVerification)) ||
              (activeStep === 1 && formData?.eligibility?.workAuthorized !== true) ||
              (activeStep === 4 && posting?.showExperience === true && !formData?.qualifications?.experienceSummary) ||
              saving
            }
          >
            {activeStep === 6 ? 'Submit Application' : 'Next'}
          </Button>
        </Stack>
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
            onClick={activeStep === 6 ? handleSubmit : handleNext}
            aria-label={activeStep === 6 ? 'Submit Application' : 'Next'}
            disabled={
              (activeStep === 6 && (
                missing.certs.length > 0 || missing.drug || missing.background || missing.everify || missing.additional.length > 0
              )) ||
              saving
            }
          >
            {activeStep === 6 ? 'Submit Application' : 'Next'}
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



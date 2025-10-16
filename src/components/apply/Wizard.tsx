import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Divider, Stack, Step, StepLabel, Stepper, Typography, Alert, Snackbar, LinearProgress, useMediaQuery, useTheme } from '@mui/material';
import { addDoc, collection, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
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
import ReviewSubmitStep from './steps/ReviewSubmitStep';
import MilestoneProgress from '../common/MilestoneProgress';
import EligibilityModal from '../../components/EligibilityModal';

type WizardProps = {
  tenantId: string;
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

const steps = ['Personal Info', 'Work Eligibility', 'Profile Picture', 'Resume', 'Qualifications', 'Preferences', 'Requirements', 'Review'];

const Wizard: React.FC<WizardProps> = ({ tenantId, tenantName, jobId, uid }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
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
        // Save under user to avoid tenant write restrictions for applicants
        const colRef = collection(db, 'users', uid, 'applicationDrafts');
        const docRef = await addDoc(colRef, draft as any);
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
        if (!tenantId || !jobId) return;
        const postRef = doc(db, 'tenants', tenantId, 'job_postings', jobId);
        const snap = await getDoc(postRef);
        if (!snap.exists()) return;
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
      } catch {
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

  // Prefill wizard from user profile once
  useEffect(() => {
    if (!userProfile || prefilledRef.current) return;
    prefilledRef.current = true;

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
    };

    const preferences = formData.preferences || {
      targetPay: '',
      shift: '',
      availabilityNotes: ''
    };

    // Persist prefill to draft if possible
    persist({ personal, eligibility, profilePicture, qualifications, preferences });
  }, [userProfile]);

  // Compute missing required items using profile + acknowledgements
  const computeMissing = () => {
    const acks = (formData.requirements && formData.requirements.acks) || {};
    const uploaded = (formData.requirements && formData.requirements.uploaded) || {};
    const profileCerts: string[] = Array.isArray(userProfile?.certifications)
      ? userProfile.certifications.map((c: any) => (typeof c === 'string' ? c : c?.name)).filter(Boolean)
      : [];

    // Certifications require actual upload or existing cert on profile; acknowledgements do not satisfy
    const missingCerts = (requirements.certifications || []).filter((name) => !profileCerts.includes(name) && !uploaded[name]);
    const missingScreenings = (requirements.screenings || []).filter((name) => !acks[name]);
    const missingPpe = (requirements.ppe || []).filter((name) => !acks[name]);
    const missingPhysical = (requirements.physical || []).filter((name) => !acks[name]);

    return {
      certs: missingCerts,
      screenings: missingScreenings,
      ppe: missingPpe,
      physical: missingPhysical,
    };
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
        const appRef = doc(db, 'users', uid!, 'applicationDrafts', appId);
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
        try { localStorage.setItem(appId, JSON.stringify({ ...parsed, status: 'submitted', submittedAt: Date.now(), submittedTenantId: tenantId, submittedJobId: jobId })); } catch {}
      } else {
        const appRef = doc(db, 'users', uid!, 'applicationDrafts', appId);
        await updateDoc(appRef, { status: 'submitted', submittedAt: serverTimestamp(), submittedTenantId: tenantId, submittedJobId: jobId });
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
      await updateDoc(userRef, profileUpdate);

      // Mark tenant application as submitted
      try {
        if (tenantId && (tenantAppId || (uid && jobId))) {
          const tidAppId = tenantAppId || `${uid}_${jobId}`;
          const tRef = doc(db, 'tenants', tenantId, 'applications', tidAppId);
          await updateDoc(tRef, { status: 'submitted', submittedAt: serverTimestamp(), updatedAt: serverTimestamp() });
        }
      } catch {}
      
      // Clear saved step from localStorage after successful submission
      try {
        localStorage.removeItem(`${sessionKey}-step`);
      } catch (error) {
        console.warn('Failed to clear step from localStorage:', error);
      }
      setSubmitOpen(true);
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
        return <QualificationsStep value={formData.qualifications || {}} onChange={(v) => persist({ qualifications: v })} />;
      case 5:
        return <JobPreferencesStep value={formData.preferences || {}} onChange={(v) => persist({ preferences: v })} />;
      case 6:
        return (
          <RequirementsAcknowledgementStep
            requirements={requirements}
            profile={userProfile}
            uid={uid || ''}
            value={formData.requirements || { acks: {}, uploaded: {} }}
            onChange={(v) => persist({ requirements: v })}
          />
        );
      case 7:
        return <ReviewSubmitStep value={formData} onSubmit={handleSubmit} submitting={saving} tenantName={tenantName} onEditStep={(i) => setActiveStep(i)} />;
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
    'Requirements',
    'Review & submit'
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
    formData?.personal?.zip
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
            onClick={handleNext}
            disabled={
              activeStep === steps.length - 1 ||
              (activeStep === 6 && (
                missing.certs.length > 0 || missing.screenings.length > 0 || missing.ppe.length > 0 || missing.physical.length > 0
              )) ||
              (activeStep === 0 && (!personalValid || phoneNeedsVerification)) ||
              (activeStep === 1 && formData?.eligibility?.workAuthorized !== true)
            }
          >
            Next
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
            onClick={handleNext}
            aria-label="Next"
            disabled={
              activeStep === steps.length - 1 ||
              (activeStep === 6 && (
                missing.certs.length > 0 || missing.screenings.length > 0 || missing.ppe.length > 0 || missing.physical.length > 0
              ))
            }
          >
            Next
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



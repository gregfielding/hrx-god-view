import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  Box,
  Button,
  Divider,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Typography,
  Alert,
  Snackbar,
  LinearProgress,
  useMediaQuery,
  useTheme,
  Paper,
  TextField,
  Backdrop,
  CircularProgress,
} from '@mui/material';
import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  deleteField,
} from 'firebase/firestore';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../../firebase';
import { updateEmail } from 'firebase/auth';
import { db } from '../../firebase';

import PersonalInfoStep from './steps/PersonalInfoStep';
import AddressStep from './steps/AddressStep';
import EVerifyComfortStep from './steps/EVerifyComfortStep';
import {
  getEffectiveJobOrderField,
  type JobOrderForEffectiveRead,
} from '../../shared/jobOrder/getEffectiveJobOrderField';
import WorkEligibilityStep from './steps/WorkEligibilityStep';
import { isWorkAuthCollectionDisabled } from '../../utils/workAuthCollectionFlag';
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
import { geocodeAddress, geocodeAddressDetailed } from '../../utils/geocodeAddress';
import {
  checkShiftDateConflict,
  checkMultipleShiftDateConflicts,
  extractDateFromShiftDate,
} from '../../utils/gigShiftApplicationLimits';
import {
  getDateScheduleEntriesWithHours,
  formatDayAndDate,
  type DateSchedule,
} from '../../utils/dateSchedule';
import { logJobApplicationActivity } from '../../utils/activityLogger';
import { updateUserSmartGroupOnApply } from '../../services/smartGroupService';
import { computeJobScoreSummary } from '../../utils/jobScore';
import { getRequirementPackV1 } from '../../data/jobRequirementPacksV1';
import { computeJobScoreSummaryV1 } from '../../utils/jobScoreV1';
import { getUserScore } from '../../utils/scoreSummary';
import { useT } from '../../i18n';
import { buildCanonicalWorkerProfileWritePatch } from '../../utils/workerReadinessWriteModel';
import { buildCanonicalHomeAddressFromWizardPersonal } from '../../utils/buildCanonicalHomeAddress';
import { autoAddUserToApplyConfiguredGroups } from '../../utils/applyWizardGroupAutoAdd';
import { isValidUsPhone10, normalizeUsPhoneDigits } from '../../utils/usPhoneValidation';
import { normalizeLast4SsnDigits, isEmptyOrValidLast4Ssn } from '../../utils/last4Ssn';
import { formatHourlyPayRateForDisplay } from '../../utils/hourlyPayDisplay';
import { mergeResolvedHiringInterview } from '../../utils/mergeResolvedHiringInterview';
import {
  applyHiringLifecycleTimestampMetadata,
  buildHiringLifecycleOnApplicationCreate,
} from '../../shared/hiringLifecyclePatch';
import { deriveProfileEligibilityForHiringLifecycle } from '../../shared/profileEligibilityForHiringLifecycle';
import {
  firestoreSafeHiringLifecycle,
  hiringLifecycleCoreFromApplicationData,
} from '../../utils/hiringLifecycleFirestoreHelpers';

type WizardProps = {
  tenantId: string;
  tenantSlug?: string;
  tenantName?: string;
  jobId?: string;
  uid: string | null;
  signupGroupId?: string | null;
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

// Normalize dob from Firestore (Timestamp), Date, or string to YYYY-MM-DD for validation and storage.
const toDobString = (val: unknown): string => {
  if (val == null || val === '') return '';
  if (typeof val === 'string') {
    const t = val.trim();
    if (t.length === 10 && t.includes('-')) return t;
    if (t.length === 10 && t.includes('/')) {
      const [month, day, year] = t.split('/');
      if (month && day && year && year.length === 4) return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    return t;
  }
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  if (typeof val === 'object' && val !== null && 'seconds' in val && typeof (val as { seconds: number }).seconds === 'number')
    return new Date((val as { seconds: number }).seconds * 1000).toISOString().slice(0, 10);
  if (typeof val === 'number') return new Date(val).toISOString().slice(0, 10);
  return '';
};

// Firestore does not allow `undefined` anywhere in a document (including nested objects).
// This helper removes undefined values deeply while preserving non-plain objects (Dates, Timestamps, FieldValue, etc).
const deepStripUndefined = (value: any): any => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value.map((v) => deepStripUndefined(v)).filter((v) => v !== undefined);
  }
  if (typeof value === 'object') {
    // Only recurse into plain objects
    const isPlainObject = value?.constructor === Object;
    if (!isPlainObject) return value;
    const out: any = {};
    for (const [k, v] of Object.entries(value)) {
      const cleanedV = deepStripUndefined(v);
      if (cleanedV !== undefined) out[k] = cleanedV;
    }
    return out;
  }
  return value;
};

const stepKeys = [
  'apply.stepPersonalInfo',
  'apply.stepAddress',
  'apply.stepResume',
  'apply.stepEVerifyComfort',
  'apply.stepWorkEligibility',
  'apply.stepProfilePicture',
  'apply.stepSkills',
  'apply.stepEducation',
  'apply.stepLicensesCertifications',
  'apply.stepWorkExperience',
  'apply.stepBio',
  'apply.stepPreferences',
  'apply.stepRequirements',
];
const detectDefaultLanguage = (): 'en' | 'es' => {
  if (typeof navigator === 'undefined') return 'en';
  return navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en';
};

const parseAuthDisplayName = (displayName: unknown): { firstName: string; lastName: string } => {
  const raw = typeof displayName === 'string' ? displayName.trim() : '';
  if (!raw) return { firstName: '', lastName: '' };
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
};

const normalizeToken = (value: unknown): string => String(value || '').trim().toLowerCase();

const valuesLooselyMatch = (left: string, right: string): boolean => {
  if (!left || !right) return false;
  const a = normalizeToken(left);
  const b = normalizeToken(right);
  return a === b || a.includes(b) || b.includes(a);
};

const toStringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((item) => {
          if (typeof item === 'string') return item.trim();
          if (item && typeof item === 'object' && 'name' in item) return String((item as any).name || '').trim();
          if (item && typeof item === 'object' && 'degree' in item) return String((item as any).degree || '').trim();
          return String(item || '').trim();
        })
        .filter(Boolean)
    : [];

const hasResumeData = (resume: any): boolean =>
  Boolean(
    resume?.fileName ||
      resume?.storagePath ||
      resume?.downloadUrl ||
      resume?.fileUrl ||
      resume?.resumeUrl ||
      resume?.parsed
  );

/** Skill labels from structured resume parse (same shapes as resumeParser `skills` array). */
function parsedResumeSkillNames(resume: any): string[] {
  const raw = resume?.parsed?.skills;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s: any) =>
      typeof s === 'string'
        ? String(s).trim()
        : String((s as any)?.name ?? (s as any)?.canonicalId ?? '').trim(),
    )
    .filter(Boolean);
}

const buildAdditionalScreeningCanonicalKey = (screeningName: string): string => {
  const compact = String(screeningName || '').replace(/[^a-zA-Z0-9]+/g, '');
  if (!compact) return '';
  return compact.charAt(0).toLowerCase() + compact.slice(1);
};

interface PostSubmitRedirectProps {
  to: string;
  delayMs: number;
  headlineKey: string;
  subheadKey: string;
  helperKey: string;
  applicationsPath: string;
  jobsBoardPath: string;
  t: (key: string, params?: Record<string, string | number>) => string;
}

/**
 * Post-apply success screen with auto-redirect to payroll setup.
 *
 * Worker UX: a fresh applicant typically gets auto-hired by the userGroup
 * trigger (`onApplicationHiringSignalsChangedAutoOnboard` /
 * `onUserGroupMemberAddedAutoOnboard`) ~500ms-2s after submit, which then
 * spins up Everee provisioning. The 3-second delay here is sized to land
 * AFTER that pipeline completes for most workers, so when this redirects
 * to `/c1/workers/payroll` the index page resolves to the embed instead
 * of "no payroll account yet".
 *
 * For the rare slow path (Everee provisioning >3s, or no Everee at all),
 * `WorkerPayrollIndex` already renders a graceful fallback with a "Back
 * to dashboard" CTA — so this redirect is safe to fire unconditionally.
 *
 * The pre-deadline alternative (static "View applications / Browse jobs"
 * paper) is preserved as secondary text-link affordances at the bottom in
 * case the worker wants to bail mid-redirect.
 */
const PostSubmitRedirect: React.FC<PostSubmitRedirectProps> = ({
  to,
  delayMs,
  headlineKey,
  subheadKey,
  helperKey,
  applicationsPath,
  jobsBoardPath,
  t,
}) => {
  const navigate = useNavigate();
  const [redirected, setRedirected] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setRedirected(true);
      navigate(to);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [to, delayMs, navigate]);

  return (
    <Paper
      elevation={0}
      sx={{
        maxWidth: 480,
        mx: 'auto',
        mt: { xs: 4, md: 6 },
        p: 3,
        textAlign: 'center',
      }}
    >
      <Typography variant="h6" sx={{ mb: 1, fontWeight: 600 }}>
        {t(headlineKey)}
      </Typography>
      <Box
        sx={{
          mt: 2,
          mb: 2,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 1.5,
        }}
      >
        <CircularProgress size={28} />
        <Typography variant="body2" color="text.secondary">
          {t(subheadKey)}
        </Typography>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
        {t(helperKey)}
      </Typography>
      <Stack direction="row" spacing={2} justifyContent="center" sx={{ mt: 1 }}>
        <Button
          variant="text"
          size="small"
          disabled={redirected}
          onClick={() => navigate(applicationsPath)}
        >
          {t('apply.viewMyApplications')}
        </Button>
        <Button
          variant="text"
          size="small"
          disabled={redirected}
          onClick={() => navigate(jobsBoardPath)}
        >
          {t('apply.browseMoreJobs')}
        </Button>
      </Stack>
    </Paper>
  );
};

/**
 * Apply-wizard home-address gate. An address counts as valid when it is complete
 * (street/city/state/zip) AND geocoded to valid coordinates (homeLat/homeLng) —
 * matching the `addressComplete` rule the wizard uses to skip the address step
 * for returning users. We deliberately do NOT require a Google `placeId`: a
 * worker whose address is already on file (geocoded, no placeId persisted) must
 * not be blocked. On the AddressStep itself, free-typed text clears the
 * coordinates, so a NEW entry still has to be picked from the Google dropdown
 * (which geocodes it) to pass — the cause of new users landing without an
 * address. Shared by the Next-button gate, `handleNext`, and the submit backstop.
 */
export function isApplyHomeAddressValid(personal: any): boolean {
  const str = (v: unknown): string => (typeof v === 'string' ? v : String(v ?? '')).trim();
  const street = str(personal?.street);
  const city = str(personal?.city);
  const state = str(personal?.state);
  const zip = str(personal?.zip);
  const homeLat = personal?.homeLat;
  const homeLng = personal?.homeLng;
  if (!street || !city || !state || !zip) return false;
  if (homeLat === undefined || homeLng === undefined) return false;
  if (
    typeof homeLat !== 'number' ||
    typeof homeLng !== 'number' ||
    isNaN(homeLat) ||
    isNaN(homeLng) ||
    homeLat < -90 ||
    homeLat > 90 ||
    homeLng < -180 ||
    homeLng > 180
  ) {
    return false;
  }
  return true;
}

const Wizard: React.FC<WizardProps> = ({ tenantId, tenantSlug, tenantName, jobId, uid, signupGroupId = null }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const t = useT();
  const allStepLabels = stepKeys.map((k) => t(k));
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

  // Career-only: which of the JO's 2+ open shifts the applicant said they want
  // (see JobPostingDetail.tsx's careerOpenShifts picker). Informational only —
  // unlike selectedShifts above, it carries no day/spot-limit semantics.
  const preferredShiftId = useMemo(() => {
    return searchParams.get('preferredShift') || null;
  }, [searchParams]);

  // Apply date (YYYY-MM-DD) when worker applied for a specific day of a multi-day gig (from jobs board Apply button)
  const applyDateFromUrl = useMemo(() => {
    const d = searchParams.get('applyDate');
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  }, [searchParams]);

  const baseSessionKey = `${tenantId || 'na'}-${jobId || 'na'}`;
  const sessionIdStorageKey = `app-wizard-session-id:${baseSessionKey}`;
  const [clientSessionId] = useState(() => {
    try {
      const existing = localStorage.getItem(sessionIdStorageKey);
      if (existing) return existing;
      const newId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem(sessionIdStorageKey, newId);
      return newId;
    } catch {
      return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }
  });
  const stepStorageKey = `app-wizard-step:${baseSessionKey}:${clientSessionId}`;
  const formStorageKey = `app-wizard-data:${baseSessionKey}:${clientSessionId}`;

  // Create a unique key for this application session (used for draft ids later)

  // Initialize activeStep from query param, localStorage, or default to 0
  const [activeStep, setActiveStep] = useState(() => {
    try {
      // Check for step query parameter first (for jumping to certifications step)
      const stepParam = searchParams.get('step');
      if (stepParam) {
        const stepNum = parseInt(stepParam, 10);
        if (!isNaN(stepNum) && stepNum >= 0 && stepNum < stepKeys.length) {
          return stepNum;
        }
      }
      // Fallback to localStorage
      const saved = localStorage.getItem(stepStorageKey);
      return saved ? parseInt(saved, 10) : 0;
    } catch {
      return 0;
    }
  });
  const [saving, setSaving] = useState(false);
  const [appId, setAppId] = useState<string | null>(null);
  const [formData, setFormData] = useState<any>(() => {
    try {
      const saved = localStorage.getItem(formStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
      }
    } catch (error) {
      console.warn('Failed to load saved wizard data:', error);
    }
    return {};
  });
  const formDataRef = useRef(formData);
  useEffect(() => {
    formDataRef.current = formData;
  }, [formData]);
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
  /** When hiring entity is C1 Events LLC, workers are independent contractors; skip Work Eligibility step and treat as eligible. */
  const [hiringEntityName, setHiringEntityName] = useState<string | null>(null);
  const prefilledRef = useRef(false);
  const personalPrefilledRef = useRef(false);
  const [tenantAppId, setTenantAppId] = useState<string | null>(null);
  const [stepRestored, setStepRestored] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [hasMissingRequiredCerts, setHasMissingRequiredCerts] = useState(false);
  const [submittedSuccess, setSubmittedSuccess] = useState(false);
  const [shiftSummaryData, setShiftSummaryData] = useState<{
    dateLabel: string;
    timeLabel: string;
    pay: string;
    location: string;
  } | null>(null);

  // Step indices: 2 = Resume (after address); 3 = E-Verify comfort (generic /c1/apply only; job applies use requirements when eVerifyRequired).
  const visibleStepIndices = useMemo(() => {
    const all = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    let indices = jobId ? all.filter((i) => i !== 3) : [...all];

    if (hiringEntityName && /C1 Events LLC/i.test(hiringEntityName)) {
      indices = indices.filter((i) => i !== 4);
    }
    if (posting?.jobType === 'gig') {
      indices = indices.filter((i) => i !== 11);
    }

    const isAuthenticated = Boolean(auth.currentUser?.uid || uid);
    const profile = userProfile || {};
    const personal = formData?.personal || {};
    const eligibility = formData?.eligibility || {};
    const qualifications = formData?.qualifications || {};
    const profilePicture = formData?.profilePicture || {};
    const resume = formData?.resume || {};
    const requirementsForm = (formData?.requirements || {}) as Record<string, any>;

    const parsedResume = resume?.parsed;
    const resumeParsedObj =
      parsedResume && typeof parsedResume === 'object' && !Array.isArray(parsedResume)
        ? Object.keys(parsedResume as object).length > 0
        : Array.isArray(parsedResume)
          ? parsedResume.length > 0
          : false;
    const parsedEduLen = Array.isArray((parsedResume as any)?.education)
      ? (parsedResume as any).education.length
      : 0;
    const parsedCertLen = Array.isArray((parsedResume as any)?.certifications)
      ? (parsedResume as any).certifications.length
      : 0;
    const parsedExperienceArr = (parsedResume as any)?.experience ?? (parsedResume as any)?.workHistory;
    const parsedExpLen = Array.isArray(parsedExperienceArr) ? parsedExperienceArr.length : 0;

    const hasValue = (v: unknown) => String(v || '').trim().length > 0;

    const personalComplete = Boolean(
      String(personal.firstName || profile.firstName || '').trim() &&
        String(personal.lastName || profile.lastName || '').trim() &&
        String(personal.email || profile.email || '').trim() &&
        String(personal.phone || profile.phone || profile.phoneE164 || '').trim() &&
        String(personal.dob || profile.dob || profile.dateOfBirth || '').trim()
    );
    if (isAuthenticated && personalComplete) indices = indices.filter((i) => i !== 0);

    const homeLat =
      personal.homeLat ??
      profile.addressInfo?.homeLat ??
      profile.homeLat;
    const homeLng =
      personal.homeLng ??
      profile.addressInfo?.homeLng ??
      profile.homeLng;
    const addressComplete = Boolean(
      String(personal.street || profile.addressInfo?.streetAddress || '').trim() &&
        String(personal.city || profile.city || profile.addressInfo?.city || '').trim() &&
        String(personal.state || profile.state || profile.addressInfo?.state || '').trim() &&
        String(personal.zip || profile.zipCode || profile.addressInfo?.zip || '').trim() &&
        homeLat !== undefined &&
        homeLng !== undefined
    );
    if (isAuthenticated && addressComplete) indices = indices.filter((i) => i !== 1);

    if (!jobId && isAuthenticated && hasValue(requirementsForm.eVerifyComfort)) {
      indices = indices.filter((i) => i !== 3);
    }

    // W.3 — when the work-auth collection flag is on (default), step 4
    // is auto-skipped for every entity, every user. The data is sourced
    // from W.1's server-side mirror (Everee I-9 for W-2, federal
    // contractor rule for 1099) so the wizard doesn't need to ask. The
    // pre-W.3 conditional skip (C1 Events contractor + already-authorized)
    // is preserved for the rollback path (flag off).
    const workAuthCollectionDisabled = isWorkAuthCollectionDisabled();
    const workAuthComplete =
      workAuthCollectionDisabled ||
      /C1 Events LLC/i.test(String(hiringEntityName || '')) ||
      Boolean(eligibility.workAuthorized ?? profile.workEligibility);
    if ((isAuthenticated || workAuthCollectionDisabled) && workAuthComplete) {
      indices = indices.filter((i) => i !== 4);
    }

    const hasProfilePhoto = Boolean(
      profilePicture.profilePicture || profile.workerProfile?.photoUrl || profile.avatar
    );
    if (hasProfilePhoto) indices = indices.filter((i) => i !== 5);

    const hasResume = hasResumeData(resume) || hasResumeData(profile.resume) || Boolean(profile.resumeUrl);
    if (hasResume) indices = indices.filter((i) => i !== 2);

    const requiredSkills = toStringList(
      posting?.skills ||
        posting?.skillsRequired ||
        posting?.requiredSkills ||
        posting?.requirements?.skills ||
        posting?.scoping?.skills
    );
    const userSkills = toStringList(qualifications.skills || profile.skills);
    const parsedSkillNamesForStep = parsedResumeSkillNames(resume);
    const missingRequiredSkills = requiredSkills.filter(
      (requiredSkill) =>
        !userSkills.some((userSkill) => valuesLooselyMatch(userSkill, requiredSkill)) &&
        !parsedSkillNamesForStep.some((p) => valuesLooselyMatch(p, requiredSkill))
    );
    // No required skills on posting → optional step hidden (low-skill / general labor). If job lists skills, match via profile, form, or parsed résumé.
    const skillsComplete =
      requiredSkills.length === 0 || missingRequiredSkills.length === 0;
    if (skillsComplete) indices = indices.filter((i) => i !== 6);

    const requiredEducation = toStringList(
      posting?.educationLevels ||
        posting?.educationRequired ||
        posting?.requirements?.education ||
        posting?.jobOrder?.educationRequired
    );
    const userEducation = toStringList(qualifications.education || profile.education);
    const educationComplete =
      requiredEducation.length === 0 ||
      requiredEducation.every((requiredEdu) =>
        userEducation.some((userEdu) => valuesLooselyMatch(userEdu, requiredEdu))
      );
    if (
      educationComplete ||
      (resumeParsedObj && parsedEduLen > 0 && requiredEducation.length === 0)
    ) {
      indices = indices.filter((i) => i !== 7);
    }

    const requiredCertifications = toStringList(
      posting?.licensesCerts ||
        posting?.requiredCertifications ||
        posting?.requirements?.certifications
    );
    const userCertifications = toStringList(qualifications.certifications || profile.certifications);
    const certificationsComplete =
      requiredCertifications.length === 0 ||
      requiredCertifications.every((requiredCert) =>
        userCertifications.some((userCert) => valuesLooselyMatch(userCert, requiredCert))
      );
    if (
      certificationsComplete ||
      (resumeParsedObj && parsedCertLen > 0 && requiredCertifications.length === 0)
    ) {
      indices = indices.filter((i) => i !== 8);
    }

    const requiresExperience = Boolean(
      posting?.yearsOfExperience ||
        posting?.experienceYears ||
        (Array.isArray(posting?.experienceLevels) && (posting?.experienceLevels?.length ?? 0) > 0) ||
        (Array.isArray(posting?.requiredExperienceLevels) &&
          (posting?.requiredExperienceLevels?.length ?? 0) > 0) ||
        posting?.experienceRequired ||
        posting?.jobOrder?.experienceRequired
    );
    const hasWorkHistory = toStringList(
      qualifications.workExperience ||
        qualifications.workHistory ||
        profile.workExperience ||
        profile.workHistory
    ).length > 0;
    if (!requiresExperience || hasWorkHistory || (resumeParsedObj && parsedExpLen > 0)) {
      indices = indices.filter((i) => i !== 9);
    }

    const professionalBioText = String(
      (formData.bio || {}).professionalBio || profile.professionalBio || ''
    ).trim();
    if (professionalBioText.length > 0) indices = indices.filter((i) => i !== 10);

    const prefsForm = formData.preferences || {};
    const prefsProfile = profile.preferences || {};
    const preferencesCaptured =
      (typeof prefsForm.targetPay === 'number' && !Number.isNaN(prefsForm.targetPay)) ||
      (typeof prefsForm.shift === 'string' && prefsForm.shift.trim().length > 0) ||
      (Array.isArray(prefsForm.shiftPreferences) && prefsForm.shiftPreferences.length > 0) ||
      (typeof prefsForm.availableToStartDate === 'string' &&
        prefsForm.availableToStartDate.trim().length > 0) ||
      (typeof prefsForm.availabilityNotes === 'string' &&
        prefsForm.availabilityNotes.trim().length > 0) ||
      (typeof prefsProfile.targetPay === 'number' && !Number.isNaN(prefsProfile.targetPay)) ||
      (typeof prefsProfile.shift === 'string' && prefsProfile.shift.trim().length > 0) ||
      (Array.isArray(prefsProfile.shiftPreferences) && prefsProfile.shiftPreferences.length > 0);
    if (posting?.jobType !== 'gig' && preferencesCaptured) {
      indices = indices.filter((i) => i !== 11);
    }

    const needsDrug = Boolean(posting?.showDrugScreening || posting?.drugScreeningRequired);
    const needsBackground = Boolean(posting?.showBackgroundChecks || posting?.backgroundCheckRequired);
    const needsEVerifyOnPosting = Boolean(posting?.eVerifyRequired);
    const additionalScreenings = Array.isArray(posting?.additionalScreenings) ? posting.additionalScreenings : [];
    const showAdditional = Boolean(posting?.showAdditionalScreenings) && additionalScreenings.length > 0;
    const requiredLanguages = toStringList(posting?.languages || (requirements as any).languages);
    const requiredPhysical = toStringList(posting?.physicalRequirements || requirements.physical);
    const requiredUniform = toStringList(posting?.uniformRequirements);
    const requiredPpe = toStringList(posting?.requiredPpe || posting?.ppeRequirements || requirements.ppe);
    const customUniformText = String(posting?.customUniformRequirements || '').trim();
    const missingAdditional = showAdditional
      ? additionalScreenings.some((name) => !hasValue(requirementsForm?.additionalScreenings?.[name]))
      : false;
    const needsRequirementsStep =
      (needsDrug &&
        (!hasValue(requirementsForm.drugScreeningComfort) ||
          (requirementsForm.drugScreeningComfort === 'Maybe' && !hasValue(requirementsForm.drugExplanation)))) ||
      (needsBackground &&
        (!hasValue(requirementsForm.backgroundScreeningComfort) ||
          (requirementsForm.backgroundScreeningComfort === 'Maybe' &&
            !hasValue(requirementsForm.backgroundExplanation)))) ||
      (needsEVerifyOnPosting && !hasValue(requirementsForm.eVerifyComfort)) ||
      missingAdditional ||
      ((posting?.showLanguages || requiredLanguages.length > 0) && !hasValue(requirementsForm.languagesComfort)) ||
      ((posting?.showPhysicalRequirements || requiredPhysical.length > 0) &&
        !hasValue(requirementsForm.physicalRequirementsComfort)) ||
      ((posting?.showUniformRequirements || requiredUniform.length > 0) &&
        !hasValue(requirementsForm.uniformRequirementsComfort)) ||
      ((posting?.showCustomUniformRequirements || customUniformText.length > 0) &&
        !hasValue(requirementsForm.customUniformRequirementsComfort)) ||
      ((posting?.showRequiredPpe || requiredPpe.length > 0) && !hasValue(requirementsForm.requiredPpeComfort)) ||
      !hasValue(requirementsForm.transportMethod);
    if (!needsRequirementsStep) indices = indices.filter((i) => i !== 12);

    if (indices.length === 0) {
      indices = [12];
    }
    return indices;
  }, [posting, hiringEntityName, userProfile, formData, uid, requirements, auth.currentUser?.uid, jobId]);

  const actualStep = visibleStepIndices[Math.min(activeStep, visibleStepIndices.length - 1)] ?? 0;
  const isLastVisibleStep = activeStep === visibleStepIndices.length - 1;

  // Grouped progress: Getting started (0-5 incl. resume, everify, work auth, photo), Qualifications (6-8), Experience (9-10), Prefs (11), Final (12)
  const progressGroupIndex = (step: number) =>
    step <= 5 ? 0 : step <= 8 ? 1 : step <= 10 ? 2 : step === 11 ? 3 : 4;
  const progressGroupLabels = [
    t('apply.progressPersonal'),
    t('apply.progressSkills'),
    t('apply.progressExperience'),
    t('apply.progressVerification'),
    t('apply.progressFinal'),
  ];
  const progressCompleted = progressGroupIndex(actualStep);
  const progressTotal = 5;
  const steps = progressGroupLabels;

  // Clamp activeStep when visible steps shrink (e.g. posting loads and we skip Preferences)
  useEffect(() => {
    if (activeStep >= visibleStepIndices.length) {
      setActiveStep(Math.max(0, visibleStepIndices.length - 1));
      try {
        localStorage.setItem(stepStorageKey, String(Math.max(0, visibleStepIndices.length - 1)));
      } catch {}
    }
  }, [visibleStepIndices.length, activeStep, stepStorageKey]);

  // An UNauthenticated worker must start at the Personal Info step (step 0)
  // so the account is created there. A saved step (localStorage) or ?step=
  // param must never drop them past it — otherwise they reach the final step
  // with no account and get stuck on "complete the Personal Info step"
  // (reported live: workers stuck at the headshot step). Gate on
  // onAuthStateChanged so this only fires once auth has RESOLVED as logged
  // out — never resetting a genuinely-authenticated worker mid auth-restore.
  useEffect(() => {
    const unsub = auth.onAuthStateChanged((u) => {
      if (!u && !uid) {
        setActiveStep((prev) => (prev > 0 ? 0 : prev));
      }
    });
    return () => unsub();
  }, [uid]);

  // Check if step was restored from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(stepStorageKey);
      if (saved && parseInt(saved, 10) > 0) {
        setStepRestored(true);
      }
    } catch (error) {
      console.warn('Failed to check saved step:', error);
    }
  }, [stepStorageKey]);

  // Persist form data locally for resilience across reloads/unmounts
  useEffect(() => {
    try {
      localStorage.setItem(formStorageKey, JSON.stringify(formDataRef.current || {}));
    } catch (error) {
      console.warn('Failed to persist wizard form data:', error);
    }
  }, [formStorageKey]);

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
        data: {},
      };
      // In local dev, avoid Firestore writes that may be blocked by rules; use localStorage draft instead
      try {
        const isLocalDev =
          typeof window !== 'undefined' &&
          window.location.hostname === 'localhost' &&
          process.env.NODE_ENV === 'development';
        if (isLocalDev) {
          const key = `appDraft:${uid}:${tenantId || 'na'}:${jobId || 'na'}`;
          try {
            localStorage.setItem(
              key,
              JSON.stringify({ ...draft, createdAt: Date.now(), updatedAt: Date.now() }),
            );
          } catch {}
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
        try {
          localStorage.setItem(
            key,
            JSON.stringify({ ...draft, createdAt: Date.now(), updatedAt: Date.now() }),
          );
        } catch {}
        setAppId(key);
      }

      // Mirror to tenant applications (best-effort) so recruiters can see in-progress
      try {
        const isLocalDev =
          typeof window !== 'undefined' &&
          window.location.hostname === 'localhost' &&
          process.env.NODE_ENV === 'development';
        if (!isLocalDev && tenantId && jobId && uid) {
          const tidAppId = `${uid}_${jobId}`;
          const tRef = doc(db, 'tenants', tenantId, 'applications', tidAppId);
          const { hiringLifecycle: hlInProgress } = buildHiringLifecycleOnApplicationCreate({
            applicationStatus: 'in_progress',
            aiPrescreenInterviewRequired: false,
            profileEligible: true,
          });
          const hiringLifecycleInProgress = applyHiringLifecycleTimestampMetadata({
            core: hlInProgress,
            previous: null,
            nowIso: new Date().toISOString(),
          });
          await setDoc(
            tRef,
            {
              status: 'in_progress',
              userId: uid,
              jobId,
              appliedAt: serverTimestamp(),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              hiringLifecycle: firestoreSafeHiringLifecycle(hiringLifecycleInProgress),
            },
            { merge: true },
          );
          setTenantAppId(tidAppId);
        }
      } catch {}
    };
    createDraft();
  }, [tenantId, jobId, uid, appId]);

  // Load job posting requirements (fallback merges can be added later)
  useEffect(() => {
    const jobOrderIdOverride = (() => {
      try {
        const params = new URLSearchParams(window.location.search);
        const v = params.get('jobOrderId');
        return v && v.trim() ? v.trim() : null;
      } catch {
        return null;
      }
    })();

    const loadPosting = async () => {
      try {
        if (!tenantId || !jobId) {
          return;
        }
        // Primary: job_postings/{jobId} (normal case)
        let data: any | null = null;
        try {
          const postRef = doc(db, 'tenants', tenantId, 'job_postings', jobId);
          const snap = await getDoc(postRef);
          if (snap.exists()) data = snap.data() as any;
        } catch {}

        // Fallback: if jobId is actually a jobOrderId, find a posting by jobOrderId
        if (!data) {
          try {
            const q = query(
              collection(db, 'tenants', tenantId, 'job_postings'),
              where('jobOrderId', '==', jobId),
              limit(1),
            );
            const qsnap = await getDocs(q);
            if (!qsnap.empty) {
              data = qsnap.docs[0].data() as any;
            }
          } catch {}
        }

        // Last resort: job order doc (still allows saving the application with a jobOrderId)
        if (!data) {
          try {
            const joRef = doc(db, 'tenants', tenantId, 'job_orders', jobId);
            const joSnap = await getDoc(joRef);
            if (joSnap.exists()) {
              const jo = joSnap.data() as any;
              // R.16.2a — public apply flow honours the activation snapshot
              // for non-draft JOs (a worker applying after the parent
              // account changed `hiringEntityId` still lands on the
              // entity captured at activation). Fallback preserves the
              // legacy live read for drafts and pre-§16.1 active JOs.
              const { value: snapHiring } = getEffectiveJobOrderField<string | null>(
                jo as JobOrderForEffectiveRead,
                'hiringEntityId',
                { fallback: jo.hiringEntityId ?? null },
              );
              data = {
                jobOrderId: jobId,
                hiringEntityId: (snapHiring as string | null) ?? null,
                jobTitle: jo.jobTitle || jo.jobOrderName || jo.name || 'Job',
                postTitle: jo.jobOrderName || jo.name || jo.jobTitle || 'Job',
                jobType: jo.jobType || 'career',
                companyId: jo.companyId,
                worksiteId: jo.worksiteId,
                worksiteName: jo.locationName || jo.worksiteName,
                city: jo.city,
                state: jo.state,
                payRate: jo.payRate,
                startDate: jo.startDate,
                endDate: jo.endDate,
                eVerifyRequired: !!(jo.eVerifyRequired ?? jo.everifyRequired),
              };
            }
          } catch {}
        }

        if (!data) return;

        const merged = {
          licenses: Array.isArray(data?.licensesCerts) ? data.licensesCerts.filter(Boolean) : [],
          certifications: Array.isArray(data?.licensesCerts)
            ? data.licensesCerts.filter(Boolean)
            : [],
          screenings: [
            ...(Array.isArray(data?.drugScreeningPanels) ? data.drugScreeningPanels : []),
            ...(Array.isArray(data?.backgroundCheckPackages) ? data.backgroundCheckPackages : []),
            ...(Array.isArray(data?.additionalScreenings) ? data.additionalScreenings : []),
            ...(data?.eVerifyRequired ? ['E-Verify'] : []),
          ].filter(Boolean),
          ppe: Array.isArray(data?.requiredPpe) ? data.requiredPpe.filter(Boolean) : [],
          physical: Array.isArray(data?.physicalRequirements)
            ? data.physicalRequirements.filter(Boolean)
            : [],
        };
        setRequirements(merged);
        setPosting({
          ...data,
          // Ensure jobOrderId can be carried from the Jobs Board link even if the posting doc is missing it.
          ...(jobOrderIdOverride && !data?.jobOrderId ? { jobOrderId: jobOrderIdOverride } : {}),
        });

        // Prefill preferences from posting if empty
        setFormData((prev: any) => {
          const next = { ...prev };
          if (!next.preferences) {
            next.preferences = {
              targetPay: typeof data?.payRate === 'number' ? data.payRate : '',
              shift: Array.isArray(data?.shift) && data.shift.length ? data.shift[0] : '',
              availabilityNotes: '',
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

  // Resolve hiring entity name (for skipping Work Eligibility when C1 Events LLC / independent contractors)
  useEffect(() => {
    let cancelled = false;
    const resolve = async () => {
      if (!tenantId || !posting) {
        setHiringEntityName(null);
        return;
      }
      let entityId: string | null = posting.hiringEntityId ?? null;
      if (!entityId && (posting.jobOrderId || jobId)) {
        try {
          const joRef = doc(db, 'tenants', tenantId, 'job_orders', posting.jobOrderId || jobId);
          const joSnap = await getDoc(joRef);
          if (joSnap.exists() && !cancelled) {
            // R.16.2a — second JO read in the apply wizard (entity-name
            // resolution for the C1-Events skip path). Same precedence:
            // snapshot wins for non-draft JOs, fallback preserves the
            // legacy live read.
            const jo = joSnap.data() as any;
            const { value: snapHiring } = getEffectiveJobOrderField<string | null>(
              jo as JobOrderForEffectiveRead,
              'hiringEntityId',
              { fallback: jo?.hiringEntityId ?? null },
            );
            entityId = (snapHiring as string | null) ?? null;
          }
        } catch {
          if (!cancelled) setHiringEntityName(null);
          return;
        }
      }
      if (!entityId) {
        if (!cancelled) setHiringEntityName(null);
        return;
      }
      try {
        const entityRef = doc(db, 'tenants', tenantId, 'entities', entityId);
        const entitySnap = await getDoc(entityRef);
        if (!cancelled) setHiringEntityName(entitySnap.exists() ? (entitySnap.data() as any)?.name ?? null : null);
      } catch {
        if (!cancelled) setHiringEntityName(null);
      }
    };
    resolve();
    return () => { cancelled = true; };
  }, [tenantId, jobId, posting]);

  /** EEO section is skippable for general/group apply and for C1 Events jobs; not skippable for C1 Workforce or C1 Select. */
  const eeoSkippable = useMemo(() => {
    if (!jobId) return true; // general /apply or group application
    if (!hiringEntityName) return true; // job but entity unknown — allow skip
    if (/C1 (Workforce|Select)/i.test(hiringEntityName)) return false;
    return true; // C1 Events or other entities
  }, [jobId, hiringEntityName]);

  // Load shift summary for final step card (when on requirements step and have posting)
  useEffect(() => {
    if (!posting || actualStep !== 12) {
      setShiftSummaryData(null);
      return;
    }
    let cancelled = false;
    const jobOrderId = posting.jobOrderId || jobId;
    const pay = formatHourlyPayRateForDisplay(posting.payRate) || '';
    const location =
      posting.worksiteName ||
      (posting.city && posting.state ? `${posting.city}, ${posting.state}` : '') ||
      posting.city ||
      posting.state ||
      '';

    if (posting.jobType === 'gig' && selectedShifts.length > 0 && tenantId && jobOrderId) {
      const shiftId = selectedShifts[0];
      const shiftRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId, 'shifts', shiftId);
      getDoc(shiftRef).then((snap) => {
        if (cancelled || !snap.exists()) {
          if (!cancelled) setShiftSummaryData({ dateLabel: '', timeLabel: '', pay, location });
          return;
        }
        const shiftData = snap.data() as any;
        const shiftDate = extractDateFromShiftDate(shiftData.shiftDate) || '';
        const endDate = shiftData.endDate
          ? (typeof shiftData.endDate === 'string'
              ? shiftData.endDate.split('T')[0]
              : null) || shiftDate
          : shiftDate;
        const dateSchedule = (shiftData.dateSchedule || {}) as DateSchedule;
        const entries = getDateScheduleEntriesWithHours(dateSchedule, shiftDate, endDate);
        const first = entries[0];
        const dateLabel = first ? formatDayAndDate(first.date) : formatDayAndDate(shiftDate) || '';
        const timeLabel = first
          ? `${formatTime(first.startTime)} – ${formatTime(first.endTime)}`
          : '';
        if (!cancelled)
          setShiftSummaryData({ dateLabel, timeLabel, pay, location });
      });
    } else {
      const startDate = posting.startDate;
      const dateLabel =
        startDate && typeof startDate === 'string'
          ? formatDayAndDate(startDate.split('T')[0])
          : '';
      setShiftSummaryData({ dateLabel, timeLabel: '', pay, location });
    }
    return () => { cancelled = true; };
  }, [posting, actualStep, selectedShifts, tenantId, jobId]);

  function formatTime(hhmm: string): string {
    if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return hhmm || '';
    const [hh, mm] = hhmm.split(':').map(Number);
    const hour = hh % 12 || 12;
    const ampm = hh >= 12 ? 'PM' : 'AM';
    return `${hour}:${String(mm).padStart(2, '0')} ${ampm}`;
  }

  // Load user profile for validation
  useEffect(() => {
    const loadUser = async () => {
      try {
        const effectiveUid = uid || auth.currentUser?.uid;
        if (!effectiveUid) return;
        const uref = doc(db, 'users', effectiveUid);
        const usnap = await getDoc(uref);
        if (usnap.exists()) setUserProfile(usnap.data());
      } catch {}
    };
    loadUser();
  }, [uid, auth.currentUser?.uid]);

  // Hydrate Personal Info from Firebase Auth displayName when available.
  // This prevents empty first/last fields immediately after signup redirects.
  useEffect(() => {
    const authName = parseAuthDisplayName(auth.currentUser?.displayName);
    if (!authName.firstName && !authName.lastName) return;
    setFormData((prev: any) => {
      const existingPersonal = prev?.personal || {};
      if (existingPersonal.firstName && existingPersonal.lastName) return prev;
      return {
        ...prev,
        personal: {
          ...existingPersonal,
          firstName: existingPersonal.firstName || authName.firstName || '',
          lastName: existingPersonal.lastName || authName.lastName || '',
        },
      };
    });
  }, [auth.currentUser?.uid, auth.currentUser?.displayName]);

  // Prefill wizard from user profile (runs when profile or posting loads)
  useEffect(() => {
    if (!userProfile) return;

    const currentFormData = formDataRef.current || {};
    const authName = parseAuthDisplayName(auth.currentUser?.displayName);
    const addressInfo = userProfile.addressInfo || {};
    // Merge with existing formData.personal to preserve user input
    const existingPersonal = currentFormData.personal || {};
    const personal = {
      firstName: existingPersonal.firstName || userProfile.firstName || authName.firstName || '',
      lastName: existingPersonal.lastName || userProfile.lastName || authName.lastName || '',
      email: existingPersonal.email || userProfile.email || '',
      phone: existingPersonal.phone || userProfile.phone || userProfile.phoneE164 || '',
      dob: toDobString(existingPersonal.dob || userProfile.dob || userProfile.dateOfBirth) || '',
      last4SSN: normalizeLast4SsnDigits(
        existingPersonal.last4SSN ?? userProfile.last4SSN ?? '',
      ),
      preferredLanguage:
        existingPersonal.preferredLanguage ||
        (userProfile.preferredLanguage === 'es' ? 'es' : 'en'),
      street: existingPersonal.street || addressInfo.streetAddress || '',
      unit: existingPersonal.unit || addressInfo.unitNumber || '',
      city: existingPersonal.city || userProfile.city || addressInfo.city || '',
      state: existingPersonal.state || userProfile.state || addressInfo.state || '',
      zip: existingPersonal.zip || userProfile.zipCode || addressInfo.zip || '',
      // Include coordinates from addressInfo for validation
      homeLat:
        existingPersonal.homeLat !== undefined
          ? existingPersonal.homeLat
          : addressInfo.homeLat !== undefined
          ? addressInfo.homeLat
          : undefined,
      homeLng:
        existingPersonal.homeLng !== undefined
          ? existingPersonal.homeLng
          : addressInfo.homeLng !== undefined
          ? addressInfo.homeLng
          : undefined,
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
    const preferencesBase =
      userProfile && userProfile.preferences ? { ...(userProfile.preferences || {}) } : {};
    const existingPrefs = currentFormData.preferences || {};
    const prefDefaults = {
      targetPay: '',
      shift: '',
      availabilityNotes: '',
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
    const existingRequirements = currentFormData.requirements || {};
    const hasExistingRequirements =
      Object.keys(existingRequirements).length > 0 &&
      (existingRequirements.drugScreeningComfort ||
        existingRequirements.backgroundScreeningComfort ||
        existingRequirements.eVerifyComfort ||
        existingRequirements.transportMethod ||
        existingRequirements.languagesComfort ||
        existingRequirements.physicalRequirementsComfort ||
        existingRequirements.uniformRequirementsComfort ||
        existingRequirements.customUniformRequirementsComfort ||
        existingRequirements.requiredPpeComfort ||
        (existingRequirements.additionalScreenings &&
          Object.keys(existingRequirements.additionalScreenings).length > 0));

    // Only prefill if there's no existing requirements data and we haven't prefilled yet
    if (!hasExistingRequirements && !prefilledRef.current) {
      const requirementsPrefill = {
        ...existingRequirements,
        drugScreeningComfort:
          existingRequirements.drugScreeningComfort || userProfile.comfortablePassDrug || '',
        drugExplanation:
          existingRequirements.drugExplanation || userProfile.passDrugExplanation || '',
        backgroundScreeningComfort:
          existingRequirements.backgroundScreeningComfort ||
          userProfile.comfortablePassBackground ||
          '',
        backgroundExplanation:
          existingRequirements.backgroundExplanation || userProfile.passBackgroundExplanation || '',
        additionalScreenings: {
          ...existingRequirements.additionalScreenings,
        },
        eVerifyComfort: existingRequirements.eVerifyComfort || userProfile.comfortableEVerify || '',
        transportMethod: existingRequirements.transportMethod || userProfile.transportMethod || '',
        languagesComfort:
          existingRequirements.languagesComfort || userProfile.comfortableWithLanguages || '',
        physicalRequirementsComfort:
          existingRequirements.physicalRequirementsComfort ||
          userProfile.comfortableWithPhysicalRequirements ||
          '',
        uniformRequirementsComfort:
          existingRequirements.uniformRequirementsComfort ||
          userProfile.comfortableWithUniformRequirements ||
          '',
        customUniformRequirementsComfort:
          existingRequirements.customUniformRequirementsComfort ||
          userProfile.comfortableWithCustomUniformRequirements ||
          '',
        requiredPpeComfort:
          existingRequirements.requiredPpeComfort || userProfile.comfortableWithRequiredPpe || '',
      };

      // Prefill additional screenings from user profile with dynamic field names
      if (Array.isArray(posting?.additionalScreenings)) {
        console.log(
          '📋 Prefilling additional screenings from posting:',
          posting.additionalScreenings,
        );
        console.log('📋 User profile data:', userProfile);
        posting.additionalScreenings.forEach((name: string) => {
          const key = `comfortableWith${name.replace(/[^a-zA-Z0-9]+/g, '')}`;
          const canonicalKey = buildAdditionalScreeningCanonicalKey(name);
          const userValue =
            // Existing requirement value for this exact screening name in the form
            requirementsPrefill.additionalScreenings[name] ||
            // Canonical/normalized map persisted for attestations
            (canonicalKey
              ? (userProfile as any)?.workerAttestations?.additionalScreenings?.[canonicalKey]
              : undefined) ||
            // Top-level additionalScreenings map if present
            (userProfile as any)?.additionalScreenings?.[name] ||
            // Legacy dynamic flat field
            (userProfile as any)[key];
          console.log(
            `  → ${name}: key=${key}, userValue=${userValue}, alreadyInForm=${requirementsPrefill.additionalScreenings[name]}`,
          );
          if (userValue && !requirementsPrefill.additionalScreenings[name]) {
            requirementsPrefill.additionalScreenings[name] = userValue;
            console.log(`  ✅ Set additionalScreenings["${name}"] = ${userValue}`);
          }
        });
        console.log(
          '📋 Final requirementsPrefill.additionalScreenings:',
          requirementsPrefill.additionalScreenings,
        );
      }

      // Only prefill if formData doesn't already have meaningful data
      // This prevents overwriting user input after account creation
      const hasExistingPersonalData =
        currentFormData.personal &&
        (currentFormData.personal.firstName ||
          currentFormData.personal.lastName ||
          currentFormData.personal.email ||
          currentFormData.personal.phone);

      // Only persist prefill if we don't have existing personal data
      // This ensures user input is preserved after account creation
      const missingCriticalNames =
        (!currentFormData.personal?.firstName || !currentFormData.personal?.lastName) &&
        !!(personal.firstName || personal.lastName);
      const shouldPrefillPersonal = !personalPrefilledRef.current || missingCriticalNames;
      const persistPayload: Record<string, any> = {
        eligibility,
        profilePicture,
        qualifications,
        preferences,
        requirements: requirementsPrefill,
      };

      if (shouldPrefillPersonal) {
        // Start with the userProfile-derived values (freshly loaded from Firestore)
        // and let currentFormData overlay — but only for keys whose current value is
        // actually meaningful. Previous behavior spread the whole currentFormData map,
        // so empty-string/null/undefined keys in a stale localStorage draft (e.g. a
        // returning visitor whose saved draft had phone:'' and dob:'') would clobber
        // the phone + DOB we just read from the user doc. Repro: type phone+DOB on
        // step 0, go forward, come back — fields are blank even though user doc has
        // them.
        const overlayPersonal: Record<string, unknown> = hasExistingPersonalData
          ? Object.fromEntries(
              Object.entries(currentFormData.personal || {}).filter(([, v]) => {
                if (v === null || v === undefined) return false;
                if (typeof v === 'string' && v.trim() === '') return false;
                return true;
              }),
            )
          : {};
        const merged = { ...personal, ...overlayPersonal } as typeof personal;
        merged.dob = toDobString(merged.dob) || '';
        persistPayload.personal = merged;
      }

      persist(persistPayload);
      prefilledRef.current = true;
      if (shouldPrefillPersonal) {
        const persistedPersonal = (persistPayload.personal || {}) as Record<string, unknown>;
        const hasPersistedName =
          String(persistedPersonal.firstName || '').trim().length > 0 ||
          String(persistedPersonal.lastName || '').trim().length > 0;
        if (hasPersistedName || !missingCriticalNames) {
          personalPrefilledRef.current = true;
        }
      }
    }
  }, [userProfile, posting]);

  // Compute missing required items for Requirements step based on new card UX
  const computeMissing = () => {
    const req = (formData.requirements || {}) as any;
    const uploaded = (req.uploaded || {}) as Record<string, boolean>;
    const profileCerts: string[] = Array.isArray(userProfile?.certifications)
      ? userProfile.certifications
          .map((c: any) => (typeof c === 'string' ? c : c?.name))
          .filter(Boolean)
      : [];

    // 1) Certifications must be uploaded or already present on profile
    const showLicensesCerts = posting?.showLicensesCerts === true;
    const missingCerts = showLicensesCerts
      ? (requirements.certifications || []).filter(
          (name) => !profileCerts.includes(name) && !uploaded[name],
        )
      : [];

    // 2) Drug screening
    const needsDrug = !!(posting?.showDrugScreening || posting?.drugScreeningRequired);
    const drugAnswered =
      typeof req.drugScreeningComfort === 'string' && req.drugScreeningComfort.length > 0;
    const drugNeedsExplanation =
      req.drugScreeningComfort === 'Maybe' && !(req.drugExplanation || '').trim();

    // 3) Background screening
    const needsBackground = !!(posting?.showBackgroundChecks || posting?.backgroundCheckRequired);
    const backgroundAnswered =
      typeof req.backgroundScreeningComfort === 'string' &&
      req.backgroundScreeningComfort.length > 0;
    const backgroundNeedsExplanation =
      req.backgroundScreeningComfort === 'Maybe' && !(req.backgroundExplanation || '').trim();

    // 4) E-Verify
    const needsEVerify = !!posting?.eVerifyRequired;
    const eVerifyAnswered = typeof req.eVerifyComfort === 'string' && req.eVerifyComfort.length > 0;

    // 5) Additional screenings (only if enabled)
    const showAdditional = posting?.showAdditionalScreenings === true;
    const addList: string[] =
      showAdditional && Array.isArray(posting?.additionalScreenings)
        ? posting.additionalScreenings
        : [];
    const addMap = (req.additionalScreenings || {}) as Record<string, string>;
    const missingAdditional = showAdditional
      ? addList.filter((name) => !(addMap[name] && String(addMap[name]).length > 0))
      : [];

    return {
      certs: missingCerts,
      drug: needsDrug && (!drugAnswered || drugNeedsExplanation),
      background: needsBackground && (!backgroundAnswered || backgroundNeedsExplanation),
      everify: needsEVerify && !eVerifyAnswered,
      additional: missingAdditional,
    } as const;
  };

  const missing = computeMissing();

  const advanceStep = useCallback(() => {
    setActiveStep((prev) => {
      const newStep = Math.min(prev + 1, visibleStepIndices.length - 1);
      const leavingActualStep = visibleStepIndices[prev];
      if (leavingActualStep === 8) {
        setHasMissingRequiredCerts(false);
      }
      try {
        localStorage.setItem(stepStorageKey, newStep.toString());
      } catch (error) {
        console.warn('Failed to save step to localStorage:', error);
      }
      return newStep;
    });
  }, [stepStorageKey, visibleStepIndices]);

  const retreatStep = useCallback(() => {
    setActiveStep((prev) => {
      const newStep = Math.max(prev - 1, 0);
      try {
        localStorage.setItem(stepStorageKey, newStep.toString());
      } catch (error) {
        console.warn('Failed to save step to localStorage:', error);
      }
      return newStep;
    });
  }, [stepStorageKey]);

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
        `${street}, ${city}, ${state} ${
          personalData.zip ? String(personalData.zip).trim() : ''
        }`.trim(),
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
    setSubmitting(true);
    try {
      setFormData((prev: any) => {
        const updated = { ...prev, ...partial };
        // Debug logging for address data persistence
        if (partial.personal) {
          console.log('💾 persist - saving personal data:', {
            partial: partial.personal,
            updatedPersonal: updated.personal,
            hasAddress: !!(updated.personal?.street || updated.personal?.city),
            hasCoordinates: !!(updated.personal?.homeLat && updated.personal?.homeLng),
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
        try {
          localStorage.setItem(
            appId,
            JSON.stringify({
              ...parsed,
              data: { ...formDataRef.current, ...partial },
              updatedAt: Date.now(),
            }),
          );
        } catch {}
      } else {
        const appRef = doc(db, 'tenants', tenantId, 'applicationDrafts', appId);
        await updateDoc(appRef, {
          data: { ...formDataRef.current, ...partial },
          updatedAt: serverTimestamp(),
        });
      }

      // Best-effort mirror to tenant application
      try {
        const isLocalDev =
          typeof window !== 'undefined' &&
          window.location.hostname === 'localhost' &&
          process.env.NODE_ENV === 'development';
        if (!isLocalDev && tenantId && (tenantAppId || (uid && jobId))) {
          const tidAppId = tenantAppId || `${uid}_${jobId}`;
          const tRef = doc(db, 'tenants', tenantId, 'applications', tidAppId);
          const personal = partial.personal || formData.personal || {};
          const applicantPhone =
            personal.phone && isValidUsPhone10(String(personal.phone))
              ? normalizeUsPhoneDigits(String(personal.phone))
              : null;
          await setDoc(
            tRef,
            {
              updatedAt: serverTimestamp(),
              applicant: {
                firstName: personal.firstName || null,
                lastName: personal.lastName || null,
                email: personal.email || null,
                phone: applicantPhone,
              },
            },
            { merge: true },
          );
          if (!tenantAppId) setTenantAppId(tidAppId);
        }
      } catch {}
    } finally {
      setSaving(false);
      setSubmitting(false);
    }
  };

  const handleNext = async () => {
    // Save-and-continue: persist current step into user profile where applicable
    setSaving(true);
    try {
      if (actualStep === 0) {
        const ph = String(formData?.personal?.phone || '');
        if (!isValidUsPhone10(ph)) {
          alert(t('apply.phoneTenDigits'));
          setSaving(false);
          return;
        }
        if (!isEmptyOrValidLast4Ssn(formData?.personal?.last4SSN)) {
          alert(t('apply.last4SsnInvalid'));
          setSaving(false);
          return;
        }
      }
      // Address step: hard-block advancing until the home address is selected
      // from the Google dropdown AND geocoded. The disabled Next button already
      // guards the click, but this also blocks Enter-key / programmatic advances
      // so workers can't slip through without a verified address.
      if (
        actualStep === 1 &&
        !isApplyHomeAddressValid(formDataRef.current?.personal || formData?.personal || {})
      ) {
        alert(
          t('apply.homeAddressRequired', {
            defaultValue:
              'Please select your home address from the dropdown so we can verify it before continuing.',
          }),
        );
        setSaving(false);
        return;
      }
      if (actualStep === 3) {
        const ev = String(
          formDataRef.current?.requirements?.eVerifyComfort ||
            formData?.requirements?.eVerifyComfort ||
            '',
        ).trim();
        if (!ev) {
          alert(t('apply.eVerifyComfortRequired'));
          setSaving(false);
          return;
        }
      }
      // Create account after Personal Info step if not authenticated
      if (actualStep === 0 && !auth.currentUser) {
        const email = String(formData?.personal?.email || '').trim();
        if (!email) {
          alert(t('apply.enterEmail'));
          setSaving(false);
          return;
        }
        if (!password || password.length < 6) {
          alert(t('apply.createPassword'));
          setSaving(false);
          return;
        }
        if (password !== confirmPassword) {
          alert(t('apply.passwordsDontMatch'));
          setSaving(false);
          return;
        }
        try {
          const cred = await createUserWithEmailAndPassword(auth, email, password);
          // Account created successfully - immediately create user document with base fields
          const newUid = cred.user.uid;
          const typedFirstName = String(formData?.personal?.firstName || '').trim();
          const typedLastName = String(formData?.personal?.lastName || '').trim();
          const composedDisplayName = [typedFirstName, typedLastName].filter(Boolean).join(' ').trim();
          const signupLast4 = normalizeLast4SsnDigits(formData?.personal?.last4SSN);
          const userRef = doc(db, 'users', newUid);
          const userSnap = await getDoc(userRef);

          // Only create if document doesn't exist
          if (!userSnap.exists()) {
            const hasJobContext = Boolean(jobId && String(jobId).trim());
            const resumePath = hasJobContext ? 'job' : signupGroupId ? 'c1_group' : 'c1_general';
            const baseProfile = {
              uid: newUid,
              email: String(email).trim(),
              displayName: composedDisplayName || '',
              firstName: typedFirstName || '',
              lastName: typedLastName || '',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              source: 'public_jobs_board',
              signupSource: signupGroupId ? 'apply_group_landing' : 'apply_landing',
              signupGroupId: signupGroupId || null,
              /** For automated SMS resume link + server-side reminder schedule (see applyWizardReminder). */
              applyResumeSnapshot: {
                path: resumePath,
                tenantId: tenantId || null,
                tenantSlug: tenantSlug ? String(tenantSlug).trim() : null,
                jobId: hasJobContext ? String(jobId).trim() : null,
                signupGroupId: signupGroupId ? String(signupGroupId).trim() : null,
              },
              applyWizardReminderPending: true,
              profileComplete: false,
              onboarded: false,
              role: 'Tenant',
              orgType: 'Tenant',
              preferredLanguage:
                String((formData?.personal as any)?.preferredLanguage || '').toLowerCase() === 'es'
                  ? 'es'
                  : detectDefaultLanguage(),
              isActive: true,
              skills: [],
              certifications: [],
              languages: [],
              education: [],
              workHistory: [],
              applications: [],
              favorites: [],
              crm_sales: false,
              recruiter: false,
              jobsBoard: false,
              userGroupIds: [],
              userAgreements: {
                termsOfUse: {
                  agreed: true,
                  version: '2025-10-21',
                  timestamp: new Date().toISOString(),
                },
                smsConsent: {
                  agreed: true,
                  version: '2025-10-21',
                  timestamp: new Date().toISOString(),
                },
                privacyPolicy: {
                  acknowledged: true,
                  version: '2025-10-21',
                  timestamp: new Date().toISOString(),
                },
              },
              ...(signupLast4.length === 4 ? { last4SSN: signupLast4 } : {}),
            };

            try {
              await setDoc(userRef, baseProfile);
              console.log('✅ Initial user document created with base fields');
            } catch (createErr) {
              console.error('❌ Failed to create initial user document:', createErr);
            }
          }
          // Continue with next step
          // The uid will be available via auth.currentUser.uid in subsequent steps
        } catch (e: any) {
          const errorMessage = e?.message || 'unknown error';
          if (errorMessage.includes('email-already-in-use')) {
            alert(t('apply.emailAlreadyRegistered'));
          } else {
            alert(t('apply.couldNotCreateAccount', { message: errorMessage }));
          }
          setSaving(false);
          return;
        }
      }

      const effectiveUid = auth.currentUser?.uid || uid;
      if (effectiveUid) {
        const userRef = doc(db, 'users', effectiveUid);
        if (actualStep === 0) {
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
          if (p.phone && isValidUsPhone10(String(p.phone))) {
            update.phone = normalizeUsPhoneDigits(String(p.phone));
          }
          if (p.dob) update.dob = String(p.dob).trim();
          update.preferredLanguage =
            String((p as any).preferredLanguage || '').toLowerCase() === 'es'
              ? 'es'
              : detectDefaultLanguage();
          const last4Step = normalizeLast4SsnDigits((p as any).last4SSN);
          if (last4Step.length === 4) {
            update.last4SSN = last4Step;
          }

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
            const addressInfoUpdate: any = {};
            if (p.street) addressInfoUpdate.streetAddress = String(p.street).trim();
            if (p.unit) addressInfoUpdate.unitNumber = String(p.unit).trim();
            if (p.city) addressInfoUpdate.city = String(p.city).trim();
            if (p.state) addressInfoUpdate.state = String(p.state).trim();
            if (p.zip) addressInfoUpdate.zip = String(p.zip).trim();

            if (p.homeLat !== undefined && p.homeLng !== undefined) {
              update.homeLat = Number(p.homeLat);
              update.homeLng = Number(p.homeLng);
              addressInfoUpdate.homeLat = Number(p.homeLat);
              addressInfoUpdate.homeLng = Number(p.homeLng);
            }

            if (Object.keys(addressInfoUpdate).length > 0) {
              update.addressInfo = {
                ...(update.addressInfo || {}),
                ...addressInfoUpdate,
              };
            }
          }

          if (tenantId) {
            try {
              const userSnap = await getDoc(userRef);
              const existingData = userSnap.exists() ? userSnap.data() : {};
              const existingTenantMeta = existingData?.tenantIds?.[tenantId] || {};
              // Preserve existing role/securityLevel so applying doesn't downgrade (e.g. Admin 7 → Applicant 2)
              update.tenantIds = {
                ...(existingData?.tenantIds || {}),
                [tenantId]: {
                  ...existingTenantMeta,
                  role: existingTenantMeta?.role || 'Applicant',
                  securityLevel: existingTenantMeta?.securityLevel || '2',
                  addedAt: existingTenantMeta?.addedAt || serverTimestamp(),
                },
              };
              update.activeTenantId = tenantId;
            } catch (err) {
              console.warn('Failed to read user doc for tenant metadata:', err);
            }
          }

          if (Object.keys(update).length > 1) {
            await setDoc(userRef, update, { merge: true });
          }

          // Auto-add to user groups as soon as account exists + tenant is linked (do not wait for full wizard).
          if (tenantId && effectiveUid) {
            try {
              await autoAddUserToApplyConfiguredGroups({
                userId: effectiveUid,
                tenantId,
                posting,
                signupGroupId,
              });
            } catch (groupEarlyErr) {
              console.warn('Apply wizard: early auto-add to user groups failed', groupEarlyErr);
            }
          }

          // Reload userProfile immediately after saving to ensure Address step has the latest data
          try {
            const updatedSnap = await getDoc(userRef);
            if (updatedSnap.exists()) {
              const updatedProfile = updatedSnap.data();
              setUserProfile(updatedProfile);
              console.log('✅ User profile reloaded after personal info save');

              // CRITICAL: Update formData.personal with the saved values so they persist across steps
              // This ensures that when the user navigates to the next step, the data is available
              const addressInfo = updatedProfile.addressInfo || {};
              const savedPersonal = {
                firstName: updatedProfile.firstName || p.firstName || '',
                lastName: updatedProfile.lastName || p.lastName || '',
                email: updatedProfile.email || p.email || '',
                phone: updatedProfile.phone || updatedProfile.phoneE164 || p.phone || '',
                dob: updatedProfile.dob || updatedProfile.dateOfBirth || p.dob || '',
                last4SSN: normalizeLast4SsnDigits(
                  updatedProfile.last4SSN ?? (p as { last4SSN?: string }).last4SSN ?? '',
                ),
                preferredLanguage:
                  (updatedProfile.preferredLanguage === 'es' ? 'es' : undefined) ||
                  ((p as any).preferredLanguage === 'es' ? 'es' : 'en'),
                street: addressInfo.streetAddress || p.street || '',
                unit: addressInfo.unitNumber || p.unit || '',
                city: updatedProfile.city || addressInfo.city || p.city || '',
                state: updatedProfile.state || addressInfo.state || p.state || '',
                zip: updatedProfile.zipCode || addressInfo.zip || p.zip || '',
                homeLat:
                  addressInfo.homeLat !== undefined
                    ? addressInfo.homeLat
                    : p.homeLat !== undefined
                    ? p.homeLat
                    : updatedProfile.homeLat,
                homeLng:
                  addressInfo.homeLng !== undefined
                    ? addressInfo.homeLng
                    : p.homeLng !== undefined
                    ? p.homeLng
                    : updatedProfile.homeLng,
              };

              // Update formData with saved values
              setFormData((prev: any) => {
                const updated = {
                  ...prev,
                  personal: {
                    ...prev.personal,
                    ...savedPersonal,
                  },
                };
                // Synchronously update formDataRef so persist can use the latest data
                formDataRef.current = updated;
                return updated;
              });

              // Also persist to draft application
              if (appId) {
                await persist({ personal: savedPersonal });
              }

              console.log('✅ formData.personal updated with saved values:', savedPersonal);
            }
          } catch (err) {
            console.warn('Failed to reload user profile:', err);
          }

          // Enforce Twilio verification via modal whenever the phone is not yet verified
          // on this user's doc — OR whenever the phone has just changed. Previously this
          // only fired when the phone changed, so a new signup whose `phone` happened to
          // match an already-verified number on another user (Twilio phoneVerified never
          // gets set on the new user's doc until we run `confirmPhoneCode`) would skip
          // verification entirely and land on Address as step 2.
          const onlyDigits = (v: string) => (v || '').replace(/\D/g, '');
          const currentPhone = userProfile?.phone || userProfile?.phoneE164 || '';
          const phoneVerifiedOnDoc = Boolean(userProfile?.phoneVerified);
          const phoneChanged = onlyDigits(p.phone || '') !== onlyDigits(currentPhone);
          if ((p.phone || '').trim() && (phoneChanged || !phoneVerifiedOnDoc)) {
            setVerifyOpen(true);
            return; // pause progression until verification completes
          }
        } else if (actualStep === 1) {
          // Address → save address data with coordinates
          // CRITICAL: Ensure coordinates are present before proceeding
          let p = await ensurePersonalCoordinates({ ...(formData.personal || {}) });

          // If coordinates are still missing after geocoding attempt, block progression
          if (!p.homeLat || !p.homeLng) {
            const street = p.street || formData.personal?.street || '';
            const city = p.city || formData.personal?.city || '';
            const state = p.state || formData.personal?.state || '';
            const zip = p.zip || formData.personal?.zip || '';

            if (street && city && state) {
              try {
                const fullAddress = `${street}, ${city}, ${state} ${zip}`.trim();
                console.log('📍 Geocoding address on Address step:', fullAddress);
                const coords = await geocodeAddress(fullAddress);
                p = { ...p, homeLat: coords.lat, homeLng: coords.lng };
                // Update formData with coordinates directly
                setFormData((prev: any) => ({
                  ...prev,
                  personal: {
                    ...(prev.personal || {}),
                    ...p,
                  },
                }));
              } catch (geoErr) {
                console.error('❌ Failed to geocode address:', geoErr);
                alert(t('apply.validateAddress'));
                setSaving(false);
                return;
              }
            } else {
              alert(t('apply.completeAddress'));
              setSaving(false);
              return;
            }
          }

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
            const addressInfoUpdate: any = {};
            if (p.street) addressInfoUpdate.streetAddress = String(p.street).trim();
            if (p.unit) addressInfoUpdate.unitNumber = String(p.unit).trim();
            if (p.city) addressInfoUpdate.city = String(p.city).trim();
            if (p.state) addressInfoUpdate.state = String(p.state).trim();
            if (p.zip) addressInfoUpdate.zip = String(p.zip).trim();

            if (p.homeLat !== undefined && p.homeLng !== undefined) {
              update.homeLat = Number(p.homeLat);
              update.homeLng = Number(p.homeLng);
              addressInfoUpdate.homeLat = Number(p.homeLat);
              addressInfoUpdate.homeLng = Number(p.homeLng);
            }

            if (Object.keys(addressInfoUpdate).length > 0) {
              update.addressInfo = {
                ...(update.addressInfo || {}),
                ...addressInfoUpdate,
              };
            }
          }

          if (Object.keys(update).length > 1) {
            await setDoc(userRef, update, { merge: true });
          }
        } else if (actualStep === 3) {
          // Generic apply: E-Verify comfort (persisted live via EVerifyComfortStep; sync to user on Next)
          const r = formData.requirements || {};
          const ev = String(r.eVerifyComfort || '').trim();
          if (ev) {
            await setDoc(
              userRef,
              buildCanonicalWorkerProfileWritePatch({ comfortableEVerify: ev, updatedAt: serverTimestamp() }),
              { merge: true },
            );
          }
        } else if (actualStep === 4) {
          // Work Eligibility → save attestation (not a document) + legacy workEligibility
          // Prefer ref so Skip EEO + Next in one tick sees cleared optional fields
          const e =
            (formDataRef.current && formDataRef.current.eligibility) || formData.eligibility || {};
          const update: any = { updatedAt: serverTimestamp() };
          // 2026-07-09 (Greg): the question is no longer asked at sign-up.
          // Only persist workEligibility + the attestation when the worker
          // actually ANSWERED — the old `: false` default stamped a fake
          // "not authorized" attestation on every unanswered profile.
          const workAuthAnswered = typeof e.workAuthorized === 'boolean';
          // W.3 — preserve existing EEO on the nested attestation (and the
          // top-level mirror fields). When the EEO inputs aren't rendered
          // (default) `e.gender`/`e.veteranStatus`/`e.disabilityStatus` are
          // undefined, and the previous logic clobbered the existing values
          // with `null`. Spread `prevAtt` first so missing form fields keep
          // whatever was there before. W.6 owns the eventual full removal.
          const prevAtt = (userProfile?.workEligibilityAttestation || {}) as Record<string, unknown>;
          if (workAuthAnswered) {
            const authorizedToWorkUS = !!e.workAuthorized;
            update.workEligibility = authorizedToWorkUS;
            update.workEligibilityAttestation = {
              ...prevAtt,
              authorizedToWorkUS,
              requireSponsorship: typeof e.requireSponsorship === 'boolean' ? !!e.requireSponsorship : (prevAtt.requireSponsorship ?? null),
              attestedAt: serverTimestamp(),
              ...(e.gender !== undefined ? { gender: e.gender ? String(e.gender) : null } : {}),
              ...(e.veteranStatus !== undefined ? { veteranStatus: e.veteranStatus ? String(e.veteranStatus) : null } : {}),
              ...(e.disabilityStatus !== undefined ? { disabilityStatus: e.disabilityStatus ? String(e.disabilityStatus) : null } : {}),
            };
          }
          if (typeof e.requireSponsorship === 'boolean') update.requireSponsorship = !!e.requireSponsorship;
          if (e.gender !== undefined) update.gender = String(e.gender || '');
          if (e.veteranStatus !== undefined) update.veteranStatus = String(e.veteranStatus || '');
          if (e.disabilityStatus !== undefined) update.disabilityStatus = String(e.disabilityStatus || '');
          await setDoc(userRef, update, { merge: true });
        } else if (actualStep === 5) {
          // Profile Picture → save profile picture URL
          const p = formData.profilePicture || {};
          const update: any = { updatedAt: serverTimestamp() };
          if (p.profilePicture) update.avatar = p.profilePicture;
          if (Object.keys(update).length > 1) {
            await setDoc(userRef, buildCanonicalWorkerProfileWritePatch(update), { merge: true });
          }
        } else if (actualStep === 6) {
          // Skills → save skills, certifications, languages to profile
          const q = formData.qualifications || {};
          const update: any = { updatedAt: serverTimestamp() };
          if (Array.isArray(q.skills)) update.skills = q.skills;
          if (Array.isArray(q.certifications)) update.certifications = q.certifications;
          if (Array.isArray(q.languages)) update.languages = normalizeLanguageList(q.languages);
          if (Object.keys(update).length > 1) {
            await setDoc(userRef, buildCanonicalWorkerProfileWritePatch(update), { merge: true });
          }
        } else if (actualStep === 7) {
          // Education → save education to profile
          const q = formData.qualifications || {};
          const update: any = { updatedAt: serverTimestamp() };
          if (Array.isArray(q.education)) update.education = q.education;
          if (Object.keys(update).length > 1) {
            await setDoc(userRef, buildCanonicalWorkerProfileWritePatch(update), { merge: true });
          }
        } else if (actualStep === 8) {
          // Licenses and Certifications → save certifications to profile
          const q = formData.qualifications || {};
          const update: any = { updatedAt: serverTimestamp() };
          if (Array.isArray(q.certifications)) update.certifications = q.certifications;
          if (Object.keys(update).length > 1) {
            await setDoc(userRef, buildCanonicalWorkerProfileWritePatch(update), { merge: true });
          }
        } else if (actualStep === 9) {
          // Work Experience → save work experience to profile
          const q = formData.qualifications || {};
          const update: any = { updatedAt: serverTimestamp() };
          if (Array.isArray(q.workHistory)) update.workHistory = q.workHistory;
          if (Array.isArray(q.workExperience)) {
            update.workExperience = q.workExperience;
            update.workHistory = q.workExperience; // Also save to workHistory for backward compatibility
          }
          if (Object.keys(update).length > 1) {
            await setDoc(userRef, buildCanonicalWorkerProfileWritePatch(update), { merge: true });
          }
        } else if (actualStep === 10) {
          // Bio → save professional bio to profile
          const b = formData.bio || {};
          const update: any = { updatedAt: serverTimestamp() };
          if (typeof b.professionalBio === 'string' && b.professionalBio.trim()) {
            update.professionalBio = b.professionalBio.trim();
          }
          if (Object.keys(update).length > 1) await setDoc(userRef, update, { merge: true });
        } else if (actualStep === 11) {
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
          await setDoc(userRef, buildCanonicalWorkerProfileWritePatch(update), { merge: true });
        } else if (actualStep === 12) {
          // Requirements → save screening responses and availability to user profile
          const r = formData.requirements || {};
          const p = formData.preferences || {};
          const update: any = { updatedAt: serverTimestamp() };
          if (r.drugScreeningComfort) update.comfortablePassDrug = r.drugScreeningComfort;
          if (r.drugExplanation) update.passDrugExplanation = r.drugExplanation;
          if (r.backgroundScreeningComfort)
            update.comfortablePassBackground = r.backgroundScreeningComfort;
          if (r.backgroundExplanation) update.passBackgroundExplanation = r.backgroundExplanation;
          if (r.eVerifyComfort) update.comfortableEVerify = r.eVerifyComfort;
          if (r.languagesComfort) update.comfortableWithLanguages = r.languagesComfort;
          if (r.physicalRequirementsComfort)
            update.comfortableWithPhysicalRequirements = r.physicalRequirementsComfort;
          if (r.uniformRequirementsComfort)
            update.comfortableWithUniformRequirements = r.uniformRequirementsComfort;
          if (r.customUniformRequirementsComfort)
            update.comfortableWithCustomUniformRequirements = r.customUniformRequirementsComfort;
          if (r.requiredPpeComfort) update.comfortableWithRequiredPpe = r.requiredPpeComfort;
          if (r.transportMethod) update.transportMethod = r.transportMethod;
          if (r.additionalScreenings && typeof r.additionalScreenings === 'object') {
            update.additionalScreenings = r.additionalScreenings;
          }

          // Save additional screenings with dynamic field names
          if (r.additionalScreenings && Array.isArray(posting?.additionalScreenings)) {
            posting.additionalScreenings.forEach((name: string) => {
              const key = `comfortableWith${name.replace(/[^a-zA-Z0-9]+/g, '')}`;
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
          if (
            typeof p.availableToStartDate === 'string' ||
            typeof p.availabilityNotes === 'string'
          ) {
            if (!update.preferences) update.preferences = {};
            if (typeof p.availableToStartDate === 'string')
              update.preferences.availableToStartDate = p.availableToStartDate;
            if (typeof p.availabilityNotes === 'string')
              update.preferences.availabilityNotes = p.availabilityNotes;
          }

          if (Object.keys(update).length > 1) {
            await setDoc(userRef, buildCanonicalWorkerProfileWritePatch(update), { merge: true });
          }
        }
      }
    } finally {
      setSaving(false);
      advanceStep();
    }
  };

  /** Clear optional EEO fields and advance (same as Next) so users can skip that block in one tap. */
  const handleSkipOptionalEeo = async () => {
    if (actualStep !== 4) return;
    const el = formData.eligibility || {};
    if (el.workAuthorized !== true) {
      alert(t('apply.confirmWorkAuthBeforeSkipEeo'));
      return;
    }
    flushSync(() => {
      setFormData((prev: any) => {
        const next = {
          ...prev,
          eligibility: {
            ...(prev.eligibility || {}),
            gender: '',
            veteranStatus: '',
            disabilityStatus: '',
          },
        };
        formDataRef.current = next;
        return next;
      });
    });
    await handleNext();
  };

  const handleBack = () => {
    retreatStep();
  };

  const handleSubmit = async () => {
    setSaving(true);
    try {
      // Account should already be created after Personal Info step. If it
      // isn't (e.g. the worker reached the final step unauthenticated because
      // earlier steps auto-skipped), DON'T dead-end on the alert — send them
      // back to the Personal Info step so they can actually create the account
      // and finish signing up.
      const effectiveUid: string | null = auth.currentUser?.uid || uid || null;
      if (!effectiveUid) {
        alert(t('apply.completePersonalInfo'));
        setSaving(false);
        const personalIdx = visibleStepIndices.indexOf(0);
        setActiveStep(personalIdx >= 0 ? personalIdx : 0);
        return;
      }

      // Backstop: if the address step is in this flow but somehow reached submit
      // without a complete + geocoded address (e.g. a resumed session), bounce
      // back to it. Only when the step is actually shown — a returning user whose
      // address is already on file has the step skipped and must NOT be blocked.
      if (
        visibleStepIndices.includes(1) &&
        !isApplyHomeAddressValid(formDataRef.current?.personal || formData?.personal || {})
      ) {
        alert(
          t('apply.homeAddressRequired', {
            defaultValue:
              'Please select your home address from the dropdown so we can verify it before continuing.',
          }),
        );
        setSaving(false);
        const addrIdx = visibleStepIndices.indexOf(1);
        setActiveStep(addrIdx >= 0 ? addrIdx : 0);
        return;
      }

      const quals = formData?.qualifications || {};
      const skillsFromFormNames = Array.isArray(quals.skills)
        ? quals.skills.map((s: any) => (typeof s === 'string' ? s : s?.name)).filter(Boolean)
        : [];
      const parsedSkillNames = parsedResumeSkillNames(formData?.resume);
      const requiredSkillList = toStringList(
        posting?.skills ||
          posting?.skillsRequired ||
          posting?.requiredSkills ||
          posting?.requirements?.skills ||
          posting?.scoping?.skills
      );
      const combinedSkillNames = [...new Set([...skillsFromFormNames, ...parsedSkillNames])];
      const missingJobSkills = requiredSkillList.filter(
        (req) => !combinedSkillNames.some((u) => valuesLooselyMatch(u, req))
      );
      if (missingJobSkills.length > 0) {
        alert(t('apply.addAtLeastOneSkill'));
        setSaving(false);
        const skillsStepIndex = visibleStepIndices.indexOf(6);
        if (skillsStepIndex >= 0) setActiveStep(skillsStepIndex);
        return;
      }

      const skillsForProfile: Array<{ name: string; type: string }> = [];
      if (Array.isArray(quals.skills) && quals.skills.length) {
        for (const s of quals.skills) {
          if (typeof s === 'string' && s.trim()) {
            skillsForProfile.push({ name: s.trim(), type: 'Other' });
          } else if (s && typeof s === 'object' && String((s as any).name || '').trim()) {
            skillsForProfile.push({
              name: String((s as any).name).trim(),
              type: String((s as any).type || (s as any).category || 'Other'),
            });
          }
        }
      }
      if (skillsForProfile.length === 0 && parsedSkillNames.length > 0) {
        parsedSkillNames.forEach((n) => skillsForProfile.push({ name: n, type: 'Other' }));
      }

      // Final guard: ensure all required requirement fields are answered
      const m = computeMissing();
      if (m.drug || m.background || m.everify || (m.additional && m.additional.length > 0)) {
        setSaving(false);
        try {
          alert(t('apply.completeRequiredItems'));
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
            data: deepStripUndefined(formData || {}) || {},
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
            const shiftRef = doc(
              db,
              'tenants',
              tenantId,
              'job_orders',
              posting.jobOrderId,
              'shifts',
              selectedShifts[0],
            );
            const shiftSnap = await getDoc(shiftRef);

            if (shiftSnap.exists()) {
              const shiftData = shiftSnap.data();
              if (shiftData.shiftDate) {
                conflict = await checkShiftDateConflict(
                  effectiveUid,
                  tenantId,
                  shiftData.shiftDate,
                );
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
            posting.jobOrderId,
          );
        }

        if (conflict?.hasConflict) {
          setSaving(false);
          // Show error message using Snackbar
          const conflictDate = conflict.conflictingApplication?.shiftDate
            ? new Date(conflict.conflictingApplication.shiftDate).toLocaleDateString()
            : 'this date';

          setSubmitOpen(true);
          const errorMsg = t('apply.shiftConflict', { date: conflictDate });
          setTimeout(() => {
            alert(errorMsg);
          }, 100);
          return;
        }
      }

      if ((effectiveAppId || '').startsWith('appDraft:')) {
        const existing = localStorage.getItem(effectiveAppId!);
        const parsed = existing ? JSON.parse(existing) : {};
        try {
          localStorage.setItem(
            effectiveAppId!,
            JSON.stringify({ ...parsed, status: 'submitted', submittedAt: Date.now() }),
          );
        } catch {}
      } else {
        // Mark draft as submitted in tenants/{tenantId}/applicationDrafts
        const draftRef = doc(db, 'tenants', tenantId, 'applicationDrafts', effectiveAppId!);
        await updateDoc(draftRef, {
          status: 'submitted',
          submittedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      // Merge selected profile fields into users/{uid}
      const userRef = doc(db, 'users', effectiveUid!);
      let personal = await ensurePersonalCoordinates({ ...(formData.personal || {}) });

      {
        const formDigits = normalizeUsPhoneDigits(String(personal.phone || ''));
        const profilePhoneRaw = String(userProfile?.phone || userProfile?.phoneE164 || '');
        const effectivePhone =
          formDigits.length > 0 ? String(personal.phone || '') : profilePhoneRaw;
        if (!isValidUsPhone10(effectivePhone)) {
          alert(t('apply.phoneTenDigits'));
          setSaving(false);
          const idx = visibleStepIndices.indexOf(0);
          if (idx >= 0) setActiveStep(idx);
          return;
        }
      }

      const resumeAddress =
        !personal.street && (userProfile?.contact?.address || userProfile?.contact?.city)
          ? userProfile?.contact?.address ||
            `${userProfile?.contact?.city || ''}, ${userProfile?.contact?.state || ''} ${
              userProfile?.contact?.zip || ''
            }`
          : undefined;

      if ((!personal.street || !personal.city || !personal.state) && resumeAddress) {
        try {
          const detailed = await geocodeAddressDetailed(resumeAddress);
          personal = {
            ...personal,
            street: personal.street || detailed.street,
            city: personal.city || detailed.city,
            state: personal.state || detailed.state,
            zip: personal.zip || detailed.zip,
            homeLat: personal.homeLat ?? detailed.lat,
            homeLng: personal.homeLng ?? detailed.lng,
          };
        } catch (resumeGeoErr) {
          console.warn('Fallback resume geocode failed:', resumeGeoErr);
        }
      }

      // CRITICAL: Ensure address has coordinates before final submission
      if (
        (personal.street || personal.city || personal.state) &&
        (!personal.homeLat || !personal.homeLng)
      ) {
        const street = personal.street || formData.personal?.street || '';
        const city = personal.city || formData.personal?.city || '';
        const state = personal.state || formData.personal?.state || '';
        const zip = personal.zip || formData.personal?.zip || '';

        if (street && city && state) {
          try {
            const fullAddress = `${street}, ${city}, ${state} ${zip}`.trim();
            console.log('📍 Final geocoding in handleSubmit:', fullAddress);
            const coords = await geocodeAddress(fullAddress);
            personal = { ...personal, homeLat: coords.lat, homeLng: coords.lng };
            // Update formData with coordinates
            setFormData((prev: any) => ({
              ...prev,
              personal: {
                ...(prev.personal || {}),
                ...personal,
              },
            }));
          } catch (geoErr) {
            console.error('❌ Failed to geocode address in handleSubmit:', geoErr);
            // Don't block submission, but log the error
          }
        }
      }

      if (
        !personal.street ||
        !personal.city ||
        !personal.state ||
        !personal.zip ||
        personal.homeLat === undefined ||
        personal.homeLng === undefined
      ) {
        alert(t('apply.completeAddressBeforeSubmit'));
        setSaving(false);
        setActiveStep(1);
        return;
      }

      // Debug logging for address data
      console.log('🔍 handleSubmit - formData.personal:', personal);
      console.log('🔍 handleSubmit - address fields:', {
        street: personal.street,
        city: personal.city,
        state: personal.state,
        zip: personal.zip,
        homeLat: personal.homeLat,
        homeLng: personal.homeLng,
      });

      const eligibility = formData.eligibility || {};
      const profilePicture = formData.profilePicture || {};
      const requirementAnswers = formData.requirements || {};
      const requiredJobLanguages = Array.isArray(posting?.languages)
        ? posting.languages.map((l: unknown) => String(l || '').trim()).filter(Boolean)
        : [];
      const languagesFromRequirementAnswer =
        requirementAnswers.languagesComfort === 'Yes' ? requiredJobLanguages : [];
      const normalizedLanguages = normalizeLanguageList([
        ...(Array.isArray(quals.languages) ? quals.languages : []),
        ...languagesFromRequirementAnswer,
      ]);
      const certifications = Array.isArray(quals.certifications) ? quals.certifications : [];
      const profileUpdate: any = {
        updatedAt: serverTimestamp(),
      };
      if (personal.firstName) profileUpdate.firstName = String(personal.firstName).trim();
      if (personal.lastName) profileUpdate.lastName = String(personal.lastName).trim();
      if (personal.email) profileUpdate.email = String(personal.email).trim();
      if (personal.phone && isValidUsPhone10(String(personal.phone))) {
        profileUpdate.phone = normalizeUsPhoneDigits(String(personal.phone));
      }
      if (personal.dob) profileUpdate.dob = String(personal.dob).trim();
      profileUpdate.preferredLanguage =
        String((personal as any).preferredLanguage || '').toLowerCase() === 'es'
          ? 'es'
          : detectDefaultLanguage();
      const last4Submit = normalizeLast4SsnDigits((personal as any).last4SSN);
      if (last4Submit.length === 4) {
        profileUpdate.last4SSN = last4Submit;
      }

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
            ...(personal.homeLat !== undefined && personal.homeLng !== undefined
              ? {
                  homeLat: Number(personal.homeLat),
                  homeLng: Number(personal.homeLng),
                }
              : {}),
          };

          if (personal.homeLat !== undefined && personal.homeLng !== undefined) {
            profileUpdate.homeLat = Number(personal.homeLat);
            profileUpdate.homeLng = Number(personal.homeLng);
          }

          // Canonical structured `homeAddress` (new). Only written when the
          // user actually selected a Google Place (placeId present); the
          // wizard's `addressValid` gate prevents a non-Place submit, but the
          // builder fails closed defensively. Downstream readers (Everee
          // address preflight in `onApplicationCreatedPush`) key off this
          // shape, while `addressInfo` / top-level fields stay populated for
          // legacy readers (`extractEvereeHomeAddressFromUserDoc`,
          // `MissingHomeAddressAlert`, etc.).
          const canonicalHomeAddress = buildCanonicalHomeAddressFromWizardPersonal(personal);
          if (canonicalHomeAddress) {
            profileUpdate.homeAddress = canonicalHomeAddress;
          }

          console.log('✅ Address data being saved:', {
            address: profileUpdate.address,
            addressInfo: profileUpdate.addressInfo,
            homeAddress: profileUpdate.homeAddress,
            city: profileUpdate.city,
            state: profileUpdate.state,
            zipCode: profileUpdate.zipCode,
          });
        }
      } else {
        console.warn('⚠️ No address data found in personal object');
      }

      if (normalizedLanguages.length) profileUpdate.languages = normalizedLanguages;
      if (certifications.length) profileUpdate.certifications = certifications;
      if (skillsForProfile.length) profileUpdate.skills = skillsForProfile;

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
      const isC1EventsContractor = hiringEntityName != null && /C1 Events LLC/i.test(hiringEntityName);
      // 2026-07-09 (Greg): the eligibility question is no longer asked at
      // sign-up. Only persist workEligibility + the attestation when the
      // worker actually answered (or the C1 Events contractor-terms path
      // attests for them) — the old `: false` default was stamping a fake
      // "not authorized" attestation on every unanswered profile (83 of
      // the last 300 workers).
      const workAuthAnsweredApply =
        isC1EventsContractor || typeof eligibility.workAuthorized === 'boolean';
      // W.3 — same preservation pattern as the per-step persist above.
      // Spread `prevAtt` so EEO collected before the W.3 hide isn't
      // clobbered with `null` on a wizard run that no longer renders the
      // EEO inputs. W.6 owns the eventual full removal.
      const prevAttApply = (userProfile?.workEligibilityAttestation || {}) as Record<string, unknown>;
      if (workAuthAnsweredApply) {
        const authorizedToWorkUS = isC1EventsContractor || !!eligibility.workAuthorized;
        profileUpdate.workEligibility = authorizedToWorkUS;
        profileUpdate.workEligibilityAttestation = {
          ...prevAttApply,
          authorizedToWorkUS,
          requireSponsorship: eligibility.requireSponsorship ?? prevAttApply.requireSponsorship ?? null,
          attestedAt: serverTimestamp(),
          sourceApplicationId: tenantId && effectiveUid && jobId ? `${effectiveUid}_${jobId}` : null,
          ...(eligibility.gender !== undefined ? { gender: eligibility.gender ? String(eligibility.gender) : null } : {}),
          ...(eligibility.veteranStatus !== undefined ? { veteranStatus: eligibility.veteranStatus ? String(eligibility.veteranStatus) : null } : {}),
          ...(eligibility.disabilityStatus !== undefined ? { disabilityStatus: eligibility.disabilityStatus ? String(eligibility.disabilityStatus) : null } : {}),
        };
      }
      if (eligibility.gender) profileUpdate.gender = String(eligibility.gender);
      if (eligibility.veteranStatus)
        profileUpdate.veteranStatus = String(eligibility.veteranStatus);
      if (eligibility.disabilityStatus)
        profileUpdate.disabilityStatus = String(eligibility.disabilityStatus);
      // Save profile picture - use formData value or existing userProfile avatar
      if (profilePicture.profilePicture) {
        profileUpdate.avatar = String(profilePicture.profilePicture);
      } else if (userProfile?.avatar) {
        // If no new picture uploaded but user already has one, preserve it
        profileUpdate.avatar = String(userProfile.avatar);
      }

      // Save requirements data (screenings)
      const requirements = formData.requirements || {};
      if (requirements.drugScreeningComfort)
        profileUpdate.comfortablePassDrug = requirements.drugScreeningComfort;
      if (requirements.drugExplanation)
        profileUpdate.passDrugExplanation = requirements.drugExplanation;
      if (requirements.backgroundScreeningComfort)
        profileUpdate.comfortablePassBackground = requirements.backgroundScreeningComfort;
      if (requirements.backgroundExplanation)
        profileUpdate.passBackgroundExplanation = requirements.backgroundExplanation;
      if (requirements.eVerifyComfort)
        profileUpdate.comfortableEVerify = requirements.eVerifyComfort;
      if (requirements.languagesComfort)
        profileUpdate.comfortableWithLanguages = requirements.languagesComfort;
      if (requirements.physicalRequirementsComfort)
        profileUpdate.comfortableWithPhysicalRequirements = requirements.physicalRequirementsComfort;
      if (requirements.uniformRequirementsComfort)
        profileUpdate.comfortableWithUniformRequirements = requirements.uniformRequirementsComfort;
      if (requirements.customUniformRequirementsComfort)
        profileUpdate.comfortableWithCustomUniformRequirements = requirements.customUniformRequirementsComfort;
      if (requirements.requiredPpeComfort)
        profileUpdate.comfortableWithRequiredPpe = requirements.requiredPpeComfort;
      if (requirements.transportMethod)
        profileUpdate.transportMethod = requirements.transportMethod;
      if (requirements.additionalScreenings && typeof requirements.additionalScreenings === 'object')
        profileUpdate.additionalScreenings = requirements.additionalScreenings;

      // Save additional screenings with dynamic field names
      if (requirements.additionalScreenings && Array.isArray(posting?.additionalScreenings)) {
        posting.additionalScreenings.forEach((name: string) => {
          const key = `comfortableWith${name.replace(/[^a-zA-Z0-9]+/g, '')}`;
          if (requirements.additionalScreenings[name]) {
            profileUpdate[key] = requirements.additionalScreenings[name];
          }
        });
      }

      if (tenantId) {
        try {
          const userSnap = await getDoc(userRef);
          const existingData = userSnap.exists() ? userSnap.data() : {};
          const existingTenantMeta = existingData?.tenantIds?.[tenantId] || {};
          // Preserve existing role/securityLevel so applying doesn't downgrade (e.g. Admin 7 → Applicant 2)
          profileUpdate.tenantIds = {
            ...(existingData?.tenantIds || {}),
            [tenantId]: {
              ...existingTenantMeta,
              role: existingTenantMeta?.role || 'Applicant',
              securityLevel: existingTenantMeta?.securityLevel || '2',
              addedAt: existingTenantMeta?.addedAt || serverTimestamp(),
            },
          };
          profileUpdate.activeTenantId = tenantId;
        } catch (err) {
          console.warn('Failed to merge tenant metadata during submit:', err);
        }
      }

      await setDoc(userRef, buildCanonicalWorkerProfileWritePatch(profileUpdate), { merge: true });

      // Create final submitted application in tenants/{tenantId}/applications
      try {
        if (tenantId && effectiveUid && jobId) {
          const jobOrderIdOverride = (() => {
            try {
              const params = new URLSearchParams(window.location.search);
              const v = params.get('jobOrderId');
              return v && v.trim() ? v.trim() : null;
            } catch {
              return null;
            }
          })();

          const tidAppId = `${effectiveUid}_${jobId}`;
          const tRef = doc(db, 'tenants', tenantId, 'applications', tidAppId);

          // When worker applied for a specific day (applyDate in URL), merge into applyDate/applyDates for day filtering
          let applyDatePayload: string | null = null;
          let applyDatesPayload: string[] | null = null;
          if (applyDateFromUrl) {
            const existingSnap = await getDoc(tRef);
            const existing = existingSnap.exists() ? existingSnap.data() : null;
            const existingStatus = String(existing?.status || '').toLowerCase();
            const shouldCarryForwardExistingDays = ![
              'withdrawn',
              'declined',
              'deleted',
              'cancelled',
              'canceled',
              'rejected',
            ].includes(existingStatus);
            const existingDates: string[] = shouldCarryForwardExistingDays
              ? existing?.applyDates
                ? [...(existing.applyDates as string[])]
                : existing?.applyDate && /^\d{4}-\d{2}-\d{2}$/.test(String(existing.applyDate))
                  ? [String(existing.applyDate)]
                  : []
              : [];
            const merged = [...new Set([...existingDates, applyDateFromUrl])].sort();
            applyDatePayload = applyDateFromUrl;
            applyDatesPayload = merged;
          }

          // Get shift dates for gig jobs (for one-shift-per-day validation)
          let shiftDate: string | null = null;
          const shiftDates: string[] = [];

          const effectiveJobOrderId = posting?.jobOrderId || jobOrderIdOverride;
          if (selectedShifts.length > 0 && effectiveJobOrderId) {
            for (const shiftId of selectedShifts) {
              try {
                const shiftRef = doc(
                  db,
                  'tenants',
                  tenantId,
                  'job_orders',
                  effectiveJobOrderId,
                  'shifts',
                  shiftId,
                );
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

          const safeFormData = deepStripUndefined(formData || {}) || {};
          // Job Score: compute and store if job has a requirement pack
          let requirementPackId =
            (posting as any)?.requirementPackId || (posting as any)?.jobOrder?.requirementPackId;
          if (!requirementPackId && effectiveJobOrderId && tenantId) {
            try {
              const joRef = doc(db, 'tenants', tenantId, 'job_orders', effectiveJobOrderId);
              const joSnap = await getDoc(joRef);
              if (joSnap.exists()) requirementPackId = (joSnap.data() as any)?.requirementPackId;
            } catch (_) {}
          }
          let userData: any = {};
          try {
            const userRef = doc(db, 'users', effectiveUid);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) userData = userSnap.data() || {};
          } catch (_) {}
          const qual = formData?.qualifications || {};
          let jobScoreSummaryPayload: any = undefined;
          if (requirementPackId) {
            const prefs = formData?.preferences || {};
            const scorePhoneRaw =
              personal.phone && isValidUsPhone10(String(personal.phone))
                ? normalizeUsPhoneDigits(String(personal.phone))
                : userData.phone;
            const userDocForScore = {
              ...userData,
              workEligibility: formData?.eligibility?.workAuthorized ?? userData.workEligibility,
              firstName: personal.firstName ?? userData.firstName,
              lastName: personal.lastName ?? userData.lastName,
              email: personal.email ?? userData.email,
              phone: scorePhoneRaw,
              skills: qual.skills ?? userData.skills,
              education: qual.education ?? userData.education,
              certifications: qual.certifications ?? userData.certifications,
              workExperience: qual.workExperience ?? userData.workExperience ?? userData.workHistory,
              preferences: prefs?.shiftPreferences
                ? { ...prefs, shiftPreferences: prefs.shiftPreferences }
                : userData.preferences,
              resume: formData?.requirements?.uploaded ?? userData.resume,
              languages: qual.languages ?? userData.languages,
            };
            const packV1 = getRequirementPackV1(requirementPackId);
            const aiScore = getUserScore(userData);
            if (packV1) {
              const summaryV1 = computeJobScoreSummaryV1(userDocForScore, requirementPackId, aiScore, new Date());
              if (summaryV1)
                jobScoreSummaryPayload = { ...summaryV1, computedAt: serverTimestamp(), writtenAt: serverTimestamp() };
            } else {
              const summary = computeJobScoreSummary(userDocForScore, requirementPackId, aiScore, new Date());
              if (summary)
                jobScoreSummaryPayload = { ...summary, computedAt: serverTimestamp() };
            }
          }

          let existingForLifecycle: Record<string, unknown> | null = null;
          try {
            const exSnap = await getDoc(tRef);
            existingForLifecycle = exSnap.exists() ? (exSnap.data() as Record<string, unknown>) : null;
          } catch {
            /* best-effort */
          }
          let tenantData: Record<string, unknown> = {};
          try {
            const ts = await getDoc(doc(db, 'tenants', tenantId));
            if (ts.exists()) tenantData = ts.data() as Record<string, unknown>;
          } catch {
            /* best-effort */
          }
          let containerData: Record<string, unknown> | null = null;
          if (effectiveJobOrderId) {
            try {
              const jos = await getDoc(doc(db, 'tenants', tenantId, 'job_orders', effectiveJobOrderId));
              if (jos.exists()) containerData = jos.data() as Record<string, unknown>;
            } catch {
              /* best-effort */
            }
          }
          const { workerAiPrescreenRequired } = mergeResolvedHiringInterview(tenantData, containerData);
          const ap = tenantData.aiPrescreen as Record<string, unknown> | undefined;
          const te = (ap?.eligibility as Record<string, unknown>) || {};
          const profileEligOpts = {
            requireResumeOrSkill: te.requireResumeOrSkill !== false && te.requireResumeOrWorkHistory !== false,
            requirePhone: te.requirePhone !== false,
            requireLocation: te.requireLocation !== false,
            // 2026-07-09: opt-in only — matches the flipped server default.
            requireWorkAuthorization: te.requireWorkAuthorization === true,
          };
          const eligForm = eligibility;
          const isC1EventsContractor = hiringEntityName != null && /C1 Events LLC/i.test(hiringEntityName);
          const authorizedToWorkUS =
            isC1EventsContractor ||
            (typeof eligForm.workAuthorized === 'boolean' ? !!eligForm.workAuthorized : false);
          const addrSrc = personal;
          const mergedAddressInfo: Record<string, unknown> = {
            ...(typeof userData.addressInfo === 'object' && userData.addressInfo
              ? (userData.addressInfo as Record<string, unknown>)
              : {}),
            ...(addrSrc.street ? { streetAddress: String(addrSrc.street).trim() } : {}),
            ...(addrSrc.unit ? { unitNumber: String(addrSrc.unit).trim() } : {}),
            ...(addrSrc.city ? { city: String(addrSrc.city).trim() } : {}),
            ...(addrSrc.state ? { state: String(addrSrc.state).trim() } : {}),
            ...(addrSrc.zip ? { zip: String(addrSrc.zip).trim() } : {}),
            ...(addrSrc.homeLat !== undefined && addrSrc.homeLng !== undefined
              ? { homeLat: Number(addrSrc.homeLat), homeLng: Number(addrSrc.homeLng) }
              : {}),
          };
          const eligibilityPhoneRaw =
            personal.phone && isValidUsPhone10(String(personal.phone))
              ? normalizeUsPhoneDigits(String(personal.phone))
              : userData.phone;
          const prevAtt = (userData.workEligibilityAttestation || {}) as Record<string, unknown>;
          const workEligibilityAttestation: Record<string, unknown> = {
            ...prevAtt,
            authorizedToWorkUS,
            requireSponsorship:
              typeof eligForm.requireSponsorship === 'boolean'
                ? eligForm.requireSponsorship
                : prevAtt.requireSponsorship,
          };
          const userDocForEligibility: Record<string, unknown> = {
            ...userData,
            workEligibility: authorizedToWorkUS,
            workAuthorization: authorizedToWorkUS,
            phone: eligibilityPhoneRaw,
            phoneE164: userData.phoneE164,
            skills: qual.skills ?? userData.skills,
            workExperience: qual.workExperience ?? userData.workExperience ?? userData.workHistory,
            workHistory: qual.workExperience ?? userData.workHistory,
            resume: formData?.requirements?.uploaded ?? userData.resume,
            addressInfo: mergedAddressInfo,
            city: addrSrc.city ?? userData.city,
            state: addrSrc.state ?? userData.state,
            zip: addrSrc.zip ?? userData.zipCode,
            workEligibilityAttestation,
          };
          const { profileEligible, profileBlockerCodes } = deriveProfileEligibilityForHiringLifecycle(
            userDocForEligibility,
            profileEligOpts,
          );
          const { hiringLifecycle: hlSubmitted } = buildHiringLifecycleOnApplicationCreate({
            applicationStatus: 'submitted',
            aiPrescreenInterviewRequired: workerAiPrescreenRequired,
            profileEligible,
            profileBlockerCodes: profileEligible ? undefined : profileBlockerCodes,
            workerAiPrescreenInterviewCompletedAt: existingForLifecycle?.workerAiPrescreenInterviewCompletedAt ?? null,
          });
          const hiringLifecycleSubmitted = applyHiringLifecycleTimestampMetadata({
            core: hlSubmitted,
            previous: hiringLifecycleCoreFromApplicationData(existingForLifecycle ?? undefined),
            nowIso: new Date().toISOString(),
          });

          // Mirror the canonical `homeAddress` write onto the application doc
          // so the trigger (`onApplicationCreatedPush`) and any downstream
          // analytics never need to load the user doc separately. Same shape
          // as `users/{uid}.homeAddress`. Falls back to undefined (no field
          // written) when the wizard somehow let through an incomplete
          // address — `addressValid` should make this unreachable.
          const applicationHomeAddress = buildCanonicalHomeAddressFromWizardPersonal(personal);

          await setDoc(
            tRef,
            {
              userId: effectiveUid,
              tenantId,
              jobId,
              jobOrderId: posting?.jobOrderId || jobOrderIdOverride || null, // CRITICAL: Link to job order if posting is connected
              status: 'submitted',
              appliedAt: serverTimestamp(),
              submittedAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              hiringLifecycle: firestoreSafeHiringLifecycle(hiringLifecycleSubmitted),
              data: safeFormData,
              applicant: {
                firstName: personal.firstName || null,
                lastName: personal.lastName || null,
                email: personal.email || null,
                phone:
                  personal.phone && isValidUsPhone10(String(personal.phone))
                    ? normalizeUsPhoneDigits(String(personal.phone))
                    : isValidUsPhone10(String(userProfile?.phone || userProfile?.phoneE164 || ''))
                      ? normalizeUsPhoneDigits(String(userProfile?.phone || userProfile?.phoneE164 || ''))
                      : null,
              },
              // Denormalized hiring-entity id so triggers don't need a JO
              // round-trip. The hiringEntityId resolved here is the same
              // value `onApplicationCreatedPush` would walk the JO for.
              hiringEntityId: posting?.hiringEntityId ?? null,
              ...(applicationHomeAddress ? { homeAddress: applicationHomeAddress } : {}),
              ...(jobScoreSummaryPayload ? { jobScoreSummary: jobScoreSummaryPayload } : {}),
              // Store shift information for gig jobs
              ...(selectedShifts.length === 1 ? { shiftId: selectedShifts[0] } : {}),
              ...(selectedShifts.length > 1 ? { shiftIds: selectedShifts } : {}),
              // Career-only: applicant's stated shift preference (non-binding; see JobPostingDetail.tsx)
              ...(preferredShiftId ? { preferredShiftId } : {}),
              // Store shift date(s) for one-shift-per-day validation
              ...(shiftDate ? { shiftDate } : {}),
              ...(shiftDates.length > 0 ? { shiftDates: [...new Set(shiftDates)] } : {}),
              // Day(s) applied for (multi-day gig): used by Applications tab day filter
              ...(applyDatePayload ? { applyDate: applyDatePayload } : {}),
              ...(applyDatesPayload && applyDatesPayload.length > 0 ? { applyDates: applyDatesPayload } : {}),
            },
            { merge: true },
          );

          // Log job application activity
          try {
            const jobTitle = posting?.jobTitle || posting?.postTitle || 'Unknown Job';
            await logJobApplicationActivity(effectiveUid!, jobId!, jobTitle, {
              applicationId: tidAppId,
              tenantId,
              jobOrderId: posting?.jobOrderId || null,
              status: 'submitted',
              ...(selectedShifts.length > 0 ? { shiftIds: selectedShifts } : {}),
            });
          } catch (logError) {
            console.warn('Failed to log job application activity:', logError);
            // Don't block submission if activity logging fails
          }

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
            selectedShifts.forEach((shiftId) => {
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
            ...(selectedShifts.length > 0
              ? {
                  selectedShifts: selectedShifts,
                  shiftAssignments: shiftAssignments,
                }
              : {}),
            // Career-only: applicant's stated shift preference (non-binding)
            ...(preferredShiftId ? { preferredShiftId } : {}),
          };

          // Add application ID to user's applicationIds array AND applicationData map
          try {
            console.log('Updating user document with application data:', {
              userId: effectiveUid,
              applicationId,
              applicationQuickData,
            });

            await setDoc(
              userRef,
              {
                applicationIds: arrayUnion(applicationId),
                [`applicationData.${applicationId}`]: applicationQuickData,
                updatedAt: serverTimestamp(),
              },
              { merge: true },
            );

            console.log('Successfully updated user document with application data');
          } catch (userUpdateError) {
            console.error('Failed to update user document with application data:', userUpdateError);
            // Don't throw here - we still want the application to be created
            // The user can be updated later via the migration script if needed
          }

          try {
            const worksite = posting?.worksiteAddress ?? {
              city: (posting as any)?.city,
              state: (posting as any)?.state,
              zipCode: (posting as any)?.worksiteAddress?.zipCode,
            };
            const wsAddr = posting?.worksiteAddress;
            await updateUserSmartGroupOnApply(effectiveUid!, tenantId, applicationId, {
              worksite: {
                city: worksite?.city,
                state: worksite?.state,
                zipCode: worksite?.zipCode,
              },
              jobTitle: posting?.jobTitle || posting?.postTitle || '',
              userAddressCity: personal?.city ?? '',
              userGeocoordinates:
                personal?.homeLat != null && personal?.homeLng != null
                  ? { lat: personal.homeLat, lng: personal.homeLng }
                  : undefined,
              skills: Array.isArray(quals?.skills)
                ? quals.skills
                    .map((s: any) => (typeof s === 'string' ? s : s?.name))
                    .filter(Boolean)
                : [],
              certifications: Array.isArray(quals?.certifications)
                ? quals.certifications
                    .map((c: any) => (typeof c === 'string' ? c : c?.name))
                    .filter(Boolean)
                : [],
              companyName: posting?.companyName,
              companyId: posting?.companyId,
              worksiteName: posting?.worksiteName,
              worksiteId: posting?.worksiteId,
              worksiteAddress: wsAddr
                ? {
                    street: wsAddr.street,
                    city: wsAddr.city,
                    state: wsAddr.state,
                    zipCode: wsAddr.zipCode,
                  }
                : undefined,
              worksiteGeocoordinates: (wsAddr as any)?.coordinates
                ? { lat: (wsAddr as any).coordinates.lat, lng: (wsAddr as any).coordinates.lng }
                : undefined,
            });
          } catch (sgErr) {
            console.warn('Smart Groups: failed to update on apply', sgErr);
          }
        }

        if (tenantId && effectiveUid) {
          try {
            await autoAddUserToApplyConfiguredGroups({
              userId: effectiveUid,
              tenantId,
              posting,
              signupGroupId,
            });
          } catch (groupSubmitErr) {
            console.error('Apply wizard: submit auto-add to user groups failed', groupSubmitErr);
          }
        }
      } catch (e) {
        console.error('Error saving application:', e);
        // Don't redirect if we didn't actually save the application doc.
        throw e;
      }

      try {
        if (effectiveUid) {
          const reminderUserRef = doc(db, 'users', effectiveUid);
          await updateDoc(reminderUserRef, {
            applyResumeSnapshot: deleteField(),
            applyWizardReminderPending: deleteField(),
            applyWizardReminderDueAt: deleteField(),
            applyWizardReminderDeferrals: deleteField(),
            applyWizardReminderLastError: deleteField(),
          });
        }
      } catch (reminderClearErr) {
        console.warn('Failed to clear apply wizard reminder fields:', reminderClearErr);
      }

      try {
        localStorage.removeItem(formStorageKey);
        localStorage.removeItem(stepStorageKey);
        localStorage.removeItem(sessionIdStorageKey);
      } catch (cleanupError) {
        console.warn('Failed to clear wizard storage keys:', cleanupError);
      }

      // Show confirmation screen instead of redirecting immediately
      setSubmittedSuccess(true);
      setSaving(false);
      return;
    } catch (err: any) {
      console.error('Submit error:', err);
      try {
        alert(
          t('apply.couldNotSubmitApplication') +
            (err?.message ? '\n\n' + t('apply.details') + ': ' + err.message : ''),
        );
      } catch {}
    } finally {
      setSaving(false);
    }
  };

  const renderStep = () => {
    switch (actualStep) {
      case 0:
        return (
          <PersonalInfoStep
            value={formData.personal || {}}
            onChange={(v) => persist({ personal: v })}
            onPasswordChange={(pwd, confirmPwd) => {
              setPassword(pwd);
              setConfirmPassword(confirmPwd);
            }}
            showAddressFields={false}
          />
        );
      case 1:
        return (
          <AddressStep value={formData.personal || {}} onChange={(v) => persist({ personal: v })} />
        );
      case 2:
        return (
          <Box>
            <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ display: 'block', mb: 1 }}>
              {t('apply.profileImprovementOptional')}
            </Typography>
            <ResumeStep
              value={{ ...(formData.resume || {}), userId: uid || '' }}
              onChange={(v) => persist({ resume: v })}
              tenantId={tenantId}
            />
          </Box>
        );
      case 3:
        return (
          <EVerifyComfortStep
            variant="generic"
            value={String((formData.requirements || {}).eVerifyComfort || '')}
            onChange={(comfort) =>
              persist({
                requirements: { ...(formData.requirements || {}), eVerifyComfort: comfort },
              })
            }
          />
        );
      case 4:
        return (
          <WorkEligibilityStep
            value={formData.eligibility || {}}
            onChange={(v) => persist({ eligibility: v })}
            onSkipOptionalEeo={eeoSkippable ? handleSkipOptionalEeo : undefined}
          />
        );
      case 5:
        return (
          <ProfilePictureStep
            value={formData.profilePicture || {}}
            onChange={(v) => persist({ profilePicture: v })}
            userId={auth.currentUser?.uid || uid || undefined}
            onSkip={handleNext}
          />
        );
      case 6:
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
      case 7:
        return (
          <Box>
            <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ display: 'block', mb: 1 }}>
              {t('apply.profileImprovementOptional')}
            </Typography>
            <EducationStep
            value={formData.qualifications || {}}
            onChange={(v) => persist({ qualifications: v })}
            context="application"
            tenantId={tenantId}
            jobId={jobId}
            jobPosting={posting}
            showOnly="education"
          />
          </Box>
        );
      case 8:
        return (
          <Box>
            <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ display: 'block', mb: 1 }}>
              {t('apply.profileImprovementOptional')}
            </Typography>
            <EducationStep
            value={formData.qualifications || {}}
            onChange={(v) => persist({ qualifications: v })}
            context="application"
            tenantId={tenantId}
            jobId={jobId}
            jobPosting={posting}
            showOnly="certifications"
            onRequiredCertsStatusChange={setHasMissingRequiredCerts}
          />
          </Box>
        );
      case 9:
        return (
          <Box>
            <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ display: 'block', mb: 1 }}>
              {t('apply.profileImprovementOptional')}
            </Typography>
            <WorkExperienceStep
            value={formData.qualifications || {}}
            onChange={(v) => persist({ qualifications: v })}
            context="application"
            tenantId={tenantId}
            jobId={jobId}
            jobPosting={posting}
            resumeData={formData.resume || userProfile?.resume || null}
          />
          </Box>
        );
      case 10:
        return (
          <BioStep
            value={formData.bio || {}}
            onChange={(v) => persist({ bio: v })}
            jobPosting={posting}
          />
        );
      case 11:
        return (
          <Box>
            <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ display: 'block', mb: 1 }}>
              {t('apply.profileImprovementOptional')}
            </Typography>
            <JobPreferencesStep
            value={formData.preferences || {}}
            onChange={(v) => persist({ preferences: v })}
            jobPosting={posting}
          />
          </Box>
        );
      case 12:
        return (
          <Box>
            {shiftSummaryData && (shiftSummaryData.dateLabel || shiftSummaryData.pay || shiftSummaryData.location) && (
              <Paper
                variant="outlined"
                sx={{
                  p: 2,
                  mb: 2,
                  borderRadius: 2,
                  bgcolor: 'grey.50',
                }}
              >
                <Stack spacing={1}>
                  {(shiftSummaryData.dateLabel || shiftSummaryData.timeLabel) && (
                    <Box>
                      <Typography variant="caption" color="text.secondary" fontWeight={600}>
                        {t('apply.shiftSummary')}
                      </Typography>
                      <Typography variant="body1">
                        {shiftSummaryData.dateLabel}
                        {shiftSummaryData.timeLabel ? `\n${shiftSummaryData.timeLabel}` : ''}
                      </Typography>
                    </Box>
                  )}
                  {shiftSummaryData.pay && (
                    <Box>
                      <Typography variant="caption" color="text.secondary" fontWeight={600}>
                        {t('apply.pay')}
                      </Typography>
                      <Typography variant="body1">{shiftSummaryData.pay}</Typography>
                    </Box>
                  )}
                  {shiftSummaryData.location && (
                    <Box>
                      <Typography variant="caption" color="text.secondary" fontWeight={600}>
                        {t('apply.location')}
                      </Typography>
                      <Typography variant="body1">{shiftSummaryData.location}</Typography>
                    </Box>
                  )}
                </Stack>
              </Paper>
            )}
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

  const pctComplete = Math.round(((activeStep + 1) / visibleStepIndices.length) * 100);

  const conversationalTitleKeys = [
    'apply.titleTellUsAboutYou',
    'apply.addLocation',
    'apply.titleUploadResume',
    'apply.stepEVerifyComfort',
    'apply.titleWorkAuthorization',
    'apply.titleAddProfilePicture',
    'apply.titleQualificationsSkills',
    'apply.titleEducation',
    'apply.titleLicensesCertifications',
    'apply.titleWorkExperience',
    'apply.titleTellUsAboutYourself',
    'apply.titleJobPreferences',
    'apply.titleRequirements',
  ];
  const conversationalTitles = conversationalTitleKeys.map((k) => t(k));

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

    // If the new phone is empty or not a full US number, don't require verification
    if (!isValidUsPhone10(newPhone)) return false;

    return true;
  })();

  // Personal Info validation (step 0) - no address required. Normalize dob from Firestore (Timestamp/Date) so pre-filled data passes.
  const personalValid = (() => {
    const p = formData?.personal;
    if (!p) return false;
    const firstName = typeof p.firstName === 'string' ? p.firstName.trim() : '';
    const lastName = typeof p.lastName === 'string' ? p.lastName.trim() : '';
    const email = typeof p.email === 'string' ? p.email.trim() : '';
    const phone = String(p.phone ?? '').trim();
    const dob = toDobString(p.dob);
    return !!(
      firstName &&
      lastName &&
      email &&
      isValidUsPhone10(phone) &&
      dob &&
      dob.length >= 10
    );
  })();

  // Address validation (step 1).
  //
  // Hard rule: the user MUST select an address from Google Places (placeId
  // present). Free-typed addresses are no longer accepted — `AddressStep`
  // strips structured fields on raw typing and shows the inline "select from
  // dropdown" error. Wizard-side gate enforces the same constraint so deep
  // links / restored drafts can't bypass it.
  //
  // We deliberately keep the full structural check (street/city/state/zip +
  // numeric lat/lng) so partial Place results (international Places without
  // postal_code, for example) still fail closed.
  const addressValid = isApplyHomeAddressValid(formData?.personal || {});

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
    (formData?.profilePicture?.profilePicture &&
      String(formData.profilePicture.profilePicture).trim()) ||
    (userProfile?.avatar && String(userProfile.avatar).trim())
  );

  const applicationsPath = tenantSlug ? `/${tenantSlug}/applications` : '/c1/applications';
  const jobsBoardPath = tenantSlug ? `/${tenantSlug}/jobs-board` : '/c1/jobs-board';
  // Worker payroll lives under the c1 slug regardless of which tenant the
  // application was for — it's a fixed worker-facing surface backed by
  // `WorkerPayrollIndex` (auto-redirects to the Everee embed when there's
  // exactly one provisioned employer; falls back to a "no payroll yet" /
  // dashboard link when Everee hasn't provisioned yet, e.g. because the
  // background hire-automation trigger hasn't fired before this redirect
  // lands). Confirmed with Greg 2026-05-08: always `c1`.
  const payrollPath = '/c1/workers/payroll';

  if (submittedSuccess) {
    // Came from JobPostingDetail's per-shift Apply (returnTo=/c1/jobs-board/
    // {postId}) → bounce straight back to the shift list so they can apply
    // to more shifts on the same JO. That flow is fine to auto-redirect.
    if (returnTo) {
      return (
        <Box sx={{ px: 0, py: 0, display: 'flex', flexDirection: 'column' }}>
          <PostSubmitRedirect
            to={returnTo}
            delayMs={1500}
            headlineKey="apply.applicationSubmittedMessage"
            subheadKey="apply.settingUpPayroll"
            helperKey="apply.settingUpPayrollHelper"
            applicationsPath={applicationsPath}
            jobsBoardPath={jobsBoardPath}
            t={t}
          />
        </Box>
      );
    }

    // Group / auto-hire apply (no returnTo): DON'T force them into Everee
    // payroll. Workers kept thinking onboarding was required before they
    // could pick up shifts. Show a clear choice — find shifts now, or set
    // up payroll — and make it explicit payroll can be finished later
    // (it's also surfaced as a dashboard action item).
    return (
      <Box sx={{ px: 0, py: 0, display: 'flex', flexDirection: 'column' }}>
        <Paper elevation={0} sx={{ maxWidth: 480, mx: 'auto', mt: { xs: 4, md: 6 }, p: 3, textAlign: 'center' }}>
          <Typography variant="h6" sx={{ mb: 1, fontWeight: 700 }}>
            {t('apply.hiredTitle')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
            {t('apply.hiredPayrollOptional')}
          </Typography>
          <Stack spacing={1.25} sx={{ mb: 1.5 }}>
            <Button variant="contained" size="large" fullWidth onClick={() => navigate(jobsBoardPath)}>
              {t('apply.findShifts')}
            </Button>
            <Button variant="outlined" size="large" fullWidth onClick={() => navigate(payrollPath)}>
              {t('apply.setUpPayroll')}
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {t('apply.payrollLaterHint')}
          </Typography>
        </Paper>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        px: 0,
        py: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Job Details Header */}
      {posting && (
        <Box
          sx={{
            px: { xs: 2, md: 3 },
            py: { xs: 2, md: 2.5 },
            backgroundColor: 'background.paper',
            borderBottom: 1,
            borderColor: 'divider',
            flexShrink: 0,
          }}
        >
          <Box
            sx={{
              maxWidth: { xs: '100%', md: '1200px' },
              mx: { xs: 0, md: 'auto' },
            }}
          >
            <Typography variant={isMobile ? 'h6' : 'h5'} sx={{ fontWeight: 600, mb: 0.5 }}>
              {posting.jobTitle || posting.postTitle || t('apply.jobApplication')}
            </Typography>
            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
              <Typography variant="body2" color="text.secondary">
                {posting.city && posting.state
                  ? `${posting.city}, ${posting.state}`
                  : posting.worksiteName || ''}
              </Typography>
              {(() => {
                const payLbl = formatHourlyPayRateForDisplay(posting.payRate);
                return payLbl ? (
                  <>
                    <Typography variant="body2" color="text.secondary">
                      •
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {payLbl}
                    </Typography>
                  </>
                ) : null;
              })()}
            </Stack>
          </Box>
        </Box>
      )}

      {/* Main content area - framed on desktop; no min height so buttons sit under form */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          maxWidth: { xs: '100%', md: '1200px' },
          mx: { xs: 0, md: 'auto' },
          width: '100%',
          px: { xs: 0, md: 3 },
          py: { xs: 0, md: 2 },
        }}
      >
        <Paper
          elevation={isMobile ? 0 : 2}
          sx={{
            display: 'flex',
            flexDirection: 'column',
            borderRadius: { xs: 0, md: 2 },
            overflow: 'hidden',
            backgroundColor: 'background.paper',
          }}
        >
          {/* Full-bleed sticky progress under top bar (grouped: Personal, Skills, Experience, Verification, Final) */}
          <MilestoneProgress
            total={progressTotal}
            completed={progressCompleted}
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
                <Step key={label}>
                  <StepLabel>{label}</StepLabel>
                </Step>
              ))}
            </Stepper>
          </Box>

          <Box
            sx={{
              mt: 2,
              mx: 0,
              px: { xs: 1, md: 3 },
              py: 0,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {renderStep()}
          </Box>

          {/* Back/Next bar directly under form */}
          <Box
            sx={{
              width: '100%',
              mt: 2,
              mb: 2,
              bgcolor: 'background.paper',
              borderTop: 1,
              borderColor: 'divider',
              py: 1.5,
              px: { xs: 2, md: 3 },
            }}
          >
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              flexWrap="wrap"
              gap={1}
            >
              <Button onClick={handleBack} disabled={activeStep === 0}>
                {t('apply.back')}
              </Button>
              {actualStep === 5 ? (
                <Stack
                  direction="row"
                  spacing={1}
                  flexWrap="wrap"
                  justifyContent="flex-end"
                  sx={{ flex: 1, minWidth: 0 }}
                >
                  <Button
                    variant="outlined"
                    onClick={isLastVisibleStep ? handleSubmit : handleNext}
                    disabled={saving}
                  >
                    {t('apply.addPhotoLater')}
                  </Button>
                  <Button
                    variant="contained"
                    onClick={isLastVisibleStep ? handleSubmit : handleNext}
                    disabled={saving}
                  >
                    {t('apply.continueWithoutPhoto')}
                  </Button>
                </Stack>
              ) : actualStep === 2 ? (
                <Stack
                  direction="row"
                  spacing={1}
                  flexWrap="wrap"
                  justifyContent="flex-end"
                  sx={{ flex: 1, minWidth: 0 }}
                >
                  <Button
                    variant="outlined"
                    onClick={isLastVisibleStep ? handleSubmit : handleNext}
                    disabled={saving}
                  >
                    {t('apply.addResumeLater')}
                  </Button>
                  <Button
                    variant="contained"
                    onClick={isLastVisibleStep ? handleSubmit : handleNext}
                    disabled={saving}
                  >
                    {t('apply.continueWithoutResume')}
                  </Button>
                </Stack>
              ) : (
                <Button
                  variant="contained"
                  onClick={isLastVisibleStep ? handleSubmit : handleNext}
                  disabled={
                    (isLastVisibleStep &&
                      actualStep === 12 &&
                      (missing.drug ||
                        missing.background ||
                        missing.everify ||
                        missing.additional.length > 0)) ||
                    (actualStep === 0 &&
                      (!personalValid ||
                        (!auth.currentUser &&
                          (password.length < 6 || password !== confirmPassword)))) ||
                    (actualStep === 1 && !addressValid) ||
                    (actualStep === 3 &&
                      !String(formData?.requirements?.eVerifyComfort || '').trim()) ||
                    (actualStep === 4 && formData?.eligibility?.workAuthorized !== true) ||
                    saving
                  }
                >
                  {isLastVisibleStep
                    ? t('apply.submitApplication')
                    : actualStep === 8 && hasMissingRequiredCerts
                    ? t('apply.skipForNow')
                    : t('apply.next')}
                </Button>
              )}
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
          advanceStep();
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
          <Button onClick={handleBack} disabled={activeStep === 0} aria-label={t('apply.back')}>
            {t('apply.back')}
          </Button>
          <Button
            variant="contained"
            onClick={isLastVisibleStep ? handleSubmit : handleNext}
            aria-label={
              isLastVisibleStep
                ? t('apply.submitApplication')
                : actualStep === 2 || actualStep === 5
                ? t('apply.continueWithoutResume')
                : actualStep === 8 && hasMissingRequiredCerts
                ? t('apply.skipForNow')
                : t('apply.next')
            }
            disabled={
              (isLastVisibleStep &&
                actualStep === 12 &&
                (missing.drug ||
                  missing.background ||
                  missing.everify ||
                  missing.additional.length > 0)) ||
              saving
            }
          >
            {isLastVisibleStep
              ? t('apply.submitApplication')
              : actualStep === 2 || actualStep === 5
              ? t('apply.continueWithoutResume')
              : actualStep === 8 && hasMissingRequiredCerts
              ? t('apply.skipForNow')
              : t('apply.next')}
          </Button>
        </Stack>
      </Box>
      <Snackbar
        open={submitOpen}
        autoHideDuration={4000}
        onClose={() => setSubmitOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setSubmitOpen(false)} severity="success" sx={{ width: '100%' }}>
          {t('apply.thanksSubmitted')}
        </Alert>
      </Snackbar>
      <Backdrop
        open={submitting}
        sx={{
          color: '#fff',
          zIndex: (theme) => theme.zIndex.modal + 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <CircularProgress color="inherit" />
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {t('apply.submittingApplication')}
        </Typography>
      </Backdrop>
    </Box>
  );
};

export default Wizard;

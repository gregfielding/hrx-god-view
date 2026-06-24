import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  CircularProgress,
  Alert,
  Stack,
  Paper,
  Grid,
  useTheme,
  useMediaQuery,
  Snackbar,
  Skeleton,
  Menu,
  MenuItem,
  Tooltip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  LinearProgress,
  Checkbox,
  FormControlLabel,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CheckCircle from '@mui/icons-material/CheckCircle';
import {
  LocationOn as LocationIcon,
  Work as WorkIcon,
  AttachMoney as MoneyIcon,
  Schedule as ScheduleIcon,
  Business as BusinessIcon,
  ArrowBack as ArrowBackIcon,
  ContentCopy as ContentCopyIcon,
  VerifiedUser as VerifiedIcon,
  Lock as LockIcon,
  Language as LanguageIcon,
  Map as MapIcon,
  Checkroom as CheckroomIcon,
  Engineering as EngineeringIcon,
  OpenInNew as OpenInNewIcon,
  Directions as DirectionsIcon,
} from '@mui/icons-material';
import IconButton from '@mui/material/IconButton';
import { doc, getDoc, collection, query, where, getDocs, updateDoc, arrayUnion, arrayRemove, serverTimestamp, deleteField, setDoc, deleteDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useGuestLanguage } from '../hooks/useGuestLanguage';
import { useT, setLanguage, useLanguage } from '../i18n';
import { formatHeadshotGateError } from '../utils/avatarVerification/formatHeadshotGateError';
import { formatDistanceToNow, format } from 'date-fns';
import { enUS, es as esLocale } from 'date-fns/locale';
import ShiftSelector from '../components/ShiftSelector';
import { JobsBoardService } from '../services/recruiter/jobsBoardService';
import { formatWeeklyScheduleSummary } from '../utils/weeklySchedule';
import { getDateScheduleEntriesWithHours, getLastShiftDateFromShifts } from '../utils/dateSchedule';
import { extractDateFromShiftDate } from '../utils/gigShiftApplicationLimits';
import {
  buildAppliedKeysForApplication,
  getApplicationAppliedDays,
  getApplicationShiftIds,
  isGigMultiDayShift,
} from '../utils/gigShiftState';
import { updateUserSmartGroupOnWithdraw } from '../services/smartGroupService';
import type { JobScoreSummary, JobScoreSummaryStored } from '../types/jobScore';
import { getRequirementsWithStatus, getRequirementsWithStatusForJobPost, getEligibilitySummary } from '../utils/jobRequirementStatus';
import { WORKER_SCREENING_SHORT_FALLBACK } from '../utils/backgroundChecks/formatWorkerFacingScreeningPackage';
import { RequirementInteraction } from '../components/RequirementInteraction';
import { getJobPostingDisplayText, localizeJobDescriptionEmbeddedLabels } from '../utils/jobPostingI18n';
import { logAssignmentUpdateActivity } from '../utils/activityLogger';
import { buildCanonicalWorkerProfileWritePatch } from '../utils/workerReadinessWriteModel';
import { formatHourlyPayAmountForI18n } from '../utils/hourlyPayDisplay';
import AuthDialog from '../components/AuthDialog';
import WorkerBottomSheet from '../components/worker/WorkerBottomSheet';

const JobPostingDetail: React.FC = () => {
  const { postId, tenantSlug } = useParams<{ postId: string; tenantSlug?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { tenantId: authTenantId, user } = useAuth();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  // Determine tenant ID: use auth tenantId if logged in, otherwise extract from URL
  const isC1Route = location.pathname.startsWith('/c1/');
  const resolvedTenantId = authTenantId || (isC1Route ? 'BCiP2bQ9CgVOCTfV6MhD' : null);

  const [posting, setPosting] = useState<any>(null);
  // Bumped on tab focus/visibility so the posting itself re-loads (picks up
  // recruiter edits like the "Show spots remaining" toggle without a manual
  // refresh). The applied-shifts effect already refreshes on focus.
  const [postingRefresh, setPostingRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedShifts, setSelectedShifts] = useState<string[]>([]);
  const [dynamicShifts, setDynamicShifts] = useState<any[]>([]);
  const [loadingShifts, setLoadingShifts] = useState(false);
  const [careerWeeklyScheduleSummary, setCareerWeeklyScheduleSummary] = useState<string>('');
  const [appliedShifts, setAppliedShifts] = useState<string[]>([]);
  const [shiftStatuses, setShiftStatuses] = useState<Record<string, string>>({}); // Map shiftId -> status
  /**
   * Map keyed by `${shiftId}__${YYYY-MM-DD}` (day-scoped) or `${shiftId}`
   * (legacy fallback) → assignmentId. Built alongside `shiftStatuses` in
   * `loadAppliedShifts` and handed to ShiftSelector so confirmed shift
   * rows render a clickable "View Details" CTA that jumps to
   * /c1/workers/assignments/{assignmentId}.
   */
  const [assignmentIdsByShiftKey, setAssignmentIdsByShiftKey] = useState<Record<string, string>>({});
  // Shift key → worker-cancelled assignmentId, so "Re-apply to Shift" can
  // delete the old assignment before creating a fresh application.
  const [reapplyAssignmentIdByShiftKey, setReapplyAssignmentIdByShiftKey] = useState<Record<string, string>>({});
  const [appliedShiftsRefresh, setAppliedShiftsRefresh] = useState(0); // Increment to reload applied shifts (e.g. after cancel for day)
  const [applicationStatus, setApplicationStatus] = useState<string | null>(null);
  /** Bumped after quick apply so application status is re-read while staying on this URL. */
  const [applicationStatusReloadKey, setApplicationStatusReloadKey] = useState(0);
  const [applicationDocId, setApplicationDocId] = useState<string | null>(null);
  const [applicationJobScore, setApplicationJobScore] = useState<JobScoreSummaryStored | null>(null);
  const [acceptedAssignmentId, setAcceptedAssignmentId] = useState<string | null>(null);
  /**
   * One-click DECLINE intent state (SMS link → `?intent=decline&assignmentId=…`).
   *
   * Lands the worker on this job-post page instead of the assignment
   * details page so they can immediately re-apply to a different shift
   * after declining. The effect below fires `respondToAssignment` on
   * mount, surfaces a confirmation banner, and strips the intent query
   * so a refresh / share doesn't re-fire the decline.
   *
   * Idempotency mirrors the AssignmentDetails accept handler — skip
   * when status is already terminal, fire only once per visit.
   */
  const [declineIntentState, setDeclineIntentState] = useState<
    'idle' | 'firing' | 'success' | 'error' | 'skipped'
  >('idle');
  const [declineIntentError, setDeclineIntentError] = useState<string | null>(null);
  // One-click ACCEPT intent (SMS link → `?intent=accept&assignmentId=…`):
  // open the offer-confirmation sheet for the offered shift once.
  const [acceptIntentHandled, setAcceptIntentHandled] = useState(false);
  const [assignmentStartDate, setAssignmentStartDate] = useState<any>(null); // recruiter-set start date when worker has assignment
  const [assignmentData, setAssignmentData] = useState<any>(null); // full assignment doc when in accept/decline mode
  const [scheduleShiftData, setScheduleShiftData] = useState<any>(null); // shift doc for schedule card
  const [assignmentDecisionLoading, setAssignmentDecisionLoading] = useState(false); // prevent double-clicks on I Accept / Decline
  const [offerConfirmationOpen, setOfferConfirmationOpen] = useState(false);
  const [offerConfirmationShiftId, setOfferConfirmationShiftId] = useState<string | undefined>(undefined);
  const [offerConfirmSubmitting, setOfferConfirmSubmitting] = useState(false);
  const [offerConfirmError, setOfferConfirmError] = useState<string | null>(null);
  const [ackOnTimeArrival, setAckOnTimeArrival] = useState(false);
  const [ackUniformAndRequirements, setAckUniformAndRequirements] = useState(false);
  const [ackNoShowConsequence, setAckNoShowConsequence] = useState(false);
  const [shareSnackbarOpen, setShareSnackbarOpen] = useState(false);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [applicationData, setApplicationData] = useState<any>(null);
  const [languageMenuAnchorEl, setLanguageMenuAnchorEl] = useState<null | HTMLElement>(null);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [guestLanguage, setGuestLanguage] = useGuestLanguage();
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationPermission, setLocationPermission] = useState<'prompt' | 'granted' | 'denied'>('prompt');
  const [distanceMiles, setDistanceMiles] = useState<number | null>(null);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [scrolledPastHeader, setScrolledPastHeader] = useState(false);
  const heroHeaderRef = useRef<HTMLDivElement>(null);
  const t = useT();

  useEffect(() => {
    const onScroll = () => {
      const hero = heroHeaderRef.current;
      if (!hero) return;
      const rect = hero.getBoundingClientRect();
      setScrolledPastHeader(rect.bottom < 0);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Haversine distance in miles (for location section)
  const haversineMiles = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 3959;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // Job site coordinates (worksiteAddress may have coordinates.lat/lng or coordinates.latitude/longitude)
  const jobCoords = useMemo(() => {
    const c = posting?.worksiteAddress?.coordinates;
    if (!c) return null;
    const lat = (c as { lat?: number; latitude?: number }).lat ?? (c as { latitude?: number }).latitude;
    const lng = (c as { lng?: number; longitude?: number }).lng ?? (c as { longitude?: number }).longitude;
    if (lat == null || lng == null || typeof lat !== 'number' || typeof lng !== 'number') return null;
    return { lat, lng };
  }, [posting?.worksiteAddress?.coordinates]);

  // Compute distance when we have both user and job coordinates
  useEffect(() => {
    if (!userLocation || !jobCoords) {
      setDistanceMiles(null);
      return;
    }
    setDistanceMiles(haversineMiles(userLocation.lat, userLocation.lng, jobCoords.lat, jobCoords.lng));
  }, [userLocation, jobCoords]);

  const requestLocationForDistance = () => {
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({ lat: position.coords.latitude, lng: position.coords.longitude });
        setLocationPermission('granted');
      },
      () => setLocationPermission('denied'),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  };
  // Single source of truth for content language: i18n (layout + app bar when logged in; guest selector when guest)
  const displayLanguage = useLanguage();
  const dateFnsLocale = displayLanguage === 'es' ? esLocale : enUS;

  // Eligibility for requirements UX (must be before any early return to satisfy rules-of-hooks)
  const eligibilitySummary = useMemo(
    () => (posting ? getEligibilitySummary(posting, userProfile, applicationData) : null),
    [posting, userProfile, applicationData]
  );
  const allRequirementsCategories = useMemo(
    () => (posting ? getRequirementsWithStatus(posting, userProfile, applicationData) : []),
    [posting, userProfile, applicationData]
  );
  const [requirementsExpanded, setRequirementsExpanded] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (allRequirementsCategories.length === 0) return;
    setRequirementsExpanded((prev) => {
      let changed = false;
      const next = { ...prev };
      allRequirementsCategories.forEach((cat) => {
        if (next[cat.category] === undefined) {
          next[cat.category] = !cat.items.every((i) => i.met);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [allRequirementsCategories]);

  // Only sync guest language → i18n when user is NOT logged in. Logged-in language is driven by C1WorkerLayout + WorkerAppBar (Firestore preferredLanguage); never overwrite with localStorage.
  useEffect(() => {
    if (!user) setLanguage(guestLanguage);
  }, [user, guestLanguage]);

  useEffect(() => {
    console.debug('[JobDetails] init', {
      route: '/c1/jobs-board/:postId',
      params: { postId: postId ?? null, tenantSlug: tenantSlug ?? null },
      resolvedTenantId: resolvedTenantId ?? null,
    });
    if (!resolvedTenantId || !postId) {
      console.log('⚠️ Missing tenantId or postId:', {
        resolvedTenantId,
        postId,
        isC1Route,
        authTenantId,
      });
      setLoading(false);
      setError(!postId ? 'Missing postId route parameter' : 'Missing tenant context for job details');
      return;
    }

    const loadPosting = async () => {
      try {
        setLoading(true);
        console.log('🔄 Loading job posting:', { resolvedTenantId, postId });

        // Check if this is a job order ID (prefixed with "job-order-")
        if (postId.startsWith('job-order-')) {
          const jobOrderId = postId.replace('job-order-', '');
          console.log('📋 Loading as job order:', jobOrderId);
          const jobOrderRef = doc(db, 'tenants', resolvedTenantId, 'job_orders', jobOrderId);
          const jobOrderSnap = await getDoc(jobOrderRef);

          if (jobOrderSnap.exists()) {
            console.log('✅ Job order found');
            const jobOrderData = jobOrderSnap.data();

            // Convert job order to posting format
            const payRate =
              (jobOrderData.gigPositions?.[0]?.payRate
                ? parseFloat(String(jobOrderData.gigPositions[0].payRate))
                : jobOrderData.payRate) || undefined;

            const jobTitle =
              jobOrderData.gigPositions?.[0]?.jobTitle || jobOrderData.jobTitle || '';

            const shift = Array.isArray(jobOrderData.shiftType)
              ? jobOrderData.shiftType
              : jobOrderData.shiftType
              ? [jobOrderData.shiftType]
              : [];

            // Convert dates
            const startDate = jobOrderData.startDate?.toDate
              ? jobOrderData.startDate.toDate()
              : jobOrderData.startDate
              ? new Date(jobOrderData.startDate)
              : undefined;
            const endDate = jobOrderData.endDate?.toDate
              ? jobOrderData.endDate.toDate()
              : jobOrderData.endDate
              ? new Date(jobOrderData.endDate)
              : undefined;

            setPosting({
              id: postId,
              jobOrderId: jobOrderId,
              tenantId: resolvedTenantId,
              postTitle: jobOrderData.jobOrderName || jobTitle,
              postTitle_i18n: jobOrderData.postTitle_i18n ?? jobOrderData.jobOrderName_i18n,
              jobTitle: jobTitle,
              jobTitle_i18n: jobOrderData.jobTitle_i18n,
              jobType: 'gig',
              jobDescription: jobOrderData.jobOrderDescription || jobOrderData.jobDescription || '',
              jobDescription_i18n: jobOrderData.jobDescription_i18n ?? jobOrderData.jobOrderDescription_i18n,
              companyName: jobOrderData.companyName || '',
              worksiteName: jobOrderData.worksiteName || '',
              worksiteAddress: jobOrderData.worksiteAddress || {
                street: '',
                city: jobOrderData.worksiteAddress?.city || '',
                state: jobOrderData.worksiteAddress?.state || '',
                zipCode: jobOrderData.worksiteAddress?.zipCode || '',
              },
              startDate: startDate,
              endDate: endDate,
              payRate: payRate,
              showPayRate: jobOrderData.showPayRate || false,
              workersNeeded: jobOrderData.workersNeeded,
              showWorkersNeeded:
                jobOrderData.showWorkersNeeded !== undefined
                  ? jobOrderData.showWorkersNeeded
                  : false, // Default to false so workers needed is hidden unless explicitly enabled
              eVerifyRequired: jobOrderData.eVerifyRequired || false,
              backgroundCheckPackages: Array.isArray(jobOrderData.backgroundCheckPackages)
                ? jobOrderData.backgroundCheckPackages
                : [],
              drugScreeningPanels: Array.isArray(jobOrderData.drugScreeningPanels)
                ? jobOrderData.drugScreeningPanels
                : [],
              additionalScreenings: Array.isArray(jobOrderData.additionalScreenings)
                ? jobOrderData.additionalScreenings
                : [],
              skills: Array.isArray(jobOrderData.skillsRequired) ? jobOrderData.skillsRequired : [],
              licensesCerts: Array.isArray(jobOrderData.requiredLicenses)
                ? [
                    ...jobOrderData.requiredLicenses,
                    ...(Array.isArray(jobOrderData.requiredCertifications)
                      ? jobOrderData.requiredCertifications
                      : []),
                  ]
                : Array.isArray(jobOrderData.requiredCertifications)
                ? jobOrderData.requiredCertifications
                : [],
              experienceLevels: Array.isArray(jobOrderData.experienceRequired)
                ? jobOrderData.experienceRequired
                : jobOrderData.experienceRequired
                ? [jobOrderData.experienceRequired]
                : [],
              educationLevels: Array.isArray(jobOrderData.educationRequired)
                ? jobOrderData.educationRequired
                : jobOrderData.educationRequired
                ? [jobOrderData.educationRequired]
                : [],
              languages: Array.isArray(jobOrderData.languagesRequired)
                ? jobOrderData.languagesRequired
                : [],
              physicalRequirements: Array.isArray(jobOrderData.physicalRequirements)
                ? jobOrderData.physicalRequirements
                : jobOrderData.physicalRequirements
                ? [jobOrderData.physicalRequirements]
                : [],
              uniformRequirements: Array.isArray(jobOrderData.uniformRequirements)
                ? jobOrderData.uniformRequirements
                : jobOrderData.uniformRequirements
                ? [jobOrderData.uniformRequirements]
                : [],
              requiredPpe: Array.isArray(jobOrderData.ppeRequirements)
                ? jobOrderData.ppeRequirements
                : jobOrderData.ppeRequirements
                ? [jobOrderData.ppeRequirements]
                : [],
              // Show flags
              showBackgroundChecks: jobOrderData.showBackgroundChecks || false,
              showDrugScreening: jobOrderData.showDrugScreening || false,
              showAdditionalScreenings: jobOrderData.showAdditionalScreenings || false,
              showSkills: jobOrderData.showSkills || false,
              showLicensesCerts: jobOrderData.showLicensesCerts || false,
              showExperience: jobOrderData.showExperience || false,
              showEducation: jobOrderData.showEducation || false,
              showLanguages: jobOrderData.showLanguages || false,
              showPhysicalRequirements: jobOrderData.showPhysicalRequirements || false,
              showUniformRequirements: jobOrderData.showUniformRequirements || false,
              showRequiredPpe: jobOrderData.showRequiredPpe || false,
              shift: shift,
              showShift: shift.length > 0,
              status: 'active',
              visibility: jobOrderData.jobsBoardVisibility || jobOrderData.visibility || 'public',
              usesDynamicShifts: true, // Always use dynamic shifts for job orders
            });
          } else {
            console.error('❌ Job order not found:', { resolvedTenantId, jobOrderId });
            setError('Job order not found');
          }
        } else {
          // Regular posting ID - load from job_postings
          console.log('📄 Loading as job posting:', postId);
          const postRef = doc(db, 'tenants', resolvedTenantId, 'job_postings', postId);
          const postSnap = await getDoc(postRef);

          if (postSnap.exists()) {
            console.log('✅ Job posting found:', postSnap.id);
            const postData = postSnap.data();
            console.log('📊 Post data:', {
              id: postSnap.id,
              visibility: postData.visibility,
              status: postData.status,
              postTitle: postData.postTitle,
            });
            setPosting({
              id: postSnap.id,
              ...postData,
              // Default to false so workers needed is hidden unless explicitly enabled
              showWorkersNeeded:
                postData.showWorkersNeeded !== undefined ? postData.showWorkersNeeded : false,
            });
            console.debug('[JobDetails] fetch success', {
              postId: postSnap.id,
              tenantId: resolvedTenantId,
            });
          } else {
            console.error('❌ Job posting not found:', { resolvedTenantId, postId });
            setError('Job posting not found');
          }
        }
      } catch (err: any) {
        console.error('❌ Error loading job posting:', err);
        console.error('[JobDetails] fetch failure', {
          postId,
          tenantId: resolvedTenantId,
          code: err?.code,
          message: err?.message,
        });
        console.error('Error details:', {
          code: err.code,
          message: err.message,
          stack: err.stack,
        });
        // Provide more detailed error message
        if (err.code === 'permission-denied') {
          setError('Permission denied. This job posting may not be publicly visible.');
        } else if (err.code === 'not-found') {
          setError('Job posting not found');
        } else {
          setError(err.message || 'Failed to load job posting');
        }
      } finally {
        setLoading(false);
      }
    };

    loadPosting();
  }, [resolvedTenantId, postId, postingRefresh]);

  // Load application status when posting and user are available
  useEffect(() => {
    const loadApplicationStatus = async () => {
      if (!posting || !user?.uid || !resolvedTenantId || !postId) {
        setApplicationStatus(null);
        return;
      }

      try {
        // Query applications using the same approach as loadAppliedShifts
        // This respects Firestore security rules better than direct document access
        const applicationsRef = collection(db, 'tenants', resolvedTenantId, 'applications');

        // Query by userId and jobId (posting ID)
        const q1 = query(
          applicationsRef,
          where('userId', '==', user.uid),
          where('jobId', '==', postId),
        );

        // Also query by jobOrderId if this is a gig job with a jobOrderId
        const queries: Promise<any>[] = [getDocs(q1)];

        if (posting?.jobOrderId) {
          const q2 = query(
            applicationsRef,
            where('userId', '==', user.uid),
            where('jobOrderId', '==', posting.jobOrderId),
          );
          queries.push(getDocs(q2));
        }

        const snapshots = await Promise.all(queries);

        // Find the first application that matches and is not removed (deleted)
        // When admin clicks "Remove Application", status is set to 'deleted' — treat as no application so worker can apply again
        let foundStatus: string | null = null;
        let foundDocId: string | null = null;
        let foundJobScore: JobScoreSummaryStored | null = null;
        const isRemoved = (status: string | undefined) => (status || '').toLowerCase() === 'deleted';

        for (const snapshot of snapshots) {
          if (!snapshot.empty) {
            for (const docSnap of snapshot.docs) {
              const appData = docSnap.data();
              if (isRemoved(appData.status)) continue;
              foundStatus = appData.status || 'submitted';
              foundDocId = docSnap.id;
              const js = appData.jobScoreSummary;
              if (js && typeof js.jobScore === 'number') {
                foundJobScore = js as JobScoreSummaryStored;
              }
              break;
            }
            if (foundStatus != null) break;
          }
        }

        // Fallback: load by doc id (uid_jobId) so withdrawn applications are found even if query fails
        if (foundStatus == null) {
          const fallbackDocId = `${user.uid}_${postId}`;
          try {
            const appRef = doc(db, 'tenants', resolvedTenantId, 'applications', fallbackDocId);
            const appSnap = await getDoc(appRef);
            if (appSnap.exists()) {
              const appData = appSnap.data();
              if (!isRemoved(appData?.status)) {
                foundStatus = appData?.status || 'submitted';
                foundDocId = appSnap.id;
                const js = appData?.jobScoreSummary;
                if (js && typeof js.jobScore === 'number') {
                  foundJobScore = js as JobScoreSummaryStored;
                }
              }
            }
          } catch {
            // ignore
          }
        }

        setApplicationStatus(foundStatus);
        setApplicationDocId(foundDocId);
        setApplicationJobScore(foundJobScore);
      } catch (err: any) {
        // Silently handle permission errors - this is not critical functionality
        // The appliedShifts query will still work to show "Application Submitted"
        if (err.code !== 'permission-denied') {
          console.error('Error loading application status:', err);
        }
        setApplicationStatus(null);
        setApplicationDocId(null);
        setApplicationJobScore(null);
      }
    };

    loadApplicationStatus();
  }, [posting, user?.uid, resolvedTenantId, postId, applicationStatusReloadKey]);

  // Load user profile for requirement status (skills, languages, education, certs)
  useEffect(() => {
    if (!user?.uid) {
      setUserProfile(null);
      return;
    }
    const load = async () => {
      try {
        const ref = doc(db, 'users', user.uid);
        const snap = await getDoc(ref);
        setUserProfile(snap.exists() ? snap.data() : null);
      } catch {
        setUserProfile(null);
      }
    };
    load();
  }, [user?.uid]);

  // Load full application data for requirement acks (so we can show met/not met and update on fix)
  useEffect(() => {
    if (!resolvedTenantId || !applicationDocId) {
      setApplicationData(null);
      return;
    }
    const load = async () => {
      try {
        const ref = doc(db, 'tenants', resolvedTenantId, 'applications', applicationDocId);
        const snap = await getDoc(ref);
        setApplicationData(snap.exists() ? snap.data() : null);
      } catch {
        setApplicationData(null);
      }
    };
    load();
  }, [resolvedTenantId, applicationDocId]);

  // Load dynamic shifts for Gig jobs
  useEffect(() => {
    const loadDynamicShifts = async () => {
      console.log('🔍 Dynamic Shifts Check:', {
        hasPosting: !!posting,
        jobType: posting?.jobType,
        usesDynamicShifts: posting?.usesDynamicShifts,
        jobOrderId: posting?.jobOrderId,
      });

      if (!posting || !posting.jobOrderId) {
        setDynamicShifts([]);
        return;
      }

      // For Gig jobs, ALWAYS try to load dynamic shifts (even if usesDynamicShifts not set)
      if (posting.jobType === 'gig') {
        try {
          setLoadingShifts(true);
          console.log('🔄 Loading dynamic shifts for Gig job...');
          const jobsBoardService = JobsBoardService.getInstance();
          // Use at least 90 days for gig jobs so event shifts (e.g. festivals in 2+ months) are visible
          const filterDays = Math.max(posting.shiftFilterDays ?? 90, 90);
          const shifts = await jobsBoardService.fetchActiveShiftsForJobOrder(
            posting.tenantId,
            posting.jobOrderId!,
            filterDays,
            posting.positionJobTitle,
          );
          console.log('✅ Loaded shifts:', shifts);
          setDynamicShifts(shifts);
        } catch (err) {
          console.error('Error loading dynamic shifts:', err);
          setDynamicShifts([]);
        } finally {
          setLoadingShifts(false);
        }
      } else {
        setDynamicShifts([]);
      }
    };

    loadDynamicShifts();
  }, [posting]);

  // Load career weekly schedule (from job order shifts)
  useEffect(() => {
    const loadCareerSchedule = async () => {
      if (!posting || posting.jobType !== 'career' || !posting.jobOrderId || !posting.tenantId) {
        setCareerWeeklyScheduleSummary('');
        return;
      }

      try {
        const shiftsRef = collection(
          db,
          'tenants',
          posting.tenantId,
          'job_orders',
          posting.jobOrderId,
          'shifts',
        );
        const snap = await getDocs(query(shiftsRef));
        if (snap.empty) {
          setCareerWeeklyScheduleSummary('');
          return;
        }

        const shifts = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as any[];
        // Prefer the "weekly schedule" shift (career multi-day has no endDate)
        const weekly =
          shifts.find((s) => s.shiftMode === 'multi' && s.weeklySchedule && !s.endDate) ||
          shifts.find((s) => s.weeklySchedule);
        let summary = weekly?.weeklySchedule
          ? formatWeeklyScheduleSummary(weekly.weeklySchedule)
          : '';
        if (!summary && weekly?.defaultStartTime && weekly?.defaultEndTime) {
          const fmt = (t: string) => {
            if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return t || '';
            const [hh, mm] = t.split(':').map(Number);
            const h12 = hh % 12 || 12;
            const ap = hh >= 12 ? 'PM' : 'AM';
            return `${h12}:${String(mm).padStart(2, '0')} ${ap}`;
          };
          summary = `${fmt(weekly.defaultStartTime)} – ${fmt(weekly.defaultEndTime)}`;
        }
        setCareerWeeklyScheduleSummary(summary || '');
      } catch (err) {
        console.warn('Error loading career weekly schedule:', err);
        setCareerWeeklyScheduleSummary('');
      }
    };

    void loadCareerSchedule();
  }, [posting]);

  // When worker has an assignment (from URL, accepted state, or application doc), load assignment + shift for start date and accept/decline cards
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const urlAssignmentId = params.get('assignmentId');
    const assignmentId =
      acceptedAssignmentId ||
      urlAssignmentId ||
      (applicationData?.assignmentId ? String(applicationData.assignmentId) : null);
    if (!assignmentId || !resolvedTenantId) {
      setAssignmentStartDate(null);
      setAssignmentData(null);
      setScheduleShiftData(null);
      return;
    }
    const loadAssignment = async () => {
      try {
        const assignmentRef = doc(db, 'tenants', resolvedTenantId, 'assignments', assignmentId);
        const snap = await getDoc(assignmentRef);
        if (snap.exists()) {
          const data = snap.data();
          setAssignmentStartDate(data?.startDate ?? null);
          setAssignmentData(data);
          const joId = data?.jobOrderId;
          const shiftId = data?.shiftId;
          if (joId && shiftId) {
            try {
              const shiftRef = doc(db, 'tenants', resolvedTenantId, 'job_orders', joId, 'shifts', shiftId);
              const shiftSnap = await getDoc(shiftRef);
              setScheduleShiftData(shiftSnap.exists() ? shiftSnap.data() : null);
            } catch {
              setScheduleShiftData(null);
            }
          } else {
            setScheduleShiftData(null);
          }
        } else {
          setAssignmentStartDate(null);
          setAssignmentData(null);
          setScheduleShiftData(null);
        }
      } catch (err) {
        console.warn('Error loading assignment:', err);
        setAssignmentStartDate(null);
        setAssignmentData(null);
        setScheduleShiftData(null);
      }
    };
    loadAssignment();
  }, [resolvedTenantId, acceptedAssignmentId, applicationData?.assignmentId, location.search]);

  const toggleShift = (shiftId: string) => {
    setSelectedShifts((prev) =>
      prev.includes(shiftId) ? prev.filter((id) => id !== shiftId) : [...prev, shiftId],
    );
  };

  // Load applied shifts for the current user (run as soon as we have user + tenant + postId so returning from wizard shows Applied)
  useEffect(() => {
    const loadAppliedShifts = async () => {
      if (!user?.uid || !resolvedTenantId || !postId) {
        setAppliedShifts([]);
        setShiftStatuses({});
        setAssignmentIdsByShiftKey({});
        return;
      }

      try {
        // Query applications for this job posting that include shiftId
        // For gig jobs, we need to check both jobId (posting ID) and jobOrderId
        const applicationsRef = collection(db, 'tenants', resolvedTenantId, 'applications');

        // Query by userId and jobId (posting ID)
        const q1 = query(
          applicationsRef,
          where('userId', '==', user.uid),
          where('jobId', '==', postId || ''),
        );

        // Also query by jobOrderId if this is a gig job with a jobOrderId
        const queries: Promise<any>[] = [getDocs(q1)];

        if (posting?.jobOrderId) {
          const q2 = query(
            applicationsRef,
            where('userId', '==', user.uid),
            where('jobOrderId', '==', posting.jobOrderId),
          );
          queries.push(getDocs(q2));
        }

        const snapshots = await Promise.all(queries);

        const applied: string[] = [];
        const statuses: Record<string, string> = {};
        const seenDocs = new Set<string>();

        // Per-shift status precedence: confirmed > accepted > submitted >
        // reapply. Used by both the application overlay (contributes
        // 'submitted' or 'reapply') and the assignment overlay (raises to
        // accepted/confirmed, or 'reapply' for worker-cancelled) so a
        // higher state never gets clobbered by a lower one regardless of
        // doc-iteration order. 'reapply' (worker-cancelled / withdrawn,
        // re-appliable) ranks above "nothing" but below a fresh submit.
        // 'declined' (recruiter declined the worker from this shift) ranks
        // above submitted/reapply — a deliberate negative decision outranks a
        // pending application — but below a real active assignment
        // (accepted/confirmed), which should never co-occur but wins if it does.
        const statusRank = (s: string | undefined): number =>
          s === 'confirmed' ? 5 : s === 'accepted' ? 4 : s === 'declined' ? 3 : s === 'submitted' ? 2 : s === 'reapply' ? 1 : 0;

        const multiDayShiftIds = new Set(
          dynamicShifts
            .filter((s: any) => isGigMultiDayShift(s))
            .map((s: any) => String(s.shiftId))
        );

        snapshots.forEach((snapshot) => {
          snapshot.forEach((doc) => {
            // Avoid duplicates if a doc matches both queries
            if (seenDocs.has(doc.id)) return;
            seenDocs.add(doc.id);

            const data = doc.data();
            const appStatus = (data.status || '').toLowerCase();
            // Skip hard-dead applications outright.
            if (appStatus === 'deleted' || appStatus === 'cancelled') return;

            const shiftIds = getApplicationShiftIds(data as Record<string, unknown>);
            if (shiftIds.length === 0) return;
            const appliedKeys = buildAppliedKeysForApplication(
              data as Record<string, unknown>,
              multiDayShiftIds,
            );

            // A WITHDRAWN application = the worker cancelled their
            // application on the jobs board. Surface those shifts as
            // 're-appliable' (goldenrod "Re-apply to Shift") rather than
            // silently reverting to a plain Apply button — but do NOT mark
            // them as currently-applied.
            if (appStatus === 'withdrawn') {
              appliedKeys.forEach((key) => {
                if (statusRank('reapply') > statusRank(statuses[key])) {
                  statuses[key] = 'reapply';
                }
              });
              return;
            }

            applied.push(...appliedKeys);
            // CROSS-SHIFT CONTAMINATION FIX (2026-06-08).
            //
            // An application is ONE doc that can cover MANY shifts
            // (shiftIds[]), but it has a single application-wide `status`.
            // When a recruiter accepts a worker for ONE shift, the hire
            // flow flips the whole application to `status: 'accepted'`
            // (see placementsApi linkApplication). The old code here then
            // propagated that single 'accepted' onto EVERY shift in
            // shiftIds[] — so accepting the PM shift lit up Confirm/Decline
            // on the AM shift the recruiter never touched.
            //
            // Per-shift accept/confirm state is NOT application-wide — it
            // lives in per-shift ASSIGNMENT docs (overlay below, keyed by
            // assignment.shiftId). So the application only ever contributes
            // the 'submitted' (applied) state here; the assignment overlay
            // raises specific shifts to accepted/confirmed.
            appliedKeys.forEach((key) => {
              if (statusRank('submitted') > statusRank(statuses[key])) {
                statuses[key] = 'submitted';
              }
            });
          });
        });

        // RECRUITER-DECLINED OVERLAY (Greg, 2026-06-18).
        //
        // When a recruiter declines an applicant from a specific shift
        // (PlacementsTab.handleDeclineApplicant), that shiftId is stripped
        // from the application's shiftIds[] and pushed onto declinedShiftIds[]
        // — the application status is left unchanged so the worker stays an
        // applicant for the rest of the JO. Surface those shifts as a terminal
        // "Not Accepted" state. Read declinedShiftIds directly (the shift is
        // no longer in shiftIds, so the application phase above won't see it).
        // Shift-level key → multi-day day-rows inherit it via ShiftSelector's
        // shift-level fallback.
        const seenDeclineDocs = new Set<string>();
        snapshots.forEach((snapshot) => {
          snapshot.forEach((doc) => {
            if (seenDeclineDocs.has(doc.id)) return;
            seenDeclineDocs.add(doc.id);
            const data = doc.data();
            const appStatus = (data.status || '').toLowerCase();
            if (appStatus === 'deleted' || appStatus === 'cancelled') return;
            const declinedIds = Array.isArray(data.declinedShiftIds)
              ? data.declinedShiftIds.map((x: unknown) => String(x))
              : [];
            declinedIds.forEach((sId: string) => {
              if (statusRank('declined') > statusRank(statuses[sId])) {
                statuses[sId] = 'declined';
              }
            });
          });
        });

        // ASSIGNMENT-DRIVEN STATUS OVERLAY.
        //
        // Applications-only logic above misses the post-placement state
        // transitions — a worker can have an `accepted`/`hired` application
        // AND a separate `pending` assignment doc that means "the recruiter
        // just offered you a specific shift, please confirm or decline".
        // The jobs-board's per-shift card needs to render green Confirm /
        // red Decline buttons in that state (ShiftSelector already handles
        // it when shiftStatus === 'accepted'), but the old query never
        // populated assignment status, so workers saw the wrong control.
        //
        // Pull every active assignment doc for this user × this JO and
        // overlay its status onto `statuses` keyed by `${shiftId}__${day}`
        // (day-scoped) and `${shiftId}` (legacy fallback). Assignment
        // status wins over application status because it's the more
        // specific signal — once you've been offered the shift, the
        // application is moot from the worker's perspective.
        //
        //   pending / proposed                → 'accepted' (UI label for "offered, awaiting your response")
        //   confirmed / active / in_progress  → 'confirmed'
        //   declined / cancelled / completed  → skip (terminal — worker already
        //                                       made their decision OR shift is done)
        // Map of shift key → assignmentId, populated by the overlay
        // below and handed to ShiftSelector so confirmed rows can deep-
        // link to /c1/workers/assignments/{id}.
        const assignmentIdsByKey: Record<string, string> = {};

        if (posting?.jobOrderId) {
          try {
            // Normalize an assignment's startDate (Firestore Timestamp OR
            // string OR ISO datetime) to a bare YYYY-MM-DD. Critical for
            // multi-day gigs where the per-day row key is
            // `${shiftId}__${date}` — a Timestamp stringified naively
            // ("[object Object]") would never match.
            const normalizeAssignmentDate = (raw: unknown): string => {
              if (!raw) return '';
              if (typeof raw === 'string') return raw.slice(0, 10);
              const ts = raw as { toDate?: () => Date };
              if (typeof ts.toDate === 'function') {
                try {
                  const d = ts.toDate();
                  const y = d.getFullYear();
                  const m = String(d.getMonth() + 1).padStart(2, '0');
                  const day = String(d.getDate()).padStart(2, '0');
                  return `${y}-${m}-${day}`;
                } catch {
                  return '';
                }
              }
              return '';
            };

            // Query by userId only (NOT jobOrderId) then match by shiftId
            // against THIS JO's shift set. More robust than a jobOrderId
            // equality filter — picks up assignments even if their
            // jobOrderId field is missing/stale, and never strays onto a
            // different JO's shifts because the shiftId set is the gate.
            const joShiftIds = new Set(
              (dynamicShifts || []).map((s: any) => String(s.shiftId)).filter(Boolean),
            );
            const assignmentsRef = collection(db, 'tenants', resolvedTenantId, 'assignments');
            const assignmentsQ = query(assignmentsRef, where('userId', '==', user.uid));
            const assignmentsSnap = await getDocs(assignmentsQ);

            // Track per-shift outcome so declined/cancelled shifts with NO
            // active assignment get freed back to Available (Apply) — a
            // worker who declined an offer can re-apply.
            const activeKeys = new Set<string>();
            const declinedKeys = new Set<string>();
            // Shift keys backed by a WORKER-CANCELLED assignment → render
            // "Re-apply to Shift". Tracked separately from declinedKeys
            // (which free back to a plain Apply) and from the assignmentId
            // that re-apply must delete.
            const reapplyKeys = new Set<string>();
            const ACTIVE = new Set(['pending', 'proposed', 'confirmed', 'active', 'in_progress']);
            const DECLINED = new Set(['declined', 'cancelled', 'canceled', 'withdrawn']);
            const reapplyAssignmentIdByKey: Record<string, string> = {};

            assignmentsSnap.forEach((d) => {
              const a = d.data() as Record<string, unknown>;
              const rawStatus = String(a.status || '').trim().toLowerCase();
              if (!rawStatus) return; // phantom doc — same defensive check as the server guard
              const sId = String(a.shiftId || '');
              if (!sId || !joShiftIds.has(sId)) return; // not a shift on THIS JO
              const dateIso = normalizeAssignmentDate(a.startDate);
              const keys = dateIso ? [sId, `${sId}__${dateIso}`] : [sId];

              if (ACTIVE.has(rawStatus)) {
                const uiStatus =
                  rawStatus === 'pending' || rawStatus === 'proposed' ? 'accepted' : 'confirmed';
                keys.forEach((key) => {
                  activeKeys.add(key);
                  // Rank-based precedence raises the shift to
                  // accepted/confirmed over the application's 'submitted',
                  // never downgrades a higher state, and only touches THIS
                  // assignment's own shiftId — siblings never contaminated.
                  if (statusRank(uiStatus) > statusRank(statuses[key])) {
                    statuses[key] = uiStatus;
                    if (!applied.includes(key)) applied.push(key);
                  }
                  // Day-scoped key wins over the legacy shift-only key for
                  // the "View Details" deep-link id when both resolve.
                  if (!assignmentIdsByKey[key] || key.includes('__')) {
                    assignmentIdsByKey[key] = d.id;
                  }
                });
              } else if (rawStatus === 'worker-cancelled' || rawStatus === 'worker_cancelled') {
                // Worker pulled out → offer Re-apply. Remember the
                // assignmentId so the re-apply handler can delete it.
                keys.forEach((key) => {
                  reapplyKeys.add(key);
                  if (!reapplyAssignmentIdByKey[key] || key.includes('__')) {
                    reapplyAssignmentIdByKey[key] = d.id;
                  }
                });
              } else if (DECLINED.has(rawStatus)) {
                keys.forEach((key) => declinedKeys.add(key));
              }
              // completed / other terminal → ignore (shift is in the past
              // or otherwise resolved; nothing actionable to show).
            });

            // Apply worker-cancelled → 'reapply' (after the loop so an
            // active assignment on the same key always wins).
            reapplyKeys.forEach((key) => {
              if (activeKeys.has(key)) return; // a live offer/confirm supersedes
              if (statusRank('reapply') > statusRank(statuses[key])) {
                statuses[key] = 'reapply';
              }
            });
            setReapplyAssignmentIdByShiftKey(reapplyAssignmentIdByKey);

            // Free declined/cancelled shifts (with no active assignment)
            // back to Available so the worker can re-apply. A re-offer
            // creates a new active assignment which lands in activeKeys
            // and takes precedence, so this never clobbers a live offer.
            // Skip keys we just marked 'reapply' (worker-cancelled) — those
            // intentionally show "Re-apply to Shift", not a bare Apply.
            declinedKeys.forEach((key) => {
              if (!activeKeys.has(key) && !reapplyKeys.has(key)) {
                delete statuses[key];
                const idx = applied.indexOf(key);
                if (idx >= 0) applied.splice(idx, 1);
              }
            });
          } catch (assignErr) {
            console.warn('loadAppliedShifts: assignment overlay failed', assignErr);
          }
        }

        console.log(`✅ Loaded applied shifts for user ${user.uid}:`, applied);
        console.log(`✅ Shift statuses (after assignment overlay):`, statuses);
        setAppliedShifts(applied);
        setShiftStatuses(statuses);
        setAssignmentIdsByShiftKey(assignmentIdsByKey);
      } catch (err) {
        console.error('Error loading applied shifts:', err);
        setAppliedShifts([]);
        setShiftStatuses({});
      }
    };

    loadAppliedShifts();

    // Refresh applied shifts AND the posting itself when the page becomes
    // visible / regains focus (e.g., returning from the wizard, or a
    // recruiter toggled "Show spots remaining" while this tab was open).
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        loadAppliedShifts();
        setPostingRefresh((n) => n + 1);
      }
    };

    // Refresh when window gains focus (user returns to tab)
    const handleFocus = () => {
      loadAppliedShifts();
      setPostingRefresh((n) => n + 1);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [user?.uid, resolvedTenantId, postId, posting?.jobOrderId, dynamicShifts.length, appliedShiftsRefresh]);

  /**
   * One-click ACCEPT intent handler. Fires when the worker arrives via the
   * offer SMS's ACCEPT link (`?intent=accept&assignmentId=...`). Opens the
   * offer-confirmation sheet (the 3-acknowledgement bottom sheet) for the
   * offered shift so they confirm here on the posting — we do NOT
   * auto-confirm, since the acknowledgements are required. Idempotent via
   * `acceptIntentHandled`.
   */
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('intent') !== 'accept') return;
    const aid = params.get('assignmentId');
    if (!aid) return;
    if (!user?.uid || !resolvedTenantId || !posting) return;
    if (acceptIntentHandled) return;
    setAcceptIntentHandled(true);

    let cancelled = false;
    (async () => {
      const stripIntentFromUrl = () => {
        const next = new URLSearchParams(location.search);
        next.delete('intent');
        next.delete('assignmentId');
        const qs = next.toString();
        navigate({ pathname: location.pathname, search: qs ? `?${qs}` : '' }, { replace: true });
      };
      try {
        const snap = await getDoc(doc(db, 'tenants', resolvedTenantId, 'assignments', aid));
        if (cancelled) return;
        const data = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
        const status = String((data?.status as string) || '').toLowerCase();
        const shiftId = String((data?.shiftId as string) || '');
        stripIntentFromUrl();
        // Already confirmed / terminal → nothing to confirm; just land here.
        if (
          ['confirmed', 'active', 'in_progress', 'completed', 'cancelled', 'canceled', 'declined', 'worker-cancelled'].includes(
            status,
          )
        ) {
          return;
        }
        if (shiftId) openOfferConfirmationSheet(shiftId);
      } catch (err) {
        console.warn('[JobPostingDetail] accept-intent open-sheet failed', err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // openOfferConfirmationSheet is stable within a render; omitted from deps intentionally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search, location.pathname, navigate, user?.uid, resolvedTenantId, posting, acceptIntentHandled]);

  /**
   * One-click DECLINE intent handler. Fires when the worker arrives via
   * the offer SMS's DECLINE link (`?intent=decline&assignmentId=...`).
   * Same idempotency contract as the AssignmentDetails accept handler.
   *
   * Why this lives on JobPostingDetail (and not the assignment page):
   * after declining, the worker should see *other shifts* on the same
   * JO so they can re-apply if they declined the wrong one. Landing
   * them on the assignment detail page would just leave them stuck
   * staring at the declined assignment.
   */
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('intent') !== 'decline') return;
    const aid = params.get('assignmentId');
    if (!aid) return;
    if (!user?.uid || !resolvedTenantId) return;
    if (declineIntentState !== 'idle') return;

    let cancelled = false;
    (async () => {
      try {
        const assignmentRef = doc(db, 'tenants', resolvedTenantId, 'assignments', aid);
        const snap = await getDoc(assignmentRef);
        if (cancelled) return;
        const data = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
        const status = String((data?.status as string) || '').toLowerCase();

        const stripIntentFromUrl = () => {
          const next = new URLSearchParams(location.search);
          next.delete('intent');
          next.delete('assignmentId');
          const qs = next.toString();
          navigate({ pathname: location.pathname, search: qs ? `?${qs}` : '' }, { replace: true });
        };

        // Terminal state — already declined / cancelled / worker-cancelled /
        // confirmed — skip the callable, just clean up the URL.
        if (['declined', 'cancelled', 'worker-cancelled', 'worker_cancelled', 'confirmed', 'active'].includes(status)) {
          if (cancelled) return;
          setDeclineIntentState('skipped');
          stripIntentFromUrl();
          return;
        }

        if (cancelled) return;
        setDeclineIntentState('firing');
        const respondFn = httpsCallable(functions, 'respondToAssignment');
        await respondFn({
          tenantId: resolvedTenantId,
          assignmentId: aid,
          // SMS DECLINE link = worker pulling out → worker-cancelled so the
          // shift can be re-applied to from the jobs board.
          decision: 'worker_cancel',
        });
        if (cancelled) return;
        setDeclineIntentState('success');
        stripIntentFromUrl();
        // Refresh applied-shifts state so the UI re-reads the declined
        // assignment status without a full reload.
        setAppliedShiftsRefresh((n) => n + 1);
      } catch (err: any) {
        if (cancelled) return;
        console.error('[JobPostingDetail] one-click decline failed', err);
        setDeclineIntentState('error');
        setDeclineIntentError(err?.message || 'Could not decline this assignment.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [location.search, location.pathname, navigate, user?.uid, resolvedTenantId, declineIntentState]);

  /**
   * Quick-apply path for users who have already completed the wizard for
   * this posting. Reads the existing application doc (id =
   * `${uid}_${postId}` — same convention the wizard uses), appends the
   * new shift / applyDate to its `shiftIds[]` / `applyDates[]`, and
   * keeps the user on the jobs-board so they can apply to more shifts
   * without re-running the wizard for each one.
   *
   * Falls back to the wizard if:
   *   - the existing application doc disappeared (defensive)
   *   - the existing application is in a terminal-canceled state
   *     (withdrawn / cancelled / deleted) so we want full wizard ack
   *
   * Returns true when quick-apply succeeded (so the caller skips wizard).
   */
  /**
   * Optimistically flip a shift's button to its "applied" state before
   * the Firestore write round-trips. ShiftSelector reads `appliedShifts`
   * + `shiftStatuses` keyed by `${shiftId}` (single-day shift rows) or
   * `${shiftId}__${YYYY-MM-DD}` (multi-day gig day rows) — we write both
   * so whichever the row uses resolves immediately. Returns the keys we
   * touched so the caller can revert on write failure.
   *
   * Without this, the recruiter-reported ~5s lag was the worker staring
   * at the blue Apply button while the setDoc + the follow-up
   * loadAppliedShifts re-query round-tripped.
   */
  const markShiftAppliedOptimistic = (shiftId: string, applyDate?: string): string[] => {
    const keys = [shiftId];
    if (applyDate) keys.push(`${shiftId}__${applyDate}`);
    setAppliedShifts((prev) => Array.from(new Set([...prev, ...keys])));
    setShiftStatuses((prev) => {
      const next = { ...prev };
      keys.forEach((k) => {
        // Don't downgrade a row that's already confirmed/accepted.
        if (next[k] !== 'confirmed' && next[k] !== 'accepted') next[k] = 'submitted';
      });
      return next;
    });
    return keys;
  };

  const revertShiftAppliedOptimistic = (keys: string[]): void => {
    setAppliedShifts((prev) => prev.filter((k) => !keys.includes(k)));
    setShiftStatuses((prev) => {
      const next = { ...prev };
      keys.forEach((k) => {
        if (next[k] === 'submitted') delete next[k];
      });
      return next;
    });
  };

  const quickApplyToShift = async (shiftId: string, applyDate?: string): Promise<boolean> => {
    if (!user?.uid || !resolvedTenantId || !postId || !posting) return false;
    const appDocId = `${user.uid}_${postId}`;
    const appRef = doc(db, 'tenants', resolvedTenantId, 'applications', appDocId);
    let optimisticKeys: string[] = [];
    try {
      const snap = await getDoc(appRef);
      if (!snap.exists()) return false;
      const data = snap.data() as Record<string, unknown>;
      const status = String(data?.status || '').toLowerCase();
      // Terminal-canceled states reset the wizard — these need a full
      // re-acknowledgement.
      if (status === 'withdrawn' || status === 'cancelled' || status === 'deleted') return false;
      // Committed to writing — flip the UI NOW (before the slow setDoc).
      optimisticKeys = markShiftAppliedOptimistic(shiftId, applyDate);
      const existingShiftIds = getApplicationShiftIds(data);
      const existingApplyDates = getApplicationAppliedDays(data);
      const nextShiftIds = Array.from(new Set([...existingShiftIds, shiftId]));
      const nextApplyDates = applyDate
        ? Array.from(new Set([...existingApplyDates, applyDate]))
        : existingApplyDates;
      await setDoc(
        appRef,
        {
          shiftIds: nextShiftIds,
          ...(nextApplyDates.length > 0
            ? { applyDates: nextApplyDates, applyDate: nextApplyDates[0] }
            : {}),
          // Single-shift fallback for code paths that read `shiftId`.
          ...(nextShiftIds.length === 1 ? { shiftId: nextShiftIds[0] } : {}),
          updatedAt: serverTimestamp(),
          // Keep status anchored at 'submitted' (or higher) — never
          // downgrade an accepted/hired application.
          ...(['submitted', 'pending'].includes(status) || !status
            ? { status: 'submitted' }
            : {}),
        },
        { merge: true },
      );
      // Bump refresh so loadAppliedShifts re-reads + reconciles the
      // optimistic state with Firestore truth.
      setAppliedShiftsRefresh((n) => n + 1);
      return true;
    } catch (err) {
      console.warn('quickApplyToShift failed, falling back to wizard:', err);
      // Revert the optimistic flip so the button returns to Apply.
      if (optimisticKeys.length > 0) revertShiftAppliedOptimistic(optimisticKeys);
      return false;
    }
  };

  const handleApplyToShift = async (shiftId: string, applyDate?: string) => {
    const returnTo = `/c1/jobs-board/${postId}`;

    // Authenticated users who already have a completed application on
    // this posting skip the wizard entirely — we just append the shift
    // to their existing application doc.
    if (user?.uid && appliedShifts.length > 0) {
      const ok = await quickApplyToShift(shiftId, applyDate);
      if (ok) return;
      // Fall through to wizard if quick-apply couldn't reuse the doc.
    }

    const params = new URLSearchParams({ shiftId });
    if (applyDate) params.set('applyDate', applyDate);
    // Always pass returnTo so the wizard's success screen sends them
    // back here instead of /c1/workers/payroll. They came here to
    // browse shifts; they should come back here to browse more.
    params.set('returnTo', returnTo);
    navigate(`/apply/${posting.tenantId}/${postId}?${params.toString()}`);
  };

  /**
   * Re-apply to a shift the worker previously pulled out of
   * (worker-cancelled assignment, or a withdrawn application). Deletes the
   * old worker-cancelled assignment doc(s) so nothing stale lingers, then
   * re-activates the application back to 'submitted' (creating a fresh
   * applied state). Falls back to the wizard if there's no application doc
   * to revive.
   */
  const handleReapplyToShift = async (shiftId: string, applyDate?: string) => {
    if (!user?.uid || !resolvedTenantId) return;
    try {
      // 1) Delete any worker-cancelled assignment for this shift so the
      //    re-apply starts clean (no orphaned terminal assignment).
      const assignmentsRef = collection(db, 'tenants', resolvedTenantId, 'assignments');
      const snap = await getDocs(query(assignmentsRef, where('userId', '==', user.uid), where('shiftId', '==', shiftId)));
      await Promise.all(
        snap.docs
          .filter((d) => {
            const s = String((d.data() as Record<string, unknown>).status || '').toLowerCase();
            return s === 'worker-cancelled' || s === 'worker_cancelled';
          })
          .map((d) => deleteDoc(doc(db, 'tenants', resolvedTenantId, 'assignments', d.id))),
      );

      // 2) Re-activate the application doc (revive a withdrawn one) and
      //    ensure this shift is on it. quickApplyToShift bails on
      //    withdrawn apps, so write directly here.
      const appDocId = `${user.uid}_${postId}`;
      const appRef = doc(db, 'tenants', resolvedTenantId, 'applications', appDocId);
      const appSnap = await getDoc(appRef);
      if (appSnap.exists()) {
        const data = appSnap.data() as Record<string, unknown>;
        const existingShiftIds = getApplicationShiftIds(data);
        const existingApplyDates = getApplicationAppliedDays(data);
        const nextShiftIds = Array.from(new Set([...existingShiftIds, shiftId]));
        const nextApplyDates = applyDate
          ? Array.from(new Set([...existingApplyDates, applyDate]))
          : existingApplyDates;
        const optimisticKeys = markShiftAppliedOptimistic(shiftId, applyDate);
        try {
          await setDoc(
            appRef,
            {
              status: 'submitted',
              shiftIds: nextShiftIds,
              ...(nextApplyDates.length > 0 ? { applyDates: nextApplyDates, applyDate: nextApplyDates[0] } : {}),
              ...(nextShiftIds.length === 1 ? { shiftId: nextShiftIds[0] } : {}),
              // Clear the withdrawal markers so the app reads as live again.
              withdrawnAt: deleteField(),
              withdrawnBy: deleteField(),
              reappliedAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          );
        } catch (writeErr) {
          revertShiftAppliedOptimistic(optimisticKeys);
          throw writeErr;
        }
        setAppliedShiftsRefresh((n) => n + 1);
        return;
      }

      // 3) No application doc to revive → run the normal apply flow.
      await handleApplyToShift(shiftId, applyDate);
    } catch (err) {
      console.error('[JobPostingDetail] re-apply failed', err);
      alert('We could not re-apply to this shift. Please try again.');
    }
  };

  // Helper to safely format calendar dates (avoids UTC→local timezone shift showing wrong day)
  const formatDate = (date: any): string => {
    if (!date) return t('jobs.dateTbd');
    try {
      let d: Date;
      if (date?.toDate) {
        d = date.toDate();
      } else {
        d = new Date(date);
      }
      if (isNaN(d.getTime())) return t('jobs.dateTbd');
      const m = d.getUTCMonth() + 1;
      const day = d.getUTCDate();
      const y = d.getUTCFullYear();
      return `${m}/${day}/${y}`;
    } catch {
      return t('jobs.dateTbd');
    }
  };

  const formatTime = (t: string | undefined): string => {
    if (!t || typeof t !== 'string') return '';
    const [h, m] = t.trim().split(':');
    const hh = Math.max(0, Math.min(23, parseInt(h, 10) || 0));
    const mm = Math.max(0, Math.min(59, parseInt(m, 10) || 0));
    const d = new Date(2000, 0, 1, hh, mm);
    return format(d, 'h:mm a');
  };

  // Override end date with last shift date when we have shifts (so worker UI shows correct "through" date)
  const effectiveEndDate = useMemo(() => {
    if (!posting) return undefined;
    const postEnd = posting.endDate ? (posting.endDate?.toDate ? posting.endDate.toDate() : new Date(posting.endDate)) : null;
    if (dynamicShifts.length === 0) return postEnd ?? undefined;
    const lastStr = getLastShiftDateFromShifts(dynamicShifts);
    if (!lastStr) return postEnd ?? undefined;
    const lastDate = new Date(lastStr);
    if (!postEnd) return lastDate;
    return postEnd > lastDate ? postEnd : lastDate;
  }, [posting, dynamicShifts]);

  const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];
  const DOW_LABELS: Record<number, string> = {
    0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday',
  };

  // Helper function to get application status button label and styling
  const getApplicationStatusButton = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'hired':
        return {
          label: 'Hired',
          backgroundColor: '#4CAF50', // Green
          color: '#fff',
          cursor: 'default',
          pointerEvents: 'none' as const,
        };
      case 'waitlisted':
        return {
          label: 'Waitlisted',
          backgroundColor: '#ED6C02', // Orange
          color: '#fff',
          cursor: 'default',
          pointerEvents: 'none' as const,
        };
      case 'rejected':
      case 'not accepted':
        return {
          label: 'Not Accepted',
          backgroundColor: '#F44336', // Red
          color: '#fff',
          cursor: 'default',
          pointerEvents: 'none' as const,
        };
      case 'withdrawn':
      case 'cancelled':
        return {
          label: 'cancelled',
          backgroundColor: '#9E9E9E',
          color: '#fff',
          cursor: 'default',
          pointerEvents: 'none' as const,
        };
      case 'advanced':
      case 'screened':
      case 'offer_pending':
      case 'offer':
        return {
          label: 'Accepted',
          backgroundColor: '#2196F3', // Blue
          color: '#fff',
          cursor: 'default',
          pointerEvents: 'none' as const,
        };
      case 'accepted':
        return {
          label: 'accepted_special', // Special flag for custom UI
          backgroundColor: '#2196F3', // Blue for Accepted button
          color: '#fff',
          cursor: 'default',
          pointerEvents: 'none' as const,
        };
      case 'confirmed':
        return {
          label: 'confirmed_special', // Special flag for confirmed UI with lock
          backgroundColor: '#4CAF50', // Green
          color: '#fff',
          cursor: 'default',
          pointerEvents: 'none' as const,
        };
      case 'submitted':
      case 'new':
      default:
        return {
          label: 'Application Submitted',
          backgroundColor: '#FFC700', // Yellow (existing color)
          color: '#000',
          cursor: 'default',
          pointerEvents: 'none' as const,
        };
    }
  };

  const getApplicationStatusHelperText = (status: string): string | null => {
    switch (status?.toLowerCase()) {
      case 'waitlisted':
        return t('jobs.applicationStatusWaitlistedHelp');
      case 'rejected':
      case 'not accepted':
        return t('jobs.applicationStatusRejectedHelp');
      default:
        return null;
    }
  };

  const getStatusDisplayLabel = (label: string): string => {
    const map: Record<string, string> = {
      'Application Submitted': t('jobs.applicationStatusSubmitted'),
      Hired: t('jobs.applicationStatusHired'),
      Waitlisted: t('jobs.applicationStatusWaitlisted'),
      'Not Accepted': t('jobs.applicationStatusNotAccepted'),
      cancelled: t('jobs.applicationStatusCancelled'),
      Accepted: t('jobs.applicationStatusAccepted'),
      accepted_special: t('jobs.applicationStatusAccepted'),
      confirmed_special: t('jobs.applicationStatusConfirmed'),
    };
    return map[label] ?? label;
  };

  const handleApply = async () => {
    // Gig jobs: require at least one shift selected (apply-to-shift model; see docs/career-vs-gig-placements-assignments.md)
    if (
      posting?.jobType === 'gig' &&
      dynamicShifts.length > 0 &&
      selectedShifts.length === 0
    ) {
      alert('Please select at least one shift to apply to.');
      return;
    }

    if (!user) {
      // Redirect to login/signup with return URL
      navigate(`/apply/${posting.tenantId}/${postId}?returnTo=/c1/jobs-board/${postId}`);
      return;
    }

    try {
      // Check if user has existing application data
      const {
        hasExistingApplicationData,
        getMissingRequiredCertifications,
        submitQuickApplication,
      } = await import('../utils/quickApplicationSubmit');

      const hasExistingData = await hasExistingApplicationData(user.uid);

      if (hasExistingData) {
        // Check if job requires certifications user doesn't have
        const missingCerts = await getMissingRequiredCertifications(user.uid, posting);

        if (missingCerts.length === 0) {
          // User has all required certs - submit directly
          const queryParams =
            selectedShifts.length > 0 ? `?shifts=${selectedShifts.join(',')}` : '';
          const returnTo = queryParams
            ? `/c1/jobs-board/${postId}${queryParams}`
            : `/c1/jobs-board/${postId}`;

          const result = await submitQuickApplication(
            user.uid,
            posting.tenantId,
            postId!,
            posting,
            selectedShifts,
            returnTo,
          );

          if (result.success) {
            const { emitWorkerCardSignal } = await import('../utils/workerCardSignals');
            emitWorkerCardSignal({ type: 'job_applied', entityId: postId! });
            // Stay on this job URL and reload application status (yellow “submitted” UI, etc.)
            setApplicationStatusReloadKey((k) => k + 1);
            return;
          } else {
            // Error - show alert and navigate to wizard
            alert(result.error || 'Failed to submit application. Please try again.');
            const queryParams =
              selectedShifts.length > 0 ? `?shifts=${selectedShifts.join(',')}` : '';
            navigate(`/apply/${posting.tenantId}/${postId}${queryParams}`);
            return;
          }
        } else {
          // Missing certs - navigate to wizard starting at certifications step
          const queryParams =
            selectedShifts.length > 0 ? `?shifts=${selectedShifts.join(',')}&step=7` : '?step=7';
          navigate(`/apply/${posting.tenantId}/${postId}${queryParams}`);
          return;
        }
      } else {
        // First time applicant - navigate to full wizard
        const queryParams = selectedShifts.length > 0 ? `?shifts=${selectedShifts.join(',')}` : '';
        navigate(`/apply/${posting.tenantId}/${postId}${queryParams}`);
        return;
      }
    } catch (error) {
      console.error('Error in handleApply:', error);
      // Fallback to wizard on error
      const queryParams = selectedShifts.length > 0 ? `?shifts=${selectedShifts.join(',')}` : '';
      navigate(`/apply/${posting.tenantId}/${postId}${queryParams}`);
    }
  };

  const handleCancelApplication = async () => {
    if (!applicationDocId || !resolvedTenantId) return;
    const confirmed = window.confirm('Are you sure you want to cancel your application?');
    if (!confirmed) return;

    try {
      const applicationRef = doc(db, 'tenants', resolvedTenantId, 'applications', applicationDocId);
      await updateDoc(applicationRef, {
        status: 'withdrawn',
        withdrawnAt: new Date(),
        withdrawnBy: user?.uid || null,
        applyDate: deleteField(),
        applyDates: deleteField(),
      });
      if (user?.uid) {
        try {
          await updateUserSmartGroupOnWithdraw(user.uid, resolvedTenantId, applicationDocId);
        } catch (sgErr) {
          console.warn('Smart Groups: failed to update on withdraw', sgErr);
        }
      }
      setApplicationStatus('withdrawn');
    } catch (err) {
      console.error('Failed to cancel application:', err);
      alert('We were unable to cancel your application. Please try again.');
    }
  };

  /** Cancel application for a single day (multi-day gig) or whole shift. */
  const handleCancelApplicationForDay = async (shiftId: string, date?: string) => {
    const confirmed = window.confirm(
      date
        ? 'Are you sure you want to cancel your application for this day? You can apply again for this day later.'
        : 'Are you sure you want to cancel your application for this shift?',
    );
    if (!confirmed) return;

    if (!user?.uid || !resolvedTenantId || !postId) return;
    const appDocId = `${user.uid}_${postId}`;
    const applicationRef = doc(db, 'tenants', resolvedTenantId, 'applications', appDocId);

    try {
      const snap = await getDoc(applicationRef);
      if (!snap.exists()) {
        setAppliedShiftsRefresh((r) => r + 1);
        return;
      }
      const data = snap.data();

      if (date) {
        // Remove this day from applyDates (or clear applyDate)
        const applyDates = getApplicationAppliedDays(data as Record<string, unknown>);
        const remaining = applyDates.filter((d) => d !== date);
        if (remaining.length === 0) {
          await updateDoc(applicationRef, {
            status: 'withdrawn',
            withdrawnAt: new Date(),
            withdrawnBy: user.uid,
            updatedAt: serverTimestamp(),
            applyDate: deleteField(),
            applyDates: deleteField(),
          });
          setApplicationStatus('withdrawn');
        } else {
          await updateDoc(applicationRef, {
            applyDates: remaining,
            applyDate: remaining[0],
            updatedAt: serverTimestamp(),
          });
        }
      } else {
        await updateDoc(applicationRef, {
          status: 'withdrawn',
          withdrawnAt: new Date(),
          withdrawnBy: user.uid,
          updatedAt: serverTimestamp(),
        });
        setApplicationStatus('withdrawn');
      }
      setAppliedShiftsRefresh((r) => r + 1);
    } catch (err) {
      console.error('Failed to cancel application for day:', err);
      alert('We were unable to cancel your application. Please try again.');
    }
  };

  const handleRequirementFix = async (
    ackKey: string | undefined,
    answer: 'Yes' | 'No',
    category: string,
    label: string
  ) => {
    if (!resolvedTenantId || !applicationDocId || !user?.uid) return;
    try {
      const appRef = doc(db, 'tenants', resolvedTenantId, 'applications', applicationDocId);
      const snap = await getDoc(appRef);
      const data = snap.exists() ? snap.data() : {};
      const existingData = (data as any).data || {};
      const existingReqs = existingData.requirements || {};
      const existingAcks = existingReqs.acks || {};
      const existingAdditionalScreenings = existingReqs.additionalScreenings || {};
      const nextReqs = { ...existingReqs };
      const isFollowUpAck = ackKey && String(ackKey).endsWith('_willing');
      if (isFollowUpAck && ackKey) {
        nextReqs.acks = { ...existingAcks, [ackKey]: answer };
      } else if (category === 'additionalScreenings') {
        nextReqs.additionalScreenings = { ...existingAdditionalScreenings, [label]: answer };
      } else if (ackKey === 'backgroundScreeningComfort' || ackKey === 'drugScreeningComfort' || ackKey === 'eVerifyComfort') {
        nextReqs[ackKey] = answer;
      } else if (ackKey) {
        nextReqs.acks = { ...existingAcks, [ackKey]: answer };
      }
      await updateDoc(appRef, {
        data: { ...existingData, requirements: nextReqs },
        updatedAt: serverTimestamp(),
      });
      setApplicationData((prev: any) => {
        const next = prev ? { ...prev } : {};
        next.data = next.data || {};
        next.data.requirements = next.data.requirements || {};
        if (isFollowUpAck && ackKey) {
          next.data.requirements.acks = { ...(next.data.requirements.acks || {}), [ackKey]: answer };
        } else if (category === 'additionalScreenings') {
          next.data.requirements.additionalScreenings = { ...(next.data.requirements.additionalScreenings || {}), [label]: answer };
        } else if (ackKey === 'backgroundScreeningComfort' || ackKey === 'drugScreeningComfort' || ackKey === 'eVerifyComfort') {
          next.data.requirements[ackKey] = answer;
        } else if (ackKey) {
          next.data.requirements.acks = { ...(next.data.requirements.acks || {}), [ackKey]: answer };
        }
        return next;
      });

      // Persist to user profile so recruiters see changes and future applications pre-fill
      const userRef = doc(db, 'users', user.uid);
      const ts = serverTimestamp();

      if (category === 'skills') {
        if (answer === 'Yes') {
          await updateDoc(
            userRef,
            buildCanonicalWorkerProfileWritePatch({ skills: arrayUnion(label), updatedAt: ts }),
          );
          setUserProfile((p: any) => {
            const list = p?.skills || [];
            const has = list.some((s: any) => (typeof s === 'string' ? s : s?.name) === label);
            return { ...p, skills: has ? list : [...list, label], updatedAt: new Date() };
          });
        } else {
          const userSnap = await getDoc(userRef);
          const userData = userSnap.exists() ? userSnap.data() : {};
          const arr = Array.isArray((userData as any).skills) ? (userData as any).skills : [];
          const filtered = arr.filter((s: any) => (typeof s === 'string' ? s : s?.name) !== label);
          await updateDoc(
            userRef,
            buildCanonicalWorkerProfileWritePatch({ skills: filtered, updatedAt: ts }),
          );
          setUserProfile((p: any) => ({ ...p, skills: filtered, updatedAt: new Date() }));
        }
      } else if (category === 'languages') {
        if (answer === 'Yes') {
          await updateDoc(
            userRef,
            buildCanonicalWorkerProfileWritePatch({ languages: arrayUnion(label), updatedAt: ts }),
          );
          setUserProfile((p: any) => {
            const list = p?.languages || [];
            const has = list.some((l: any) => (typeof l === 'string' ? l : l?.name) === label);
            return { ...p, languages: has ? list : [...list, label], updatedAt: new Date() };
          });
        } else {
          const userSnap = await getDoc(userRef);
          const userData = userSnap.exists() ? userSnap.data() : {};
          const arr = Array.isArray((userData as any).languages) ? (userData as any).languages : [];
          const filtered = arr.filter((l: any) => (typeof l === 'string' ? l : l?.name) !== label);
          await updateDoc(
            userRef,
            buildCanonicalWorkerProfileWritePatch({ languages: filtered, updatedAt: ts }),
          );
          setUserProfile((p: any) => ({ ...p, languages: filtered, updatedAt: new Date() }));
        }
      } else if (category === 'experienceLevels' && answer === 'Yes') {
        await updateDoc(
          userRef,
          buildCanonicalWorkerProfileWritePatch({ experienceLevel: label, updatedAt: ts }),
        );
        setUserProfile((p: any) => ({ ...p, experienceLevel: label, updatedAt: new Date() }));
      } else if (category === 'licensesCerts' && !isFollowUpAck) {
        const certObj = { name: label };
        if (answer === 'Yes') {
          await updateDoc(
            userRef,
            buildCanonicalWorkerProfileWritePatch({ certifications: arrayUnion(certObj), updatedAt: ts }),
          );
          setUserProfile((p: any) => {
            const certs = p?.certifications || [];
            const has = certs.some((c: any) => (typeof c === 'string' ? c : c?.name) === label);
            return { ...p, certifications: has ? certs : [...certs, certObj], updatedAt: new Date() };
          });
        } else {
          const userSnap = await getDoc(userRef);
          const userData = userSnap.exists() ? userSnap.data() : {};
          const certs = Array.isArray((userData as any).certifications) ? (userData as any).certifications : [];
          const filtered = certs.filter((c: any) => {
            const name = typeof c === 'string' ? c : c?.name;
            return name !== label || (typeof c === 'object' && c?.fileUrl);
          });
          await updateDoc(
            userRef,
            buildCanonicalWorkerProfileWritePatch({ certifications: filtered, updatedAt: ts }),
          );
          setUserProfile((p: any) => ({ ...p, certifications: filtered, updatedAt: new Date() }));
        }
      } else if (category === 'additionalScreenings' && !isFollowUpAck) {
        const userSnap = await getDoc(userRef);
        const userData = userSnap.exists() ? userSnap.data() : {};
        const existing = (userData as any).additionalScreenings || {};
        const nextScreenings = { ...existing, [label]: answer };
        await updateDoc(
          userRef,
          buildCanonicalWorkerProfileWritePatch({ additionalScreenings: nextScreenings, updatedAt: ts }),
        );
        setUserProfile((p: any) => ({ ...p, additionalScreenings: nextScreenings, updatedAt: new Date() }));
      } else if (isFollowUpAck && ackKey) {
        const userSnap = await getDoc(userRef);
        const userData = userSnap.exists() ? userSnap.data() : {};
        const existing = (userData as any).requirementsAcks || {};
        await updateDoc(
          userRef,
          buildCanonicalWorkerProfileWritePatch({
            requirementsAcks: { ...existing, [ackKey]: answer },
            updatedAt: ts,
          }),
        );
        setUserProfile((p: any) => ({ ...p, requirementsAcks: { ...(p?.requirementsAcks || {}), [ackKey]: answer }, updatedAt: new Date() }));
      } else if (ackKey === 'eVerifyComfort') {
        await updateDoc(
          userRef,
          buildCanonicalWorkerProfileWritePatch({ comfortableEVerify: answer, updatedAt: ts }),
        );
        setUserProfile((p: any) => ({ ...p, comfortableEVerify: answer, updatedAt: new Date() }));
      } else if (ackKey === 'backgroundScreeningComfort') {
        await updateDoc(
          userRef,
          buildCanonicalWorkerProfileWritePatch({ comfortablePassBackground: answer, updatedAt: ts }),
        );
        setUserProfile((p: any) => ({ ...p, comfortablePassBackground: answer, updatedAt: new Date() }));
      } else if (ackKey === 'drugScreeningComfort') {
        await updateDoc(
          userRef,
          buildCanonicalWorkerProfileWritePatch({ comfortablePassDrug: answer, updatedAt: ts }),
        );
        setUserProfile((p: any) => ({ ...p, comfortablePassDrug: answer, updatedAt: new Date() }));
      } else if (ackKey) {
        const userSnap = await getDoc(userRef);
        const userData = userSnap.exists() ? userSnap.data() : {};
        const existing = (userData as any).requirementsAcks || {};
        await updateDoc(
          userRef,
          buildCanonicalWorkerProfileWritePatch({
            requirementsAcks: { ...existing, [ackKey]: answer },
            updatedAt: ts,
          }),
        );
        setUserProfile((p: any) => ({ ...p, requirementsAcks: { ...(p?.requirementsAcks || {}), [ackKey]: answer }, updatedAt: new Date() }));
      }
    } catch (err) {
      console.error('Failed to update requirement:', err);
      alert('We couldn’t save that. Please try again.');
    }
  };

  const handleEducationSelect = async (level: string) => {
    if (!resolvedTenantId || !applicationDocId || !user?.uid) return;
    const ackKey = `education_${level}`;
    try {
      const appRef = doc(db, 'tenants', resolvedTenantId, 'applications', applicationDocId);
      const snap = await getDoc(appRef);
      const data = snap.exists() ? snap.data() : {};
      const existingData = (data as any).data || {};
      const existingReqs = existingData.requirements || {};
      const existingAcks = existingReqs.acks || {};
      await updateDoc(appRef, {
        data: { ...existingData, requirements: { ...existingReqs, acks: { ...existingAcks, [ackKey]: 'Yes' } } },
        updatedAt: serverTimestamp(),
      });
      setApplicationData((prev: any) => {
        const next = prev ? { ...prev } : {};
        next.data = next.data || {};
        next.data.requirements = next.data.requirements || {};
        next.data.requirements.acks = { ...(next.data.requirements.acks || {}), [ackKey]: 'Yes' };
        return next;
      });
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(
        userRef,
        buildCanonicalWorkerProfileWritePatch({ educationLevel: level, updatedAt: serverTimestamp() }),
      );
      setUserProfile((p: any) => ({ ...p, educationLevel: level }));
    } catch (err) {
      console.error('Failed to update education:', err);
      alert('We couldn\'t save that. Please try again.');
    }
  };

  const formatAddressText = (address: any): string => {
    if (!address) return '';
    return [address.street, address.city, address.state, address.zipCode || address.zip]
      .filter(Boolean)
      .join(', ');
  };

  const getOfferSnapshotForShift = (shiftId?: string) => {
    const shift = shiftId ? dynamicShifts.find((s: any) => String(s.shiftId) === String(shiftId)) : null;
    const worksiteAddress = assignmentData?.worksiteAddress || posting?.worksiteAddress || null;
    const shiftDateRaw = assignmentData?.startDate || assignmentStartDate || shift?.shiftDate || posting?.startDate || null;
    const startTimeRaw = assignmentData?.startTime || shift?.startTime || scheduleShiftData?.defaultStartTime || null;
    const endTimeRaw = assignmentData?.endTime || shift?.endTime || scheduleShiftData?.defaultEndTime || null;

    const jobTitle = assignmentData?.jobTitle || shift?.defaultJobTitle || posting?.postTitle || posting?.jobTitle || '';
    const companyName = assignmentData?.companyName || posting?.companyName || '';
    const locationName = assignmentData?.worksiteName || assignmentData?.location || posting?.worksiteName || posting?.location || '';
    const address = formatAddressText(worksiteAddress);
    const uniformSummary =
      assignmentData?.uniformRequirements ||
      assignmentData?.customUniformRequirements ||
      posting?.uniformRequirements ||
      posting?.customUniformRequirements ||
      '';
    const screeningPostSummary = (() => {
      if (!posting?.showScreeningPackageOnPost) return null;
      const names = Array.isArray(posting?.screeningPackageServiceNames)
        ? posting.screeningPackageServiceNames.map((s: string) => String(s || '').trim()).filter(Boolean)
        : [];
      const pkgName = String(posting?.screeningPackageName || '').trim();
      if (!names.length && !pkgName) return null;
      if (names.length) {
        return `Screening: ${names.join(', ')}`;
      }
      return WORKER_SCREENING_SHORT_FALLBACK;
    })();
    const keyRequirementParts = [
      screeningPostSummary,
      posting?.showBackgroundChecks ? 'Background check required' : null,
      posting?.showDrugScreening ? 'Drug screening required' : null,
      posting?.eVerifyRequired ? 'E-Verify required' : null,
      posting?.requiredPpe ? `Required PPE: ${String(posting.requiredPpe)}` : null,
    ].filter(Boolean) as string[];

    return {
      jobTitle,
      companyName,
      shiftDateRaw,
      shiftDateText: shiftDateRaw ? formatDate(shiftDateRaw) : '',
      startTimeRaw,
      startTimeText: startTimeRaw ? formatTime(startTimeRaw) : '',
      endTimeRaw,
      endTimeText: endTimeRaw ? formatTime(endTimeRaw) : '',
      locationName,
      address,
      uniformSummary: String(uniformSummary || ''),
      keyRequirementsSummary: keyRequirementParts.join(' | '),
    };
  };

  const recordOfferConfirmationOpened = async (shiftId?: string) => {
    if (!resolvedTenantId || !applicationDocId) return;
    const snapshot = getOfferSnapshotForShift(shiftId);
    const appRef = doc(db, 'tenants', resolvedTenantId, 'applications', applicationDocId);
    await setDoc(
      appRef,
      {
        workerOfferConfirmation: {
          openedAt: serverTimestamp(),
          shiftSnapshot: {
            jobTitle: snapshot.jobTitle,
            companyName: snapshot.companyName,
            locationName: snapshot.locationName,
            address: snapshot.address,
            shiftDate: snapshot.shiftDateRaw || snapshot.shiftDateText || '',
            startTime: snapshot.startTimeRaw || snapshot.startTimeText || '',
            endTime: snapshot.endTimeRaw || snapshot.endTimeText || '',
          },
          version: 1,
        },
      },
      { merge: true }
    );
  };

  const openOfferConfirmationSheet = (shiftId?: string) => {
    setOfferConfirmationShiftId(shiftId);
    setAckOnTimeArrival(false);
    setAckUniformAndRequirements(false);
    setAckNoShowConsequence(false);
    setOfferConfirmError(null);
    setOfferConfirmationOpen(true);
    recordOfferConfirmationOpened(shiftId).catch((err) => {
      console.warn('Failed to record offer confirmation openedAt:', err);
    });
  };

  const closeOfferConfirmationSheet = () => {
    if (offerConfirmSubmitting || assignmentDecisionLoading) return;
    setOfferConfirmationOpen(false);
    setOfferConfirmError(null);
  };

  const findAssignmentIdForShift = async (shiftId: string): Promise<string | null> => {
    if (!resolvedTenantId || !user?.uid) return null;
    const assignmentsRef = collection(db, 'tenants', resolvedTenantId, 'assignments');
    const assignmentQuery = query(
      assignmentsRef,
      where('userId', '==', user.uid),
      where('shiftId', '==', shiftId),
    );
    const snapshot = await getDocs(assignmentQuery);
    if (snapshot.empty) return null;

    const preferred = snapshot.docs.find((docSnap) => {
      const status = String((docSnap.data() || {}).status || '').toLowerCase();
      return status === 'proposed' || status === 'confirmed';
    });
    return (preferred || snapshot.docs[0]).id;
  };

  const findAssignmentIdByApplicationId = async (appId: string): Promise<string | null> => {
    if (!resolvedTenantId || !user?.uid) return null;
    const assignmentsRef = collection(db, 'tenants', resolvedTenantId, 'assignments');
    const assignmentQuery = query(
      assignmentsRef,
      where('userId', '==', user.uid),
      where('applicationId', '==', appId),
    );
    const snapshot = await getDocs(assignmentQuery);
    if (snapshot.empty) return null;
    const preferred = snapshot.docs.find((docSnap) => {
      const status = String((docSnap.data() || {}).status || '').toLowerCase();
      return status === 'proposed' || status === 'confirmed';
    });
    return (preferred || snapshot.docs[0]).id;
  };

  type AssignmentDecisionOptions = {
    skipConfirmPrompt?: boolean;
    suppressAlerts?: boolean;
    redirectOnAccept?: boolean;
  entryPoint?:
    | 'accept_button'
    | 'decline_button'
    | 'offer_confirmation_drawer'
    | 'quick_confirm_cached_acks'
    | 'unknown';
  };

  const handleAssignmentDecision = async (
    decision: 'accept' | 'decline' | 'worker_cancel',
    shiftId?: string,
    options: AssignmentDecisionOptions = {}
  ) => {
    if (!resolvedTenantId || !user?.uid) return;

    const {
      skipConfirmPrompt = false,
      suppressAlerts = false,
      redirectOnAccept = true,
      entryPoint = 'unknown',
    } = options;

    const isWorkerCancel = decision === 'worker_cancel';

    if (!skipConfirmPrompt) {
      const confirmMessage =
        decision === 'accept'
          ? 'Are you sure you want to accept this job?'
          : isWorkerCancel
            ? 'Are you sure you can no longer work this shift? This will cancel your assignment — you can re-apply afterward.'
            : 'Are you sure you want to decline this job?';
      if (!window.confirm(confirmMessage)) return;
    }

    setAssignmentDecisionLoading(true);
    try {
      const params = new URLSearchParams(location.search);
      let assignmentId = params.get('assignmentId');
      if (!assignmentId && shiftId) {
        assignmentId = await findAssignmentIdForShift(shiftId);
      }
      if (!assignmentId && applicationData?.assignmentId) {
        assignmentId = String(applicationData.assignmentId);
      }
      if (!assignmentId && applicationDocId) {
        assignmentId = await findAssignmentIdByApplicationId(applicationDocId);
      }

      if (!assignmentId) {
        alert('Could not find your assignment for this shift. Please try again.');
        return;
      }

      if (applicationDocId) {
        const appRef = doc(db, 'tenants', resolvedTenantId, 'applications', applicationDocId);
        await setDoc(
          appRef,
          {
            lastAssignmentDecision: {
              decision,
              assignmentId,
              shiftId: shiftId || null,
              entryPoint,
              byUid: user.uid,
              at: serverTimestamp(),
            },
          },
          { merge: true },
        );
      }

      const respondFn = httpsCallable(functions, 'respondToAssignment');
      await respondFn({
        tenantId: resolvedTenantId,
        assignmentId,
        decision,
      });

      if (decision === 'accept') {
        if (shiftId) setShiftStatuses((prev) => ({ ...prev, [shiftId]: 'confirmed' }));
        setApplicationStatus('confirmed');
        setAcceptedAssignmentId(assignmentId);
        if (user?.uid && assignmentId) {
          logAssignmentUpdateActivity(user.uid, assignmentId, 'confirmed').catch((e) =>
            console.warn('Failed to log assignment confirmed activity:', e)
          );
        }
        if (!suppressAlerts) {
          alert('Assignment accepted! We sent your first-day details.');
        }
        if (redirectOnAccept) {
          navigate(`/c1/workers/assignments/${assignmentId}`);
          return;
        }
      } else {
        // worker_cancel → 'reapply' (worker-cancelled, can re-apply right
        // here); legacy decline → 'withdrawn'.
        if (shiftId) {
          setShiftStatuses((prev) => ({ ...prev, [shiftId]: isWorkerCancel ? 'reapply' : 'withdrawn' }));
        }
        setApplicationStatus('withdrawn');
        if (user?.uid && assignmentId) {
          logAssignmentUpdateActivity(user.uid, assignmentId, isWorkerCancel ? 'worker-cancelled' : 'declined').catch((e) =>
            console.warn('Failed to log assignment cancel activity:', e)
          );
        }
        if (isWorkerCancel) {
          // Stay on the posting so the worker immediately sees the
          // "Re-apply to Shift" control on this shift's card.
          if (!suppressAlerts) {
            alert('Got it — we let the team know you can no longer work this shift. You can re-apply below anytime.');
          }
          setAppliedShiftsRefresh((n) => n + 1);
          return;
        }
        if (!suppressAlerts) {
          alert('You declined this job. Your application has been withdrawn.');
        }
        const jobsBoardUrl = typeof window !== 'undefined' && window.location.origin
          ? `${window.location.origin}/c1/jobs-board`
          : 'https://hrxone.com/c1/jobs-board';
        window.location.href = jobsBoardUrl;
        return;
      }
    } catch (err) {
      console.error(`Failed to ${decision} assignment:`, err);
      // Headshot gate: show the localized retake nudge and offer a one-tap path to the
      // profile page where the worker can upload a new photo. Falls through to the generic
      // alert for any non-gate error.
      const gate = decision === 'accept' ? formatHeadshotGateError(err) : null;
      if (gate && !suppressAlerts) {
        const takeThem = window.confirm(`${gate.message}\n\n${gate.retakeLabel}?`);
        if (takeThem) navigate('/c1/workers/profile');
      } else if (!suppressAlerts) {
        alert(`We were unable to ${decision} this assignment. Please try again.`);
      }
      if (suppressAlerts) {
        throw err;
      }
    } finally {
      setAssignmentDecisionLoading(false);
    }
  };

  const handleConfirmAssignment = async () => {
    openOfferConfirmationSheet();
  };

  /**
   * Session-scoped acknowledgement cache: once the worker has ticked the
   * 3 boxes (on-time arrival / uniform / no-show) for a shift on a given
   * JO, we persist that fact in sessionStorage and let subsequent shift
   * confirmations on the same JO go straight to the accept callable
   * without re-opening the modal. The acks are a worker-level commitment
   * that applies equally to every shift on the JO — the modal was
   * front-loading the same 3 ticks per shift, which made multi-shift
   * confirm a ~12-tap workflow when it should be 1 tap each.
   *
   * sessionStorage = scoped to THIS tab and clears when the tab closes,
   * so a fresh browser session brings the modal back. localStorage would
   * be too permanent (we want recruiters to see the modal at least once
   * per worker visit).
   *
   * Keyed by `jobOrderId` — a worker confirming shifts on a DIFFERENT
   * job order has to re-acknowledge, because the worksite / uniform /
   * shift expectations can differ across JOs.
   */
  const sessionAcksKey = (joId: string) => `offerAcks_${joId}`;
  const hasSessionAcks = (joId: string | null | undefined): boolean => {
    if (!joId || typeof window === 'undefined') return false;
    try {
      return Boolean(window.sessionStorage.getItem(sessionAcksKey(joId)));
    } catch {
      return false;
    }
  };
  const markSessionAcks = (joId: string | null | undefined): void => {
    if (!joId || typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(
        sessionAcksKey(joId),
        JSON.stringify({
          ackedAt: new Date().toISOString(),
          acks: {
            onTimeArrival: true,
            understandsUniformAndRequirements: true,
            understandsNoShowConsequence: true,
          },
        }),
      );
    } catch {
      /* ignore quota errors */
    }
  };

  const handleConfirmAssignmentForShift = async (shiftId: string) => {
    const joId = posting?.jobOrderId;
    // Quick-confirm path: this worker already ack'd the operational
    // commitments on a prior shift this session. Skip the modal and
    // fire the accept callable directly. `redirectOnAccept: false` so
    // they stay on the JO posting and can keep confirming the rest.
    if (joId && hasSessionAcks(joId)) {
      try {
        await handleAssignmentDecision('accept', shiftId, {
          skipConfirmPrompt: true,
          suppressAlerts: true,
          redirectOnAccept: false,
          entryPoint: 'quick_confirm_cached_acks',
        });
      } catch (err) {
        console.error('Quick-confirm failed; falling back to modal:', err);
        // If the callable fails (e.g. headshot gate, server hiccup), drop
        // back to the modal so the user sees the full error context.
        openOfferConfirmationSheet(shiftId);
      }
      return;
    }
    // First confirm on this JO this session — modal handles the 3 acks,
    // and `handleSubmitOfferConfirmation` caches them on submit.
    openOfferConfirmationSheet(shiftId);
  };

  const handleDeclineAssignment = async () => {
    // Worker-initiated → 'worker_cancel' so the shift becomes re-appliable.
    await handleAssignmentDecision('worker_cancel', undefined, { entryPoint: 'decline_button' });
  };

  const handleDeclineAssignmentForShift = async (shiftId: string) => {
    await handleAssignmentDecision('worker_cancel', shiftId, { entryPoint: 'decline_button' });
  };

  const handleSubmitOfferConfirmation = async () => {
    if (!resolvedTenantId || !applicationDocId) {
      setOfferConfirmError('We could not find your application record. Please refresh and try again.');
      return;
    }
    if (!(ackOnTimeArrival && ackUniformAndRequirements && ackNoShowConsequence)) {
      setOfferConfirmError('Please check all required acknowledgements to continue.');
      return;
    }

    setOfferConfirmSubmitting(true);
    setOfferConfirmError(null);

    try {
      const snapshot = getOfferSnapshotForShift(offerConfirmationShiftId);
      const appRef = doc(db, 'tenants', resolvedTenantId, 'applications', applicationDocId);
      await setDoc(
        appRef,
        {
          workerOfferConfirmation: {
            openedAt: serverTimestamp(),
            submittedAt: serverTimestamp(),
            acceptedAt: serverTimestamp(),
            acknowledgements: {
              onTimeArrival: true,
              understandsUniformAndRequirements: true,
              understandsNoShowConsequence: true,
            },
            shiftSnapshot: {
              jobTitle: snapshot.jobTitle,
              companyName: snapshot.companyName,
              locationName: snapshot.locationName,
              address: snapshot.address,
              shiftDate: snapshot.shiftDateRaw || snapshot.shiftDateText || '',
              startTime: snapshot.startTimeRaw || snapshot.startTimeText || '',
              endTime: snapshot.endTimeRaw || snapshot.endTimeText || '',
            },
            version: 1,
          },
        },
        { merge: true }
      );

      await handleAssignmentDecision('accept', offerConfirmationShiftId, {
        skipConfirmPrompt: true,
        suppressAlerts: true,
        // Stay on the jobs board so the worker can keep tapping Confirm
        // on the rest of their offered shifts. The previous `true` here
        // bounced them to the assignment-details page after the very
        // first confirm — which broke the multi-shift confirm flow this
        // page is built around.
        redirectOnAccept: false,
        entryPoint: 'offer_confirmation_drawer',
      });
      // Cache the acks so subsequent Confirm taps on this JO skip the
      // modal entirely. See `handleConfirmAssignmentForShift` for the
      // read side.
      markSessionAcks(posting?.jobOrderId);
      setOfferConfirmationOpen(false);
    } catch (err) {
      console.error('Failed to confirm offer acknowledgement:', err);
      // Surface the actual rejection reason instead of the generic "try again" —
      // most common case is the Accept-flow headshot gate (HEADSHOT_MISSING /
      // PENDING / REJECTED). The `formatHeadshotGateError` helper returns
      // localized, actionable copy when this is a gate error, null otherwise.
      const gate = formatHeadshotGateError(err);
      if (gate) {
        setOfferConfirmError(
          `${gate.message} You can upload a new photo from your profile, then come back here and tap Confirm Shift.`,
        );
      } else {
        // Try to surface a usable message from the FirebaseError when one is present.
        // Server callables throw HttpsError with a human-readable message in `err.message`;
        // we'd rather show that than the generic copy when it's available.
        const errMsg =
          (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string'
            ? (err as { message: string }).message
            : '') || '';
        // Strip Firebase's "Firebase: " prefix and "(functions/<code>)" suffix when present.
        const cleaned = errMsg
          .replace(/^Firebase:\s*/i, '')
          .replace(/\s*\(functions\/[^)]+\)\s*$/i, '')
          .trim();
        setOfferConfirmError(
          cleaned && cleaned.length > 0 && cleaned.length < 300
            ? `${cleaned} Please try again — if this keeps happening, contact your recruiter.`
            : 'We were unable to confirm this shift right now. Please try again — if this keeps happening, contact your recruiter.',
        );
      }
    } finally {
      setOfferConfirmSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ maxWidth: 1200, mx: 'auto', p: isMobile ? 2 : 3 }}>
        <Skeleton variant="rectangular" width="100%" height={200} sx={{ mb: 3, borderRadius: 1 }} />
        <Skeleton variant="rectangular" width="100%" height={300} sx={{ mb: 3, borderRadius: 1 }} />
        <Skeleton variant="rectangular" width="100%" height={400} sx={{ borderRadius: 1 }} />
      </Box>
    );
  }

  if (error || !posting) {
    return (
      <Box p={3}>
        <Alert severity="error">{error || t('jobs.jobPostingNotFound')}</Alert>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/c1/jobs-board')}
          sx={{ mt: 2 }}
        >
          {t('jobs.backToJobsBoard')}
        </Button>
      </Box>
    );
  }

  // Calculate button props for application status button
  const statusButtonProps = applicationStatus
    ? getApplicationStatusButton(applicationStatus)
    : null;

  // Show "Apply Again" when user previously applied and withdrew or was cancelled
  const showApplyAgain = Boolean(
    applicationStatus && ['withdrawn', 'cancelled'].includes(applicationStatus.toLowerCase())
  );

  const stepsToApply = eligibilitySummary?.missingRequired.length ?? 0;

  // Mobile sticky Apply footer: show only for non-gig jobs. Gigs are applied shift-by-shift (or day-by-day) via ShiftSelector, not a general Apply bar.
  const isGigWithShifts = posting?.jobType === 'gig' && dynamicShifts.length > 0;
  // Express-interest (ongoing/open-shift) postings apply generically — no dated
  // shift to pick — so they take the non-gig Apply path even though jobType is
  // 'gig'. Applicants land in the posting's user group; real dated shifts (if
  // added later) start showing via dynamic shifts and flip this off.
  const isExpressInterest =
    posting?.applyMode === 'express_interest' && !isGigWithShifts;
  const isNonGigApply = !isGigWithShifts && (statusButtonProps?.label === t('jobs.applyNow') || showApplyAgain) && !(statusButtonProps?.label === 'accepted_special' || statusButtonProps?.label === 'confirmed_special');
  const showStickyApply = Boolean(isMobile && posting && scrolledPastHeader && isNonGigApply);

  // Assignment accept/decline link from SMS: show "You've been hired" + I Accept / Decline Job
  const params = new URLSearchParams(location.search);
  const urlAssignmentId = params.get('assignmentId');
  const intent = params.get('intent');
  const isAssignmentResponseMode = Boolean(urlAssignmentId && intent === 'assignment_response');
  const showOfferResponseMinimalView = isAssignmentResponseMode;
  const showAssignmentInfoOnJobPosting = false;
  const assignmentDetailsId =
    acceptedAssignmentId ||
    urlAssignmentId ||
    (applicationData?.assignmentId ? String(applicationData.assignmentId) : null);
  const assignmentDetailsUrl = assignmentDetailsId
    ? `${typeof window !== 'undefined' && window.location.origin ? window.location.origin : 'https://hrxone.com'}/c1/workers/assignments/${assignmentDetailsId}`
    : null;
  const offerSnapshot = getOfferSnapshotForShift(offerConfirmationShiftId);
  const offerConfirmReady = ackOnTimeArrival && ackUniformAndRequirements && ackNoShowConsequence;
  const arrivalLocationText = offerSnapshot.locationName || offerSnapshot.address || 'the worksite';
  const arrivalStartTimeText = offerSnapshot.startTimeText || 'the scheduled start time';

  // Generate Google Jobs structured data
  const generateJobPostingSchema = () => {
    // Helper to safely convert date to ISO string
    const toISOString = (date: any) => {
      if (!date) return undefined;
      try {
        // Handle Firestore Timestamp
        if (date?.toDate) {
          return date.toDate().toISOString();
        }
        // Handle Date object or string
        const d = new Date(date);
        if (isNaN(d.getTime())) {
          return undefined;
        }
        return d.toISOString();
      } catch {
        return undefined;
      }
    };

    const schema = {
      '@context': 'https://schema.org/',
      '@type': 'JobPosting',
      title: posting.postTitle,
      description: posting.jobDescription || '',
      identifier: {
        '@type': 'PropertyValue',
        name: posting.companyName || 'HRX',
        value: posting.jobPostId || posting.id,
      },
      datePosted: toISOString(posting.createdAt) || new Date().toISOString(),
      validThrough: toISOString(posting.expDate),
      employmentType: posting.jobType === 'gig' ? 'TEMPORARY' : 'FULL_TIME',
      hiringOrganization: {
        '@type': 'Organization',
        name: posting.companyName || 'HRX',
        sameAs: `https://hrxone.com`,
      },
      jobLocation: {
        '@type': 'Place',
        address: {
          '@type': 'PostalAddress',
          streetAddress: posting.worksiteAddress?.street || '',
          addressLocality: posting.worksiteAddress?.city || '',
          addressRegion: posting.worksiteAddress?.state || '',
          postalCode: posting.worksiteAddress?.zipCode || '',
          addressCountry: 'US',
        },
      },
      baseSalary:
        posting.showPayRate && posting.payRate
          ? {
              '@type': 'MonetaryAmount',
              currency: 'USD',
              value: {
                '@type': 'QuantitativeValue',
                value: posting.payRate,
                unitText: 'HOUR',
              },
            }
          : undefined,
      directApply: true,
      applicationContact: {
        '@type': 'ContactPoint',
        email: 'jobs@c1staffing.com',
      },
    };

    // Remove undefined values
    return JSON.parse(JSON.stringify(schema));
  };

  const cardPadding = isMobile ? 1.5 : 2.5;
  const cardBaseSx = {
    width: '100%',
    maxWidth: '100%',
    boxSizing: 'border-box',
    p: cardPadding,
    borderRadius: 3,
    overflow: 'hidden',
  } as const;

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', p: 0, pt: 2, px: { xs: 2, sm: 3 }, pb: showStickyApply ? 10 : 0 }}>
      {/* Google Jobs Structured Data */}
      <Helmet>
        <title>
          {posting.postTitle} - {posting.companyName || 'HRX'}
        </title>
        <meta name="description" content={posting.jobDescription?.substring(0, 160) || ''} />
        <script type="application/ld+json">{JSON.stringify(generateJobPostingSchema())}</script>
      </Helmet>

      {/* One-click DECLINE banner — shown when worker arrived via the
          SMS DECLINE link. After success, the shift list below is the
          natural next step (apply to a different shift). */}
      {declineIntentState === 'firing' && (
        <Alert severity="info" icon={<CircularProgress size={16} />} sx={{ mb: 2 }}>
          Declining your assignment…
        </Alert>
      )}
      {declineIntentState === 'success' && (
        <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setDeclineIntentState('idle')}>
          You&apos;ve declined this assignment. If you changed your mind, you can apply to
          another shift below.
        </Alert>
      )}
      {declineIntentState === 'error' && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setDeclineIntentState('idle')}>
          We couldn&apos;t decline this assignment automatically: {declineIntentError || 'unknown error'}.
          Contact your recruiter if you need to opt out.
        </Alert>
      )}

      {/* Top row: Back to Jobs Board + Language picker + Sign In or Create Account (when guest) */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 3 }}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/c1/jobs-board')}
          size={isMobile ? 'small' : 'medium'}
        >
          {t('jobs.backToJobsBoard')}
        </Button>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {!user && (
            <>
              <Tooltip title={guestLanguage === 'es' ? t('nav.messageLanguageEs') : t('nav.messageLanguageEn')}>
                <Box
                  component="button"
                  onClick={(e) => setLanguageMenuAnchorEl(e.currentTarget)}
                  aria-label={t('nav.language')}
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 0.5,
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    px: 1,
                    py: 0.75,
                    bgcolor: 'background.paper',
                    color: 'text.secondary',
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
                  }}
                >
                  <LanguageIcon sx={{ fontSize: 20 }} />
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {guestLanguage === 'es' ? 'ES' : 'EN'}
                  </Typography>
                </Box>
              </Tooltip>
          </>
          )}
          {!user && (
            <Button
              variant="contained"
              onClick={() => setAuthDialogOpen(true)}
              size={isMobile ? 'small' : 'medium'}
              sx={{
                px: { xs: 1.5, sm: 2 },
                py: { xs: 0.75, sm: 1 },
                fontWeight: 600,
                borderRadius: 2,
                textTransform: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              {t('jobs.signInOrCreateAccount')}
            </Button>
          )}
        </Box>
      </Box>
      {!user && (
        <Menu
          anchorEl={languageMenuAnchorEl}
          open={Boolean(languageMenuAnchorEl)}
          onClose={() => setLanguageMenuAnchorEl(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        >
          <MenuItem
            selected={guestLanguage === 'en'}
            onClick={() => {
              setLanguageMenuAnchorEl(null);
              setGuestLanguage('en');
            }}
          >
            {t('nav.englishEn')}
          </MenuItem>
          <MenuItem
            selected={guestLanguage === 'es'}
            onClick={() => {
              setLanguageMenuAnchorEl(null);
              setGuestLanguage('es');
            }}
          >
            {t('nav.espanolEs')}
          </MenuItem>
        </Menu>
      )}

      <AuthDialog
        open={authDialogOpen}
        onClose={() => setAuthDialogOpen(false)}
        onAuthSuccess={() => setAuthDialogOpen(false)}
        initialPreferredLanguage={guestLanguage}
      />

      {/* Hero header card */}
      <Paper ref={heroHeaderRef} elevation={2} sx={{ ...cardBaseSx, mb: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, mb: 1 }}>
              <Typography component="h1" variant={isMobile ? 'h5' : 'h4'} sx={{ fontWeight: 700, fontSize: isMobile ? '1.35rem' : '1.5rem' }}>
                {getJobPostingDisplayText(posting, 'postTitle', displayLanguage) || posting.postTitle}
              </Typography>
              <Tooltip title={t('jobs.copyLink')}>
                <IconButton
                  size="small"
                  onClick={() => {
                    navigator.clipboard.writeText(window.location.href);
                    setShareSnackbarOpen(true);
                  }}
                  sx={{ color: 'text.secondary', flexShrink: 0 }}
                  aria-label={t('jobs.copyLink')}
                >
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>

            {/* Client company name intentionally hidden on public job postings — */}
            {/* the tenant brand is shown at the top of the page; surfacing the */}
            {/* underlying client employer publicly is not desirable for staffing-agency */}
            {/* tenants. SEO structured data (hiringOrganization) and the post-application */}
            {/* assignment-details card still surface the company; only the public-facing */}
            {/* hero header line is suppressed. */}

            {/* Pay rate — visually dominant in header (hierarchy: Title → PAY RATE → Location → Next Shift) */}
            {posting.showPayRate && posting.payRate != null && (
              <Typography
                component="div"
                sx={{
                  fontWeight: 800,
                  color: 'success.dark',
                  fontSize: isMobile ? '1.5rem' : '1.75rem',
                  letterSpacing: '-0.02em',
                  mb: 1.5,
                  lineHeight: 1.2,
                }}
              >
                {t('jobs.hourlyRateDisplay', { amount: formatHourlyPayAmountForI18n(posting.payRate) })}
              </Typography>
            )}

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
              {posting.worksiteAddress?.city && posting.worksiteAddress?.state && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <LocationIcon fontSize="small" color="action" />
                  <Typography variant="body2" color="text.secondary">
                    {posting.worksiteAddress.city}, {posting.worksiteAddress.state}
                    {posting.worksiteAddress.zipCode ? ` ${posting.worksiteAddress.zipCode}` : ''}
                  </Typography>
                </Box>
              )}
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Chip label={posting.jobType === 'gig' ? t('jobs.gig') : t('jobs.career')} color="primary" size="small" />
              {(() => {
                // For gig jobs with shifts, show next shift date (today or later, local time)
                if (posting.jobType === 'gig' && dynamicShifts.length > 0) {
                  const now = new Date();
                  const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
                  const allDates: string[] = [];
                  dynamicShifts.forEach((s: any) => {
                    if (s.dateSchedule && s.endDate && s.endDate !== s.shiftDate) {
                      const entries = getDateScheduleEntriesWithHours(s.dateSchedule, s.shiftDate, s.endDate);
                      entries.forEach((e) => allDates.push(e.date));
                    } else if (s.shiftDate) {
                      // Bug fix (Next Shift showing 6/8 for a 6/9 shift):
                      // a bare "YYYY-MM-DD" string parsed via `new Date()`
                      // is interpreted as midnight UTC, then read back with
                      // local getters in US-Pacific — which rolls the day
                      // BACK to the previous calendar date. For string
                      // shiftDates use the no-Date split helper so the
                      // calendar day is preserved exactly. Firestore
                      // Timestamps (a real instant) still go through
                      // toDate + local getters.
                      if (typeof s.shiftDate === 'string') {
                        const iso = extractDateFromShiftDate(s.shiftDate);
                        if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) allDates.push(iso);
                      } else if (s.shiftDate?.toDate) {
                        const d = s.shiftDate.toDate();
                        if (!isNaN(d.getTime())) {
                          const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
                          allDates.push(`${y}-${m}-${day}`);
                        }
                      }
                    }
                  });
                  const nextDate = [...new Set(allDates)].filter((d) => d >= todayISO).sort()[0];
                  if (nextDate) {
                    const [y, m, day] = nextDate.split('-').map(Number);
                    const displayDate = `${m}/${day}/${y}`;
                    return (
                      <Chip
                        icon={<ScheduleIcon />}
                        label={t('jobs.nextShiftLabel', { date: displayDate })}
                        size="small"
                        variant="outlined"
                      />
                    );
                  }
                }
                // For non-gig jobs or gigs without shifts, show start date if available
                if (posting.startDate) {
                  const dateStr = formatDate(posting.startDate);
                  return (
                    <Chip
                      icon={<ScheduleIcon />}
                      label={
                        posting.jobType === 'career'
                          ? t('jobs.estimatedStartLabel', { date: dateStr })
                          : t('jobs.startsLabel', { date: dateStr })
                      }
                      size="small"
                      variant="outlined"
                    />
                  );
                }
                return null;
              })()}
            </Box>
          </Box>

          {/*
            Primary actions / status block.
            For gigs, applying is always shift-by-shift — never via a generic
            Apply button at the JO level — so we suppress this whole block
            for any gig posting, regardless of whether shifts have loaded.
            (Previously this was only suppressed when shifts were already
            loaded, which let the generic Apply button leak through during
            the brief window before `dynamicShifts` populated, and stayed
            visible permanently for gigs that had zero shifts attached.)
          */}
          {(posting.jobType !== 'gig' || isExpressInterest) &&
            ((statusButtonProps?.label === 'accepted_special' || isAssignmentResponseMode) && statusButtonProps?.label !== 'confirmed_special' ? (
              <Typography variant="body2" sx={{ color: '#2e7d32', fontWeight: 700 }}>
                You&apos;ve been hired to work this job.
              </Typography>
            ) : statusButtonProps?.label === 'confirmed_special' ? (
              assignmentDetailsUrl ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'center' }}>
                  <Button
                    component={Link}
                    to={`/c1/workers/assignments/${assignmentDetailsId}`}
                    variant="contained"
                    size={isMobile ? 'small' : 'medium'}
                    sx={{
                      borderRadius: '999px',
                      px: isMobile ? 1.5 : 2,
                      fontSize: isMobile ? '0.75rem' : undefined,
                      fontWeight: 600,
                    }}
                  >
                    View Assignment Details
                  </Button>
                </Box>
              ) : null
            ) : statusButtonProps ? (
              statusButtonProps.label === 'Application Submitted' ? (
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: { xs: 'stretch', sm: 'flex-end' },
                    gap: 1,
                  }}
                >
                  <Button
                    variant="contained"
                    size="small"
                    disableElevation
                    sx={{
                      borderRadius: '32px',
                      px: 2.5,
                      py: 0.65,
                      fontWeight: 600,
                      fontSize: '0.85rem',
                      backgroundColor: statusButtonProps.backgroundColor,
                      color: statusButtonProps.color,
                      '&:hover': {
                        backgroundColor: statusButtonProps.backgroundColor,
                      },
                    }}
                  >
                    {getStatusDisplayLabel(statusButtonProps.label)}
                  </Button>
                  <Button
                    variant="contained"
                    size="small"
                    color="error"
                    onClick={handleCancelApplication}
                    sx={{
                      borderRadius: '999px',
                      px: 2,
                      fontWeight: 600,
                    }}
                    disabled={!applicationDocId}
                  >
                    Cancel Application
                  </Button>
                </Box>
              ) : showApplyAgain ? (
                <Button
                  variant="contained"
                  size="small"
                  onClick={handleApply}
                  sx={{
                    borderRadius: '999px',
                    px: 2,
                    fontWeight: 600,
                  }}
                >
                  Apply Again
                </Button>
              ) : (
                <Box
                  sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}
                >
                  <Button
                    variant="contained"
                    size={isMobile ? 'medium' : 'large'}
                    sx={{
                      minWidth: isMobile ? 150 : 200,
                      py: isMobile ? 1 : 1.5,
                      fontSize: isMobile ? '0.9rem' : '1.1rem',
                      fontWeight: 'bold',
                      backgroundColor: statusButtonProps.backgroundColor,
                      color: statusButtonProps.color,
                      '&:hover': {
                        backgroundColor: statusButtonProps.backgroundColor,
                      },
                      cursor: statusButtonProps.cursor,
                      pointerEvents: statusButtonProps.pointerEvents,
                    }}
                  >
                    {getStatusDisplayLabel(statusButtonProps.label)}
                  </Button>
                  {applicationStatus && getApplicationStatusHelperText(applicationStatus) && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ textAlign: 'center', maxWidth: 280 }}
                    >
                      {getApplicationStatusHelperText(applicationStatus)}
                    </Typography>
                  )}
                  {applicationStatus && applicationJobScore != null && (
                    <Card variant="outlined" sx={{ mt: 2, p: 1.5, borderRadius: 2 }}>
                      <Typography variant="caption" color="text.secondary" display="block">
                        {t('jobs.yourJobFit')}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 0.5 }}>
                        {'version' in applicationJobScore && applicationJobScore.version === 'v1' && !applicationJobScore.eligible && (
                          <Chip size="small" label={t('jobs.notEligible')} color="error" />
                        )}
                        <Chip
                          size="small"
                          label={t('jobs.scoreChip', { score: Math.round(applicationJobScore.jobScore) })}
                          color={applicationJobScore.eligible ? 'success' : 'default'}
                        />
                        {(() => {
                          const missing = 'version' in applicationJobScore && applicationJobScore.version === 'v1'
                            ? (applicationJobScore.buckets?.missingRequired ?? []).map((x: any) => x.label)
                            : ((applicationJobScore as JobScoreSummary).missingLabels ?? []);
                          return missing.length ? (
                            <Typography variant="caption" color="text.secondary">
                              {t('jobs.missing')}: {missing.slice(0, 3).join(', ')}
                              {missing.length > 3 ? '…' : ''}
                            </Typography>
                          ) : applicationJobScore.eligible ? (
                            <Typography variant="caption" color="success.main">{t('jobs.eligible')}</Typography>
                          ) : null;
                        })()}
                      </Box>
                    </Card>
                  )}
                </Box>
              )
            ) : (
              <Button
                variant="contained"
                size="small"
                onClick={handleApply}
                sx={{
                  borderRadius: '999px',
                  px: 2,
                  fontWeight: 600,
                }}
              >
                {t('jobs.applyForJob')}
              </Button>
            ))}
        </Box>
      </Paper>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            md: posting.jobType === 'gig' && dynamicShifts.length > 0 ? '1fr' : '2fr 1fr',
          },
          gap: 3,
        }}
      >
        {/* Main Content */}
        <Box sx={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
          {/* About this Job — description with optional Read more */}
          {(() => {
            const rawDesc = getJobPostingDisplayText(posting, 'jobDescription', displayLanguage) || posting.jobDescription || '';
            const cleanedDesc = rawDesc.replace(/\*\*([^*]+):\*\*/g, '$1:').replace(/\*\*([^*]+)\*\*/g, '$1').trim();
            const localizedDesc = localizeJobDescriptionEmbeddedLabels(cleanedDesc, displayLanguage);
            const charLimit = isMobile ? 280 : 400;
            const isLong = localizedDesc.length > charLimit;
            const showTruncated = isLong && !descriptionExpanded;
            const displayText = showTruncated ? localizedDesc.slice(0, charLimit) + '…' : localizedDesc;
            return (
              <Card sx={{ ...cardBaseSx, mb: 3 }} elevation={2}>
                <CardContent sx={{ p: 0 }}>
                  <Typography variant="h6" gutterBottom sx={{ fontWeight: 700 }}>
                    {t('jobs.aboutThisJob')}
                  </Typography>
                  <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                    {displayText || t('jobs.noDescriptionProvided')}
                  </Typography>
                  {isLong && (
                    <Button
                      size="small"
                      onClick={() => setDescriptionExpanded((e) => !e)}
                      sx={{ mt: 1, textTransform: 'none' }}
                    >
                      {descriptionExpanded ? t('jobs.showLess') : t('jobs.readMore')}
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })()}

          {/* Career shift schedule from job order (mirrors sidebar; visible in main column for job board readers) */}
          {posting.jobType === 'career' && careerWeeklyScheduleSummary ? (
            <Card sx={{ ...cardBaseSx, mb: 3 }} elevation={2}>
              <CardContent sx={{ p: 0 }}>
                <Typography variant="h6" gutterBottom sx={{ fontWeight: 700 }}>
                  {t('jobs.weeklySchedule')}
                </Typography>
                <Typography variant="body1" sx={{ lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                  {careerWeeklyScheduleSummary}
                </Typography>
              </CardContent>
            </Card>
          ) : null}

          {/* Location — address, map preview, Get Directions, optional distance */}
          {(posting.worksiteAddress?.street || posting.worksiteAddress?.city || posting.worksiteAddress?.state) && (
            <Card sx={{ ...cardBaseSx, mb: 3 }} elevation={2}>
              <CardContent sx={{ p: 0 }}>
                <Typography variant="h6" gutterBottom sx={{ fontWeight: 700 }}>
                  {t('jobs.location')}
                </Typography>
                {(() => {
                  const wa = posting.worksiteAddress;
                  const parts = [wa?.street, wa?.city, wa?.state, wa?.zipCode].filter(Boolean);
                  const addressStr = parts.join(', ');
                  const mapsQuery = encodeURIComponent(addressStr || `${wa?.city} ${wa?.state}`.trim());
                  return (
                    <>
                      <Typography variant="body1" sx={{ mb: 1 }}>
                        {posting.worksiteName ? `${posting.worksiteName} — ` : ''}{addressStr || t('jobs.addressTbd')}
                      </Typography>
                      {addressStr && (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', mb: 2 }}>
                          <Button
                            variant="contained"
                            size="small"
                            startIcon={<DirectionsIcon />}
                            href={`https://www.google.com/maps/search/?api=1&query=${mapsQuery}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            sx={{ textTransform: 'none' }}
                          >
                            {t('assignment.openInGoogleMaps')}
                          </Button>
                          {distanceMiles != null && (
                            <Typography variant="body2" color="text.secondary">
                              {distanceMiles < 0.1
                                ? t('jobs.distanceUnderPointOne')
                                : t('jobs.distanceMilesAway', { miles: distanceMiles.toFixed(1) })}
                            </Typography>
                          )}
                          {locationPermission === 'prompt' && jobCoords && (
                            <Button size="small" variant="outlined" onClick={requestLocationForDistance} sx={{ textTransform: 'none' }}>
                              {t('jobs.showDistanceFromMe')}
                            </Button>
                          )}
                          {locationPermission === 'denied' && (
                            <Typography variant="caption" color="text.secondary">{t('jobs.enableLocationToSeeDistance')}</Typography>
                          )}
                        </Box>
                      )}
                      {addressStr && (
                        <Box
                          component="iframe"
                          title={t('jobs.mapEmbedTitle')}
                          src={`https://www.google.com/maps?q=${mapsQuery}&output=embed`}
                          sx={{
                            width: '100%',
                            height: 170,
                            border: 0,
                            borderRadius: 1,
                            mt: 1,
                          }}
                        />
                      )}
                    </>
                  );
                })()}
              </CardContent>
            </Card>
          )}

          {/* Assignment Info + Schedule (hidden for SMS offer-response mode; keep original job-post view there) */}
          {((statusButtonProps?.label === 'accepted_special' || isAssignmentResponseMode) &&
            statusButtonProps?.label !== 'confirmed_special' &&
            assignmentData &&
            !showOfferResponseMinimalView &&
            showAssignmentInfoOnJobPosting) ? (
            <>
              <Card sx={{ ...cardBaseSx, mb: 3 }} elevation={2}>
                <CardContent>
                  <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
                    {t('assignment.assignmentInfo')}
                  </Typography>
                  <Grid container spacing={3}>
                    <Grid item xs={12} sm={6}>
                      <Stack spacing={2}>
                        <Stack direction="row" spacing={2} alignItems="center">
                          <WorkIcon color="action" sx={{ flexShrink: 0 }} />
                          <Box>
                            <Typography variant="body2" color="text.secondary">{t('assignment.jobTitle')}</Typography>
                            <Typography variant="body1" sx={{ fontWeight: 600 }}>
                              {assignmentData.jobTitle || posting?.postTitle || posting?.jobTitle || '—'}
                            </Typography>
                          </Box>
                        </Stack>
                        <Stack direction="row" spacing={2} alignItems="center">
                          <ScheduleIcon color="action" sx={{ flexShrink: 0 }} />
                          <Box>
                            <Typography variant="body2" color="text.secondary">{t('common.startDate')}</Typography>
                            <Typography variant="body1">
                              {assignmentData.startDate ? formatDate(assignmentData.startDate) : (assignmentStartDate ? formatDate(assignmentStartDate) : posting?.startDate ? formatDate(posting.startDate) : '—')}
                            </Typography>
                          </Box>
                        </Stack>
                        <Stack direction="row" spacing={2} alignItems="center">
                          <MoneyIcon color="action" sx={{ flexShrink: 0 }} />
                          <Box>
                            <Typography variant="body2" color="text.secondary">{t('jobs.payRate')}</Typography>
                            <Typography variant="body1" sx={{ fontWeight: 600 }}>
                              {assignmentData.payRate != null
                                ? t('jobs.hourlyRateDisplay', { amount: formatHourlyPayAmountForI18n(assignmentData.payRate) })
                                : posting?.payRate != null
                                  ? t('jobs.hourlyRateDisplay', { amount: formatHourlyPayAmountForI18n(posting.payRate) })
                                  : '—'}
                            </Typography>
                          </Box>
                        </Stack>
                        <Stack direction="row" spacing={2} alignItems="center">
                          <BusinessIcon color="action" sx={{ flexShrink: 0 }} />
                          <Box>
                            <Typography variant="body2" color="text.secondary">{t('assignment.companyName')}</Typography>
                            <Typography variant="body1">
                              {assignmentData.companyName || posting?.companyName || '—'}
                            </Typography>
                          </Box>
                        </Stack>
                      </Stack>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <Stack spacing={2}>
                        <Stack direction="row" spacing={2} alignItems="center">
                          <LocationIcon color="action" sx={{ flexShrink: 0 }} />
                          <Box>
                            <Typography variant="body2" color="text.secondary">{t('assignment.worksiteName')}</Typography>
                            <Typography variant="body1">
                              {assignmentData.worksiteName || assignmentData.location || posting?.worksiteName || posting?.location || '—'}
                            </Typography>
                          </Box>
                        </Stack>
                        <Stack direction="row" spacing={2} alignItems="center">
                          <MapIcon color="action" sx={{ flexShrink: 0 }} />
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body2" color="text.secondary">{t('assignment.worksiteAddress')}</Typography>
                            {(() => {
                              const wa = assignmentData.worksiteAddress || posting?.worksiteAddress;
                              const addrStr = wa ? [(wa.street || wa.address), wa.city, wa.state, wa.zipCode].filter(Boolean).join(', ') : '';
                              return addrStr ? (
                                <Button
                                  size="small"
                                  startIcon={<OpenInNewIcon />}
                                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addrStr)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  sx={{ textTransform: 'none', p: 0, minHeight: 'auto' }}
                                >
                                  {addrStr}
                                </Button>
                              ) : (
                                <Typography variant="body1">—</Typography>
                              );
                            })()}
                          </Box>
                        </Stack>
                        <Stack direction="row" spacing={2} alignItems="flex-start">
                          <CheckroomIcon color="action" sx={{ flexShrink: 0, mt: 0.5 }} />
                          <Box>
                            <Typography variant="body2" color="text.secondary">{t('assignment.requiredUniform')}</Typography>
                            <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                              {((assignmentData.uniformRequirements || assignmentData.customUniformRequirements) || (posting?.uniformRequirements || posting?.customUniformRequirements))
                                ? [(assignmentData.uniformRequirements || assignmentData.customUniformRequirements), (posting?.uniformRequirements || posting?.customUniformRequirements)].filter(Boolean).join('\n\n')
                                : '—'}
                            </Typography>
                          </Box>
                        </Stack>
                        <Stack direction="row" spacing={2} alignItems="flex-start">
                          <EngineeringIcon color="action" sx={{ flexShrink: 0, mt: 0.5 }} />
                          <Box>
                            <Typography variant="body2" color="text.secondary">{t('assignment.requiredPpe')}</Typography>
                            <Typography variant="body1">
                              {assignmentData.ppeRequirements || posting?.requiredPpe || posting?.ppeRequirements || '—'}
                            </Typography>
                          </Box>
                        </Stack>
                      </Stack>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>
              <Card sx={{ ...cardBaseSx, mb: 3 }} elevation={2}>
                <CardContent>
                  <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
                    {t('assignment.mySchedule')}
                  </Typography>
                  <Stack spacing={2}>
                    {scheduleShiftData?.shiftMode === 'multi' && (scheduleShiftData as any)?.dateSchedule && scheduleShiftData?.shiftDate && (() => {
                      const entries = getDateScheduleEntriesWithHours((scheduleShiftData as any).dateSchedule, scheduleShiftData.shiftDate, scheduleShiftData.endDate);
                      return entries.length > 0;
                    })() ? (
                      <>
                        <Box>
                          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{t('assignment.weeklySchedule')}</Typography>
                          <Stack spacing={0.5} component="ul" sx={{ pl: 2.5, m: 0 }}>
                            {getDateScheduleEntriesWithHours((scheduleShiftData as any).dateSchedule, scheduleShiftData!.shiftDate, scheduleShiftData!.endDate).map((e) => (
                              <Typography key={e.date} component="li" variant="body2">
                                {e.dayLabel}: {formatTime(e.startTime)} – {formatTime(e.endTime)}
                              </Typography>
                            ))}
                          </Stack>
                        </Box>
                        {assignmentData.startDate && (
                          <Box>
                            <Typography variant="body2" color="text.secondary">{t('common.startDate')}</Typography>
                            <Typography variant="body1">{formatDate(assignmentData.startDate)}</Typography>
                          </Box>
                        )}
                        {assignmentData.jobOrderType === 'gig' && (assignmentData.endDate || scheduleShiftData.endDate) && (
                          <Box>
                            <Typography variant="body2" color="text.secondary">{t('assignment.endDate')}</Typography>
                            <Typography variant="body1">
                              {assignmentData.endDate ? formatDate(assignmentData.endDate) : (scheduleShiftData.endDate ? new Date(scheduleShiftData.endDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—')}
                            </Typography>
                          </Box>
                        )}
                      </>
                    ) : scheduleShiftData?.shiftMode === 'multi' && scheduleShiftData?.weeklySchedule && Object.keys(scheduleShiftData.weeklySchedule).length > 0 ? (
                      <>
                        <Box>
                          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{t('assignment.weeklySchedule')}</Typography>
                          <Stack spacing={0.5} component="ul" sx={{ pl: 2.5, m: 0 }}>
                            {DOW_ORDER.map((dow) => {
                              const entry = scheduleShiftData.weeklySchedule![String(dow)];
                              if (!entry?.enabled) return null;
                              const start = formatTime(entry.startTime);
                              const end = formatTime(entry.endTime);
                              return (
                                <Typography key={dow} component="li" variant="body2">
                                  {DOW_LABELS[dow]}: {start} – {end}
                                </Typography>
                              );
                            })}
                          </Stack>
                        </Box>
                        {assignmentData.startDate && (
                          <Box>
                            <Typography variant="body2" color="text.secondary">{t('common.startDate')}</Typography>
                            <Typography variant="body1">{formatDate(assignmentData.startDate)}</Typography>
                          </Box>
                        )}
                        {assignmentData.jobOrderType === 'gig' && (assignmentData.endDate || scheduleShiftData.endDate) && (
                          <Box>
                            <Typography variant="body2" color="text.secondary">{t('assignment.endDate')}</Typography>
                            <Typography variant="body1">
                              {assignmentData.endDate ? formatDate(assignmentData.endDate) : (scheduleShiftData.endDate ? new Date(scheduleShiftData.endDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—')}
                            </Typography>
                          </Box>
                        )}
                      </>
                    ) : (
                      <>
                        {assignmentData.startDate && (
                          <Box>
                            <Typography variant="body2" color="text.secondary">{t('assignment.date')}</Typography>
                            <Typography variant="body1">{formatDate(assignmentData.startDate)}</Typography>
                          </Box>
                        )}
                        {(assignmentData.startTime || assignmentData.endTime || scheduleShiftData?.defaultStartTime || scheduleShiftData?.defaultEndTime) && (
                          <Box>
                            <Typography variant="body2" color="text.secondary">{t('assignment.time')}</Typography>
                            <Typography variant="body1">
                              {[formatTime(assignmentData.startTime || scheduleShiftData?.defaultStartTime), formatTime(assignmentData.endTime || scheduleShiftData?.defaultEndTime)].filter(Boolean).join(' – ')}
                            </Typography>
                          </Box>
                        )}
                        {assignmentData.endDate && (
                          <Box>
                            <Typography variant="body2" color="text.secondary">{t('assignment.endDate')}</Typography>
                            <Typography variant="body1">{formatDate(assignmentData.endDate)}</Typography>
                          </Box>
                        )}
                        {!assignmentData.startDate && !assignmentData.startTime && !assignmentData.endTime && !scheduleShiftData?.defaultStartTime && (
                          <Typography variant="body2" color="text.secondary">{t('assignment.noScheduleDetails')}</Typography>
                        )}
                      </>
                    )}
                  </Stack>
                </CardContent>
              </Card>
            </>
          ) : null}

          {/* Available Shifts (Gig jobs) — compact, action-oriented.
              Hidden for express-interest postings: they have no bookable dated
              shifts, so we show the generic Apply/Express-interest CTA instead. */}
          {posting.jobType === 'gig' && !isExpressInterest && (
            <Card sx={{ ...cardBaseSx, mb: 3 }} elevation={2}>
              <CardContent sx={{ p: 0 }}>
                {loadingShifts ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                    <CircularProgress size={24} />
                  </Box>
                ) : dynamicShifts.length > 0 ? (
                  <ShiftSelector
                    shifts={dynamicShifts}
                    onApplyToShift={handleApplyToShift}
                    appliedShifts={appliedShifts}
                    shiftStatuses={shiftStatuses}
                    assignmentIdsByShiftKey={assignmentIdsByShiftKey}
                    onConfirmShift={handleConfirmAssignmentForShift}
                    onDeclineShift={handleDeclineAssignmentForShift}
                    onCancelApplication={handleCancelApplicationForDay}
                    onReapplyToShift={handleReapplyToShift}
                    jobPostId={postId}
                    tenantId={resolvedTenantId}
                    language={displayLanguage}
                    /*
                      Single source of truth for the "X spots left" chip
                      on the public Jobs Board: the post-level
                      `showWorkersNeeded` toggle (set on the JO's Jobs
                      Board tab). Defaults to hidden — recruiters opt in
                      per posting. Per-shift `showStaffNeeded` no
                      longer drives this chip. May 2026.
                    */
                    showSpots={posting.showWorkersNeeded === true}
                  />
                ) : posting.jobOrderId ? (
                  <Alert severity="info">
                    {t('jobs.noUpcomingShifts')}
                  </Alert>
                ) : null}
              </CardContent>
            </Card>
          )}

          {/* Requirements — hidden for SMS offer-response mode to avoid re-asking application questions */}
          {!showOfferResponseMinimalView && (() => {
            const eligibility = eligibilitySummary ?? getEligibilitySummary(posting, userProfile, applicationData);
            const allCategories = allRequirementsCategories;
            const hasAnyRequirement = allCategories.length > 0;
            const showInteraction = !!user?.uid && !!applicationDocId;
            // Launch hardening: keep Jobs Board detail read-only.
            // Requirement questions belong in the Apply wizard, not the post detail page.
            const showInlineRequirementQuestions = false;
            const additionalScreeningsData = applicationData?.data?.requirements?.additionalScreenings || {};
            const missingCount = eligibility.missingRequired.length;

            const getMissingActionLabel = (m: { category: string; itemLabel: string; item: { requiresUpload?: boolean } }) => {
              const label = m.itemLabel;
              if (m.category === 'backgroundCheckPackages') return `Background check verification required (${label})`;
              if (m.category === 'drugScreeningPanels') return `Drug screening verification required (${label})`;
              if (m.category === 'eVerify') return 'E-Verify verification required';
              if (m.category === 'additionalScreenings') {
                if (/covid|vaccine|vaccination/i.test(label)) return 'Vaccination requirement verification required';
                return `Additional screening verification required (${label})`;
              }
              if (m.category === 'screeningPackageServices') {
                return `Required screening: confirm you can complete “${label}”`;
              }
              if (m.category === 'skills') return t('jobs.requirementsActionConfirmSkill', { label });
              if (m.category === 'languages') return t('jobs.requirementsActionConfirmLanguage', { label });
              if (m.category === 'educationLevels') return t('jobs.requirementsActionConfirmEducation', { label });
              if (m.category === 'experienceLevels') return t('jobs.requirementsActionConfirmExperience', { label });
              if (m.category === 'licensesCerts' && m.item.requiresUpload) return t('jobs.requirementsActionAddCert', { label });
              if (m.category === 'licensesCerts') return t('jobs.requirementsActionConfirmCert', { label });
              return t('jobs.requirementsActionConfirmOther', { label });
            };

            const tierOrder: Array<'requiredToApply' | 'jobPreparation' | 'recommended'> = ['requiredToApply', 'jobPreparation', 'recommended'];
            const tierLabelKey: Record<string, string> = {
              requiredToApply: 'jobs.requirementsTierRequiredNow',
              jobPreparation: 'jobs.requirementsTierBeforeAssignment',
              recommended: 'jobs.requirementsTierRecommended',
            };
            const byTier = tierOrder.map((tier) => ({ tier, categories: allCategories.filter((c) => c.tier === tier) }));

            if (!hasAnyRequirement || missingCount === 0) return null;
            return (
              <Card sx={{ ...cardBaseSx }} elevation={2}>
                <CardContent>
                  <Typography variant="h6" gutterBottom sx={{ fontWeight: 'bold' }}>
                    {t('jobs.requirements')}
                  </Typography>

                  {/* Top block: only missing application-blocking steps */}
                  {missingCount > 0 && (
                    <Box sx={{ mb: 2, p: 1.5, bgcolor: 'primary.50', borderRadius: 1, border: 1, borderColor: 'primary.light' }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                        {t('jobs.requirementsToApplySummary', { count: missingCount })}
                      </Typography>
                      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                        {eligibility.missingRequired.map((m, idx) => (
                          <Typography key={`${m.category}-${idx}`} component="li" variant="body2" sx={{ mb: 0.25 }}>
                            {getMissingActionLabel(m)}
                          </Typography>
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Intentional launch behavior: only show top requirements summary on job post detail.
                      Interactive completion flow happens in Apply wizard after clicking Apply. */}
                </CardContent>
              </Card>
            );
          })()}
        </Box>

        {/*
          Sidebar — "Apply for this Position" card.
          Hidden for ALL gig postings: gigs apply shift-by-shift (rendered
          inside the main content), so a sidebar generic-Apply card is wrong
          for gigs whether or not shifts have loaded. Only career postings
          surface the sidebar quick-apply card.

          **Exception (2026-05-23, bug fix)** — when the worker arrives via
          the SMS offer-response link (`?assignmentId=X&intent=assignment_response`),
          they need the Accept/Decline buttons regardless of jobType. The
          generic-apply suppression was hiding the offer-response UI for
          Gig postings entirely. Force the sidebar visible in that mode.
        */}
        {(posting.jobType !== 'gig' || isExpressInterest || isAssignmentResponseMode) && (
          <Box
            sx={{
              position: 'sticky',
              top: 80,
              alignSelf: 'flex-start',
              width: '100%',
              maxWidth: '100%',
              boxSizing: 'border-box',
            }}
          >
            {/* Quick Apply / Accept card - title changes when hired */}
            <Card
              sx={{
                ...cardBaseSx,
                mb: 3,
                bgcolor: 'white',
              }}
              elevation={2}
            >
              <CardContent sx={{ p: 0 }}>
                <Typography variant="h6" gutterBottom sx={{ fontWeight: 'bold' }}>
                  {statusButtonProps?.label === 'confirmed_special'
                    ? t('jobs.youveBeenHired')
                    : (statusButtonProps?.label === 'accepted_special' || isAssignmentResponseMode)
                      ? t('jobs.acceptThisPosition')
                      : t('jobs.applyForThisPosition')}
                </Typography>

                {eligibilitySummary && eligibilitySummary.totalCount > 0 && statusButtonProps?.label !== 'confirmed_special' && !isAssignmentResponseMode && (
                  <Typography variant="body2" color={stepsToApply === 0 ? 'success.main' : 'text.secondary'} sx={{ fontWeight: 500, mb: 1 }}>
                    {stepsToApply === 0 ? t('jobs.youQualifyForThisJob') : t('jobs.completeStepsToApply', { count: stepsToApply })}
                  </Typography>
                )}

                <Divider sx={{ my: 2 }} />

                <Stack spacing={2}>
                  {posting.workersNeeded && posting.showWorkersNeeded !== false && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        {t('jobs.openings')}
                      </Typography>
                      <Typography variant="body1" fontWeight="medium">
                        {posting.workersNeeded}
                      </Typography>
                    </Box>
                  )}

                  {posting.jobType && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        {t('jobs.type')}
                      </Typography>
                      <Typography variant="body1" fontWeight="medium">
                        {posting.jobType === 'gig' ? t('jobs.gig') : t('jobs.career')}
                      </Typography>
                    </Box>
                  )}

                  {(assignmentStartDate || posting.startDate) && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        {assignmentStartDate
                          ? t('jobs.startDate')
                          : posting.jobType === 'career'
                            ? t('jobs.estimatedStartDate')
                            : t('jobs.startDate')}
                      </Typography>
                      <Typography variant="body1" fontWeight="medium">
                        {formatDate(assignmentStartDate ?? posting.startDate)}
                      </Typography>
                    </Box>
                  )}

                  {posting.jobType === 'career' && careerWeeklyScheduleSummary && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                      <Typography variant="body2" color="text.secondary">
                        {t('jobs.weeklySchedule')}
                      </Typography>
                      <Typography
                        variant="body1"
                        fontWeight="medium"
                        sx={{ textAlign: 'right', whiteSpace: 'pre-wrap' }}
                      >
                        {careerWeeklyScheduleSummary}
                      </Typography>
                    </Box>
                  )}
                </Stack>

                {(statusButtonProps?.label === 'accepted_special' || isAssignmentResponseMode) && statusButtonProps?.label !== 'confirmed_special' ? (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 3 }}>
                    <Typography variant="body2" sx={{ color: '#2e7d32', fontWeight: 700 }}>
                      {t('jobs.youveBeenHiredAccept')}
                    </Typography>
                    <Button
                      variant="contained"
                      size="large"
                      fullWidth
                      disabled={assignmentDecisionLoading}
                      onClick={handleConfirmAssignment}
                      startIcon={assignmentDecisionLoading ? <CircularProgress size={20} color="inherit" /> : null}
                      sx={{
                        py: 1.5,
                        fontSize: '1.1rem',
                        fontWeight: 'bold',
                      }}
                    >
                      {assignmentDecisionLoading ? t('jobs.accepting') : t('jobs.acceptOfferCta')}
                    </Button>
                    <Button
                      variant="contained"
                      size="large"
                      fullWidth
                      color="error"
                      disabled={assignmentDecisionLoading}
                      onClick={handleDeclineAssignment}
                      sx={{ fontWeight: 'bold' }}
                    >
                      {t('jobs.declineJob')}
                    </Button>
                  </Box>
                ) : statusButtonProps?.label === 'confirmed_special' ? (
                  assignmentDetailsUrl ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 3 }}>
                      <Button
                        component={Link}
                        to={`/c1/workers/assignments/${assignmentDetailsId}`}
                        variant="contained"
                        size="large"
                        fullWidth
                        sx={{
                          py: 1.5,
                          fontSize: '1.1rem',
                          fontWeight: 'bold',
                        }}
                      >
                        {t('assignment.viewAssignment')}
                      </Button>
                    </Box>
                  ) : null
                ) : statusButtonProps ? (
                  showApplyAgain ? (
                    <Button
                      variant="contained"
                      fullWidth
                      size="large"
                      onClick={handleApply}
                      sx={{ mt: 3, py: 1.5 }}
                    >
                      Apply Again
                    </Button>
                  ) : (
                    <Box sx={{ mt: 3, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                      <Button
                        variant="contained"
                        fullWidth
                        size="large"
                        sx={{
                          py: 1.5,
                          backgroundColor: statusButtonProps.backgroundColor,
                          color: statusButtonProps.color,
                          '&:hover': {
                            backgroundColor: statusButtonProps.backgroundColor,
                          },
                          cursor: statusButtonProps.cursor,
                          pointerEvents: statusButtonProps.pointerEvents,
                        }}
                      >
                        {getStatusDisplayLabel(statusButtonProps.label)}
                      </Button>
                      {applicationStatus && getApplicationStatusHelperText(applicationStatus) && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ textAlign: 'center' }}
                        >
                          {getApplicationStatusHelperText(applicationStatus)}
                        </Typography>
                      )}
                      {applicationStatus && applicationJobScore != null && (
                        <Card variant="outlined" sx={{ mt: 2, p: 1.5, borderRadius: 2 }}>
                          <Typography variant="caption" color="text.secondary" display="block">
                            {t('jobs.yourJobFit')}
                          </Typography>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 0.5 }}>
                            {'version' in applicationJobScore && applicationJobScore.version === 'v1' && !applicationJobScore.eligible && (
                              <Chip size="small" label={t('jobs.notEligible')} color="error" />
                            )}
                            <Chip
                              size="small"
                              label={t('jobs.scoreChip', { score: Math.round(applicationJobScore.jobScore) })}
                              color={applicationJobScore.eligible ? 'success' : 'default'}
                            />
                            {(() => {
                              const missing = 'version' in applicationJobScore && applicationJobScore.version === 'v1'
                                ? (applicationJobScore.buckets?.missingRequired ?? []).map((x: any) => x.label)
                                : ((applicationJobScore as JobScoreSummary).missingLabels ?? []);
                              return missing.length ? (
                                <Typography variant="caption" color="text.secondary">
                                  {t('jobs.missing')}: {missing.slice(0, 3).join(', ')}
                                  {missing.length > 3 ? '…' : ''}
                                </Typography>
                              ) : applicationJobScore.eligible ? (
                                <Typography variant="caption" color="success.main">{t('jobs.eligible')}</Typography>
                              ) : null;
                            })()}
                          </Box>
                        </Card>
                      )}
                    </Box>
                  )
                ) : (
                  <Button
                    variant="contained"
                    fullWidth
                    size="large"
                    onClick={handleApply}
                    sx={{ mt: 3, py: 1.5 }}
                  >
                    {t('jobs.applyForJob')}
                  </Button>
                )}

                {posting.status === 'expired' && (
                  <Alert severity="warning" sx={{ mt: 2 }}>
                    {t('jobs.postingExpired')}
                  </Alert>
                )}

                {posting.status === 'paused' && (
                  <Alert severity="info" sx={{ mt: 2 }}>
                    {t('jobs.postingPaused')}
                  </Alert>
                )}
              </CardContent>
            </Card>
          </Box>
        )}
      </Box>

      {/* Mobile-only sticky Apply footer — appears when scrolled past header and a shift is available to apply */}
      {showStickyApply &&
        posting &&
        (() => {
          const isGigWithShifts = posting.jobType === 'gig' && dynamicShifts.length > 0;
          // For a gig with no shifts the sticky button would otherwise fall
          // through to `handleApply` (generic Apply). Gigs apply shift-by-shift
          // only — if there's nothing to apply to, render no sticky at all
          // rather than offering a misleading generic Apply CTA. Exception:
          // express-interest (ongoing) postings DO use the generic Apply path.
          if (posting.jobType === 'gig' && !isGigWithShifts && !isExpressInterest) return null;
          const payLabel =
            posting.showPayRate && posting.payRate != null
              ? t('jobs.hourlyRateDisplay', { amount: formatHourlyPayAmountForI18n(posting.payRate) })
              : null;
          let nextLabel = '';
          if (isGigWithShifts && dynamicShifts.length > 0) {
            const first = dynamicShifts.find((s: any) => !appliedShifts.includes(s.shiftId) && ((s.spotsRemaining ?? 1) > 0)) ?? dynamicShifts[0];
            const d = first?.shiftDate?.toDate ? first.shiftDate.toDate() : first?.shiftDate ? new Date(first.shiftDate) : null;
            const timeStr = first?.startTime && first?.endTime
              ? (() => {
                  try {
                    const s = first.startTime.includes(':') ? first.startTime : `${first.startTime}:00`;
                    const e = first.endTime.includes(':') ? first.endTime : `${first.endTime}:00`;
                    const sd = new Date(`2000-01-01T${s}`);
                    const ed = new Date(`2000-01-01T${e}`);
                    return `${format(sd, 'ha', { locale: dateFnsLocale })}–${format(ed, 'ha', { locale: dateFnsLocale })}`
                      .toLowerCase()
                      .replace(/\s/g, '');
                  } catch {
                    return '';
                  }
                })()
              : '';
            nextLabel =
              d && !isNaN(d.getTime())
                ? `${format(d, 'EEE MMM d', { locale: dateFnsLocale })}${timeStr ? ` ${timeStr}` : ''}`
                : t('jobs.stickyNextShiftFallback');
          } else if (posting.startDate) {
            nextLabel = t('jobs.startsLabel', { date: formatDate(posting.startDate) });
          } else {
            nextLabel = t('jobs.stickyApplyNow');
          }
          return (
            <Box
              sx={{
                position: 'fixed',
                bottom: 0,
                left: 0,
                right: 0,
                zIndex: 1100,
                bgcolor: 'background.paper',
                boxShadow: 8,
                borderTop: 1,
                borderColor: 'divider',
                px: 2,
                py: 1.5,
                display: 'flex',
                alignItems: 'center',
                gap: 2,
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                {payLabel && (
                  <Typography variant="subtitle2" fontWeight={700} color="success.dark">
                    {payLabel}
                  </Typography>
                )}
                <Typography variant="body2" color="text.secondary" noWrap>
                  {nextLabel}
                </Typography>
              </Box>
              <Button
                variant="contained"
                size="medium"
                onClick={isGigWithShifts ? () => { const s = dynamicShifts.find((x: any) => !appliedShifts.includes(x.shiftId) && ((x.spotsRemaining ?? 1) > 0)); if (s) handleApplyToShift(s.shiftId); } : handleApply}
                sx={{ flexShrink: 0, fontWeight: 600, borderRadius: '999px', px: 2.5 }}
              >
                {t('jobs.applyForJob')}
              </Button>
            </Box>
          );
        })()}

      <WorkerBottomSheet
        open={offerConfirmationOpen}
        onClose={closeOfferConfirmationSheet}
            title={t('jobs.confirmYourShift')}
        footer={
          <Stack
            direction={{ xs: 'column-reverse', sm: 'row' }}
            spacing={1.25}
            sx={{ width: '100%', minWidth: 0 }}
          >
            <Button
              variant="outlined"
              fullWidth
              onClick={closeOfferConfirmationSheet}
              disabled={offerConfirmSubmitting || assignmentDecisionLoading}
              sx={{ minWidth: 0 }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="contained"
              fullWidth
              onClick={handleSubmitOfferConfirmation}
              disabled={!offerConfirmReady || offerConfirmSubmitting || assignmentDecisionLoading}
              startIcon={offerConfirmSubmitting ? <CircularProgress size={18} color="inherit" /> : null}
              sx={{ minWidth: 0 }}
            >
              {offerConfirmSubmitting ? t('jobs.confirmingShift') : t('jobs.confirmShift')}
            </Button>
          </Stack>
        }
      >
        <Box
          sx={{
            mt: 1,
            p: 1.5,
            borderRadius: 2,
            border: 1,
            borderColor: 'divider',
            bgcolor: 'grey.50',
          }}
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            {offerSnapshot.jobTitle || t('jobs.shift')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {offerSnapshot.companyName || t('applications.company')}
          </Typography>
          {offerSnapshot.shiftDateText && (
            <Typography variant="body2" sx={{ mt: 0.75 }}>
              {t('assignment.date')}: {offerSnapshot.shiftDateText}
            </Typography>
          )}
          {offerSnapshot.startTimeText && (
            <Typography variant="body2">
              {t('jobs.startDate')}: {offerSnapshot.startTimeText}
              {offerSnapshot.endTimeText ? `  |  ${t('assignment.endDate')}: ${offerSnapshot.endTimeText}` : ''}
            </Typography>
          )}
          {(offerSnapshot.locationName || offerSnapshot.address) && (
            <Typography variant="body2" sx={{ mt: 0.75 }}>
              {t('jobs.location')}: {[offerSnapshot.locationName, offerSnapshot.address].filter(Boolean).join(' - ')}
            </Typography>
          )}
          {offerSnapshot.uniformSummary && (
            <Typography variant="body2" sx={{ mt: 0.75 }}>
              {t('assignment.requiredUniform')}: {offerSnapshot.uniformSummary}
            </Typography>
          )}
          {offerSnapshot.keyRequirementsSummary && (
            <Typography variant="body2" sx={{ mt: 0.75 }}>
              {t('jobs.keyRequirements')}: {offerSnapshot.keyRequirementsSummary}
            </Typography>
          )}
        </Box>

        <Stack spacing={1.25} sx={{ mt: 2 }}>
          <FormControlLabel
            control={
              <Checkbox
                checked={ackOnTimeArrival}
                onChange={(e) => setAckOnTimeArrival(e.target.checked)}
                disabled={offerConfirmSubmitting || assignmentDecisionLoading}
              />
            }
            label={`I will arrive at ${arrivalLocationText} by ${arrivalStartTimeText} ready to work.`}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={ackUniformAndRequirements}
                onChange={(e) => setAckUniformAndRequirements(e.target.checked)}
                disabled={offerConfirmSubmitting || assignmentDecisionLoading}
              />
            }
            label={t('jobs.offerAckUniformAndRequirements')}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={ackNoShowConsequence}
                onChange={(e) => setAckNoShowConsequence(e.target.checked)}
                disabled={offerConfirmSubmitting || assignmentDecisionLoading}
              />
            }
            label={t('jobs.offerAckNoShowConsequence')}
          />
        </Stack>

        {offerConfirmError ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            {offerConfirmError}
          </Alert>
        ) : null}
      </WorkerBottomSheet>

      {/* Share Snackbar */}
      <Snackbar
        open={shareSnackbarOpen}
        autoHideDuration={3000}
        onClose={() => setShareSnackbarOpen(false)}
        message={t('jobs.linkCopied')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Box>
  );
};

export default JobPostingDetail;

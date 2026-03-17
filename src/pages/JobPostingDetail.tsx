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
import { doc, getDoc, collection, query, where, getDocs, updateDoc, arrayUnion, arrayRemove, serverTimestamp, deleteField } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useGuestLanguage } from '../hooks/useGuestLanguage';
import { useT, setLanguage, useLanguage } from '../i18n';
import { formatDistanceToNow, format } from 'date-fns';
import ShiftSelector from '../components/ShiftSelector';
import { JobsBoardService } from '../services/recruiter/jobsBoardService';
import { formatWeeklyScheduleSummary } from '../utils/weeklySchedule';
import { getDateScheduleEntriesWithHours, getLastShiftDateFromShifts } from '../utils/dateSchedule';
import { updateUserSmartGroupOnWithdraw } from '../services/smartGroupService';
import type { JobScoreSummary, JobScoreSummaryStored } from '../types/jobScore';
import { getRequirementsWithStatus, getRequirementsWithStatusForJobPost, getEligibilitySummary } from '../utils/jobRequirementStatus';
import { RequirementInteraction } from '../components/RequirementInteraction';
import { getJobPostingDisplayText } from '../utils/jobPostingI18n';
import { logAssignmentUpdateActivity } from '../utils/activityLogger';
import AuthDialog from '../components/AuthDialog';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedShifts, setSelectedShifts] = useState<string[]>([]);
  const [dynamicShifts, setDynamicShifts] = useState<any[]>([]);
  const [loadingShifts, setLoadingShifts] = useState(false);
  const [careerWeeklyScheduleSummary, setCareerWeeklyScheduleSummary] = useState<string>('');
  const [appliedShifts, setAppliedShifts] = useState<string[]>([]);
  const [shiftStatuses, setShiftStatuses] = useState<Record<string, string>>({}); // Map shiftId -> status
  const [appliedShiftsRefresh, setAppliedShiftsRefresh] = useState(0); // Increment to reload applied shifts (e.g. after cancel for day)
  const [applicationStatus, setApplicationStatus] = useState<string | null>(null);
  const [applicationDocId, setApplicationDocId] = useState<string | null>(null);
  const [applicationJobScore, setApplicationJobScore] = useState<JobScoreSummaryStored | null>(null);
  const [acceptedAssignmentId, setAcceptedAssignmentId] = useState<string | null>(null);
  const [assignmentStartDate, setAssignmentStartDate] = useState<any>(null); // recruiter-set start date when worker has assignment
  const [assignmentData, setAssignmentData] = useState<any>(null); // full assignment doc when in accept/decline mode
  const [scheduleShiftData, setScheduleShiftData] = useState<any>(null); // shift doc for schedule card
  const [assignmentDecisionLoading, setAssignmentDecisionLoading] = useState(false); // prevent double-clicks on I Accept / Decline
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
    if (!resolvedTenantId || !postId) {
      console.log('⚠️ Missing tenantId or postId:', {
        resolvedTenantId,
        postId,
        isC1Route,
        authTenantId,
      });
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
          } else {
            console.error('❌ Job posting not found:', { resolvedTenantId, postId });
            setError('Job posting not found');
          }
        }
      } catch (err: any) {
        console.error('❌ Error loading job posting:', err);
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
  }, [resolvedTenantId, postId]);

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
  }, [posting, user?.uid, resolvedTenantId, postId]);

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
        const summary = weekly?.weeklySchedule
          ? formatWeeklyScheduleSummary(weekly.weeklySchedule)
          : '';
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

        // Dates the user applied for (multi-day gig): from applyDate or applyDates; fallback to shiftDate/shiftDates for legacy
        const getAppliedDates = (data: Record<string, unknown>): string[] => {
          const ad = data.applyDate;
          const ads = data.applyDates;
          if (Array.isArray(ads) && ads.length > 0) {
            return ads.filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d));
          }
          if (ad && typeof ad === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ad)) return [ad];
          // Legacy: application may have shiftDate (single) or shiftDates (array) from the shift
          const sd = data.shiftDate;
          const sds = data.shiftDates;
          if (Array.isArray(sds) && sds.length > 0) {
            return sds.filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d));
          }
          if (sd && typeof sd === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sd)) return [sd];
          return [];
        };

        snapshots.forEach((snapshot) => {
          snapshot.forEach((doc) => {
            // Avoid duplicates if a doc matches both queries
            if (seenDocs.has(doc.id)) return;
            seenDocs.add(doc.id);

            const data = doc.data();
            const appStatus = (data.status || '').toLowerCase();
            // Skip deleted, withdrawn, or cancelled applications
            if (appStatus === 'deleted' || appStatus === 'withdrawn' || appStatus === 'cancelled') return;

            const statusForDisplay = data.status || 'submitted';
            const appliedDates = getAppliedDates(data);
            const hasDaySpecific = appliedDates.length > 0;

            const shiftIds: string[] = data.shiftId ? [data.shiftId] : Array.isArray(data.shiftIds) ? data.shiftIds : [];

            if (shiftIds.length === 0) return;

            if (hasDaySpecific) {
              // Multi-day gig: mark the specific day(s) they applied to (shiftId__date)
              shiftIds.forEach((shiftId: string) => {
                appliedDates.forEach((dateStr: string) => {
                  const rowKey = `${shiftId}__${dateStr}`;
                  applied.push(rowKey);
                  if (!statuses[rowKey] || statusForDisplay === 'confirmed' || statusForDisplay === 'accepted') {
                    statuses[rowKey] = statusForDisplay;
                  }
                });
                // Also mark whole shift so a single shift row (when UI does not show day breakdown) shows Application Submitted
                applied.push(shiftId);
                if (!statuses[shiftId] || statusForDisplay === 'confirmed' || statusForDisplay === 'accepted') {
                  statuses[shiftId] = statusForDisplay;
                }
              });
            } else {
              // No applyDate/applyDates: whole-shift application – mark whole shift(s) as applied
              shiftIds.forEach((shiftId: string) => {
                applied.push(shiftId);
                if (!statuses[shiftId] || statusForDisplay === 'confirmed' || statusForDisplay === 'accepted') {
                  statuses[shiftId] = statusForDisplay;
                }
              });
            }
          });
        });

        console.log(`✅ Loaded applied shifts for user ${user.uid}:`, applied);
        console.log(`✅ Shift statuses:`, statuses);
        setAppliedShifts(applied);
        setShiftStatuses(statuses);
      } catch (err) {
        console.error('Error loading applied shifts:', err);
        setAppliedShifts([]);
        setShiftStatuses({});
      }
    };

    loadAppliedShifts();

    // Refresh applied shifts when page becomes visible (e.g., user returns from application wizard)
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        loadAppliedShifts();
      }
    };

    // Refresh when window gains focus (user returns to tab)
    const handleFocus = () => {
      loadAppliedShifts();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [user?.uid, resolvedTenantId, postId, posting?.jobOrderId, dynamicShifts.length, appliedShiftsRefresh]);

  const handleApplyToShift = (shiftId: string, applyDate?: string) => {
    const params = new URLSearchParams({ shiftId });
    if (applyDate) params.set('applyDate', applyDate);
    const returnTo = `/c1/jobs-board/${postId}`;
    if (!user) {
      params.set('returnTo', returnTo);
      navigate(`/apply/${posting.tenantId}/${postId}?${params.toString()}`);
    } else {
      navigate(`/apply/${posting.tenantId}/${postId}?${params.toString()}`);
    }
  };

  // Helper to safely format calendar dates (avoids UTC→local timezone shift showing wrong day)
  const formatDate = (date: any): string => {
    if (!date) return 'Date TBD';
    try {
      let d: Date;
      if (date?.toDate) {
        d = date.toDate();
      } else {
        d = new Date(date);
      }
      if (isNaN(d.getTime())) return 'Date TBD';
      const m = d.getUTCMonth() + 1;
      const day = d.getUTCDate();
      const y = d.getUTCFullYear();
      return `${m}/${day}/${y}`;
    } catch {
      return 'Date TBD';
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
            // Continuous feed: return to jobs board with confirmation and next job queue (no dead end)
            const fromFeedState = location.state as { fromFeed?: boolean; feedQueue?: any[] } | null;
            if (fromFeedState?.fromFeed && Array.isArray(fromFeedState.feedQueue)) {
              navigate('/c1/jobs-board', {
                state: { showApplicationConfirmation: true, feedQueue: fromFeedState.feedQueue },
              });
              return;
            }
            const tenantSlug = posting.tenantId === 'BCiP2bQ9CgVOCTfV6MhD' ? 'c1' : 'c1';
            navigate(`/${tenantSlug}/jobs-board`);
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
        const applyDates = Array.isArray(data.applyDates)
          ? [...(data.applyDates as string[])]
          : data.applyDate && /^\d{4}-\d{2}-\d{2}$/.test(String(data.applyDate))
            ? [String(data.applyDate)]
            : [];
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
          await updateDoc(userRef, { skills: arrayUnion(label), updatedAt: ts });
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
          await updateDoc(userRef, { skills: filtered, updatedAt: ts });
          setUserProfile((p: any) => ({ ...p, skills: filtered, updatedAt: new Date() }));
        }
      } else if (category === 'languages') {
        if (answer === 'Yes') {
          await updateDoc(userRef, { languages: arrayUnion(label), updatedAt: ts });
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
          await updateDoc(userRef, { languages: filtered, updatedAt: ts });
          setUserProfile((p: any) => ({ ...p, languages: filtered, updatedAt: new Date() }));
        }
      } else if (category === 'experienceLevels' && answer === 'Yes') {
        await updateDoc(userRef, { experienceLevel: label, updatedAt: ts });
        setUserProfile((p: any) => ({ ...p, experienceLevel: label, updatedAt: new Date() }));
      } else if (category === 'licensesCerts' && !isFollowUpAck) {
        const certObj = { name: label };
        if (answer === 'Yes') {
          await updateDoc(userRef, { certifications: arrayUnion(certObj), updatedAt: ts });
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
          await updateDoc(userRef, { certifications: filtered, updatedAt: ts });
          setUserProfile((p: any) => ({ ...p, certifications: filtered, updatedAt: new Date() }));
        }
      } else if (category === 'additionalScreenings' && !isFollowUpAck) {
        const userSnap = await getDoc(userRef);
        const userData = userSnap.exists() ? userSnap.data() : {};
        const existing = (userData as any).additionalScreenings || {};
        const nextScreenings = { ...existing, [label]: answer };
        await updateDoc(userRef, { additionalScreenings: nextScreenings, updatedAt: ts });
        setUserProfile((p: any) => ({ ...p, additionalScreenings: nextScreenings, updatedAt: new Date() }));
      } else if (isFollowUpAck && ackKey) {
        const userSnap = await getDoc(userRef);
        const userData = userSnap.exists() ? userSnap.data() : {};
        const existing = (userData as any).requirementsAcks || {};
        await updateDoc(userRef, { requirementsAcks: { ...existing, [ackKey]: answer }, updatedAt: ts });
        setUserProfile((p: any) => ({ ...p, requirementsAcks: { ...(p?.requirementsAcks || {}), [ackKey]: answer }, updatedAt: new Date() }));
      } else if (ackKey === 'eVerifyComfort') {
        await updateDoc(userRef, { comfortableEVerify: answer, updatedAt: ts });
        setUserProfile((p: any) => ({ ...p, comfortableEVerify: answer, updatedAt: new Date() }));
      } else if (ackKey === 'backgroundScreeningComfort') {
        await updateDoc(userRef, { comfortablePassBackground: answer, updatedAt: ts });
        setUserProfile((p: any) => ({ ...p, comfortablePassBackground: answer, updatedAt: new Date() }));
      } else if (ackKey === 'drugScreeningComfort') {
        await updateDoc(userRef, { comfortablePassDrug: answer, updatedAt: ts });
        setUserProfile((p: any) => ({ ...p, comfortablePassDrug: answer, updatedAt: new Date() }));
      } else if (ackKey) {
        const userSnap = await getDoc(userRef);
        const userData = userSnap.exists() ? userSnap.data() : {};
        const existing = (userData as any).requirementsAcks || {};
        await updateDoc(userRef, { requirementsAcks: { ...existing, [ackKey]: answer }, updatedAt: ts });
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
      await updateDoc(userRef, { educationLevel: level, updatedAt: serverTimestamp() });
      setUserProfile((p: any) => ({ ...p, educationLevel: level }));
    } catch (err) {
      console.error('Failed to update education:', err);
      alert('We couldn\'t save that. Please try again.');
    }
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

  const handleAssignmentDecision = async (decision: 'accept' | 'decline', shiftId?: string) => {
    if (!resolvedTenantId || !user?.uid) return;

    const confirmMessage =
      decision === 'accept'
        ? 'Are you sure you want to accept this job?'
        : 'Are you sure you want to decline this job?';
    if (!window.confirm(confirmMessage)) return;

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
        alert('Assignment accepted! We sent your first-day details.');
      } else {
        if (shiftId) setShiftStatuses((prev) => ({ ...prev, [shiftId]: 'withdrawn' }));
        setApplicationStatus('withdrawn');
        alert('You declined this job. Your application has been withdrawn.');
        const jobsBoardUrl = typeof window !== 'undefined' && window.location.origin
          ? `${window.location.origin}/c1/jobs-board`
          : 'https://hrxone.com/c1/jobs-board';
        window.location.href = jobsBoardUrl;
        return;
      }
    } catch (err) {
      console.error(`Failed to ${decision} assignment:`, err);
      alert(`We were unable to ${decision} this assignment. Please try again.`);
    } finally {
      setAssignmentDecisionLoading(false);
    }
  };

  const handleConfirmAssignment = async () => {
    await handleAssignmentDecision('accept');
  };

  const handleConfirmAssignmentForShift = async (shiftId: string) => {
    await handleAssignmentDecision('accept', shiftId);
  };

  const handleDeclineAssignment = async () => {
    await handleAssignmentDecision('decline');
  };

  const handleDeclineAssignmentForShift = async (shiftId: string) => {
    await handleAssignmentDecision('decline', shiftId);
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
        <Alert severity="error">{error || 'Job posting not found'}</Alert>
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
  const isNonGigApply = !isGigWithShifts && (statusButtonProps?.label === t('jobs.applyNow') || showApplyAgain) && !(statusButtonProps?.label === 'accepted_special' || statusButtonProps?.label === 'confirmed_special');
  const showStickyApply = Boolean(isMobile && posting && scrolledPastHeader && isNonGigApply);

  // Assignment accept/decline link from SMS: show "You've been hired" + I Accept / Decline Job
  const params = new URLSearchParams(location.search);
  const urlAssignmentId = params.get('assignmentId');
  const intent = params.get('intent');
  const isAssignmentResponseMode = Boolean(urlAssignmentId && intent === 'assignment_response');
  const assignmentDetailsId =
    acceptedAssignmentId ||
    urlAssignmentId ||
    (applicationData?.assignmentId ? String(applicationData.assignmentId) : null);
  const assignmentDetailsUrl = assignmentDetailsId
    ? `${typeof window !== 'undefined' && window.location.origin ? window.location.origin : 'https://hrxone.com'}/c1/workers/assignments/${assignmentDetailsId}`
    : null;

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

  const cardPadding = isMobile ? 2 : 3;
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
            English (EN)
          </MenuItem>
          <MenuItem
            selected={guestLanguage === 'es'}
            onClick={() => {
              setLanguageMenuAnchorEl(null);
              setGuestLanguage('es');
            }}
          >
            Español (ES)
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

            {(posting.trustedClient || posting.popularShift || posting.highDemand) && (
              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                {posting.trustedClient && (
                  <Chip label={t('apply.trustedClient')} size="small" variant="outlined" color="success" sx={{ fontSize: '0.7rem' }} />
                )}
                {posting.popularShift && (
                  <Chip label={t('apply.popularShift')} size="small" variant="outlined" color="primary" sx={{ fontSize: '0.7rem' }} />
                )}
                {posting.highDemand && (
                  <Chip label={t('apply.highDemand')} size="small" variant="outlined" sx={{ fontSize: '0.7rem' }} />
                )}
              </Stack>
            )}

            {posting.companyName && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
                <BusinessIcon fontSize="small" color="action" />
                <Typography variant="body1" color="text.secondary">
                  {posting.companyName}
                </Typography>
              </Box>
            )}

            {/* Pay rate — visually dominant in header (hierarchy: Title → Company → PAY RATE → Location → Next Shift) */}
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
                ${Number(posting.payRate)}/hr
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
              {posting.workersNeeded != null &&
                posting.showWorkersNeeded !== false &&
                !(posting.jobType === 'gig' && dynamicShifts.length > 0) && (
                  <Chip
                    icon={<WorkIcon />}
                    label={posting.workersNeeded === 1 ? t('jobs.positionsCountOne') : t('jobs.positionsCountOther', { count: posting.workersNeeded })}
                    size="small"
                    variant="outlined"
                  />
                )}
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
                      const d = s.shiftDate?.toDate ? s.shiftDate.toDate() : new Date(s.shiftDate);
                      if (!isNaN(d.getTime())) {
                        const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
                        allDates.push(`${y}-${m}-${day}`);
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

          {/* Primary actions / status (unchanged logic) */}
          {!(posting.jobType === 'gig' && dynamicShifts.length > 0) &&
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
                      backgroundColor: '#4CAF50',
                      color: '#fff',
                      '&:hover': { backgroundColor: '#45a049' },
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
                        Your job fit
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 0.5 }}>
                        {'version' in applicationJobScore && applicationJobScore.version === 'v1' && !applicationJobScore.eligible && (
                          <Chip size="small" label="Not Eligible" color="error" />
                        )}
                        <Chip
                          size="small"
                          label={`Score: ${Math.round(applicationJobScore.jobScore)}`}
                          color={applicationJobScore.eligible ? 'success' : 'default'}
                        />
                        {(() => {
                          const missing = 'version' in applicationJobScore && applicationJobScore.version === 'v1'
                            ? (applicationJobScore.buckets?.missingRequired ?? []).map((x: any) => x.label)
                            : ((applicationJobScore as JobScoreSummary).missingLabels ?? []);
                          return missing.length ? (
                            <Typography variant="caption" color="text.secondary">
                              Missing: {missing.slice(0, 3).join(', ')}
                              {missing.length > 3 ? '…' : ''}
                            </Typography>
                          ) : applicationJobScore.eligible ? (
                            <Typography variant="caption" color="success.main">Eligible</Typography>
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

      {/* Quick Facts strip — Pay, Location (requirements moved to Requirements section) */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 3, alignItems: 'center' }}>
        {posting.showPayRate && posting.payRate != null && (
          <Chip size="small" icon={<MoneyIcon />} label={`$${Number(posting.payRate)}/hr`} color="success" variant="outlined" />
        )}
        {posting.worksiteAddress?.city && posting.worksiteAddress?.state && (
          <Chip size="small" icon={<LocationIcon />} label={`${posting.worksiteAddress.city}, ${posting.worksiteAddress.state}`} variant="outlined" />
        )}
      </Box>

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
            const charLimit = isMobile ? 280 : 400;
            const isLong = cleanedDesc.length > charLimit;
            const showTruncated = isLong && !descriptionExpanded;
            const displayText = showTruncated ? cleanedDesc.slice(0, charLimit) + '…' : cleanedDesc;
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

          {/* Location — address, map preview, Get Directions, optional distance */}
          {(posting.worksiteAddress?.street || posting.worksiteAddress?.city || posting.worksiteAddress?.state) && (
            <Card sx={{ ...cardBaseSx, mb: 3 }} elevation={2}>
              <CardContent sx={{ p: 0 }}>
                <Typography variant="h6" gutterBottom sx={{ fontWeight: 700 }}>
                  Location
                </Typography>
                {(() => {
                  const wa = posting.worksiteAddress;
                  const parts = [wa?.street, wa?.city, wa?.state, wa?.zipCode].filter(Boolean);
                  const addressStr = parts.join(', ');
                  const mapsQuery = encodeURIComponent(addressStr || `${wa?.city} ${wa?.state}`.trim());
                  return (
                    <>
                      <Typography variant="body1" sx={{ mb: 1 }}>
                        {posting.worksiteName ? `${posting.worksiteName} — ` : ''}{addressStr || 'Address TBD'}
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
                            Get Directions
                          </Button>
                          {distanceMiles != null && (
                            <Typography variant="body2" color="text.secondary">
                              {distanceMiles < 0.1 ? '< 0.1 miles away' : `${distanceMiles.toFixed(1)} miles away`}
                            </Typography>
                          )}
                          {locationPermission === 'prompt' && jobCoords && (
                            <Button size="small" variant="outlined" onClick={requestLocationForDistance} sx={{ textTransform: 'none' }}>
                              Show distance from me
                            </Button>
                          )}
                          {locationPermission === 'denied' && (
                            <Typography variant="caption" color="text.secondary">Enable location to see distance</Typography>
                          )}
                        </Box>
                      )}
                      {addressStr && (
                        <Box
                          component="iframe"
                          title="Map"
                          src={`https://www.google.com/maps?q=${mapsQuery}&output=embed`}
                          sx={{
                            width: '100%',
                            height: 200,
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

          {/* Assignment Info + Schedule (when worker needs to accept/decline — show key details from assignment) */}
          {((statusButtonProps?.label === 'accepted_special' || isAssignmentResponseMode) && statusButtonProps?.label !== 'confirmed_special' && assignmentData) ? (
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
                              {assignmentData.payRate != null ? `$${assignmentData.payRate}/hr` : (posting?.payRate != null ? `$${posting.payRate}/hr` : '—')}
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
                    Schedule
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
                            <Typography variant="body2" color="text.secondary">Date</Typography>
                            <Typography variant="body1">{formatDate(assignmentData.startDate)}</Typography>
                          </Box>
                        )}
                        {(assignmentData.startTime || assignmentData.endTime || scheduleShiftData?.defaultStartTime || scheduleShiftData?.defaultEndTime) && (
                          <Box>
                            <Typography variant="body2" color="text.secondary">Time</Typography>
                            <Typography variant="body1">
                              {[formatTime(assignmentData.startTime || scheduleShiftData?.defaultStartTime), formatTime(assignmentData.endTime || scheduleShiftData?.defaultEndTime)].filter(Boolean).join(' – ')}
                            </Typography>
                          </Box>
                        )}
                        {assignmentData.endDate && (
                          <Box>
                            <Typography variant="body2" color="text.secondary">End date</Typography>
                            <Typography variant="body1">{formatDate(assignmentData.endDate)}</Typography>
                          </Box>
                        )}
                        {!assignmentData.startDate && !assignmentData.startTime && !assignmentData.endTime && !scheduleShiftData?.defaultStartTime && (
                          <Typography variant="body2" color="text.secondary">No schedule details available.</Typography>
                        )}
                      </>
                    )}
                  </Stack>
                </CardContent>
              </Card>
            </>
          ) : null}

          {/* Available Shifts (Gig jobs) — compact, action-oriented */}
          {posting.jobType === 'gig' && (
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
                    onConfirmShift={handleConfirmAssignmentForShift}
                    onDeclineShift={handleDeclineAssignmentForShift}
                    onCancelApplication={handleCancelApplicationForDay}
                    jobPostId={postId}
                    tenantId={resolvedTenantId}
                    language={displayLanguage}
                  />
                ) : posting.jobOrderId ? (
                  <Alert severity="info">
                    No upcoming shifts available at this time. New shifts are added regularly, so
                    check back soon!
                  </Alert>
                ) : null}
              </CardContent>
            </Card>
          )}

          {/* Requirements — guided flow: required-to-apply summary first, tiers, collapse completed */}
          {(() => {
            const eligibility = eligibilitySummary ?? getEligibilitySummary(posting, userProfile, applicationData);
            const allCategories = allRequirementsCategories;
            const hasAnyRequirement = allCategories.length > 0;
            const showInteraction = !!user?.uid && !!applicationDocId;
            const additionalScreeningsData = applicationData?.data?.requirements?.additionalScreenings || {};
            const missingCount = eligibility.missingRequired.length;

            const getMissingActionLabel = (m: { category: string; itemLabel: string; item: { requiresUpload?: boolean } }) => {
              const label = m.itemLabel;
              if (m.category === 'skills') return t('jobs.requirementsActionConfirmSkill', { label });
              if (m.category === 'languages') return t('jobs.requirementsActionConfirmLanguage', { label });
              if (m.category === 'educationLevels') return t('jobs.requirementsActionConfirmEducation', { label });
              if (m.category === 'experienceLevels') return t('jobs.requirementsActionConfirmExperience', { label });
              if (m.category === 'additionalScreenings') return t('jobs.requirementsActionConfirmScreening', { label });
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

            if (!hasAnyRequirement) return null;
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

                  <Typography variant="subtitle1" sx={{ mb: 0.5, fontWeight: 600 }}>
                    {t('jobs.requirementsCompleteTheseSteps')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: missingCount > 0 ? 0.5 : 1 }}>
                    {t('jobs.requirementsEligiblePercent', { percent: eligibility.percent })}
                  </Typography>
                  {missingCount > 0 && (
                    <Typography variant="body2" color="primary.main" sx={{ fontWeight: 500, mb: 1 }}>
                      {t('jobs.requirementsStepsRemaining', { count: missingCount })}
                    </Typography>
                  )}
                  <LinearProgress
                    variant="determinate"
                    value={eligibility.totalCount > 0 ? Math.round((eligibility.metCount / eligibility.totalCount) * 100) : 100}
                    sx={{ height: 8, borderRadius: 1, mb: 2 }}
                    color={eligibility.percent >= 100 ? 'success' : 'primary'}
                  />

                  {/* Missing required items: inline interactions (only requiredToApply missing) */}
                  {missingCount > 0 && (
                    <Box sx={{ mb: 2 }}>
                      <Stack spacing={1.5}>
                        {eligibility.missingRequired.map((m, idx) => (
                          <Box key={`${m.category}-${idx}`} sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'grey.50' }}>
                            <RequirementInteraction
                              item={m.item}
                              categoryLabel={m.categoryLabel}
                              category={m.category}
                              categoryItems={eligibility.categories.find((c) => c.category === m.category)?.items}
                              onFix={
                                !m.item.requiresUpload && m.item.ackKey
                                  ? (answer) => handleRequirementFix(m.item.ackKey!, answer, m.category, m.item.label)
                                  : undefined
                              }
                              onUploadClick={
                                m.item.requiresUpload ? () => navigate('/c1/workers/profile?tab=Qualifications') : undefined
                              }
                              onEducationSelect={m.category === 'educationLevels' ? handleEducationSelect : undefined}
                              onFollowUpFix={
                                m.category === 'additionalScreenings' && /covid|vaccine|vaccination/i.test(m.item.label)
                                  ? (answer) =>
                                      handleRequirementFix(
                                        `additionalScreenings_${m.item.label.replace(/[^a-zA-Z0-9]+/g, '_')}_willing`,
                                        answer,
                                        'additionalScreenings',
                                        m.item.label
                                      )
                                  : undefined
                              }
                              showHealthFollowUp={
                                m.category === 'additionalScreenings' && additionalScreeningsData[m.item.label] === 'No'
                              }
                              showInteraction={showInteraction}
                              initialEducationLevel={m.category === 'educationLevels' ? userProfile?.educationLevel : undefined}
                            />
                          </Box>
                        ))}
                      </Stack>
                    </Box>
                  )}

                  {/* Grouped by tier: Required now, Required before assignment, Recommended — completed sections collapsed */}
                  {byTier.map(({ tier, categories: tierCategories }) =>
                    tierCategories.length === 0 ? null : (
                      <Box key={tier} sx={{ mb: 2 }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={{ fontWeight: 600, mb: 0.5 }}>
                          {t(tierLabelKey[tier])}
                        </Typography>
                        {tierCategories.map((cat) => {
                          const allMet = cat.items.every((i) => i.met);
                          const expanded = requirementsExpanded[cat.category] ?? !allMet;
                          return (
                            <Accordion
                              key={cat.category}
                              expanded={expanded}
                              onChange={(_, isExpanded) =>
                                setRequirementsExpanded((prev) => ({ ...prev, [cat.category]: isExpanded }))
                              }
                              disableGutters
                              sx={{
                                boxShadow: 'none',
                                '&:before': { display: 'none' },
                                borderBottom: 1,
                                borderColor: 'divider',
                              }}
                            >
                              <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 48, '& .MuiAccordionSummary-content': { my: 1 } }}>
                                <Stack direction="row" alignItems="center" spacing={1}>
                                  {allMet ? (
                                    <CheckCircle fontSize="small" color="success" />
                                  ) : null}
                                  <Typography variant="subtitle2">
                                    {allMet ? `✔ ${cat.categoryLabel} complete` : cat.categoryLabel}
                                  </Typography>
                                </Stack>
                              </AccordionSummary>
                              <AccordionDetails sx={{ pt: 0 }}>
                                <Stack spacing={2}>
                                  {cat.items.map((item, index) => (
                                    <Box key={`${cat.category}-${index}`} sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: item.met ? 'success.50' : 'grey.50' }}>
                                      <RequirementInteraction
                                        item={item}
                                        categoryLabel={cat.categoryLabel}
                                        category={cat.category}
                                        categoryItems={cat.items}
                                        onFix={
                                          !item.requiresUpload && item.ackKey
                                            ? (answer) => handleRequirementFix(item.ackKey!, answer, cat.category, item.label)
                                            : undefined
                                        }
                                        onUploadClick={
                                          item.requiresUpload ? () => navigate('/c1/workers/profile?tab=Qualifications') : undefined
                                        }
                                        onEducationSelect={cat.category === 'educationLevels' ? handleEducationSelect : undefined}
                                        onFollowUpFix={
                                          cat.category === 'additionalScreenings' && /covid|vaccine|vaccination/i.test(item.label)
                                            ? (answer) =>
                                                handleRequirementFix(
                                                  `additionalScreenings_${item.label.replace(/[^a-zA-Z0-9]+/g, '_')}_willing`,
                                                  answer,
                                                  'additionalScreenings',
                                                  item.label
                                                )
                                            : undefined
                                        }
                                        showHealthFollowUp={
                                          cat.category === 'additionalScreenings' && additionalScreeningsData[item.label] === 'No'
                                        }
                                        showInteraction={showInteraction}
                                        initialEducationLevel={cat.category === 'educationLevels' ? userProfile?.educationLevel : undefined}
                                      />
                                    </Box>
                                  ))}
                                </Stack>
                              </AccordionDetails>
                            </Accordion>
                          );
                        })}
                      </Box>
                    )
                  )}
                  {posting.eVerifyRequired && (
                    <Box sx={{ display: 'flex', justifyContent: 'flex-start', mt: 2 }}>
                      <Box
                        component="img"
                        src="/img/everify.png"
                        alt="E-Verify"
                        sx={{
                          height: { xs: 32, sm: 36 },
                          width: 'auto',
                          objectFit: 'contain',
                        }}
                      />
                    </Box>
                  )}
                </CardContent>
              </Card>
            );
          })()}
        </Box>

        {/* Sidebar - Only show for non-gig jobs or gig jobs without shifts */}
        {!(posting.jobType === 'gig' && dynamicShifts.length > 0) && (
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
                  {posting.showPayRate && posting.payRate && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        {t('jobs.payRate')}
                      </Typography>
                      <Typography variant="body1" fontWeight="medium">
                        ${posting.payRate}/hr
                      </Typography>
                    </Box>
                  )}

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
                        backgroundColor: '#4CAF50',
                        '&:hover': {
                          backgroundColor: '#45a049',
                        },
                      }}
                    >
                      {assignmentDecisionLoading ? 'Accepting…' : 'I Accept'}
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
                      Decline Job
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
                          backgroundColor: '#4CAF50',
                          color: '#fff',
                          '&:hover': { backgroundColor: '#45a049' },
                        }}
                      >
                        View Assignment Details
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
                            Your job fit
                          </Typography>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 0.5 }}>
                            {'version' in applicationJobScore && applicationJobScore.version === 'v1' && !applicationJobScore.eligible && (
                              <Chip size="small" label="Not Eligible" color="error" />
                            )}
                            <Chip
                              size="small"
                              label={`Score: ${Math.round(applicationJobScore.jobScore)}`}
                              color={applicationJobScore.eligible ? 'success' : 'default'}
                            />
                            {(() => {
                              const missing = 'version' in applicationJobScore && applicationJobScore.version === 'v1'
                                ? (applicationJobScore.buckets?.missingRequired ?? []).map((x: any) => x.label)
                                : ((applicationJobScore as JobScoreSummary).missingLabels ?? []);
                              return missing.length ? (
                                <Typography variant="caption" color="text.secondary">
                                  Missing: {missing.slice(0, 3).join(', ')}
                                  {missing.length > 3 ? '…' : ''}
                                </Typography>
                              ) : applicationJobScore.eligible ? (
                                <Typography variant="caption" color="success.main">Eligible</Typography>
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
                    This posting has expired
                  </Alert>
                )}

                {posting.status === 'paused' && (
                  <Alert severity="info" sx={{ mt: 2 }}>
                    This posting is currently paused
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
          const payLabel = posting.showPayRate && posting.payRate != null ? `$${Number(posting.payRate)}/hr` : null;
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
                    return `${format(sd, 'ha')}–${format(ed, 'ha')}`.toLowerCase().replace(/\s/g, '');
                  } catch {
                    return '';
                  }
                })()
              : '';
            nextLabel = d && !isNaN(d.getTime()) ? `${format(d, 'EEE MMM d')}${timeStr ? ` ${timeStr}` : ''}` : 'Next shift';
          } else if (posting.startDate) {
            nextLabel = `Starts ${formatDate(posting.startDate)}`;
          } else {
            nextLabel = 'Apply now';
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

      {/* Share Snackbar */}
      <Snackbar
        open={shareSnackbarOpen}
        autoHideDuration={3000}
        onClose={() => setShareSnackbarOpen(false)}
        message="Link copied to clipboard!"
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Box>
  );
};

export default JobPostingDetail;

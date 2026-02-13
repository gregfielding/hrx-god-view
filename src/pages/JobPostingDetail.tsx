import React, { useState, useEffect } from 'react';
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
  useTheme,
  useMediaQuery,
  Snackbar,
  Skeleton,
} from '@mui/material';
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
} from '@mui/icons-material';
import { doc, getDoc, collection, query, where, getDocs, updateDoc, arrayUnion, serverTimestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { formatDistanceToNow } from 'date-fns';
import ShiftSelector from '../components/ShiftSelector';
import { JobsBoardService } from '../services/recruiter/jobsBoardService';
import { formatWeeklyScheduleSummary } from '../utils/weeklySchedule';
import { updateUserSmartGroupOnWithdraw } from '../services/smartGroupService';
import type { JobScoreSummary, JobScoreSummaryStored } from '../types/jobScore';
import { getRequirementsWithStatus } from '../utils/jobRequirementStatus';
import { JobRequirementChip } from '../components/JobRequirementChip';
import { logAssignmentUpdateActivity } from '../utils/activityLogger';

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
  const [applicationStatus, setApplicationStatus] = useState<string | null>(null);
  const [applicationDocId, setApplicationDocId] = useState<string | null>(null);
  const [applicationJobScore, setApplicationJobScore] = useState<JobScoreSummaryStored | null>(null);
  const [acceptedAssignmentId, setAcceptedAssignmentId] = useState<string | null>(null);
  const [assignmentStartDate, setAssignmentStartDate] = useState<any>(null); // recruiter-set start date when worker has assignment
  const [assignmentDecisionLoading, setAssignmentDecisionLoading] = useState(false); // prevent double-clicks on I Accept / Decline
  const [shareSnackbarOpen, setShareSnackbarOpen] = useState(false);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [applicationData, setApplicationData] = useState<any>(null);

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
              jobTitle: jobTitle,
              jobType: 'gig',
              jobDescription: jobOrderData.jobOrderDescription || jobOrderData.jobDescription || '',
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
                  : true, // Default to true if not set
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
              // Ensure showWorkersNeeded defaults to true if not set
              showWorkersNeeded:
                postData.showWorkersNeeded !== undefined ? postData.showWorkersNeeded : true,
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

        // Find the first application that matches (they should all have the same status)
        let foundStatus: string | null = null;
        let foundDocId: string | null = null;
        let foundJobScore: JobScoreSummaryStored | null = null;
        for (const snapshot of snapshots) {
          if (!snapshot.empty) {
            const firstDoc = snapshot.docs[0];
            const appData = firstDoc.data();
            foundStatus = appData.status || 'submitted';
            foundDocId = firstDoc.id;
            const js = appData.jobScoreSummary;
            if (js && typeof js.jobScore === 'number') {
              foundJobScore = js as JobScoreSummaryStored;
            }
            break;
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
              foundStatus = appData.status || 'submitted';
              foundDocId = appSnap.id;
              const js = appData.jobScoreSummary;
              if (js && typeof js.jobScore === 'number') {
                foundJobScore = js as JobScoreSummaryStored;
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
          const shifts = await jobsBoardService.fetchActiveShiftsForJobOrder(
            posting.tenantId,
            posting.jobOrderId!,
            posting.shiftFilterDays || 30,
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

  // When worker has an assignment (from URL, accepted state, or application doc), load assignment start date so we show recruiter-set date
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const urlAssignmentId = params.get('assignmentId');
    const assignmentId =
      acceptedAssignmentId ||
      urlAssignmentId ||
      (applicationData?.assignmentId ? String(applicationData.assignmentId) : null);
    if (!assignmentId || !resolvedTenantId) {
      setAssignmentStartDate(null);
      return;
    }
    const loadAssignment = async () => {
      try {
        const assignmentRef = doc(db, 'tenants', resolvedTenantId, 'assignments', assignmentId);
        const snap = await getDoc(assignmentRef);
        if (snap.exists()) {
          const data = snap.data();
          setAssignmentStartDate(data?.startDate ?? null);
        } else {
          setAssignmentStartDate(null);
        }
      } catch (err) {
        console.warn('Error loading assignment for start date:', err);
        setAssignmentStartDate(null);
      }
    };
    loadAssignment();
  }, [resolvedTenantId, acceptedAssignmentId, applicationData?.assignmentId, location.search]);

  const toggleShift = (shiftId: string) => {
    setSelectedShifts((prev) =>
      prev.includes(shiftId) ? prev.filter((id) => id !== shiftId) : [...prev, shiftId],
    );
  };

  // Load applied shifts for the current user
  useEffect(() => {
    const loadAppliedShifts = async () => {
      if (!user?.uid || !resolvedTenantId || !postId || dynamicShifts.length === 0) {
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

        snapshots.forEach((snapshot) => {
          snapshot.forEach((doc) => {
            // Avoid duplicates if a doc matches both queries
            if (seenDocs.has(doc.id)) return;
            seenDocs.add(doc.id);

            const data = doc.data();
            const appStatus = data.status || 'submitted';

            // Check if application has shiftId or shiftIds
            if (data.shiftId) {
              applied.push(data.shiftId);
              statuses[data.shiftId] = appStatus;
            } else if (Array.isArray(data.shiftIds)) {
              data.shiftIds.forEach((shiftId: string) => {
                applied.push(shiftId);
                // If multiple shifts, use the most advanced status
                if (!statuses[shiftId] || appStatus === 'confirmed' || appStatus === 'accepted') {
                  statuses[shiftId] = appStatus;
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
  }, [user?.uid, resolvedTenantId, postId, posting?.jobOrderId, dynamicShifts.length]);

  const handleApplyToShift = (shiftId: string) => {
    if (!user) {
      // Redirect to login/signup with return URL and shiftId
      navigate(
        `/apply/${posting.tenantId}/${postId}?returnTo=/c1/jobs-board/${postId}&shiftId=${shiftId}`,
      );
    } else {
      // Navigate to application wizard with shiftId
      navigate(`/apply/${posting.tenantId}/${postId}?shiftId=${shiftId}`);
    }
  };

  // Helper to safely format dates
  const formatDate = (date: any): string => {
    if (!date) return 'Date TBD';
    try {
      // Handle Firestore Timestamp
      if (date?.toDate) {
        return date.toDate().toLocaleDateString();
      }
      // Handle Date object or string
      const d = new Date(date);
      if (isNaN(d.getTime())) {
        return 'Date TBD';
      }
      return d.toLocaleDateString();
    } catch {
      return 'Date TBD';
    }
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
        return "You're on our shortlist. We'll contact you if a spot opens up.";
      case 'rejected':
      case 'not accepted':
        return "This role has been filled or we've moved forward with other candidates.";
      default:
        return null;
    }
  };

  const handleApply = async () => {
    // Validation for Gig jobs with dynamic shifts
    if (
      posting?.jobType === 'gig' &&
      posting?.usesDynamicShifts &&
      dynamicShifts.length > 0 &&
      selectedShifts.length === 0
    ) {
      alert('Please select at least one shift before applying.');
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
            // Success - redirect back to jobs board
            const tenantSlug = posting.tenantId === 'BCiP2bQ9CgVOCTfV6MhD' ? 'c1' : 'c1'; // Default to c1 for now
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
      if (category === 'additionalScreenings') {
        nextReqs.additionalScreenings = { ...existingAdditionalScreenings, [label]: answer };
      } else if (ackKey === 'backgroundScreeningComfort' || ackKey === 'drugScreeningComfort') {
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
        if (category === 'additionalScreenings') {
          next.data.requirements.additionalScreenings = { ...(next.data.requirements.additionalScreenings || {}), [label]: answer };
        } else if (ackKey === 'backgroundScreeningComfort' || ackKey === 'drugScreeningComfort') {
          next.data.requirements[ackKey] = answer;
        } else if (ackKey) {
          next.data.requirements.acks = { ...(next.data.requirements.acks || {}), [ackKey]: answer };
        }
        return next;
      });
      if (answer === 'Yes' && (category === 'skills' || category === 'languages')) {
        const userRef = doc(db, 'users', user.uid);
        if (category === 'skills') {
          await updateDoc(userRef, {
            skills: arrayUnion(label),
            updatedAt: serverTimestamp(),
          });
          setUserProfile((p: any) => ({ ...p, skills: [...(p?.skills || []), label], updatedAt: new Date() }));
        } else if (category === 'languages') {
          await updateDoc(userRef, {
            languages: arrayUnion(label),
            updatedAt: serverTimestamp(),
          });
          setUserProfile((p: any) => ({ ...p, languages: [...(p?.languages || []), label], updatedAt: new Date() }));
        }
      }
    } catch (err) {
      console.error('Failed to update requirement:', err);
      alert('We couldn’t save that. Please try again.');
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
          Back to Jobs Board
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

  // Assignment accept/decline link from SMS: show "You've been hired" + I Accept / Decline Job
  const params = new URLSearchParams(location.search);
  const urlAssignmentId = params.get('assignmentId');
  const intent = params.get('intent');
  const isAssignmentResponseMode = Boolean(urlAssignmentId && intent === 'assignment_response');
  const assignmentDetailsId = acceptedAssignmentId || urlAssignmentId;
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
    <Box sx={{ maxWidth: 1200, mx: 'auto', p: 0 }}>
      {/* Google Jobs Structured Data */}
      <Helmet>
        <title>
          {posting.postTitle} - {posting.companyName || 'HRX'}
        </title>
        <meta name="description" content={posting.jobDescription?.substring(0, 160) || ''} />
        <script type="application/ld+json">{JSON.stringify(generateJobPostingSchema())}</script>
      </Helmet>

      {/* Back Button */}
      <Button
        startIcon={<ArrowBackIcon />}
        onClick={() => navigate('/c1/jobs-board')}
        size={isMobile ? 'small' : 'medium'}
        sx={{ mb: 3 }}
      >
        Back to Jobs Board
      </Button>

      {/* Header */}
      <Paper elevation={2} sx={{ ...cardBaseSx, mb: 3 }}>
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: 2,
          }}
        >
          <Box sx={{ flex: 1 }}>
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                mb: 2,
                flexWrap: 'wrap',
                gap: 2,
              }}
            >
              <Typography
                variant={isMobile ? 'h5' : 'h4'}
                component="h1"
                sx={{ fontWeight: 'bold', fontSize: isMobile ? '1.25rem' : undefined }}
              >
                {posting.postTitle}
              </Typography>
              {/* Copy Link Button */}
              <Button
                variant="outlined"
                size={isMobile ? 'small' : 'small'}
                startIcon={<ContentCopyIcon />}
                onClick={() => {
                  const url = window.location.href;
                  navigator.clipboard.writeText(url);
                  setShareSnackbarOpen(true);
                }}
                sx={{ fontSize: isMobile ? '0.75rem' : undefined }}
              >
                Copy Link
              </Button>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', mb: 2 }}>
              {posting.companyName && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <BusinessIcon fontSize={isMobile ? 'small' : 'small'} color="primary" />
                  <Typography variant={isMobile ? 'body2' : 'body1'} color="text.secondary">
                    {posting.companyName}
                  </Typography>
                </Box>
              )}

              {posting.worksiteAddress?.city && posting.worksiteAddress?.state && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <LocationIcon fontSize={isMobile ? 'small' : 'small'} color="primary" />
                  <Typography variant={isMobile ? 'body2' : 'body1'} color="text.secondary">
                    {posting.worksiteAddress.city}, {posting.worksiteAddress.state}
                    {posting.worksiteAddress.zipCode && ` ${posting.worksiteAddress.zipCode}`}
                  </Typography>
                </Box>
              )}
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Chip
                label={posting.jobType === 'gig' ? 'Gig' : 'Career'}
                color="primary"
                size="small"
              />

              {/* Hide pay rate for gig jobs with shifts - it's shown on individual shift cards instead */}
              {posting.showPayRate &&
                posting.payRate &&
                !(posting.jobType === 'gig' && dynamicShifts.length > 0) && (
                  <Chip
                    icon={<MoneyIcon />}
                    label={`$${posting.payRate}/hr`}
                    color="success"
                    size="small"
                  />
                )}

              {/* Hide openings count for gig jobs - individual shifts show their own staff needed */}
              {posting.workersNeeded &&
                posting.showWorkersNeeded !== false &&
                !(posting.jobType === 'gig' && dynamicShifts.length > 0) && (
                  <Chip
                    icon={<WorkIcon />}
                    label={`${posting.workersNeeded} position${
                      posting.workersNeeded > 1 ? 's' : ''
                    }`}
                    size="small"
                    variant="outlined"
                  />
                )}

              {(() => {
                // For gig jobs with shifts, show next shift date
                if (posting.jobType === 'gig' && dynamicShifts.length > 0) {
                  // Sort shifts by date and get the earliest one
                  const sortedShifts = [...dynamicShifts].sort(
                    (a, b) => new Date(a.shiftDate).getTime() - new Date(b.shiftDate).getTime(),
                  );
                  const nextShift = sortedShifts[0];
                  if (nextShift?.shiftDate) {
                    return (
                      <Chip
                        icon={<ScheduleIcon />}
                        label={`Next Shift: ${formatDate(nextShift.shiftDate)}`}
                        size="small"
                        variant="outlined"
                      />
                    );
                  }
                }
                // For non-gig jobs or gigs without shifts, show start date if available
                if (posting.startDate) {
                  return (
                    <Chip
                      icon={<ScheduleIcon />}
                      label={
                        posting.jobType === 'career'
                          ? `Estimated Start: ${formatDate(posting.startDate)}`
                          : `Starts ${formatDate(posting.startDate)}`
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

          {/* When hired: show simple message and link to assignment details (accept/decline from that page) */}
          {!(posting.jobType === 'gig' && dynamicShifts.length > 0) &&
            ((statusButtonProps?.label === 'accepted_special' || isAssignmentResponseMode) && statusButtonProps?.label !== 'confirmed_special' ? (
              assignmentDetailsUrl ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'center' }}>
                  <Typography variant="body2" sx={{ color: '#2e7d32', fontWeight: 700 }}>
                    You&apos;ve been hired to work this job.
                  </Typography>
                  <Button
                    component={Link}
                    to={`/c1/workers/assignments/${assignmentDetailsId}`}
                    variant="contained"
                    size={isMobile ? 'small' : 'medium'}
                    sx={{
                      borderRadius: '999px',
                      px: isMobile ? 1.5 : 2,
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
                    {statusButtonProps.label}
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
                    {statusButtonProps.label}
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
                Apply Now
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
          {/* Job Description */}
          <Card sx={{ ...cardBaseSx, mb: 3 }} elevation={2}>
            <CardContent sx={{ p: 0 }}>
              <Typography variant="h6" gutterBottom sx={{ fontWeight: 'bold' }}>
                Job Description
              </Typography>
              <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                {posting.jobDescription || 'No description provided'}
              </Typography>
            </CardContent>
          </Card>

          {/* Shift Selector (for Gig jobs only) */}
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
                    jobPostId={postId}
                    tenantId={resolvedTenantId}
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

          {/* Requirements — show met (green check) vs not met (red + Add to fix) when user has application */}
          {((posting.showBackgroundChecks && posting.backgroundCheckPackages?.length > 0) ||
            (posting.showDrugScreening && posting.drugScreeningPanels?.length > 0) ||
            (posting.showAdditionalScreenings && posting.additionalScreenings?.length > 0) ||
            (posting.showLicensesCerts && posting.licensesCerts?.length > 0) ||
            (posting.showSkills && posting.skills?.length > 0) ||
            (posting.showExperience && posting.experienceLevels?.length > 0) ||
            (posting.showEducation && posting.educationLevels?.length > 0) ||
            (posting.showLanguages && posting.languages?.length > 0) ||
            (posting.showPhysicalRequirements && posting.physicalRequirements?.length > 0) ||
            (posting.showUniformRequirements && posting.uniformRequirements?.length > 0) ||
            (posting.showRequiredPpe && posting.requiredPpe?.length > 0) ||
            posting.eVerifyRequired) && (
            <Card sx={{ ...cardBaseSx }} elevation={2}>
              <CardContent sx={{ p: 0 }}>
                <Typography variant="h6" gutterBottom sx={{ fontWeight: 'bold' }}>
                  Requirements
                </Typography>
                {user?.uid && applicationDocId && (
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                    Green = met (profile or application). Red = not met — use Add to answer Yes/No and update your application.
                  </Typography>
                )}
                <Stack spacing={2}>
                  {getRequirementsWithStatus(posting, userProfile, applicationData).map((cat) => (
                    <Box key={cat.category}>
                      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                        {cat.categoryLabel}
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
                        {cat.items.map((item, index) => (
                          <JobRequirementChip
                            key={`${cat.category}-${index}`}
                            item={item}
                            categoryLabel={cat.categoryLabel}
                            showFixAction={!!user?.uid && !!applicationDocId}
                            onFix={
                              item.ackKey
                                ? (answer) =>
                                    handleRequirementFix(item.ackKey!, answer, cat.category, item.label)
                                : undefined
                            }
                          />
                        ))}
                      </Box>
                    </Box>
                  ))}
                  {posting.showCustomUniformRequirements &&
                    posting.customUniformRequirements &&
                    posting.customUniformRequirements.trim() && (
                      <Box>
                        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                          Custom Uniform Requirements
                        </Typography>
                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                          {posting.customUniformRequirements}
                        </Typography>
                      </Box>
                    )}
                  {posting.eVerifyRequired && (
                    <Box sx={{ display: 'flex', justifyContent: 'flex-start', mt: 1 }}>
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
                </Stack>
              </CardContent>
            </Card>
          )}
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
                    ? "You've Been Hired"
                    : (statusButtonProps?.label === 'accepted_special' || isAssignmentResponseMode)
                      ? 'Accept this Position'
                      : 'Apply for this Position'}
                </Typography>

                <Divider sx={{ my: 2 }} />

                <Stack spacing={2}>
                  {posting.showPayRate && posting.payRate && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Pay Rate
                      </Typography>
                      <Typography variant="body1" fontWeight="medium">
                        ${posting.payRate}/hr
                      </Typography>
                    </Box>
                  )}

                  {posting.workersNeeded && posting.showWorkersNeeded !== false && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Openings
                      </Typography>
                      <Typography variant="body1" fontWeight="medium">
                        {posting.workersNeeded}
                      </Typography>
                    </Box>
                  )}

                  {posting.jobType && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Type
                      </Typography>
                      <Typography variant="body1" fontWeight="medium">
                        {posting.jobType === 'gig' ? 'Gig' : 'Career'}
                      </Typography>
                    </Box>
                  )}

                  {(assignmentStartDate || posting.startDate) && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        {assignmentStartDate
                          ? 'Start Date'
                          : posting.jobType === 'career'
                            ? 'Estimated Start Date'
                            : 'Start Date'}
                      </Typography>
                      <Typography variant="body1" fontWeight="medium">
                        {formatDate(assignmentStartDate ?? posting.startDate)}
                      </Typography>
                    </Box>
                  )}

                  {posting.jobType === 'career' && careerWeeklyScheduleSummary && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                      <Typography variant="body2" color="text.secondary">
                        Weekly Schedule
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
                      You&apos;ve been hired to work this job. Please click the button to Accept the position.
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
                        {statusButtonProps.label}
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
                    Apply Now
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

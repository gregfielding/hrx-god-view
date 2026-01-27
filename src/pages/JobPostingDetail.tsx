import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
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
import { doc, getDoc, collection, query, where, getDocs, updateDoc } from 'firebase/firestore';

import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { formatDistanceToNow } from 'date-fns';
import ShiftSelector from '../components/ShiftSelector';
import { JobsBoardService } from '../services/recruiter/jobsBoardService';

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
  const [appliedShifts, setAppliedShifts] = useState<string[]>([]);
  const [shiftStatuses, setShiftStatuses] = useState<Record<string, string>>({}); // Map shiftId -> status
  const [applicationStatus, setApplicationStatus] = useState<string | null>(null);
  const [applicationDocId, setApplicationDocId] = useState<string | null>(null);
  const [shareSnackbarOpen, setShareSnackbarOpen] = useState(false);

  useEffect(() => {
    if (!resolvedTenantId || !postId) {
      console.log('⚠️ Missing tenantId or postId:', { resolvedTenantId, postId, isC1Route, authTenantId });
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
            const payRate = (jobOrderData.gigPositions?.[0]?.payRate 
              ? parseFloat(String(jobOrderData.gigPositions[0].payRate)) 
              : jobOrderData.payRate) || undefined;
            
            const jobTitle = jobOrderData.gigPositions?.[0]?.jobTitle || jobOrderData.jobTitle || '';
            
            const shift = Array.isArray(jobOrderData.shiftType) 
              ? jobOrderData.shiftType 
              : (jobOrderData.shiftType ? [jobOrderData.shiftType] : []);
            
            // Convert dates
            const startDate = jobOrderData.startDate?.toDate ? jobOrderData.startDate.toDate() : (jobOrderData.startDate ? new Date(jobOrderData.startDate) : undefined);
            const endDate = jobOrderData.endDate?.toDate ? jobOrderData.endDate.toDate() : (jobOrderData.endDate ? new Date(jobOrderData.endDate) : undefined);
            
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
                zipCode: jobOrderData.worksiteAddress?.zipCode || ''
              },
              startDate: startDate,
              endDate: endDate,
              payRate: payRate,
              showPayRate: jobOrderData.showPayRate || false,
              workersNeeded: jobOrderData.workersNeeded,
              showWorkersNeeded: jobOrderData.showWorkersNeeded !== undefined ? jobOrderData.showWorkersNeeded : true, // Default to true if not set
              eVerifyRequired: jobOrderData.eVerifyRequired || false,
              backgroundCheckPackages: Array.isArray(jobOrderData.backgroundCheckPackages) ? jobOrderData.backgroundCheckPackages : [],
              drugScreeningPanels: Array.isArray(jobOrderData.drugScreeningPanels) ? jobOrderData.drugScreeningPanels : [],
              additionalScreenings: Array.isArray(jobOrderData.additionalScreenings) ? jobOrderData.additionalScreenings : [],
              skills: Array.isArray(jobOrderData.skillsRequired) ? jobOrderData.skillsRequired : [],
              licensesCerts: Array.isArray(jobOrderData.requiredLicenses) 
                ? [...jobOrderData.requiredLicenses, ...(Array.isArray(jobOrderData.requiredCertifications) ? jobOrderData.requiredCertifications : [])]
                : (Array.isArray(jobOrderData.requiredCertifications) ? jobOrderData.requiredCertifications : []),
              experienceLevels: Array.isArray(jobOrderData.experienceRequired) 
                ? jobOrderData.experienceRequired 
                : (jobOrderData.experienceRequired ? [jobOrderData.experienceRequired] : []),
              educationLevels: Array.isArray(jobOrderData.educationRequired) 
                ? jobOrderData.educationRequired 
                : (jobOrderData.educationRequired ? [jobOrderData.educationRequired] : []),
              languages: Array.isArray(jobOrderData.languagesRequired) ? jobOrderData.languagesRequired : [],
              physicalRequirements: Array.isArray(jobOrderData.physicalRequirements) 
                ? jobOrderData.physicalRequirements 
                : (jobOrderData.physicalRequirements ? [jobOrderData.physicalRequirements] : []),
              uniformRequirements: Array.isArray(jobOrderData.uniformRequirements) 
                ? jobOrderData.uniformRequirements 
                : (jobOrderData.uniformRequirements ? [jobOrderData.uniformRequirements] : []),
              requiredPpe: Array.isArray(jobOrderData.ppeRequirements) 
                ? jobOrderData.ppeRequirements 
                : (jobOrderData.ppeRequirements ? [jobOrderData.ppeRequirements] : []),
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
              postTitle: postData.postTitle 
            });
            setPosting({ 
              id: postSnap.id, 
              ...postData,
              // Ensure showWorkersNeeded defaults to true if not set
              showWorkersNeeded: postData.showWorkersNeeded !== undefined ? postData.showWorkersNeeded : true
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
          stack: err.stack
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
          where('jobId', '==', postId)
        );
        
        // Also query by jobOrderId if this is a gig job with a jobOrderId
        const queries: Promise<any>[] = [getDocs(q1)];
        
        if (posting?.jobOrderId) {
          const q2 = query(
            applicationsRef,
            where('userId', '==', user.uid),
            where('jobOrderId', '==', posting.jobOrderId)
          );
          queries.push(getDocs(q2));
        }
        
        const snapshots = await Promise.all(queries);
        
        // Find the first application that matches (they should all have the same status)
        let foundStatus: string | null = null;
        let foundDocId: string | null = null;
        for (const snapshot of snapshots) {
          if (!snapshot.empty) {
            const firstDoc = snapshot.docs[0];
            const appData = firstDoc.data();
            foundStatus = appData.status || 'submitted';
            foundDocId = firstDoc.id;
            break;
          }
        }
        
        setApplicationStatus(foundStatus);
        setApplicationDocId(foundDocId);
      } catch (err: any) {
        // Silently handle permission errors - this is not critical functionality
        // The appliedShifts query will still work to show "Application Submitted"
        if (err.code !== 'permission-denied') {
          console.error('Error loading application status:', err);
        }
        setApplicationStatus(null);
        setApplicationDocId(null);
      }
    };

    loadApplicationStatus();
  }, [posting, user?.uid, resolvedTenantId, postId]);

  // Load dynamic shifts for Gig jobs
  useEffect(() => {
    const loadDynamicShifts = async () => {
      console.log('🔍 Dynamic Shifts Check:', {
        hasPosting: !!posting,
        jobType: posting?.jobType,
        usesDynamicShifts: posting?.usesDynamicShifts,
        jobOrderId: posting?.jobOrderId
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
            posting.jobOrderId,
            posting.shiftFilterDays || 30
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

  const toggleShift = (shiftId: string) => {
    setSelectedShifts((prev) =>
      prev.includes(shiftId)
        ? prev.filter((id) => id !== shiftId)
        : [...prev, shiftId]
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
          where('jobId', '==', postId || '')
        );
        
        // Also query by jobOrderId if this is a gig job with a jobOrderId
        const queries: Promise<any>[] = [getDocs(q1)];
        
        if (posting?.jobOrderId) {
          const q2 = query(
            applicationsRef,
            where('userId', '==', user.uid),
            where('jobOrderId', '==', posting.jobOrderId)
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
                if (!statuses[shiftId] || (appStatus === 'confirmed' || appStatus === 'accepted')) {
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
      navigate(`/apply/${posting.tenantId}/${postId}?returnTo=/c1/jobs-board/${postId}&shiftId=${shiftId}`);
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
          pointerEvents: 'none' as const
        };
      case 'rejected':
      case 'not accepted':
        return {
          label: 'Not Accepted',
          backgroundColor: '#F44336', // Red
          color: '#fff',
          cursor: 'default',
          pointerEvents: 'none' as const
        };
      case 'withdrawn':
      case 'cancelled':
        return {
          label: 'cancelled',
          backgroundColor: '#9E9E9E',
          color: '#fff',
          cursor: 'default',
          pointerEvents: 'none' as const
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
          pointerEvents: 'none' as const
        };
      case 'accepted':
        return {
          label: 'accepted_special', // Special flag for custom UI
          backgroundColor: '#2196F3', // Blue for Accepted button
          color: '#fff',
          cursor: 'default',
          pointerEvents: 'none' as const
        };
      case 'confirmed':
        return {
          label: 'confirmed_special', // Special flag for confirmed UI with lock
          backgroundColor: '#4CAF50', // Green
          color: '#fff',
          cursor: 'default',
          pointerEvents: 'none' as const
        };
      case 'submitted':
      case 'new':
      default:
        return {
          label: 'Application Submitted',
          backgroundColor: '#FFC700', // Yellow (existing color)
          color: '#000',
          cursor: 'default',
          pointerEvents: 'none' as const
        };
    }
  };

  const handleApply = async () => {
    // Validation for Gig jobs with dynamic shifts
    if (posting?.jobType === 'gig' && posting?.usesDynamicShifts && dynamicShifts.length > 0 && selectedShifts.length === 0) {
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
      const { hasExistingApplicationData, getMissingRequiredCertifications, submitQuickApplication } = await import('../utils/quickApplicationSubmit');
      
      const hasExistingData = await hasExistingApplicationData(user.uid);
      
      if (hasExistingData) {
        // Check if job requires certifications user doesn't have
        const missingCerts = await getMissingRequiredCertifications(user.uid, posting);
        
        if (missingCerts.length === 0) {
          // User has all required certs - submit directly
          const queryParams = selectedShifts.length > 0 
            ? `?shifts=${selectedShifts.join(',')}`
            : '';
          const returnTo = queryParams ? `/c1/jobs-board/${postId}${queryParams}` : `/c1/jobs-board/${postId}`;
          
          const result = await submitQuickApplication(
            user.uid,
            posting.tenantId,
            postId!,
            posting,
            selectedShifts,
            returnTo
          );
          
          if (result.success) {
            // Success - redirect back to jobs board
            const tenantSlug = posting.tenantId === 'BCiP2bQ9CgVOCTfV6MhD' ? 'c1' : 'c1'; // Default to c1 for now
            navigate(`/${tenantSlug}/jobs-board`);
            return;
          } else {
            // Error - show alert and navigate to wizard
            alert(result.error || 'Failed to submit application. Please try again.');
            const queryParams = selectedShifts.length > 0 
              ? `?shifts=${selectedShifts.join(',')}`
              : '';
            navigate(`/apply/${posting.tenantId}/${postId}${queryParams}`);
            return;
          }
        } else {
          // Missing certs - navigate to wizard starting at certifications step
          const queryParams = selectedShifts.length > 0 
            ? `?shifts=${selectedShifts.join(',')}&step=7`
            : '?step=7';
          navigate(`/apply/${posting.tenantId}/${postId}${queryParams}`);
          return;
        }
      } else {
        // First time applicant - navigate to full wizard
        const queryParams = selectedShifts.length > 0 
          ? `?shifts=${selectedShifts.join(',')}`
          : '';
        navigate(`/apply/${posting.tenantId}/${postId}${queryParams}`);
        return;
      }
    } catch (error) {
      console.error('Error in handleApply:', error);
      // Fallback to wizard on error
      const queryParams = selectedShifts.length > 0 
        ? `?shifts=${selectedShifts.join(',')}`
        : '';
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
      setApplicationStatus('withdrawn');
    } catch (err) {
      console.error('Failed to cancel application:', err);
      alert('We were unable to cancel your application. Please try again.');
    }
  };

  const handleConfirmAssignment = async () => {
    if (!applicationDocId || !resolvedTenantId || !user?.uid) return;
    
    const confirmed = window.confirm('Are you sure you want to confirm this assignment? This confirms that you will work this shift.');
    if (!confirmed) return;

    try {
      const applicationRef = doc(db, 'tenants', resolvedTenantId, 'applications', applicationDocId);
      await updateDoc(applicationRef, {
        status: 'confirmed',
        confirmedAt: new Date(),
        confirmedBy: user.uid,
      });
      setApplicationStatus('confirmed');
      alert('Assignment confirmed! Thank you for confirming your availability.');
    } catch (err) {
      console.error('Failed to confirm assignment:', err);
      alert('We were unable to confirm your assignment. Please try again.');
    }
  };

  const handleConfirmAssignmentForShift = async (shiftId: string) => {
    if (!user?.uid || !resolvedTenantId) return;
    
    const confirmed = window.confirm('Are you sure you want to confirm this assignment? This confirms that you will work this shift.');
    if (!confirmed) return;

    try {
      // Find the application document for this shift
      const applicationsRef = collection(db, 'tenants', resolvedTenantId, 'applications');
      
      // Query by userId and shiftId or shiftIds
      const q1 = query(
        applicationsRef,
        where('userId', '==', user.uid),
        where('shiftId', '==', shiftId)
      );
      const q2 = query(
        applicationsRef,
        where('userId', '==', user.uid),
        where('shiftIds', 'array-contains', shiftId)
      );
      
      const [snapshot1, snapshot2] = await Promise.all([getDocs(q1), getDocs(q2)]);
      
      let applicationDoc = snapshot1.docs[0] || snapshot2.docs[0];
      
      if (!applicationDoc && posting?.jobOrderId) {
        // Fallback: query by jobOrderId
        const q3 = query(
          applicationsRef,
          where('userId', '==', user.uid),
          where('jobOrderId', '==', posting.jobOrderId)
        );
        const snapshot3 = await getDocs(q3);
        applicationDoc = snapshot3.docs.find(doc => {
          const data = doc.data();
          return data.shiftId === shiftId || (Array.isArray(data.shiftIds) && data.shiftIds.includes(shiftId));
        });
      }
      
      if (applicationDoc) {
        const applicationRef = doc(db, 'tenants', resolvedTenantId, 'applications', applicationDoc.id);
        await updateDoc(applicationRef, {
          status: 'confirmed',
          confirmedAt: new Date(),
          confirmedBy: user.uid,
        });
        
        // Update local state
        setShiftStatuses(prev => ({ ...prev, [shiftId]: 'confirmed' }));
        alert('Assignment confirmed! Thank you for confirming your availability.');
      } else {
        alert('Could not find your application for this shift. Please try again.');
      }
    } catch (err) {
      console.error('Failed to confirm assignment:', err);
      alert('We were unable to confirm your assignment. Please try again.');
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
        <Alert severity="error">{error || 'Job posting not found'}</Alert>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/c1/jobs-board')} sx={{ mt: 2 }}>
          Back to Jobs Board
        </Button>
      </Box>
    );
  }

  // Calculate button props for application status button
  const statusButtonProps = applicationStatus ? getApplicationStatusButton(applicationStatus) : null;

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
      "@context": "https://schema.org/",
      "@type": "JobPosting",
      "title": posting.postTitle,
      "description": posting.jobDescription || '',
      "identifier": {
        "@type": "PropertyValue",
        "name": posting.companyName || 'HRX',
        "value": posting.jobPostId || posting.id
      },
      "datePosted": toISOString(posting.createdAt) || new Date().toISOString(),
      "validThrough": toISOString(posting.expDate),
      "employmentType": posting.jobType === 'gig' ? 'TEMPORARY' : 'FULL_TIME',
      "hiringOrganization": {
        "@type": "Organization",
        "name": posting.companyName || 'HRX',
        "sameAs": `https://hrxone.com`
      },
      "jobLocation": {
        "@type": "Place",
        "address": {
          "@type": "PostalAddress",
          "streetAddress": posting.worksiteAddress?.street || '',
          "addressLocality": posting.worksiteAddress?.city || '',
          "addressRegion": posting.worksiteAddress?.state || '',
          "postalCode": posting.worksiteAddress?.zipCode || '',
          "addressCountry": "US"
        }
      },
      "baseSalary": posting.showPayRate && posting.payRate ? {
        "@type": "MonetaryAmount",
        "currency": "USD",
        "value": {
          "@type": "QuantitativeValue",
          "value": posting.payRate,
          "unitText": "HOUR"
        }
      } : undefined,
      "directApply": true,
      "applicationContact": {
        "@type": "ContactPoint",
        "email": "jobs@c1staffing.com"
      }
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
        <title>{posting.postTitle} - {posting.companyName || 'HRX'}</title>
        <meta name="description" content={posting.jobDescription?.substring(0, 160) || ''} />
        <script type="application/ld+json">
          {JSON.stringify(generateJobPostingSchema())}
        </script>
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
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
          <Box sx={{ flex: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
              <Typography 
                variant={isMobile ? 'h5' : 'h4'} 
                component="h1" 
                sx={{ fontWeight: 'bold', fontSize: isMobile ? '1.25rem' : undefined }}
              >
                {posting.postTitle}
              </Typography>
              {/* Share Button */}
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
                Share
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
              {posting.showPayRate && posting.payRate && !(posting.jobType === 'gig' && dynamicShifts.length > 0) && (
                <Chip 
                  icon={<MoneyIcon />}
                  label={`$${posting.payRate}/hr`} 
                  color="success" 
                  size="small"
                />
              )}
              
              {/* Hide openings count for gig jobs - individual shifts show their own staff needed */}
              {posting.workersNeeded && posting.showWorkersNeeded !== false && !(posting.jobType === 'gig' && dynamicShifts.length > 0) && (
                <Chip 
                  icon={<WorkIcon />}
                  label={`${posting.workersNeeded} position${posting.workersNeeded > 1 ? 's' : ''}`} 
                  size="small"
                  variant="outlined"
                />
              )}
              
              {(() => {
                // For gig jobs with shifts, show next shift date
                if (posting.jobType === 'gig' && dynamicShifts.length > 0) {
                  // Sort shifts by date and get the earliest one
                  const sortedShifts = [...dynamicShifts].sort((a, b) => 
                    new Date(a.shiftDate).getTime() - new Date(b.shiftDate).getTime()
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
                      label={`Starts ${formatDate(posting.startDate)}`} 
                      size="small"
                      variant="outlined"
                    />
                  );
                }
                return null;
              })()}
            </Box>
          </Box>

          {/* Hide Apply button for gig jobs with shifts - use individual shift buttons instead */}
          {!(posting.jobType === 'gig' && dynamicShifts.length > 0) && (
            statusButtonProps?.label === 'accepted_special' ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'center' }}>
                <Button
                  variant="contained"
                  size={isMobile ? 'small' : 'small'}
                  disabled
                  sx={{
                    borderRadius: '999px',
                    px: isMobile ? 1.5 : 2,
                    fontSize: isMobile ? '0.75rem' : undefined,
                    fontWeight: 600,
                    backgroundColor: '#2196F3',
                    color: '#fff',
                    mb: 1,
                  }}
                >
                  Accepted
                </Button>
                <Button
                  variant="contained"
                  size={isMobile ? 'small' : 'small'}
                  onClick={handleConfirmAssignment}
                  sx={{
                    borderRadius: '999px',
                    px: isMobile ? 1.5 : 2,
                    fontSize: isMobile ? '0.75rem' : undefined,
                    fontWeight: 600,
                    backgroundColor: '#4CAF50',
                    color: '#fff',
                    '&:hover': {
                      backgroundColor: '#45a049',
                    },
                  }}
                >
                  Click to Confirm
                </Button>
              </Box>
            ) : statusButtonProps?.label === 'confirmed_special' ? (
              <Button
                variant="contained"
                size={isMobile ? 'small' : 'small'}
                disabled
                startIcon={<LockIcon />}
                sx={{
                  borderRadius: '999px',
                  px: isMobile ? 1.5 : 2,
                  fontSize: isMobile ? '0.75rem' : undefined,
                  fontWeight: 600,
                  backgroundColor: '#4CAF50',
                  color: '#fff',
                }}
              >
                Confirmed
              </Button>
            ) : statusButtonProps ? (
              statusButtonProps.label === 'Application Submitted' ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: { xs: 'stretch', sm: 'flex-end' }, gap: 1 }}>
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
              ) : statusButtonProps.label === 'cancelled' ? (
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
            )
          )}
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
                    jobPostId={postId}
                    tenantId={resolvedTenantId}
                  />
                ) : posting.jobOrderId ? (
                  <Alert severity="info">
                    No upcoming shifts available at this time. New shifts are added regularly, so check back soon!
                  </Alert>
                ) : null}
              </CardContent>
            </Card>
          )}

          {/* Requirements */}
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
                
                <Stack spacing={2}>
                  {posting.showBackgroundChecks && posting.backgroundCheckPackages?.length > 0 && (
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                        Background Check Packages
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {posting.backgroundCheckPackages.map((pkg: string, index: number) => (
                          <Chip key={index} label={pkg} size="small" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {posting.showDrugScreening && posting.drugScreeningPanels?.length > 0 && (
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                        Drug Screening Panels
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {posting.drugScreeningPanels.map((panel: string, index: number) => (
                          <Chip key={index} label={panel} size="small" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {posting.showAdditionalScreenings && posting.additionalScreenings?.length > 0 && (
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                        Additional Screenings
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {posting.additionalScreenings.map((screening: string, index: number) => (
                          <Chip key={index} label={screening} size="small" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {posting.showLicensesCerts && posting.licensesCerts?.length > 0 && (
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                        Licenses & Certifications
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {posting.licensesCerts.map((cert: string, index: number) => (
                          <Chip key={index} label={cert} size="small" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {posting.showSkills && posting.skills?.length > 0 && (
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                        Required Skills
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {posting.skills.map((skill: string, index: number) => (
                          <Chip key={index} label={skill} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {posting.showExperience && posting.experienceLevels?.length > 0 && (
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                        Experience
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {posting.experienceLevels.map((exp: string, index: number) => (
                          <Chip key={index} label={exp} size="small" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {posting.showEducation && posting.educationLevels?.length > 0 && (
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                        Education
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {posting.educationLevels.map((edu: string, index: number) => (
                          <Chip key={index} label={edu} size="small" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {posting.showLanguages && posting.languages?.length > 0 && (
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                        Languages
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {posting.languages.map((lang: string, index: number) => (
                          <Chip key={index} label={lang} size="small" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {posting.showPhysicalRequirements && posting.physicalRequirements?.length > 0 && (
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                        Physical Requirements
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {posting.physicalRequirements.map((req: string, index: number) => (
                          <Chip key={index} label={req} size="small" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {posting.showUniformRequirements && posting.uniformRequirements?.length > 0 && (
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                        Uniform Requirements
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {posting.uniformRequirements.map((uniform: string, index: number) => (
                          <Chip key={index} label={uniform} size="small" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {posting.showCustomUniformRequirements && posting.customUniformRequirements && posting.customUniformRequirements.trim() && (
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                        Custom Uniform Requirements
                      </Typography>
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                        {posting.customUniformRequirements}
                      </Typography>
                    </Box>
                  )}

                  {posting.showRequiredPpe && posting.requiredPpe?.length > 0 && (
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                        Required PPE
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {posting.requiredPpe.map((ppe: string, index: number) => (
                          <Chip key={index} label={ppe} size="small" />
                        ))}
                      </Box>
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
            {/* Quick Apply Card */}
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
                  Apply for this Position
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
                  
                  {posting.startDate && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Start Date
                      </Typography>
                      <Typography variant="body1" fontWeight="medium">
                        {formatDate(posting.startDate)}
                      </Typography>
                    </Box>
                  )}
                </Stack>

                {statusButtonProps?.label === 'accepted_special' ? (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 3 }}>
                    <Button
                      variant="contained"
                      size="small"
                      disabled
                      fullWidth
                      sx={{
                        backgroundColor: '#2196F3',
                        color: '#fff',
                        fontWeight: 600,
                      }}
                    >
                      Accepted
                    </Button>
                    <Button
                      variant="contained"
                      size="large"
                      fullWidth
                      onClick={handleConfirmAssignment}
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
                      Click to Confirm
                    </Button>
                  </Box>
                ) : statusButtonProps?.label === 'confirmed_special' ? (
                  <Button
                    variant="contained"
                    size="large"
                    fullWidth
                    disabled
                    startIcon={<LockIcon />}
                    sx={{
                      mt: 3,
                      py: 1.5,
                      fontSize: '1.1rem',
                      fontWeight: 'bold',
                      backgroundColor: '#4CAF50',
                      color: '#fff',
                    }}
                  >
                    Confirmed
                  </Button>
                ) : statusButtonProps ? (
                  statusButtonProps.label === 'cancelled' ? (
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
                    <Button
                      variant="contained"
                      fullWidth
                      size="large"
                      sx={{ 
                        mt: 3, 
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


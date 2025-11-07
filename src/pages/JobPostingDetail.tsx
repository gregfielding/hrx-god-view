import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
} from '@mui/material';
import {
  LocationOn as LocationIcon,
  Work as WorkIcon,
  AttachMoney as MoneyIcon,
  Schedule as ScheduleIcon,
  Business as BusinessIcon,
  ArrowBack as ArrowBackIcon,
  ContentCopy as ContentCopyIcon,
} from '@mui/icons-material';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';

import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { formatDistanceToNow } from 'date-fns';
import ShiftSelector from '../components/ShiftSelector';
import { JobsBoardService } from '../services/recruiter/jobsBoardService';

const JobPostingDetail: React.FC = () => {
  const { postId } = useParams<{ postId: string }>();
  const navigate = useNavigate();
  const { tenantId, user } = useAuth();
  const [posting, setPosting] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedShifts, setSelectedShifts] = useState<string[]>([]);
  const [dynamicShifts, setDynamicShifts] = useState<any[]>([]);
  const [loadingShifts, setLoadingShifts] = useState(false);
  const [appliedShifts, setAppliedShifts] = useState<string[]>([]);
  const [applicationStatus, setApplicationStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId || !postId) return;

    const loadPosting = async () => {
      try {
        setLoading(true);
        
        // Check if this is a job order ID (prefixed with "job-order-")
        if (postId.startsWith('job-order-')) {
          const jobOrderId = postId.replace('job-order-', '');
          const jobOrderRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId);
          const jobOrderSnap = await getDoc(jobOrderRef);
          
          if (jobOrderSnap.exists()) {
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
              tenantId: tenantId,
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
            setError('Job order not found');
          }
        } else {
          // Regular posting ID - load from job_postings
          const postRef = doc(db, 'tenants', tenantId, 'job_postings', postId);
          const postSnap = await getDoc(postRef);

          if (postSnap.exists()) {
            const postData = postSnap.data();
            setPosting({ 
              id: postSnap.id, 
              ...postData,
              // Ensure showWorkersNeeded defaults to true if not set
              showWorkersNeeded: postData.showWorkersNeeded !== undefined ? postData.showWorkersNeeded : true
            });
          } else {
            setError('Job posting not found');
          }
        }
      } catch (err: any) {
        console.error('Error loading job posting:', err);
        setError(err.message || 'Failed to load job posting');
      } finally {
        setLoading(false);
      }
    };

    loadPosting();
  }, [tenantId, postId]);

  // Load application status when posting and user are available
  useEffect(() => {
    const loadApplicationStatus = async () => {
      if (!posting || !user?.uid || !tenantId || !postId) {
        setApplicationStatus(null);
        return;
      }

      try {
        // Query applications using the same approach as loadAppliedShifts
        // This respects Firestore security rules better than direct document access
        const applicationsRef = collection(db, 'tenants', tenantId, 'applications');
        
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
        for (const snapshot of snapshots) {
          if (!snapshot.empty) {
            const firstDoc = snapshot.docs[0];
            const appData = firstDoc.data();
            foundStatus = appData.status || 'submitted';
            break;
          }
        }
        
        setApplicationStatus(foundStatus);
      } catch (err: any) {
        // Silently handle permission errors - this is not critical functionality
        // The appliedShifts query will still work to show "Application Submitted"
        if (err.code !== 'permission-denied') {
          console.error('Error loading application status:', err);
        }
        setApplicationStatus(null);
      }
    };

    loadApplicationStatus();
  }, [posting, user?.uid, tenantId, postId]);

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
      if (!user?.uid || !tenantId || !postId || dynamicShifts.length === 0) {
        setAppliedShifts([]);
        return;
      }

      try {
        // Query applications for this job posting that include shiftId
        // For gig jobs, we need to check both jobId (posting ID) and jobOrderId
        const applicationsRef = collection(db, 'tenants', tenantId, 'applications');
        
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
        const seenDocs = new Set<string>();
        
        snapshots.forEach((snapshot) => {
          snapshot.forEach((doc) => {
            // Avoid duplicates if a doc matches both queries
            if (seenDocs.has(doc.id)) return;
            seenDocs.add(doc.id);
            
            const data = doc.data();
            console.log(`🔍 Checking application ${doc.id}:`, { jobId: data.jobId, jobOrderId: data.jobOrderId, shiftId: data.shiftId, shiftIds: data.shiftIds });
            
            // Check if application has shiftId or shiftIds
            if (data.shiftId) {
              applied.push(data.shiftId);
            } else if (Array.isArray(data.shiftIds)) {
              applied.push(...data.shiftIds);
            }
          });
        });
        
        console.log(`✅ Loaded applied shifts for user ${user.uid}:`, applied);
        setAppliedShifts(applied);
      } catch (err) {
        console.error('Error loading applied shifts:', err);
        setAppliedShifts([]);
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
  }, [user?.uid, tenantId, postId, posting?.jobOrderId, dynamicShifts.length]);

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
          label: 'Cancelled',
          backgroundColor: '#9E9E9E', // Grey
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
          backgroundColor: '#4CAF50', // Green for confirm button
          color: '#fff',
          cursor: 'pointer',
          pointerEvents: 'auto' as const
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

  const handleApply = () => {
    // Validation for Gig jobs with dynamic shifts
    if (posting?.jobType === 'gig' && posting?.usesDynamicShifts && dynamicShifts.length > 0 && selectedShifts.length === 0) {
      alert('Please select at least one shift before applying.');
      return;
    }

    if (!user) {
      // Redirect to login/signup with return URL
      navigate(`/apply/${posting.tenantId}/${postId}?returnTo=/c1/jobs-board/${postId}`);
    } else {
      // Navigate to application wizard with selected shifts
      const queryParams = selectedShifts.length > 0 
        ? `?shifts=${selectedShifts.join(',')}`
        : '';
      navigate(`/apply/${posting.tenantId}/${postId}${queryParams}`);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
        <CircularProgress />
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

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', p: 3 }}>
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
        sx={{ mb: 3 }}
      >
        Back to Jobs Board
      </Button>

      {/* Header */}
      <Paper elevation={2} sx={{ p: 4, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
          <Box sx={{ flex: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
              <Typography variant="h4" component="h1" sx={{ fontWeight: 'bold' }}>
                {posting.postTitle}
              </Typography>
              {/* Share Button */}
              <Button
                variant="outlined"
                size="small"
                startIcon={<ContentCopyIcon />}
                onClick={() => {
                  const url = window.location.href;
                  navigator.clipboard.writeText(url);
                  alert('Link copied to clipboard!');
                }}
              >
                Share
              </Button>
            </Box>
            
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', mb: 2 }}>
              {posting.companyName && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <BusinessIcon fontSize="small" color="primary" />
                  <Typography variant="body1" color="text.secondary">
                    {posting.companyName}
                  </Typography>
                </Box>
              )}
              
              {posting.worksiteName && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <LocationIcon fontSize="small" color="primary" />
                  <Typography variant="body1" color="text.secondary">
                    {posting.worksiteName}
                    {posting.worksiteAddress?.city && `, ${posting.worksiteAddress.city}`}
                    {posting.worksiteAddress?.state && `, ${posting.worksiteAddress.state}`}
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
                <Typography variant="body1" sx={{ fontWeight: 500, mb: 1 }}>
                  You've been hired!
                </Typography>
                <Button
                  variant="contained"
                  size="large"
                  onClick={() => {/* TODO: Handle confirm */}}
                  sx={{
                    minWidth: 200,
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
                <Button
                  variant="contained"
                  size="small"
                  onClick={() => {/* TODO: Handle cancel */}}
                  sx={{
                    minWidth: 150,
                    backgroundColor: '#F44336',
                    '&:hover': {
                      backgroundColor: '#da190b',
                    },
                  }}
                >
                  Cancel
                </Button>
              </Box>
            ) : statusButtonProps ? (
              <Button
                variant="contained"
                size="large"
                sx={{
                  minWidth: 200,
                  py: 1.5,
                  fontSize: '1.1rem',
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
            ) : (
              <Button
                variant="contained"
                size="large"
                onClick={handleApply}
                sx={{
                  minWidth: 200,
                  py: 1.5,
                  fontSize: '1.1rem',
                  fontWeight: 'bold'
                }}
              >
                Apply Now
              </Button>
            )
          )}
        </Box>
      </Paper>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: posting.jobType === 'gig' && dynamicShifts.length > 0 ? '1fr' : '2fr 1fr' }, gap: 3 }}>
        {/* Main Content */}
        <Box>
          {/* Job Description */}
          <Card sx={{ mb: 3 }}>
            <CardContent>
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
            <Card sx={{ mb: 3 }}>
              <CardContent>
                {loadingShifts ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                    <CircularProgress size={24} />
                  </Box>
                ) : dynamicShifts.length > 0 ? (
                  <ShiftSelector
                    shifts={dynamicShifts}
                    onApplyToShift={handleApplyToShift}
                    appliedShifts={appliedShifts}
                    jobPostId={postId}
                    tenantId={tenantId}
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
            (posting.showRequiredPpe && posting.requiredPpe?.length > 0)) && (
            <Card>
              <CardContent>
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
                </Stack>
              </CardContent>
            </Card>
          )}
        </Box>

        {/* Sidebar - Only show for non-gig jobs or gig jobs without shifts */}
        {!(posting.jobType === 'gig' && dynamicShifts.length > 0) && (
          <Box sx={{ position: 'sticky', top: 80, alignSelf: 'flex-start' }}>
            {/* Quick Apply Card */}
            <Card sx={{ 
              mb: 3, 
              bgcolor: 'white'
            }}>
              <CardContent>
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
                    <Typography variant="body1" sx={{ fontWeight: 500, mb: 1, textAlign: 'center' }}>
                      You've been hired!
                    </Typography>
                    <Button
                      variant="contained"
                      size="large"
                      fullWidth
                      onClick={() => {/* TODO: Handle confirm */}}
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
                    <Button
                      variant="contained"
                      size="medium"
                      fullWidth
                      onClick={() => {/* TODO: Handle cancel */}}
                      sx={{
                        backgroundColor: '#F44336',
                        '&:hover': {
                          backgroundColor: '#da190b',
                        },
                      }}
                    >
                      Cancel
                    </Button>
                  </Box>
                ) : statusButtonProps ? (
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
    </Box>
  );
};

export default JobPostingDetail;


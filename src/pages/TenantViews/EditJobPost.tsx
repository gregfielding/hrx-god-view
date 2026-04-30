import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  CircularProgress,
  Alert,
  Paper,
  Breadcrumbs,
  Avatar,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
} from '@mui/material';
import {
  ArrowBack,
  NavigateNext,
  Email as EmailIcon,
  Phone as PhoneIcon,
  Star as StarIcon,
  Groups as GroupIcon,
  Insights as InsightsIcon,
  ContentCopy as ContentCopyIcon,
  LocationOn as LocationOnIcon,
} from '@mui/icons-material';
import { useAuth } from '../../contexts/AuthContext';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';

import { JobsBoardService, JobsBoardPost } from '../../services/recruiter/jobsBoardService';
import JobPostForm from '../../components/JobPostForm';
import { db } from '../../firebase';
import FavoriteButton from '../../components/FavoriteButton';
import InterviewCell from '../../components/InterviewCell';
import { useFavorites } from '../../hooks/useFavorites';
import { calculateProfileScore } from '../../utils/applicantScoring';
import { toChipLabel } from '../../utils/chipLabel';
import PageHeader from '../../components/PageHeader';
import StandardTablePagination from '../../components/StandardTablePagination';
import { TABLE_AVATAR_SIZE } from '../../utils/uiConstants';
import UserTableResumeIcon from '../../components/tables/UserTableResumeIcon';
import UserTableIndeedFlexBadge from '../../components/tables/UserTableIndeedFlexBadge';
import UserTableFieldglassBadge from '../../components/tables/UserTableFieldglassBadge';
import { pickResumeFromUserDoc } from '../../utils/userResumeOpen';
import { hasJobBoardSyndicationUrl } from '../../utils/jobBoardSyndicationUrls';
import JobBoardSyndicationIconRow from '../../components/JobBoardSyndicationIconRow';
import { normalizeScoreSummary, formatOneDecimal } from '../../utils/scoreSummary';
import { getWorkAuthorizedStatus } from '../../utils/workAuthorizedDisplay';
import { getEVerifyComfortStatusFromUserData } from '../../utils/eVerifyComfortDisplay';
import WorkAuthorizedChip from '../../components/WorkAuthorizedChip';
import EVerifyComfortChip from '../../components/EVerifyComfortChip';
import JobBoardPostStatusChip from '../../components/JobBoardPostStatusChip';
import { formatWorksiteCityStateZip } from '../../utils/formatWorksiteAddress';

const EditJobPost: React.FC = () => {
  const { tenantId, activeTenant } = useAuth();
  const { postId } = useParams<{ postId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  
  // Check if we're accessing from the recruiter module
  const isFromRecruiter = location.pathname.includes('/jobs/jobs-board');
  
  const [post, setPost] = useState<JobsBoardPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [applications, setApplications] = useState<any[]>([]);
  const [applicantUsers, setApplicantUsers] = useState<any[]>([]);
  const [loadingApplications, setLoadingApplications] = useState(false);
  const [allGroups, setAllGroups] = useState<any[]>([]);

  const jobsBoardService = JobsBoardService.getInstance();
  const { isFavorite, toggleFavorite } = useFavorites('users');

  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [applicantsSortBy, setApplicantsSortBy] = useState<'interview' | null>(null);
  const [applicantsSortDirection, setApplicantsSortDirection] = useState<'asc' | 'desc'>('desc');
  const [publicUrlCopyHint, setPublicUrlCopyHint] = useState<'idle' | 'copied' | 'error'>('idle');

  const jobsBoardUrlSlug = useMemo(() => {
    const s = activeTenant?.slug;
    return typeof s === 'string' && s.trim() ? s.trim() : 'c1';
  }, [activeTenant?.slug]);

  const publicJobPostingUrl = useMemo(() => {
    if (!postId) return '';
    const origin =
      typeof window !== 'undefined' && window.location.origin ? window.location.origin : 'https://hrxone.com';
    return `${origin}/${jobsBoardUrlSlug}/jobs-board/${postId}`;
  }, [postId, jobsBoardUrlSlug]);

  /** Merge form edits into header `post` (syndication icons + location lines update while typing). */
  const handleHeaderPreviewPatch = useCallback((patch: Partial<JobsBoardPost>) => {
    setPost((p) => (p ? { ...p, ...patch } : p));
  }, []);

  const handleCopyPublicJobPostingUrl = async () => {
    if (!publicJobPostingUrl) return;
    try {
      await navigator.clipboard.writeText(publicJobPostingUrl);
      setPublicUrlCopyHint('copied');
      window.setTimeout(() => setPublicUrlCopyHint('idle'), 2000);
    } catch {
      setPublicUrlCopyHint('error');
      window.setTimeout(() => setPublicUrlCopyHint('idle'), 2500);
    }
  };

  useEffect(() => {
    if (postId && tenantId) {
      loadPost();
      loadApplications(); // Load applications on mount to show accurate count
      loadGroups();
    }
  }, [postId, tenantId]);

  const loadPost = async () => {
    if (!tenantId || !postId) return;

    try {
      setLoading(true);
      setError(null);
      const postData = await jobsBoardService.getPost(tenantId, postId);
      setPost(postData);
    } catch (err: any) {
      console.error('Error loading job post:', err);
      setError(err.message || 'Failed to load job post');
    } finally {
      setLoading(false);
    }
  };

  const loadApplications = async () => {
    if (!tenantId || !postId) {
      return;
    }

    try {
      setLoadingApplications(true);
      const applicationsRef = collection(db, 'tenants', tenantId, 'applications');
      
      // Query for both postId and jobId since the codebase uses both field names
      const q = query(
        applicationsRef,
        where('postId', '==', postId),
        orderBy('createdAt', 'desc')
      );
      
      const snapshot = await getDocs(q);
      let applicationsData: any[] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));

      // If no results with postId, try jobId
      if (applicationsData.length === 0) {
        const q2 = query(
          applicationsRef,
          where('jobId', '==', postId),
          orderBy('createdAt', 'desc')
        );
        const snapshot2 = await getDocs(q2);
        applicationsData = snapshot2.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        }));
      }

      // If still no results, try matching by document ID pattern (userId_postId)
      if (applicationsData.length === 0) {
        console.log('loadApplications: trying to match by document ID pattern');
        const allAppsInTenant = await getDocs(applicationsRef);
        const matchingApps = allAppsInTenant.docs.filter(doc => {
          // Document ID format is: userId_jobId
          // We want to match where jobId === postId
          const parts = doc.id.split('_');
          return parts.length === 2 && parts[1] === postId;
        });
        console.log('loadApplications: document ID pattern matched', matchingApps.length, 'applications');
        applicationsData = matchingApps.map(doc => ({
          id: doc.id,
          ...doc.data(),
        })).sort((a: any, b: any) => {
          const aTime = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
          const bTime = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
          return bTime - aTime; // descending
        });
      }

      console.log('loadApplications: total applications found:', applicationsData.length);
      
      // DEBUG: Let's see what's actually in the applications collection
      if (applicationsData.length === 0) {
        console.log('DEBUG: No applications found for postId:', postId);
        console.log('DEBUG: Current post data:', post);
        
        const allAppsQuery = query(collection(db, 'tenants', tenantId, 'applications'));
        const allAppsSnap = await getDocs(allAppsQuery);
        console.log('DEBUG: Total applications in tenant:', allAppsSnap.size);
        
        // Check if this post has a connected job order
        const postData = post as any;
        if (postData?.connectedJobOrderId) {
          console.log('DEBUG: This post is connected to job order:', postData.connectedJobOrderId);
          // Try querying by jobOrderId
          const jobOrderQuery = query(
            applicationsRef,
            where('jobOrderId', '==', postData.connectedJobOrderId)
          );
          const jobOrderSnap = await getDocs(jobOrderQuery);
          console.log('DEBUG: Applications with matching jobOrderId:', jobOrderSnap.size);
          if (jobOrderSnap.size > 0) {
            applicationsData = jobOrderSnap.docs.map(doc => ({
              id: doc.id,
              ...doc.data(),
            }));
            console.log('DEBUG: Found applications via jobOrderId!');
          }
        }
        
        if (allAppsSnap.size > 0 && applicationsData.length === 0) {
          console.log('DEBUG: Sample application documents:');
          allAppsSnap.docs.slice(0, 5).forEach(doc => {
            const data = doc.data();
            console.log('  -', doc.id, ':', {
              postId: data.postId,
              jobId: data.jobId,
              jobOrderId: data.jobOrderId,
              userId: data.userId,
            });
          });
        }
      }
      
      setApplications(applicationsData);
      
      // Load user data for applicants who have candidateId/userId
      await loadApplicantUsers(applicationsData);
    } catch (err: any) {
      console.error('Error loading applications (will try fallback):', err);
      console.error('Error code:', err?.code);
      console.error('Error message:', err?.message);
      // If orderBy fails (no index), try without it
      try {
        const applicationsRef = collection(db, 'tenants', tenantId, 'applications');
        const q = query(applicationsRef, where('postId', '==', postId));
        const snapshot = await getDocs(q);
        let applicationsData: any[] = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        }));

        // If no results with postId, try jobId
        if (applicationsData.length === 0) {
          const q2 = query(applicationsRef, where('jobId', '==', postId));
          const snapshot2 = await getDocs(q2);
          applicationsData = snapshot2.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
          }));
        }

        // Sort manually by createdAt
        applicationsData.sort((a, b) => {
          const aTime = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : a.createdAt || 0;
          const bTime = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : b.createdAt || 0;
          return bTime - aTime;
        });

        setApplications(applicationsData);
        await loadApplicantUsers(applicationsData);
      } catch (err2: any) {
        console.error('Error loading applications (fallback):', err2);
      }
    } finally {
      setLoadingApplications(false);
    }
  };

  useEffect(() => {
    setPage(0);
  }, [applicantUsers.length, activeTab]);

  const loadGroups = async () => {
    if (!tenantId) return;
    try {
      const groupsRef = collection(db, 'tenants', tenantId, 'userGroups');
      const snapshot = await getDocs(groupsRef);
      const groupsData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setAllGroups(groupsData);
    } catch (err) {
      console.error('Error loading groups:', err);
    }
  };

  const loadApplicantUsers = async (applicationsData: any[]) => {
    if (!tenantId) return;
    
    // Get unique user IDs from applications
    const userIds = new Set<string>();
    applicationsData.forEach((app) => {
      if (app.candidateId) userIds.add(app.candidateId);
      if (app.userId) userIds.add(app.userId);
    });

    if (userIds.size === 0) {
      setApplicantUsers([]);
      return;
    }

    try {
      // Fetch users by their IDs
      const usersRef = collection(db, 'users');
      const usersSnapshot = await getDocs(usersRef);
      
      const users = usersSnapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((user: any) => userIds.has(user.id))
        .map((user: any) => {
          // Normalize skills to strings
          const rawSkills = user.skills || [];
          const normalizedSkills = rawSkills
            .map((skill: any) => {
              if (typeof skill === 'string') return skill;
              if (skill?.label) return skill.label;
              if (skill?.name) return skill.name;
              if (skill?.value) return skill.value;
              return null;
            })
            .filter((skill: string | null) => skill !== null);

          // Calculate AI profile score if not present
          const aiProfileScore =
            user.aiJobFitScore ?? user.aiProfileScore ?? calculateProfileScore(user);

          return {
            id: user.id,
            firstName: user.firstName || '',
            lastName: user.lastName || '',
            email: user.email || '',
            phone: user.phone || '',
            avatar: user.avatar,
            securityLevel: String(user.securityLevel || user.tenantIds?.[tenantId]?.securityLevel || '0'),
            lastLoginAt: user.lastLoginAt,
            updatedAt: user.updatedAt,
            createdAt: user.createdAt,
            aiProfileScore,
            scoreSummary: normalizeScoreSummary(user.scoreSummary),
            userGroupIds: user.userGroupIds || [],
            skills: normalizedSkills,
            workEligibilityAttestation: user.workEligibilityAttestation,
            comfortableEVerify: user.comfortableEVerify,
            workerAttestations: user.workerAttestations,
            resume: user.resume,
            addedToIndeedFlex: user.addedToIndeedFlex === true,
            addedToFieldglass: user.addedToFieldglass === true,
          };
        });

      setApplicantUsers(users);
    } catch (err: any) {
      console.error('Error loading applicant users:', err);
    }
  };

  const handleSave = async (updatedPost: Partial<JobsBoardPost>) => {
    if (!tenantId || !postId) return;

    try {
      setSaving(true);
      setError(null);

      await jobsBoardService.updatePost(tenantId, postId, updatedPost);

      if (isFromRecruiter) {
        navigate('/jobs/jobs-board');
      } else {
        navigate('/jobs-dashboard');
      }
    } catch (err: any) {
      console.error('Error updating job post:', err);
      setError(err.message || 'Failed to update job post');
      throw err;
    } finally {
      setSaving(false);
    }
  };

  /** Recruiter jobs-board edit: save without leaving; refetch for header accuracy (form ignores same-id `initialData` resync while autoSave). */
  const handlePersistPost = async (updatedPost: Partial<JobsBoardPost>) => {
    if (!tenantId || !postId) return;

    try {
      setError(null);
      await jobsBoardService.updatePost(tenantId, postId, updatedPost);
      const postData = await jobsBoardService.getPost(tenantId, postId);
      setPost(postData);
    } catch (err: any) {
      console.error('Error updating job post:', err);
      setError(err.message || 'Failed to update job post');
      throw err;
    }
  };

  const handleCancel = () => {
    if (isFromRecruiter) {
      navigate('/jobs/jobs-board');
    } else {
      navigate('/jobs-dashboard');
    }
  };

  const groupLookup = useMemo(() => {
    const map = new Map<string, any>();
    allGroups.forEach((group) => map.set(group.id, group));
    return map;
  }, [allGroups]);

  const getSecurityLevelLabel = (level: string): string => {
    switch (level) {
      case '0':
        return 'Suspended';
      case '1':
        return 'Dismissed';
      case '2':
        return 'Applicant';
      case '3':
        return 'Candidate';
      case '4':
        return 'Staff';
      default:
        return level;
    }
  };

  const getSecurityLevelColor = (level: string):
    | 'default'
    | 'primary'
    | 'secondary'
    | 'success'
    | 'error'
    | 'warning'
    | 'info' => {
    switch (level) {
      case '0':
        return 'error';
      case '1':
        return 'default';
      case '2':
        return 'info';
      case '3':
        return 'primary';
      case '4':
        return 'success';
      default:
        return 'default';
    }
  };

  const formatDate = (timestamp: any) => {
    if (!timestamp) return 'N/A';
    let date: Date;
    if (timestamp instanceof Date) {
      date = timestamp;
    } else if (typeof timestamp === 'number') {
      date = new Date(timestamp);
    } else if (timestamp?.toDate) {
      date = timestamp.toDate();
    } else if (timestamp?._seconds) {
      date = new Date(timestamp._seconds * 1000);
    } else {
      return 'N/A';
    }

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const renderAiScore = (user: any) => {
    const score = user.aiJobFitScore ?? user.aiProfileScore;
    if (score === undefined || score === null || Number.isNaN(score)) {
      return <Typography variant="body2" color="text.secondary">N/A</Typography>;
    }

    let color: 'default' | 'success' | 'warning' | 'error' = 'default';
    if (score >= 80) color = 'success';
    else if (score >= 60) color = 'warning';
    else color = 'default';

    return (
      <Chip
        icon={<InsightsIcon sx={{ fontSize: 16 }} />}
        label={`${Math.round(score)}`}
        color={color}
        size="small"
        variant={color === 'default' ? 'outlined' : 'filled'}
        sx={{ minWidth: 96, justifyContent: 'flex-start' }}
      />
    );
  };

  const toMillis = (input: any): number => {
    if (!input) return -1;
    if (input instanceof Date) return input.getTime();
    if (typeof input === 'number') return input;
    if (typeof input === 'string') {
      const parsed = Date.parse(input);
      return Number.isNaN(parsed) ? -1 : parsed;
    }
    if (typeof input === 'object') {
      if (typeof input.toDate === 'function') return input.toDate().getTime();
      if (typeof input._seconds === 'number') return input._seconds * 1000;
    }
    return -1;
  };

  const handleApplicantsSort = (key: 'interview') => {
    if (applicantsSortBy === key) {
      setApplicantsSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
      setPage(0);
      return;
    }
    setApplicantsSortBy(key);
    setApplicantsSortDirection('desc');
    setPage(0);
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
        <Button
          variant="contained"
          startIcon={<ArrowBack />}
          onClick={handleCancel}
        >
          Back to Jobs Board
        </Button>
      </Box>
    );
  }

  if (!post) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning" sx={{ mb: 2 }}>
          Job post not found
        </Alert>
        <Button
          variant="contained"
          startIcon={<ArrowBack />}
          onClick={handleCancel}
        >
          Back to Jobs Board
        </Button>
      </Box>
    );
  }

  const copyPublicUrlPillSx = {
    textTransform: 'none' as const,
    borderRadius: '999px',
    fontSize: '14px',
    fontWeight: 400,
    color: 'rgba(0, 0, 0, 0.7)',
    bgcolor: 'rgba(0, 0, 0, 0.04)',
    px: 1.5,
    py: 0.75,
    minWidth: 'auto',
    whiteSpace: 'nowrap' as const,
    '&:hover': {
      bgcolor: 'rgba(0, 0, 0, 0.08)',
    },
  };

  const copyPublicUrlButton = (
    <Button
      type="button"
      onClick={handleCopyPublicJobPostingUrl}
      disabled={!publicJobPostingUrl}
      variant="text"
      startIcon={<ContentCopyIcon sx={{ fontSize: 18 }} />}
      sx={copyPublicUrlPillSx}
    >
      {publicUrlCopyHint === 'copied'
        ? 'Copied!'
        : publicUrlCopyHint === 'error'
          ? 'Copy failed'
          : 'Copy public link'}
    </Button>
  );

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {isFromRecruiter ? (
        <PageHeader
          title={
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2.5 }}>
              <Avatar
                sx={{
                  width: 108,
                  height: 108,
                  bgcolor: 'primary.main',
                  fontSize: '40px',
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {(post.postTitle || 'J').trim().charAt(0).toUpperCase()}
              </Avatar>
              <Box sx={{ flex: 1, minWidth: 0, minHeight: 108, display: 'flex', flexDirection: 'column' }}>
                <Typography
                  variant="h6"
                  sx={{
                    fontSize: { xs: '20px', md: '24px' },
                    fontWeight: 600,
                    lineHeight: 1.2,
                  }}
                >
                  {post.postTitle}
                </Typography>
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 0.75,
                    mt: 0.75,
                  }}
                >
                  <Typography
                    component="span"
                    sx={{ fontSize: '0.875rem', color: 'rgba(0,0,0,0.55)', fontWeight: 400 }}
                  >
                    Status:{' '}
                  </Typography>
                  <JobBoardPostStatusChip status={post.status} />
                  <Typography component="span" sx={{ fontSize: '0.875rem', color: 'rgba(0,0,0,0.3)' }}>
                    •
                  </Typography>
                  <Typography
                    component="span"
                    sx={{ fontSize: '0.875rem', color: 'rgba(0,0,0,0.55)', fontWeight: 400 }}
                  >
                    Type: {post.jobType === 'career' ? 'Career' : 'Gig'}
                  </Typography>
                </Box>
                {hasJobBoardSyndicationUrl(post.indeedUrl, post.craigslistUrl) && (
                  <JobBoardSyndicationIconRow
                    indeedUrl={post.indeedUrl}
                    craigslistUrl={post.craigslistUrl}
                    sx={{ mt: 0.5 }}
                  />
                )}
                <Box sx={{ mt: 0.75, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  <Typography sx={{ fontSize: '0.875rem', color: 'rgba(0,0,0,0.55)' }}>
                    {post.companyName || '—'} • {post.worksiteName || '—'}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <LocationOnIcon sx={{ fontSize: 18, color: 'rgba(0,0,0,0.45)', flexShrink: 0 }} />
                    <Typography sx={{ fontSize: '0.875rem', color: 'rgba(0,0,0,0.55)' }}>
                      {formatWorksiteCityStateZip(post.worksiteAddress) || '—'}
                    </Typography>
                  </Box>
                </Box>
              </Box>
            </Box>
          }
          filters={
            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
              {[
                { label: 'Post Details', index: 0 },
                { label: `Applicants (${applicantUsers.length})`, index: 1 },
              ].map((t) => {
                const isActive = activeTab === t.index;
                return (
                  <Button
                    key={t.index}
                    onClick={() => setActiveTab(t.index)}
                    variant="text"
                    sx={{
                      textTransform: 'none',
                      borderRadius: '999px',
                      fontSize: '14px',
                      fontWeight: isActive ? 500 : 400,
                      color: isActive ? 'white' : 'rgba(0, 0, 0, 0.7)',
                      bgcolor: isActive ? '#0057B8' : 'rgba(0, 0, 0, 0.04)',
                      px: 1.5,
                      py: 0.75,
                      minWidth: 'auto',
                      whiteSpace: 'nowrap',
                      '&:hover': {
                        bgcolor: isActive ? '#004a9f' : 'rgba(0, 0, 0, 0.08)',
                      },
                    }}
                  >
                    {t.label}
                  </Button>
                );
              })}
              {copyPublicUrlButton}
            </Box>
          }
          rightActions={
            <Button
              variant="outlined"
              startIcon={<ArrowBack />}
              onClick={handleCancel}
              sx={{
                textTransform: 'none',
                borderRadius: '24px',
                height: '40px',
                px: 2,
                whiteSpace: 'nowrap',
              }}
            >
              Back
            </Button>
          }
        />
      ) : (
        <Box sx={{ mb: 3 }}>
          <Breadcrumbs 
            separator={<NavigateNext fontSize="small" />} 
            aria-label="breadcrumb"
            sx={{
              '& .MuiBreadcrumbs-separator': {
                color: 'text.secondary',
                mx: 1
              }
            }}
          >
            <Typography 
              color="text.secondary" 
              sx={{ 
                fontSize: '0.875rem',
                fontWeight: 500,
                cursor: 'pointer',
                '&:hover': {
                  color: 'primary.main'
                }
              }}
              onClick={() => navigate('/jobs-dashboard')}
            >
              Jobs Board
            </Typography>
            <Typography 
              color="text.primary" 
              sx={{ 
                fontSize: '0.875rem',
                fontWeight: 600
              }}
            >
              {post.postTitle}
            </Typography>
          </Breadcrumbs>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 0.75,
              mt: 1.5,
            }}
          >
            <Typography component="span" variant="body2" color="text.secondary">
              Status:{' '}
            </Typography>
            <JobBoardPostStatusChip status={post.status} />
            <Typography component="span" variant="body2" sx={{ color: 'text.disabled' }}>
              •
            </Typography>
            <Typography component="span" variant="body2" color="text.secondary">
              Type: {post.jobType === 'career' ? 'Career' : 'Gig'}
            </Typography>
          </Box>
        </Box>
      )}

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', pb: 2 }}>
        <Paper elevation={1} sx={{ p: 4, borderRadius: 2 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}
        {!isFromRecruiter && (
          <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <Button
                onClick={() => setActiveTab(0)}
                variant={activeTab === 0 ? 'contained' : 'text'}
                sx={{ textTransform: 'none' }}
              >
                Post Details
              </Button>
              <Button
                onClick={() => setActiveTab(1)}
                variant={activeTab === 1 ? 'contained' : 'text'}
                sx={{ textTransform: 'none' }}
              >
                Applicants ({applicantUsers.length})
              </Button>
              {copyPublicUrlButton}
            </Box>
          </Box>
        )}

        {activeTab === 0 && (
          <JobPostForm
            initialData={post}
            onSave={isFromRecruiter ? handlePersistPost : handleSave}
            onCancel={isFromRecruiter ? undefined : handleCancel}
            loading={isFromRecruiter ? false : saving}
            mode="edit"
            autoSave={isFromRecruiter}
            onHeaderPreviewChange={isFromRecruiter ? handleHeaderPreviewPatch : undefined}
          />
        )}

        {activeTab === 1 && (
          <Box>
            {loadingApplications ? (
              <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
                <CircularProgress />
              </Box>
            ) : applicantUsers.length === 0 ? (
              <Alert severity="info">
                {applications.length === 0
                  ? 'No applicants yet for this job posting.'
                  : 'No registered users found for the applicants. Some applicants may be guest users.'}
              </Alert>
            ) : (
              <>
                {(() => {
                  const sorted = (() => {
                    if (applicantsSortBy !== 'interview') return applicantUsers;
                    const data = [...applicantUsers];
                    data.sort((a: any, b: any) => {
                      const aM = toMillis(a?.scoreSummary?.interviewLastAt);
                      const bM = toMillis(b?.scoreSummary?.interviewLastAt);
                      const diff = aM - bM;
                      return applicantsSortDirection === 'asc' ? diff : -diff;
                    });
                    return data;
                  })();
                  const paginated = sorted.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
                  return (
                    <>
                      <Paper elevation={0} sx={{ borderRadius: 2, overflow: 'hidden', border: '1px solid #EAEEF4' }}>
                        <TableContainer
                          sx={{
                            overflowY: 'auto',
                            overflowX: 'auto',
                            '&::-webkit-scrollbar': { width: '8px', height: '8px' },
                            '&::-webkit-scrollbar-track': { background: 'rgba(0,0,0,0.02)' },
                            '&::-webkit-scrollbar-thumb': { background: 'rgba(0,0,0,0.15)', borderRadius: '4px' },
                            scrollbarWidth: 'thin',
                            scrollbarColor: 'rgba(0, 0, 0, 0.15) rgba(0, 0, 0, 0.02)',
                          }}
                        >
                          <Table size="small" stickyHeader>
                            <TableHead sx={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: '#FFFFFF' }}>
                              <TableRow sx={{ backgroundColor: '#FFFFFF' }}>
                                <TableCell sx={{ width: 60, bgcolor: '#FFFFFF' }} />
                          <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem' }}>
                            Person
                          </TableCell>
                          <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem' }}>
                            Contact
                          </TableCell>
                          <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem' }}>
                            Role
                          </TableCell>
                          <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem' }}>
                            Auth
                          </TableCell>
                          <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem' }}>
                            Documented
                          </TableCell>
                          <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem' }}>
                            Profile Score
                          </TableCell>
                          <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem' }}>
                            <TableSortLabel
                              active={applicantsSortBy === 'interview'}
                              direction={applicantsSortBy === 'interview' ? applicantsSortDirection : 'desc'}
                              onClick={() => handleApplicantsSort('interview')}
                            >
                              Interview
                            </TableSortLabel>
                          </TableCell>
                          <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem' }}>
                            Groups
                          </TableCell>
                          <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem' }}>
                            Skills
                          </TableCell>
                          <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem' }}>
                            Last Login
                          </TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {paginated.map((user, index) => (
                          <TableRow
                            key={user.id}
                            hover
                            sx={{
                              cursor: 'pointer',
                              backgroundColor: index % 2 === 0 ? 'background.paper' : 'action.hover',
                              '&:hover': {
                                backgroundColor: 'action.selected',
                              },
                            }}
                            onClick={() => navigate(`/users/${user.id}`)}
                          >
                            <TableCell onClick={(event) => event.stopPropagation()}>
                              {!['5', '6', '7'].includes(user.securityLevel) && (
                                <FavoriteButton
                                  itemId={user.id}
                                  favoriteType="users"
                                  isFavorite={isFavorite}
                                  toggleFavorite={toggleFavorite}
                                  size="small"
                                  tooltipText={{
                                    favorited: 'Remove from favorites',
                                    notFavorited: 'Add to favorites',
                                  }}
                                />
                              )}
                            </TableCell>
                            <TableCell>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                <Avatar src={user.avatar} alt={`${user.firstName} ${user.lastName}`} sx={{ width: TABLE_AVATAR_SIZE, height: TABLE_AVATAR_SIZE }}>
                                  {user.firstName?.[0]}
                                </Avatar>
                                <Box sx={{ minWidth: 0 }}>
                                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                    {user.firstName} {user.lastName}
                                  </Typography>
                                  {(user.createdAt ||
                                    pickResumeFromUserDoc(user as Record<string, unknown>)) && (
                                    <Box
                                      sx={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        flexWrap: 'nowrap',
                                        gap: '6px',
                                        mt: 0.25,
                                      }}
                                    >
                                      {user.createdAt && (
                                        <Typography
                                          variant="caption"
                                          color="text.secondary"
                                          component="span"
                                          sx={{ lineHeight: 1.2 }}
                                        >
                                          {formatDate(user.createdAt)}
                                        </Typography>
                                      )}
                                      <UserTableResumeIcon user={user as Record<string, unknown>} />
                                    </Box>
                                  )}
                                  <UserTableIndeedFlexBadge user={user as Record<string, unknown>} />
                                  <UserTableFieldglassBadge user={user as Record<string, unknown>} />
                                </Box>
                              </Box>
                            </TableCell>
                            <TableCell>
                              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                  <EmailIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                                  <Typography variant="body2" sx={{ fontSize: '0.85rem' }}>
                                    {user.email}
                                  </Typography>
                                </Box>
                                {user.phone && (
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <PhoneIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                                    <Typography variant="body2" sx={{ fontSize: '0.85rem' }}>
                                      {user.phone}
                                    </Typography>
                                  </Box>
                                )}
                              </Box>
                            </TableCell>
                            <TableCell>
                              <Chip
                                size="small"
                                label={getSecurityLevelLabel(user.securityLevel)}
                                color={getSecurityLevelColor(user.securityLevel)}
                              />
                            </TableCell>
                            <TableCell onClick={(event) => event.stopPropagation()}>
                              <WorkAuthorizedChip status={getWorkAuthorizedStatus(user)} />
                            </TableCell>
                            <TableCell onClick={(event) => event.stopPropagation()}>
                              <EVerifyComfortChip status={getEVerifyComfortStatusFromUserData(user)} />
                            </TableCell>
                            <TableCell>{renderAiScore(user)}</TableCell>
                            <TableCell>
                              <InterviewCell
                                userId={user.id}
                                scoreSummary={user.scoreSummary}
                                formatDate={formatDate}
                              />
                            </TableCell>
                            <TableCell>
                              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                {user.userGroupIds.length === 0 && (
                                  <Typography variant="body2" color="text.secondary">
                                    —
                                  </Typography>
                                )}
                                {user.userGroupIds.slice(0, 3).map((groupId: string) => {
                                  const group = groupLookup.get(groupId);
                                  return (
                                    <Chip
                                      key={groupId}
                                      size="small"
                                      icon={<GroupIcon sx={{ fontSize: 14 }} />}
                                      label={group?.title || groupId}
                                      variant="outlined"
                                    />
                                  );
                                })}
                                {user.userGroupIds.length > 3 && (
                                  <Chip
                                    size="small"
                                    label={`+${user.userGroupIds.length - 3} more`}
                                    variant="outlined"
                                  />
                                )}
                              </Box>
                            </TableCell>
                            <TableCell>
                              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                {user.skills?.slice(0, 3).map((skill, i) => (
                                  <Chip
                                    key={`${toChipLabel(skill)}-${i}`}
                                    label={toChipLabel(skill)}
                                    size="small"
                                    variant="outlined"
                                    icon={<StarIcon sx={{ fontSize: 14 }} />}
                                  />
                                ))}
                                {user.skills?.length === 0 && (
                                  <Typography variant="body2" color="text.secondary">
                                    —
                                  </Typography>
                                )}
                                {user.skills?.length > 3 && (
                                  <Chip size="small" label={`+${user.skills.length - 3}`} variant="outlined" />
                                )}
                              </Box>
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2">{formatDate(user.lastLoginAt)}</Typography>
                            </TableCell>
                          </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      </Paper>
                      <StandardTablePagination
                        count={applicantUsers.length}
                        page={page}
                        onPageChange={(_e, newPage) => setPage(newPage)}
                        rowsPerPage={rowsPerPage}
                        onRowsPerPageChange={(e) => {
                          setRowsPerPage(parseInt(e.target.value, 10));
                          setPage(0);
                        }}
                      />
                    </>
                  );
                })()}
              </>
            )}
          </Box>
        )}
        </Paper>
      </Box>
    </Box>
  );
};

export default EditJobPost;

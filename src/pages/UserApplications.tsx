import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  CircularProgress,
  Alert,
  Button,
  IconButton,
  Tooltip,
  ToggleButtonGroup,
  ToggleButton,
  Stack,
} from '@mui/material';
import ViewListIcon from '@mui/icons-material/ViewList';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import VisibilityIcon from '@mui/icons-material/Visibility';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import { collection, query, where, getDocs, doc, getDoc, updateDoc, serverTimestamp, deleteField } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, useParams } from 'react-router-dom';
import { useT, getLanguage } from '../i18n';
import CardDeck from '../components/worker/cards/CardDeck';
import ApplicationCard from '../components/worker/dashboard/cards/ApplicationCard';
import type { ApplicationCardPayload } from '../components/worker/dashboard/cards/types';
import { emitWorkerCardSignal } from '../utils/workerCardSignals';

interface Application {
  id: string;
  tenantId: string;
  jobId: string;
  jobTitle?: string;
  postTitle?: string;
  companyName?: string;
  location?: string;
  payRate?: number;
  status: string;
  submittedAt: Date;
  /** When present, display as Shift Date (e.g. Mar 22, 5:00 PM) */
  shiftStart?: Date;
}

/** Set of "tenantId_jobPostId" for which the user has a proposed (offer sent) assignment */
type PendingOfferSet = Set<string>;
/** Set of "tenantId_jobPostId" for which the user has accepted (confirmed/hired) assignment */
type HiredOfferSet = Set<string>;

const UserApplications: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { applicationId: routeApplicationId } = useParams<{ applicationId?: string }>();
  const t = useT();
  const [applications, setApplications] = useState<Application[]>([]);
  const [pendingOfferKeys, setPendingOfferKeys] = useState<PendingOfferSet>(new Set());
  const [hiredOfferKeys, setHiredOfferKeys] = useState<HiredOfferSet>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [linkedApplicationMissing, setLinkedApplicationMissing] = useState(false);

  useEffect(() => {
    loadApplications();
  }, [user?.uid, routeApplicationId]);

  const loadApplications = async () => {
    if (!user?.uid) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Get user's applicationIds
      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef);
      
      if (!userSnap.exists()) {
        setApplications([]);
        setLoading(false);
        return;
      }

      const userData = userSnap.data();
      const applicationIds: string[] = Array.isArray(userData?.applicationIds) ? userData.applicationIds : [];

      if (applicationIds.length === 0) {
        setApplications([]);
        setLoading(false);
        return;
      }

      // Load each application from tenants/{tenantId}/applications/{uid}_{jobId}
      const loadedApplications: Application[] = [];

      for (const appId of applicationIds) {
        try {
          const [tenantId, jobId] = appId.split('_');
          if (!tenantId || !jobId) continue;

          const appRef = doc(db, 'tenants', tenantId, 'applications', `${user.uid}_${jobId}`);
          const appSnap = await getDoc(appRef);

          if (appSnap.exists()) {
            const appData = appSnap.data();
            
            // Also fetch job posting details for display
            let jobTitle = '';
            let postTitle = '';
            let companyName = '';
            let location = '';
            let payRate = undefined;
            let shiftStart: Date | undefined;

            // First, try to get cached data from user's applicationData
            const userRef = doc(db, 'users', user.uid);
            const userDoc = await getDoc(userRef);
            if (userDoc.exists()) {
              const userData = userDoc.data();
              const appDataMap = userData.applicationData || {};
              
              // Find this specific application in the map
              for (const [key, value] of Object.entries(appDataMap)) {
                const appData = value as any;
                if (appData.jobId === jobId) {
                  // Use cached data from application
                  location = appData.location || '';
                  companyName = appData.companyName || '';
                  payRate = appData.payRate;
                  jobTitle = appData.jobTitle || '';
                  postTitle = appData.postTitle || '';
                  break;
                }
              }
            }

            // If not found in cache, fetch from job posting
            if (!location || !jobTitle) {
              try {
                const jobRef = doc(db, 'tenants', tenantId, 'job_postings', jobId);
                const jobSnap = await getDoc(jobRef);
                if (jobSnap.exists()) {
                  const jobData = jobSnap.data();
                  jobTitle = jobTitle || jobData.jobTitle || '';
                  postTitle = postTitle || jobData.postTitle || '';
                  companyName = companyName || jobData.companyName || '';
                  payRate = payRate !== undefined ? payRate : jobData.payRate;
                  // Shift date: startDate or first shift start
                  if (jobData.startDate?.toDate) {
                    shiftStart = jobData.startDate.toDate();
                  } else if (jobData.startDate) {
                    shiftStart = new Date(jobData.startDate);
                  } else if (Array.isArray(jobData.shifts) && jobData.shifts[0]?.startTime) {
                    const s = jobData.shifts[0];
                    shiftStart = s.startTime?.toDate ? s.startTime.toDate() : new Date(s.startTime);
                  }
                  // Try multiple location fields
                  if (!location) {
                    if (jobData.city && jobData.state) {
                      location = `${jobData.city}, ${jobData.state}`;
                    } else if (jobData.worksiteAddress?.city && jobData.worksiteAddress?.state) {
                      location = `${jobData.worksiteAddress.city}, ${jobData.worksiteAddress.state}`;
                    } else if (jobData.worksiteName) {
                      location = jobData.worksiteName;
                    }
                  }
                }
              } catch (jobErr) {
                console.warn('Could not load job details for', jobId, jobErr);
              }
            }

            loadedApplications.push({
              id: appSnap.id,
              tenantId,
              jobId,
              jobTitle,
              postTitle: postTitle || jobTitle,
              companyName,
              location,
              payRate,
              status: appData.status || 'submitted',
              submittedAt: appData.submittedAt?.toDate() || new Date(),
              shiftStart,
            });
          }
        } catch (appErr) {
          console.warn('Error loading application', appId, appErr);
        }
      }

      // Sort by submitted date (newest first)
      loadedApplications.sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());

      setApplications(loadedApplications);
      if (routeApplicationId) {
        setLinkedApplicationMissing(!loadedApplications.some((app) => app.id === routeApplicationId));
      } else {
        setLinkedApplicationMissing(false);
      }

      // Load proposed assignments (offer sent) → "Accept offer"; confirmed/active (accepted) → "You've been hired"
      const tenantIds = [...new Set(loadedApplications.map((a) => a.tenantId))];
      const pendingKeys = new Set<string>();
      const hiredKeys = new Set<string>();
      for (const tenantId of tenantIds) {
        try {
          const assignmentsRef = collection(db, 'tenants', tenantId, 'assignments');
          const proposedQ = query(
            assignmentsRef,
            where('userId', '==', user.uid),
            where('status', '==', 'proposed')
          );
          const proposedSnap = await getDocs(proposedQ);
          proposedSnap.docs.forEach((d) => {
            const data = d.data();
            const jobPostId = data.jobPostId || data.jobId;
            if (jobPostId) pendingKeys.add(`${tenantId}_${jobPostId}`);
          });
          const confirmedQ = query(
            assignmentsRef,
            where('userId', '==', user.uid),
            where('status', 'in', ['confirmed', 'active'])
          );
          const confirmedSnap = await getDocs(confirmedQ);
          confirmedSnap.docs.forEach((d) => {
            const data = d.data();
            const jobPostId = data.jobPostId || data.jobId;
            if (jobPostId) hiredKeys.add(`${tenantId}_${jobPostId}`);
          });
        } catch (_) {
          // ignore
        }
      }
      setPendingOfferKeys(pendingKeys);
      setHiredOfferKeys(hiredKeys);
    } catch (err: any) {
      console.error('Error loading applications:', err);
      setError(err.message || 'Failed to load applications');
    } finally {
      setLoading(false);
    }
  };

  const getStatusLabel = (app: Application): string => {
    const key = `${app.tenantId}_${app.jobId}`;
    const status = app.status.toLowerCase();
    if (hiredOfferKeys.has(key)) return t('applications.statusHired');
    if (status === 'withdrawn') return t('applications.statusWithdrawn');
    if (status === 'rejected' || status === 'declined') return t('applications.statusDeclined');
    if (status === 'expired' || status === 'cancelled') return t('applications.statusExpired');
    if (status === 'submitted' && pendingOfferKeys.has(key)) return t('applications.statusUnderReview');
    if (status === 'submitted') return t('applications.statusApplied');
    if (status === 'reviewed' || status === 'pending') return t('applications.statusUnderReview');
    if (status === 'accepted' || status === 'confirmed' || status === 'hired') return t('applications.statusHired');
    return t('applications.statusApplied');
  };

  const canWithdraw = (app: Application): boolean => {
    const label = getStatusLabel(app);
    return label === t('applications.statusApplied') || label === t('applications.statusUnderReview');
  };

  const handleWithdraw = async (e: React.MouseEvent, app: Application) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to withdraw your application?')) return;
    try {
      const appRef = doc(db, 'tenants', app.tenantId, 'applications', app.id);
      await updateDoc(appRef, {
        status: 'withdrawn',
        withdrawnAt: new Date(),
        withdrawnBy: user?.uid || null,
        applyDate: deleteField(),
        applyDates: deleteField(),
        updatedAt: serverTimestamp(),
      });
      await loadApplications();
    } catch (err) {
      console.error('Failed to withdraw application:', err);
      alert('We were unable to withdraw your application. Please try again.');
    }
  };

  const getStatusColor = (app: Application): 'default' | 'primary' | 'success' | 'error' | 'warning' => {
    const key = `${app.tenantId}_${app.jobId}`;
    if (hiredOfferKeys.has(key)) return 'success';
    if (app.status.toLowerCase() === 'submitted' && pendingOfferKeys.has(key)) return 'warning';
    switch (app.status.toLowerCase()) {
      case 'submitted':
        return 'primary';
      case 'reviewed':
        return 'default';
      case 'accepted':
      case 'hired':
      case 'confirmed':
        return 'success';
      case 'rejected':
        return 'error';
      case 'pending':
        return 'warning';
      default:
        return 'default';
    }
  };

  const locale = getLanguage() === 'es' ? 'es' : 'en-US';
  const formatDate = (date: Date): string => {
    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  };
  const formatShiftDate = (date: Date): string => {
    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  };

  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
  const [deckIndex, setDeckIndex] = useState(0);

  const applicationPayloads: ApplicationCardPayload[] = applications.map((app) => {
    const statusLabel = getStatusLabel(app);
    const appliedDateOrStatus = app.shiftStart
      ? formatShiftDate(app.shiftStart)
      : formatDate(app.submittedAt);
    const key = `${app.tenantId}_${app.jobId}`;
    const needsResponse = pendingOfferKeys.has(key);
    return {
      type: 'application',
      id: app.id,
      label: t('dashboard.cardLabelApplicationUpdate'),
      jobTitle: app.postTitle || app.jobTitle || t('applications.untitledJob'),
      company: app.companyName,
      location: app.location,
      pay: app.payRate,
      appliedDateOrStatus: `${statusLabel} · ${appliedDateOrStatus}`,
      viewJobTo: `/c1/jobs-board/${app.jobId}`,
      viewApplicationsTo: '/c1/workers/applications',
      needsResponse,
    };
  });

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
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  return (
    <Box>
      {linkedApplicationMissing && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          This item is unavailable. You can review your other applications below.
        </Alert>
      )}
      <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2} sx={{ mb: 2 }}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
          {t('applications.title')}
        </Typography>
        {applications.length > 0 && (
          <ToggleButtonGroup
            value={viewMode}
            exclusive
            onChange={(_, v) => { if (v != null) setViewMode(v); setDeckIndex(0); }}
            size="small"
            aria-label={t('applications.viewMode')}
          >
            <ToggleButton value="table" aria-label={t('applications.viewTable')}>
              <ViewListIcon sx={{ mr: 0.5 }} /> {t('applications.viewTable')}
            </ToggleButton>
            <ToggleButton value="cards" aria-label={t('applications.viewCards')}>
              <ViewModuleIcon sx={{ mr: 0.5 }} /> {t('applications.viewCards')}
            </ToggleButton>
          </ToggleButtonGroup>
        )}
      </Stack>
      {applications.length === 0 ? (
        <Box sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
            {t('applications.emptyMessage')}
          </Typography>
          <Button variant="contained" color="primary" onClick={() => navigate('/c1/jobs-board')}>
            {t('applications.browseJobs')}
          </Button>
        </Box>
      ) : viewMode === 'cards' ? (
        <CardDeck
          totalCards={applicationPayloads.length}
          activeIndex={deckIndex}
          onIndexChange={setDeckIndex}
          onExpand={() => {
            const app = applications[deckIndex];
            if (app) {
              emitWorkerCardSignal({ type: 'application_viewed', entityId: app.jobId });
              navigate(`/c1/jobs-board/${app.jobId}`);
            }
          }}
          showSectionProgress={false}
          expandDisabled={applicationPayloads.length === 0}
          ariaLabel={t('applications.title')}
        >
          {applicationPayloads[deckIndex] && (
            <ApplicationCard
              payload={applicationPayloads[deckIndex]}
              onTap={() => {
                const app = applications[deckIndex];
                if (app) {
                  emitWorkerCardSignal({ type: 'application_viewed', entityId: app.jobId });
                  navigate(`/c1/jobs-board/${app.jobId}`);
                }
              }}
            />
          )}
        </CardDeck>
      ) : (
        <TableContainer 
          component={Paper} 
          elevation={0} 
          sx={{ borderRadius: 0, overflowX: 'auto' }}
        >
          <Table>
            <TableHead>
              <TableRow sx={{ backgroundColor: 'grey.100' }}>
                <TableCell sx={{ fontWeight: 600 }}>{t('applications.jobTitle')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('applications.company')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('applications.location')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('applications.shiftDate')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('applications.payRate')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('applications.dateApplied')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('applications.status')}</TableCell>
                <TableCell sx={{ fontWeight: 600, width: 140 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {applications.map((app) => (
                <TableRow 
                  key={app.id}
                  hover
                  onMouseEnter={() => setHoveredRowId(app.id)}
                  onMouseLeave={() => setHoveredRowId(null)}
                  sx={{ 
                    cursor: 'pointer',
                    '&:hover': { backgroundColor: 'action.hover' },
                  }}
                  onClick={() => navigate(`/c1/jobs-board/${app.jobId}`)}
                >
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {app.postTitle || app.jobTitle || t('applications.untitledJob')}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {app.companyName || t('applications.na')}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {app.location || t('applications.na')}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {app.shiftStart ? formatShiftDate(app.shiftStart) : t('applications.na')}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {app.payRate ? `$${app.payRate}/hr` : t('applications.na')}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {formatDate(app.submittedAt)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip 
                      label={getStatusLabel(app)} 
                      color={getStatusColor(app)}
                      size="small"
                      sx={
                        getStatusLabel(app) === t('applications.statusHired')
                          ? { fontWeight: 600 }
                          : getStatusLabel(app) === t('applications.statusUnderReview') || getStatusLabel(app) === t('applications.statusApplied')
                            ? { backgroundColor: '#FFC700', color: '#000', fontWeight: 600 }
                            : undefined
                      }
                    />
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()} sx={{ py: 0.5 }}>
                    <Box
                      sx={{
                        opacity: hoveredRowId === app.id ? 1 : 0,
                        transition: 'opacity 0.15s',
                        display: 'flex',
                        alignItems: 'center',
                                        gap: 0.5,
                      }}
                    >
                      <Tooltip title={t('applications.viewJob')}>
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/c1/jobs-board/${app.jobId}`);
                          }}
                          color="primary"
                        >
                          <VisibilityIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      {canWithdraw(app) && (
                        <Tooltip title={t('applications.withdrawApplication')}>
                          <IconButton
                            size="small"
                            onClick={(e) => handleWithdraw(e, app)}
                            color="error"
                          >
                            <CancelOutlinedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
};

export default UserApplications;

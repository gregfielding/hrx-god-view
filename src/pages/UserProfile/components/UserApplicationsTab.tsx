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
  Alert
} from '@mui/material';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { formatHourlyPayRateForDisplay } from '../../../utils/hourlyPayDisplay';
import { getApplicationShiftIds } from '../../../utils/gigShiftState';
import { getShiftTimeRangeLabel } from '../../../utils/shiftPickerLabel';

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
  /** From linked job order / posting: gig | career */
  jobTypeLabel?: string;
  /** Gig only: formatted shift time ranges from applied shift docs */
  shiftTimesSummary?: string;
}

interface UserApplicationsTabProps {
  userId: string;
}

const UserApplicationsTab: React.FC<UserApplicationsTabProps> = ({ userId }) => {
  const { tenantId } = useAuth();
  const navigate = useNavigate();
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadApplications();
  }, [userId, tenantId]);

  const loadApplications = async () => {
    if (!userId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Get user's applicationIds
      const userRef = doc(db, 'users', userId);
      const userSnap = await getDoc(userRef);
      
      if (!userSnap.exists()) {
        setApplications([]);
        setLoading(false);
        return;
      }

      const userData = userSnap.data();
      const applicationIds: string[] = Array.isArray(userData?.applicationIds) ? userData.applicationIds : [];

      console.log('User applicationIds:', applicationIds);

      if (applicationIds.length === 0) {
        console.log('No applicationIds found for user');
        setApplications([]);
        setLoading(false);
        return;
      }

      // Load each application from tenants/{tenantId}/applications/{uid}_{jobId}
      const loadedApplications: Application[] = [];

      for (const appId of applicationIds) {
        try {
          const [appTenantId, jobId] = appId.split('_');
          if (!appTenantId || !jobId) {
            console.warn('Invalid appId format:', appId);
            continue;
          }

          console.log('Attempting to fetch application:', `tenants/${appTenantId}/applications/${userId}_${jobId}`);
          const appRef = doc(db, 'tenants', appTenantId, 'applications', `${userId}_${jobId}`);
          const appSnap = await getDoc(appRef);

          if (appSnap.exists()) {
            console.log('Application data loaded successfully for:', appId);
            const appData = appSnap.data();

            let jobTitle = '';
            let postTitle = '';
            let companyName = '';
            let location = '';
            let payRate: number | undefined = undefined;

            const userRef = doc(db, 'users', userId);
            const userDoc = await getDoc(userRef);
            if (userDoc.exists()) {
              const userData = userDoc.data();
              const appDataMap = userData.applicationData || {};
              for (const [, value] of Object.entries(appDataMap)) {
                const cached = value as Record<string, unknown>;
                if (cached.jobId === jobId) {
                  location = String(cached.location || '');
                  companyName = String(cached.companyName || '');
                  payRate = cached.payRate as number | undefined;
                  jobTitle = String(cached.jobTitle || '');
                  postTitle = String(cached.postTitle || '');
                  break;
                }
              }
            }

            let postingData: Record<string, unknown> | null = null;
            try {
              const postingRef = doc(db, 'tenants', appTenantId, 'job_postings', jobId);
              const postingSnap = await getDoc(postingRef);
              if (postingSnap.exists()) {
                postingData = postingSnap.data() as Record<string, unknown>;
                const jd = postingData;
                jobTitle = jobTitle || String(jd.jobTitle || '');
                postTitle = postTitle || String(jd.postTitle || '');
                companyName = companyName || String(jd.companyName || '');
                if (payRate === undefined && jd.payRate != null) payRate = Number(jd.payRate);
                if (!location) {
                  if (jd.city && jd.state) {
                    location = `${jd.city}, ${jd.state}`;
                  } else if (
                    (jd.worksiteAddress as { city?: string; state?: string } | undefined)?.city &&
                    (jd.worksiteAddress as { city?: string; state?: string }).state
                  ) {
                    const wa = jd.worksiteAddress as { city: string; state: string };
                    location = `${wa.city}, ${wa.state}`;
                  } else if (jd.worksiteName) {
                    location = String(jd.worksiteName);
                  }
                }
              }
            } catch (jobErr) {
              console.warn('Could not load job posting for', jobId, jobErr);
            }

            const jobOrderId =
              (typeof appData.jobOrderId === 'string' && appData.jobOrderId.trim()) ||
              (postingData && typeof postingData.jobOrderId === 'string' && String(postingData.jobOrderId).trim()) ||
              '';

            let jobTypeRaw = '';
            if (jobOrderId) {
              try {
                const joSnap = await getDoc(doc(db, 'tenants', appTenantId, 'job_orders', jobOrderId));
                if (joSnap.exists()) {
                  jobTypeRaw = String(joSnap.data()?.jobType || '').toLowerCase();
                }
              } catch {
                /* ignore */
              }
            }
            if (!jobTypeRaw && postingData) {
              jobTypeRaw = String(postingData.jobType || '').toLowerCase();
            }
            const jobTypeLabel =
              jobTypeRaw === 'gig'
                ? 'Gig'
                : jobTypeRaw === 'career'
                  ? 'Career'
                  : jobTypeRaw
                    ? jobTypeRaw.charAt(0).toUpperCase() + jobTypeRaw.slice(1)
                    : '—';

            let shiftTimesSummary = '—';
            if (jobTypeRaw === 'gig' && jobOrderId) {
              const shiftIds = getApplicationShiftIds(appData);
              const ranges: string[] = [];
              for (const sid of shiftIds.slice(0, 12)) {
                try {
                  const shSnap = await getDoc(
                    doc(db, 'tenants', appTenantId, 'job_orders', jobOrderId, 'shifts', sid),
                  );
                  if (shSnap.exists()) {
                    const r = getShiftTimeRangeLabel(shSnap.data() as Record<string, unknown>);
                    if (r) ranges.push(r);
                  }
                } catch {
                  /* ignore */
                }
              }
              shiftTimesSummary = ranges.length > 0 ? ranges.join(' · ') : '—';
            }

            loadedApplications.push({
              id: appSnap.id,
              tenantId: appTenantId,
              jobId,
              jobTitle,
              postTitle: postTitle || jobTitle,
              companyName,
              location,
              payRate,
              status: (appData.status as string) || 'submitted',
              submittedAt: (appData.submittedAt as { toDate?: () => Date } | undefined)?.toDate?.() || new Date(),
              jobTypeLabel,
              shiftTimesSummary,
            });
          } else {
            console.warn('Application document does not exist:', `tenants/${appTenantId}/applications/${userId}_${jobId}`);
          }
        } catch (appErr: any) {
          console.error('Error loading application', appId, appErr);
          console.error('Error code:', appErr?.code);
          console.error('Error message:', appErr?.message);
        }
      }

      // Sort by submitted date (newest first)
      loadedApplications.sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());

      setApplications(loadedApplications);
    } catch (err: any) {
      console.error('Error loading applications:', err);
      setError(err.message || 'Failed to load applications');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string): 'default' | 'primary' | 'success' | 'error' | 'warning' => {
    switch (status.toLowerCase()) {
      case 'submitted':
        return 'primary';
      case 'reviewed':
        return 'default';
      case 'accepted':
      case 'hired':
      case 'confirmed':
        return 'success';
      case 'rejected':
      case 'withdrawn':
        return 'error';
      case 'pending':
        return 'warning';
      default:
        return 'default';
    }
  };

  const formatDate = (date: Date): string => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
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
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  return (
    <Box>
      {applications.length === 0 ? (
        <Box sx={{ p: 3 }}>
          <Alert severity="info">
            This user hasn&apos;t applied to any jobs yet.
          </Alert>
        </Box>
      ) : (
        <TableContainer component={Paper} elevation={0} sx={{ borderRadius: 0 }}>
          <Table>
            <TableHead>
              <TableRow sx={{ backgroundColor: 'grey.100' }}>
                <TableCell sx={{ fontWeight: 600 }}>Job Title</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Location</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Pay Rate</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Gig or career</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Shift times</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Date Applied</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {applications.map((app) => (
                <TableRow 
                  key={app.id}
                  hover
                  sx={{ 
                    cursor: 'pointer',
                    '&:hover': {
                      backgroundColor: 'action.hover'
                    }
                  }}
                  onClick={() => {
                    // Navigate to recruiter backend job board posting
                    navigate(`/jobs/jobs-board/edit/${app.jobId}`);
                  }}
                >
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {app.postTitle || app.jobTitle || 'Untitled Job'}
                    </Typography>
                    {app.companyName && (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {app.companyName}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {app.location || 'N/A'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {formatHourlyPayRateForDisplay(app.payRate) ?? 'N/A'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {app.jobTypeLabel ?? '—'}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ maxWidth: 220 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'normal' }}>
                      {app.shiftTimesSummary ?? '—'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {formatDate(app.submittedAt)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip 
                      label={app.status.charAt(0).toUpperCase() + app.status.slice(1)} 
                      color={app.status.toLowerCase() === 'submitted' ? undefined : getStatusColor(app.status)}
                      size="small"
                      sx={app.status.toLowerCase() === 'submitted' ? {
                        backgroundColor: '#FFC700',
                        color: '#000',
                        fontWeight: 600
                      } : undefined}
                    />
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

export default UserApplicationsTab;


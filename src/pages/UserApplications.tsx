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
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

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
}

/** Set of "tenantId_jobPostId" for which the user has a proposed (offer sent) assignment */
type PendingOfferSet = Set<string>;
/** Set of "tenantId_jobPostId" for which the user has accepted (confirmed/hired) assignment */
type HiredOfferSet = Set<string>;

const UserApplications: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [applications, setApplications] = useState<Application[]>([]);
  const [pendingOfferKeys, setPendingOfferKeys] = useState<PendingOfferSet>(new Set());
  const [hiredOfferKeys, setHiredOfferKeys] = useState<HiredOfferSet>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadApplications();
  }, [user?.uid]);

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
            });
          }
        } catch (appErr) {
          console.warn('Error loading application', appId, appErr);
        }
      }

      // Sort by submitted date (newest first)
      loadedApplications.sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());

      setApplications(loadedApplications);

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
    if (hiredOfferKeys.has(key)) return "You've been hired";
    if (app.status.toLowerCase() === 'submitted' && pendingOfferKeys.has(key)) return 'Accept offer';
    return app.status.charAt(0).toUpperCase() + app.status.slice(1);
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
            You haven't applied to any jobs yet. Visit the Jobs Board to find opportunities!
          </Alert>
        </Box>
      ) : (
        <TableContainer 
          component={Paper} 
          elevation={0} 
          sx={{ borderRadius: 0, overflowX: 'auto' }}
        >
          <Table>
            <TableHead>
              <TableRow sx={{ backgroundColor: 'grey.100' }}>
                <TableCell sx={{ fontWeight: 600 }}>Job Title</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Location</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Pay Rate</TableCell>
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
                    // Navigate to job posting under worker layout (/c1/jobs-board/:postId)
                    navigate(`/c1/jobs-board/${app.jobId}`);
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
                      {app.payRate ? `$${app.payRate}/hr` : 'N/A'}
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
                        getStatusLabel(app) === "You've been hired"
                          ? { fontWeight: 600 }
                          : getStatusLabel(app) === 'Accept offer' || app.status.toLowerCase() === 'submitted'
                            ? { backgroundColor: '#FFC700', color: '#000', fontWeight: 600 }
                            : undefined
                      }
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

export default UserApplications;

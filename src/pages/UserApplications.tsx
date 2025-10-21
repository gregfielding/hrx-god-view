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

const UserApplications: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [applications, setApplications] = useState<Application[]>([]);
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

            try {
              const jobRef = doc(db, 'tenants', tenantId, 'job_postings', jobId);
              const jobSnap = await getDoc(jobRef);
              if (jobSnap.exists()) {
                const jobData = jobSnap.data();
                jobTitle = jobData.jobTitle || '';
                postTitle = jobData.postTitle || '';
                companyName = jobData.companyName || '';
                payRate = jobData.payRate;
                
                if (jobData.city && jobData.state) {
                  location = `${jobData.city}, ${jobData.state}`;
                } else if (jobData.worksiteAddress?.city && jobData.worksiteAddress?.state) {
                  location = `${jobData.worksiteAddress.city}, ${jobData.worksiteAddress.state}`;
                }
              }
            } catch (jobErr) {
              console.warn('Could not load job details for', jobId, jobErr);
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
        <TableContainer component={Paper} elevation={0} sx={{ borderRadius: 0 }}>
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
                    // Navigate back to jobs board (could be updated to show job details modal)
                    navigate(`/c1/jobs-board`);
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
                      label={app.status.charAt(0).toUpperCase() + app.status.slice(1)} 
                      color={getStatusColor(app.status)}
                      size="small"
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

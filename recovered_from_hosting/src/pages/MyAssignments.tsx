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
import { collection, query, where, getDocs, doc, getDoc, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

interface Assignment {
  id: string;
  tenantId: string;
  jobOrderId?: string;
  jobTitle?: string;
  companyName?: string;
  location?: string;
  payRate?: number;
  startDate?: Date;
  endDate?: Date;
  status: string;
  jobPostId?: string; // For confirmed applications - link to job posting
}

const MyAssignments: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAssignments();
  }, [user?.uid]);

  const loadAssignments = async () => {
    if (!user?.uid) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const loadedAssignments: Assignment[] = [];

      // Method 1: Load from legacy assignments collection
      const assignmentsRef = collection(db, 'assignments');
      const q = query(
        assignmentsRef,
        where('userId', '==', user.uid),
        orderBy('startDate', 'desc')
      );
      
      const snapshot = await getDocs(q);

      for (const docSnap of snapshot.docs) {
        const data = docSnap.data();
        
        // Parse dates
        let startDate: Date | undefined;
        let endDate: Date | undefined;
        
        if (data.startDate) {
          startDate = data.startDate.toDate ? data.startDate.toDate() : new Date(data.startDate);
        }
        if (data.endDate) {
          endDate = data.endDate.toDate ? data.endDate.toDate() : new Date(data.endDate);
        }

        // Get job order details if jobOrderId exists
        let jobTitle = data.jobTitle || '';
        let companyName = data.companyName || '';
        let location = data.location || data.worksiteName || '';
        
        if (data.jobOrderId && data.tenantId) {
          try {
            const jobOrderRef = doc(db, 'tenants', data.tenantId, 'job_orders', data.jobOrderId);
            const jobOrderSnap = await getDoc(jobOrderRef);
            
            if (jobOrderSnap.exists()) {
              const jobOrderData = jobOrderSnap.data();
              jobTitle = jobTitle || jobOrderData.jobOrderName || jobOrderData.jobTitle || '';
              companyName = companyName || jobOrderData.companyName || '';
              
              // Get location from worksite
              if (!location && jobOrderData.worksiteName) {
                location = jobOrderData.worksiteName;
              } else if (!location && jobOrderData.worksiteAddress) {
                const addr = jobOrderData.worksiteAddress;
                if (addr.city && addr.state) {
                  location = `${addr.city}, ${addr.state}`;
                }
              }
            }
          } catch (jobOrderErr) {
            console.warn('Could not load job order details:', jobOrderErr);
          }
        }

        loadedAssignments.push({
          id: docSnap.id,
          tenantId: data.tenantId || '',
          jobOrderId: data.jobOrderId,
          jobTitle,
          companyName,
          location,
          payRate: data.payRate,
          startDate,
          endDate,
          status: data.status || 'pending',
        });
      }

      // Method 2: Load confirmed applications and convert to assignments
      // We need to check all tenants the user might belong to
      // For now, we'll check common tenant IDs or get from user's tenantIds
      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef);
      
      if (userSnap.exists()) {
        const userData = userSnap.data();
        const tenantIds: string[] = [];
        
        // Get tenant IDs from user's tenantIds object
        if (userData.tenantIds && typeof userData.tenantIds === 'object') {
          tenantIds.push(...Object.keys(userData.tenantIds));
        }
        
        // Also check common tenant slugs (c1, etc.)
        if (!tenantIds.includes('c1')) {
          tenantIds.push('c1');
        }
        
        // Query applications with status 'confirmed' for each tenant
        for (const tenantId of tenantIds) {
          try {
            const applicationsRef = collection(db, 'tenants', tenantId, 'applications');
            const confirmedQuery = query(
              applicationsRef,
              where('userId', '==', user.uid),
              where('status', '==', 'confirmed')
            );
            
            const confirmedSnapshot = await getDocs(confirmedQuery);
            
            for (const appDoc of confirmedSnapshot.docs) {
              const appData = appDoc.data();
              
              // Skip if we already have this as an assignment (check by jobOrderId)
              if (appData.jobOrderId && loadedAssignments.some(a => a.jobOrderId === appData.jobOrderId)) {
                continue;
              }
              
              // Get job order details
              let jobTitle = '';
              let companyName = '';
              let location = '';
              let payRate: number | undefined;
              let startDate: Date | undefined;
              let endDate: Date | undefined;
              let jobPostId: string | undefined;
              
              if (appData.jobOrderId) {
                try {
                  const jobOrderRef = doc(db, 'tenants', tenantId, 'job_orders', appData.jobOrderId);
                  const jobOrderSnap = await getDoc(jobOrderRef);
                  
                  if (jobOrderSnap.exists()) {
                    const jobOrderData = jobOrderSnap.data();
                    jobTitle = jobOrderData.jobOrderName || jobOrderData.jobTitle || '';
                    companyName = jobOrderData.companyName || '';
                    payRate = jobOrderData.payRate;
                    
                    if (jobOrderData.startDate) {
                      startDate = jobOrderData.startDate.toDate ? jobOrderData.startDate.toDate() : new Date(jobOrderData.startDate);
                    }
                    if (jobOrderData.endDate) {
                      endDate = jobOrderData.endDate.toDate ? jobOrderData.endDate.toDate() : new Date(jobOrderData.endDate);
                    }
                    
                    // Get location from worksite
                    if (jobOrderData.worksiteName) {
                      location = jobOrderData.worksiteName;
                    } else if (jobOrderData.worksiteAddress) {
                      const addr = jobOrderData.worksiteAddress;
                      if (addr.city && addr.state) {
                        location = `${addr.city}, ${addr.state}`;
                      }
                    }
                  }
                  
                  // Find the job posting ID for this job order
                  const jobPostingsRef = collection(db, 'tenants', tenantId, 'job_postings');
                  const jobPostingsQuery = query(
                    jobPostingsRef,
                    where('jobOrderId', '==', appData.jobOrderId),
                    where('status', '==', 'active')
                  );
                  const jobPostingsSnapshot = await getDocs(jobPostingsQuery);
                  if (!jobPostingsSnapshot.empty) {
                    jobPostId = jobPostingsSnapshot.docs[0].id;
                  }
                } catch (jobOrderErr) {
                  console.warn('Could not load job order details for confirmed application:', jobOrderErr);
                }
              }
              
              // Use application ID as assignment ID (or create a virtual one)
              loadedAssignments.push({
                id: `app_${appDoc.id}`, // Prefix to distinguish from regular assignments
                tenantId: tenantId,
                jobOrderId: appData.jobOrderId,
                jobTitle: jobTitle || appData.jobTitle || 'Assignment',
                companyName,
                location,
                payRate,
                startDate,
                endDate,
                status: 'confirmed',
                jobPostId, // Store job posting ID for navigation
              });
            }
          } catch (err) {
            console.warn(`Error loading confirmed applications for tenant ${tenantId}:`, err);
          }
        }
      }

      // Sort by start date (newest first)
      loadedAssignments.sort((a, b) => {
        if (!a.startDate && !b.startDate) return 0;
        if (!a.startDate) return 1;
        if (!b.startDate) return -1;
        return b.startDate.getTime() - a.startDate.getTime();
      });

      setAssignments(loadedAssignments);
      
    } catch (err: any) {
      console.error('Error loading assignments:', err);
      setError(err.message || 'Failed to load assignments');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string): 'default' | 'primary' | 'success' | 'error' | 'warning' => {
    switch (status.toLowerCase()) {
      case 'active':
        return 'success';
      case 'completed':
        return 'default';
      case 'pending':
        return 'warning';
      case 'cancelled':
        return 'error';
      default:
        return 'default';
    }
  };

  const formatDate = (date: Date): string => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
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
      {assignments.length === 0 ? (
        <Box sx={{ p: 3 }}>
          <Alert severity="info">
            You don't have any active assignments yet. Check back soon!
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
                <TableCell sx={{ fontWeight: 600 }}>Start Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>End Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {assignments.map((assignment) => (
                <TableRow 
                  key={assignment.id}
                  hover
                  sx={{ 
                    cursor: 'pointer',
                    '&:hover': {
                      backgroundColor: 'action.hover'
                    }
                  }}
                  onClick={() => {
                    // Navigate to assignment details
                    const tenantSlug = assignment.tenantId || 'c1';
                    navigate(`/${tenantSlug}/assignments/${assignment.id}`);
                  }}
                >
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {assignment.jobTitle || 'Untitled Assignment'}
                    </Typography>
                    {assignment.companyName && (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {assignment.companyName}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {assignment.location || 'N/A'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {assignment.payRate ? `$${assignment.payRate}/hr` : 'N/A'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {assignment.startDate ? formatDate(assignment.startDate) : 'N/A'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {assignment.endDate ? formatDate(assignment.endDate) : 'Ongoing'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip 
                      label={assignment.status.charAt(0).toUpperCase() + assignment.status.slice(1)} 
                      color={getStatusColor(assignment.status)}
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

export default MyAssignments;


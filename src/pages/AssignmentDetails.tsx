import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
  Pending as PendingIcon,
} from '@mui/icons-material';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { format } from 'date-fns';

interface AssignmentDetails {
  id: string;
  tenantId: string;
  jobOrderId?: string;
  jobTitle?: string;
  companyName?: string;
  location?: string;
  worksiteName?: string;
  worksiteAddress?: {
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  };
  payRate?: number;
  startDate?: Date;
  endDate?: Date;
  status: string;
  hoursWorked?: number;
  totalEarnings?: number;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const AssignmentDetails: React.FC = () => {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [assignment, setAssignment] = useState<AssignmentDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!assignmentId || !user?.uid) return;
    loadAssignment();
  }, [assignmentId, user?.uid]);

  const loadAssignment = async () => {
    if (!assignmentId || !user?.uid) return;

    try {
      setLoading(true);
      setError('');

      // Try legacy structure first (assignments collection with userId)
      const assignmentRef = doc(db, 'assignments', assignmentId);
      const assignmentSnap = await getDoc(assignmentRef);

      if (!assignmentSnap.exists()) {
        // Try Phase 2 structure: tenants/{tenantId}/job_orders/{jobOrderId}/assignments/{assignmentId}
        // We need to search across tenants - this is less efficient but necessary
        // For now, we'll try common tenant IDs or search user's applications to find tenantId
        
        // First, try to get tenantId from user's applications
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
          const userData = userSnap.data();
          const applicationIds: string[] = Array.isArray(userData?.applicationIds) ? userData.applicationIds : [];
          
          // Try to find tenantId from applications
          for (const appId of applicationIds) {
            const [tenantId] = appId.split('_');
            if (tenantId) {
              // Try to find assignment in this tenant's job orders
              // This is a simplified approach - in production you might want to store assignment references
              // For now, we'll show an error if not found in legacy structure
              break;
            }
          }
        }
        
        setError('Assignment not found');
        setLoading(false);
        return;
      }

      const data = assignmentSnap.data();
      
      // Verify this assignment belongs to the current user
      if (data.userId !== user.uid) {
        setError('You do not have permission to view this assignment');
        setLoading(false);
        return;
      }

      // Parse dates
      let startDate: Date | undefined;
      let endDate: Date | undefined;
      let createdAt: Date | undefined;
      let updatedAt: Date | undefined;

      if (data.startDate) {
        startDate = data.startDate.toDate ? data.startDate.toDate() : new Date(data.startDate);
      }
      if (data.endDate) {
        endDate = data.endDate.toDate ? data.endDate.toDate() : new Date(data.endDate);
      }
      if (data.createdAt) {
        createdAt = data.createdAt.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
      }
      if (data.updatedAt) {
        updatedAt = data.updatedAt.toDate ? data.updatedAt.toDate() : new Date(data.updatedAt);
      }

      // Get job order details if jobOrderId exists
      let jobTitle = data.jobTitle || '';
      let companyName = data.companyName || '';
      let location = data.location || data.worksiteName || '';
      let worksiteName = data.worksiteName || '';
      let worksiteAddress = data.worksiteAddress || data.address;

      if (data.jobOrderId && data.tenantId) {
        try {
          const jobOrderRef = doc(db, 'tenants', data.tenantId, 'job_orders', data.jobOrderId);
          const jobOrderSnap = await getDoc(jobOrderRef);

          if (jobOrderSnap.exists()) {
            const jobOrderData = jobOrderSnap.data();
            jobTitle = jobTitle || jobOrderData.jobOrderName || jobOrderData.jobTitle || '';
            companyName = companyName || jobOrderData.companyName || '';
            worksiteName = worksiteName || jobOrderData.worksiteName || '';

            // Get location from worksite
            if (!location && jobOrderData.worksiteName) {
              location = jobOrderData.worksiteName;
            } else if (!location && jobOrderData.worksiteAddress) {
              const addr = jobOrderData.worksiteAddress;
              if (addr.city && addr.state) {
                location = `${addr.city}, ${addr.state}`;
              }
            }

            // Get worksite address
            if (!worksiteAddress && jobOrderData.worksiteAddress) {
              worksiteAddress = jobOrderData.worksiteAddress;
            }
          }
        } catch (jobOrderErr) {
          console.warn('Could not load job order details:', jobOrderErr);
        }
      }

      setAssignment({
        id: assignmentSnap.id,
        tenantId: data.tenantId || '',
        jobOrderId: data.jobOrderId,
        jobTitle,
        companyName,
        location,
        worksiteName,
        worksiteAddress,
        payRate: data.payRate,
        startDate,
        endDate,
        status: data.status || 'pending',
        hoursWorked: data.hoursWorked,
        totalEarnings: data.totalEarnings,
        notes: data.notes,
        createdAt,
        updatedAt,
      });
    } catch (err: any) {
      console.error('Error loading assignment:', err);
      setError(err.message || 'Failed to load assignment');
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
      case 'proposed':
      case 'confirmed':
        return 'warning';
      case 'cancelled':
      case 'terminated':
        return 'error';
      default:
        return 'default';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status.toLowerCase()) {
      case 'active':
        return <CheckCircleIcon />;
      case 'completed':
        return <CheckCircleIcon />;
      case 'cancelled':
      case 'terminated':
        return <CancelIcon />;
      default:
        return <PendingIcon />;
    }
  };

  const formatDate = (date: Date): string => {
    return format(date, 'MMMM dd, yyyy');
  };

  const formatDateTime = (date: Date): string => {
    return format(date, 'MMMM dd, yyyy, h:mm a');
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
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate(-1)}
          sx={{ mt: 2 }}
        >
          Go Back
        </Button>
      </Box>
    );
  }

  if (!assignment) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info">Assignment not found</Alert>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate(-1)}
          sx={{ mt: 2 }}
        >
          Go Back
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', p: 3 }}>
      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 3 }}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate(-1)}
          variant="outlined"
        >
          Back
        </Button>
        <Typography variant="h4" sx={{ flexGrow: 1, fontWeight: 700 }}>
          Assignment Details
        </Typography>
        <Chip
          icon={getStatusIcon(assignment.status)}
          label={assignment.status.charAt(0).toUpperCase() + assignment.status.slice(1)}
          color={getStatusColor(assignment.status)}
          size="medium"
        />
      </Stack>

      {/* Main Content */}
      <Stack spacing={3}>
        {/* Job Information Card */}
        <Card elevation={0} sx={{ borderRadius: 0 }}>
          <CardContent>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
              Job Information
            </Typography>
            <Stack spacing={2}>
              <Stack direction="row" spacing={2} alignItems="center">
                <WorkIcon color="action" />
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    Job Title
                  </Typography>
                  <Typography variant="body1" sx={{ fontWeight: 600 }}>
                    {assignment.jobTitle || 'N/A'}
                  </Typography>
                </Box>
              </Stack>

              {assignment.companyName && (
                <Stack direction="row" spacing={2} alignItems="center">
                  <BusinessIcon color="action" />
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      Company
                    </Typography>
                    <Typography variant="body1">
                      {assignment.companyName}
                    </Typography>
                  </Box>
                </Stack>
              )}

              {assignment.location && (
                <Stack direction="row" spacing={2} alignItems="center">
                  <LocationIcon color="action" />
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      Location
                    </Typography>
                    <Typography variant="body1">
                      {assignment.location}
                    </Typography>
                    {assignment.worksiteAddress && (
                      <Typography variant="caption" color="text.secondary">
                        {[
                          assignment.worksiteAddress.street,
                          assignment.worksiteAddress.city,
                          assignment.worksiteAddress.state,
                          assignment.worksiteAddress.zipCode,
                        ]
                          .filter(Boolean)
                          .join(', ')}
                      </Typography>
                    )}
                  </Box>
                </Stack>
              )}
            </Stack>
          </CardContent>
        </Card>

        {/* Assignment Details Card */}
        <Card elevation={0} sx={{ borderRadius: 0 }}>
          <CardContent>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
              Assignment Details
            </Typography>
            <Stack spacing={2}>
              {assignment.payRate && (
                <Stack direction="row" spacing={2} alignItems="center">
                  <MoneyIcon color="action" />
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      Pay Rate
                    </Typography>
                    <Typography variant="body1" sx={{ fontWeight: 600 }}>
                      ${assignment.payRate}/hr
                    </Typography>
                  </Box>
                </Stack>
              )}

              {assignment.startDate && (
                <Stack direction="row" spacing={2} alignItems="center">
                  <ScheduleIcon color="action" />
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      Start Date
                    </Typography>
                    <Typography variant="body1">
                      {formatDate(assignment.startDate)}
                    </Typography>
                  </Box>
                </Stack>
              )}

              {assignment.endDate ? (
                <Stack direction="row" spacing={2} alignItems="center">
                  <ScheduleIcon color="action" />
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      End Date
                    </Typography>
                    <Typography variant="body1">
                      {formatDate(assignment.endDate)}
                    </Typography>
                  </Box>
                </Stack>
              ) : (
                <Stack direction="row" spacing={2} alignItems="center">
                  <ScheduleIcon color="action" />
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      Duration
                    </Typography>
                    <Typography variant="body1">Ongoing</Typography>
                  </Box>
                </Stack>
              )}

              {assignment.hoursWorked !== undefined && (
                <Stack direction="row" spacing={2} alignItems="center">
                  <ScheduleIcon color="action" />
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      Hours Worked
                    </Typography>
                    <Typography variant="body1">
                      {assignment.hoursWorked.toFixed(1)} hours
                    </Typography>
                  </Box>
                </Stack>
              )}

              {assignment.totalEarnings !== undefined && (
                <Stack direction="row" spacing={2} alignItems="center">
                  <MoneyIcon color="action" />
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      Total Earnings
                    </Typography>
                    <Typography variant="body1" sx={{ fontWeight: 600 }}>
                      ${assignment.totalEarnings.toFixed(2)}
                    </Typography>
                  </Box>
                </Stack>
              )}
            </Stack>
          </CardContent>
        </Card>

        {/* Notes */}
        {assignment.notes && (
          <Card elevation={0} sx={{ borderRadius: 0 }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
                Notes
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>
                {assignment.notes}
              </Typography>
            </CardContent>
          </Card>
        )}

        {/* Metadata */}
        {(assignment.createdAt || assignment.updatedAt) && (
          <Paper elevation={0} sx={{ p: 2, bgcolor: 'grey.50', borderRadius: 0 }}>
            <Stack spacing={1}>
              {assignment.createdAt && (
                <Typography variant="caption" color="text.secondary">
                  Created: {formatDateTime(assignment.createdAt)}
                </Typography>
              )}
              {assignment.updatedAt && (
                <Typography variant="caption" color="text.secondary">
                  Last Updated: {formatDateTime(assignment.updatedAt)}
                </Typography>
              )}
            </Stack>
          </Paper>
        )}
      </Stack>
    </Box>
  );
};

export default AssignmentDetails;


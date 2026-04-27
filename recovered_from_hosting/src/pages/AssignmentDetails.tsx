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
  // Staff instructions from job order
  staffInstructions?: {
    uniform?: { text?: string; files?: any[] };
    checkIn?: { text?: string; files?: any[] };
    firstDay?: { text?: string; files?: any[] };
    parking?: { text?: string; files?: any[] };
    [key: string]: { text?: string; files?: any[] } | undefined;
  };
  checkInInstructions?: string;
  uniformRequirements?: string;
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

      // Check if this is a confirmed application (prefixed with "app_")
      if (assignmentId.startsWith('app_')) {
        // Load from confirmed application
        const applicationId = assignmentId.replace('app_', '');
        
        // Get tenant IDs from user
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        const tenantIds: string[] = [];
        
        if (userSnap.exists()) {
          const userData = userSnap.data();
          if (userData.tenantIds && typeof userData.tenantIds === 'object') {
            tenantIds.push(...Object.keys(userData.tenantIds));
          }
          if (!tenantIds.includes('c1')) {
            tenantIds.push('c1');
          }
        }
        
        // Find the application across tenants
        let applicationData: any = null;
        let foundTenantId = '';
        
        for (const tenantId of tenantIds) {
          try {
            const applicationRef = doc(db, 'tenants', tenantId, 'applications', applicationId);
            const applicationSnap = await getDoc(applicationRef);
            
            if (applicationSnap.exists() && applicationSnap.data().userId === user.uid) {
              applicationData = applicationSnap.data();
              foundTenantId = tenantId;
              break;
            }
          } catch (err) {
            // Continue to next tenant
          }
        }
        
        if (!applicationData || !applicationData.jobOrderId) {
          setError('Assignment not found');
          setLoading(false);
          return;
        }
        
        // Load job order details
        await loadFromJobOrder(foundTenantId, applicationData.jobOrderId, applicationData);
        return;
      }

      // Try legacy structure first (assignments collection with userId)
      const assignmentRef = doc(db, 'assignments', assignmentId);
      const assignmentSnap = await getDoc(assignmentRef);

      if (!assignmentSnap.exists()) {
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
      const jobTitle = data.jobTitle || '';
      const companyName = data.companyName || '';
      const location = data.location || data.worksiteName || '';
      const worksiteName = data.worksiteName || '';
      const worksiteAddress = data.worksiteAddress || data.address;

      // Load job order details if available
      if (data.jobOrderId && data.tenantId) {
        await loadFromJobOrder(data.tenantId, data.jobOrderId, data, assignmentSnap.id);
        return;
      }

      // If no job order, set assignment with basic data
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

  const loadFromJobOrder = async (
    tenantId: string,
    jobOrderId: string,
    sourceData: any,
    assignmentId?: string
  ) => {
    try {
      const jobOrderRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId);
      const jobOrderSnap = await getDoc(jobOrderRef);

      if (!jobOrderSnap.exists()) {
        setError('Job order not found');
        setLoading(false);
        return;
      }

      const jobOrderData = jobOrderSnap.data();
      
      // Parse dates
      let startDate: Date | undefined;
      let endDate: Date | undefined;
      let createdAt: Date | undefined;
      let updatedAt: Date | undefined;

      if (jobOrderData.startDate) {
        startDate = jobOrderData.startDate.toDate ? jobOrderData.startDate.toDate() : new Date(jobOrderData.startDate);
      }
      if (jobOrderData.endDate) {
        endDate = jobOrderData.endDate.toDate ? jobOrderData.endDate.toDate() : new Date(jobOrderData.endDate);
      }
      if (sourceData.createdAt) {
        createdAt = sourceData.createdAt.toDate ? sourceData.createdAt.toDate() : new Date(sourceData.createdAt);
      }
      if (sourceData.updatedAt) {
        updatedAt = sourceData.updatedAt.toDate ? sourceData.updatedAt.toDate() : new Date(sourceData.updatedAt);
      }

      // Get location from worksite
      let location = '';
      let worksiteName = '';
      const worksiteAddress = jobOrderData.worksiteAddress;

      if (jobOrderData.worksiteName) {
        location = jobOrderData.worksiteName;
        worksiteName = jobOrderData.worksiteName;
      } else if (jobOrderData.worksiteAddress) {
        const addr = jobOrderData.worksiteAddress;
        if (addr.city && addr.state) {
          location = `${addr.city}, ${addr.state}`;
        }
      }

      setAssignment({
        id: assignmentId || `jobOrder_${jobOrderId}`,
        tenantId: tenantId,
        jobOrderId: jobOrderId,
        jobTitle: jobOrderData.jobOrderName || jobOrderData.jobTitle || '',
        companyName: jobOrderData.companyName || '',
        location,
        worksiteName,
        worksiteAddress,
        payRate: jobOrderData.payRate,
        startDate,
        endDate,
        status: sourceData.status || 'confirmed',
        hoursWorked: sourceData.hoursWorked,
        totalEarnings: sourceData.totalEarnings,
        notes: sourceData.notes || jobOrderData.jobOrderDescription,
        createdAt,
        updatedAt,
        // Load staff instructions
        staffInstructions: jobOrderData.staffInstructions || {},
        checkInInstructions: jobOrderData.checkInInstructions,
        uniformRequirements: jobOrderData.uniformRequirements,
      });
    } catch (err: any) {
      console.error('Error loading job order:', err);
      setError(err.message || 'Failed to load job order details');
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

        {/* Staff Instructions */}
        {(assignment.staffInstructions || assignment.checkInInstructions || assignment.uniformRequirements) && (
          <Card elevation={0} sx={{ borderRadius: 0 }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
                Work Instructions
              </Typography>
              <Stack spacing={3}>
                {/* Uniform Requirements */}
                {(assignment.uniformRequirements || assignment.staffInstructions?.uniform?.text) && (
                  <Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                      Uniform Requirements
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap', mb: 1 }}>
                      {assignment.staffInstructions?.uniform?.text || assignment.uniformRequirements}
                    </Typography>
                    {assignment.staffInstructions?.uniform?.files && assignment.staffInstructions.uniform.files.length > 0 && (
                      <Stack spacing={1} sx={{ mt: 1 }}>
                        {assignment.staffInstructions.uniform.files.map((file: any, index: number) => (
                          <Button
                            key={index}
                            variant="outlined"
                            size="small"
                            href={file.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {file.label || file.name || 'View File'}
                          </Button>
                        ))}
                      </Stack>
                    )}
                  </Box>
                )}

                {/* Check-In Instructions */}
                {(assignment.checkInInstructions || assignment.staffInstructions?.checkIn?.text) && (
                  <Box>
                    <Divider sx={{ my: 2 }} />
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                      Check-In Instructions
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap', mb: 1 }}>
                      {assignment.staffInstructions?.checkIn?.text || assignment.checkInInstructions}
                    </Typography>
                    {assignment.staffInstructions?.checkIn?.files && assignment.staffInstructions.checkIn.files.length > 0 && (
                      <Stack spacing={1} sx={{ mt: 1 }}>
                        {assignment.staffInstructions.checkIn.files.map((file: any, index: number) => (
                          <Button
                            key={index}
                            variant="outlined"
                            size="small"
                            href={file.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {file.label || file.name || 'View File'}
                          </Button>
                        ))}
                      </Stack>
                    )}
                  </Box>
                )}

                {/* First Day Instructions */}
                {assignment.staffInstructions?.firstDay?.text && (
                  <Box>
                    <Divider sx={{ my: 2 }} />
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                      First Day Instructions
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap', mb: 1 }}>
                      {assignment.staffInstructions.firstDay.text}
                    </Typography>
                    {assignment.staffInstructions.firstDay.files && assignment.staffInstructions.firstDay.files.length > 0 && (
                      <Stack spacing={1} sx={{ mt: 1 }}>
                        {assignment.staffInstructions.firstDay.files.map((file: any, index: number) => (
                          <Button
                            key={index}
                            variant="outlined"
                            size="small"
                            href={file.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {file.label || file.name || 'View File'}
                          </Button>
                        ))}
                      </Stack>
                    )}
                  </Box>
                )}

                {/* Parking Instructions */}
                {assignment.staffInstructions?.parking?.text && (
                  <Box>
                    <Divider sx={{ my: 2 }} />
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                      Parking Information
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap', mb: 1 }}>
                      {assignment.staffInstructions.parking.text}
                    </Typography>
                    {assignment.staffInstructions.parking.files && assignment.staffInstructions.parking.files.length > 0 && (
                      <Stack spacing={1} sx={{ mt: 1 }}>
                        {assignment.staffInstructions.parking.files.map((file: any, index: number) => (
                          <Button
                            key={index}
                            variant="outlined"
                            size="small"
                            href={file.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {file.label || file.name || 'View File'}
                          </Button>
                        ))}
                      </Stack>
                    )}
                  </Box>
                )}
              </Stack>
            </CardContent>
          </Card>
        )}

        {/* Notes */}
        {assignment.notes && (
          <Card elevation={0} sx={{ borderRadius: 0 }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
                Additional Notes
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



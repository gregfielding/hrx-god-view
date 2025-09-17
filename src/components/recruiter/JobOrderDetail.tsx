import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardHeader,
  Button,
  Chip,
  Grid,
  Tabs,
  Tab,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  CircularProgress,
  IconButton,
  Tooltip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Autocomplete,
  Switch,
  FormControlLabel,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Divider
} from '@mui/material';
import {
  Edit as EditIcon,
  Save as SaveIcon,
  Cancel as CancelIcon,
  Work as WorkIcon,
  Business as BusinessIcon,
  LocationOn as LocationIcon,
  People as PeopleIcon,
  Assignment as AssignmentIcon,
  Visibility as VisibilityIcon,
  Security as SecurityIcon,
  Notes as NotesIcon,
  ExpandMore as ExpandMoreIcon,
  Add as AddIcon,
  Delete as DeleteIcon
} from '@mui/icons-material';
import { JobOrderService } from '../../services/recruiter/jobOrderService';
import { JobOrder, JobOrderFormData, JobApplication, Candidate, Employee } from '../../types/recruiter/jobOrder';
import { useAuth } from '../../contexts/AuthContext';
import JobOrderForm from './JobOrderForm';
import PostToJobsBoardDialog from './PostToJobsBoardDialog';

interface JobOrderDetailProps {
  jobOrderId: string;
  onBack?: () => void;
  onJobOrderUpdated?: (jobOrder: JobOrder) => void;
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`job-order-tabpanel-${index}`}
      aria-labelledby={`job-order-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 0 }}>{children}</Box>}
    </div>
  );
}

const JobOrderDetail: React.FC<JobOrderDetailProps> = ({
  jobOrderId,
  onBack,
  onJobOrderUpdated
}) => {
  const { tenantId, user } = useAuth();
  const [jobOrder, setJobOrder] = useState<JobOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [tabValue, setTabValue] = useState(0);
  const [postDialogOpen, setPostDialogOpen] = useState(false);
  
  // Related data
  const [applications, setApplications] = useState<JobApplication[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  const jobOrderService = JobOrderService.getInstance();

  useEffect(() => {
    if (jobOrderId && tenantId) {
      loadJobOrder();
      loadRelatedData();
    }
  }, [jobOrderId, tenantId]);

  const loadJobOrder = async () => {
    if (!tenantId || !jobOrderId) return;
    
    try {
      setLoading(true);
      const order = await jobOrderService.getJobOrder(tenantId, jobOrderId);
      if (order) {
        setJobOrder(order);
      } else {
        setError('Job Order not found');
      }
    } catch (err: any) {
      console.error('Error loading job order:', err);
      setError(err.message || 'Failed to load job order');
    } finally {
      setLoading(false);
    }
  };

  const loadRelatedData = async () => {
    if (!tenantId || !jobOrderId) return;
    
    try {
      const [apps, cands, emps] = await Promise.all([
        jobOrderService.getApplicationsByJobOrder(tenantId, jobOrderId),
        jobOrderService.getCandidatesByJobOrder(tenantId, jobOrderId),
        jobOrderService.getEmployeesByJobOrder(tenantId, jobOrderId)
      ]);
      
      setApplications(apps);
      setCandidates(cands);
      setEmployees(emps);
    } catch (err: any) {
      console.error('Error loading related data:', err);
    }
  };

  const handleSave = async () => {
    if (!tenantId || !jobOrderId || !user?.uid) return;
    
    try {
      setSaving(true);
      
      // Reload the job order
      await loadJobOrder();
      
      setEditing(false);
      setSuccess('Job Order updated successfully!');
      
      if (onJobOrderUpdated && jobOrder) {
        onJobOrderUpdated(jobOrder);
      }
      
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      console.error('Error saving job order:', err);
      setError(err.message || 'Failed to save job order');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setError(null);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open': return 'success';
      case 'draft': return 'default';
      case 'on_hold': return 'warning';
      case 'cancelled': return 'error';
      case 'filled': return 'info';
      case 'completed': return 'success';
      default: return 'default';
    }
  };

  const getJobOrderAge = (dateOpened: Date | any) => {
    // Handle FieldValue (serverTimestamp) by returning 0 for now
    if (!dateOpened || typeof dateOpened.getTime !== 'function') {
      return 0;
    }
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - dateOpened.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const getAgeColor = (days: number) => {
    if (days <= 7) return 'success';
    if (days <= 14) return 'warning';
    return 'error';
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (error && !jobOrder) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>
        {error}
      </Alert>
    );
  }

  if (!jobOrder) {
    return (
      <Alert severity="warning" sx={{ mb: 2 }}>
        Job Order not found
      </Alert>
    );
  }

  const age = getJobOrderAge(jobOrder.dateOpened);

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3 }}>
        <Box>
          <Typography variant="h4" component="h1" gutterBottom>
            Job Order #{jobOrder.jobOrderNumber}
          </Typography>
          <Typography variant="h6" color="text.secondary" gutterBottom>
            {jobOrder.jobOrderName}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <Chip
              label={jobOrder.status.replace('_', ' ').toUpperCase()}
              color={getStatusColor(jobOrder.status) as any}
              size="small"
            />
            <Chip
              label={`${age} days old`}
              color={getAgeColor(age) as any}
              size="small"
              variant="outlined"
            />
            {jobOrder.dealId && (
              <Chip
                label="From CRM Deal"
                color="info"
                size="small"
                variant="outlined"
              />
            )}
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {onBack && (
            <Button variant="outlined" onClick={onBack}>
              Back to List
            </Button>
          )}
          {!editing && (
            <>
              <Button
                variant="outlined"
                startIcon={<WorkIcon />}
                onClick={() => setPostDialogOpen(true)}
                sx={{ mr: 1 }}
              >
                Post to Jobs Board
              </Button>
              <Button
                variant="contained"
                startIcon={<EditIcon />}
                onClick={() => setEditing(true)}
              >
                Edit
              </Button>
            </>
          )}
        </Box>
      </Box>

      {/* Success/Error Messages */}
      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Edit Mode */}
      {editing ? (
        <JobOrderForm
          tenantId={tenantId}
          createdBy={user?.uid || ''}
          jobOrder={jobOrder}
          dealId={jobOrder.dealId}
          onSave={handleSave}
          onCancel={handleCancel}
          loading={saving}
          companies={[]} // TODO: Load companies
          locations={[]} // TODO: Load locations
          recruiters={[]} // TODO: Load recruiters
          jobTitles={[]} // TODO: Load job titles
          groups={[]} // TODO: Load groups
        />
      ) : (
        <>
          {/* Tabs */}
          <Paper elevation={1} sx={{ mb: 3, borderRadius: 1 }}>
            <Tabs
              value={tabValue}
              onChange={(_, newValue) => setTabValue(newValue)}
              indicatorColor="primary"
              textColor="primary"
              variant="scrollable"
              scrollButtons="auto"
            >
              <Tab 
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <AssignmentIcon fontSize="small" />
                    Overview
                  </Box>
                } 
              />
              <Tab 
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <PeopleIcon fontSize="small" />
                    Applications ({applications.length})
                  </Box>
                } 
              />
              <Tab 
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <WorkIcon fontSize="small" />
                    Candidates ({candidates.length})
                  </Box>
                } 
              />
              <Tab 
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <BusinessIcon fontSize="small" />
                    Employees ({employees.length})
                  </Box>
                } 
              />
            </Tabs>
          </Paper>

          {/* Tab Panels */}
          <TabPanel value={tabValue} index={0}>
            <Grid container spacing={3}>
              {/* Basic Information */}
              <Grid item xs={12} md={6}>
                <Card>
                  <CardHeader title="Basic Information" />
                  <CardContent>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <Box>
                        <Typography variant="subtitle2" color="text.secondary">
                          Company
                        </Typography>
                        <Typography variant="body1">
                          {jobOrder.companyName}
                        </Typography>
                      </Box>
                      <Box>
                        <Typography variant="subtitle2" color="text.secondary">
                          Worksite
                        </Typography>
                        <Typography variant="body1">
                          {jobOrder.worksiteName}
                        </Typography>
                      </Box>
                      <Box>
                        <Typography variant="subtitle2" color="text.secondary">
                          Job Title
                        </Typography>
                        <Typography variant="body1">
                          {jobOrder.jobTitle}
                        </Typography>
                      </Box>
                      <Box>
                        <Typography variant="subtitle2" color="text.secondary">
                          Workers Needed
                        </Typography>
                        <Typography variant="body1">
                          {jobOrder.workersNeeded}
                        </Typography>
                      </Box>
                      <Box>
                        <Typography variant="subtitle2" color="text.secondary">
                          Pay Rate
                        </Typography>
                        <Typography variant="body1" fontWeight="medium">
                          ${jobOrder.payRate}/hour
                        </Typography>
                      </Box>
                      <Box>
                        <Typography variant="subtitle2" color="text.secondary">
                          Bill Rate
                        </Typography>
                        <Typography variant="body1" fontWeight="medium">
                          ${jobOrder.billRate}/hour
                        </Typography>
                      </Box>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>

              {/* Job Details */}
              <Grid item xs={12} md={6}>
                <Card>
                  <CardHeader title="Job Details" />
                  <CardContent>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {jobOrder.jobOrderDescription && (
                        <Box>
                          <Typography variant="subtitle2" color="text.secondary">
                            Description
                          </Typography>
                          <Typography variant="body1">
                            {jobOrder.jobOrderDescription}
                          </Typography>
                        </Box>
                      )}
                      {jobOrder.uniformRequirements && (
                        <Box>
                          <Typography variant="subtitle2" color="text.secondary">
                            Uniform Requirements
                          </Typography>
                          <Typography variant="body1">
                            {jobOrder.uniformRequirements}
                          </Typography>
                        </Box>
                      )}
                      {jobOrder.checkInInstructions && (
                        <Box>
                          <Typography variant="subtitle2" color="text.secondary">
                            Check-in Instructions
                          </Typography>
                          <Typography variant="body1">
                            {jobOrder.checkInInstructions}
                          </Typography>
                        </Box>
                      )}
                      <Box>
                        <Typography variant="subtitle2" color="text.secondary">
                          Timesheet Collection
                        </Typography>
                        <Typography variant="body1">
                          {jobOrder.timesheetCollectionMethod.replace('_', ' ')}
                        </Typography>
                      </Box>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>

              {/* Requirements */}
              <Grid item xs={12}>
                <Card>
                  <CardHeader title="Requirements" />
                  <CardContent>
                    <Grid container spacing={2}>
                      <Grid item xs={12} md={6}>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          <FormControlLabel
                            control={<Switch checked={jobOrder.drugScreenRequired} disabled />}
                            label="Drug Screen Required"
                          />
                          <FormControlLabel
                            control={<Switch checked={jobOrder.backgroundCheckRequired} disabled />}
                            label="Background Check Required"
                          />
                        </Box>
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <Box>
                          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                            PPE Provided By
                          </Typography>
                          <Typography variant="body1">
                            {jobOrder.ppeProvidedBy}
                          </Typography>
                        </Box>
                      </Grid>
                      {jobOrder.requiredLicenses.length > 0 && (
                        <Grid item xs={12}>
                          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                            Required Licenses
                          </Typography>
                          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                            {jobOrder.requiredLicenses.map((license, index) => (
                              <Chip key={index} label={license} size="small" />
                            ))}
                          </Box>
                        </Grid>
                      )}
                      {jobOrder.requiredCertifications.length > 0 && (
                        <Grid item xs={12}>
                          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                            Required Certifications
                          </Typography>
                          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                            {jobOrder.requiredCertifications.map((cert, index) => (
                              <Chip key={index} label={cert} size="small" />
                            ))}
                          </Box>
                        </Grid>
                      )}
                    </Grid>
                  </CardContent>
                </Card>
              </Grid>

              {/* Jobs Board Settings */}
              <Grid item xs={12}>
                <Card>
                  <CardHeader title="Jobs Board Settings" />
                  <CardContent>
                    <Grid container spacing={2}>
                      <Grid item xs={12} md={4}>
                        <Typography variant="subtitle2" color="text.secondary">
                          Visibility
                        </Typography>
                        <Typography variant="body1">
                          {jobOrder.jobsBoardVisibility.replace('_', ' ')}
                        </Typography>
                      </Grid>
                      <Grid item xs={12} md={8}>
                        <Box sx={{ display: 'flex', gap: 2 }}>
                          <FormControlLabel
                            control={<Switch checked={jobOrder.showPayRate} disabled />}
                            label="Show Pay Rate"
                          />
                          <FormControlLabel
                            control={<Switch checked={jobOrder.showStartDate} disabled />}
                            label="Show Start Date"
                          />
                          <FormControlLabel
                            control={<Switch checked={jobOrder.showShiftTimes} disabled />}
                            label="Show Shift Times"
                          />
                        </Box>
                      </Grid>
                    </Grid>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          </TabPanel>

          <TabPanel value={tabValue} index={1}>
            <Card>
              <CardHeader 
                title="Applications"
                action={
                  <Button variant="outlined" size="small">
                    View All Applications
                  </Button>
                }
              />
              <CardContent>
                {applications.length > 0 ? (
                  <TableContainer>
                    <Table>
                      <TableHead>
                        <TableRow>
                          <TableCell>Applicant</TableCell>
                          <TableCell>Email</TableCell>
                          <TableCell>Applied</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell>Score</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {applications.map((app) => (
                          <TableRow key={app.id}>
                            <TableCell>{app.applicantName}</TableCell>
                            <TableCell>{app.applicantEmail}</TableCell>
                            <TableCell>
                              {app.appliedAt.toLocaleDateString()}
                            </TableCell>
                            <TableCell>
                              <Chip 
                                label={app.status} 
                                size="small" 
                                color="primary" 
                                variant="outlined" 
                              />
                            </TableCell>
                            <TableCell>
                              {app.screeningScore ? `${app.screeningScore}%` : '-'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Typography color="text.secondary">
                    No applications yet
                  </Typography>
                )}
              </CardContent>
            </Card>
          </TabPanel>

          <TabPanel value={tabValue} index={2}>
            <Card>
              <CardHeader 
                title="Candidates"
                action={
                  <Button variant="outlined" size="small">
                    View All Candidates
                  </Button>
                }
              />
              <CardContent>
                {candidates.length > 0 ? (
                  <TableContainer>
                    <Table>
                      <TableHead>
                        <TableRow>
                          <TableCell>Candidate</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell>Background Check</TableCell>
                          <TableCell>Drug Screen</TableCell>
                          <TableCell>Onboarding</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {candidates.map((candidate) => (
                          <TableRow key={candidate.id}>
                            <TableCell>Candidate {candidate.id}</TableCell>
                            <TableCell>
                              <Chip 
                                label={candidate.status} 
                                size="small" 
                                color="primary" 
                                variant="outlined" 
                              />
                            </TableCell>
                            <TableCell>
                              <Chip 
                                label={candidate.backgroundCheckStatus || 'not_required'} 
                                size="small" 
                                color="info" 
                                variant="outlined" 
                              />
                            </TableCell>
                            <TableCell>
                              <Chip 
                                label={candidate.drugScreenStatus || 'not_required'} 
                                size="small" 
                                color="info" 
                                variant="outlined" 
                              />
                            </TableCell>
                            <TableCell>
                              <Chip 
                                label={candidate.onboardingStatus || 'pending'} 
                                size="small" 
                                color="warning" 
                                variant="outlined" 
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Typography color="text.secondary">
                    No candidates yet
                  </Typography>
                )}
              </CardContent>
            </Card>
          </TabPanel>

          <TabPanel value={tabValue} index={3}>
            <Card>
              <CardHeader 
                title="Employees"
                action={
                  <Button variant="outlined" size="small">
                    View All Employees
                  </Button>
                }
              />
              <CardContent>
                {employees.length > 0 ? (
                  <TableContainer>
                    <Table>
                      <TableHead>
                        <TableRow>
                          <TableCell>Employee</TableCell>
                          <TableCell>Employee #</TableCell>
                          <TableCell>Start Date</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell>Pay Rate</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {employees.map((employee) => (
                          <TableRow key={employee.id}>
                            <TableCell>Employee {employee.id}</TableCell>
                            <TableCell>{employee.employeeNumber}</TableCell>
                            <TableCell>
                              {employee.startDate.toLocaleDateString()}
                            </TableCell>
                            <TableCell>
                              <Chip 
                                label={employee.status} 
                                size="small" 
                                color="success" 
                                variant="outlined" 
                              />
                            </TableCell>
                            <TableCell>
                              ${employee.payRate}/hour
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Typography color="text.secondary">
                    No employees yet
                  </Typography>
                )}
              </CardContent>
            </Card>
          </TabPanel>
        </>
      )}

      {/* Post to Jobs Board Dialog */}
      {jobOrder && (
        <PostToJobsBoardDialog
          open={postDialogOpen}
          onClose={() => setPostDialogOpen(false)}
          jobOrder={jobOrder}
          onPostCreated={(postId) => {
            setSuccess('Job posted to Jobs Board successfully!');
            setPostDialogOpen(false);
            setTimeout(() => setSuccess(null), 3000);
          }}
        />
      )}
    </Box>
  );
};

export default JobOrderDetail;

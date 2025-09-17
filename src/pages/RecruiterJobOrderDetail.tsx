import React, { useState, useEffect } from 'react';
import { safeToDate } from '../utils/dateUtils';
import {
  Box,
  Typography,
  Button,
  Chip,
  Card,
  CardContent,
  Grid,
  Divider,
  Tabs,
  Tab,
  IconButton,
  Menu,
  MenuItem,
  TextField,
  FormControl,
  InputLabel,
  Select,
  Stack,
  Alert,
  CircularProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Avatar,
  Tooltip,
  Badge
} from '@mui/material';
import {
  Edit as EditIcon,
  MoreVert as MoreVertIcon,
  Business as BusinessIcon,
  LocationOn as LocationIcon,
  Person as PersonIcon,
  Schedule as ScheduleIcon,
  AttachMoney as MoneyIcon,
  Work as WorkIcon,
  Group as GroupIcon,
  Description as DescriptionIcon,
  Security as SecurityIcon,
  Assignment as AssignmentIcon,
  Timeline as TimelineIcon,
  CheckCircle as CheckCircleIcon,
  Warning as WarningIcon,
  Info as InfoIcon
} from '@mui/icons-material';
import { useParams, useNavigate } from 'react-router-dom';
import { format, formatDistanceToNow } from 'date-fns';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';

import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { p } from '../data/firestorePaths';
import { useFlag } from '../hooks/useFlag';
import { JobOrder } from '../types/Phase1Types';

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
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

const RecruiterJobOrderDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, tenantId } = useAuth();
  const useNewDataModel = useFlag('NEW_DATA_MODEL');
  
  // State
  const [jobOrder, setJobOrder] = useState<JobOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(0);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState<Partial<JobOrder>>({});

  // Load job order
  useEffect(() => {
    if (id && tenantId && useNewDataModel) {
      fetchJobOrder();
    }
  }, [id, tenantId, useNewDataModel]);

  const fetchJobOrder = async () => {
    if (!id || !tenantId) return;
    
    setLoading(true);
    try {
      const jobOrderRef = doc(db, p.jobOrder(tenantId, id));
      const jobOrderSnap = await getDoc(jobOrderRef);
      
      if (jobOrderSnap.exists()) {
        const data = jobOrderSnap.data() as JobOrder;
        setJobOrder({ ...data, id: jobOrderSnap.id });
        setEditData({ ...data, id: jobOrderSnap.id });
      } else {
        // Job order not found
        setJobOrder(null);
      }
    } catch (error) {
      console.error('Error fetching job order:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleEdit = () => {
    setEditing(true);
    handleMenuClose();
  };

  const handleSave = async () => {
    if (!jobOrder || !tenantId) return;
    
    try {
      const jobOrderRef = doc(db, p.jobOrder(tenantId, jobOrder.id));
      await updateDoc(jobOrderRef, {
        ...editData,
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid
      });
      
      setJobOrder(prev => prev ? { ...prev, ...editData } : null);
      setEditing(false);
    } catch (error) {
      console.error('Error updating job order:', error);
    }
  };

  const handleCancel = () => {
    setEditData(jobOrder || {});
    setEditing(false);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Open': return 'success';
      case 'On-Hold': return 'warning';
      case 'Cancelled': return 'error';
      case 'Filled': return 'info';
      case 'Completed': return 'default';
      default: return 'default';
    }
  };

  const formatJobOrderNumber = (number: number) => {
    return `JO-${number.toString().padStart(4, '0')}`;
  };

  if (!useNewDataModel) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info">
          New data model is disabled. Enable the NEW_DATA_MODEL feature flag to view job order details.
        </Alert>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!jobOrder) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          Job order not found or you don't have permission to view it.
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Box>
          <Typography variant="h4" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <WorkIcon />
            {formatJobOrderNumber(jobOrder.jobOrderNumber)}
          </Typography>
          <Typography variant="h6" color="text.secondary">
            {jobOrder.jobOrderName}
          </Typography>
        </Box>
        
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Chip
            label={jobOrder.status}
            color={getStatusColor(jobOrder.status) as any}
            size="medium"
          />
          <IconButton onClick={handleMenuOpen}>
            <MoreVertIcon />
          </IconButton>
        </Box>
      </Box>

      {/* Quick Stats */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Avatar sx={{ bgcolor: 'primary.main' }}>
                  <GroupIcon />
                </Avatar>
                <Box>
                  <Typography variant="h6">
                    {jobOrder.openings || 0}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Total Openings
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        
        <Grid item xs={12} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Avatar sx={{ bgcolor: 'success.main' }}>
                  <CheckCircleIcon />
                </Avatar>
                <Box>
                  <Typography variant="h6">
                    {(jobOrder.openings || 0) - (jobOrder.remainingOpenings || 0)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Filled
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        
        <Grid item xs={12} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Avatar sx={{ bgcolor: 'warning.main' }}>
                  <WarningIcon />
                </Avatar>
                <Box>
                  <Typography variant="h6">
                    {jobOrder.remainingOpenings || 0}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Remaining
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        
        <Grid item xs={12} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Avatar sx={{ bgcolor: 'info.main' }}>
                  <MoneyIcon />
                </Avatar>
                <Box>
                  <Typography variant="h6">
                    ${jobOrder.payRate || 0}/hr
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Pay Rate
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Tabs */}
      <Paper sx={{ mb: 3 }}>
        <Tabs
          value={activeTab}
          onChange={(_, newValue) => setActiveTab(newValue)}
          variant="fullWidth"
        >
          <Tab label="Overview" icon={<InfoIcon />} />
          <Tab label="Applications" icon={<AssignmentIcon />} />
          <Tab label="Assignments" icon={<GroupIcon />} />
          <Tab label="Activity" icon={<TimelineIcon />} />
        </Tabs>
      </Paper>

      {/* Tab Panels */}
      <TabPanel value={activeTab} index={0}>
        {/* Overview Tab */}
        <Grid container spacing={3}>
          {/* Basic Information */}
          <Grid item xs={12} md={8}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <DescriptionIcon />
                  Job Details
                </Typography>
                
                <Grid container spacing={2}>
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      label="Job Order Name"
                      value={editing ? editData.jobOrderName || '' : jobOrder.jobOrderName}
                      onChange={editing ? (e) => setEditData(prev => ({ ...prev, jobOrderName: e.target.value })) : undefined}
                      disabled={!editing}
                    />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <FormControl fullWidth disabled={!editing}>
                      <InputLabel>Status</InputLabel>
                      <Select
                        value={editing ? editData.status || '' : jobOrder.status}
                        onChange={editing ? (e) => setEditData(prev => ({ ...prev, status: e.target.value as any })) : undefined}
                        label="Status"
                      >
                        <MenuItem value="Open">Open</MenuItem>
                        <MenuItem value="On-Hold">On-Hold</MenuItem>
                        <MenuItem value="Cancelled">Cancelled</MenuItem>
                        <MenuItem value="Filled">Filled</MenuItem>
                        <MenuItem value="Completed">Completed</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12}>
                    <TextField
                      fullWidth
                      label="Description"
                      value={editing ? editData.description || '' : jobOrder.description || ''}
                      onChange={editing ? (e) => setEditData(prev => ({ ...prev, description: e.target.value })) : undefined}
                      disabled={!editing}
                      multiline
                      rows={3}
                    />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      label="Workers Needed"
                      type="number"
                      value={editing ? editData.openings || '' : jobOrder.openings || ''}
                      onChange={editing ? (e) => setEditData(prev => ({ ...prev, openings: parseInt(e.target.value) || 0 })) : undefined}
                      disabled={!editing}
                    />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      label="Remaining Openings"
                      type="number"
                      value={editing ? editData.remainingOpenings || '' : jobOrder.remainingOpenings || ''}
                      onChange={editing ? (e) => setEditData(prev => ({ ...prev, remainingOpenings: parseInt(e.target.value) || 0 })) : undefined}
                      disabled={!editing}
                    />
                  </Grid>
                </Grid>
              </CardContent>
            </Card>
          </Grid>

          {/* Company & Location Info */}
          <Grid item xs={12} md={4}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <BusinessIcon />
                  Company & Location
                </Typography>
                
                <Stack spacing={2}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <BusinessIcon sx={{ color: 'text.secondary' }} />
                    <Box>
                      <Typography variant="body2" color="text.secondary">
                        Company
                      </Typography>
                      <Typography variant="body1">
                        {jobOrder.companyId} {/* TODO: Fetch actual company name */}
                      </Typography>
                    </Box>
                  </Box>
                  
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <LocationIcon sx={{ color: 'text.secondary' }} />
                    <Box>
                      <Typography variant="body2" color="text.secondary">
                        Location
                      </Typography>
                      <Typography variant="body1">
                        {jobOrder.locationId || 'No Location'} {/* TODO: Fetch actual location name */}
                      </Typography>
                    </Box>
                  </Box>
                  
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <PersonIcon sx={{ color: 'text.secondary' }} />
                    <Box>
                      <Typography variant="body2" color="text.secondary">
                        Recruiter
                      </Typography>
                      <Typography variant="body1">
                        {jobOrder.recruiterId} {/* TODO: Fetch actual recruiter name */}
                      </Typography>
                    </Box>
                  </Box>
                </Stack>
              </CardContent>
            </Card>

            {/* Dates */}
            <Card sx={{ mt: 2 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <ScheduleIcon />
                  Important Dates
                </Typography>
                
                <Stack spacing={2}>
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      Date Opened
                    </Typography>
                    <Typography variant="body1">
                      {format(safeToDate(jobOrder.dateOpened), 'MMM dd, yyyy')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatDistanceToNow(safeToDate(jobOrder.dateOpened), { addSuffix: true })}
                    </Typography>
                  </Box>
                  
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      Start Date
                    </Typography>
                    <Typography variant="body1">
                      {format(new Date(jobOrder.startDate), 'MMM dd, yyyy')}
                    </Typography>
                  </Box>
                  
                  {jobOrder.endDate && (
                    <Box>
                      <Typography variant="body2" color="text.secondary">
                        End Date
                      </Typography>
                      <Typography variant="body1">
                        {format(new Date(jobOrder.endDate), 'MMM dd, yyyy')}
                      </Typography>
                    </Box>
                  )}
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Edit Actions */}
        {editing && (
          <Box sx={{ mt: 3, display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
            <Button variant="outlined" onClick={handleCancel}>
              Cancel
            </Button>
            <Button variant="contained" onClick={handleSave}>
              Save Changes
            </Button>
          </Box>
        )}
      </TabPanel>

      <TabPanel value={activeTab} index={1}>
        {/* Applications Tab */}
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Applications for this Job Order
            </Typography>
            <Alert severity="info">
              Applications functionality will be implemented in the next phase.
            </Alert>
          </CardContent>
        </Card>
      </TabPanel>

      <TabPanel value={activeTab} index={2}>
        {/* Assignments Tab */}
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Assignments for this Job Order
            </Typography>
            <Alert severity="info">
              Assignments functionality will be implemented in the next phase.
            </Alert>
          </CardContent>
        </Card>
      </TabPanel>

      <TabPanel value={activeTab} index={3}>
        {/* Activity Tab */}
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Activity Timeline
            </Typography>
            <Alert severity="info">
              Activity tracking will be implemented in the next phase.
            </Alert>
          </CardContent>
        </Card>
      </TabPanel>

      {/* Action Menu */}
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
      >
        <MenuItem onClick={handleEdit}>
          <EditIcon sx={{ mr: 1 }} />
          Edit Job Order
        </MenuItem>
        <MenuItem onClick={() => navigate(`/recruiter/job-orders/${id}/applications`)}>
          <AssignmentIcon sx={{ mr: 1 }} />
          View Applications
        </MenuItem>
        <MenuItem onClick={() => navigate(`/recruiter/job-orders/${id}/assignments`)}>
          <GroupIcon sx={{ mr: 1 }} />
          View Assignments
        </MenuItem>
      </Menu>
    </Box>
  );
};

export default RecruiterJobOrderDetail;

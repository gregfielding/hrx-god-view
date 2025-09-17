import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  Grid,
  Chip,
  Avatar,
  Divider,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Tabs,
  Tab,
  Stack,
  Paper,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions
} from '@mui/material';
import {
  Edit as EditIcon,
  Save as SaveIcon,
  Cancel as CancelIcon,
  Person as PersonIcon,
  Work as WorkIcon,
  Schedule as ScheduleIcon,
  AttachMoney as MoneyIcon,
  LocationOn as LocationIcon,
  CheckCircle as CheckCircleIcon,
  PlayArrow as PlayArrowIcon,
  Stop as StopIcon,
  Note as NoteIcon,
  Timeline as TimelineIcon
} from '@mui/icons-material';
import { format } from 'date-fns';
import { 
  Assignment, 
  AssignmentStatus, 
  Timesheet 
} from '../../types/phase2';
import { getAssignmentService } from '../../services/phase2/assignmentService';
import { safeToDate } from '../../utils/dateUtils';

interface AssignmentDetailProps {
  assignment: Assignment;
  tenantId: string;
  onSave?: (updatedAssignment: Assignment) => void;
  onClose?: () => void;
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
      id={`assignment-tabpanel-${index}`}
      aria-labelledby={`assignment-tab-${index}`}
      {...other}
    >
      {value === index && (
        <Box sx={{ p: 3 }}>
          {children}
        </Box>
      )}
    </div>
  );
}

const AssignmentDetail: React.FC<AssignmentDetailProps> = ({
  assignment,
  tenantId,
  onSave,
  onClose
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedAssignment, setEditedAssignment] = useState<Assignment>(assignment);
  const [loading, setLoading] = useState(false);
  const [tabValue, setTabValue] = useState(0);
  const [timesheets, setTimesheets] = useState<Timesheet[]>([]);
  const [statusChangeDialog, setStatusChangeDialog] = useState(false);
  const [newStatus, setNewStatus] = useState<AssignmentStatus>(assignment.status);

  const assignmentService = getAssignmentService();

  useEffect(() => {
    loadTimesheets();
  }, [assignment.id]);

  const loadTimesheets = async () => {
    try {
      const data = await assignmentService.getTimesheetsForAssignment(tenantId, assignment.id);
      setTimesheets(data);
    } catch (error) {
      console.error('Error loading timesheets:', error);
    }
  };

  const handleEdit = () => {
    setIsEditing(true);
  };

  const handleCancel = () => {
    setEditedAssignment(assignment);
    setIsEditing(false);
  };

  const handleSave = async () => {
    try {
      setLoading(true);
      
      await assignmentService.updateAssignment(
        tenantId,
        assignment.jobOrderId,
        assignment.id,
        {
          candidateId: editedAssignment.candidateId,
          status: editedAssignment.status,
          startDate: editedAssignment.startDate,
          endDate: editedAssignment.endDate,
          payRate: editedAssignment.payRate,
          billRate: editedAssignment.billRate,
          worksite: editedAssignment.worksite,
          shiftTemplateId: editedAssignment.shiftTemplateId,
          timesheetMode: editedAssignment.timesheetMode,
          notes: editedAssignment.notes
        },
        'current-user' // TODO: Get actual user ID
      );

      setIsEditing(false);
      if (onSave) {
        onSave(editedAssignment);
      }
    } catch (error) {
      console.error('Error saving assignment:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (newStatus: AssignmentStatus) => {
    try {
      setLoading(true);
      
      await assignmentService.updateAssignmentStatus(
        tenantId,
        assignment.jobOrderId,
        assignment.id,
        newStatus,
        'current-user' // TODO: Get actual user ID
      );

      setEditedAssignment(prev => ({
        ...prev,
        status: newStatus
      }));

      if (onSave) {
        onSave({ ...editedAssignment, status: newStatus });
      }
    } catch (error) {
      console.error('Error updating status:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: AssignmentStatus): 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' => {
    switch (status) {
      case 'proposed': return 'info';
      case 'confirmed': return 'primary';
      case 'active': return 'success';
      case 'completed': return 'secondary';
      case 'ended': return 'default';
      case 'canceled': return 'error';
      default: return 'default';
    }
  };

  const getStatusIcon = (status: AssignmentStatus) => {
    switch (status) {
      case 'proposed': return <ScheduleIcon />;
      case 'confirmed': return <CheckCircleIcon />;
      case 'active': return <PlayArrowIcon />;
      case 'completed': return <CheckCircleIcon />;
      case 'ended': return <StopIcon />;
      case 'canceled': return <CancelIcon />;
      default: return <ScheduleIcon />;
    }
  };

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const getStatusOptions = (currentStatus: AssignmentStatus): AssignmentStatus[] => {
    switch (currentStatus) {
      case 'proposed':
        return ['confirmed', 'canceled'];
      case 'confirmed':
        return ['active', 'canceled'];
      case 'active':
        return ['completed', 'ended', 'canceled'];
      case 'completed':
        return ['ended'];
      case 'ended':
        return ['active'];
      case 'canceled':
        return ['proposed'];
      default:
        return [];
    }
  };

  return (
    <Box sx={{ maxWidth: 1000, mx: 'auto', p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">
          Assignment Details
        </Typography>
        <Box>
          {isEditing ? (
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                startIcon={<SaveIcon />}
                onClick={handleSave}
                disabled={loading}
              >
                Save
              </Button>
              <Button
                variant="outlined"
                startIcon={<CancelIcon />}
                onClick={handleCancel}
              >
                Cancel
              </Button>
            </Stack>
          ) : (
            <Stack direction="row" spacing={1}>
              <Button
                variant="outlined"
                onClick={() => setStatusChangeDialog(true)}
                disabled={loading}
              >
                Change Status
              </Button>
              <Button
                variant="contained"
                startIcon={<EditIcon />}
                onClick={handleEdit}
              >
                Edit
              </Button>
            </Stack>
          )}
        </Box>
      </Box>

      {/* Status Overview */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
            <Chip
              label={editedAssignment.status}
              color={getStatusColor(editedAssignment.status)}
              size="medium"
              icon={getStatusIcon(editedAssignment.status)}
            />
            <Typography variant="body2" color="text.secondary">
              Assignment ID: {assignment.id}
            </Typography>
          </Box>
          
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <Typography variant="body2" color="text.secondary">
                Created
              </Typography>
              <Typography variant="body1">
                {format(safeToDate(editedAssignment.createdAt), 'MMM dd, yyyy HH:mm')}
              </Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Typography variant="body2" color="text.secondary">
                Last Updated
              </Typography>
              <Typography variant="body1">
                {format(safeToDate(editedAssignment.updatedAt), 'MMM dd, yyyy HH:mm')}
              </Typography>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs value={tabValue} onChange={(_, newValue) => setTabValue(newValue)}>
          <Tab label="Overview" />
          <Tab label="Timesheets" />
          <Tab label="Activity" />
        </Tabs>
      </Box>

      {/* Overview Tab */}
      <TabPanel value={tabValue} index={0}>
        <Grid container spacing={3}>
          {/* Candidate Information */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Candidate Information
                </Typography>
                
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
                  <Avatar sx={{ width: 64, height: 64, mr: 2, bgcolor: 'primary.main' }}>
                    <PersonIcon />
                  </Avatar>
                  <Box>
                    <Typography variant="h6">
                      Candidate {editedAssignment.candidateId}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      ID: {editedAssignment.candidateId}
                    </Typography>
                  </Box>
                </Box>

                {editedAssignment.applicationId && (
                  <Alert severity="info" sx={{ mb: 2 }}>
                    This assignment was created from Application ID: {editedAssignment.applicationId}
                  </Alert>
                )}
              </CardContent>
            </Card>
          </Grid>

          {/* Assignment Details */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Assignment Details
                </Typography>
                
                <Stack spacing={2}>
                  <Box>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      Start Date
                    </Typography>
                    {isEditing ? (
                      <TextField
                        type="date"
                        value={editedAssignment.startDate}
                        onChange={(e) => setEditedAssignment(prev => ({
                          ...prev,
                          startDate: e.target.value
                        }))}
                        fullWidth
                        size="small"
                      />
                    ) : (
                      <Typography variant="body1">
                        {format(new Date(editedAssignment.startDate), 'MMM dd, yyyy')}
                      </Typography>
                    )}
                  </Box>

                  <Box>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      End Date
                    </Typography>
                    {isEditing ? (
                      <TextField
                        type="date"
                        value={editedAssignment.endDate || ''}
                        onChange={(e) => setEditedAssignment(prev => ({
                          ...prev,
                          endDate: e.target.value || undefined
                        }))}
                        fullWidth
                        size="small"
                      />
                    ) : (
                      <Typography variant="body1">
                        {editedAssignment.endDate 
                          ? format(new Date(editedAssignment.endDate), 'MMM dd, yyyy')
                          : 'Indefinite'
                        }
                      </Typography>
                    )}
                  </Box>

                  <Box>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      Worksite
                    </Typography>
                    {isEditing ? (
                      <TextField
                        value={editedAssignment.worksite}
                        onChange={(e) => setEditedAssignment(prev => ({
                          ...prev,
                          worksite: e.target.value
                        }))}
                        fullWidth
                        size="small"
                      />
                    ) : (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <LocationIcon color="action" />
                        <Typography variant="body1">
                          {editedAssignment.worksite}
                        </Typography>
                      </Box>
                    )}
                  </Box>

                  <Box>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      Timesheet Mode
                    </Typography>
                    {isEditing ? (
                      <FormControl fullWidth size="small">
                        <InputLabel>Mode</InputLabel>
                        <Select
                          value={editedAssignment.timesheetMode}
                          label="Mode"
                          onChange={(e) => setEditedAssignment(prev => ({
                            ...prev,
                            timesheetMode: e.target.value as any
                          }))}
                        >
                          <MenuItem value="mobile">Mobile</MenuItem>
                          <MenuItem value="kiosk">Kiosk</MenuItem>
                          <MenuItem value="paper">Paper</MenuItem>
                        </Select>
                      </FormControl>
                    ) : (
                      <Typography variant="body1" sx={{ textTransform: 'capitalize' }}>
                        {editedAssignment.timesheetMode}
                      </Typography>
                    )}
                  </Box>
                </Stack>
              </CardContent>
            </Card>
          </Grid>

          {/* Pay & Bill Rates */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Pay & Bill Rates
                </Typography>
                
                <Stack spacing={2}>
                  <Box>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      Pay Rate
                    </Typography>
                    {isEditing ? (
                      <TextField
                        type="number"
                        value={editedAssignment.payRate}
                        onChange={(e) => setEditedAssignment(prev => ({
                          ...prev,
                          payRate: parseFloat(e.target.value) || 0
                        }))}
                        fullWidth
                        size="small"
                        InputProps={{
                          startAdornment: <Typography sx={{ mr: 1 }}>$</Typography>
                        }}
                      />
                    ) : (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <MoneyIcon color="action" />
                        <Typography variant="h6">
                          {formatCurrency(editedAssignment.payRate)}
                        </Typography>
                      </Box>
                    )}
                  </Box>

                  <Box>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      Bill Rate
                    </Typography>
                    {isEditing ? (
                      <TextField
                        type="number"
                        value={editedAssignment.billRate}
                        onChange={(e) => setEditedAssignment(prev => ({
                          ...prev,
                          billRate: parseFloat(e.target.value) || 0
                        }))}
                        fullWidth
                        size="small"
                        InputProps={{
                          startAdornment: <Typography sx={{ mr: 1 }}>$</Typography>
                        }}
                      />
                    ) : (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <MoneyIcon color="action" />
                        <Typography variant="h6">
                          {formatCurrency(editedAssignment.billRate)}
                        </Typography>
                      </Box>
                    )}
                  </Box>

                  <Box>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      Margin
                    </Typography>
                    <Typography variant="h6" color="success.main">
                      {formatCurrency(editedAssignment.billRate - editedAssignment.payRate)}
                    </Typography>
                  </Box>
                </Stack>
              </CardContent>
            </Card>
          </Grid>

          {/* Notes */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Notes
                </Typography>
                
                {isEditing ? (
                  <TextField
                    multiline
                    rows={4}
                    value={editedAssignment.notes || ''}
                    onChange={(e) => setEditedAssignment(prev => ({
                      ...prev,
                      notes: e.target.value
                    }))}
                    placeholder="Add notes about this assignment..."
                    fullWidth
                  />
                ) : (
                  <Paper sx={{ p: 2, bgcolor: 'grey.50' }}>
                    <Typography variant="body2">
                      {editedAssignment.notes || 'No notes added yet'}
                    </Typography>
                  </Paper>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </TabPanel>

      {/* Timesheets Tab */}
      <TabPanel value={tabValue} index={1}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Timesheets
            </Typography>
            
            {timesheets.length === 0 ? (
              <Alert severity="info">
                No timesheets found for this assignment. Timesheet functionality will be expanded in future phases.
              </Alert>
            ) : (
              <List>
                {timesheets.map((timesheet) => (
                  <ListItem key={timesheet.id}>
                    <ListItemIcon>
                      <TimelineIcon />
                    </ListItemIcon>
                    <ListItemText
                      primary={`Period: ${format(new Date(timesheet.periodStart), 'MMM dd')} - ${format(new Date(timesheet.periodEnd), 'MMM dd, yyyy')}`}
                      secondary={`Status: ${timesheet.status} | Entries: ${timesheet.entries.length}`}
                    />
                  </ListItem>
                ))}
              </List>
            )}
          </CardContent>
        </Card>
      </TabPanel>

      {/* Activity Tab */}
      <TabPanel value={tabValue} index={2}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Activity Log
            </Typography>
            
            <Alert severity="info">
              Activity logging will be implemented in future phases. This will show all changes made to the assignment.
            </Alert>
          </CardContent>
        </Card>
      </TabPanel>

      {/* Status Change Dialog */}
      <Dialog open={statusChangeDialog} onClose={() => setStatusChangeDialog(false)}>
        <DialogTitle>Change Assignment Status</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Current status: <strong>{editedAssignment.status}</strong>
          </Typography>
          <FormControl fullWidth>
            <InputLabel>New Status</InputLabel>
            <Select
              value={newStatus}
              label="New Status"
              onChange={(e) => setNewStatus(e.target.value as AssignmentStatus)}
            >
              {getStatusOptions(editedAssignment.status).map(status => (
                <MenuItem key={status} value={status}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {getStatusIcon(status)}
                    {status}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStatusChangeDialog(false)}>Cancel</Button>
          <Button 
            variant="contained" 
            onClick={() => {
              handleStatusChange(newStatus);
              setStatusChangeDialog(false);
            }}
            disabled={loading}
          >
            Update Status
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default AssignmentDetail;

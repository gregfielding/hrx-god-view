import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  Grid,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Stack,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  Autocomplete,
  Paper,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton
} from '@mui/material';
import {
  Person as PersonIcon,
  Work as WorkIcon,
  Save as SaveIcon,
  Cancel as CancelIcon,
  Search as SearchIcon,
  Add as AddIcon,
  Delete as DeleteIcon
} from '@mui/icons-material';
import { 
  AssignmentFormData, 
  AssignmentStatus, 
  TimesheetMode, 
  ShiftTemplate,
  Application 
} from '../../types/phase2';
import { getAssignmentService } from '../../services/phase2/assignmentService';
import { getApplicationService } from '../../services/phase2/applicationService';

interface CreateAssignmentProps {
  tenantId: string;
  jobOrderId: string;
  open: boolean;
  onClose: () => void;
  onSuccess: (assignmentId: string) => void;
  sourceApplication?: Application; // If converting from application
}

interface Candidate {
  id: string;
  name: string;
  email?: string;
  phone?: string;
}

const CreateAssignment: React.FC<CreateAssignmentProps> = ({
  tenantId,
  jobOrderId,
  open,
  onClose,
  onSuccess,
  sourceApplication
}) => {
  const [formData, setFormData] = useState<AssignmentFormData>({
    jobOrderId,
    applicationId: sourceApplication?.id,
    candidateId: sourceApplication?.candidate ? `${sourceApplication.candidate.firstName} ${sourceApplication.candidate.lastName}` : '',
    status: 'proposed',
    startDate: new Date().toISOString().split('T')[0],
    endDate: undefined,
    payRate: 0,
    billRate: 0,
    worksite: '',
    shiftTemplateId: undefined,
    timesheetMode: 'mobile',
    notes: ''
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [shiftTemplates, setShiftTemplates] = useState<ShiftTemplate[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [showApplicationSelector, setShowApplicationSelector] = useState(false);
  const [selectedApplication, setSelectedApplication] = useState<Application | null>(sourceApplication || null);

  const assignmentService = getAssignmentService();
  const applicationService = getApplicationService();

  useEffect(() => {
    if (open) {
      loadShiftTemplates();
      if (!sourceApplication) {
        loadApplications();
      }
    }
  }, [open, sourceApplication]);

  useEffect(() => {
    if (selectedApplication) {
      setFormData(prev => ({
        ...prev,
        applicationId: selectedApplication.id,
        candidateId: `${selectedApplication.candidate.firstName} ${selectedApplication.candidate.lastName}`,
        notes: `Converted from application: ${selectedApplication.candidate.firstName} ${selectedApplication.candidate.lastName}`
      }));
    }
  }, [selectedApplication]);

  const loadShiftTemplates = async () => {
    try {
      const templates = await assignmentService.getShiftTemplates(tenantId, jobOrderId);
      setShiftTemplates(templates);
    } catch (error) {
      console.error('Error loading shift templates:', error);
    }
  };

  const loadApplications = async () => {
    try {
      const apps = await applicationService.getApplications(tenantId, {
        jobOrderId,
        status: 'hired' // Only show hired applications for conversion
      });
      setApplications(apps);
    } catch (error) {
      console.error('Error loading applications:', error);
    }
  };

  const handleInputChange = (field: keyof AssignmentFormData, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSubmit = async () => {
    try {
      setLoading(true);
      setError(null);

      // Validate required fields
      if (!formData.candidateId || !formData.startDate || !formData.worksite) {
        setError('Candidate, start date, and worksite are required');
        return;
      }

      if (formData.payRate <= 0 || formData.billRate <= 0) {
        setError('Pay rate and bill rate must be greater than 0');
        return;
      }

      if (formData.billRate <= formData.payRate) {
        setError('Bill rate must be greater than pay rate');
        return;
      }

      const assignmentId = await assignmentService.createAssignment(
        tenantId,
        jobOrderId,
        formData,
        'current-user' // TODO: Get actual user ID
      );

      onSuccess(assignmentId);
      onClose();
      
      // Reset form
      setFormData({
        jobOrderId,
        applicationId: undefined,
        candidateId: '',
        status: 'proposed',
        startDate: new Date().toISOString().split('T')[0],
        endDate: undefined,
        payRate: 0,
        billRate: 0,
        worksite: '',
        shiftTemplateId: undefined,
        timesheetMode: 'mobile',
        notes: ''
      });
      setSelectedApplication(null);
    } catch (error) {
      console.error('Error creating assignment:', error);
      setError('Failed to create assignment. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    onClose();
    setError(null);
    setSelectedApplication(null);
  };

  const handleApplicationSelect = (application: Application) => {
    setSelectedApplication(application);
    setShowApplicationSelector(false);
  };

  const handleRemoveApplication = () => {
    setSelectedApplication(null);
    setFormData(prev => ({
      ...prev,
      applicationId: undefined,
      candidateId: '',
      notes: ''
    }));
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <WorkIcon />
          <Typography variant="h6">
            {sourceApplication ? 'Convert Application to Assignment' : 'Create New Assignment'}
          </Typography>
        </Box>
      </DialogTitle>
      
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Grid container spacing={3}>
          {/* Source Application (if converting) */}
          {!sourceApplication && (
            <Grid item xs={12}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Source Application
                  </Typography>
                  
                  {selectedApplication ? (
                    <Paper sx={{ p: 2, bgcolor: 'grey.50' }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Box>
                          <Typography variant="body1" fontWeight="medium">
                            {selectedApplication.candidate.firstName} {selectedApplication.candidate.lastName}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            Application ID: {selectedApplication.id} | Status: {selectedApplication.status}
                          </Typography>
                          {selectedApplication.candidate.email && (
                            <Typography variant="body2" color="text.secondary">
                              Email: {selectedApplication.candidate.email}
                            </Typography>
                          )}
                        </Box>
                        <IconButton onClick={handleRemoveApplication} color="error">
                          <DeleteIcon />
                        </IconButton>
                      </Box>
                    </Paper>
                  ) : (
                    <Box>
                      <Button
                        variant="outlined"
                        startIcon={<SearchIcon />}
                        onClick={() => setShowApplicationSelector(true)}
                        fullWidth
                      >
                        Select Application to Convert
                      </Button>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, textAlign: 'center' }}>
                        Or create assignment manually by filling out the form below
                      </Typography>
                    </Box>
                  )}
                </CardContent>
              </Card>
            </Grid>
          )}

          {/* Candidate Information */}
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Candidate Information
                </Typography>
                
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="Candidate ID *"
                      value={formData.candidateId}
                      onChange={(e) => handleInputChange('candidateId', e.target.value)}
                      required
                      disabled={!!selectedApplication}
                      helperText={selectedApplication ? "Auto-filled from selected application" : "Enter candidate ID"}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <FormControl fullWidth>
                      <InputLabel>Status</InputLabel>
                      <Select
                        value={formData.status}
                        label="Status"
                        onChange={(e) => handleInputChange('status', e.target.value)}
                      >
                        <MenuItem value="proposed">Proposed</MenuItem>
                        <MenuItem value="confirmed">Confirmed</MenuItem>
                        <MenuItem value="active">Active</MenuItem>
                        <MenuItem value="completed">Completed</MenuItem>
                        <MenuItem value="ended">Ended</MenuItem>
                        <MenuItem value="canceled">Canceled</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                </Grid>
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
                  <TextField
                    fullWidth
                    label="Start Date *"
                    type="date"
                    value={formData.startDate}
                    onChange={(e) => handleInputChange('startDate', e.target.value)}
                    InputLabelProps={{ shrink: true }}
                    required
                  />
                  
                  <TextField
                    fullWidth
                    label="End Date"
                    type="date"
                    value={formData.endDate || ''}
                    onChange={(e) => handleInputChange('endDate', e.target.value || undefined)}
                    InputLabelProps={{ shrink: true }}
                    helperText="Leave blank for indefinite assignment"
                  />
                  
                  <TextField
                    fullWidth
                    label="Worksite *"
                    value={formData.worksite}
                    onChange={(e) => handleInputChange('worksite', e.target.value)}
                    required
                    placeholder="Enter worksite location"
                  />
                  
                  <FormControl fullWidth>
                    <InputLabel>Shift Template</InputLabel>
                    <Select
                      value={formData.shiftTemplateId || ''}
                      label="Shift Template"
                      onChange={(e) => handleInputChange('shiftTemplateId', e.target.value || undefined)}
                    >
                      <MenuItem value="">No template</MenuItem>
                      {shiftTemplates.map(template => (
                        <MenuItem key={template.id} value={template.id}>
                          {template.name} ({template.daysOfWeek.join(', ')})
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  
                  <FormControl fullWidth>
                    <InputLabel>Timesheet Mode</InputLabel>
                    <Select
                      value={formData.timesheetMode}
                      label="Timesheet Mode"
                      onChange={(e) => handleInputChange('timesheetMode', e.target.value)}
                    >
                      <MenuItem value="mobile">Mobile</MenuItem>
                      <MenuItem value="kiosk">Kiosk</MenuItem>
                      <MenuItem value="paper">Paper</MenuItem>
                    </Select>
                  </FormControl>
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
                  <TextField
                    fullWidth
                    label="Pay Rate *"
                    type="number"
                    value={formData.payRate}
                    onChange={(e) => handleInputChange('payRate', parseFloat(e.target.value) || 0)}
                    required
                    InputProps={{
                      startAdornment: <Typography sx={{ mr: 1 }}>$</Typography>
                    }}
                    helperText="Hourly rate paid to candidate"
                  />
                  
                  <TextField
                    fullWidth
                    label="Bill Rate *"
                    type="number"
                    value={formData.billRate}
                    onChange={(e) => handleInputChange('billRate', parseFloat(e.target.value) || 0)}
                    required
                    InputProps={{
                      startAdornment: <Typography sx={{ mr: 1 }}>$</Typography>
                    }}
                    helperText="Hourly rate billed to client"
                  />
                  
                  <Paper sx={{ p: 2, bgcolor: 'grey.50' }}>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      Margin
                    </Typography>
                    <Typography variant="h6" color="success.main">
                      ${(formData.billRate - formData.payRate).toFixed(2)}/hour
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {formData.payRate > 0 ? 
                        `${(((formData.billRate - formData.payRate) / formData.payRate) * 100).toFixed(1)}% margin`
                        : '0% margin'
                      }
                    </Typography>
                  </Paper>
                </Stack>
              </CardContent>
            </Card>
          </Grid>

          {/* Notes */}
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Notes
                </Typography>
                
                <TextField
                  multiline
                  rows={4}
                  label="Assignment Notes"
                  value={formData.notes}
                  onChange={(e) => handleInputChange('notes', e.target.value)}
                  placeholder="Add any notes about this assignment..."
                  fullWidth
                />
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </DialogContent>
      
      <DialogActions>
        <Button onClick={handleClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={loading || !formData.candidateId || !formData.startDate || !formData.worksite}
          startIcon={<SaveIcon />}
        >
          {loading ? 'Creating...' : 'Create Assignment'}
        </Button>
      </DialogActions>

      {/* Application Selector Dialog */}
      <Dialog 
        open={showApplicationSelector} 
        onClose={() => setShowApplicationSelector(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Select Application to Convert</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Select a hired application to convert to an assignment:
          </Typography>
          
          {applications.length === 0 ? (
            <Alert severity="info">
              No hired applications found for this job order.
            </Alert>
          ) : (
            <List>
              {applications.map((application) => (
                <ListItem 
                  key={application.id}
                  button
                  onClick={() => handleApplicationSelect(application)}
                >
                  <ListItemText
                    primary={`${application.candidate.firstName} ${application.candidate.lastName}`}
                    secondary={
                      <Box>
                        <Typography variant="body2" color="text.secondary">
                          Email: {application.candidate.email || 'No email'}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Phone: {application.candidate.phone || 'No phone'}
                        </Typography>
                        <Chip 
                          label={application.status} 
                          size="small" 
                          color="success"
                          sx={{ mt: 1 }}
                        />
                      </Box>
                    }
                  />
                </ListItem>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowApplicationSelector(false)}>
            Cancel
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
};

export default CreateAssignment;

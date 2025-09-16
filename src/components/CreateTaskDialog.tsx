import React, { useState, useEffect } from 'react';
import { 
  getCurrentLocalDate, 
  getCurrentLocalDateTime, 
  localDateTimeToUTC, 
  getUserTimezone 
} from '../utils/dateUtils';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Box,
  Typography,
  ToggleButton,
  ToggleButtonGroup,
  Grid,
  FormControlLabel,
  Switch,
  Alert,
  CircularProgress,
  Chip,
  Autocomplete,
  Tooltip
} from '@mui/material';
import {
  Assignment as AssignmentIcon,
  Schedule as ScheduleIcon,
  CheckCircle as CheckCircleIcon
} from '@mui/icons-material';

import { TaskClassification, TaskCategory } from '../types/Tasks';

interface CreateTaskDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (taskData: any) => void;
  prefilledData?: any;
  loading?: boolean;
  salespeople?: any[];
  contacts?: any[];
  currentUserId?: string;
}

  const CreateTaskDialog: React.FC<CreateTaskDialogProps> = ({
    open,
    onClose,
    onSubmit,
    prefilledData,
    loading = false,
    salespeople = [],
    contacts = [],
    currentUserId = ''
  }) => {
          // REMOVED: Excessive logging causing re-renders
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    type: 'custom',
    priority: 'medium',
    status: 'scheduled',
    classification: 'todo' as TaskClassification, // NEW: Default to todo
    startTime: '', // NEW: For appointments
    duration: 30, // FIXED: Default to 30 instead of undefined
    scheduledDate: new Date().toISOString().split('T')[0],
    dueDate: new Date().toISOString().split('T')[0],
    assignedTo: currentUserId ? [currentUserId] : [],
    estimatedDuration: 0,
    category: 'general' as TaskCategory,
    quotaCategory: 'business_generating',
    notes: '',
    tags: [] as string[],
    aiSuggested: false,
    aiPrompt: '',
    associations: {
      companies: [],
      contacts: [],
      deals: [],
      salespeople: []
    },
    // Task-type-specific fields
    agenda: '',
    goals: [] as string[],
    researchTopics: [] as string[],
    callScript: '',
    emailTemplate: '',
    followUpNotes: '',
    meetingAttendees: [] as Array<{
      email: string;
      displayName?: string;
      responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
    }>,
    // Repeating task fields
    isRepeating: false,
    repeatInterval: 30
  });

  const [errors, setErrors] = useState<{[key: string]: string}>({});

  useEffect(() => {
    if (prefilledData) {
      setFormData({
        ...formData,
        ...prefilledData,
        classification: prefilledData.classification || 'todo',
        startTime: prefilledData.startTime || (prefilledData.classification === 'appointment' ? getCurrentLocalDateTime() : ''),
        duration: prefilledData.classification === 'appointment' ? prefilledData.duration || 30 : 30,
        // Ensure associations are properly merged
        associations: {
          companies: prefilledData.associations?.companies || [],
          contacts: prefilledData.associations?.contacts || [],
          deals: prefilledData.associations?.deals || [],
          salespeople: prefilledData.associations?.salespeople || []
        }
      });
    }
  }, [prefilledData]);

  // Auto-populate meeting attendees when type is Google Meet and we have contacts
  useEffect(() => {
    if (formData.type === 'scheduled_meeting_virtual' && formData.associations?.contacts?.length > 0) {
      updateMeetingAttendees(formData);
    }
  }, [formData.type, formData.associations?.contacts]);

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => {
      const newFormData = { ...prev, [field]: value };
      
      // Auto-populate meeting attendees when Google Meet is selected
      if (field === 'type' && value === 'scheduled_meeting_virtual') {
        updateMeetingAttendees(newFormData);
      }
      
      return newFormData;
    });
    
    // Clear errors when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const handleAssociationChange = (type: string, value: any) => {
    setFormData(prev => {
      const newFormData = {
        ...prev,
        associations: {
          ...prev.associations,
          [type]: value
        }
      };
      
      // Auto-update meeting attendees when associations change and it's a Google Meet
      if (newFormData.type === 'scheduled_meeting_virtual') {
        updateMeetingAttendees(newFormData);
      }
      
      return newFormData;
    });
  };

  const updateMeetingAttendees = (formData: any) => {
    const attendees = [];
    
    // Add company contacts from associations
    if (formData.associations?.contacts) {
      formData.associations.contacts.forEach((contactId: string) => {
        const contactData = contacts.find(c => c.id === contactId);
        if (contactData?.email) {
          attendees.push({
            email: contactData.email,
            displayName: contactData.fullName || contactData.name || contactData.email,
            responseStatus: 'needsAction' as const
          });
        }
      });
    }
    
    // Add assigned salespeople
    if (formData.assignedTo) {
      const assignedToArray = Array.isArray(formData.assignedTo) ? formData.assignedTo : [formData.assignedTo];
      assignedToArray.forEach((salespersonId: string) => {
        const salespersonData = salespeople.find(s => s.id === salespersonId);
        if (salespersonData?.email && !attendees.find(a => a.email === salespersonData.email)) {
          attendees.push({
            email: salespersonData.email,
            displayName: salespersonData.fullName || salespersonData.name || salespersonData.displayName || salespersonData.email,
            responseStatus: 'needsAction' as const
          });
        }
      });
    }
    
    // Update the form data with the new attendees
    setFormData(prev => ({
      ...prev,
      meetingAttendees: attendees
    }));
  };



  const validateForm = () => {
    const newErrors: {[key: string]: string} = {};

    if (!formData.title.trim()) {
      newErrors.title = 'Title is required';
    }

    if (formData.classification === 'appointment') {
      if (!formData.startTime) {
        newErrors.startTime = 'Start time is required for appointments';
      }
      if (!formData.duration || formData.duration <= 0) {
        newErrors.duration = 'Duration must be greater than 0';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (!validateForm()) return;

    // For appointments, extract date from startTime and set scheduledDate
    let scheduledDate = formData.scheduledDate;
    let startTimeForSync = formData.startTime;
    
    if (formData.classification === 'appointment' && formData.startTime) {
      scheduledDate = formData.startTime.split('T')[0];
      
      // Convert local datetime to UTC for Google Calendar sync
      startTimeForSync = localDateTimeToUTC(formData.startTime);
    }

    const taskData = {
      ...formData,
      scheduledDate: scheduledDate,
      startTime: startTimeForSync, // Use UTC time for sync
      duration: formData.classification === 'appointment' && formData.duration ? Number(formData.duration) : 30,
      estimatedDuration: Number(formData.estimatedDuration || 0),
      // Include repeating task data
      isRepeating: formData.isRepeating,
      repeatInterval: formData.isRepeating ? Number(formData.repeatInterval) : 30,
      // Add user's timezone for proper sync
      userTimezone: getUserTimezone()
    };

    onSubmit(taskData);
  };

  const handleClose = () => {
    setFormData({
      title: '',
      description: '',
      type: 'custom',
      priority: 'medium',
      status: 'scheduled',
      classification: 'todo',
      startTime: '',
      duration: 30,
      scheduledDate: getCurrentLocalDate(),
      dueDate: getCurrentLocalDate(),
      assignedTo: currentUserId ? [currentUserId] : [],
      estimatedDuration: 0,
      category: 'general' as TaskCategory,
      quotaCategory: 'business_generating',
      notes: '',
      tags: [],
      aiSuggested: false,
      aiPrompt: '',
      associations: {
        companies: [],
        contacts: [],
        deals: [],
        salespeople: []
      },
      // Task-type-specific fields
      agenda: '',
      goals: [],
      researchTopics: [],
      callScript: '',
      emailTemplate: '',
      followUpNotes: '',
      meetingAttendees: [],
      // Repeating task fields
      isRepeating: false,
      repeatInterval: 30
    });
    setErrors({});
    onClose();
  };

  const durationOptions = [
    { value: 15, label: '15 minutes' },
    { value: 30, label: '30 minutes' },
    { value: 45, label: '45 minutes' },
    { value: 60, label: '1 hour' },
    { value: 90, label: '1.5 hours' },
    { value: 120, label: '2 hours' },
    { value: 180, label: '3 hours' },
    { value: 240, label: '4 hours' },
    { value: 480, label: '8 hours' }
  ];

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          <AssignmentIcon />
          Create New Task
        </Box>
      </DialogTitle>
      
      <DialogContent>
        <Grid container spacing={2}>
          {/* Task Classification */}
          <Grid item xs={12}>
            <ToggleButtonGroup
              value={formData.classification}
              exclusive
              onChange={(_, value) => value && handleInputChange('classification', value)}
              sx={{ mb: 2 }}
            >
              <ToggleButton value="todo">
                <CheckCircleIcon sx={{ mr: 1 }} />
                To-Do Item
              </ToggleButton>
              <ToggleButton value="appointment">
                <ScheduleIcon sx={{ mr: 1 }} />
                Appointment
              </ToggleButton>
            </ToggleButtonGroup>
            
            {formData.classification === 'appointment' && (
              <Alert severity="info" sx={{ mb: 2 }}>
                Appointments will sync to Google Calendar
              </Alert>
            )}
            
            {formData.classification === 'todo' && (
              <Alert severity="info" sx={{ mb: 2 }}>
                To-do items will sync to Google Tasks
              </Alert>
            )}
          </Grid>
          {/* Basic Information */}
          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Task Title"
              value={formData.title}
              onChange={(e) => handleInputChange('title', e.target.value)}
              error={!!errors.title}
              helperText={errors.title}
              required
            />
          </Grid>

          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Description"
              value={formData.description}
              onChange={(e) => handleInputChange('description', e.target.value)}
              multiline
              rows={3}
            />
          </Grid>

          {/* Appointment-specific fields */}
          {/* Date and Duration for Appointments */}
          {formData.classification === 'appointment' && (
            <>
              <Grid item xs={8}>
                <TextField
                  fullWidth
                  label="Date"
                  type="datetime-local"
                  value={formData.startTime}
                  onChange={(e) => handleInputChange('startTime', e.target.value)}
                  error={!!errors.startTime}
                  helperText={errors.startTime}
                  required
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              
              <Grid item xs={4}>
                <FormControl fullWidth error={!!errors.duration}>
                  <InputLabel>Duration</InputLabel>
                  <Select
                    value={formData.duration || 30}
                    onChange={(e) => handleInputChange('duration', e.target.value)}
                    label="Duration"
                  >
                    {durationOptions.map(option => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                    <MenuItem value="custom">Custom</MenuItem>
                  </Select>
                  {errors.duration && (
                    <Typography variant="caption" color="error">
                      {errors.duration}
                    </Typography>
                  )}
                </FormControl>
              </Grid>
            </>
          )}

          {/* Date for Todos */}
          {formData.classification === 'todo' && (
            <>
              <Grid item xs={6}>
                <TextField
                  fullWidth
                  label="Due Date"
                  type="date"
                  value={formData.dueDate}
                  onChange={(e) => handleInputChange('dueDate', e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              
              {/* Repeating Task Section */}
              <Grid item xs={12}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={formData.isRepeating}
                      onChange={(e) => handleInputChange('isRepeating', e.target.checked)}
                      color="primary"
                    />
                  }
                  label="Scheduled Repeating Activity"
                />
              </Grid>
              
              {formData.isRepeating && (
                <Grid item xs={6}>
                  <FormControl fullWidth>
                    <InputLabel>Repeat Every</InputLabel>
                    <Select
                      value={formData.repeatInterval || 30}
                      onChange={(e) => handleInputChange('repeatInterval', e.target.value)}
                      label="Repeat Every"
                    >
                      <MenuItem value={14}>14 days</MenuItem>
                      <MenuItem value={30}>30 days</MenuItem>
                      <MenuItem value={45}>45 days</MenuItem>
                      <MenuItem value={60}>60 days</MenuItem>
                      <MenuItem value={75}>75 days</MenuItem>
                      <MenuItem value={90}>90 days</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
              )}
            </>
          )}

          <Grid item xs={6}>
            <FormControl fullWidth>
              <InputLabel>Priority</InputLabel>
              <Select
                value={formData.priority}
                onChange={(e) => handleInputChange('priority', e.target.value)}
                label="Priority"
              >
                <MenuItem value="low">Low</MenuItem>
                <MenuItem value="medium">Medium</MenuItem>
                <MenuItem value="high">High</MenuItem>
                <MenuItem value="urgent">Urgent</MenuItem>
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={6}>
            <FormControl fullWidth>
              <InputLabel>Type</InputLabel>
              <Select
                value={formData.type}
                onChange={(e) => handleInputChange('type', e.target.value)}
                label="Type"
              >
                <MenuItem value="email">Email</MenuItem>
                <MenuItem value="phone_call">Phone Call</MenuItem>
                <MenuItem value="linkedin_message">LinkedIn Message</MenuItem>
                <MenuItem value="scheduled_meeting_virtual">Google Meet</MenuItem>
                <MenuItem value="scheduled_meeting_in_person">In-Person Meeting</MenuItem>
                <MenuItem value="research">Research</MenuItem>
                <MenuItem value="follow_up">Follow Up</MenuItem>
                <MenuItem value="activity">Activity</MenuItem>
                <MenuItem value="custom">Custom</MenuItem>
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={6}>
            <FormControl fullWidth>
              <InputLabel>Category</InputLabel>
              <Select
                value={formData.category}
                onChange={(e) => handleInputChange('category', e.target.value)}
                label="Category"
              >
                <MenuItem value="general">General</MenuItem>
                <MenuItem value="follow_up">Follow Up</MenuItem>
                <MenuItem value="prospecting">Prospecting</MenuItem>
                <MenuItem value="presentation">Presentation</MenuItem>
                <MenuItem value="demo">Demo</MenuItem>
                <MenuItem value="proposal">Proposal</MenuItem>
                <MenuItem value="contract">Contract</MenuItem>
                <MenuItem value="onboarding">Onboarding</MenuItem>
                <MenuItem value="training">Training</MenuItem>
                <MenuItem value="admin">Admin</MenuItem>
                <MenuItem value="other">Other</MenuItem>
              </Select>
            </FormControl>
          </Grid>

          {/* Company Contacts */}
          <Grid item xs={12}>
            <Autocomplete
              multiple
              options={contacts as any[]}
              getOptionLabel={(option: any) => option?.fullName || option?.name || option?.email || ''}
              value={(contacts || []).filter((c: any) => (formData.associations?.contacts || []).includes(c.id)) as any[]}
              onChange={(_, newValue: any[]) => {
                handleAssociationChange('contacts', newValue.map(v => v.id));
              }}
              renderTags={(value, getTagProps) =>
                value.map((option: any, index: number) => (
                  <Tooltip key={option.id} title={`Click to view ${option.fullName || option.name || option.email || option.id}'s contact details`} arrow>
                    <Chip 
                      {...getTagProps({ index })} 
                      label={option.fullName || option.name || option.email || option.id} 
                      size="small"
                      clickable
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(`/tenant/crm/contacts/${option.id}`, '_blank');
                      }}
                      sx={{ 
                        cursor: 'pointer',
                        '&:hover': { 
                          backgroundColor: 'primary.light',
                          color: 'primary.contrastText'
                        }
                      }}
                    />
                  </Tooltip>
                ))
              }
              renderInput={(params) => (
                <TextField {...params} label="Company Contacts" placeholder="Select contacts" />
              )}
              disablePortal
              fullWidth
            />
          </Grid>

          {/* Salespeople */}
          <Grid item xs={12}>
            <Autocomplete
              multiple
              options={salespeople as any[]}
              getOptionLabel={(option: any) => option?.displayName || option?.fullName || option?.name || option?.email || ''}
              value={(salespeople || []).filter((s: any) => (formData.associations?.salespeople || []).includes(s.id)) as any[]}
              onChange={(_, newValue: any[]) => {
                handleAssociationChange('salespeople', newValue.map(v => v.id));
              }}
              renderTags={(value, getTagProps) =>
                value.map((option: any, index: number) => (
                  <Tooltip key={option.id} title={`Click to search for ${option.displayName || option.fullName || option.name || option.email || option.id} in contacts`} arrow>
                    <Chip 
                      {...getTagProps({ index })} 
                      label={option.displayName || option.fullName || option.name || option.email || option.id} 
                      size="small"
                      clickable
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(`/tenant/crm/contacts?search=${encodeURIComponent(option.email || option.displayName || option.fullName || option.name)}`, '_blank');
                      }}
                      sx={{ 
                        cursor: 'pointer',
                        '&:hover': { 
                          backgroundColor: 'primary.light',
                          color: 'primary.contrastText'
                        }
                      }}
                    />
                  </Tooltip>
                ))
              }
              renderInput={(params) => (
                <TextField {...params} label="Salespeople" placeholder="Select salespeople" />
              )}
              disablePortal
              fullWidth
            />
          </Grid>

          {/* Task Type Specific Fields */}
          {formData.type === 'scheduled_meeting_virtual' ? (
            <>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Meeting Agenda"
                  value={formData.agenda}
                  onChange={(e) => handleInputChange('agenda', e.target.value)}
                  multiline
                  rows={3}
                  placeholder="What will be discussed in this Google Meet?"
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Meeting Goals"
                  value={formData.goals.join(', ')}
                  onChange={(e) => handleInputChange('goals', e.target.value.split(',').map(g => g.trim()).filter(g => g))}
                  multiline
                  rows={2}
                  placeholder="What do you want to accomplish? (comma-separated)"
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Meeting Attendees"
                  value={formData.meetingAttendees?.map(a => a.email).join(', ') || ''}
                  onChange={(e) => {
                    const emails = e.target.value.split(',').map(email => email.trim()).filter(email => email);
                    const attendees = emails.map(email => ({ email, displayName: '', responseStatus: 'needsAction' as const }));
                    handleInputChange('meetingAttendees', attendees);
                  }}
                  multiline
                  rows={2}
                  placeholder="Enter email addresses separated by commas (e.g., john@company.com, jane@company.com)"
                  helperText="Attendees will receive Google Calendar invites with the Meet link"
                />
              </Grid>
              <Grid item xs={12}>
                <Box sx={{ p: 2, bgcolor: 'info.light', borderRadius: 1, border: '1px solid', borderColor: 'info.main' }}>
                  <Typography variant="body2" color="info.main" sx={{ fontWeight: 500, mb: 1 }}>
                    🎥 Google Meet Integration
                  </Typography>
                  <Typography variant="caption" color="info.main">
                    A Google Meet link will be automatically generated when this task is created. 
                    Attendees will receive calendar invites with the meeting link.
                  </Typography>
                </Box>
              </Grid>
            </>
          ) : formData.type === 'scheduled_meeting_in_person' ? (
            <>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Meeting Agenda"
                  value={formData.agenda}
                  onChange={(e) => handleInputChange('agenda', e.target.value)}
                  multiline
                  rows={3}
                  placeholder="What will be discussed in this meeting?"
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Meeting Goals"
                  value={formData.goals.join(', ')}
                  onChange={(e) => handleInputChange('goals', e.target.value.split(',').map(g => g.trim()).filter(g => g))}
                  multiline
                  rows={2}
                  placeholder="What do you want to accomplish? (comma-separated)"
                />
              </Grid>
            </>
          ) : formData.type === 'research' ? (
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Research Topics"
                value={formData.researchTopics.join(', ')}
                onChange={(e) => handleInputChange('researchTopics', e.target.value.split(',').map(t => t.trim()).filter(t => t))}
                multiline
                rows={3}
                placeholder="What are you researching? (comma-separated topics)"
              />
            </Grid>
          ) : formData.type === 'phone_call' ? (
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Call Script"
                value={formData.callScript}
                onChange={(e) => handleInputChange('callScript', e.target.value)}
                multiline
                rows={4}
                placeholder="Key points to cover during the call..."
              />
            </Grid>
          ) : formData.type === 'email' ? (
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Email Template"
                value={formData.emailTemplate}
                onChange={(e) => handleInputChange('emailTemplate', e.target.value)}
                multiline
                rows={4}
                placeholder="Draft your email content here..."
              />
            </Grid>
          ) : formData.type === 'follow_up' ? (
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Follow-up Notes"
                value={formData.followUpNotes}
                onChange={(e) => handleInputChange('followUpNotes', e.target.value)}
                multiline
                rows={3}
                placeholder="What needs to be followed up on?"
              />
            </Grid>
          ) : null}




        </Grid>
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={loading}>
          Cancel
        </Button>
        <Button 
          onClick={handleSubmit} 
          variant="contained" 
          disabled={loading}
          startIcon={loading ? <CircularProgress size={16} /> : <AssignmentIcon />}
        >
          {loading ? 'Creating...' : 'Create Task'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default React.memo(CreateTaskDialog); 
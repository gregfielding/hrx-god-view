import React, { useState, useEffect } from 'react';
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
  Chip,
  ToggleButton,
  ToggleButtonGroup,
  Grid,
  FormControlLabel,
  Switch,
  Alert,
  CircularProgress
} from '@mui/material';
import {
  Assignment as AssignmentIcon,
  Schedule as ScheduleIcon,
  CheckCircle as CheckCircleIcon,
  AutoAwesome as AutoAwesomeIcon
} from '@mui/icons-material';
import { TaskClassification } from '../types/Tasks';

interface CreateTaskDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (taskData: any) => void;
  prefilledData?: any;
  loading?: boolean;
}

const CreateTaskDialog: React.FC<CreateTaskDialogProps> = ({
  open,
  onClose,
  onSubmit,
  prefilledData,
  loading = false
}) => {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    type: 'custom',
    priority: 'medium',
    status: 'scheduled',
    classification: 'todo' as TaskClassification, // NEW: Default to todo
    startTime: '', // NEW: For appointments
    duration: 30, // NEW: Duration in minutes for appointments
    scheduledDate: new Date().toISOString().split('T')[0],
    dueDate: '',
    estimatedDuration: 30,
    category: 'general',
    quotaCategory: 'business_generating',
    notes: '',
    tags: [] as string[],
    aiSuggested: false,
    aiPrompt: ''
  });

  const [errors, setErrors] = useState<{[key: string]: string}>({});

  useEffect(() => {
    if (prefilledData) {
      setFormData({
        ...formData,
        ...prefilledData,
        classification: prefilledData.classification || 'todo',
        startTime: prefilledData.startTime || '',
        duration: prefilledData.duration || 30
      });
    }
  }, [prefilledData]);

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    
    // Clear errors when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
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

    const taskData = {
      ...formData,
      // Convert duration to number
      duration: parseInt(formData.duration.toString()),
      estimatedDuration: parseInt(formData.estimatedDuration.toString())
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
      scheduledDate: new Date().toISOString().split('T')[0],
      dueDate: '',
      estimatedDuration: 30,
      category: 'general',
      quotaCategory: 'business_generating',
      notes: '',
      tags: [],
      aiSuggested: false,
      aiPrompt: ''
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
        <Box sx={{ mb: 3 }}>
          {/* Task Classification Toggle */}
          <Typography variant="subtitle1" sx={{ mb: 2 }}>
            Task Type
          </Typography>
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
        </Box>

        <Grid container spacing={2}>
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
          {formData.classification === 'appointment' && (
            <>
              <Grid item xs={6}>
                <TextField
                  fullWidth
                  label="Start Time"
                  type="datetime-local"
                  value={formData.startTime}
                  onChange={(e) => handleInputChange('startTime', e.target.value)}
                  error={!!errors.startTime}
                  helperText={errors.startTime}
                  required
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              
              <Grid item xs={6}>
                <FormControl fullWidth error={!!errors.duration}>
                  <InputLabel>Duration</InputLabel>
                  <Select
                    value={formData.duration}
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

          {/* General fields */}
          <Grid item xs={6}>
            <TextField
              fullWidth
              label="Date"
              type="date"
              value={formData.scheduledDate}
              onChange={(e) => handleInputChange('scheduledDate', e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>

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
                <MenuItem value="scheduled_meeting_virtual">Virtual Meeting</MenuItem>
                <MenuItem value="scheduled_meeting_in_person">In-Person Meeting</MenuItem>
                <MenuItem value="research">Research</MenuItem>
                <MenuItem value="follow_up">Follow Up</MenuItem>
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

          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Notes"
              value={formData.notes}
              onChange={(e) => handleInputChange('notes', e.target.value)}
              multiline
              rows={2}
            />
          </Grid>

          {/* AI Fields */}
          <Grid item xs={12}>
            <Box display="flex" alignItems="center" gap={1}>
              <AutoAwesomeIcon color="primary" />
              <FormControlLabel
                control={
                  <Switch
                    checked={formData.aiSuggested}
                    onChange={(e) => handleInputChange('aiSuggested', e.target.checked)}
                  />
                }
                label="AI Suggested"
              />
            </Box>
          </Grid>

          {formData.aiSuggested && (
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="AI Prompt"
                value={formData.aiPrompt}
                onChange={(e) => handleInputChange('aiPrompt', e.target.value)}
                multiline
                rows={2}
                placeholder="What AI prompt was used to generate this task?"
              />
            </Grid>
          )}
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

export default CreateTaskDialog; 
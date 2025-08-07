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
  CircularProgress,
  Tabs,
  Tab,
  LinearProgress,
  Autocomplete
} from '@mui/material';
import {
  Assignment as AssignmentIcon,
  Schedule as ScheduleIcon,
  CheckCircle as CheckCircleIcon,
  AutoAwesome as AutoAwesomeIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Save as SaveIcon
} from '@mui/icons-material';
import { TaskService } from '../utils/taskService';
import { TaskStatus, TaskType, TaskCategory, TaskClassification } from '../types/Tasks';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

interface TaskDetailsDialogProps {
  open: boolean;
  onClose: () => void;
  task: any;
  salespersonId: string;
  tenantId: string;
  companies?: any[];
  contacts?: any[];
  deals?: any[];
  salespeople?: any[];
  onTaskUpdated?: (taskId: string) => void;
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
      id={`task-tabpanel-${index}`}
      aria-labelledby={`task-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

const TaskDetailsDialog: React.FC<TaskDetailsDialogProps> = ({
  open,
  onClose,
  task,
  salespersonId,
  tenantId,
  companies = [],
  contacts = [],
  deals = [],
  salespeople = [],
  onTaskUpdated
}) => {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    type: 'email' as TaskType,
    priority: 'medium',
    classification: 'todo' as TaskClassification,
    startTime: '',
    duration: 30,
    scheduledDate: new Date(),
    dueDate: '',
    assignedTo: salespersonId,
    category: 'follow_up' as TaskCategory,
    reason: '',
    notes: '',
    quotaCategory: 'business_generating',
    estimatedDuration: 30,
    aiSuggested: false,
    aiPrompt: '',
    associations: {
      companies: [],
      contacts: [],
      deals: [],
      salespeople: []
    },
    communicationDetails: {
      method: 'email' as const,
      recipient: '',
      subject: '',
      body: ''
    }
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tabValue, setTabValue] = useState(0);
  const [showCompletionDialog, setShowCompletionDialog] = useState(false);
  const [completionNotes, setCompletionNotes] = useState('');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [associatedCompanies, setAssociatedCompanies] = useState<any[]>([]);
  const [associatedDeals, setAssociatedDeals] = useState<any[]>([]);
  const [associatedSalespeople, setAssociatedSalespeople] = useState<any[]>([]);
  const [dealContacts, setDealContacts] = useState<any[]>([]);
  const [dealSalespeople, setDealSalespeople] = useState<any[]>([]);

  const taskService = TaskService.getInstance();

  // Calculate status based on due date
  const calculateStatus = (dueDate: string, scheduledDate: Date): TaskStatus => {
    if (!dueDate) return 'scheduled';
    
    const now = new Date();
    const due = new Date(dueDate);
    const scheduled = scheduledDate;
    
    if (due < now) {
      return 'overdue';
    } else if (due.getTime() - now.getTime() < 24 * 60 * 60 * 1000) { // Within 24 hours
      return 'due';
    } else if (scheduled > now) {
      return 'scheduled';
    } else {
      return 'upcoming';
    }
  };

  // Load associated data when task changes
  const loadAssociatedData = async () => {
    if (!task || !tenantId) return;
    
    setLoading(true);
    try {
      // Load associated companies
      if (task.associations?.companies?.length > 0) {
        const companyPromises = task.associations.companies.map(async (companyId: string) => {
          try {
            const companyDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_companies', companyId));
            return companyDoc.exists() ? { id: companyDoc.id, ...companyDoc.data() } : null;
          } catch (err) {
            console.error('Error loading company:', companyId, err);
            return null;
          }
        });
        const companies = (await Promise.all(companyPromises)).filter(Boolean);
        setAssociatedCompanies(companies);
      }

      // Load associated deals
      if (task.associations?.deals?.length > 0) {
        const dealPromises = task.associations.deals.map(async (dealId: string) => {
          try {
            const dealDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_deals', dealId));
            return dealDoc.exists() ? { id: dealDoc.id, ...dealDoc.data() } : null;
          } catch (err) {
            console.error('Error loading deal:', dealId, err);
            return null;
          }
        });
        const deals = (await Promise.all(dealPromises)).filter(Boolean);
        setAssociatedDeals(deals);
      }

      // Load associated salespeople
      if (task.associations?.salespeople?.length > 0) {
        const salespeoplePromises = task.associations.salespeople.map(async (salespersonId: string) => {
          try {
            const salespersonDoc = await getDoc(doc(db, 'tenants', tenantId, 'users', salespersonId));
            return salespersonDoc.exists() ? { id: salespersonDoc.id, ...salespersonDoc.data() } : null;
          } catch (err) {
            console.error('Error loading salesperson:', salespersonId, err);
            return null;
          }
        });
        const salespeople = (await Promise.all(salespeoplePromises)).filter(Boolean);
        setAssociatedSalespeople(salespeople);
      }

    } catch (err) {
      console.error('Error loading associated data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (task && open) {
      const status = calculateStatus(task.dueDate || '', new Date(task.scheduledDate || Date.now()));
      
      setFormData({
        title: task.title || '',
        description: task.description || '',
        type: task.type || 'email',
        priority: task.priority || 'medium',
        classification: task.classification || 'todo',
        startTime: task.startTime || '',
        duration: task.duration || 30,
        scheduledDate: task.scheduledDate ? new Date(task.scheduledDate) : new Date(),
        dueDate: task.dueDate || '',
        assignedTo: task.assignedTo || salespersonId,
        category: task.category || 'follow_up',
        reason: task.reason || '',
        notes: task.notes || '',
        quotaCategory: task.quotaCategory || 'business_generating',
        estimatedDuration: task.estimatedDuration || 30,
        aiSuggested: task.aiSuggested || false,
        aiPrompt: task.aiPrompt || '',
        associations: task.associations || {
          companies: [],
          contacts: [],
          deals: [],
          salespeople: []
        },
        communicationDetails: task.communicationDetails || {
          method: 'email',
          recipient: '',
          subject: '',
          body: ''
        }
      });
      
      // Load associated data
      loadAssociatedData();
      
      // Debug: Log the task associations
      console.log('Task associations:', task.associations);
      console.log('Task assignedTo:', task.assignedTo);
    }
  }, [task, open, salespersonId, tenantId]);

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleAssociationChange = (type: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      associations: {
        ...prev.associations,
        [type]: value
      }
    }));
  };

  const handleSubmit = async () => {
    if (!task?.id) return;

    setSaving(true);
    setError(null);

    try {
      // Calculate status based on due date
      const status = calculateStatus(formData.dueDate, formData.scheduledDate);
      
      const taskData = {
        title: formData.title,
        description: formData.description,
        type: formData.type,
        priority: formData.priority as 'low' | 'medium' | 'high' | 'urgent',
        status, // Use calculated status instead of form data
        classification: formData.classification,
        startTime: formData.classification === 'appointment' ? formData.startTime : null,
        duration: formData.classification === 'appointment' ? formData.duration : null,
        scheduledDate: formData.scheduledDate.toISOString().split('T')[0],
        dueDate: formData.dueDate,
        assignedTo: formData.assignedTo,
        category: formData.category,
        reason: formData.reason,
        notes: formData.notes,
        estimatedDuration: formData.estimatedDuration,
        quotaCategory: 'business_generating' as const,
        aiSuggested: formData.aiSuggested,
        aiPrompt: formData.aiPrompt,
        associations: formData.associations,
        communicationDetails: formData.type === 'email' ? formData.communicationDetails : undefined
      };

      await taskService.updateTask(task.id, taskData, tenantId);
      
      if (onTaskUpdated) {
        onTaskUpdated(task.id);
      }
      
      onClose();
    } catch (err) {
      console.error('Error updating task:', err);
      setError('Failed to update task');
    } finally {
      setSaving(false);
    }
  };

  const handleComplete = async () => {
    setShowCompletionDialog(true);
  };

  const handleConfirmComplete = async () => {
    if (!task?.id) return;

    setSaving(true);
    setError(null);

    try {
      await taskService.completeTask(task.id, { 
        outcome: 'positive', 
        notes: completionNotes || 'Task completed'
      }, tenantId, salespersonId);
      
      if (onTaskUpdated) {
        onTaskUpdated(task.id);
      }
      
      setShowCompletionDialog(false);
      setCompletionNotes('');
      onClose();
    } catch (err) {
      console.error('Error completing task:', err);
      setError('Failed to complete task');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    setShowDeleteDialog(true);
  };

  const handleConfirmDelete = async () => {
    if (!task?.id) return;

    setSaving(true);
    setError(null);

    try {
      await taskService.deleteTask(task.id, tenantId, salespersonId);
      
      if (onTaskUpdated) {
        onTaskUpdated(task.id);
      }
      
      setShowDeleteDialog(false);
      onClose();
    } catch (err) {
      console.error('Error deleting task:', err);
      setError('Failed to delete task');
    } finally {
      setSaving(false);
    }
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

  const currentStatus = calculateStatus(formData.dueDate, formData.scheduledDate);

  if (loading) {
    return (
      <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
        <DialogContent>
          <LinearProgress />
          <Typography variant="caption" color="text.secondary">
            Loading associated data...
          </Typography>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
        <DialogTitle>
          {task ? 'Edit Task' : 'Task Details'}
        </DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
            <Tabs value={tabValue} onChange={(e, newValue) => setTabValue(newValue)}>
              <Tab label="Task Details" />
              <Tab label="AI Suggestions" />
            </Tabs>
          </Box>

          <TabPanel value={tabValue} index={0}>
            <Grid container spacing={3} sx={{ mt: 1 }}>
              {/* Task Classification */}
              <Grid item xs={12}>
                <Typography variant="h6" gutterBottom>Task Type</Typography>
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

              {/* Basic Task Info */}
              <Grid item xs={12}>
                <Typography variant="h6" gutterBottom>Basic Task Info</Typography>
              </Grid>
              <Grid item xs={12} md={8}>
                <TextField
                  fullWidth
                  label="Task Title"
                  value={formData.title}
                  onChange={(e) => handleInputChange('title', e.target.value)}
                  required
                />
              </Grid>
              <Grid item xs={12} md={4}>
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
                      required
                      InputLabelProps={{ shrink: true }}
                    />
                  </Grid>
                  
                  <Grid item xs={6}>
                    <FormControl fullWidth>
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
                      </Select>
                    </FormControl>
                  </Grid>
                </>
              )}

              {/* Task Type and Category */}
              <Grid item xs={12}>
                <Typography variant="h6" gutterBottom>Task Type and Category</Typography>
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>Task Type</InputLabel>
                  <Select
                    value={formData.type}
                    onChange={(e) => handleInputChange('type', e.target.value)}
                    label="Task Type"
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
              <Grid item xs={12} md={6}>
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

              {/* Status (Read-only) */}
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>Status</InputLabel>
                  <Select
                    value={currentStatus}
                    label="Status"
                    disabled
                  >
                    <MenuItem value="scheduled">Scheduled</MenuItem>
                    <MenuItem value="upcoming">Upcoming</MenuItem>
                    <MenuItem value="due">Due</MenuItem>
                    <MenuItem value="overdue">Overdue</MenuItem>
                    <MenuItem value="completed">Completed</MenuItem>
                  </Select>
                </FormControl>
                <Typography variant="caption" color="text.secondary">
                  Status is automatically determined by due date
                </Typography>
              </Grid>

              {/* Scheduling */}
              <Grid item xs={12}>
                <Typography variant="h6" gutterBottom>Scheduling</Typography>
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Scheduled Date"
                  type="date"
                  value={formData.scheduledDate.toISOString().split('T')[0]}
                  onChange={(e) => handleInputChange('scheduledDate', new Date(e.target.value))}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Due Date"
                  type="date"
                  value={formData.dueDate}
                  onChange={(e) => handleInputChange('dueDate', e.target.value)}
                  InputLabelProps={{ shrink: true }}
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

              {/* Notes */}
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Notes"
                  value={formData.notes}
                  onChange={(e) => handleInputChange('notes', e.target.value)}
                  multiline
                  rows={3}
                />
              </Grid>
            </Grid>
          </TabPanel>

          <TabPanel value={tabValue} index={1}>
            <Typography variant="body1" color="text.secondary">
              AI Suggestions functionality coming soon...
            </Typography>
          </TabPanel>
        </DialogContent>

        <DialogActions>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          {task?.status !== 'completed' && (
            <Button 
              onClick={handleComplete} 
              variant="contained"
              color="success"
              disabled={saving}
            >
              Complete
            </Button>
          )}
          <Button 
            onClick={handleDelete} 
            variant="contained"
            color="error"
            disabled={saving}
          >
            Delete
          </Button>
          <Button 
            onClick={handleSubmit} 
            variant="contained"
            disabled={saving || !formData.title}
            startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Completion Dialog */}
      <Dialog open={showCompletionDialog} onClose={() => setShowCompletionDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Complete Task</DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ mb: 2 }}>
            Please provide completion notes for this task:
          </Typography>
          <TextField
            fullWidth
            label="Completion Notes"
            value={completionNotes}
            onChange={(e) => setCompletionNotes(e.target.value)}
            multiline
            rows={4}
            placeholder="Describe what was accomplished, any outcomes, or important details..."
            helperText="These notes will be saved with the task completion"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowCompletionDialog(false)} disabled={saving}>
            Cancel
          </Button>
          <Button 
            onClick={handleConfirmComplete} 
            variant="contained"
            color="success"
            disabled={saving}
          >
            {saving ? 'Completing...' : 'Complete Task'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onClose={() => setShowDeleteDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Delete Task</DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ mb: 2 }}>
            Are you sure you want to delete "{formData.title}"? This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowDeleteDialog(false)} disabled={saving}>
            Cancel
          </Button>
          <Button 
            onClick={handleConfirmDelete} 
            variant="contained"
            color="error"
            disabled={saving}
          >
            {saving ? 'Deleting...' : 'Delete Task'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default TaskDetailsDialog; 
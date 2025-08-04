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
  Grid,
  Box,
  Typography,
  Chip,
  Autocomplete,
  FormControlLabel,
  Switch,
  Divider,
  Alert,
  LinearProgress
} from '@mui/material';

import { TaskType, TaskStatus, TaskCategory } from '../types/Tasks';
import { TaskService } from '../utils/taskService';

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
    status: 'upcoming' as TaskStatus,
    scheduledDate: new Date(),
    dueDateTime: new Date(),
    assignedTo: salespersonId,
    category: 'follow_up' as TaskCategory,
    reason: '',
    notes: '',
    quotaCategory: 'business_generating',
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

  const taskService = TaskService.getInstance();

  useEffect(() => {
    if (task && open) {
      setFormData({
        title: task.title || '',
        description: task.description || '',
        type: task.type || 'email',
        priority: task.priority || 'medium',
        status: task.status || 'upcoming',
        scheduledDate: task.scheduledDate ? new Date(task.scheduledDate) : new Date(),
        dueDateTime: task.dueDateTime ? new Date(task.dueDateTime) : new Date(),
        assignedTo: task.assignedTo || salespersonId,
        category: task.category || 'follow_up',
        reason: task.reason || '',
        notes: task.notes || '',
        quotaCategory: task.quotaCategory || 'business_generating',
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
    }
  }, [task, open, salespersonId]);

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
      const taskData = {
        title: formData.title,
        description: formData.description,
        type: formData.type,
        priority: formData.priority as 'low' | 'medium' | 'high' | 'urgent',
        status: formData.status,
        scheduledDate: formData.scheduledDate.toISOString(),
        dueDateTime: formData.dueDateTime.toISOString(),
        assignedTo: formData.assignedTo,
        category: formData.category,
        reason: formData.reason,
        notes: formData.notes,
        quotaCategory: formData.quotaCategory as 'business_generating' | 'relationship_building' | 'administrative' | 'research',
        aiSuggested: formData.aiSuggested,
        aiPrompt: formData.aiPrompt,
        associations: formData.associations,
        communicationDetails: formData.type === 'email' ? formData.communicationDetails : undefined
      };

      await taskService.updateTask(task.id, taskData);
      
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
    if (!task?.id) return;

    setSaving(true);
    setError(null);

    try {
      await taskService.completeTask(task.id, { outcome: 'positive', notes: 'Task completed' }, tenantId, salespersonId);
      
      if (onTaskUpdated) {
        onTaskUpdated(task.id);
      }
      
      onClose();
    } catch (err) {
      console.error('Error completing task:', err);
      setError('Failed to complete task');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!task?.id) return;

    if (!window.confirm('Are you sure you want to delete this task?')) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await taskService.deleteTask(task.id, tenantId, salespersonId);
      
      if (onTaskUpdated) {
        onTaskUpdated(task.id);
      }
      
      onClose();
    } catch (err) {
      console.error('Error deleting task:', err);
      setError('Failed to delete task');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
        <DialogContent>
          <LinearProgress />
          <Typography variant="body2" sx={{ mt: 1 }}>
            Loading task details...
          </Typography>
        </DialogContent>
      </Dialog>
    );
  }

  return (
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

        <Grid container spacing={3} sx={{ mt: 1 }}>
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

          {/* Task Type and Priority */}
          <Grid item xs={12}>
            <Typography variant="h6" gutterBottom>Task Type and Priority</Typography>
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
                <MenuItem value="prospecting">Prospecting</MenuItem>
                <MenuItem value="qualification">Qualification</MenuItem>
                <MenuItem value="proposal">Proposal</MenuItem>
                <MenuItem value="negotiation">Negotiation</MenuItem>
                <MenuItem value="closing">Closing</MenuItem>
                <MenuItem value="follow_up">Follow Up</MenuItem>
                <MenuItem value="administrative">Administrative</MenuItem>
              </Select>
            </FormControl>
          </Grid>

          {/* Status */}
          <Grid item xs={12} md={6}>
            <FormControl fullWidth>
              <InputLabel>Status</InputLabel>
              <Select
                value={formData.status}
                onChange={(e) => handleInputChange('status', e.target.value)}
                label="Status"
              >
                <MenuItem value="upcoming">Upcoming</MenuItem>
                <MenuItem value="due">Due</MenuItem>
                <MenuItem value="complete">Complete</MenuItem>
                <MenuItem value="postponed">Postponed</MenuItem>
                <MenuItem value="cancelled">Cancelled</MenuItem>
              </Select>
            </FormControl>
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
              value={formData.dueDateTime.toISOString().split('T')[0]}
              onChange={(e) => handleInputChange('dueDateTime', new Date(e.target.value))}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>

          {/* CRM Associations */}
          <Grid item xs={12}>
            <Typography variant="h6" gutterBottom>CRM Associations</Typography>
          </Grid>
          <Grid item xs={12} md={6}>
            <Autocomplete
              multiple
              options={companies}
              getOptionLabel={(option) => option.name}
              value={companies.filter(company => 
                formData.associations.companies.includes(company.id)
              )}
              onChange={(event, newValue) => {
                handleAssociationChange('companies', newValue.map(company => company.id));
              }}
              renderInput={(params) => (
                <TextField {...params} label="Companies" />
              )}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <Autocomplete
              multiple
              options={contacts}
              getOptionLabel={(option) => `${option.firstName} ${option.lastName}`}
              value={contacts.filter(contact => 
                formData.associations.contacts.includes(contact.id)
              )}
              onChange={(event, newValue) => {
                handleAssociationChange('contacts', newValue.map(contact => contact.id));
              }}
              renderInput={(params) => (
                <TextField {...params} label="Contacts" />
              )}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <Autocomplete
              multiple
              options={deals}
              getOptionLabel={(option) => option.title}
              value={deals.filter(deal => 
                formData.associations.deals.includes(deal.id)
              )}
              onChange={(event, newValue) => {
                handleAssociationChange('deals', newValue.map(deal => deal.id));
              }}
              renderInput={(params) => (
                <TextField {...params} label="Deals" />
              )}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth>
              <InputLabel>Assigned To</InputLabel>
              <Select
                value={formData.assignedTo}
                onChange={(e) => handleInputChange('assignedTo', e.target.value)}
                label="Assigned To"
              >
                {salespeople.map((salesperson) => (
                  <MenuItem key={salesperson.id} value={salesperson.id}>
                    {salesperson.firstName} {salesperson.lastName}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          {/* Email Details (conditional) */}
          {formData.type === 'email' && (
            <>
              <Grid item xs={12}>
                <Typography variant="h6" gutterBottom>Email Details</Typography>
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Recipient Email"
                  value={formData.communicationDetails.recipient}
                  onChange={(e) => handleInputChange('communicationDetails', {
                    ...formData.communicationDetails,
                    recipient: e.target.value
                  })}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Subject"
                  value={formData.communicationDetails.subject}
                  onChange={(e) => handleInputChange('communicationDetails', {
                    ...formData.communicationDetails,
                    subject: e.target.value
                  })}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Draft Content"
                  value={formData.communicationDetails.body}
                  onChange={(e) => handleInputChange('communicationDetails', {
                    ...formData.communicationDetails,
                    body: e.target.value
                  })}
                  multiline
                  rows={4}
                />
              </Grid>
            </>
          )}

          {/* Quota Category */}
          <Grid item xs={12}>
            <Typography variant="h6" gutterBottom>Quota Category</Typography>
          </Grid>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth>
              <InputLabel>Quota Category</InputLabel>
              <Select
                value={formData.quotaCategory}
                onChange={(e) => handleInputChange('quotaCategory', e.target.value)}
                label="Quota Category"
              >
                <MenuItem value="business_generating">Business Generating</MenuItem>
                <MenuItem value="administrative">Administrative</MenuItem>
                <MenuItem value="training">Training</MenuItem>
                <MenuItem value="other">Other</MenuItem>
              </Select>
            </FormControl>
          </Grid>

          {/* AI Settings */}
          <Grid item xs={12}>
            <Typography variant="h6" gutterBottom>AI Settings</Typography>
          </Grid>
          <Grid item xs={12}>
            <FormControlLabel
              control={
                <Switch
                  checked={formData.aiSuggested}
                  onChange={(e) => handleInputChange('aiSuggested', e.target.checked)}
                />
              }
              label="AI Suggested"
            />
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
              />
            </Grid>
          )}

          {/* Notes */}
          <Grid item xs={12}>
            <Typography variant="h6" gutterBottom>Notes</Typography>
          </Grid>
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
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        {task?.status !== 'complete' && (
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
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default TaskDetailsDialog; 
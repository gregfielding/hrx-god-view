import React, { useState, useEffect, useCallback } from 'react';
import { localDateTimeToUTC, getUserTimezone } from '../utils/dateUtils';
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
  LinearProgress,
  Chip,
  Autocomplete,
  Tooltip
} from '@mui/material';
import {
  Schedule as ScheduleIcon,
  CheckCircle as CheckCircleIcon,
  Save as SaveIcon,
  Business as BusinessIcon,
  LocalOffer as LocalOfferIcon,
  Person as PersonIcon,
  WorkOutline as WorkOutlineIcon
} from '@mui/icons-material';
import { doc, getDoc } from 'firebase/firestore';

import { TaskService } from '../utils/taskService';
import { TaskStatus, TaskType, TaskCategory, TaskClassification } from '../types/Tasks';
import { db } from '../firebase';
import { 
  normalizeAssociationArray, 
  toSelectValue, 
  getAssociationDisplayName,
  mergeAssociations 
} from '../utils/associationHelpers';

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
    classification: 'todo' as TaskClassification,
    startTime: '',
    duration: undefined as number | undefined,
    scheduledDate: new Date(),
    dueDate: '',
    assignedTo: salespersonId,
    category: 'follow_up' as TaskCategory,
    reason: '',
    notes: '',
    quotaCategory: 'business_generating',
    estimatedDuration: 0,
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
    }>
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showCompletionDialog, setShowCompletionDialog] = useState(false);
  const [completionNotes, setCompletionNotes] = useState('');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showDismissDialog, setShowDismissDialog] = useState(false);
  const [associatedCompanies, setAssociatedCompanies] = useState<any[]>([]);
  const [associatedDeals, setAssociatedDeals] = useState<any[]>([]);
  const [associatedContacts, setAssociatedContacts] = useState<any[]>([]);
  const [associatedSalespeople, setAssociatedSalespeople] = useState<any[]>([]);
  const [associatedUsers, setAssociatedUsers] = useState<any[]>([]);
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
  const loadAssociatedData = useCallback(async () => {
    if (!task || !tenantId) return;
    
    setLoading(true);
    try {
      console.log('🔍 TaskDetailsDialog: Loading associated data');
      console.log('🔍 Props contacts:', contacts);
      console.log('🔍 Props salespeople:', salespeople);
      
      // Use the contacts and salespeople data that's already available from props
      // These should contain the deal's associated contacts and salespeople
      if (contacts && contacts.length > 0) {
        console.log('📊 Setting associated contacts from props:', contacts);
        setAssociatedContacts(contacts);
      }
      
      if (salespeople && salespeople.length > 0) {
        console.log('📊 Setting associated salespeople from props:', salespeople);
        setAssociatedSalespeople(salespeople);
      }
      
      // Also load any existing task associations (for editing existing tasks)
      if (task.associations?.contacts?.length > 0) {
        const contactPromises = task.associations.contacts.map(async (contactId: string) => {
          try {
            const contactDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_contacts', contactId));
            return contactDoc.exists() ? { id: contactDoc.id, ...contactDoc.data() } : null;
          } catch (err) {
            console.error('Error loading contact:', contactId, err);
            return null;
          }
        });
        const contacts = (await Promise.all(contactPromises)).filter(Boolean);
        setAssociatedContacts(prev => [...prev, ...contacts.filter(c => !prev.find(p => p.id === c.id))]);
      }

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
        setAssociatedCompanies(prev => [...prev, ...companies.filter(c => !prev.find(p => p.id === c.id))]);
      }

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
        setAssociatedDeals(prev => [...prev, ...deals.filter(d => !prev.find(p => p.id === d.id))]);
      }

      if (task.associations?.users?.length > 0) {
        const userPromises = task.associations.users.map(async (uid: string) => {
          try {
            const userDoc = await getDoc(doc(db, 'users', uid));
            return userDoc.exists() ? { id: userDoc.id, ...userDoc.data() } : null;
          } catch (err) {
            console.error('Error loading user:', uid, err);
            return null;
          }
        });
        const users = (await Promise.all(userPromises)).filter(Boolean);
        setAssociatedUsers(prev => [...prev, ...users.filter(u => !prev.find(p => p.id === u.id))]);
      }

      if (task.associations?.salespeople?.length > 0) {
        const salespeoplePromises = task.associations.salespeople.map(async (salespersonId: string) => {
          try {
            // Users are stored at the top-level `users` collection, not under tenant
            const salespersonDoc = await getDoc(doc(db, 'users', salespersonId));
            return salespersonDoc.exists() ? { id: salespersonDoc.id, ...salespersonDoc.data() } : null;
          } catch (err) {
            console.error('Error loading salesperson:', salespersonId, err);
            return null;
          }
        });
        const salespeople = (await Promise.all(salespeoplePromises)).filter(Boolean);
        setAssociatedSalespeople(prev => [...prev, ...salespeople.filter(s => !prev.find(p => p.id === s.id))]);
      }

      // Also include any users in assignedTo so labels render even if associations.salespeople is empty
      const assignedIds = Array.isArray(task.assignedTo) ? task.assignedTo : (task.assignedTo ? [task.assignedTo] : []);
      if (assignedIds.length > 0) {
        const assignedPromises = assignedIds.map(async (salespersonId: string) => {
          try {
            const salespersonDoc = await getDoc(doc(db, 'users', salespersonId));
            return salespersonDoc.exists() ? { id: salespersonDoc.id, ...salespersonDoc.data() } : null;
          } catch (err) {
            console.error('Error loading assigned salesperson:', salespersonId, err);
            return null;
          }
        });
        const assignedUsers = (await Promise.all(assignedPromises)).filter(Boolean);
        setAssociatedSalespeople(prev => [...prev, ...assignedUsers.filter(s => !prev.find(p => p.id === s.id))]);
      }

    } catch (err) {
      console.error('Error loading associated data:', err);
    } finally {
      setLoading(false);
    }
  }, [task, tenantId, contacts, salespeople]);

  useEffect(() => {
    if (task && open) {
      const status = calculateStatus(task.dueDate || '', new Date(task.scheduledDate || Date.now()));
      
      setFormData({
        title: task.title || '',
        description: task.description || '',
        type: task.type || 'email',
        priority: task.priority || 'medium',
        classification: task.classification || 'todo',
        startTime: (task.classification === 'appointment' ? (task.startTime || '') : ''),
        duration: (task.classification === 'appointment' ? (task.duration ?? undefined) : undefined),
        scheduledDate: task.scheduledDate ? new Date(task.scheduledDate) : new Date(),
        dueDate: (() => {
          if (!task.dueDate) return '';
          
          try {
            console.log('🔍 Original dueDate:', task.dueDate);
            
            // Convert the stored date to YYYY-MM-DD format for the date input
            const date = new Date(task.dueDate);
            if (isNaN(date.getTime())) {
              console.warn('Invalid dueDate:', task.dueDate);
              return '';
            }
            
            console.log('🔍 Parsed date:', date);
            console.log('🔍 Date in local timezone:', date.toLocaleDateString());
            
            // Format as YYYY-MM-DD (local date, no timezone)
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const formattedDate = `${year}-${month}-${day}`;
            
            console.log('🔍 Formatted date for input:', formattedDate);
            return formattedDate;
          } catch (error) {
            console.warn('Error formatting dueDate:', task.dueDate, error);
            return '';
          }
        })(),
        assignedTo: Array.isArray(task.assignedTo) ? task.assignedTo : (task.assignedTo ? [task.assignedTo] : [salespersonId]),
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
        },
        // Task-type-specific fields
        agenda: task.agenda || '',
        goals: task.goals || [],
        researchTopics: task.researchTopics || [],
        callScript: task.callScript || '',
        emailTemplate: task.emailTemplate || '',
        followUpNotes: task.followUpNotes || '',
        meetingAttendees: task.meetingAttendees || []
      });
      
      // Load associated data
      loadAssociatedData();
      
      // Debug: Log the task associations
      console.log('Task associations:', task.associations);
      console.log('Task assignedTo:', task.assignedTo);
      
    }
  }, [task, open, salespersonId, tenantId]);

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => {
      const newFormData = { ...prev, [field]: value };
      
      // Auto-populate meeting attendees when Google Meet is selected
      if (field === 'type' && value === 'scheduled_meeting_virtual') {
        updateMeetingAttendees(newFormData);
      }
      
      return newFormData;
    });
  };


  const handleAssociationChange = (type: string, value: any) => {
    console.log('🔍 handleAssociationChange called:', { type, value });
    
    // For Autocomplete, value is already the array of selected IDs, so we can use it directly
    setFormData(prev => {
      const newFormData = {
        ...prev,
        associations: {
          ...prev.associations,
          [type]: value // value is already an array of IDs from Autocomplete
        }
      };
      
      console.log('🔍 New formData associations:', newFormData.associations);
      
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
        const contactData = associatedContacts.find(c => c.id === contactId);
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
    if (formData.associations?.salespeople) {
      formData.associations.salespeople.forEach((salespersonId: string) => {
        const salespersonData = associatedSalespeople.find(s => s.id === salespersonId);
        if (salespersonData?.email && !attendees.find(a => a.email === salespersonData.email)) {
          attendees.push({
            email: salespersonData.email,
            displayName: salespersonData.fullName || salespersonData.name || salespersonData.displayName || salespersonData.email,
            responseStatus: 'needsAction' as const
          });
        }
      });
    }
    
    setFormData(prev => ({
      ...prev,
      meetingAttendees: attendees
    }));
  };

  const handleSubmit = async () => {
    if (!task?.id) return;

    setSaving(true);
    setError(null);

    try {
      // Calculate status based on due date
      const status = calculateStatus(formData.dueDate, formData.scheduledDate);
      
      // For appointments, extract date from startTime and set scheduledDate
      let scheduledDate = formData.scheduledDate.toISOString().split('T')[0];
      let startTimeForSync = formData.startTime;
      
      if (formData.classification === 'appointment' && formData.startTime) {
        scheduledDate = formData.startTime.split('T')[0];
        
        // Convert local datetime to UTC for Google Calendar sync
        startTimeForSync = localDateTimeToUTC(formData.startTime);
      }

      const taskData = {
        title: formData.title,
        description: formData.description,
        type: formData.type,
        priority: formData.priority as 'low' | 'medium' | 'high' | 'urgent',
        status, // Use calculated status instead of form data
        classification: formData.classification,
        startTime: formData.classification === 'appointment' ? startTimeForSync : null,
        duration: formData.classification === 'appointment' ? formData.duration : null,
        scheduledDate: scheduledDate,
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
        communicationDetails: formData.type === 'email' ? formData.communicationDetails : undefined,
        // Add user's timezone for proper sync
        userTimezone: getUserTimezone()
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

  const isSystemManaged =
    !!(
      (formData.description && String(formData.description).includes('System-managed checklist task')) ||
      (task && (task as any).description && String((task as any).description).includes('System-managed checklist task')) ||
      (task as any)?.jobOrderId ||
      (task as any)?.sourceType === 'recruiting' ||
      (task as any)?.systemManaged === true ||
      (task as any)?.systemSource === 'job_order_checklist'
    );

  const handleDismiss = () => setShowDismissDialog(true);

  const handleConfirmDismiss = async () => {
    if (!task?.id) return;

    setSaving(true);
    setError(null);

    try {
      await taskService.updateTask(task.id, { status: 'dismissed' }, tenantId);

      if (onTaskUpdated) {
        onTaskUpdated(task.id);
      }

      setShowDismissDialog(false);
      onClose();
    } catch (err) {
      console.error('Error dismissing task:', err);
      setError('Failed to dismiss task');
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

  const openHref = (href: string) => {
    try {
      window.open(href, '_blank', 'noopener,noreferrer');
    } catch {
      window.open(href, '_blank');
    }
  };

  const getPersonName = (u: any): string => {
    return (
      u?.fullName ||
      u?.displayName ||
      [u?.firstName, u?.lastName].filter(Boolean).join(' ') ||
      u?.name ||
      u?.email ||
      u?.id ||
      ''
    );
  };

  const contactIds = toSelectValue((formData as any).associations?.contacts);
  const companyIds = toSelectValue((formData as any).associations?.companies);
  const dealIds = toSelectValue((formData as any).associations?.deals);
  const userIds = toSelectValue((formData as any).associations?.users);

  // Job order linkage (used by recruiting/checklist tasks)
  const jobOrderId: string | undefined =
    (task as any)?.jobOrderId ||
    ((task as any)?.sourceType === 'recruiting' ? (task as any)?.sourceId : undefined);
  const jobOrderName: string | undefined = (task as any)?.sourceName || (task as any)?.jobOrderName;

  const hasAnyLinks =
    contactIds.length > 0 ||
    companyIds.length > 0 ||
    dealIds.length > 0 ||
    userIds.length > 0 ||
    (typeof jobOrderId === 'string' && jobOrderId.trim().length > 0);

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


            <Grid container spacing={3}>
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

              {/* Linked Entities */}
              {hasAnyLinks && (
                <Grid item xs={12}>
                  <Box sx={{ mb: 1 }}>
                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                      Linked to
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                      {companyIds.map((id) => {
                        const c = associatedCompanies.find((x) => x.id === id);
                        const label = c?.name || c?.companyName || c?.displayName || id;
                        return (
                          <Tooltip key={`company_${id}`} title="Open company" arrow>
                            <Chip
                              icon={<BusinessIcon />}
                              label={label}
                              size="small"
                              clickable
                              onClick={() => openHref(`/companies/${id}`)}
                            />
                          </Tooltip>
                        );
                      })}

                      {dealIds.map((id) => {
                        const d = associatedDeals.find((x) => x.id === id);
                        const label = d?.name || d?.dealName || d?.title || id;
                        return (
                          <Tooltip key={`deal_${id}`} title="Open deal" arrow>
                            <Chip
                              icon={<LocalOfferIcon />}
                              label={label}
                              size="small"
                              clickable
                              onClick={() => openHref(`/crm/deals/${id}`)}
                            />
                          </Tooltip>
                        );
                      })}

                      {contactIds.map((id) => {
                        const c = associatedContacts.find((x) => x.id === id);
                        const label = c?.fullName || c?.name || c?.email || id;
                        return (
                          <Tooltip key={`contact_${id}`} title="Open contact" arrow>
                            <Chip
                              icon={<PersonIcon />}
                              label={label}
                              size="small"
                              clickable
                              onClick={() => openHref(`/contacts/${id}`)}
                            />
                          </Tooltip>
                        );
                      })}

                      {userIds.map((id) => {
                        const u = associatedUsers.find((x) => x.id === id);
                        const label = getPersonName(u) || id;
                        return (
                          <Tooltip key={`user_${id}`} title="Open user" arrow>
                            <Chip
                              icon={<PersonIcon />}
                              label={label}
                              size="small"
                              clickable
                              onClick={() => openHref(`/users/${id}`)}
                            />
                          </Tooltip>
                        );
                      })}

                      {typeof jobOrderId === 'string' && jobOrderId.trim().length > 0 && (
                        <Tooltip title="Open job order" arrow>
                          <Chip
                            icon={<WorkOutlineIcon />}
                            label={jobOrderName ? `Job Order: ${jobOrderName}` : 'Job Order'}
                            size="small"
                            clickable
                            onClick={() => openHref(`/jobs/job-orders/${jobOrderId}`)}
                          />
                        </Tooltip>
                      )}
                    </Box>
                  </Box>
                </Grid>
              )}

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
                      required
                      InputLabelProps={{ shrink: true }}
                    />
                  </Grid>
                  
                  <Grid item xs={4}>
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

              {/* Company Contacts */}
              <Grid item xs={12} md={6}>
                <Autocomplete
                  multiple
                  options={associatedContacts || []}
                  getOptionLabel={(option) => option?.fullName || option?.name || option?.email || ''}
                  value={(() => {
                    const contactIds = toSelectValue(formData.associations?.contacts);
                    const value = contactIds.map(contactId => {
                      const contact = associatedContacts.find(c => c.id === contactId);
                      return contact || { id: contactId, fullName: contactId, name: contactId, email: contactId };
                    });
                    console.log('🔍 Company Contacts value prop:', { contactIds, value, associatedContacts: associatedContacts.length });
                    return value;
                  })()}
                  onChange={(_, newValue) => {
                    console.log('🔍 Company Contacts onChange:', newValue);
                    handleAssociationChange('contacts', newValue.map(v => v.id));
                  }}
                  renderTags={(value, getTagProps) =>
                    value.map((option, index) => (
                      <Tooltip key={option.id} title={`Click to view ${option.fullName || option.name || option.email || option.id}'s contact details`} arrow>
                        <Chip 
                          {...getTagProps({ index })} 
                          label={option.fullName || option.name || option.email || option.id} 
                          size="small"
                          clickable
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(`/contacts/${option.id}`, '_blank');
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
                    <TextField
                      {...params}
                      label="Company Contacts"
                      placeholder="Select contacts..."
                    />
                  )}
                  isOptionEqualToValue={(option, value) => option.id === value.id}
                  noOptionsText="No contacts available"
                  loading={loading}
                />
              </Grid>

              {/* Assigned To */}
              <Grid item xs={12} md={6}>
                <Autocomplete
                  multiple
                  options={associatedSalespeople || []}
                  getOptionLabel={(option) => option?.fullName || option?.name || option?.displayName || option?.email || ''}
                  value={(Array.isArray(formData.assignedTo) ? formData.assignedTo : formData.assignedTo ? [formData.assignedTo] : []).map(salespersonId => {
                    const salesperson = associatedSalespeople.find(s => s.id === salespersonId);
                    return salesperson || { id: salespersonId, fullName: salespersonId, name: salespersonId, displayName: salespersonId, email: salespersonId };
                  })}
                  onChange={(_, newValue) => {
                    console.log('🔍 Assigned To onChange:', newValue);
                    handleInputChange('assignedTo', newValue.map(v => v.id));
                  }}
                  renderTags={(value, getTagProps) =>
                    value.map((option, index) => (
                      <Tooltip key={option.id} title={`Click to search for ${option.fullName || option.name || option.displayName || option.email || option.id} in contacts`} arrow>
                        <Chip 
                          {...getTagProps({ index })} 
                          label={option.fullName || option.name || option.displayName || option.email || option.id} 
                          size="small"
                          clickable
                        onClick={(e) => {
                          e.stopPropagation();
                          // For salespeople, we might want to open a user profile or just show a tooltip
                          // For now, let's open the CRM contacts page in case the salesperson is also a contact
                          window.open(`/crm/contacts?search=${encodeURIComponent(option.email || option.fullName || option.name)}`, '_blank');
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
                    <TextField
                      {...params}
                      label="Assigned To"
                      placeholder="Select salespeople..."
                    />
                  )}
                  isOptionEqualToValue={(option, value) => option.id === value.id}
                  noOptionsText="No salespeople available"
                  loading={loading}
                />
              </Grid>

              {/* Google Meet Specific Fields */}
              {formData.type === 'scheduled_meeting_virtual' && (
                <>
                  <Grid item xs={12}>
                    <Typography variant="h6" gutterBottom>Google Meet Details</Typography>
                  </Grid>
                  <Grid item xs={12}>
                    <TextField
                      fullWidth
                      label="Meeting Agenda"
                      value={formData.agenda || ''}
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
                      value={formData.goals?.join(', ') || ''}
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
                        A Google Meet link will be automatically generated when this task is saved. 
                        Attendees will receive calendar invites with the meeting link.
                      </Typography>
                    </Box>
                  </Grid>
                </>
              )}

              {/* Due Date for Todos */}
              {formData.classification === 'todo' && (
                <>
                  <Grid item xs={12}>
                    <Typography variant="h6" gutterBottom>Due Date</Typography>
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
                </>
              )}

            </Grid>
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
          {task && isSystemManaged && task.status !== 'completed' && task.status !== 'dismissed' && (
            <Button
              onClick={handleDismiss}
              variant="outlined"
              disabled={saving}
              title="Remove from your list without completing. Use for system-generated checklist tasks you want to skip."
            >
              Dismiss
            </Button>
          )}
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
            Are you sure you want to delete &quot;{formData.title}&quot;? This action cannot be undone.
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

      {/* Dismiss Confirmation Dialog (system-managed tasks) */}
      <Dialog open={showDismissDialog} onClose={() => setShowDismissDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Dismiss Task</DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ mb: 2 }}>
            Remove this task from your list without completing it? You can use this for system-generated checklist tasks you want to skip. The task will no longer appear in My Tasks.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowDismissDialog(false)} disabled={saving}>
            Cancel
          </Button>
          <Button 
            onClick={handleConfirmDismiss} 
            variant="contained"
            disabled={saving}
          >
            {saving ? 'Dismissing...' : 'Dismiss'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default TaskDetailsDialog; 
import React, { useState } from 'react';
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
  Alert,
  CircularProgress,
  Chip,
  Autocomplete
} from '@mui/material';
import {
  Assignment as AssignmentIcon,
  Schedule as ScheduleIcon,
  CheckCircle as CheckCircleIcon
} from '@mui/icons-material';

import { TaskClassification, TaskCategory } from '../types/Tasks';
import { 
  normalizeAssociationArray, 
  toSelectValue, 
  getAssociationDisplayName,
  mergeAssociations 
} from '../utils/associationHelpers';

interface LogActivityDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (taskData: any) => void;
  loading?: boolean;
  salespeople?: any[];
  contacts?: any[];
  // When true, preselect the provided contacts on open. Default: false
  preselectContactsFromProps?: boolean;
  currentUserId?: string;
  tenantId?: string;
  dealId?: string;
  dealName?: string;
}

  const LogActivityDialog: React.FC<LogActivityDialogProps> = ({
  open,
  onClose,
  onSubmit,
  loading = false,
  salespeople = [],
  contacts = [],
  preselectContactsFromProps = false,
  currentUserId = '',
  tenantId = '',
  dealId,
  dealName
}) => {
      // REMOVED: Excessive logging causing re-renders
    
    // REMOVED: Excessive logging causing re-renders
  // Ensure current user is always in the salespeople list
  const allSalespeople = React.useMemo(() => {
    const currentUserInList = salespeople.find(s => s.id === currentUserId);
    if (!currentUserInList && currentUserId) {
      // Add current user if not already in the list
      return [
        {
          id: currentUserId,
          fullName: 'You',
          email: '',
          displayName: 'You'
        },
        ...salespeople
      ];
    }
    return salespeople;
  }, [salespeople, currentUserId]);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    type: 'custom',
    priority: 'medium',
    status: 'completed' as const, // Always completed for logged activities
    classification: 'todo' as TaskClassification,
    scheduledDate: new Date().toISOString().split('T')[0],
    completedDate: new Date().toISOString().split('T')[0],
    assignedTo: currentUserId ? [currentUserId] : [],
    estimatedDuration: 30,
    category: 'general' as TaskCategory,
    quotaCategory: 'business_generating',
    notes: '',
    tags: ['logged-activity'] as string[],
    associations: {
      companies: [],
      contacts: [],
      deals: dealId ? [dealId] : [],
      salespeople: currentUserId ? [currentUserId] : []
    }
  });

  const [errors, setErrors] = useState<{[key: string]: string}>({});

  // Pre-populate contacts and salespeople when dialog opens
  React.useEffect(() => {
    if (open) {
      const updates: any = {};
      
      // Pre-populate contacts
      if (preselectContactsFromProps && contacts && contacts.length > 0) {
        const contactIds = contacts.map(c => c.id);
        updates.contacts = contactIds;
      }
      
      // Pre-populate current user as salesperson
      if (currentUserId) {
        updates.salespeople = [currentUserId];
      }
      
      if (Object.keys(updates).length > 0) {
        setFormData(prev => ({
          ...prev,
          associations: {
            ...prev.associations,
            ...updates
          }
        }));
      }
    }
  }, [open, contacts, currentUserId]);

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const handleAssociationChange = (type: string, value: any) => {
    // For removal operations, directly set the new array
    // For addition operations, merge with existing
    const entityMap = type === 'contacts' ? contacts : 
                     type === 'salespeople' ? allSalespeople : [];
    
    let newAssociations;
    if (Array.isArray(value) && value.length < (formData.associations?.[type]?.length || 0)) {
      // This is a removal operation - directly set the new array
      newAssociations = value.map(id => {
        const entity = entityMap.find(e => e.id === id);
        return {
          id,
          name: entity?.displayName || entity?.fullName || entity?.name || entity?.email || 'Unknown',
          email: entity?.email || ''
        };
      });
    } else {
      // This is an addition operation - merge with existing
      newAssociations = mergeAssociations(
        formData.associations?.[type], 
        value, 
        entityMap
      );
    }

    setFormData(prev => ({
      ...prev,
      associations: {
        ...prev.associations,
        [type]: newAssociations
      }
    }));
  };

  const validateForm = () => {
    const newErrors: {[key: string]: string} = {};

    if (!formData.title.trim()) {
      newErrors.title = 'Activity title is required';
    }

    if (!formData.description.trim()) {
      newErrors.description = 'Activity description is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (!validateForm()) return;

    // Normalize associations to store only ID arrays for Firestore queries
    const toIdArray = (arr: any[] | undefined) => {
      if (!Array.isArray(arr)) return [] as string[];
      return arr.map((item: any) => (typeof item === 'string' ? item : item?.id)).filter(Boolean);
    };

    const normalizedAssociations = {
      companies: toIdArray(formData.associations?.companies),
      contacts: toIdArray(formData.associations?.contacts),
      deals: toIdArray(formData.associations?.deals),
      salespeople: toIdArray(formData.associations?.salespeople)
    };

    const taskData = {
      ...formData,
      associations: normalizedAssociations,
      // Required fields that might be missing
      tenantId: tenantId || '',
      createdBy: currentUserId || '',
      assignedTo: Array.isArray(formData.assignedTo) ? formData.assignedTo[0] || currentUserId || '' : formData.assignedTo || currentUserId || '',
      dueDate: formData.scheduledDate, // Use scheduledDate as dueDate for todos
      estimatedDuration: Number(formData.estimatedDuration || 0),
      completedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    onSubmit(taskData);
  };

  const handleClose = () => {
    setFormData({
      title: '',
      description: '',
      type: 'custom',
      priority: 'medium',
      status: 'completed',
      classification: 'todo',
      scheduledDate: new Date().toISOString().split('T')[0],
      completedDate: new Date().toISOString().split('T')[0],
      assignedTo: currentUserId ? [currentUserId] : [],
      estimatedDuration: 30,
      category: 'general' as TaskCategory,
      quotaCategory: 'business_generating',
      notes: '',
      tags: ['logged-activity'],
      associations: {
        companies: [],
        contacts: [],
        deals: dealId ? [dealId] : [],
        salespeople: currentUserId ? [currentUserId] : []
      }
    });
    setErrors({});
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          <CheckCircleIcon />
          Log Activity
        </Box>
      </DialogTitle>
      
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          {dealName && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Logging activity for deal: <strong>{dealName}</strong>
            </Alert>
          )}

          {/* Basic Information */}
          <TextField
            fullWidth
            label="Activity Title"
            value={formData.title}
            onChange={(e) => handleInputChange('title', e.target.value)}
            error={!!errors.title}
            helperText={errors.title}
            placeholder="e.g., Client call with John Smith, Follow-up meeting, etc."
            required
          />

          <TextField
            fullWidth
            label="Activity Description"
            value={formData.description}
            onChange={(e) => handleInputChange('description', e.target.value)}
            multiline
            rows={3}
            error={!!errors.description}
            helperText={errors.description}
            placeholder="Describe what happened during this activity..."
            required
          />

          {/* Activity Type and Priority */}
          <Box sx={{ display: 'flex', gap: 2 }}>
            <FormControl sx={{ minWidth: 200 }}>
              <InputLabel>Activity Type</InputLabel>
              <Select
                value={formData.type}
                onChange={(e) => handleInputChange('type', e.target.value)}
                label="Activity Type"
              >
                <MenuItem value="call">Phone Call</MenuItem>
                <MenuItem value="meeting">Meeting</MenuItem>
                <MenuItem value="email">Email</MenuItem>
                <MenuItem value="linkedin_message">LinkedIn Message</MenuItem>
                <MenuItem value="research">Research</MenuItem>
                <MenuItem value="proposal">Proposal Work</MenuItem>
                <MenuItem value="follow_up">Follow-up</MenuItem>
                <MenuItem value="custom">Other</MenuItem>
              </Select>
            </FormControl>

            <FormControl sx={{ minWidth: 120 }}>
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
          </Box>

          {/* Category */}
          <FormControl fullWidth>
            <InputLabel>Category</InputLabel>
            <Select
              value={formData.category}
              onChange={(e) => handleInputChange('category', e.target.value)}
              label="Category"
            >
              <MenuItem value="business_generating">Business Generating</MenuItem>
              <MenuItem value="relationship_building">Relationship Building</MenuItem>
              <MenuItem value="administrative">Administrative</MenuItem>
              <MenuItem value="research">Research</MenuItem>
              <MenuItem value="proposal">Proposal</MenuItem>
              <MenuItem value="follow_up">Follow-up</MenuItem>
            </Select>
          </FormControl>

          {/* Company Contacts */}
          <Autocomplete
            multiple
            options={contacts as any[]}
            getOptionLabel={(option: any) => option?.fullName || option?.name || option?.email || ''}
            value={(contacts || []).filter((c: any) => 
              (formData.associations?.contacts || []).some((contactId: any) => 
                typeof contactId === 'string' ? contactId === c.id : contactId?.id === c.id
              )
            ) as any[]}
            onChange={(_, newValue: any[]) => {
              handleAssociationChange('contacts', newValue.map(v => v.id));
            }}
            renderTags={(value, getTagProps) =>
              value.map((option: any, index: number) => (
                <Chip {...getTagProps({ index })} key={option.id} label={option.fullName || option.name || option.email || option.id} size="small" />
              ))
            }
            renderInput={(params) => (
              <TextField {...params} label="Company Contacts" placeholder="Select contacts" />
            )}
            disablePortal
            fullWidth
          />

          {/* Salespeople */}
          <Autocomplete
            multiple
            options={allSalespeople as any[]}
            getOptionLabel={(option: any) => option?.displayName || option?.fullName || option?.name || option?.email || ''}
            value={(allSalespeople || []).filter((s: any) => 
              (formData.associations?.salespeople || []).some((salespersonId: any) => 
                typeof salespersonId === 'string' ? salespersonId === s.id : salespersonId?.id === s.id
              )
            ) as any[]}
            onChange={(_, newValue: any[]) => {
              handleAssociationChange('salespeople', newValue.map(v => v.id));
            }}
            renderTags={(value, getTagProps) =>
              value.map((option: any, index: number) => (
                <Chip {...getTagProps({ index })} key={option.id} label={option.displayName || option.fullName || option.name || option.email || option.id} size="small" />
              ))
            }
            renderInput={(params) => (
              <TextField {...params} label="Salespeople" placeholder="Select salespeople" />
            )}
            disablePortal
            fullWidth
          />

          {/* Notes */}
          <TextField
            label="Additional Notes"
            value={formData.notes}
            onChange={(e) => handleInputChange('notes', e.target.value)}
            multiline
            rows={3}
            fullWidth
            placeholder="Any additional context, outcomes, or next steps..."
          />

          {Object.keys(errors).length > 0 && (
            <Alert severity="error" sx={{ mt: 1 }}>
              Please fix the errors above before submitting.
            </Alert>
          )}
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={loading}>
          Cancel
        </Button>
        <Button 
          onClick={handleSubmit} 
          variant="contained" 
          disabled={loading}
          startIcon={loading ? <CircularProgress size={16} /> : <CheckCircleIcon />}
        >
          {loading ? 'Logging...' : 'Log Activity'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default React.memo(LogActivityDialog);

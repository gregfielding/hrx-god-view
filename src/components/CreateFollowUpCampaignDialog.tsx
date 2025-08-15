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
  Tabs,
  Tab,
  Alert,
  CircularProgress
} from '@mui/material';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { TaskType, TaskStatus, TaskCategory } from '../types/Tasks';
import { useAuth } from '../contexts/AuthContext';

interface CreateFollowUpCampaignDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (campaignData: any) => void;
  salespersonId: string;
  tenantId: string;
  contactId: string;
  contactCompanyId?: string;
  hideAssociations?: boolean;
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
      id={`followup-tabpanel-${index}`}
      aria-labelledby={`followup-tab-${index}`}
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

const CreateFollowUpCampaignDialog: React.FC<CreateFollowUpCampaignDialogProps> = ({
  open,
  onClose,
  onSubmit,
  salespersonId,
  tenantId,
  contactId,
  contactCompanyId,
  hideAssociations = false
}) => {
  const { user } = useAuth();
  const [availableSalespeople, setAvailableSalespeople] = useState<any[]>([]);
  const [loadingSalespeople, setLoadingSalespeople] = useState(false);
  const [currentUserIsSalesperson, setCurrentUserIsSalesperson] = useState(false);
  
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    type: 'custom' as TaskType,
    priority: 'medium' as 'low' | 'medium' | 'high',
    status: 'scheduled' as TaskStatus,
    scheduledDate: new Date().toISOString().split('T')[0],
    scheduledTime: '09:00',
    estimatedDuration: 30,
    assignedTo: salespersonId,
    category: 'follow_up' as TaskCategory,
    quotaCategory: 'business_generating' as 'business_generating' | 'administrative' | 'training' | 'other',
    followUpFrequency: '30' as '30' | '60' | '90',
    selectedCompany: contactCompanyId || '',
    selectedContact: contactId,
    selectedDeal: '',
    selectedSalesperson: salespersonId,
    recipient: '',
    subject: '',
    draftContent: '',
    notes: '',
    tags: []
  });

  const [activeTab, setActiveTab] = useState(0);

  // Load salespeople and determine current user's salesperson status
  const loadSalespeople = async () => {
    if (!tenantId) return;
    
    setLoadingSalespeople(true);
    try {
      const functions = getFunctions();
              const getSalespeople = httpsCallable(functions, 'getSalespeopleForTenant');
      const result = await getSalespeople({ tenantId });
      const data = result.data as { salespeople: any[] };
      
      setAvailableSalespeople(data.salespeople || []);
      
      // Check if current user is a salesperson
      const currentUser = data.salespeople?.find((sp: any) => sp.id === user?.uid);
      setCurrentUserIsSalesperson(!!currentUser);
      
      // Set default assignment to current user if they're a salesperson, otherwise first available
      if (currentUser) {
        setFormData(prev => ({
          ...prev,
          assignedTo: user?.uid || salespersonId,
          selectedSalesperson: user?.uid || salespersonId
        }));
      } else if (data.salespeople?.length > 0) {
        setFormData(prev => ({
          ...prev,
          assignedTo: data.salespeople[0].id,
          selectedSalesperson: data.salespeople[0].id
        }));
      }
    } catch (error) {
      console.error('Error loading salespeople:', error);
      setAvailableSalespeople([]);
    } finally {
      setLoadingSalespeople(false);
    }
  };

  // Load salespeople when dialog opens
  useEffect(() => {
    if (open && tenantId) {
      loadSalespeople();
    }
  }, [open, tenantId]);

  useEffect(() => {
    if (open) {
      setFormData(prev => ({
        ...prev,
        selectedContact: contactId,
        selectedCompany: contactCompanyId || '',
        selectedSalesperson: salespersonId
      }));
    }
  }, [open, contactId, contactCompanyId, salespersonId]);

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSubmit = () => {
    // Create the campaign data with frequency information
    const campaignData = {
      ...formData,
      isFollowUpCampaign: true,
      followUpFrequency: parseInt(formData.followUpFrequency),
      campaignDuration: 2 * 365, // 2 years in days
      startDate: formData.scheduledDate,
      contactId: contactId,
      tenantId: tenantId,
      createdBy: salespersonId
    };
    
    onSubmit(campaignData);
  };

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Typography variant="h6">Create Follow Up Campaign</Typography>
        <Typography variant="body2" color="text.secondary">
          Create a series of recurring follow-up tasks for this contact
        </Typography>
      </DialogTitle>
      
      <DialogContent>
        <Tabs value={activeTab} onChange={handleTabChange} sx={{ mb: 2 }}>
          <Tab label="Basic Info" />
          <Tab label="Advanced" />
        </Tabs>

        <TabPanel value={activeTab} index={0}>
          <Grid container spacing={3}>
            {/* Task Title */}
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Campaign Title"
                value={formData.title}
                onChange={(e) => handleInputChange('title', e.target.value)}
                placeholder="e.g., Monthly Check-in Campaign"
              />
            </Grid>

            {/* Task Description */}
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Description"
                multiline
                rows={3}
                value={formData.description}
                onChange={(e) => handleInputChange('description', e.target.value)}
                placeholder="Describe the purpose of this follow-up campaign..."
              />
            </Grid>

            {/* Follow Up Frequency and Priority */}
            <Grid item xs={12}>
              <Typography variant="h6" gutterBottom>Follow Up Settings</Typography>
            </Grid>
            
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Follow Up Frequency</InputLabel>
                <Select
                  value={formData.followUpFrequency}
                  onChange={(e) => handleInputChange('followUpFrequency', e.target.value)}
                  label="Follow Up Frequency"
                >
                  <MenuItem value="30">Every 30 days</MenuItem>
                  <MenuItem value="60">Every 60 days</MenuItem>
                  <MenuItem value="90">Every 90 days</MenuItem>
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12} md={6}>
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

            {/* Scheduling */}
            <Grid item xs={12}>
              <Typography variant="h6" gutterBottom>Scheduling</Typography>
            </Grid>
            
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Scheduled Start Date"
                type="date"
                value={formData.scheduledDate}
                onChange={(e) => handleInputChange('scheduledDate', e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Scheduled Time"
                type="time"
                value={formData.scheduledTime}
                onChange={(e) => handleInputChange('scheduledTime', e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Estimated Duration (minutes)"
                type="number"
                value={formData.estimatedDuration}
                onChange={(e) => handleInputChange('estimatedDuration', parseInt(e.target.value))}
              />
            </Grid>

            {/* Task Assignment */}
            <Grid item xs={12}>
              <Typography variant="h6" gutterBottom>Task Assignment</Typography>
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>
                  Assign To {loadingSalespeople && <CircularProgress size={16} sx={{ ml: 1 }} />}
                </InputLabel>
                <Select
                  value={formData.assignedTo}
                  onChange={(e) => {
                    handleInputChange('assignedTo', e.target.value);
                    handleInputChange('selectedSalesperson', e.target.value);
                  }}
                  label={`Assign To ${loadingSalespeople ? '' : ''}`}
                  disabled={loadingSalespeople}
                >
                  {availableSalespeople.map((salesperson) => (
                    <MenuItem key={salesperson.id} value={salesperson.id}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2">
                          {salesperson.firstName} {salesperson.lastName}
                        </Typography>
                        {salesperson.id === user?.uid && (
                          <Chip label="You" size="small" color="primary" />
                        )}
                      </Box>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            {currentUserIsSalesperson && (
              <Grid item xs={12} md={6}>
                <Alert severity="info" sx={{ mt: 1 }}>
                  You are assigned as the default salesperson for this campaign.
                </Alert>
              </Grid>
            )}

            {/* Quota Category */}
            <Grid item xs={12}>
              <Typography variant="h6" gutterBottom>Quota Category</Typography>
            </Grid>
            
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Category</InputLabel>
                <Select
                  value={formData.quotaCategory}
                  onChange={(e) => handleInputChange('quotaCategory', e.target.value)}
                  label="Category"
                >
                  <MenuItem value="business_generating">Business Generating</MenuItem>
                  <MenuItem value="administrative">Administrative</MenuItem>
                  <MenuItem value="training">Training</MenuItem>
                  <MenuItem value="other">Other</MenuItem>
                </Select>
              </FormControl>
            </Grid>

            {/* Campaign Info */}
            <Grid item xs={12}>
              <Alert severity="info" sx={{ mt: 2 }}>
                <Typography variant="body2">
                  This campaign will create recurring tasks for <strong>2 years</strong> with the selected frequency.
                  <br />
                  <strong>Total tasks to be created:</strong> {Math.ceil((2 * 365) / parseInt(formData.followUpFrequency))} tasks
                </Typography>
              </Alert>
            </Grid>
          </Grid>
        </TabPanel>

        <TabPanel value={activeTab} index={1}>
          <Grid container spacing={3}>
            {/* Advanced Settings */}
            <Grid item xs={12}>
              <Typography variant="h6" gutterBottom>Advanced Settings</Typography>
            </Grid>

            {/* Notes */}
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Campaign Notes"
                multiline
                rows={4}
                value={formData.notes}
                onChange={(e) => handleInputChange('notes', e.target.value)}
                placeholder="Additional notes for this campaign..."
              />
            </Grid>

            {/* Tags */}
            <Grid item xs={12}>
              <Autocomplete
                multiple
                freeSolo
                options={[]}
                value={formData.tags}
                onChange={(event, newValue) => {
                  const tags = newValue.map(item => typeof item === 'string' ? item : (item as any).inputValue || '');
                  handleInputChange('tags', tags);
                }}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => {
                    const { key, ...chipProps } = getTagProps({ index });
                    return (
                      <Chip
                        key={key}
                        variant="outlined"
                        label={option}
                        {...chipProps}
                        size="small"
                      />
                    );
                  })
                }
                renderInput={(params) => (
                  <TextField
                    {...(params as any)}
                    label="Tags"
                    placeholder="Add tags..."
                    helperText="Press Enter to add a new tag"
                    size="small"
                  />
                )}
              />
            </Grid>

            {/* Campaign Details */}
            <Grid item xs={12}>
              <Alert severity="info">
                <Typography variant="body2">
                  <strong>Campaign Details:</strong>
                  <br />
                  • Frequency: Every {formData.followUpFrequency} days
                  <br />
                  • Duration: 2 years ({Math.ceil((2 * 365) / parseInt(formData.followUpFrequency))} total tasks)
                  <br />
                  • Category: Follow Up (Fixed)
                  <br />
                  • Type: Custom (Fixed)
                </Typography>
              </Alert>
            </Grid>
          </Grid>
        </TabPanel>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button 
          onClick={handleSubmit} 
          variant="contained" 
          disabled={!formData.title || !formData.description}
        >
          Create Campaign
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default CreateFollowUpCampaignDialog; 
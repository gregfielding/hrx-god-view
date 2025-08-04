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
  Tabs,
  Tab,
  Alert
} from '@mui/material';
import TaskContentGenerator from './TaskContentGenerator';
import { TaskType, TaskStatus, TaskCategory } from '../types/Tasks';

interface CreateTaskDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (taskData: any) => void;
  salespersonId: string;
  tenantId: string;
  companies?: any[];
  contacts?: any[];
  deals?: any[];
  salespeople?: any[];
  preSelectedDeal?: string;
  preSelectedCompany?: string;
  preSelectedContacts?: string[];
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
      {value === index && (
        <Box sx={{ p: 3 }}>
          {children}
        </Box>
      )}
    </div>
  );
}

const CreateTaskDialog: React.FC<CreateTaskDialogProps> = ({
  open,
  onClose,
  onSubmit,
  salespersonId,
  tenantId,
  companies = [],
  contacts = [],
  deals = [],
  salespeople = [],
  preSelectedDeal,
  preSelectedCompany,
  preSelectedContacts = []
}) => {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    type: 'custom' as TaskType,
    priority: 'medium' as 'low' | 'medium' | 'high',
    status: 'scheduled' as TaskStatus,
    scheduledDate: new Date().toISOString().split('T')[0],
    scheduledTime: '09:00',
    dueDate: '',
    dueTime: '',
    estimatedDuration: 30,
    assignedTo: salespersonId,
    category: 'follow_up' as TaskCategory,
    quotaCategory: 'business_generating' as 'business_generating' | 'administrative' | 'training' | 'other',
    selectedCompany: preSelectedCompany || '',
    selectedLocation: '',
    selectedContact: '',
    selectedDeal: preSelectedDeal || '',
    selectedSalesperson: salespersonId,
    recipient: '',
    subject: '',
    draftContent: '',
    notes: '',
    tags: []
  });

  const [tabValue, setTabValue] = useState(0);
  const [generatedContent, setGeneratedContent] = useState<any>(null);

  // Update form when pre-selected values change
  useEffect(() => {
    setFormData(prev => ({
      ...prev,
      selectedDeal: preSelectedDeal || prev.selectedDeal,
      selectedCompany: preSelectedCompany || prev.selectedCompany,
      selectedContact: preSelectedContacts.length > 0 ? preSelectedContacts[0] : prev.selectedContact
    }));
  }, [preSelectedDeal, preSelectedCompany, preSelectedContacts]);

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSubmit = () => {
    const scheduledDateTime = new Date(`${formData.scheduledDate}T${formData.scheduledTime}`);
    const dueDateTime = formData.dueDate && formData.dueTime ? 
      new Date(`${formData.dueDate}T${formData.dueTime}`) : null;

    const taskData = {
      title: formData.title,
      description: formData.description,
      type: formData.type,
      priority: formData.priority,
      status: formData.status,
      scheduledDate: scheduledDateTime.toISOString(),
      dueDate: dueDateTime?.toISOString() || null,
      estimatedDuration: formData.estimatedDuration,
      assignedTo: formData.assignedTo,
      createdBy: salespersonId,
      tenantId,
      category: formData.category,
      quotaCategory: formData.quotaCategory,
      associations: {
        deals: formData.selectedDeal ? [formData.selectedDeal] : [],
        companies: formData.selectedCompany ? [formData.selectedCompany] : [],
        contacts: formData.selectedContact ? [formData.selectedContact] : [],
        salespeople: formData.selectedSalesperson ? [formData.selectedSalesperson] : []
      },
      notes: formData.notes,
      tags: formData.tags,
      communicationDetails: formData.type === 'email' ? {
        method: 'email' as const,
        recipient: formData.recipient,
        subject: formData.subject,
        draftContent: formData.draftContent
      } : undefined
    };

    onSubmit(taskData);
  };

  // Filter contacts and deals based on selected company
  const filteredContacts = formData.selectedCompany ? 
    contacts.filter(contact => contact.companyId === formData.selectedCompany) : contacts;
  
  const filteredDeals = formData.selectedCompany ? 
    deals.filter(deal => deal.companyId === formData.selectedCompany) : deals;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>Create New Task</DialogTitle>
      <DialogContent>
        <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
          <Tabs value={tabValue} onChange={(e, newValue) => setTabValue(newValue)}>
            <Tab label="Task Details" />
            <Tab label="AI Content" />
          </Tabs>
        </Box>

        <TabPanel value={tabValue} index={0}>
          <Grid container spacing={3}>
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

          {/* Scheduling */}
          <Grid item xs={12}>
            <Typography variant="h6" gutterBottom>Scheduling</Typography>
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="Scheduled Date"
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
              label="Due Date (Optional)"
              type="date"
              value={formData.dueDate}
              onChange={(e) => handleInputChange('dueDate', e.target.value)}
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

          {/* CRM Associations */}
          <Grid item xs={12}>
            <Typography variant="h6" gutterBottom>CRM Associations</Typography>
          </Grid>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth>
              <InputLabel>Company</InputLabel>
              <Select
                value={formData.selectedCompany}
                onChange={(e) => handleInputChange('selectedCompany', e.target.value)}
                label="Company"
              >
                <MenuItem value="">None</MenuItem>
                {companies.map((company) => (
                  <MenuItem key={company.id} value={company.id}>
                    {company.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth>
              <InputLabel>Contact</InputLabel>
              <Select
                value={formData.selectedContact}
                onChange={(e) => handleInputChange('selectedContact', e.target.value)}
                label="Contact"
              >
                <MenuItem value="">None</MenuItem>
                {filteredContacts.map((contact) => (
                  <MenuItem key={contact.id} value={contact.id}>
                    {contact.firstName} {contact.lastName}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth>
              <InputLabel>Deal</InputLabel>
              <Select
                value={formData.selectedDeal}
                onChange={(e) => handleInputChange('selectedDeal', e.target.value)}
                label="Deal"
              >
                <MenuItem value="">None</MenuItem>
                {filteredDeals.map((deal) => (
                  <MenuItem key={deal.id} value={deal.id}>
                    {deal.title}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth>
              <InputLabel>Assigned To</InputLabel>
              <Select
                value={formData.selectedSalesperson}
                onChange={(e) => handleInputChange('selectedSalesperson', e.target.value)}
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
                  value={formData.recipient}
                  onChange={(e) => handleInputChange('recipient', e.target.value)}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Subject"
                  value={formData.subject}
                  onChange={(e) => handleInputChange('subject', e.target.value)}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Draft Content"
                  value={formData.draftContent}
                  onChange={(e) => handleInputChange('draftContent', e.target.value)}
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
        </TabPanel>

        <TabPanel value={tabValue} index={1}>
          <TaskContentGenerator
            taskId="new"
            tenantId={tenantId}
            task={formData}
            onContentGenerated={setGeneratedContent}
          />
        </TabPanel>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button 
          onClick={handleSubmit} 
          variant="contained"
          disabled={!formData.title}
        >
          Create Task
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default CreateTaskDialog; 
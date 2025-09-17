import React, { useState, useEffect } from 'react';
import { safeToDate } from '../utils/dateUtils';
import {
  Box,
  Typography,
  TextField,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormHelperText,
  Checkbox,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Chip,
  Alert,
  Divider,
  Grid,
  Autocomplete,
  Switch,
  FormLabel,
  Paper,
  Stack,
  IconButton,
  Tooltip,
  CircularProgress,
  Snackbar
} from '@mui/material';
import {
  Save as SaveIcon,
  Send as SendIcon,
  Business as BusinessIcon,
  LocationOn as LocationIcon,
  Person as PersonIcon,
  Description as DescriptionIcon,
  AttachMoney as MoneyIcon,
  Visibility as VisibilityIcon,
  Security as SecurityIcon,
  Work as WorkIcon,
  Schedule as ScheduleIcon,
  Group as GroupIcon,
  CheckCircle as CheckCircleIcon,
  Warning as WarningIcon
} from '@mui/icons-material';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { p } from '../data/firestorePaths';
import { useFlag } from '../hooks/useFlag';
import { JobOrder } from '../types/Phase1Types';

interface DealDraftJobOrderFormProps {
  dealId: string;
  dealData: {
    id: string;
    name: string;
    companyId: string;
    locationId?: string;
    stage: string;
    estimatedRevenue?: number;
    owner: string;
    draftJobOrder?: DraftJobOrderData;
  };
  onJobOrderGenerated?: (jobOrderId: string) => void;
  onSave?: () => void;
}

interface DraftJobOrderData {
  // Account & Location
  accountId: string;
  locationId?: string;
  
  // Basics
  name: string;
  description: string;
  status: 'open' | 'on-hold' | 'cancelled' | 'filled' | 'completed';
  
  // Headcount & Dates
  workersNeeded: number;
  dateOpened: string;
  startDate: string;
  endDate?: string;
  
  // Pay/Bill & WC
  payRate?: number;
  billRate?: number;
  wcCode?: string;
  wcRate?: number;
  
  // Posting
  boardVisibility: 'hidden' | 'all' | 'groups';
  groupIds: string[];
  showPayRateOnBoard: boolean;
  showShiftTimes: boolean;
  
  // Requirements
  licenses: string[];
  drugScreen: {
    required: boolean;
    panel: string;
  };
  backgroundCheck: {
    required: boolean;
    package: string;
  };
  skills: string[];
  experience: string;
  languages: string[];
  education: string;
  physicalRequirements: string[];
  ppe: string[];
  training: string[];
  
  // Operations
  timesheetMethod: string;
  checkInInstructions: string;
  checkInContactId?: string;
  
  // Owners
  recruiterIds: string[];
}

const DealDraftJobOrderForm: React.FC<DealDraftJobOrderFormProps> = ({
  dealId,
  dealData,
  onJobOrderGenerated,
  onSave
}) => {
  const { user, tenantId } = useAuth();
  const useNewDataModel = useFlag('NEW_DATA_MODEL');
  
  // Form state
  const [formData, setFormData] = useState<DraftJobOrderData>({
    accountId: dealData.companyId,
    locationId: dealData.locationId,
    name: dealData.name || '',
    description: '',
    status: 'open',
    workersNeeded: 1,
    dateOpened: new Date().toISOString().split('T')[0],
    startDate: new Date().toISOString().split('T')[0],
    endDate: '',
    payRate: 0,
    billRate: 0,
    wcCode: '',
    wcRate: 0,
    boardVisibility: 'hidden',
    groupIds: [],
    showPayRateOnBoard: false,
    showShiftTimes: false,
    licenses: [],
    drugScreen: { required: false, panel: '5-panel' },
    backgroundCheck: { required: false, package: 'standard' },
    skills: [],
    experience: '',
    languages: [],
    education: '',
    physicalRequirements: [],
    ppe: [],
    training: [],
    timesheetMethod: 'mobile',
    checkInInstructions: '',
    checkInContactId: '',
    recruiterIds: [user?.uid || '']
  });

  // UI state
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>({
    open: false,
    message: '',
    severity: 'info'
  });

  // Load existing draft data
  useEffect(() => {
    if (dealData.draftJobOrder) {
      setFormData(prev => ({ ...prev, ...dealData.draftJobOrder }));
    }
  }, [dealData.draftJobOrder]);

  // Form validation
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Job order name is required';
    }
    if (!formData.description.trim()) {
      newErrors.description = 'Description is required';
    }
    if (formData.workersNeeded < 1) {
      newErrors.workersNeeded = 'At least 1 worker is required';
    }
    if (!formData.startDate) {
      newErrors.startDate = 'Start date is required';
    }
    if (formData.boardVisibility === 'groups' && formData.groupIds.length === 0) {
      newErrors.groupIds = 'At least one group must be selected for group visibility';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Save draft to deal
  const saveDraft = async () => {
    if (!tenantId || !user) return;

    setSaving(true);
    try {
      const dealRef = doc(db, p.accountDeals(tenantId, dealData.companyId), dealId);
      await updateDoc(dealRef, {
        draftJobOrder: formData,
        updatedAt: serverTimestamp()
      });

      setToast({
        open: true,
        message: 'Draft saved successfully',
        severity: 'success'
      });
      onSave?.();
    } catch (error) {
      console.error('Error saving draft:', error);
      setToast({
        open: true,
        message: 'Error saving draft',
        severity: 'error'
      });
    } finally {
      setSaving(false);
    }
  };

  // Generate job order
  const generateJobOrder = async () => {
    if (!validateForm() || !tenantId || !user) return;

    setLoading(true);
    try {
      // Import the counter and data access utilities
      const { getNextJobOrderNumber } = await import('../utils/counters');
      const { getPhase1JobOrderDataAccess } = await import('../utils/phase1DataAccess');

      // Get next job order number
      const jobOrderNumberStr = await getNextJobOrderNumber(tenantId);
      const jobOrderNumber = parseInt(jobOrderNumberStr.replace('JO-', ''));

      // Build job order payload
      const jobOrderData: Omit<JobOrder, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'> = {
        tenantId,
        jobOrderNumber,
        jobOrderName: formData.name,
        status: 'Open',
        companyId: formData.accountId,
        locationId: formData.locationId,
        dateOpened: safeToDate(formData.dateOpened).getTime(),
        startDate: formData.startDate,
        endDate: formData.endDate || undefined,
        recruiterId: formData.recruiterIds[0] || user.uid,
        userGroups: formData.groupIds,
        description: formData.description,
        requirements: [
          ...formData.skills,
          ...formData.licenses,
          ...formData.physicalRequirements,
          ...formData.ppe,
          ...formData.training
        ],
        payRate: formData.payRate,
        billRate: formData.billRate,
        openings: formData.workersNeeded,
        remainingOpenings: formData.workersNeeded,
        priority: 'Medium',
        tags: [],
        notes: formData.checkInInstructions
      };

      // Create job order
      const jobOrderAccess = getPhase1JobOrderDataAccess(tenantId);
      const jobOrder = await jobOrderAccess.create(jobOrderData);

      // Update deal with job order reference
      const dealRef = doc(db, p.accountDeals(tenantId, dealData.companyId), dealId);
      await updateDoc(dealRef, {
        jobOrderId: jobOrder.id,
        updatedAt: serverTimestamp()
      });

      setToast({
        open: true,
        message: `Job Order JO-${jobOrderNumber.toString().padStart(4, '0')} created successfully`,
        severity: 'success'
      });

      onJobOrderGenerated?.(jobOrder.id);
    } catch (error) {
      console.error('Error generating job order:', error);
      setToast({
        open: true,
        message: 'Error generating job order',
        severity: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  // Handle form field changes
  const handleFieldChange = (field: keyof DraftJobOrderData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  // Handle nested field changes
  const handleNestedFieldChange = (parentField: keyof DraftJobOrderData, childField: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [parentField]: {
        ...(prev[parentField] as any),
        [childField]: value
      }
    }));
  };

  // Handle array field changes
  const handleArrayFieldChange = (field: keyof DraftJobOrderData, value: string[]) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  if (!useNewDataModel) {
    return (
      <Alert severity="info" sx={{ mb: 2 }}>
        New data model is disabled. Enable the NEW_DATA_MODEL feature flag to use this form.
      </Alert>
    );
  }

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', p: 3 }}>
      <Typography variant="h4" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <WorkIcon />
        Draft Job Order
      </Typography>
      
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Create a job order from this deal. All fields will be saved as draft until you generate the job order.
      </Typography>

      <Paper sx={{ p: 3, mb: 3 }}>
        {/* Section 1: Account & Location */}
        <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <BusinessIcon />
          Account & Location
        </Typography>
        
        <Grid container spacing={3} sx={{ mb: 3 }}>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="Account"
              value={formData.accountId}
              disabled
              helperText="Account is auto-filled from deal"
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="Location"
              value={formData.locationId || ''}
              onChange={(e) => handleFieldChange('locationId', e.target.value)}
              helperText="Select location (optional)"
            />
          </Grid>
        </Grid>

        <Divider sx={{ my: 3 }} />

        {/* Section 2: Basics */}
        <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <DescriptionIcon />
          Basics
        </Typography>
        
        <Grid container spacing={3} sx={{ mb: 3 }}>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="Job Order Name"
              value={formData.name}
              onChange={(e) => handleFieldChange('name', e.target.value)}
              error={!!errors.name}
              helperText={errors.name || 'e.g., "Forklift Operator - Vegas"'}
              required
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth>
              <InputLabel>Status</InputLabel>
              <Select
                value={formData.status}
                onChange={(e) => handleFieldChange('status', e.target.value)}
                label="Status"
              >
                <MenuItem value="open">Open</MenuItem>
                <MenuItem value="on-hold">On-Hold</MenuItem>
                <MenuItem value="cancelled">Cancelled</MenuItem>
                <MenuItem value="filled">Filled</MenuItem>
                <MenuItem value="completed">Completed</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Description"
              value={formData.description}
              onChange={(e) => handleFieldChange('description', e.target.value)}
              error={!!errors.description}
              helperText={errors.description || 'Detailed job description'}
              multiline
              rows={3}
              required
            />
          </Grid>
        </Grid>

        <Divider sx={{ my: 3 }} />

        {/* Section 3: Headcount & Dates */}
        <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ScheduleIcon />
          Headcount & Dates
        </Typography>
        
        <Grid container spacing={3} sx={{ mb: 3 }}>
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              label="Workers Needed"
              type="number"
              value={formData.workersNeeded}
              onChange={(e) => handleFieldChange('workersNeeded', parseInt(e.target.value) || 1)}
              error={!!errors.workersNeeded}
              helperText={errors.workersNeeded}
              required
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              label="Date Opened"
              type="date"
              value={formData.dateOpened}
              onChange={(e) => handleFieldChange('dateOpened', e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              label="Start Date"
              type="date"
              value={formData.startDate}
              onChange={(e) => handleFieldChange('startDate', e.target.value)}
              error={!!errors.startDate}
              helperText={errors.startDate}
              InputLabelProps={{ shrink: true }}
              required
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="End Date"
              type="date"
              value={formData.endDate || ''}
              onChange={(e) => handleFieldChange('endDate', e.target.value)}
              InputLabelProps={{ shrink: true }}
              helperText="Optional - leave blank for ongoing"
            />
          </Grid>
        </Grid>

        <Divider sx={{ my: 3 }} />

        {/* Section 4: Pay/Bill & WC */}
        <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <MoneyIcon />
          Pay/Bill & Workers' Compensation
        </Typography>
        
        <Grid container spacing={3} sx={{ mb: 3 }}>
          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              label="Pay Rate"
              type="number"
              value={formData.payRate || ''}
              onChange={(e) => handleFieldChange('payRate', parseFloat(e.target.value) || 0)}
              helperText="Hourly rate for workers"
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              label="Bill Rate"
              type="number"
              value={formData.billRate || ''}
              onChange={(e) => handleFieldChange('billRate', parseFloat(e.target.value) || 0)}
              helperText="Rate charged to client"
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              label="WC Code"
              value={formData.wcCode || ''}
              onChange={(e) => handleFieldChange('wcCode', e.target.value)}
              helperText="Workers' compensation code"
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              label="WC Rate"
              type="number"
              value={formData.wcRate || ''}
              onChange={(e) => handleFieldChange('wcRate', parseFloat(e.target.value) || 0)}
              helperText="WC rate percentage"
            />
          </Grid>
        </Grid>

        <Divider sx={{ my: 3 }} />

        {/* Section 5: Posting */}
        <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <VisibilityIcon />
          Job Board Posting
        </Typography>
        
        <Grid container spacing={3} sx={{ mb: 3 }}>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth>
              <InputLabel>Board Visibility</InputLabel>
              <Select
                value={formData.boardVisibility}
                onChange={(e) => handleFieldChange('boardVisibility', e.target.value)}
                label="Board Visibility"
              >
                <MenuItem value="hidden">Hidden</MenuItem>
                <MenuItem value="all">All Users</MenuItem>
                <MenuItem value="groups">Specific Groups</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth error={!!errors.groupIds}>
              <InputLabel>Groups</InputLabel>
              <Select
                multiple
                value={formData.groupIds}
                onChange={(e) => handleArrayFieldChange('groupIds', e.target.value as string[])}
                label="Groups"
                disabled={formData.boardVisibility !== 'groups'}
              >
                {/* TODO: Load actual groups */}
                <MenuItem value="group1">Group 1</MenuItem>
                <MenuItem value="group2">Group 2</MenuItem>
              </Select>
              {errors.groupIds && <FormHelperText>{errors.groupIds}</FormHelperText>}
            </FormControl>
          </Grid>
          <Grid item xs={12} md={6}>
            <FormControlLabel
              control={
                <Switch
                  checked={formData.showPayRateOnBoard}
                  onChange={(e) => handleFieldChange('showPayRateOnBoard', e.target.checked)}
                />
              }
              label="Show Pay Rate on Board"
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <FormControlLabel
              control={
                <Switch
                  checked={formData.showShiftTimes}
                  onChange={(e) => handleFieldChange('showShiftTimes', e.target.checked)}
                />
              }
              label="Show Shift Times"
            />
          </Grid>
        </Grid>

        <Divider sx={{ my: 3 }} />

        {/* Section 6: Requirements */}
        <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <SecurityIcon />
          Requirements
        </Typography>
        
        <Grid container spacing={3} sx={{ mb: 3 }}>
          <Grid item xs={12} md={6}>
            <Autocomplete
              multiple
              freeSolo
              options={[]}
              value={formData.licenses}
              onChange={(_, value) => handleArrayFieldChange('licenses', value)}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Required Licenses"
                  placeholder="Add license..."
                />
              )}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <Autocomplete
              multiple
              freeSolo
              options={[]}
              value={formData.skills}
              onChange={(_, value) => handleArrayFieldChange('skills', value)}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Required Skills"
                  placeholder="Add skill..."
                />
              )}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={formData.drugScreen.required}
                  onChange={(e) => handleNestedFieldChange('drugScreen', 'required', e.target.checked)}
                />
              }
              label="Drug Screen Required"
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={formData.backgroundCheck.required}
                  onChange={(e) => handleNestedFieldChange('backgroundCheck', 'required', e.target.checked)}
                />
              }
              label="Background Check Required"
            />
          </Grid>
        </Grid>

        <Divider sx={{ my: 3 }} />

        {/* Section 7: Operations */}
        <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <WorkIcon />
          Operations
        </Typography>
        
        <Grid container spacing={3} sx={{ mb: 3 }}>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth>
              <InputLabel>Timesheet Method</InputLabel>
              <Select
                value={formData.timesheetMethod}
                onChange={(e) => handleFieldChange('timesheetMethod', e.target.value)}
                label="Timesheet Method"
              >
                <MenuItem value="mobile">Mobile App</MenuItem>
                <MenuItem value="web">Web Portal</MenuItem>
                <MenuItem value="paper">Paper Timesheet</MenuItem>
                <MenuItem value="kiosk">Kiosk</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="Check-in Contact"
              value={formData.checkInContactId || ''}
              onChange={(e) => handleFieldChange('checkInContactId', e.target.value)}
              helperText="Contact ID for check-in instructions"
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Check-in Instructions"
              value={formData.checkInInstructions}
              onChange={(e) => handleFieldChange('checkInInstructions', e.target.value)}
              multiline
              rows={2}
              helperText="Special instructions for worker check-in"
            />
          </Grid>
        </Grid>

        <Divider sx={{ my: 3 }} />

        {/* Section 8: Owners */}
        <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <GroupIcon />
          Recruiters
        </Typography>
        
        <Grid container spacing={3} sx={{ mb: 3 }}>
          <Grid item xs={12}>
            <Autocomplete
              multiple
              options={[]}
              value={formData.recruiterIds}
              onChange={(_, value) => handleArrayFieldChange('recruiterIds', value)}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Assigned Recruiters"
                  placeholder="Select recruiters..."
                />
              )}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => (
                  <Chip
                    variant="outlined"
                    label={option}
                    {...getTagProps({ index })}
                    key={option}
                  />
                ))
              }
            />
          </Grid>
        </Grid>
      </Paper>

      {/* Action Buttons */}
      <Stack direction="row" spacing={2} justifyContent="flex-end">
        <Button
          variant="outlined"
          startIcon={saving ? <CircularProgress size={20} /> : <SaveIcon />}
          onClick={saveDraft}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Draft'}
        </Button>
        
        <Button
          variant="contained"
          startIcon={loading ? <CircularProgress size={20} /> : <SendIcon />}
          onClick={generateJobOrder}
          disabled={loading}
          color="primary"
        >
          {loading ? 'Generating...' : 'Generate Job Order'}
        </Button>
      </Stack>

      {/* Toast Notification */}
      <Snackbar
        open={toast.open}
        autoHideDuration={6000}
        onClose={() => setToast(prev => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          onClose={() => setToast(prev => ({ ...prev, open: false }))}
          severity={toast.severity}
          sx={{ width: '100%' }}
        >
          {toast.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default DealDraftJobOrderForm;

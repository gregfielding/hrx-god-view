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
  Switch,
  FormControlLabel,
  Grid,
  Box,
  Typography,
  Chip,
  Alert,
  CircularProgress,
  Autocomplete,
  Divider
} from '@mui/material';
import {
  Work as WorkIcon,
  Visibility as VisibilityIcon,
  Group as GroupIcon,
  Schedule as ScheduleIcon,
  AttachMoney as MoneyIcon
} from '@mui/icons-material';
import { JobOrder } from '../../types/recruiter/jobOrder';
import { JobsBoardService, CreatePostData } from '../../services/recruiter/jobsBoardService';
import { useAuth } from '../../contexts/AuthContext';

interface PostToJobsBoardDialogProps {
  open: boolean;
  onClose: () => void;
  jobOrder: JobOrder;
  onPostCreated?: (postId: string) => void;
  groups?: Array<{ id: string; name: string }>;
}

const PostToJobsBoardDialog: React.FC<PostToJobsBoardDialogProps> = ({
  open,
  onClose,
  jobOrder,
  onPostCreated,
  groups = []
}) => {
  const { tenantId, user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  const [formData, setFormData] = useState<CreatePostData>({
    jobOrderId: jobOrder.id,
    title: jobOrder.jobOrderName,
    description: jobOrder.jobOrderDescription || '',
    location: jobOrder.worksiteName,
    companyName: jobOrder.companyName,
    payRate: jobOrder.payRate,
    showPayRate: jobOrder.showPayRate,
    startDate: jobOrder.startDate,
    showStartDate: jobOrder.showStartDate,
    shiftTimes: '',
    showShiftTimes: jobOrder.showShiftTimes,
    requirements: [
      ...jobOrder.requiredLicenses,
      ...jobOrder.requiredCertifications,
      ...(jobOrder.drugScreenRequired ? ['Drug Screen Required'] : []),
      ...(jobOrder.backgroundCheckRequired ? ['Background Check Required'] : []),
      ...(jobOrder.experienceRequired ? [jobOrder.experienceRequired] : []),
      ...(jobOrder.educationRequired ? [jobOrder.educationRequired] : []),
      ...(jobOrder.languagesRequired || []),
      ...(jobOrder.skillsRequired || [])
    ].filter(Boolean),
    benefits: '',
    visibility: jobOrder.jobsBoardVisibility,
    restrictedGroups: jobOrder.restrictedGroups || [],
    maxApplications: undefined,
    expiresAt: undefined
  });

  const jobsBoardService = JobsBoardService.getInstance();

  useEffect(() => {
    if (open) {
      // Reset form when dialog opens
      setFormData({
        jobOrderId: jobOrder.id,
        title: jobOrder.jobOrderName,
        description: jobOrder.jobOrderDescription || '',
        location: jobOrder.worksiteName,
        companyName: jobOrder.companyName,
        payRate: jobOrder.payRate,
        showPayRate: jobOrder.showPayRate,
        startDate: jobOrder.startDate,
        showStartDate: jobOrder.showStartDate,
        shiftTimes: '',
        showShiftTimes: jobOrder.showShiftTimes,
        requirements: [
          ...jobOrder.requiredLicenses,
          ...jobOrder.requiredCertifications,
          ...(jobOrder.drugScreenRequired ? ['Drug Screen Required'] : []),
          ...(jobOrder.backgroundCheckRequired ? ['Background Check Required'] : []),
          ...(jobOrder.experienceRequired ? [jobOrder.experienceRequired] : []),
          ...(jobOrder.educationRequired ? [jobOrder.educationRequired] : []),
          ...(jobOrder.languagesRequired || []),
          ...(jobOrder.skillsRequired || [])
        ].filter(Boolean),
        benefits: '',
        visibility: jobOrder.jobsBoardVisibility,
        restrictedGroups: jobOrder.restrictedGroups || [],
        maxApplications: undefined,
        expiresAt: undefined
      });
      setError(null);
      setSuccess(null);
    }
  }, [open, jobOrder]);

  const handleInputChange = (field: keyof CreatePostData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleRequirementChange = (requirements: string[]) => {
    setFormData(prev => ({ ...prev, requirements }));
  };

  const handleSubmit = async () => {
    if (!tenantId || !user?.uid) {
      setError('Missing tenant or user information');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const postId = await jobsBoardService.createPostFromJobOrder(
        tenantId,
        jobOrder.id,
        user.uid,
        formData
      );
      
      setSuccess('Job posted to Jobs Board successfully!');
      
      if (onPostCreated) {
        onPostCreated(postId);
      }
      
      // Close dialog after a short delay
      setTimeout(() => {
        onClose();
        setSuccess(null);
      }, 2000);
      
    } catch (err: any) {
      console.error('Error posting to jobs board:', err);
      setError(err.message || 'Failed to post to jobs board');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      onClose();
      setError(null);
      setSuccess(null);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <WorkIcon color="primary" />
          Post Job Order to Jobs Board
        </Box>
      </DialogTitle>
      
      <DialogContent>
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" color="text.secondary">
            Posting Job Order #{jobOrder.jobOrderNumber} - {jobOrder.jobOrderName}
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {success && (
          <Alert severity="success" sx={{ mb: 2 }}>
            {success}
          </Alert>
        )}

        <Grid container spacing={3}>
          {/* Basic Information */}
          <Grid item xs={12}>
            <Typography variant="h6" gutterBottom>
              Job Details
            </Typography>
          </Grid>
          
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="Job Title"
              value={formData.title}
              onChange={(e) => handleInputChange('title', e.target.value)}
              required
            />
          </Grid>
          
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="Company Name"
              value={formData.companyName}
              onChange={(e) => handleInputChange('companyName', e.target.value)}
              required
            />
          </Grid>
          
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="Location"
              value={formData.location}
              onChange={(e) => handleInputChange('location', e.target.value)}
              required
            />
          </Grid>
          
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="Pay Rate ($/hour)"
              type="number"
              value={formData.payRate || ''}
              onChange={(e) => handleInputChange('payRate', parseFloat(e.target.value) || undefined)}
            />
          </Grid>
          
          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Job Description"
              multiline
              rows={4}
              value={formData.description}
              onChange={(e) => handleInputChange('description', e.target.value)}
            />
          </Grid>

          {/* Display Options */}
          <Grid item xs={12}>
            <Divider sx={{ my: 2 }} />
            <Typography variant="h6" gutterBottom>
              Display Options
            </Typography>
          </Grid>
          
          <Grid item xs={12} md={4}>
            <FormControlLabel
              control={
                <Switch
                  checked={formData.showPayRate}
                  onChange={(e) => handleInputChange('showPayRate', e.target.checked)}
                />
              }
              label="Show Pay Rate"
            />
          </Grid>
          
          <Grid item xs={12} md={4}>
            <FormControlLabel
              control={
                <Switch
                  checked={formData.showStartDate}
                  onChange={(e) => handleInputChange('showStartDate', e.target.checked)}
                />
              }
              label="Show Start Date"
            />
          </Grid>
          
          <Grid item xs={12} md={4}>
            <FormControlLabel
              control={
                <Switch
                  checked={formData.showShiftTimes}
                  onChange={(e) => handleInputChange('showShiftTimes', e.target.checked)}
                />
              }
              label="Show Shift Times"
            />
          </Grid>

          {/* Visibility Settings */}
          <Grid item xs={12}>
            <Divider sx={{ my: 2 }} />
            <Typography variant="h6" gutterBottom>
              Visibility Settings
            </Typography>
          </Grid>
          
          <Grid item xs={12} md={6}>
            <FormControl fullWidth>
              <InputLabel>Visibility</InputLabel>
              <Select
                value={formData.visibility}
                label="Visibility"
                onChange={(e) => handleInputChange('visibility', e.target.value)}
              >
                <MenuItem value="hidden">Hidden</MenuItem>
                <MenuItem value="public">Public</MenuItem>
                <MenuItem value="group_restricted">Group Restricted</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          
          {formData.visibility === 'group_restricted' && (
            <Grid item xs={12} md={6}>
              <Autocomplete
                multiple
                options={groups}
                getOptionLabel={(option) => option.name}
                value={groups.filter(g => formData.restrictedGroups?.includes(g.id))}
                onChange={(_, newValue) => handleInputChange('restrictedGroups', newValue.map(g => g.id))}
                renderInput={(params) => (
                  <TextField {...params} label="Restricted Groups" />
                )}
              />
            </Grid>
          )}

          {/* Requirements */}
          <Grid item xs={12}>
            <Divider sx={{ my: 2 }} />
            <Typography variant="h6" gutterBottom>
              Requirements
            </Typography>
          </Grid>
          
          <Grid item xs={12}>
            <Autocomplete
              multiple
              options={[]}
              value={formData.requirements}
              onChange={(_, newValue) => handleRequirementChange(newValue)}
              renderInput={(params) => (
                <TextField {...params} label="Requirements" />
              )}
              freeSolo
            />
          </Grid>

          {/* Additional Settings */}
          <Grid item xs={12}>
            <Divider sx={{ my: 2 }} />
            <Typography variant="h6" gutterBottom>
              Additional Settings
            </Typography>
          </Grid>
          
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="Benefits"
              multiline
              rows={2}
              value={formData.benefits || ''}
              onChange={(e) => handleInputChange('benefits', e.target.value)}
            />
          </Grid>
          
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="Shift Times"
              value={formData.shiftTimes || ''}
              onChange={(e) => handleInputChange('shiftTimes', e.target.value)}
              placeholder="e.g., Monday-Friday, 8:00 AM - 5:00 PM"
            />
          </Grid>
          
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="Max Applications"
              type="number"
              value={formData.maxApplications || ''}
              onChange={(e) => handleInputChange('maxApplications', parseInt(e.target.value) || undefined)}
            />
          </Grid>
          
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="Expires At"
              type="datetime-local"
              value={formData.expiresAt ? formData.expiresAt.toISOString().slice(0, 16) : ''}
              onChange={(e) => handleInputChange('expiresAt', e.target.value ? new Date(e.target.value) : undefined)}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
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
          startIcon={loading ? <CircularProgress size={20} /> : <WorkIcon />}
        >
          {loading ? 'Posting...' : 'Post to Jobs Board'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default PostToJobsBoardDialog;

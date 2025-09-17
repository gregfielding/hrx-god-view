import React, { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  Grid,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Rating,
  Chip,
  Stack,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  FormControlLabel,
  Checkbox
} from '@mui/material';
import {
  Person as PersonIcon,
  Work as WorkIcon,
  Save as SaveIcon,
  Cancel as CancelIcon
} from '@mui/icons-material';
import { ApplicationFormData, ApplicationStage, ApplicationSource } from '../../types/phase2';
import { getApplicationService } from '../../services/phase2/applicationService';

interface CreateApplicationProps {
  tenantId: string;
  jobOrderId?: string; // If provided, create job-linked application
  open: boolean;
  onClose: () => void;
  onSuccess: (applicationId: string) => void;
}

const CreateApplication: React.FC<CreateApplicationProps> = ({
  tenantId,
  jobOrderId,
  open,
  onClose,
  onSuccess
}) => {
  const [formData, setFormData] = useState<ApplicationFormData>({
    jobOrderId: jobOrderId || null,
    candidate: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      city: '',
      state: '',
      country: 'USA'
    },
    status: 'applied',
    rating: undefined,
    tags: [],
    notes: '',
    requires: {
      backgroundCheck: false,
      drugScreen: false,
      licenses: []
    },
    source: 'manual'
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');

  const applicationService = getApplicationService();

  const handleInputChange = (field: string, value: any) => {
    if (field.startsWith('candidate.')) {
      const candidateField = field.split('.')[1];
      setFormData(prev => ({
        ...prev,
        candidate: {
          ...prev.candidate,
          [candidateField]: value
        }
      }));
    } else if (field.startsWith('requires.')) {
      const requiresField = field.split('.')[1];
      setFormData(prev => ({
        ...prev,
        requires: {
          ...prev.requires,
          [requiresField]: value
        }
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        [field]: value
      }));
    }
  };

  const handleAddTag = () => {
    if (tagInput.trim() && !formData.tags?.includes(tagInput.trim())) {
      setFormData(prev => ({
        ...prev,
        tags: [...(prev.tags || []), tagInput.trim()]
      }));
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags?.filter(tag => tag !== tagToRemove) || []
    }));
  };

  const handleSubmit = async () => {
    try {
      setLoading(true);
      setError(null);

      // Validate required fields
      if (!formData.candidate.firstName || !formData.candidate.lastName) {
        setError('First name and last name are required');
        return;
      }

      const applicationId = await applicationService.createApplication(
        tenantId,
        formData,
        'current-user' // TODO: Get actual user ID
      );

      onSuccess(applicationId);
      onClose();
      
      // Reset form
      setFormData({
        jobOrderId: jobOrderId || null,
        candidate: {
          firstName: '',
          lastName: '',
          email: '',
          phone: '',
          city: '',
          state: '',
          country: 'USA'
        },
        status: 'applied',
        rating: undefined,
        tags: [],
        notes: '',
        requires: {
          backgroundCheck: false,
          drugScreen: false,
          licenses: []
        },
        source: 'manual'
      });
    } catch (error) {
      console.error('Error creating application:', error);
      setError('Failed to create application. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    onClose();
    setError(null);
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <PersonIcon />
          <Typography variant="h6">
            {jobOrderId ? 'Create Job-Linked Application' : 'Create Standalone Application'}
          </Typography>
        </Box>
      </DialogTitle>
      
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Grid container spacing={3}>
          {/* Candidate Information */}
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Candidate Information
                </Typography>
                
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="First Name *"
                      value={formData.candidate.firstName}
                      onChange={(e) => handleInputChange('candidate.firstName', e.target.value)}
                      required
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="Last Name *"
                      value={formData.candidate.lastName}
                      onChange={(e) => handleInputChange('candidate.lastName', e.target.value)}
                      required
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="Email"
                      type="email"
                      value={formData.candidate.email}
                      onChange={(e) => handleInputChange('candidate.email', e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="Phone"
                      value={formData.candidate.phone}
                      onChange={(e) => handleInputChange('candidate.phone', e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <TextField
                      fullWidth
                      label="City"
                      value={formData.candidate.city}
                      onChange={(e) => handleInputChange('candidate.city', e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <TextField
                      fullWidth
                      label="State"
                      value={formData.candidate.state}
                      onChange={(e) => handleInputChange('candidate.state', e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <TextField
                      fullWidth
                      label="Country"
                      value={formData.candidate.country}
                      onChange={(e) => handleInputChange('candidate.country', e.target.value)}
                    />
                  </Grid>
                </Grid>
              </CardContent>
            </Card>
          </Grid>

          {/* Application Details */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Application Details
                </Typography>
                
                <Stack spacing={2}>
                  <FormControl fullWidth>
                    <InputLabel>Status</InputLabel>
                    <Select
                      value={formData.status}
                      label="Status"
                      onChange={(e) => handleInputChange('status', e.target.value)}
                    >
                      <MenuItem value="applied">Applied</MenuItem>
                      <MenuItem value="screening">Screening</MenuItem>
                      <MenuItem value="interview">Interview</MenuItem>
                      <MenuItem value="offer">Offer</MenuItem>
                      <MenuItem value="hired">Hired</MenuItem>
                      <MenuItem value="rejected">Rejected</MenuItem>
                      <MenuItem value="withdrawn">Withdrawn</MenuItem>
                    </Select>
                  </FormControl>

                  <FormControl fullWidth>
                    <InputLabel>Source</InputLabel>
                    <Select
                      value={formData.source}
                      label="Source"
                      onChange={(e) => handleInputChange('source', e.target.value)}
                    >
                      <MenuItem value="job_board">Job Board</MenuItem>
                      <MenuItem value="manual">Manual</MenuItem>
                      <MenuItem value="referral">Referral</MenuItem>
                      <MenuItem value="import">Import</MenuItem>
                      <MenuItem value="career_page">Career Page</MenuItem>
                    </Select>
                  </FormControl>

                  <Box>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      Rating
                    </Typography>
                    <Rating
                      value={formData.rating || 0}
                      onChange={(_, value) => handleInputChange('rating', value)}
                    />
                  </Box>
                </Stack>
              </CardContent>
            </Card>
          </Grid>

          {/* Compliance Requirements */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Compliance Requirements
                </Typography>
                
                <Stack spacing={2}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={formData.requires.backgroundCheck}
                        onChange={(e) => handleInputChange('requires.backgroundCheck', e.target.checked)}
                      />
                    }
                    label="Background Check Required"
                  />
                  
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={formData.requires.drugScreen}
                        onChange={(e) => handleInputChange('requires.drugScreen', e.target.checked)}
                      />
                    }
                    label="Drug Screen Required"
                  />
                  
                  <TextField
                    fullWidth
                    label="Required Licenses"
                    placeholder="Enter licenses separated by commas"
                    value={formData.requires.licenses?.join(', ') || ''}
                    onChange={(e) => handleInputChange('requires.licenses', e.target.value.split(',').map(license => license.trim()).filter(license => license))}
                  />
                </Stack>
              </CardContent>
            </Card>
          </Grid>

          {/* Notes & Tags */}
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Notes & Tags
                </Typography>
                
                <Stack spacing={2}>
                  <TextField
                    multiline
                    rows={4}
                    label="Notes"
                    value={formData.notes}
                    onChange={(e) => handleInputChange('notes', e.target.value)}
                    placeholder="Add any notes about this application..."
                    fullWidth
                  />
                  
                  <Box>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      Tags
                    </Typography>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <TextField
                        size="small"
                        placeholder="Add a tag..."
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleAddTag()}
                      />
                      <Button size="small" onClick={handleAddTag}>
                        Add
                      </Button>
                    </Stack>
                    <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                      {formData.tags?.map((tag, index) => (
                        <Chip
                          key={index}
                          label={tag}
                          onDelete={() => handleRemoveTag(tag)}
                          size="small"
                        />
                      ))}
                    </Box>
                  </Box>
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </DialogContent>
      
      <DialogActions>
        <Button onClick={handleClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={loading || !formData.candidate.firstName || !formData.candidate.lastName}
          startIcon={<SaveIcon />}
        >
          {loading ? 'Creating...' : 'Create Application'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default CreateApplication;

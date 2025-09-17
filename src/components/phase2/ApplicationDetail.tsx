import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  Grid,
  Chip,
  Avatar,
  Divider,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Rating,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Stack,
  Paper,
  List,
  ListItem,
  ListItemText,
  ListItemIcon
} from '@mui/material';
import {
  Edit as EditIcon,
  Save as SaveIcon,
  Cancel as CancelIcon,
  Person as PersonIcon,
  Email as EmailIcon,
  Phone as PhoneIcon,
  LocationOn as LocationIcon,
  Work as WorkIcon,
  Star as StarIcon,
  Note as NoteIcon,
  Timeline as TimelineIcon,
  Source as SourceIcon
} from '@mui/icons-material';
import { format } from 'date-fns';
import { Application, ApplicationStage, ApplicationSource, ApplicationRating } from '../../types/phase2';
import { getApplicationService } from '../../services/phase2/applicationService';
import { safeToDate } from '../../utils/dateUtils';

interface ApplicationDetailProps {
  application: Application;
  tenantId: string;
  onSave?: (updatedApplication: Application) => void;
  onClose?: () => void;
}

const ApplicationDetail: React.FC<ApplicationDetailProps> = ({
  application,
  tenantId,
  onSave,
  onClose
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedApplication, setEditedApplication] = useState<Application>(application);
  const [loading, setLoading] = useState(false);

  const applicationService = getApplicationService();

  const handleEdit = () => {
    setIsEditing(true);
  };

  const handleCancel = () => {
    setEditedApplication(application);
    setIsEditing(false);
  };

  const handleSave = async () => {
    try {
      setLoading(true);
      
      await applicationService.updateApplication(
        tenantId,
        application.id,
        {
          candidate: editedApplication.candidate,
          status: editedApplication.status,
          rating: editedApplication.rating,
          tags: editedApplication.tags,
          notes: editedApplication.notes,
          requires: editedApplication.requires,
          source: editedApplication.source
        },
        'current-user', // TODO: Get actual user ID
        application.jobOrderId || undefined
      );

      setIsEditing(false);
      if (onSave) {
        onSave(editedApplication);
      }
    } catch (error) {
      console.error('Error saving application:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStageChange = async (newStage: ApplicationStage) => {
    try {
      setLoading(true);
      
      await applicationService.updateApplicationStage(
        tenantId,
        application.id,
        newStage,
        'current-user', // TODO: Get actual user ID
        application.jobOrderId || undefined
      );

      setEditedApplication(prev => ({
        ...prev,
        status: newStage,
        stageChangedAt: new Date()
      }));

      if (onSave) {
        onSave({ ...editedApplication, status: newStage, stageChangedAt: new Date() });
      }
    } catch (error) {
      console.error('Error updating stage:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: ApplicationStage): 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' => {
    switch (status) {
      case 'applied': return 'info';
      case 'screening': return 'primary';
      case 'interview': return 'warning';
      case 'offer': return 'secondary';
      case 'hired': return 'success';
      case 'rejected': return 'error';
      case 'withdrawn': return 'default';
      default: return 'default';
    }
  };

  const getSourceIcon = (source?: string) => {
    switch (source) {
      case 'job_board': return '📋';
      case 'manual': return '✋';
      case 'referral': return '🤝';
      case 'import': return '📥';
      case 'career_page': return '🌐';
      default: return '❓';
    }
  };

  const stageOptions: { value: ApplicationStage; label: string; color: string }[] = [
    { value: 'applied', label: 'Applied', color: 'info' },
    { value: 'screening', label: 'Screening', color: 'primary' },
    { value: 'interview', label: 'Interview', color: 'warning' },
    { value: 'offer', label: 'Offer', color: 'secondary' },
    { value: 'hired', label: 'Hired', color: 'success' },
    { value: 'rejected', label: 'Rejected', color: 'error' },
    { value: 'withdrawn', label: 'Withdrawn', color: 'default' }
  ];

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto', p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">
          Application Details
        </Typography>
        <Box>
          {isEditing ? (
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                startIcon={<SaveIcon />}
                onClick={handleSave}
                disabled={loading}
              >
                Save
              </Button>
              <Button
                variant="outlined"
                startIcon={<CancelIcon />}
                onClick={handleCancel}
              >
                Cancel
              </Button>
            </Stack>
          ) : (
            <Button
              variant="contained"
              startIcon={<EditIcon />}
              onClick={handleEdit}
            >
              Edit
            </Button>
          )}
        </Box>
      </Box>

      <Grid container spacing={3}>
        {/* Candidate Information */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Candidate Information
              </Typography>
              
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
                <Avatar sx={{ width: 64, height: 64, mr: 2, bgcolor: 'primary.main' }}>
                  {editedApplication.candidate.firstName[0]}{editedApplication.candidate.lastName[0]}
                </Avatar>
                <Box>
                  {isEditing ? (
                    <Stack spacing={2}>
                      <TextField
                        size="small"
                        label="First Name"
                        value={editedApplication.candidate.firstName}
                        onChange={(e) => setEditedApplication(prev => ({
                          ...prev,
                          candidate: { ...prev.candidate, firstName: e.target.value }
                        }))}
                      />
                      <TextField
                        size="small"
                        label="Last Name"
                        value={editedApplication.candidate.lastName}
                        onChange={(e) => setEditedApplication(prev => ({
                          ...prev,
                          candidate: { ...prev.candidate, lastName: e.target.value }
                        }))}
                      />
                    </Stack>
                  ) : (
                    <Typography variant="h6">
                      {editedApplication.candidate.firstName} {editedApplication.candidate.lastName}
                    </Typography>
                  )}
                </Box>
              </Box>

              <Stack spacing={2}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <EmailIcon color="action" />
                  {isEditing ? (
                    <TextField
                      size="small"
                      label="Email"
                      value={editedApplication.candidate.email || ''}
                      onChange={(e) => setEditedApplication(prev => ({
                        ...prev,
                        candidate: { ...prev.candidate, email: e.target.value }
                      }))}
                      fullWidth
                    />
                  ) : (
                    <Typography variant="body2">
                      {editedApplication.candidate.email || 'No email provided'}
                    </Typography>
                  )}
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <PhoneIcon color="action" />
                  {isEditing ? (
                    <TextField
                      size="small"
                      label="Phone"
                      value={editedApplication.candidate.phone || ''}
                      onChange={(e) => setEditedApplication(prev => ({
                        ...prev,
                        candidate: { ...prev.candidate, phone: e.target.value }
                      }))}
                      fullWidth
                    />
                  ) : (
                    <Typography variant="body2">
                      {editedApplication.candidate.phone || 'No phone provided'}
                    </Typography>
                  )}
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <LocationIcon color="action" />
                  {isEditing ? (
                    <Stack direction="row" spacing={1}>
                      <TextField
                        size="small"
                        label="City"
                        value={editedApplication.candidate.city || ''}
                        onChange={(e) => setEditedApplication(prev => ({
                          ...prev,
                          candidate: { ...prev.candidate, city: e.target.value }
                        }))}
                      />
                      <TextField
                        size="small"
                        label="State"
                        value={editedApplication.candidate.state || ''}
                        onChange={(e) => setEditedApplication(prev => ({
                          ...prev,
                          candidate: { ...prev.candidate, state: e.target.value }
                        }))}
                      />
                    </Stack>
                  ) : (
                    <Typography variant="body2">
                      {editedApplication.candidate.city && editedApplication.candidate.state
                        ? `${editedApplication.candidate.city}, ${editedApplication.candidate.state}`
                        : 'No location provided'
                      }
                    </Typography>
                  )}
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* Application Status & Details */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Application Status
              </Typography>
              
              <Stack spacing={2}>
                <Box>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Current Stage
                  </Typography>
                  {isEditing ? (
                    <FormControl fullWidth size="small">
                      <InputLabel>Stage</InputLabel>
                      <Select
                        value={editedApplication.status}
                        label="Stage"
                        onChange={(e) => setEditedApplication(prev => ({
                          ...prev,
                          status: e.target.value as ApplicationStage
                        }))}
                      >
                        {stageOptions.map(option => (
                          <MenuItem key={option.value} value={option.value}>
                            {option.label}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  ) : (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Chip
                        label={editedApplication.status}
                        color={getStatusColor(editedApplication.status)}
                        size="medium"
                      />
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => {
                          // TODO: Show stage change dialog
                          console.log('Change stage');
                        }}
                      >
                        Change Stage
                      </Button>
                    </Box>
                  )}
                </Box>

                <Box>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Rating
                  </Typography>
                  {isEditing ? (
                    <Rating
                      value={editedApplication.rating || 0}
                      onChange={(_, value) => setEditedApplication(prev => ({
                        ...prev,
                        rating: value as ApplicationRating
                      }))}
                    />
                  ) : (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Rating value={editedApplication.rating || 0} readOnly />
                      <Typography variant="body2" color="text.secondary">
                        ({editedApplication.rating || 0}/5)
                      </Typography>
                    </Box>
                  )}
                </Box>

                <Box>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Source
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <span>{getSourceIcon(editedApplication.source)}</span>
                    <Typography variant="body2" sx={{ textTransform: 'capitalize' }}>
                      {editedApplication.source?.replace('_', ' ') || 'Unknown'}
                    </Typography>
                  </Box>
                </Box>

                <Box>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Applied Date
                  </Typography>
                  <Typography variant="body2">
                    {format(safeToDate(editedApplication.createdAt), 'MMM dd, yyyy HH:mm')}
                  </Typography>
                </Box>

                <Box>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Last Updated
                  </Typography>
                  <Typography variant="body2">
                    {format(safeToDate(editedApplication.stageChangedAt), 'MMM dd, yyyy HH:mm')}
                  </Typography>
                </Box>
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
                <Box>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Notes
                  </Typography>
                  {isEditing ? (
                    <TextField
                      multiline
                      rows={4}
                      value={editedApplication.notes || ''}
                      onChange={(e) => setEditedApplication(prev => ({
                        ...prev,
                        notes: e.target.value
                      }))}
                      placeholder="Add notes about this application..."
                      fullWidth
                    />
                  ) : (
                    <Paper sx={{ p: 2, bgcolor: 'grey.50' }}>
                      <Typography variant="body2">
                        {editedApplication.notes || 'No notes added yet'}
                      </Typography>
                    </Paper>
                  )}
                </Box>

                <Box>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Tags
                  </Typography>
                  {isEditing ? (
                    <TextField
                      size="small"
                      value={editedApplication.tags?.join(', ') || ''}
                      onChange={(e) => setEditedApplication(prev => ({
                        ...prev,
                        tags: e.target.value.split(',').map(tag => tag.trim()).filter(tag => tag)
                      }))}
                      placeholder="Enter tags separated by commas..."
                      fullWidth
                    />
                  ) : (
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                      {editedApplication.tags && editedApplication.tags.length > 0 ? (
                        editedApplication.tags.map((tag, index) => (
                          <Chip key={index} label={tag} size="small" />
                        ))
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          No tags added
                        </Typography>
                      )}
                    </Box>
                  )}
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* Compliance Requirements */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Compliance Requirements
              </Typography>
              
              <List>
                <ListItem>
                  <ListItemIcon>
                    <WorkIcon />
                  </ListItemIcon>
                  <ListItemText
                    primary="Background Check"
                    secondary={editedApplication.requires.backgroundCheck ? 'Required' : 'Not Required'}
                  />
                </ListItem>
                <ListItem>
                  <ListItemIcon>
                    <WorkIcon />
                  </ListItemIcon>
                  <ListItemText
                    primary="Drug Screen"
                    secondary={editedApplication.requires.drugScreen ? 'Required' : 'Not Required'}
                  />
                </ListItem>
                <ListItem>
                  <ListItemIcon>
                    <WorkIcon />
                  </ListItemIcon>
                  <ListItemText
                    primary="Licenses"
                    secondary={editedApplication.requires.licenses?.join(', ') || 'None Required'}
                  />
                </ListItem>
              </List>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default ApplicationDetail;

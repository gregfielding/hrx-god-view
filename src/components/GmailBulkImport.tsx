import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Typography,
  TextField,
  Chip,
  CircularProgress,
  Alert,
  List,
  ListItem,
  ListItemText,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
} from '@mui/material';
import {
  CloudUpload as UploadIcon,
  Refresh as RefreshIcon,
  CheckCircle as CheckIcon,
  Error as ErrorIcon,
  Schedule as ScheduleIcon,
} from '@mui/icons-material';
import { getFunctions, httpsCallable } from 'firebase/functions';

interface GmailImportProgress {
  requestId: string;
  tenantId: string;
  totalUsers: number;
  completedUsers: number;
  failedUsers: string[];
  inProgressUsers: string[];
  startTime: Date;
  lastUpdate: Date;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  results: {
    [userId: string]: {
      emailsImported: number;
      contactsFound: number;
      errors: string[];
      completedAt: Date;
    };
  };
}

interface GmailBulkImportProps {
  tenantId: string;
  users: Array<{ id: string; email: string; displayName: string }>;
}

const GmailBulkImport: React.FC<GmailBulkImportProps> = ({ tenantId, users }) => {
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<GmailImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [daysBack, setDaysBack] = useState(90);
  const [showProgressDialog, setShowProgressDialog] = useState(false);
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);

  const functions = getFunctions();

  // Start polling for progress updates
  const startPolling = (requestId: string) => {
    const interval = setInterval(async () => {
      try {
        const getProgress = httpsCallable(functions, 'getGmailImportProgress');
        const result = await getProgress({ requestId, tenantId });
        const progressData = result.data as GmailImportProgress;
        
        setProgress(progressData);
        
        // Stop polling if completed or failed
        if (progressData.status === 'completed' || progressData.status === 'failed') {
          clearInterval(interval);
          setPollingInterval(null);
          setImporting(false);
          
          if (progressData.status === 'completed') {
            setSuccess(`Gmail import completed! ${progressData.completedUsers} users processed.`);
          } else {
            setError(`Gmail import failed. ${progressData.failedUsers.length} users failed.`);
          }
        }
      } catch (error) {
        console.error('Error polling progress:', error);
      }
    }, 5000); // Poll every 5 seconds
    
    setPollingInterval(interval);
  };

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
    };
  }, [pollingInterval]);

  const handleStartImport = async () => {
    if (selectedUsers.length === 0) {
      setError('Please select at least one user to import emails for.');
      return;
    }

    setImporting(true);
    setError(null);
    setSuccess(null);

    try {
      const queueImport = httpsCallable(functions, 'queueGmailBulkImport');
      const result = await queueImport({
        userIds: selectedUsers,
        tenantId,
        daysBack,
      });

      const data = result.data as any;
      
      if (data.success) {
        setSuccess(`Gmail import queued successfully! Request ID: ${data.requestId}`);
        setShowProgressDialog(true);
        
        // Start polling for progress
        startPolling(data.requestId);
      } else {
        throw new Error(data.message || 'Failed to queue import');
      }
    } catch (error: any) {
      console.error('Error starting Gmail import:', error);
      setError(error.message || 'Failed to start Gmail import');
      setImporting(false);
    }
  };

  const handleRefreshProgress = async () => {
    if (!progress?.requestId) return;

    try {
      const getProgress = httpsCallable(functions, 'getGmailImportProgress');
      const result = await getProgress({ requestId: progress.requestId, tenantId });
      const progressData = result.data as GmailImportProgress;
      setProgress(progressData);
    } catch (error) {
      console.error('Error refreshing progress:', error);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'success';
      case 'failed':
        return 'error';
      case 'in_progress':
        return 'warning';
      default:
        return 'default';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckIcon />;
      case 'failed':
        return <ErrorIcon />;
      case 'in_progress':
        return <ScheduleIcon />;
      default:
        return <ScheduleIcon />;
    }
  };

  return (
    <Box>
      <Card>
        <CardHeader
          title="Gmail Bulk Import"
          subheader="Import historical Gmail emails and create activity logs for matching contacts"
          titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
        />
        <CardContent>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth size="small">
                <InputLabel>Select Users</InputLabel>
                <Select
                  multiple
                  value={selectedUsers}
                  onChange={(e) => setSelectedUsers(e.target.value as string[])}
                  label="Select Users"
                  renderValue={(selected) => (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {selected.map((userId) => {
                        const user = users.find(u => u.id === userId);
                        return (
                          <Chip 
                            key={userId} 
                            label={user?.displayName || user?.email || userId} 
                            size="small" 
                          />
                        );
                      })}
                    </Box>
                  )}
                >
                  {users.map((user) => (
                    <MenuItem key={user.id} value={user.id}>
                      <Box>
                        <Typography variant="body2">{user.displayName}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {user.email}
                        </Typography>
                      </Box>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                size="small"
                label="Days Back"
                type="number"
                value={daysBack}
                onChange={(e) => setDaysBack(parseInt(e.target.value) || 90)}
                helperText="Number of days back to import emails from"
                inputProps={{ min: 1, max: 365 }}
              />
            </Grid>
          </Grid>

          <Box sx={{ mt: 3, display: 'flex', gap: 2, alignItems: 'center' }}>
            <Button
              variant="contained"
              startIcon={importing ? <CircularProgress size={20} /> : <UploadIcon />}
              onClick={handleStartImport}
              disabled={importing || selectedUsers.length === 0}
              size="large"
            >
              {importing ? 'Queuing Import...' : 'Import Gmail Emails'}
            </Button>

            {progress && (
              <Button
                variant="outlined"
                startIcon={<RefreshIcon />}
                onClick={handleRefreshProgress}
                disabled={importing}
              >
                Refresh Progress
              </Button>
            )}
          </Box>

          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}

          {success && (
            <Alert severity="success" sx={{ mt: 2 }}>
              {success}
            </Alert>
          )}

          {progress && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                Import Progress
              </Typography>
              
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                {getStatusIcon(progress.status)}
                <Chip 
                  label={progress.status.replace('_', ' ').toUpperCase()} 
                  color={getStatusColor(progress.status) as any}
                  size="small"
                />
                <Typography variant="body2" color="text.secondary">
                  {progress.completedUsers} of {progress.totalUsers} users completed
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                <Typography variant="body2">
                  <strong>Started:</strong> {new Date(progress.startTime).toLocaleString()}
                </Typography>
                <Typography variant="body2">
                  <strong>Last Update:</strong> {new Date(progress.lastUpdate).toLocaleString()}
                </Typography>
              </Box>

              {Object.keys(progress.results).length > 0 && (
                <List dense>
                  {Object.entries(progress.results).map(([userId, result]) => {
                    const user = users.find(u => u.id === userId);
                    return (
                      <ListItem key={userId}>
                        <ListItemText
                          primary={user?.displayName || user?.email || userId}
                          secondary={
                            <Box>
                              <Typography variant="body2">
                                {result.emailsImported} emails imported, {result.contactsFound} contacts found
                              </Typography>
                              {result.errors.length > 0 && (
                                <Typography variant="caption" color="error">
                                  {result.errors.length} errors
                                </Typography>
                              )}
                            </Box>
                          }
                        />
                        {result.completedAt && (
                          <Chip 
                            label="Completed" 
                            color="success" 
                            size="small" 
                            icon={<CheckIcon />}
                          />
                        )}
                      </ListItem>
                    );
                  })}
                </List>
              )}
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Progress Dialog */}
      <Dialog 
        open={showProgressDialog} 
        onClose={() => setShowProgressDialog(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Gmail Import Progress
        </DialogTitle>
        <DialogContent>
          {progress && (
            <Box>
              <Typography variant="h6" gutterBottom>
                Status: {progress.status.replace('_', ' ').toUpperCase()}
              </Typography>
              
              <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                <Chip 
                  label={`${progress.completedUsers}/${progress.totalUsers} Completed`}
                  color="primary"
                />
                {progress.failedUsers.length > 0 && (
                  <Chip 
                    label={`${progress.failedUsers.length} Failed`}
                    color="error"
                  />
                )}
                {progress.inProgressUsers.length > 0 && (
                  <Chip 
                    label={`${progress.inProgressUsers.length} In Progress`}
                    color="warning"
                  />
                )}
              </Box>

              <Typography variant="body2" color="text.secondary" gutterBottom>
                This dialog will automatically close when the import is complete.
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowProgressDialog(false)}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default GmailBulkImport;

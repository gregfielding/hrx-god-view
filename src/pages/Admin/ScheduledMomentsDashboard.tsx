import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Chip,
  IconButton,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Alert,
  Snackbar,
  CircularProgress,
  Switch,
  FormControlLabel,
} from '@mui/material';
import {
  Visibility as VisibilityIcon,
  Refresh as RefreshIcon,
  Schedule as ScheduleIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Pending as PendingIcon,
  PlayArrow as PlayArrowIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import {
  collection,
  getDocs,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { db } from '../../firebase';

interface ScheduledMoment {
  id: string;
  workerId: string;
  momentId: string;
  scheduledFor: Date;
  status: 'pending' | 'completed' | 'missed' | 'retry';
  retryCount: number;
  triggeredBy: 'tenure' | 'recurrence' | 'trait_decay' | 'manual';
  lastAttempt?: Date;
  nextRetry?: Date;
  responseData?: {
    traitsUpdated: Record<string, number>;
    notes: string;
    sentiment: 'positive' | 'neutral' | 'negative';
  };
  createdAt: Date;
  updatedAt: Date;
}

interface Worker {
  id: string;
  name: string;
  email: string;
  tenureDays: number;
  traits: Record<string, number>;
  lastActive: Date;
}

interface Moment {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'active' | 'paused';
  timing?: {
    type: 'tenure_based' | 'recurring' | 'trait_decay' | 'manual';
    condition?: {
      field: string;
      operator: '>=' | '<=' | '==' | '!=';
      value: number;
    };
    recurrence?: 'monthly' | 'quarterly' | 'custom';
    customDays?: number;
    followUpDays?: number;
    maxRetries?: number;
    retryDelayDays?: number;
  };
}

const ScheduledMomentsDashboard: React.FC = () => {
  const [scheduledMoments, setScheduledMoments] = useState<ScheduledMoment[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [moments, setMoments] = useState<Moment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedTrigger, setSelectedTrigger] = useState<string>('all');
  const [schedulerEnabled, setSchedulerEnabled] = useState(true);
  const [previewDialog, setPreviewDialog] = useState(false);
  const [previewMoment, setPreviewMoment] = useState<ScheduledMoment | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch scheduled moments
      const scheduledRef = collection(db, 'scheduledMoments');
      const scheduledSnap = await getDocs(scheduledRef);
      const fetchedScheduled = scheduledSnap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        scheduledFor: doc.data().scheduledFor?.toDate(),
        lastAttempt: doc.data().lastAttempt?.toDate(),
        nextRetry: doc.data().nextRetry?.toDate(),
        createdAt: doc.data().createdAt?.toDate(),
        updatedAt: doc.data().updatedAt?.toDate(),
      })) as ScheduledMoment[];
      setScheduledMoments(fetchedScheduled);

      // Fetch workers (mock data for now)
      const mockWorkers: Worker[] = [
        {
          id: 'worker1',
          name: 'John Smith',
          email: 'john@company.com',
          tenureDays: 45,
          traits: { engagement: 7.2, satisfaction: 6.8, retention_risk: 4.1 },
          lastActive: new Date(),
        },
        {
          id: 'worker2',
          name: 'Sarah Johnson',
          email: 'sarah@company.com',
          tenureDays: 12,
          traits: { engagement: 8.1, satisfaction: 7.9, retention_risk: 2.3 },
          lastActive: new Date(),
        },
        {
          id: 'worker3',
          name: 'Mike Davis',
          email: 'mike@company.com',
          tenureDays: 180,
          traits: { engagement: 5.2, satisfaction: 4.8, retention_risk: 7.5 },
          lastActive: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
        },
      ];
      setWorkers(mockWorkers);

      // Fetch moments
      const momentsRef = collection(db, 'aiMoments');
      const momentsSnap = await getDocs(momentsRef);
      const fetchedMoments = momentsSnap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as Moment[];
      setMoments(fetchedMoments);
    } catch (err: any) {
      setError('Failed to fetch data');
    }
    setLoading(false);
  };

  const runScheduler = async () => {
    try {
      setLoading(true);

      // Specify region explicitly for callable function
      const functions = getFunctions(undefined, 'us-central1');
      const manualSchedulerRun = httpsCallable(functions, 'manualSchedulerRun');

      const result = await manualSchedulerRun();
      console.log('Scheduler result:', result);

      setSuccess('Scheduler run completed successfully');
      await fetchData();
    } catch (err: any) {
      console.error('Scheduler error:', err);
      setError('Failed to run scheduler: ' + (err.message || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  const getWorkerName = (workerId: string) => {
    return workers.find((w) => w.id === workerId)?.name || 'Unknown Worker';
  };

  const getMomentTitle = (momentId: string) => {
    return moments.find((m) => m.id === momentId)?.title || 'Unknown Moment';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'warning';
      case 'completed':
        return 'success';
      case 'missed':
        return 'error';
      case 'retry':
        return 'info';
      default:
        return 'default';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <PendingIcon />;
      case 'completed':
        return <CheckCircleIcon />;
      case 'missed':
        return <ErrorIcon />;
      case 'retry':
        return <ScheduleIcon />;
      default:
        return <PendingIcon />;
    }
  };

  const filteredMoments = scheduledMoments.filter((moment) => {
    if (selectedStatus !== 'all' && moment.status !== selectedStatus) return false;
    if (selectedTrigger !== 'all' && moment.triggeredBy !== selectedTrigger) return false;
    return true;
  });

  const pendingCount = scheduledMoments.filter((m) => m.status === 'pending').length;
  const completedCount = scheduledMoments.filter((m) => m.status === 'completed').length;
  const missedCount = scheduledMoments.filter((m) => m.status === 'missed').length;

  return (
    <Box sx={{ p: 0 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Typography variant="h3" gutterBottom>
            AI Scheduled Moments
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Manage AI-driven worker check-ins and scheduling
          </Typography>
        </Box>
        <Button variant="outlined" onClick={() => navigate('/admin/ai')} sx={{ height: 40 }}>
          Back to Launchpad
        </Button>
      </Box>

      {loading ? (
        <Box display="flex" justifyContent="center" p={4}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          {/* Scheduler Controls */}
          <Paper sx={{ p: 3, mb: 3 }}>
            <Typography variant="h6" gutterBottom>
              Scheduler Controls
            </Typography>
            <Grid container spacing={3} alignItems="center">
              <Grid item xs={12} md={6}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={schedulerEnabled}
                      onChange={(e) => setSchedulerEnabled(e.target.checked)}
                    />
                  }
                  label="Enable AI Scheduler"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <Button
                  variant="contained"
                  startIcon={<PlayArrowIcon />}
                  onClick={runScheduler}
                  disabled={!schedulerEnabled || loading}
                  fullWidth
                >
                  Run Scheduler Now
                </Button>
              </Grid>
            </Grid>
          </Paper>

          {/* Statistics */}
          <Grid container spacing={3} sx={{ mb: 3 }}>
            <Grid item xs={12} md={3}>
              <Paper sx={{ p: 2, textAlign: 'center' }}>
                <Typography variant="h4" color="warning.main">
                  {pendingCount}
                </Typography>
                <Typography variant="body2">Pending</Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} md={3}>
              <Paper sx={{ p: 2, textAlign: 'center' }}>
                <Typography variant="h4" color="success.main">
                  {completedCount}
                </Typography>
                <Typography variant="body2">Completed</Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} md={3}>
              <Paper sx={{ p: 2, textAlign: 'center' }}>
                <Typography variant="h4" color="error.main">
                  {missedCount}
                </Typography>
                <Typography variant="body2">Missed</Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} md={3}>
              <Paper sx={{ p: 2, textAlign: 'center' }}>
                <Typography variant="h4" color="primary.main">
                  {scheduledMoments.length}
                </Typography>
                <Typography variant="body2">Total</Typography>
              </Paper>
            </Grid>
          </Grid>

          {/* Filters */}
          <Paper sx={{ p: 2, mb: 3 }}>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} md={4}>
                <FormControl fullWidth size="small">
                  <InputLabel>Status</InputLabel>
                  <Select
                    value={selectedStatus}
                    label="Status"
                    onChange={(e) => setSelectedStatus(e.target.value)}
                  >
                    <MenuItem value="all">All Statuses</MenuItem>
                    <MenuItem value="pending">Pending</MenuItem>
                    <MenuItem value="completed">Completed</MenuItem>
                    <MenuItem value="missed">Missed</MenuItem>
                    <MenuItem value="retry">Retry</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={4}>
                <FormControl fullWidth size="small">
                  <InputLabel>Trigger</InputLabel>
                  <Select
                    value={selectedTrigger}
                    label="Trigger"
                    onChange={(e) => setSelectedTrigger(e.target.value)}
                  >
                    <MenuItem value="all">All Triggers</MenuItem>
                    <MenuItem value="tenure">Tenure</MenuItem>
                    <MenuItem value="recurrence">Recurrence</MenuItem>
                    <MenuItem value="trait_decay">Trait Decay</MenuItem>
                    <MenuItem value="manual">Manual</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={4}>
                <Button
                  variant="outlined"
                  startIcon={<RefreshIcon />}
                  onClick={fetchData}
                  fullWidth
                >
                  Refresh
                </Button>
              </Grid>
            </Grid>
          </Paper>

          {/* Scheduled Moments Table */}
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Worker</TableCell>
                  <TableCell>Moment</TableCell>
                  <TableCell>Scheduled For</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Trigger</TableCell>
                  <TableCell>Retries</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredMoments.map((moment) => (
                  <TableRow key={moment.id}>
                    <TableCell>{getWorkerName(moment.workerId)}</TableCell>
                    <TableCell>{getMomentTitle(moment.momentId)}</TableCell>
                    <TableCell>
                      {moment.scheduledFor.toLocaleDateString()}{' '}
                      {moment.scheduledFor.toLocaleTimeString()}
                    </TableCell>
                    <TableCell>
                      <Chip
                        icon={getStatusIcon(moment.status)}
                        label={moment.status}
                        color={getStatusColor(moment.status) as any}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>
                      <Chip label={moment.triggeredBy} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell>{moment.retryCount}</TableCell>
                    <TableCell>
                      <IconButton
                        size="small"
                        onClick={() => {
                          setPreviewMoment(moment);
                          setPreviewDialog(true);
                        }}
                      >
                        <VisibilityIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}

      {/* Preview Dialog */}
      <Dialog open={previewDialog} onClose={() => setPreviewDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>Moment Details</DialogTitle>
        <DialogContent>
          {previewMoment && (
            <Box>
              <Typography variant="h6" gutterBottom>
                {getMomentTitle(previewMoment.momentId)} - {getWorkerName(previewMoment.workerId)}
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Typography variant="subtitle2">Status</Typography>
                  <Chip
                    icon={getStatusIcon(previewMoment.status)}
                    label={previewMoment.status}
                    color={getStatusColor(previewMoment.status) as any}
                  />
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="subtitle2">Trigger</Typography>
                  <Chip label={previewMoment.triggeredBy} variant="outlined" />
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="subtitle2">Scheduled For</Typography>
                  <Typography variant="body2">
                    {previewMoment.scheduledFor.toLocaleString()}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="subtitle2">Retry Count</Typography>
                  <Typography variant="body2">{previewMoment.retryCount}</Typography>
                </Grid>
                {previewMoment.lastAttempt && (
                  <Grid item xs={6}>
                    <Typography variant="subtitle2">Last Attempt</Typography>
                    <Typography variant="body2">
                      {previewMoment.lastAttempt.toLocaleString()}
                    </Typography>
                  </Grid>
                )}
                {previewMoment.nextRetry && (
                  <Grid item xs={6}>
                    <Typography variant="subtitle2">Next Retry</Typography>
                    <Typography variant="body2">
                      {previewMoment.nextRetry.toLocaleString()}
                    </Typography>
                  </Grid>
                )}
                {previewMoment.responseData && (
                  <Grid item xs={12}>
                    <Typography variant="subtitle2">Response Data</Typography>
                    <Typography variant="body2">
                      Sentiment: {previewMoment.responseData.sentiment}
                    </Typography>
                    <Typography variant="body2">
                      Notes: {previewMoment.responseData.notes}
                    </Typography>
                  </Grid>
                )}
              </Grid>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreviewDialog(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!success} autoHideDuration={3000} onClose={() => setSuccess('')}>
        <Alert severity="success" sx={{ width: '100%' }}>
          {success}
        </Alert>
      </Snackbar>
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default ScheduledMomentsDashboard;

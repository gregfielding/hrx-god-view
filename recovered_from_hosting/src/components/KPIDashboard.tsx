import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardHeader,
  Grid,
  LinearProgress,
  Chip,
  Button,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  ListItemSecondaryAction,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  Snackbar,
  CircularProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import {
  TrendingUp as TrendingUpIcon,
  CheckCircle as CheckCircleIcon,
  Warning as WarningIcon,
  Schedule as ScheduleIcon,
  Lightbulb as LightbulbIcon,
  Task as TaskIcon,
  Phone as PhoneIcon,
  Email as EmailIcon,
  MeetingRoom as MeetingIcon,
  Assessment as AssessmentIcon,
  PriorityHigh as HighPriorityIcon,
  FiberManualRecord as MediumPriorityIcon,
  RadioButtonUnchecked as LowPriorityIcon,
} from '@mui/icons-material';
import {
  collection,
  addDoc,
  updateDoc,
  doc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';

import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import {
  KPIDefinition,
  KPIAssignment,
  KPITracking,
  KPIActivity,
  KPITaskSuggestion,
  KPIDashboard as KPIDashboardType,
} from '../types/CRM';

interface KPIDashboardProps {
  tenantId: string;
  salespersonId: string;
}

const KPIDashboard: React.FC<KPIDashboardProps> = ({ tenantId, salespersonId }) => {
  const { user } = useAuth();
  const [kpiDashboard, setKpiDashboard] = useState<KPIDashboardType | null>(null);
  const [assignments, setAssignments] = useState<KPIAssignment[]>([]);
  const [tracking, setTracking] = useState<KPITracking[]>([]);
  const [activities, setActivities] = useState<KPIActivity[]>([]);
  const [taskSuggestions, setTaskSuggestions] = useState<KPITaskSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [showActivityDialog, setShowActivityDialog] = useState(false);
  const [showTaskDialog, setShowTaskDialog] = useState(false);
  const [selectedKPI, setSelectedKPI] = useState<KPIDefinition | null>(null);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  // Activity Form State
  const [activityForm, setActivityForm] = useState({
    kpiId: '',
    activityType: 'call' as 'call' | 'email' | 'meeting' | 'proposal' | 'follow_up' | 'research' | 'other',
    description: '',
    value: 1,
    duration: 0,
    outcome: 'positive' as 'positive' | 'neutral' | 'negative',
    notes: '',
    relatedTo: {
      type: 'contact' as 'contact' | 'company' | 'deal',
      id: '',
      name: '',
    },
  });

  // Task Form State
  const [taskForm, setTaskForm] = useState({
    title: '',
    description: '',
    type: 'call' as 'call' | 'email' | 'meeting' | 'research' | 'follow_up' | 'proposal',
    priority: 'medium' as 'low' | 'medium' | 'high',
    suggestedDate: '',
    estimatedValue: 1,
    reason: '',
    relatedTo: {
      type: 'contact' as 'contact' | 'company' | 'deal',
      id: '',
      name: '',
    },
  });

  // Load KPI data
  useEffect(() => {
    if (!tenantId || !salespersonId) return;

    const assignmentsRef = collection(db, 'tenants', tenantId, 'kpi_assignments');
    const trackingRef = collection(db, 'tenants', tenantId, 'kpi_tracking');
    const activitiesRef = collection(db, 'tenants', tenantId, 'kpi_activities');
    const suggestionsRef = collection(db, 'tenants', tenantId, 'kpi_task_suggestions');

    // Listen for assignments
    const assignmentsUnsubscribe = onSnapshot(
      query(assignmentsRef, where('salespersonId', '==', salespersonId), where('isActive', '==', true)),
      (snapshot) => {
        const assignmentsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as KPIAssignment));
        setAssignments(assignmentsData);
      }
    );

    // Listen for tracking
    const trackingUnsubscribe = onSnapshot(
      query(trackingRef, where('salespersonId', '==', salespersonId)),
      (snapshot) => {
        const trackingData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as KPITracking));
        setTracking(trackingData);
      }
    );

    // Listen for activities
    const activitiesUnsubscribe = onSnapshot(
      query(activitiesRef, where('salespersonId', '==', salespersonId)),
      (snapshot) => {
        const activitiesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as KPIActivity));
        setActivities(activitiesData);
      },
      (error) => {
        console.error('Error listening to KPI activities:', error);
        setActivities([]);
      }
    );

    // Listen for task suggestions
    const suggestionsUnsubscribe = onSnapshot(
      query(suggestionsRef, where('salespersonId', '==', salespersonId)),
      (snapshot) => {
        const suggestionsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as KPITaskSuggestion));
        setTaskSuggestions(suggestionsData);
      },
      (error) => {
        console.error('Error listening to KPI task suggestions:', error);
        setTaskSuggestions([]);
      }
    );

    setLoading(false);

    return () => {
      assignmentsUnsubscribe();
      trackingUnsubscribe();
      activitiesUnsubscribe();
      suggestionsUnsubscribe();
    };
  }, [tenantId, salespersonId]);

  // Calculate dashboard data
  useEffect(() => {
    if (assignments.length === 0) {
      setKpiDashboard(null);
      return;
    }

    const currentPeriod = new Date().toISOString().split('T')[0]; // Daily for now
    const kpis = assignments.map(assignment => {
      const trackingData = tracking.find(t => t.kpiAssignmentId === assignment.id && t.period === currentPeriod);
      const currentValue = trackingData?.currentValue || 0;
      const targetValue = assignment.target;
      const percentageComplete = targetValue > 0 ? (currentValue / targetValue) * 100 : 0;
             const status: 'on_track' | 'behind' | 'completed' = percentageComplete >= 100 ? 'completed' : 
                     percentageComplete >= 80 ? 'on_track' : 'behind';
      const remainingToTarget = Math.max(0, targetValue - currentValue);
      
      const suggestions = taskSuggestions.filter(s => s.kpiId === assignment.kpiId && !s.isCompleted);

      return {
        kpiId: assignment.kpiId,
        kpiName: assignment.kpiId, // Will be resolved with KPI definitions
        category: 'activity', // Will be resolved with KPI definitions
        currentValue,
        targetValue,
        percentageComplete,
        status,
        remainingToTarget,
        suggestedTasks: suggestions,
      };
    });

    const summary = {
      totalKPIs: kpis.length,
      onTrack: kpis.filter(k => k.status === 'on_track').length,
      behind: kpis.filter(k => k.status === 'behind').length,
             ahead: 0, // Not used in current logic
      completed: kpis.filter(k => k.status === 'completed').length,
      overallProgress: kpis.reduce((sum, k) => sum + k.percentageComplete, 0) / kpis.length,
    };

    setKpiDashboard({
      salespersonId,
      period: currentPeriod,
      kpis,
      summary,
    });
  }, [assignments, tracking, taskSuggestions]);

  const handleLogActivity = (kpi: KPIDefinition) => {
    setSelectedKPI(kpi);
    setActivityForm({
      kpiId: kpi.id,
      activityType: 'call',
      description: '',
      value: 1,
      duration: 0,
      outcome: 'positive',
      notes: '',
      relatedTo: {
        type: 'contact',
        id: '',
        name: '',
      },
    });
    setShowActivityDialog(true);
  };

  const handleSaveActivity = async () => {
    try {
      const activityData = {
        ...activityForm,
        salespersonId,
        activityDate: new Date().toISOString().split('T')[0],
        createdAt: serverTimestamp(),
      };

      await addDoc(collection(db, 'tenants', tenantId, 'kpi_activities'), activityData);

      // Update tracking
      const trackingData = tracking.find(t => t.kpiId === activityForm.kpiId);
      if (trackingData) {
        const newValue = trackingData.currentValue + activityForm.value;
        await updateDoc(doc(db, 'tenants', tenantId, 'kpi_tracking', trackingData.id), {
          currentValue: newValue,
          percentageComplete: (newValue / trackingData.targetValue) * 100,
          lastUpdated: serverTimestamp(),
        });
      }

      setShowActivityDialog(false);
      setSuccess('Activity logged successfully');
    } catch (err) {
      console.error('Error logging activity:', err);
      setError('Failed to log activity');
    }
  };

  const handleAcceptTask = async (taskId: string) => {
    try {
      await updateDoc(doc(db, 'tenants', tenantId, 'kpi_task_suggestions', taskId), {
        isAccepted: true,
        updatedAt: serverTimestamp(),
      });
      setSuccess('Task accepted');
    } catch (err) {
      console.error('Error accepting task:', err);
      setError('Failed to accept task');
    }
  };

  const handleCompleteTask = async (taskId: string) => {
    try {
      await updateDoc(doc(db, 'tenants', tenantId, 'kpi_task_suggestions', taskId), {
        isCompleted: true,
        updatedAt: serverTimestamp(),
      });
      setSuccess('Task completed');
    } catch (err) {
      console.error('Error completing task:', err);
      setError('Failed to complete task');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'success';
      case 'on_track': return 'success';
      case 'ahead': return 'info';
      case 'behind': return 'error';
      default: return 'primary';
    }
  };

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'call': return <PhoneIcon />;
      case 'email': return <EmailIcon />;
      case 'meeting': return <MeetingIcon />;
      case 'proposal': return <AssessmentIcon />;
      case 'follow_up': return <ScheduleIcon />;
      case 'research': return <LightbulbIcon />;
      default: return <TaskIcon />;
    }
  };

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case 'high': return <HighPriorityIcon />;
      case 'medium': return <MediumPriorityIcon />;
      case 'low': return <LowPriorityIcon />;
      default: return <MediumPriorityIcon />;
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (!kpiDashboard) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <Alert severity="info">
          No KPIs assigned. Contact your manager to get started.
        </Alert>
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        My KPI Dashboard
      </Typography>

      {/* Summary Cards */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <TrendingUpIcon color="primary" />
                <Typography variant="h6">{kpiDashboard.summary.totalKPIs}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Total KPIs
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CheckCircleIcon color="success" />
                <Typography variant="h6">{kpiDashboard.summary.onTrack + kpiDashboard.summary.completed}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                On Track
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <WarningIcon color="error" />
                <Typography variant="h6">{kpiDashboard.summary.behind}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Behind
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <AssessmentIcon color="primary" />
                <Typography variant="h6">{Math.round(kpiDashboard.summary.overallProgress)}%</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Overall Progress
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* KPI Progress */}
      <Card sx={{ mb: 3 }}>
        <CardHeader
          title="KPI Progress"
          subheader={`Current period: ${kpiDashboard.period}`}
        />
        <CardContent>
          <Grid container spacing={2}>
            {kpiDashboard.kpis.map((kpi) => (
              <Grid item xs={12} md={6} key={kpi.kpiId}>
                <Paper sx={{ p: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography variant="h6">{kpi.kpiName}</Typography>
                    <Chip 
                      label={kpi.status.replace('_', ' ')} 
                      size="small" 
                      color={getStatusColor(kpi.status)}
                    />
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="body2">
                      {kpi.currentValue} / {kpi.targetValue}
                    </Typography>
                    <Typography variant="body2">
                      {Math.round(kpi.percentageComplete)}%
                    </Typography>
                  </Box>
                  <LinearProgress 
                    variant="determinate" 
                    value={Math.min(kpi.percentageComplete, 100)} 
                    color={getStatusColor(kpi.status)}
                    sx={{ mb: 2 }}
                  />
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => handleLogActivity({ id: kpi.kpiId } as KPIDefinition)}
                    >
                      Log Activity
                    </Button>
                    {kpi.remainingToTarget > 0 && (
                      <Typography variant="caption" color="text.secondary">
                        {kpi.remainingToTarget} more needed
                      </Typography>
                    )}
                  </Box>
                </Paper>
              </Grid>
            ))}
          </Grid>
        </CardContent>
      </Card>

      {/* AI Task Suggestions */}
      <Card sx={{ mb: 3 }}>
        <CardHeader
          title="AI Task Suggestions"
          subheader="Recommended activities to meet your KPIs"
        />
        <CardContent>
          {taskSuggestions.filter(s => !s.isCompleted).length === 0 ? (
            <Alert severity="info">
              No task suggestions available. Keep up the great work!
            </Alert>
          ) : (
            <List>
              {taskSuggestions
                .filter(s => !s.isCompleted)
                .slice(0, 5)
                .map((suggestion) => (
                  <ListItem key={suggestion.id} divider>
                    <ListItemIcon>
                      {getActivityIcon(suggestion.type)}
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {suggestion.title}
                          {getPriorityIcon(suggestion.priority)}
                        </Box>
                      }
                      secondary={
                        <Box>
                          <Typography variant="body2">{suggestion.description}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {suggestion.reason}
                          </Typography>
                        </Box>
                      }
                    />
                    <ListItemSecondaryAction>
                      <Box sx={{ display: 'flex', gap: 1 }}>
                        {!suggestion.isAccepted ? (
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => handleAcceptTask(suggestion.id)}
                          >
                            Accept
                          </Button>
                        ) : (
                          <Button
                            size="small"
                            variant="contained"
                            onClick={() => handleCompleteTask(suggestion.id)}
                          >
                            Complete
                          </Button>
                        )}
                      </Box>
                    </ListItemSecondaryAction>
                  </ListItem>
                ))}
            </List>
          )}
        </CardContent>
      </Card>

      {/* Recent Activities */}
      <Card>
        <CardHeader
          title="Recent Activities"
          subheader="Your latest KPI-related activities"
        />
        <CardContent>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Activity</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Value</TableCell>
                  <TableCell>Outcome</TableCell>
                  <TableCell>Date</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {activities
                  .sort((a, b) => new Date(b.activityDate).getTime() - new Date(a.activityDate).getTime())
                  .slice(0, 10)
                  .map((activity) => (
                    <TableRow key={activity.id}>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {getActivityIcon(activity.activityType)}
                          <Typography variant="body2">
                            {activity.description}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Chip label={activity.activityType} size="small" />
                      </TableCell>
                      <TableCell>{activity.value}</TableCell>
                      <TableCell>
                        <Chip 
                          label={activity.outcome} 
                          size="small"
                          color={activity.outcome === 'positive' ? 'success' : 
                                 activity.outcome === 'negative' ? 'error' : 'default'}
                        />
                      </TableCell>
                      <TableCell>{activity.activityDate}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Activity Dialog */}
      <Dialog open={showActivityDialog} onClose={() => setShowActivityDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Log Activity</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <FormControl fullWidth>
                <InputLabel>Activity Type</InputLabel>
                <Select
                  value={activityForm.activityType}
                  onChange={(e) => setActivityForm(prev => ({ ...prev, activityType: e.target.value as any }))}
                  label="Activity Type"
                >
                  <MenuItem value="call">Phone Call</MenuItem>
                  <MenuItem value="email">Email</MenuItem>
                  <MenuItem value="meeting">Meeting</MenuItem>
                  <MenuItem value="proposal">Proposal</MenuItem>
                  <MenuItem value="follow_up">Follow Up</MenuItem>
                  <MenuItem value="research">Research</MenuItem>
                  <MenuItem value="other">Other</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Description"
                value={activityForm.description}
                onChange={(e) => setActivityForm(prev => ({ ...prev, description: e.target.value }))}
                multiline
                rows={2}
                placeholder="Describe what you did..."
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Value (KPI contribution)"
                type="number"
                value={activityForm.value}
                onChange={(e) => setActivityForm(prev => ({ ...prev, value: Number(e.target.value) }))}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Duration (minutes)"
                type="number"
                value={activityForm.duration}
                onChange={(e) => setActivityForm(prev => ({ ...prev, duration: Number(e.target.value) }))}
              />
            </Grid>
            <Grid item xs={12}>
              <FormControl fullWidth>
                <InputLabel>Outcome</InputLabel>
                <Select
                  value={activityForm.outcome}
                  onChange={(e) => setActivityForm(prev => ({ ...prev, outcome: e.target.value as any }))}
                  label="Outcome"
                >
                  <MenuItem value="positive">Positive</MenuItem>
                  <MenuItem value="neutral">Neutral</MenuItem>
                  <MenuItem value="negative">Negative</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Notes"
                value={activityForm.notes}
                onChange={(e) => setActivityForm(prev => ({ ...prev, notes: e.target.value }))}
                multiline
                rows={2}
                placeholder="Additional notes..."
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowActivityDialog(false)}>Cancel</Button>
          <Button onClick={handleSaveActivity} variant="contained">
            Log Activity
          </Button>
        </DialogActions>
      </Dialog>

      {/* Success/Error Messages */}
      <Snackbar open={!!success} autoHideDuration={6000} onClose={() => setSuccess('')}>
        <Alert onClose={() => setSuccess('')} severity="success">
          {success}
        </Alert>
      </Snackbar>
      <Snackbar open={!!error} autoHideDuration={6000} onClose={() => setError('')}>
        <Alert onClose={() => setError('')} severity="error">
          {error}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default KPIDashboard; 
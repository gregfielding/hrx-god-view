import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
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
  Grid,
  Card,
  CardContent,
  LinearProgress,
  Alert,
  Tooltip,
  Tabs,
  Tab,
  List,
  ListItem,
  ListItemText,
  ListItemIcon
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  FilterList as FilterIcon,
  TrendingUp as TrendingUpIcon,
  TrendingDown as TrendingDownIcon,
  Psychology as PsychologyIcon,
  Feedback as FeedbackIcon,
  AutoFixHigh as AutoFixHighIcon,
  Schedule as ScheduleIcon,
  CheckCircle as CheckCircleIcon,
  Info as InfoIcon,
  Visibility as VisibilityIcon,
  PlayArrow as PlayArrowIcon
} from '@mui/icons-material';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { useAuth } from '../../contexts/AuthContext';

interface AIFeedback {
  id: string;
  feedbackType: 'satisfaction' | 'accuracy' | 'helpfulness' | 'tone' | 'escalation';
  feedbackData: any;
  userId: string;
  customerId: string;
  moduleId: string;
  timestamp: Date;
  analyzed: boolean;
  learningApplied: boolean;
  confidenceScore: number;
  satisfactionScore: number;
  improvementAreas: string[];
  suggestedActions: string[];
  analysis?: any;
}

interface AILearningTask {
  id: string;
  feedbackId: string;
  moduleId: string;
  customerId: string;
  learningType: 'feedback_based' | 'performance_based' | 'scheduled';
  priority: 'low' | 'medium' | 'high';
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  createdAt: Date;
  analysis: any;
  suggestedActions: any[];
  appliedChanges: string[];
}

interface FeedbackAnalytics {
  totalFeedback: number;
  averageConfidence: number;
  averageSatisfaction: number;
  feedbackByType: Record<string, number>;
  feedbackByModule: Record<string, number>;
  recentTrends: {
    confidence: number[];
    satisfaction: number[];
    dates: string[];
  };
  learningTasks: {
    pending: number;
    inProgress: number;
    completed: number;
    failed: number;
  };
}

const AIFeedbackDashboard: React.FC = () => {
  const { user } = useAuth();
  const functions = getFunctions();
  
  // State
  const [feedback, setFeedback] = useState<AIFeedback[]>([]);
  const [learningTasks, setLearningTasks] = useState<AILearningTask[]>([]);
  const [analytics, setAnalytics] = useState<FeedbackAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Pagination
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  
  // Filters
  const [feedbackTypeFilter, setFeedbackTypeFilter] = useState<string>('all');
  const [moduleFilter, setModuleFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateRange, setDateRange] = useState<{ start: Date | null; end: Date | null }>({
    start: null,
    end: null
  });
  
  // Dialogs
  const [feedbackDetailDialog, setFeedbackDetailDialog] = useState<{
    open: boolean;
    feedback: AIFeedback | null;
  }>({ open: false, feedback: null });
  
  const [learningTaskDialog, setLearningTaskDialog] = useState<{
    open: boolean;
    task: AILearningTask | null;
  }>({ open: false, task: null });
  
  const [activeTab, setActiveTab] = useState(0);
  
  // Load data
  useEffect(() => {
    loadData();
  }, []);
  
  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Load feedback data
      const getFeedbackData = httpsCallable(functions, 'getAIFeedbackData');
      const feedbackResult = await getFeedbackData({
        filters: {
          feedbackType: feedbackTypeFilter !== 'all' ? feedbackTypeFilter : undefined,
          moduleId: moduleFilter !== 'all' ? moduleFilter : undefined,
          dateRange: dateRange.start && dateRange.end ? {
            start: dateRange.start.toISOString(),
            end: dateRange.end.toISOString()
          } : undefined
        }
      });
      
      // Load learning tasks
      const getLearningTasks = httpsCallable(functions, 'getAILearningTasks');
      const tasksResult = await getLearningTasks({
        status: statusFilter !== 'all' ? statusFilter : undefined
      });
      
      // Load analytics
      const getFeedbackAnalytics = httpsCallable(functions, 'getFeedbackAnalytics');
      const analyticsResult = await getFeedbackAnalytics();
      
      setFeedback((feedbackResult.data as any).feedback || []);
      setLearningTasks((tasksResult.data as any).tasks || []);
      setAnalytics((analyticsResult.data as any).analytics || null);
      
    } catch (err: any) {
      console.error('Error loading AI feedback data:', err);
      setError(err.message || 'Failed to load feedback data');
    } finally {
      setLoading(false);
    }
  };
  
  const handleRefresh = () => {
    loadData();
  };
  
  const handleFeedbackDetail = (feedback: AIFeedback) => {
    setFeedbackDetailDialog({ open: true, feedback });
  };
  
  const handleLearningTaskDetail = (task: AILearningTask) => {
    setLearningTaskDialog({ open: true, task });
  };
  
  const handleApplyLearning = async (taskId: string) => {
    try {
      const applyLearning = httpsCallable(functions, 'applyAILearning');
      await applyLearning({ taskId });
      await loadData(); // Refresh data
    } catch (err: any) {
      console.error('Error applying learning:', err);
      setError(err.message || 'Failed to apply learning');
    }
  };
  
  const getFeedbackTypeColor = (type: string) => {
    const colors: Record<string, 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'> = {
      satisfaction: 'success',
      accuracy: 'primary',
      helpfulness: 'info',
      tone: 'warning',
      escalation: 'error'
    };
    return colors[type] || 'default';
  };
  
  const getPriorityColor = (priority: string) => {
    const colors: Record<string, 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'> = {
      low: 'success',
      medium: 'warning',
      high: 'error'
    };
    return colors[priority] || 'default';
  };
  
  const getStatusColor = (status: string) => {
    const colors: Record<string, 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'> = {
      pending: 'warning',
      in_progress: 'info',
      completed: 'success',
      failed: 'error'
    };
    return colors[status] || 'default';
  };
  
  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };
  
  if (loading) {
    return (
      <Box sx={{ p: 3 }}>
        <LinearProgress />
        <Typography variant="h6" sx={{ mt: 2 }}>
          Loading AI Feedback Dashboard...
        </Typography>
      </Box>
    );
  }
  
  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        AI Feedback & Learning Dashboard
      </Typography>
      
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}
      
      {/* Analytics Overview */}
      {analytics && (
        <Grid container spacing={3} sx={{ mb: 3 }}>
          <Grid item xs={12} md={3}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom>
                  Total Feedback
                </Typography>
                <Typography variant="h4">
                  {analytics.totalFeedback}
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  Last 30 days
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          
          <Grid item xs={12} md={3}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom>
                  Avg Confidence
                </Typography>
                <Typography variant="h4">
                  {(analytics.averageConfidence * 100).toFixed(1)}%
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
                  {analytics.averageConfidence > 0.7 ? (
                    <TrendingUpIcon color="success" fontSize="small" />
                  ) : (
                    <TrendingDownIcon color="error" fontSize="small" />
                  )}
                  <Typography variant="body2" color="textSecondary" sx={{ ml: 0.5 }}>
                    {analytics.averageConfidence > 0.7 ? 'Good' : 'Needs attention'}
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>
          
          <Grid item xs={12} md={3}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom>
                  Avg Satisfaction
                </Typography>
                <Typography variant="h4">
                  {analytics.averageSatisfaction.toFixed(1)}/5
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
                  {analytics.averageSatisfaction > 3.5 ? (
                    <TrendingUpIcon color="success" fontSize="small" />
                  ) : (
                    <TrendingDownIcon color="error" fontSize="small" />
                  )}
                  <Typography variant="body2" color="textSecondary" sx={{ ml: 0.5 }}>
                    {analytics.averageSatisfaction > 3.5 ? 'Good' : 'Needs improvement'}
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>
          
          <Grid item xs={12} md={3}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom>
                  Learning Tasks
                </Typography>
                <Typography variant="h4">
                  {analytics.learningTasks.pending + analytics.learningTasks.inProgress}
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  {analytics.learningTasks.completed} completed
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}
      
      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={activeTab} onChange={(_, newValue) => setActiveTab(newValue)}>
          <Tab label="Feedback" icon={<FeedbackIcon />} iconPosition="start" />
          <Tab label="Learning Tasks" icon={<PsychologyIcon />} iconPosition="start" />
          <Tab label="Analytics" icon={<TrendingUpIcon />} iconPosition="start" />
        </Tabs>
      </Box>
      
      {/* Feedback Tab */}
      {activeTab === 0 && (
        <Box>
          {/* Filters */}
          <Paper sx={{ p: 2, mb: 3 }}>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} md={2}>
                <FormControl fullWidth size="small">
                  <InputLabel>Feedback Type</InputLabel>
                  <Select
                    value={feedbackTypeFilter}
                    onChange={(e) => setFeedbackTypeFilter(e.target.value)}
                    label="Feedback Type"
                  >
                    <MenuItem value="all">All Types</MenuItem>
                    <MenuItem value="satisfaction">Satisfaction</MenuItem>
                    <MenuItem value="accuracy">Accuracy</MenuItem>
                    <MenuItem value="helpfulness">Helpfulness</MenuItem>
                    <MenuItem value="tone">Tone</MenuItem>
                    <MenuItem value="escalation">Escalation</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              
              <Grid item xs={12} md={2}>
                <FormControl fullWidth size="small">
                  <InputLabel>Module</InputLabel>
                  <Select
                    value={moduleFilter}
                    onChange={(e) => setModuleFilter(e.target.value)}
                    label="Module"
                  >
                    <MenuItem value="all">All Modules</MenuItem>
                    <MenuItem value="ai_chat">AI Chat</MenuItem>
                    <MenuItem value="ai_campaigns">AI Campaigns</MenuItem>
                    <MenuItem value="feedback_engine">Feedback Engine</MenuItem>
                    <MenuItem value="moments_engine">Moments Engine</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              
              <Grid item xs={12} md={2}>
                <Button
                  variant="outlined"
                  startIcon={<FilterIcon />}
                  onClick={loadData}
                  fullWidth
                >
                  Apply Filters
                </Button>
              </Grid>
              
              <Grid item xs={12} md={2}>
                <Button
                  variant="outlined"
                  startIcon={<RefreshIcon />}
                  onClick={handleRefresh}
                  fullWidth
                >
                  Refresh
                </Button>
              </Grid>
            </Grid>
          </Paper>
          
          {/* Feedback Table */}
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Type</TableCell>
                  <TableCell>Module</TableCell>
                  <TableCell>Confidence</TableCell>
                  <TableCell>Satisfaction</TableCell>
                  <TableCell>Analyzed</TableCell>
                  <TableCell>Learning Applied</TableCell>
                  <TableCell>Date</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {feedback
                  .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
                  .map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <Chip
                          label={item.feedbackType}
                          color={getFeedbackTypeColor(item.feedbackType)}
                          size="small"
                        />
                      </TableCell>
                      <TableCell>{item.moduleId}</TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <Typography variant="body2" sx={{ mr: 1 }}>
                            {(item.confidenceScore * 100).toFixed(1)}%
                          </Typography>
                          <LinearProgress
                            variant="determinate"
                            value={item.confidenceScore * 100}
                            sx={{ width: 60, height: 6 }}
                          />
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <Typography variant="body2" sx={{ mr: 1 }}>
                            {item.satisfactionScore}/5
                          </Typography>
                          <LinearProgress
                            variant="determinate"
                            value={(item.satisfactionScore / 5) * 100}
                            sx={{ width: 60, height: 6 }}
                          />
                        </Box>
                      </TableCell>
                      <TableCell>
                        {item.analyzed ? (
                          <CheckCircleIcon color="success" fontSize="small" />
                        ) : (
                          <ScheduleIcon color="warning" fontSize="small" />
                        )}
                      </TableCell>
                      <TableCell>
                        {item.learningApplied ? (
                          <CheckCircleIcon color="success" fontSize="small" />
                        ) : (
                          <InfoIcon color="info" fontSize="small" />
                        )}
                      </TableCell>
                      <TableCell>{formatDate(item.timestamp)}</TableCell>
                      <TableCell>
                        <Tooltip title="View Details">
                          <IconButton
                            size="small"
                            onClick={() => handleFeedbackDetail(item)}
                          >
                            <VisibilityIcon />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
            <TablePagination
              rowsPerPageOptions={[5, 10, 25]}
              component="div"
              count={feedback.length}
              rowsPerPage={rowsPerPage}
              page={page}
              onPageChange={(_, newPage) => setPage(newPage)}
              onRowsPerPageChange={(e) => {
                setRowsPerPage(parseInt(e.target.value, 10));
                setPage(0);
              }}
            />
          </TableContainer>
        </Box>
      )}
      
      {/* Learning Tasks Tab */}
      {activeTab === 1 && (
        <Box>
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Type</TableCell>
                  <TableCell>Module</TableCell>
                  <TableCell>Priority</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Created</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {learningTasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell>
                      <Chip
                        label={task.learningType}
                        color="primary"
                        size="small"
                      />
                    </TableCell>
                    <TableCell>{task.moduleId}</TableCell>
                    <TableCell>
                      <Chip
                        label={task.priority}
                        color={getPriorityColor(task.priority)}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={task.status}
                        color={getStatusColor(task.status)}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>{formatDate(task.createdAt)}</TableCell>
                    <TableCell>
                      <Tooltip title="View Details">
                        <IconButton
                          size="small"
                          onClick={() => handleLearningTaskDetail(task)}
                        >
                          <VisibilityIcon />
                        </IconButton>
                      </Tooltip>
                      {task.status === 'pending' && (
                        <Tooltip title="Apply Learning">
                          <IconButton
                            size="small"
                            onClick={() => handleApplyLearning(task.id)}
                          >
                            <PlayArrowIcon />
                          </IconButton>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}
      
      {/* Analytics Tab */}
      {activeTab === 2 && analytics && (
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom>
                Feedback by Type
              </Typography>
              <List>
                {Object.entries(analytics.feedbackByType).map(([type, count]) => (
                  <ListItem key={type}>
                    <ListItemIcon>
                      <Chip
                        label={type}
                        color={getFeedbackTypeColor(type)}
                        size="small"
                      />
                    </ListItemIcon>
                    <ListItemText primary={count} />
                  </ListItem>
                ))}
              </List>
            </Paper>
          </Grid>
          
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom>
                Feedback by Module
              </Typography>
              <List>
                {Object.entries(analytics.feedbackByModule).map(([module, count]) => (
                  <ListItem key={module}>
                    <ListItemIcon>
                      <AutoFixHighIcon />
                    </ListItemIcon>
                    <ListItemText primary={module} secondary={count} />
                  </ListItem>
                ))}
              </List>
            </Paper>
          </Grid>
          
          <Grid item xs={12}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom>
                Learning Task Status
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={3}>
                  <Box textAlign="center">
                    <Typography variant="h4" color="warning.main">
                      {analytics.learningTasks.pending}
                    </Typography>
                    <Typography variant="body2">Pending</Typography>
                  </Box>
                </Grid>
                <Grid item xs={3}>
                  <Box textAlign="center">
                    <Typography variant="h4" color="info.main">
                      {analytics.learningTasks.inProgress}
                    </Typography>
                    <Typography variant="body2">In Progress</Typography>
                  </Box>
                </Grid>
                <Grid item xs={3}>
                  <Box textAlign="center">
                    <Typography variant="h4" color="success.main">
                      {analytics.learningTasks.completed}
                    </Typography>
                    <Typography variant="body2">Completed</Typography>
                  </Box>
                </Grid>
                <Grid item xs={3}>
                  <Box textAlign="center">
                    <Typography variant="h4" color="error.main">
                      {analytics.learningTasks.failed}
                    </Typography>
                    <Typography variant="body2">Failed</Typography>
                  </Box>
                </Grid>
              </Grid>
            </Paper>
          </Grid>
        </Grid>
      )}
      
      {/* Feedback Detail Dialog */}
      <Dialog
        open={feedbackDetailDialog.open}
        onClose={() => setFeedbackDetailDialog({ open: false, feedback: null })}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Feedback Details
          {feedbackDetailDialog.feedback && (
            <Chip
              label={feedbackDetailDialog.feedback.feedbackType}
              color={getFeedbackTypeColor(feedbackDetailDialog.feedback.feedbackType)}
              sx={{ ml: 2 }}
            />
          )}
        </DialogTitle>
        <DialogContent>
          {feedbackDetailDialog.feedback && (
            <Box>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Typography variant="subtitle2">Module</Typography>
                  <Typography variant="body1">{feedbackDetailDialog.feedback.moduleId}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="subtitle2">User ID</Typography>
                  <Typography variant="body1">{feedbackDetailDialog.feedback.userId}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="subtitle2">Confidence Score</Typography>
                  <Typography variant="body1">
                    {(feedbackDetailDialog.feedback.confidenceScore * 100).toFixed(1)}%
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="subtitle2">Satisfaction Score</Typography>
                  <Typography variant="body1">
                    {feedbackDetailDialog.feedback.satisfactionScore}/5
                  </Typography>
                </Grid>
                <Grid item xs={12}>
                  <Typography variant="subtitle2">Feedback Data</Typography>
                  <Paper sx={{ p: 2, bgcolor: 'grey.50' }}>
                    <pre style={{ margin: 0, fontSize: '0.875rem' }}>
                      {JSON.stringify(feedbackDetailDialog.feedback.feedbackData, null, 2)}
                    </pre>
                  </Paper>
                </Grid>
                {feedbackDetailDialog.feedback.improvementAreas.length > 0 && (
                  <Grid item xs={12}>
                    <Typography variant="subtitle2">Improvement Areas</Typography>
                    <Box sx={{ mt: 1 }}>
                      {feedbackDetailDialog.feedback.improvementAreas.map((area, index) => (
                        <Chip
                          key={index}
                          label={area}
                          color="warning"
                          size="small"
                          sx={{ mr: 1, mb: 1 }}
                        />
                      ))}
                    </Box>
                  </Grid>
                )}
                {feedbackDetailDialog.feedback.suggestedActions.length > 0 && (
                  <Grid item xs={12}>
                    <Typography variant="subtitle2">Suggested Actions</Typography>
                    <List dense>
                      {feedbackDetailDialog.feedback.suggestedActions.map((action, index) => (
                        <ListItem key={index}>
                          <ListItemIcon>
                            <AutoFixHighIcon fontSize="small" />
                          </ListItemIcon>
                          <ListItemText primary={action} />
                        </ListItem>
                      ))}
                    </List>
                  </Grid>
                )}
              </Grid>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFeedbackDetailDialog({ open: false, feedback: null })}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* Learning Task Detail Dialog */}
      <Dialog
        open={learningTaskDialog.open}
        onClose={() => setLearningTaskDialog({ open: false, task: null })}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Learning Task Details
          {learningTaskDialog.task && (
            <Chip
              label={learningTaskDialog.task.learningType}
              color="primary"
              sx={{ ml: 2 }}
            />
          )}
        </DialogTitle>
        <DialogContent>
          {learningTaskDialog.task && (
            <Box>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Typography variant="subtitle2">Module</Typography>
                  <Typography variant="body1">{learningTaskDialog.task.moduleId}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="subtitle2">Priority</Typography>
                  <Chip
                    label={learningTaskDialog.task.priority}
                    color={getPriorityColor(learningTaskDialog.task.priority)}
                    size="small"
                  />
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="subtitle2">Status</Typography>
                  <Chip
                    label={learningTaskDialog.task.status}
                    color={getStatusColor(learningTaskDialog.task.status)}
                    size="small"
                  />
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="subtitle2">Created</Typography>
                  <Typography variant="body1">
                    {formatDate(learningTaskDialog.task.createdAt)}
                  </Typography>
                </Grid>
                {learningTaskDialog.task.suggestedActions.length > 0 && (
                  <Grid item xs={12}>
                    <Typography variant="subtitle2">Suggested Actions</Typography>
                    <List dense>
                      {learningTaskDialog.task.suggestedActions.map((action: any, index: number) => (
                        <ListItem key={index}>
                          <ListItemIcon>
                            <AutoFixHighIcon fontSize="small" />
                          </ListItemIcon>
                          <ListItemText 
                            primary={action.suggestion}
                            secondary={`Priority: ${action.priority}`}
                          />
                        </ListItem>
                      ))}
                    </List>
                  </Grid>
                )}
                {learningTaskDialog.task.appliedChanges.length > 0 && (
                  <Grid item xs={12}>
                    <Typography variant="subtitle2">Applied Changes</Typography>
                    <List dense>
                      {learningTaskDialog.task.appliedChanges.map((change, index) => (
                        <ListItem key={index}>
                          <ListItemIcon>
                            <CheckCircleIcon color="success" fontSize="small" />
                          </ListItemIcon>
                          <ListItemText primary={change} />
                        </ListItem>
                      ))}
                    </List>
                  </Grid>
                )}
              </Grid>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          {learningTaskDialog.task?.status === 'pending' && (
            <Button
              variant="contained"
              startIcon={<PlayArrowIcon />}
              onClick={() => {
                handleApplyLearning(learningTaskDialog.task!.id);
                setLearningTaskDialog({ open: false, task: null });
              }}
            >
              Apply Learning
            </Button>
          )}
          <Button onClick={() => setLearningTaskDialog({ open: false, task: null })}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default AIFeedbackDashboard; 
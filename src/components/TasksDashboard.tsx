import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Chip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Tabs,
  Tab,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  IconButton,
  Tooltip,
  LinearProgress,
  Alert,
  Badge
} from '@mui/material';
import {
  Add as AddIcon,
  CheckCircle as CheckCircleIcon,
  Edit as EditIcon,
  CalendarToday as CalendarIcon,
  Lightbulb as LightbulbIcon,
  Assignment as AssignmentIcon,
  Email as EmailIcon,
  Phone as PhoneIcon,
  Business as BusinessIcon,
  Person as PersonIcon,
  VideoCall as VideoCallIcon,
  LinkedIn as LinkedInIcon,
  CardGiftcard as GiftIcon,
  Sync as SyncIcon,
  Mail as MailIcon
} from '@mui/icons-material';

import { TaskService } from '../utils/taskService';
import { GmailTasksService } from '../utils/gmailTasksService';
import { useAuth } from '../contexts/AuthContext';
import {
  CRMTask,
  TaskDashboard as TaskDashboardData,
  AITaskSuggestion,
  TaskStatus,
  TaskType,
  TaskCategory,
  TaskClassification
} from '../types/Tasks';

interface TasksDashboardProps {
  salespersonId: string;
  tenantId: string;
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
      id={`tasks-tabpanel-${index}`}
      aria-labelledby={`tasks-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

export const TasksDashboard: React.FC<TasksDashboardProps> = ({ salespersonId, tenantId }) => {
  const { user } = useAuth();
  const [dashboardData, setDashboardData] = useState<TaskDashboardData | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<AITaskSuggestion[]>([]);
  const [selectedTask, setSelectedTask] = useState<CRMTask | null>(null);
  const [tabValue, setTabValue] = useState(0);
  const [createTaskDialog, setCreateTaskDialog] = useState(false);
  const [taskDetailsDialog, setTaskDetailsDialog] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // CRM data state
  const [companies, setCompanies] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [salespeople, setSalespeople] = useState<any[]>([]);

  // Gmail sync state
  const [gmailSyncLoading, setGmailSyncLoading] = useState(false);
  const [gmailSyncStatus, setGmailSyncStatus] = useState<any>(null);
  const [showGmailSyncDialog, setShowGmailSyncDialog] = useState(false);

  const taskService = TaskService.getInstance();
  const gmailTasksService = GmailTasksService.getInstance();

  useEffect(() => {
    loadDashboardData();
  }, [salespersonId]);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      const today = new Date().toISOString().split('T')[0];
      
      // Load dashboard data
      const dashboard = await taskService.getTaskDashboard(salespersonId, today, tenantId);
      setDashboardData(dashboard);
      
      // Load AI suggestions
      const suggestions = await taskService.getAITaskSuggestions(salespersonId, tenantId);
      setAiSuggestions(suggestions);
      
      // Load CRM data for task creation
      // Note: In a real implementation, you'd load this from your CRM services
      // For now, we'll use empty arrays and let the user populate manually
      setCompanies([]);
      setContacts([]);
      setDeals([]);
      setSalespeople([]);
      
      setError(null);
    } catch (err) {
      console.error('Error loading dashboard data:', err);
      setError('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickComplete = async (taskId: string) => {
    try {
      await taskService.quickCompleteTask(taskId, tenantId, salespersonId);
      await loadDashboardData(); // Refresh data
    } catch (err) {
      console.error('Error completing task:', err);
    }
  };

  const handleAcceptSuggestion = async (suggestionId: string) => {
    try {
      await taskService.acceptAITaskSuggestion(suggestionId, tenantId, salespersonId);
      await loadDashboardData(); // Refresh data
    } catch (err) {
      console.error('Error accepting suggestion:', err);
    }
  };

  const handleRejectSuggestion = async (suggestionId: string) => {
    try {
      await taskService.rejectAITaskSuggestion(suggestionId, 'Rejected by user', tenantId, salespersonId);
      await loadDashboardData(); // Refresh data
    } catch (err) {
      console.error('Error rejecting suggestion:', err);
    }
  };

  // Gmail sync functions
  const handleGmailSync = async () => {
    if (!user?.uid || !tenantId) return;
    
    setGmailSyncLoading(true);
    try {
      const result = await gmailTasksService.completeGmailSync(tenantId, user.uid);
      setGmailSyncStatus(result);
      
      // Refresh dashboard data
      await loadDashboardData();
      
      console.log('Gmail sync completed:', result);
    } catch (error: any) {
      console.error('Gmail sync error:', error);
      setError(`Gmail sync failed: ${error.message}`);
    } finally {
      setGmailSyncLoading(false);
    }
  };

  const handleEmailSync = async () => {
    if (!user?.uid || !tenantId) return;
    
    setGmailSyncLoading(true);
    try {
      const result = await gmailTasksService.syncGmailAndCreateTasks(tenantId, user.uid);
      setGmailSyncStatus(result);
      
      // Refresh dashboard data
      await loadDashboardData();
      
      console.log('Email sync completed:', result);
    } catch (error: any) {
      console.error('Email sync error:', error);
      setError(`Email sync failed: ${error.message}`);
    } finally {
      setGmailSyncLoading(false);
    }
  };

  const handleCalendarSync = async () => {
    if (!user?.uid || !tenantId) return;
    
    setGmailSyncLoading(true);
    try {
      const result = await gmailTasksService.syncGmailCalendarAsTasks(tenantId, user.uid);
      setGmailSyncStatus(result);
      
      // Refresh dashboard data
      await loadDashboardData();
      
      console.log('Calendar sync completed:', result);
    } catch (error: any) {
      console.error('Calendar sync error:', error);
      setError(`Calendar sync failed: ${error.message}`);
    } finally {
      setGmailSyncLoading(false);
    }
  };

  const getStatusColor = (status: TaskStatus): string => {
    const statusColors = {
      upcoming: '#87CEEB', // Light Blue
      due: '#FFA500', // Orange
      completed: '#32CD32', // Green
      postponed: '#808080', // Gray
      cancelled: '#FF0000', // Red
      in_progress: '#FFD700', // Gold
      draft: '#D3D3D3' // Light Gray
    };
    return statusColors[status] || '#000000';
  };

  const getTaskTypeIcon = (type: TaskType) => {
    const typeIcons = {
      email: <EmailIcon />,
      phone_call: <PhoneIcon />,
      in_person_drop_by: <BusinessIcon />,
      scheduled_meeting_in_person: <PersonIcon />,
      scheduled_meeting_virtual: <VideoCallIcon />,
      linkedin_message: <LinkedInIcon />,
      send_gift: <GiftIcon />,
      custom: <AssignmentIcon />,
      research: <AssignmentIcon />,
      proposal_preparation: <AssignmentIcon />,
      contract_review: <AssignmentIcon />,
      follow_up: <AssignmentIcon />,
      check_in: <AssignmentIcon />,
      presentation: <AssignmentIcon />,
      demo: <AssignmentIcon />,
      negotiation: <AssignmentIcon />,
      closing: <AssignmentIcon />,
      administrative: <AssignmentIcon />
    };
    return typeIcons[type] || <AssignmentIcon />;
  };

  const calculateUrgency = (task: CRMTask): number => {
    return taskService.calculateTaskUrgency(task);
  };

  if (loading) {
    return (
      <Box sx={{ p: 3 }}>
        <LinearProgress />
        <Typography variant="h6" sx={{ mt: 2 }}>Loading Tasks Dashboard...</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
        <Button onClick={loadDashboardData} variant="contained">
          Retry
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 0 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h4" component="h1">
          Tasks Dashboard
        </Typography>
        
        <Box sx={{ display: 'flex', gap: 1 }}>
          {/* Gmail Sync Buttons */}
          <Tooltip title="Sync Gmail emails and create tasks">
            <Button
              variant="outlined"
              startIcon={<MailIcon />}
              onClick={handleEmailSync}
              disabled={gmailSyncLoading}
              size="small"
            >
              Sync Emails
            </Button>
          </Tooltip>
          
          <Tooltip title="Sync Gmail calendar events as tasks">
            <Button
              variant="outlined"
              startIcon={<CalendarIcon />}
              onClick={handleCalendarSync}
              disabled={gmailSyncLoading}
              size="small"
            >
              Sync Calendar
            </Button>
          </Tooltip>
          
          <Tooltip title="Complete Gmail sync (emails + calendar)">
            <Button
              variant="contained"
              startIcon={<SyncIcon />}
              onClick={handleGmailSync}
              disabled={gmailSyncLoading}
              size="small"
            >
              Full Sync
            </Button>
          </Tooltip>
          
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setCreateTaskDialog(true)}
            size="small"
          >
            New Task
          </Button>
        </Box>
      </Box>

      {/* Gmail Sync Status */}
      {gmailSyncStatus && (
        <Alert 
          severity={gmailSyncStatus.success ? "success" : "error"}
          sx={{ mb: 2 }}
          onClose={() => setGmailSyncStatus(null)}
        >
          {gmailSyncStatus.message}
          {gmailSyncStatus.totalTasksCreated && (
            <Typography variant="body2" sx={{ mt: 1 }}>
              Created {gmailSyncStatus.totalTasksCreated} new tasks
            </Typography>
          )}
        </Alert>
      )}

      {/* Loading Progress */}
      {gmailSyncLoading && (
        <Box sx={{ mb: 2 }}>
          <LinearProgress />
          <Typography variant="body2" sx={{ mt: 1, textAlign: 'center' }}>
            Syncing with Gmail...
          </Typography>
        </Box>
      )}

      {/* Quick Stats */}
      {dashboardData && (
        <Grid container spacing={3} sx={{ mb: 3 }}>
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom>
                  Today&apos;s Tasks
                </Typography>
                <Typography variant="h4">
                  {dashboardData.today?.totalTasks || 0}
                </Typography>
                <LinearProgress 
                  variant="determinate" 
                  value={dashboardData.today?.totalTasks ? (dashboardData.today.completedTasks / dashboardData.today.totalTasks) * 100 : 0}
                  sx={{ mt: 1 }}
                />
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom>
                  Completed
                </Typography>
                <Typography variant="h4" color="success.main">
                  {dashboardData.today?.completedTasks || 0}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom>
                  Pending
                </Typography>
                <Typography variant="h4" color="warning.main">
                  {dashboardData.today?.pendingTasks || 0}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom>
                  Quota Progress
                </Typography>
                <Typography variant="h4">
                  {dashboardData.thisWeek?.quotaProgress?.businessGenerating || 0}/{dashboardData.thisWeek?.quotaProgress?.target || 0}
                </Typography>
                <LinearProgress 
                  variant="determinate" 
                  value={dashboardData.thisWeek?.quotaProgress?.percentage || 0}
                  sx={{ mt: 1 }}
                />
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs value={tabValue} onChange={(_, newValue) => setTabValue(newValue)}>
          <Tab label="Today's Tasks" />
          <Tab label="This Week" />
          <Tab 
            label={
              <Badge badgeContent={aiSuggestions.length} color="primary">
                AI Suggestions
              </Badge>
            } 
          />
          <Tab label="Analytics" />
        </Tabs>
      </Box>

      {/* Tab Panels */}
      <TabPanel value={tabValue} index={0}>
        <TasksList 
          tasks={dashboardData?.upcoming?.today || []}
          onTaskClick={(task) => {
            setSelectedTask(task);
            setTaskDetailsDialog(true);
          }}
          onQuickComplete={handleQuickComplete}
          getStatusColor={getStatusColor}
          getTaskTypeIcon={getTaskTypeIcon}
          calculateUrgency={calculateUrgency}
        />
      </TabPanel>

      <TabPanel value={tabValue} index={1}>
        <TasksList 
          tasks={dashboardData?.upcoming?.thisWeek || []}
          onTaskClick={(task) => {
            setSelectedTask(task);
            setTaskDetailsDialog(true);
          }}
          onQuickComplete={handleQuickComplete}
          getStatusColor={getStatusColor}
          getTaskTypeIcon={getTaskTypeIcon}
          calculateUrgency={calculateUrgency}
        />
      </TabPanel>

      <TabPanel value={tabValue} index={2}>
        <AISuggestionsList 
          suggestions={aiSuggestions}
          onAccept={handleAcceptSuggestion}
          onReject={handleRejectSuggestion}
        />
      </TabPanel>

      <TabPanel value={tabValue} index={3}>
        <TasksAnalytics dashboardData={dashboardData} />
      </TabPanel>

      {/* Create Task Dialog */}
      <CreateTaskDialog 
        open={createTaskDialog}
        onClose={() => setCreateTaskDialog(false)}
        onTaskCreated={() => {
          setCreateTaskDialog(false);
          loadDashboardData();
        }}
        userId={salespersonId}
        tenantId={tenantId}
        // Pass CRM data to the dialog
        companies={companies}
        contacts={contacts}
        deals={deals}
        salespeople={salespeople}
      />

      {/* Task Details Dialog */}
      <TaskDetailsDialog 
        open={taskDetailsDialog}
        task={selectedTask}
        onClose={() => {
          setTaskDetailsDialog(false);
          setSelectedTask(null);
        }}
        onTaskUpdated={() => {
          setTaskDetailsDialog(false);
          setSelectedTask(null);
          loadDashboardData();
        }}
        tenantId={tenantId}
        salespersonId={salespersonId}
      />
    </Box>
  );
};

// 🎯 TASKS LIST COMPONENT
interface TasksListProps {
  tasks: CRMTask[];
  onTaskClick: (task: CRMTask) => void;
  onQuickComplete: (taskId: string) => void;
  getStatusColor: (status: TaskStatus) => string;
  getTaskTypeIcon: (type: TaskType) => React.ReactElement;
  calculateUrgency: (task: CRMTask) => number;
}

const TasksList: React.FC<TasksListProps> = ({ 
  tasks, 
  onTaskClick, 
  onQuickComplete, 
  getStatusColor, 
  getTaskTypeIcon, 
  calculateUrgency 
}) => {
  if (tasks.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 4 }}>
        <Typography variant="h6" color="textSecondary">
          No tasks for this period
        </Typography>
      </Box>
    );
  }

  return (
    <List>
      {tasks.map((task) => {
        const urgency = calculateUrgency(task);
        const isOverdue = urgency > 7;
        
        return (
          <ListItem
            key={task.id}
            sx={{
              border: 1,
              borderColor: 'divider',
              borderRadius: 1,
              mb: 1,
              backgroundColor: isOverdue ? '#fff3cd' : 'background.paper',
              '&:hover': {
                backgroundColor: isOverdue ? '#ffeaa7' : 'action.hover'
              }
            }}
          >
            <ListItemIcon>
              {getTaskTypeIcon(task.type)}
            </ListItemIcon>
            
            <ListItemText
              primary={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="subtitle1" sx={{ flexGrow: 1 }}>
                    {task.title}
                  </Typography>
                  <Chip 
                    label={task.status} 
                    size="small"
                    sx={{ 
                      backgroundColor: getStatusColor(task.status),
                      color: 'white',
                      fontWeight: 'bold'
                    }}
                  />
                  {urgency > 7 && (
                    <Chip 
                      label="URGENT" 
                      size="small"
                      color="error"
                      variant="outlined"
                    />
                  )}
                </Box>
              }
              secondary={
                <Box>
                  <Typography variant="body2" color="textSecondary">
                    {task.description}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                    <Typography variant="caption" color="textSecondary">
                      Due: {new Date((task.classification === 'todo' ? task.dueDate : task.scheduledDate) + 'T00:00:00').toLocaleDateString()}
                    </Typography>
                    <Typography variant="caption" color="textSecondary">
                      Priority: {task.priority}
                    </Typography>
                    {task.associations.deals && task.associations.deals.length > 0 && (
                      <Chip label={`${task.associations.deals.length} Deal(s)`} size="small" />
                    )}
                  </Box>
                </Box>
              }
            />
            
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Tooltip title="Quick Complete">
                <IconButton 
                  size="small" 
                  color="success"
                  onClick={() => onQuickComplete(task.id)}
                >
                  <CheckCircleIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title="View Details">
                <IconButton 
                  size="small"
                  onClick={() => onTaskClick(task)}
                >
                  <EditIcon />
                </IconButton>
              </Tooltip>
            </Box>
          </ListItem>
        );
      })}
    </List>
  );
};

// 🤖 AI SUGGESTIONS LIST COMPONENT
interface AISuggestionsListProps {
  suggestions: AITaskSuggestion[];
  onAccept: (suggestionId: string) => void;
  onReject: (suggestionId: string) => void;
}

const AISuggestionsList: React.FC<AISuggestionsListProps> = ({ 
  suggestions, 
  onAccept, 
  onReject 
}) => {
  if (suggestions.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 4 }}>
        <LightbulbIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
        <Typography variant="h6" color="textSecondary">
          No AI suggestions available
        </Typography>
        <Typography variant="body2" color="textSecondary">
          AI will suggest tasks based on your pipeline and activity patterns
        </Typography>
      </Box>
    );
  }

  return (
    <List>
      {suggestions.map((suggestion) => (
        <ListItem
          key={suggestion.id}
          sx={{
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            mb: 1,
            backgroundColor: 'background.paper'
          }}
        >
          <ListItemIcon>
            <LightbulbIcon color="primary" />
          </ListItemIcon>
          
          <ListItemText
            primary={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="subtitle1" sx={{ flexGrow: 1 }}>
                  {suggestion.title}
                </Typography>
                <Chip 
                  label={`${suggestion.aiConfidence}%`} 
                  size="small"
                  color="primary"
                  variant="outlined"
                />
              </Box>
            }
            secondary={
              <Box>
                <Typography variant="body2" color="textSecondary">
                  {suggestion.description}
                </Typography>
                <Typography variant="caption" color="primary">
                  AI Reason: {suggestion.aiReason}
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                  <Typography variant="caption" color="textSecondary">
                    Suggested: {new Date(suggestion.suggestedDate).toLocaleDateString()}
                  </Typography>
                  <Typography variant="caption" color="textSecondary">
                    Urgency: {suggestion.urgencyScore}/10
                  </Typography>
                </Box>
              </Box>
            }
          />
          
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              variant="contained"
              size="small"
              color="primary"
              onClick={() => onAccept(suggestion.id)}
            >
              Accept
            </Button>
            <Button
              variant="outlined"
              size="small"
              color="error"
              onClick={() => onReject(suggestion.id)}
            >
              Reject
            </Button>
          </Box>
        </ListItem>
      ))}
    </List>
  );
};

// 📊 TASKS ANALYTICS COMPONENT
interface TasksAnalyticsProps {
  dashboardData: TaskDashboardData | null;
}

const TasksAnalytics: React.FC<TasksAnalyticsProps> = ({ dashboardData }) => {
  if (!dashboardData) return null;

  return (
    <Grid container spacing={3}>
      <Grid item xs={12} md={6}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Priority Breakdown
            </Typography>
            {Object.entries(dashboardData.priorities || {}).map(([priority, data]) => (
              <Box key={priority} sx={{ mb: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="body2" sx={{ textTransform: 'capitalize' }}>
                    {priority}
                  </Typography>
                  <Typography variant="body2">
                    {data?.completed || 0}/{data?.count || 0}
                  </Typography>
                </Box>
                <LinearProgress 
                  variant="determinate" 
                  value={data?.count ? (data.completed / data.count) * 100 : 0}
                />
              </Box>
            ))}
          </CardContent>
        </Card>
      </Grid>
      
      <Grid item xs={12} md={6}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Type Breakdown
            </Typography>
            {Object.entries(dashboardData.types || {}).slice(0, 5).map(([type, data]) => (
              <Box key={type} sx={{ mb: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="body2" sx={{ textTransform: 'capitalize' }}>
                    {type.replace('_', ' ')}
                  </Typography>
                  <Typography variant="body2">
                    {data?.completed || 0}/{data?.count || 0}
                  </Typography>
                </Box>
                <LinearProgress 
                  variant="determinate" 
                  value={data?.count ? (data.completed / data.count) * 100 : 0}
                />
              </Box>
            ))}
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
};

// 📝 CREATE TASK DIALOG COMPONENT
interface CreateTaskDialogProps {
  open: boolean;
  onClose: () => void;
  onTaskCreated: () => void;
  userId: string;
  tenantId: string;
  // Add CRM data props
  companies?: any[];
  contacts?: any[];
  deals?: any[];
  salespeople?: any[];
}

const CreateTaskDialog: React.FC<CreateTaskDialogProps> = ({ 
  open, 
  onClose, 
  onTaskCreated, 
  userId, 
  tenantId,
  companies = [],
  contacts = [],
  deals = [],
  salespeople = []
}) => {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    type: 'email' as TaskType,
    priority: 'medium' as 'low' | 'medium' | 'high' | 'urgent',
    scheduledDate: new Date().toISOString().split('T')[0],
    estimatedDuration: 30,
    category: 'business_generating' as 'business_generating' | 'relationship_building' | 'administrative' | 'research',
    // CRM Associations
    selectedCompany: '',
    selectedLocation: '',
    selectedContact: '',
    selectedDeal: '',
    selectedSalesperson: userId,
    // Communication details
    recipient: '',
    subject: '',
    draftContent: '',
    // Notes
    notes: ''
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const taskService = TaskService.getInstance();

  const handleSubmit = async () => {
    if (!formData.title.trim()) {
      setError('Task title is required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const taskData = {
        title: formData.title,
        description: formData.description,
        type: formData.type,
        priority: formData.priority,
        status: 'upcoming' as const,
        classification: 'todo' as TaskClassification,
        scheduledDate: formData.scheduledDate,
        estimatedDuration: formData.estimatedDuration,
        quotaCategory: 'business_generating' as const,
        category: 'follow_up' as TaskCategory, // Use a valid TaskCategory value
        assignedTo: formData.selectedSalesperson,
        createdBy: userId,
        // CRM Associations
        associations: {
          companies: formData.selectedCompany ? [formData.selectedCompany] : [],
          contacts: formData.selectedContact ? [formData.selectedContact] : [],
          deals: formData.selectedDeal ? [formData.selectedDeal] : [],
          salespeople: formData.selectedSalesperson ? [formData.selectedSalesperson] : [],
          locations: formData.selectedLocation ? [formData.selectedLocation] : []
        },
        // Communication details for email tasks
        communicationDetails: formData.type === 'email' ? {
          method: 'email' as const,
          recipient: formData.recipient,
          subject: formData.subject,
          draftContent: formData.draftContent
        } : undefined,
        notes: formData.notes,
        tenantId,
        tags: ['manual-created'],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await taskService.createTask(taskData);
      
      // Reset form
      setFormData({
        title: '',
        description: '',
        type: 'email',
        priority: 'medium',
        scheduledDate: new Date().toISOString().split('T')[0],
        estimatedDuration: 30,
        category: 'business_generating',
        selectedCompany: '',
        selectedLocation: '',
        selectedContact: '',
        selectedDeal: '',
        selectedSalesperson: userId,
        recipient: '',
        subject: '',
        draftContent: '',
        notes: ''
      });

      onTaskCreated();
      onClose();
    } catch (err: any) {
      console.error('Error creating task:', err);
      setError(`Failed to create task: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // Filter contacts based on selected company
  const filteredContacts = formData.selectedCompany 
    ? contacts.filter((contact: any) => contact.companyId === formData.selectedCompany)
    : contacts;

  // Filter deals based on selected company
  const filteredDeals = formData.selectedCompany 
    ? deals.filter((deal: any) => deal.companyId === formData.selectedCompany)
    : deals;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Create New Task</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          {/* Basic Task Info */}
          <TextField
            label="Task Title"
            value={formData.title}
            onChange={(e) => handleInputChange('title', e.target.value)}
            fullWidth
            required
          />

          <TextField
            label="Description"
            value={formData.description}
            onChange={(e) => handleInputChange('description', e.target.value)}
            multiline
            rows={3}
            fullWidth
          />

          {/* Task Type and Priority */}
          <Box sx={{ display: 'flex', gap: 2 }}>
            <FormControl fullWidth>
              <InputLabel>Task Type</InputLabel>
              <Select
                value={formData.type}
                onChange={(e) => handleInputChange('type', e.target.value)}
                label="Task Type"
              >
                <MenuItem value="email">Email</MenuItem>
                <MenuItem value="phone_call">Phone Call</MenuItem>
                <MenuItem value="in_person_drop_by">In-Person Drop-by</MenuItem>
                <MenuItem value="scheduled_meeting_in_person">Scheduled Meeting (In-Person)</MenuItem>
                <MenuItem value="scheduled_meeting_virtual">Scheduled Meeting (Virtual)</MenuItem>
                <MenuItem value="linkedin_message">LinkedIn Message</MenuItem>
                <MenuItem value="send_gift">Send Gift</MenuItem>
                <MenuItem value="research">Research</MenuItem>
                <MenuItem value="proposal_preparation">Proposal Preparation</MenuItem>
                <MenuItem value="contract_review">Contract Review</MenuItem>
                <MenuItem value="follow_up">Follow-up</MenuItem>
                <MenuItem value="check_in">Check-in</MenuItem>
                <MenuItem value="presentation">Presentation</MenuItem>
                <MenuItem value="demo">Demo</MenuItem>
                <MenuItem value="negotiation">Negotiation</MenuItem>
                <MenuItem value="closing">Closing</MenuItem>
                <MenuItem value="administrative">Administrative</MenuItem>
                <MenuItem value="custom">Custom</MenuItem>
              </Select>
            </FormControl>

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
                <MenuItem value="urgent">Urgent</MenuItem>
              </Select>
            </FormControl>
          </Box>

          {/* Scheduling */}
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
              label="Scheduled Date"
              type="date"
              value={formData.scheduledDate}
              onChange={(e) => handleInputChange('scheduledDate', e.target.value)}
              fullWidth
              InputLabelProps={{ shrink: true }}
            />

            <TextField
              label="Estimated Duration (minutes)"
              type="number"
              value={formData.estimatedDuration}
              onChange={(e) => handleInputChange('estimatedDuration', parseInt(e.target.value))}
              fullWidth
            />
          </Box>

          {/* CRM Associations */}
          <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
            CRM Associations
          </Typography>

          <Box sx={{ display: 'flex', gap: 2 }}>
            <FormControl fullWidth>
              <InputLabel>Company</InputLabel>
              <Select
                value={formData.selectedCompany}
                onChange={(e) => {
                  handleInputChange('selectedCompany', e.target.value);
                  // Clear dependent fields when company changes
                  handleInputChange('selectedContact', '');
                  handleInputChange('selectedDeal', '');
                  handleInputChange('selectedLocation', '');
                }}
                label="Company"
              >
                <MenuItem value="">None</MenuItem>
                {companies.map((company: any) => (
                  <MenuItem key={company.id} value={company.id}>
                    {company.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>Contact</InputLabel>
              <Select
                value={formData.selectedContact}
                onChange={(e) => handleInputChange('selectedContact', e.target.value)}
                label="Contact"
                disabled={!formData.selectedCompany}
              >
                <MenuItem value="">None</MenuItem>
                {filteredContacts.map((contact: any) => (
                  <MenuItem key={contact.id} value={contact.id}>
                    {contact.firstName} {contact.lastName}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          <Box sx={{ display: 'flex', gap: 2 }}>
            <FormControl fullWidth>
              <InputLabel>Deal</InputLabel>
              <Select
                value={formData.selectedDeal}
                onChange={(e) => handleInputChange('selectedDeal', e.target.value)}
                label="Deal"
                disabled={!formData.selectedCompany}
              >
                <MenuItem value="">None</MenuItem>
                {filteredDeals.map((deal: any) => (
                  <MenuItem key={deal.id} value={deal.id}>
                    {deal.title}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>Location</InputLabel>
              <Select
                value={formData.selectedLocation}
                onChange={(e) => handleInputChange('selectedLocation', e.target.value)}
                label="Location"
                disabled={!formData.selectedCompany}
              >
                <MenuItem value="">None</MenuItem>
                {formData.selectedCompany && companies.find((c: any) => c.id === formData.selectedCompany)?.locations?.map((location: any) => (
                  <MenuItem key={location.id} value={location.id}>
                    {location.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          <FormControl fullWidth>
            <InputLabel>Assigned To</InputLabel>
            <Select
              value={formData.selectedSalesperson}
              onChange={(e) => handleInputChange('selectedSalesperson', e.target.value)}
              label="Assigned To"
            >
              {salespeople.map((salesperson: any) => (
                <MenuItem key={salesperson.id} value={salesperson.id}>
                  {salesperson.firstName} {salesperson.lastName}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Communication Details for Email Tasks */}
          {formData.type === 'email' && (
            <>
              <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
                Email Details
              </Typography>
              
              <TextField
                label="Recipient Email"
                value={formData.recipient}
                onChange={(e) => handleInputChange('recipient', e.target.value)}
                fullWidth
                type="email"
              />

              <TextField
                label="Subject"
                value={formData.subject}
                onChange={(e) => handleInputChange('subject', e.target.value)}
                fullWidth
              />

              <TextField
                label="Draft Content"
                value={formData.draftContent}
                onChange={(e) => handleInputChange('draftContent', e.target.value)}
                multiline
                rows={4}
                fullWidth
                placeholder="Enter your email content here..."
              />
            </>
          )}

          {/* Quota Category */}
          <FormControl fullWidth>
            <InputLabel>Quota Category</InputLabel>
            <Select
              value={formData.category}
              onChange={(e) => handleInputChange('category', e.target.value)}
              label="Quota Category"
            >
              <MenuItem value="business_generating">Business Generating</MenuItem>
              <MenuItem value="relationship_building">Relationship Building</MenuItem>
              <MenuItem value="administrative">Administrative</MenuItem>
              <MenuItem value="research">Research</MenuItem>
            </Select>
          </FormControl>

          {/* Notes */}
          <TextField
            label="Notes"
            value={formData.notes}
            onChange={(e) => handleInputChange('notes', e.target.value)}
            multiline
            rows={3}
            fullWidth
            placeholder="Additional notes or context..."
          />

          {error && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {error}
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button 
          onClick={handleSubmit} 
          variant="contained" 
          disabled={loading || !formData.title.trim()}
        >
          {loading ? 'Creating...' : 'Create Task'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

// 📋 TASK DETAILS DIALOG COMPONENT
interface TaskDetailsDialogProps {
  open: boolean;
  task: CRMTask | null;
  onClose: () => void;
  onTaskUpdated: () => void;
  tenantId: string;
  salespersonId: string;
}

const TaskDetailsDialog: React.FC<TaskDetailsDialogProps> = ({ 
  open, 
  task, 
  onClose, 
  onTaskUpdated,
  tenantId,
  salespersonId
}) => {
  const [completionNotes, setCompletionNotes] = useState('');
  const [outcome, setOutcome] = useState<'positive' | 'neutral' | 'negative'>('neutral');

  const taskService = TaskService.getInstance();

  const handleComplete = async () => {
    if (!task) return;
    
    try {
      await taskService.completeTask(
        task.id, 
        { outcome: outcome, notes: completionNotes },
        tenantId,
        salespersonId
      );
      onTaskUpdated();
      onClose();
    } catch (error) {
      console.error('Error completing task:', error);
    }
  };

  if (!task) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Task Details: {task.title}
      </DialogTitle>
      <DialogContent>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <Typography variant="h6" gutterBottom>Task Information</Typography>
            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" color="textSecondary">Type</Typography>
              <Typography variant="body1">{task.type.replace('_', ' ')}</Typography>
            </Box>
            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" color="textSecondary">Status</Typography>
              <Typography variant="body1">{task.status}</Typography>
            </Box>
            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" color="textSecondary">Priority</Typography>
              <Typography variant="body1">{task.priority}</Typography>
            </Box>
            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" color="textSecondary">
                {task.classification === 'todo' ? 'Due Date' : 'Scheduled Date'}
              </Typography>
              <Typography variant="body1">
                {new Date((task.classification === 'todo' ? task.dueDate : task.scheduledDate) + 'T00:00:00').toLocaleDateString()}
              </Typography>
            </Box>
            {task.description && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" color="textSecondary">Description</Typography>
                <Typography variant="body1">{task.description}</Typography>
              </Box>
            )}
          </Grid>
          
          <Grid item xs={12} md={6}>
            <Typography variant="h6" gutterBottom>Completion</Typography>
            <TextField
              fullWidth
              multiline
              rows={4}
              label="Completion Notes"
              value={completionNotes}
              onChange={(e) => setCompletionNotes(e.target.value)}
              sx={{ mb: 2 }}
            />
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Outcome</InputLabel>
              <Select
                value={outcome}
                onChange={(e) => setOutcome(e.target.value as any)}
              >
                <MenuItem value="positive">Positive</MenuItem>
                <MenuItem value="neutral">Neutral</MenuItem>
                <MenuItem value="negative">Negative</MenuItem>
              </Select>
            </FormControl>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button onClick={handleComplete} variant="contained" color="success">
          Mark Complete
        </Button>
      </DialogActions>
    </Dialog>
  );
}; 
import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Button,
  Chip,
  IconButton,
  List,
  Alert,
  LinearProgress
} from '@mui/material';
import {
  Add as AddIcon,
  CheckCircle as CheckCircleIcon,
  Schedule as ScheduleIcon,
  Email as EmailIcon,
  Phone as PhoneIcon,
  Business as BusinessIcon,
  Psychology as PsychologyIcon,
  Refresh as RefreshIcon,
  Assignment as AssignmentIcon,
  TrendingUp as TrendingUpIcon
} from '@mui/icons-material';

import { useAuth } from '../contexts/AuthContext';
import { TaskService } from '../utils/taskService';
import { TaskStatus, TaskClassification } from '../types/Tasks';

import CreateTaskDialog from './CreateTaskDialog';
import CreateFollowUpCampaignDialog from './CreateFollowUpCampaignDialog';
import TaskDetailsDialog from './TaskDetailsDialog';

interface ContactTasksDashboardProps {
  contactId: string;
  tenantId: string;
  contact: any; // Contact information
}

interface TaskDashboardData {
  today: {
    totalTasks: number;
    completedTasks: number;
    pendingTasks: number;
    tasks: any[];
  };
  thisWeek: {
    totalTasks: number;
    completedTasks: number;
    pendingTasks: number;
    quotaProgress: {
      percentage: number;
      completed: number;
      target: number;
    };
    tasks: any[];
  };
  priorities: {
    high: number;
    medium: number;
    low: number;
  };
  types: {
    email: number;
    phone_call: number;
    scheduled_meeting_virtual: number;
    research: number;
    custom: number;
  };
}

const ContactTasksDashboard: React.FC<ContactTasksDashboardProps> = ({
  contactId,
  tenantId,
  contact
}) => {
  const { user } = useAuth();
  const [dashboardData, setDashboardData] = useState<TaskDashboardData | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showFollowUpDialog, setShowFollowUpDialog] = useState(false);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [activeTab, setActiveTab] = useState(0);

  const taskService = TaskService.getInstance();

  useEffect(() => {
    loadDashboardData();
  }, [contactId, tenantId]);

  const loadDashboardData = async () => {
    if (!user) return;

    setLoading(true);
    setError(null);

    try {
      // Load contact-specific tasks
      const dashboardResult = await taskService.getTaskDashboard(
        user.uid,
        new Date().toISOString(),
        tenantId,
        { contactId } // Filter by contact
      );

      // Load AI suggestions for this contact
      const suggestionsResult = await taskService.getAITaskSuggestions(
        user.uid,
        tenantId,
        { contactId }
      );

      setDashboardData(dashboardResult);
      setAiSuggestions(suggestionsResult || []);
    } catch (err) {
      console.error('Error loading contact tasks dashboard:', err);
      setError('Failed to load contact tasks');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTask = async (taskData: any) => {
    if (!user) return;

    try {
      // Pre-select the contact association
      const taskWithContact = {
        ...taskData,
        associations: {
          ...taskData.associations,
          contacts: [contactId]
        }
      };

      const result = await taskService.createTask(taskWithContact);
      
      if (result.success) {
        // Associate the assigned salesperson with the contact if not already associated
        const assignedSalespersonId = taskData.assignedTo;
        if (assignedSalespersonId && assignedSalespersonId !== user.uid) {
          try {
            // Import the simple association service
            const { createSimpleAssociationService } = await import('../utils/simpleAssociationService');
            const associationService = createSimpleAssociationService(tenantId, user.uid);
            
            // Add the salesperson association to the contact
            await associationService.addAssociation('contact', contactId, 'salesperson', assignedSalespersonId);
            console.log(`✅ Associated salesperson ${assignedSalespersonId} with contact ${contactId}`);
          } catch (associationError) {
            console.warn('Failed to associate salesperson with contact:', associationError);
            // Don't fail the task creation if association fails
          }
        }
        
        setShowCreateDialog(false);
        await loadDashboardData(); // Refresh data
      }
    } catch (err) {
      console.error('Error creating task:', err);
      setError('Failed to create task');
    }
  };

  const handleCreateFollowUpCampaign = async (campaignData: any) => {
    if (!user) return;
    try {
      const { followUpFrequency, campaignDuration, startDate, ...taskData } = campaignData;
      
      // Calculate all the task dates for 2 years
      const startDateTime = new Date(startDate);
      const tasks = [];
      const totalDays = campaignDuration;
      const frequency = parseInt(followUpFrequency);
      
      for (let day = 0; day <= totalDays; day += frequency) {
        const taskDate = new Date(startDateTime);
        taskDate.setDate(taskDate.getDate() + day);
        
        const task = {
          ...taskData,
          title: `${taskData.title} (${Math.floor(day / frequency) + 1})`,
          scheduledDate: taskDate.toISOString().split('T')[0],
          scheduledTime: taskData.scheduledTime,
          status: 'scheduled' as TaskStatus,
          associations: {
            contacts: [contactId],
            companies: contact?.companyId ? [contact.companyId] : [],
            deals: []
          },
          isFollowUpTask: true,
          followUpCampaignId: `${contactId}_${startDate}_${frequency}`,
          followUpSequence: Math.floor(day / frequency) + 1
        };
        
        tasks.push(task);
      }
      
      // Create all tasks
      for (const task of tasks) {
        await taskService.createTask(task);
      }
      
      // Associate the assigned salesperson with the contact if not already associated
      const assignedSalespersonId = campaignData.assignedTo;
      if (assignedSalespersonId && assignedSalespersonId !== user.uid) {
        try {
          // Import the simple association service
          const { createSimpleAssociationService } = await import('../utils/simpleAssociationService');
          const associationService = createSimpleAssociationService(tenantId, user.uid);
          
          // Add the salesperson association to the contact
          await associationService.addAssociation('contact', contactId, 'salesperson', assignedSalespersonId);
          console.log(`✅ Associated salesperson ${assignedSalespersonId} with contact ${contactId} for follow-up campaign`);
        } catch (associationError) {
          console.warn('Failed to associate salesperson with contact:', associationError);
          // Don't fail the campaign creation if association fails
        }
      }
      
      setShowFollowUpDialog(false);
      await loadDashboardData(); // Refresh data
      
      // Show success message
      setError(null);
      // You could add a success state here if needed
    } catch (err) {
      console.error('Error creating follow-up campaign:', err);
      setError('Failed to create follow-up campaign');
    }
  };

  const handleQuickComplete = async (taskId: string) => {
    if (!user) return;

    try {
      await taskService.quickCompleteTask(taskId, tenantId, user.uid);
      await loadDashboardData(); // Refresh data
    } catch (err) {
      console.error('Error completing task:', err);
      setError('Failed to complete task');
    }
  };

  const handleAcceptSuggestion = async (suggestion: any) => {
    if (!user) return;

    try {
      // Determine classification based on task type
      let classification: 'todo' | 'appointment' = 'todo';
      const appointmentTypes = ['scheduled_meeting_virtual', 'scheduled_meeting_in_person', 'demo', 'presentation'];
      if (appointmentTypes.includes(suggestion.type)) {
        classification = 'appointment';
      }

      const taskData = {
        title: suggestion.title,
        description: suggestion.description,
        type: suggestion.type,
        priority: suggestion.priority,
        status: 'upcoming' as TaskStatus,
        classification: classification as TaskClassification,
        ...(classification === 'appointment' ? { startTime: new Date().toISOString(), duration: 60 } : {}),
        scheduledDate: new Date().toISOString(),
        assignedTo: user.uid,
        createdBy: user.uid,
        tenantId,
        category: suggestion.category || 'follow_up',
        quotaCategory: suggestion.category || 'business_generating',
        associations: {
          contacts: [contactId],
          companies: contact?.companyId ? [contact.companyId] : [],
          deals: contact?.dealIds || []
        },
        aiSuggested: true,
        aiPrompt: suggestion.aiPrompt || '',
        tags: []
      };

      await taskService.createTask(taskData);
      await loadDashboardData(); // Refresh data
    } catch (err) {
      console.error('Error accepting suggestion:', err);
      setError('Failed to accept suggestion');
    }
  };

  const handleRejectSuggestion = async (suggestionId: string) => {
    try {
      await taskService.rejectAITaskSuggestion(suggestionId, tenantId, user?.uid || '');
      await loadDashboardData(); // Refresh data
    } catch (err) {
      console.error('Error rejecting suggestion:', err);
      setError('Failed to reject suggestion');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'success';
      case 'due': return 'warning';
      case 'upcoming': return 'info';
      case 'postponed': return 'default';
      case 'cancelled': return 'error';
      default: return 'default';
    }
  };

  const getTaskTypeIcon = (type: string) => {
    switch (type) {
      case 'email': return <EmailIcon />;
      case 'phone_call': return <PhoneIcon />;
      case 'scheduled_meeting_virtual': return <ScheduleIcon />;
      case 'research': return <PsychologyIcon />;
      case 'business': return <BusinessIcon />;
      default: return <AssignmentIcon />;
    }
  };

  const calculateUrgency = (task: any) => {
    const dueDate = new Date((task.dueDate || task.scheduledDate) + 'T00:00:00');
    const now = new Date();
    const diffHours = (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60);
    
    if (diffHours < 0) return 'overdue';
    if (diffHours < 24) return 'urgent';
    if (diffHours < 72) return 'soon';
    return 'normal';
  };

  if (loading) {
    return (
      <Box sx={{ p: 3 }}>
        <LinearProgress />
        <Typography variant="body2" sx={{ mt: 2 }}>
          Loading contact tasks...
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 0 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" component="h2">
          Contact Tasks - {contact?.fullName || contact?.firstName || 'Contact'}
        </Typography>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={() => setShowCreateDialog(true)}
          >
            Add Task
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setShowFollowUpDialog(true)}
          >
            Add Follow Up Campaign
          </Button>
        </Box>
      </Box>

      {/* Quick Stats */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Today&apos;s Tasks
              </Typography>
              <Typography variant="h4">
                {dashboardData?.today?.totalTasks || 0}
              </Typography>
              <Typography variant="body2" color="textSecondary">
                {dashboardData?.today?.completedTasks || 0} completed
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                This Week
              </Typography>
              <Typography variant="h4">
                {dashboardData?.thisWeek?.totalTasks || 0}
              </Typography>
              <Typography variant="body2" color="textSecondary">
                {dashboardData?.thisWeek?.completedTasks || 0} completed
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
                {dashboardData?.thisWeek?.quotaProgress?.percentage || 0}%
              </Typography>
              <LinearProgress 
                variant="determinate" 
                value={dashboardData?.thisWeek?.quotaProgress?.percentage || 0}
                sx={{ mt: 1 }}
              />
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                AI Suggestions
              </Typography>
              <Typography variant="h4">
                {aiSuggestions.length}
              </Typography>
              <Typography variant="body2" color="textSecondary">
                Available
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Breadcrumb-style subnavigation to match DealTasksDashboard */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Button
            variant="text"
            size="small"
            onClick={() => setActiveTab(0)}
            sx={{ 
              borderRadius: 0,
              px: 2,
              py: 1,
              minWidth: 'auto',
              textTransform: 'none',
              fontWeight: activeTab === 0 ? 'bold' : 'normal',
              textDecoration: activeTab === 0 ? 'underline' : 'none',
              color: activeTab === 0 ? 'primary.main' : 'text.secondary'
            }}
          >
            <AssignmentIcon fontSize="small" sx={{ mr: 0.5 }} />
            Today&apos;s Tasks
          </Button>
          <Typography variant="body2" color="text.secondary">/</Typography>
          <Button
            variant="text"
            size="small"
            onClick={() => setActiveTab(1)}
            sx={{ 
              borderRadius: 0,
              px: 2,
              py: 1,
              minWidth: 'auto',
              textTransform: 'none',
              fontWeight: activeTab === 1 ? 'bold' : 'normal',
              textDecoration: activeTab === 1 ? 'underline' : 'none',
              color: activeTab === 1 ? 'primary.main' : 'text.secondary'
            }}
          >
            <TrendingUpIcon fontSize="small" sx={{ mr: 0.5 }} />
            This Week
          </Button>
          <Typography variant="body2" color="text.secondary">/</Typography>
          <Button
            variant="text"
            size="small"
            onClick={() => setActiveTab(2)}
            sx={{ 
              borderRadius: 0,
              px: 2,
              py: 1,
              minWidth: 'auto',
              textTransform: 'none',
              fontWeight: activeTab === 2 ? 'bold' : 'normal',
              textDecoration: activeTab === 2 ? 'underline' : 'none',
              color: activeTab === 2 ? 'primary.main' : 'text.secondary'
            }}
          >
            <CheckCircleIcon fontSize="small" sx={{ mr: 0.5 }} />
            Completed
          </Button>
          <Typography variant="body2" color="text.secondary">/</Typography>
          <Button
            variant="text"
            size="small"
            onClick={() => setActiveTab(3)}
            sx={{ 
              borderRadius: 0,
              px: 2,
              py: 1,
              minWidth: 'auto',
              textTransform: 'none',
              fontWeight: activeTab === 3 ? 'bold' : 'normal',
              textDecoration: activeTab === 3 ? 'underline' : 'none',
              color: activeTab === 3 ? 'primary.main' : 'text.secondary'
            }}
          >
            <PsychologyIcon fontSize="small" sx={{ mr: 0.5 }} />
            AI Suggestions
          </Button>
          <Typography variant="body2" color="text.secondary">/</Typography>
          <Button
            variant="text"
            size="small"
            onClick={() => setShowCreateDialog(true)}
            sx={{ 
              borderRadius: 0,
              px: 2,
              py: 1,
              minWidth: 'auto',
              textTransform: 'none',
              fontWeight: 'normal'
            }}
          >
            <AddIcon fontSize="small" sx={{ mr: 0.5 }} />
            Add Task
          </Button>
          <Button
            variant="text"
            size="small"
            onClick={() => setShowFollowUpDialog(true)}
            sx={{ 
              borderRadius: 0,
              px: 2,
              py: 1,
              minWidth: 'auto',
              textTransform: 'none',
              fontWeight: 'normal'
            }}
          >
            <AddIcon fontSize="small" sx={{ mr: 0.5 }} />
            Add Campaign
          </Button>
        </Box>
      </Box>

      {/* Tab Content */}
      {activeTab === 0 && (
        <TasksList
          tasks={dashboardData?.today?.tasks || []}
          onTaskClick={(task) => {
            setSelectedTask(task);
            setShowDetailsDialog(true);
          }}
          onQuickComplete={handleQuickComplete}
          getStatusColor={getStatusColor}
          getTaskTypeIcon={getTaskTypeIcon}
          calculateUrgency={calculateUrgency}
        />
      )}

      {activeTab === 1 && (
        <TasksList
          tasks={dashboardData?.thisWeek?.tasks || []}
          onTaskClick={(task) => {
            setSelectedTask(task);
            setShowDetailsDialog(true);
          }}
          onQuickComplete={handleQuickComplete}
          getStatusColor={getStatusColor}
          getTaskTypeIcon={getTaskTypeIcon}
          calculateUrgency={calculateUrgency}
        />
      )}

      {activeTab === 2 && (
        <TasksList
          tasks={(() => {
            const today = dashboardData?.today?.tasks || [];
            const week = dashboardData?.thisWeek?.tasks || [];
            const combined = [...today, ...week];
            return combined.filter((t: any) => t.status === 'completed');
          })()}
          onTaskClick={(task) => {
            setSelectedTask(task);
            setShowDetailsDialog(true);
          }}
          onQuickComplete={handleQuickComplete}
          getStatusColor={getStatusColor}
          getTaskTypeIcon={getTaskTypeIcon}
          calculateUrgency={calculateUrgency}
        />
      )}

      {activeTab === 3 && (
        <AISuggestionsList
          suggestions={aiSuggestions}
          onAccept={handleAcceptSuggestion}
          onReject={handleRejectSuggestion}
          getPriorityColor={getStatusColor}
          getTaskIcon={getTaskTypeIcon}
        />
      )}

      {/* Dialogs */}
      {showCreateDialog && (
        <CreateTaskDialog
          open={showCreateDialog}
          onClose={() => setShowCreateDialog(false)}
          onSubmit={handleCreateTask}
        />
      )}

      {showFollowUpDialog && (
        <CreateFollowUpCampaignDialog
          open={showFollowUpDialog}
          onClose={() => setShowFollowUpDialog(false)}
          onSubmit={handleCreateFollowUpCampaign}
          salespersonId={user?.uid || ''}
          tenantId={tenantId}
          contactId={contactId}
          contactCompanyId={contact?.companyId}
          hideAssociations={true}
        />
      )}

      {showDetailsDialog && selectedTask && (
        <TaskDetailsDialog
          open={showDetailsDialog}
          task={selectedTask}
          onClose={() => {
            setShowDetailsDialog(false);
            setSelectedTask(null);
          }}
          onTaskUpdated={async (taskId: string) => {
            await loadDashboardData();
            setShowDetailsDialog(false);
            setSelectedTask(null);
          }}
          salespersonId={user?.uid || ''}
          tenantId={tenantId}
        />
      )}
    </Box>
  );
};

// Helper Components
interface TasksListProps {
  tasks: any[];
  onTaskClick: (task: any) => void;
  onQuickComplete: (taskId: string) => void;
  getStatusColor: (status: string) => string;
  getTaskTypeIcon: (type: string) => React.ReactNode;
  calculateUrgency: (task: any) => string;
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
      <Card>
        <CardContent>
          <Typography variant="body1" color="textSecondary" align="center">
            No tasks for this period
          </Typography>
        </CardContent>
      </Card>
    );
  }

  return (
    <List>
      {tasks.map((task) => (
        <Card key={task.id} sx={{ mb: 2 }}>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Box sx={{ flex: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                  {getTaskTypeIcon(task.type)}
                  <Typography variant="h6" sx={{ ml: 1, flex: 1 }}>
                    {task.title}
                  </Typography>
                  <Chip
                    label={task.status}
                    color={getStatusColor(task.status) as any}
                    size="small"
                    sx={{ mr: 1 }}
                  />
                  <Chip
                    label={task.priority}
                    color={task.priority === 'high' ? 'error' : task.priority === 'medium' ? 'warning' : 'default'}
                    size="small"
                  />
                </Box>
                <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                  {task.description}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="caption" color="textSecondary">
                    {new Date((task.classification === 'todo' ? task.dueDate : task.scheduledDate) + 'T00:00:00').toLocaleDateString()}
                  </Typography>
                  {task.estimatedDuration && (
                    <Typography variant="caption" color="textSecondary">
                      • {task.estimatedDuration} min
                    </Typography>
                  )}
                  {task.aiSuggested && (
                    <Chip
                      label="AI Suggested"
                      size="small"
                      color="info"
                      icon={<PsychologyIcon />}
                    />
                  )}
                </Box>
              </Box>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <IconButton
                  size="small"
                  onClick={() => onTaskClick(task)}
                >
                  <AssignmentIcon />
                </IconButton>
                {task.status !== 'completed' && (
                  <IconButton
                    size="small"
                    color="success"
                    onClick={() => onQuickComplete(task.id)}
                  >
                    <CheckCircleIcon />
                  </IconButton>
                )}
              </Box>
            </Box>
          </CardContent>
        </Card>
      ))}
    </List>
  );
};

interface AISuggestionsListProps {
  suggestions: any[];
  onAccept: (suggestion: any) => void;
  onReject: (suggestionId: string) => void;
  getPriorityColor: (priority: string) => string;
  getTaskIcon: (type: string) => React.ReactNode;
}

const AISuggestionsList: React.FC<AISuggestionsListProps> = ({
  suggestions,
  onAccept,
  onReject,
  getPriorityColor,
  getTaskIcon
}) => {
  if (suggestions.length === 0) {
    return (
      <Card>
        <CardContent>
          <Typography variant="body1" color="textSecondary" align="center">
            No AI suggestions available
          </Typography>
        </CardContent>
      </Card>
    );
  }

  return (
    <List>
      {suggestions.map((suggestion, index) => (
        <Card key={index} sx={{ mb: 2 }}>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Box sx={{ flex: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                  {getTaskIcon(suggestion.type)}
                  <Typography variant="h6" sx={{ ml: 1, flex: 1 }}>
                    {suggestion.title}
                  </Typography>
                  <Chip
                    label={suggestion.priority}
                    color={getPriorityColor(suggestion.priority) as any}
                    size="small"
                  />
                </Box>
                <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                  {suggestion.description}
                </Typography>
                {suggestion.aiReason && (
                  <Typography variant="caption" color="info.main">
                    AI Reason: {suggestion.aiReason}
                  </Typography>
                )}
              </Box>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <IconButton
                  size="small"
                  color="success"
                  onClick={() => onAccept(suggestion)}
                >
                  <AddIcon />
                </IconButton>
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => onReject(suggestion.id || index.toString())}
                >
                  <RefreshIcon />
                </IconButton>
              </Box>
            </Box>
          </CardContent>
        </Card>
      ))}
    </List>
  );
};

// interface TasksAnalyticsProps {
//   dashboardData: TaskDashboardData | null;
// }
// const TasksAnalytics: React.FC<TasksAnalyticsProps> = ({ dashboardData }) => {
//   return null;
// };

export default ContactTasksDashboard; 
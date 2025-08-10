import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Chip,
  List,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField
} from '@mui/material';
import {
  Add as AddIcon,
  CheckCircle as CheckCircleIcon,
  TrendingUp as TrendingUpIcon,
  Psychology as PsychologyIcon,
  Assignment as AssignmentIcon
} from '@mui/icons-material';

import { useAuth } from '../contexts/AuthContext';
import { TaskService } from '../utils/taskService';
import { TaskClassification } from '../types/Tasks';

import CreateTaskDialog from './CreateTaskDialog';
import TaskDetailsDialog from './TaskDetailsDialog';
import TaskCard from './TaskCard';

interface UserTasksDashboardProps {
  tenantId: string;
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
  completed: {
    totalTasks: number;
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

const UserTasksDashboard: React.FC<UserTasksDashboardProps> = ({
  tenantId
}) => {
  const { user } = useAuth();
  const [dashboardData, setDashboardData] = useState<TaskDashboardData | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [prefilledTaskData, setPrefilledTaskData] = useState<any>(null);
  const [activeTab, setActiveTab] = useState(0);
  const [showCompletionDialog, setShowCompletionDialog] = useState(false);
  const [completionTaskId, setCompletionTaskId] = useState<string | null>(null);
  const [completionNotes, setCompletionNotes] = useState('');

  const taskService = TaskService.getInstance();

  useEffect(() => {
    loadDashboardData();
  }, [tenantId]);

  const loadDashboardData = async () => {
    if (!user) return;

    setLoading(true);
    setError(null);

    try {
      // Load task dashboard for the current user
      const dashboardResult = await taskService.getTaskDashboard(
        user.uid,
        new Date().toISOString(),
        tenantId
      );

      console.log('Debug: Dashboard result:', dashboardResult);
      setDashboardData(dashboardResult);

      // Load AI suggestions for the current user
      const suggestionsResult = await taskService.getAITaskSuggestions(
        user.uid,
        tenantId
      );

      setAiSuggestions(suggestionsResult || []);
    } catch (err) {
      console.error('Error loading user tasks dashboard:', err);
      setError('Failed to load tasks');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTask = async (taskData: any) => {
    if (!user) return;

    try {
      await taskService.createTask({
        ...taskData,
        assignedTo: user.uid,
        tenantId: tenantId
      });
      
      await loadDashboardData(); // Refresh data
      setShowCreateDialog(false);
    } catch (err) {
      console.error('Error creating task:', err);
      setError('Failed to create task');
    }
  };

  const handleQuickComplete = async (taskId: string) => {
    setCompletionTaskId(taskId);
    setCompletionNotes('');
    setShowCompletionDialog(true);
  };

  const handleConfirmQuickComplete = async () => {
    if (!user || !completionTaskId) return;

    try {
      await taskService.completeTask(completionTaskId, { 
        outcome: 'positive', 
        notes: completionNotes || 'Task completed'
      }, tenantId, user.uid);
      await loadDashboardData(); // Refresh data
      setShowCompletionDialog(false);
      setCompletionTaskId(null);
      setCompletionNotes('');
    } catch (err) {
      console.error('Error completing task:', err);
      setError('Failed to complete task');
    }
  };

  const handleAcceptSuggestion = (suggestion: any) => {
    // Determine classification based on task type
    let classification: 'todo' | 'appointment' = 'todo';
    const appointmentTypes = ['scheduled_meeting_virtual', 'scheduled_meeting_in_person', 'demo', 'presentation'];
    if (appointmentTypes.includes(suggestion.type)) {
      classification = 'appointment';
    }

    // Pre-fill the task data with AI suggestion
    const prefilledData = {
      title: suggestion.title,
      description: suggestion.description,
      type: suggestion.type || 'custom',
      priority: suggestion.priority || 'medium',
      status: 'upcoming',
      classification: classification as TaskClassification,
      startTime: classification === 'appointment' ? new Date().toISOString() : null,
      duration: classification === 'appointment' ? 60 : null,
      scheduledDate: new Date().toISOString().split('T')[0],
      scheduledTime: '09:00',
      dueDate: '',
      dueTime: '',
      estimatedDuration: 30,
      assignedTo: user?.uid || '',
      category: suggestion.category || 'follow_up',
      quotaCategory: suggestion.category || 'business_generating',
      selectedCompany: '',
      selectedContact: '',
      selectedDeal: '',
      selectedSalesperson: user?.uid || '',
      recipient: '',
      subject: '',
      draftContent: '',
      notes: suggestion.aiReason || '',
      tags: [],
      aiSuggested: true,
      aiPrompt: suggestion.aiPrompt || ''
    };
    
    setPrefilledTaskData(prefilledData);
    setShowCreateDialog(true);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'success';
      case 'due': return 'warning';
      case 'overdue': return 'error';
      case 'upcoming': return 'info';
      case 'postponed': return 'default';
      case 'cancelled': return 'error';
      default: return 'default';
    }
  };

  const getTaskStatusDisplay = (task: any) => {
    if (task.status === 'completed') return 'completed';
    
    // Use dueDate for todos, scheduledDate for appointments
    const dateToUse = task.classification === 'todo' ? task.dueDate : task.scheduledDate;
    // Ensure the date is interpreted as local time by appending a time component
    const scheduledDate = new Date(dateToUse + 'T00:00:00');
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const scheduledDay = new Date(scheduledDate.getFullYear(), scheduledDate.getMonth(), scheduledDate.getDate());
    
    if (scheduledDay < today) return 'overdue';
    if (scheduledDay.getTime() === today.getTime()) return 'due';
    return 'upcoming';
  };

  const getTaskTypeIcon = (type: string) => {
    switch (type) {
      case 'email': return <AssignmentIcon />;
      case 'phone_call': return <AssignmentIcon />;
      case 'scheduled_meeting_virtual': return <AssignmentIcon />;
      case 'research': return <AssignmentIcon />;
      case 'business': return <AssignmentIcon />;
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
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box p={3}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 0 }}>
      {/* Breadcrumb Style Navigation */}
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
          getTaskStatusDisplay={getTaskStatusDisplay}
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
          getTaskStatusDisplay={getTaskStatusDisplay}
        />
      )}

      {activeTab === 2 && (
        <TasksList
          tasks={dashboardData?.completed?.tasks || []}
          onTaskClick={(task) => {
            setSelectedTask(task);
            setShowDetailsDialog(true);
          }}
          onQuickComplete={handleQuickComplete}
          getStatusColor={getStatusColor}
          getTaskTypeIcon={getTaskTypeIcon}
          calculateUrgency={calculateUrgency}
          getTaskStatusDisplay={getTaskStatusDisplay}
        />
      )}

      {activeTab === 3 && (
        <Box>
          <AISuggestionsList
            suggestions={aiSuggestions}
            onAccept={handleAcceptSuggestion}
            getPriorityColor={(priority) => {
              switch (priority) {
                case 'high': return 'error';
                case 'medium': return 'warning';
                case 'low': return 'default';
                default: return 'default';
              }
            }}
            getTaskIcon={getTaskTypeIcon}
          />
        </Box>
      )}

      {/* Dialogs */}
      {showCreateDialog && (
        <CreateTaskDialog
          open={showCreateDialog}
          onClose={() => {
            setShowCreateDialog(false);
            setPrefilledTaskData(null); // Clear pre-filled data when closing
          }}
          onSubmit={handleCreateTask}
          prefilledData={prefilledTaskData}
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

      {/* Completion Dialog */}
      <Dialog open={showCompletionDialog} onClose={() => setShowCompletionDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Complete Task</DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ mb: 2 }}>
            Please provide completion notes for this task:
          </Typography>
          <TextField
            fullWidth
            label="Completion Notes"
            value={completionNotes}
            onChange={(e) => setCompletionNotes(e.target.value)}
            multiline
            rows={4}
            placeholder="Describe what was accomplished, any outcomes, or important details..."
            helperText="These notes will be saved with the task completion"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowCompletionDialog(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleConfirmQuickComplete} 
            variant="contained"
            color="success"
          >
            Complete Task
          </Button>
        </DialogActions>
      </Dialog>
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
  getTaskStatusDisplay: (task: any) => string;
}

const TasksList: React.FC<TasksListProps> = ({
  tasks,
  onTaskClick,
  onQuickComplete,
  getStatusColor,
  getTaskTypeIcon,
  calculateUrgency,
  getTaskStatusDisplay
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
    <Box>
      {tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          onTaskClick={onTaskClick}
          onQuickComplete={onQuickComplete}
          getStatusColor={getStatusColor}
          getTaskStatusDisplay={getTaskStatusDisplay}
          // Show company and deal information for main tasks view
          showCompany={true}
          showDeal={true}
          showContacts={false}
        />
      ))}
    </Box>
  );
};

interface AISuggestionsListProps {
  suggestions: any[];
  onAccept: (suggestion: any) => void;
  getPriorityColor: (priority: string) => string;
  getTaskIcon: (type: string) => React.ReactNode;
}

const AISuggestionsList: React.FC<AISuggestionsListProps> = ({
  suggestions,
  onAccept,
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
                <Button
                  size="small"
                  variant="contained"
                  color="success"
                  onClick={() => onAccept(suggestion)}
                >
                  Accept
                </Button>
              </Box>
            </Box>
          </CardContent>
        </Card>
      ))}
    </List>
  );
};

export default UserTasksDashboard; 
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
import TaskCard from './TaskCard';

interface TasksDashboardProps {
  entityId: string;
  entityType: 'contact' | 'deal' | 'salesperson';
  tenantId: string;
  entity: any; // Contact, Deal, or Salesperson information
  // Pre-loaded associations to prevent duplicate calls
  preloadedContacts?: any[];
  preloadedSalespeople?: any[];
  preloadedCompany?: any;
  onAddTask?: () => void;
}

interface AISuggestionsListProps {
  suggestions: any[];
  onAccept: (suggestion: any) => void;
  onReject: (suggestionId: string) => void;
  showEmptyState: boolean;
  emptyStateMessage: string;
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

const TasksDashboard: React.FC<TasksDashboardProps> = ({
  entityId,
  entityType,
  tenantId,
  entity,
  preloadedContacts,
  preloadedSalespeople,
  preloadedCompany,
  onAddTask
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
  const [associatedContacts, setAssociatedContacts] = useState<any[]>([]);
  const [associatedSalespeople, setAssociatedSalespeople] = useState<any[]>([]);
  const [associatedCompany, setAssociatedCompany] = useState<any>(null);

  // Load dashboard data
  const loadDashboardData = async () => {
    if (!entityId || !tenantId || !user?.uid) return;
    
    setLoading(true);
    try {
      const taskService = TaskService.getInstance();
      
      // Subscribe to tasks for this entity
      const filter = entityType === 'contact' 
        ? { contactId: entityId }
        : entityType === 'deal'
        ? { dealId: entityId }
        : { assignedTo: entityId };
      
      const unsubscribe = taskService.subscribeToTasks(
        user.uid,
        tenantId,
        filter,
        (tasks) => {
          // Process tasks into dashboard data
          const today = new Date();
          const todayTasks = tasks.filter(task => {
            const taskDate = task.dueDate ? new Date(task.dueDate) : null;
            return taskDate && taskDate.toDateString() === today.toDateString();
          });
          
          const thisWeekTasks = tasks.filter(task => {
            const taskDate = task.dueDate ? new Date(task.dueDate) : null;
            if (!taskDate) return false;
            const weekStart = new Date(today);
            weekStart.setDate(today.getDate() - today.getDay());
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            return taskDate >= weekStart && taskDate <= weekEnd;
          });
          
          const completedTasks = tasks.filter(task => task.status === 'completed');
          
          const dashboardData: TaskDashboardData = {
            today: {
              totalTasks: todayTasks.length,
              completedTasks: todayTasks.filter(t => t.status === 'completed').length,
              pendingTasks: todayTasks.filter(t => t.status !== 'completed').length,
              tasks: todayTasks
            },
            thisWeek: {
              totalTasks: thisWeekTasks.length,
              completedTasks: thisWeekTasks.filter(t => t.status === 'completed').length,
              pendingTasks: thisWeekTasks.filter(t => t.status !== 'completed').length,
              quotaProgress: {
                percentage: thisWeekTasks.length > 0 ? (thisWeekTasks.filter(t => t.status === 'completed').length / thisWeekTasks.length) * 100 : 0,
                completed: thisWeekTasks.filter(t => t.status === 'completed').length,
                target: thisWeekTasks.length
              },
              tasks: thisWeekTasks
            },
            completed: {
              totalTasks: completedTasks.length,
              tasks: completedTasks
            },
            priorities: {
              high: tasks.filter(t => t.priority === 'high').length,
              medium: tasks.filter(t => t.priority === 'medium').length,
              low: tasks.filter(t => t.priority === 'low').length
            },
            types: {
              email: tasks.filter(t => t.type === 'email').length,
              phone_call: tasks.filter(t => t.type === 'phone_call').length,
              scheduled_meeting_virtual: tasks.filter(t => t.type === 'scheduled_meeting_virtual').length,
              research: tasks.filter(t => t.type === 'research').length,
              custom: tasks.filter(t => t.type === 'custom').length
            }
          };
          
          setDashboardData(dashboardData);
          setLoading(false);
        }
      );
      
      return unsubscribe;
    } catch (err) {
      console.error('Error loading dashboard data:', err);
      setError('Failed to load dashboard data');
      setLoading(false);
    }
  };

  // Load associations
  const loadAssociations = async () => {
    if (preloadedContacts || preloadedSalespeople || preloadedCompany) {
      if (preloadedContacts) setAssociatedContacts(preloadedContacts);
      if (preloadedSalespeople) setAssociatedSalespeople(preloadedSalespeople);
      if (preloadedCompany) setAssociatedCompany(preloadedCompany);
    }
  };

  useEffect(() => {
    loadDashboardData();
    loadAssociations();
  }, [entityId, tenantId, preloadedContacts, preloadedSalespeople, preloadedCompany]);

  // Handle task creation
  const handleCreateTask = async (taskData: any) => {
    try {
      const taskService = TaskService.getInstance();
      await taskService.createTask({
        ...taskData,
        tenantId,
        createdBy: user?.uid || '',
        associations: {
          ...taskData.associations,
          [entityType === 'contact' ? 'contacts' : entityType === 'deal' ? 'deals' : 'salespeople']: [entityId]
        }
      });
      setShowCreateDialog(false);
    } catch (error) {
      console.error('Error creating task:', error);
    }
  };

  // Handle task editing
  const handleEditTask = (task: any) => {
    setSelectedTask(task);
    setShowDetailsDialog(true);
  };

  // Handle task completion
  const handleQuickComplete = async (taskId: string) => {
    try {
      const taskService = TaskService.getInstance();
      await taskService.quickCompleteTask(taskId, tenantId, user?.uid || '');
    } catch (error) {
      console.error('Error completing task:', error);
    }
  };

  // Handle task click
  const handleTaskClick = (task: any) => {
    setSelectedTask(task);
    setShowDetailsDialog(true);
  };

  // Get status color
  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'completed': return 'success';
      case 'overdue': return 'error';
      case 'due': return 'warning';
      case 'pending': return 'info';
      case 'scheduled': return 'primary';
      default: return 'default';
    }
  };

  // Get task status display
  const getTaskStatusDisplay = (task: any) => {
    if (task.status === 'completed') return 'completed';
    if (task.status === 'overdue') return 'overdue';
    if (task.status === 'due') return 'due';
    if (task.status === 'scheduled') return 'scheduled';
    return 'pending';
  };

  if (loading) {
    return (
      <Box sx={{ p: 2 }}>
        <LinearProgress />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Loading tasks...
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error" action={
          <Button color="inherit" size="small" onClick={loadDashboardData}>
            Retry
          </Button>
        }>
          {error}
        </Alert>
      </Box>
    );
  }

  if (!dashboardData) {
    return (
      <Box sx={{ p: 2, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          No task data available
        </Typography>
      </Box>
    );
  }

  // TasksList component for rendering task lists
  interface TasksListProps {
    tasks: any[];
    emptyStateMessage: string;
    preloadedContacts?: any[];
    preloadedSalespeople?: any[];
    preloadedCompany?: any;
  }

  const TasksList: React.FC<TasksListProps> = ({
    tasks,
    emptyStateMessage,
    preloadedContacts,
    preloadedSalespeople,
    preloadedCompany
  }) => {
    if (tasks.length === 0) {
      return (
        <Box sx={{ p: 2, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            {emptyStateMessage}
          </Typography>
        </Box>
      );
    }

    return (
      <Box>
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            onTaskClick={handleTaskClick}
            onQuickComplete={handleQuickComplete}
            onEditTask={handleEditTask}
            getStatusColor={getStatusColor}
            getTaskStatusDisplay={getTaskStatusDisplay}
            showCompany={entityType === 'contact'}
            showDeal={entityType === 'deal'}
            showContacts={true}
            deal={entityType === 'deal' ? entity : undefined}
            company={preloadedCompany}
            contacts={preloadedContacts || []}
            salespeople={preloadedSalespeople || []}
            variant="default"
          />
        ))}
      </Box>
    );
  };

  return (
    <Box>
      {/* Combined Task List - Active tasks first, then completed tasks */}
      {activeTab === 0 && (
        <TasksList
          tasks={[
            ...(dashboardData?.today?.tasks || []),
            ...(dashboardData?.completed?.tasks || [])
          ]}
          emptyStateMessage={`No tasks for this ${entityType}`}
          preloadedContacts={preloadedContacts}
          preloadedSalespeople={preloadedSalespeople}
          preloadedCompany={preloadedCompany}
        />
      )}
      {activeTab === 1 && (
        <TasksList
          tasks={[
            ...(dashboardData?.thisWeek?.tasks || []),
            ...(dashboardData?.completed?.tasks || [])
          ]}
          emptyStateMessage="No tasks for this period"
          preloadedContacts={preloadedContacts}
          preloadedSalespeople={preloadedSalespeople}
          preloadedCompany={preloadedCompany}
        />
      )}
      {activeTab === 2 && (
        <TasksList
          tasks={dashboardData?.completed?.tasks || []}
          emptyStateMessage="No completed tasks"
          preloadedContacts={preloadedContacts}
          preloadedSalespeople={preloadedSalespeople}
          preloadedCompany={preloadedCompany}
        />
      )}

      {/* Create Task Dialog */}
      {showCreateDialog && (
        <CreateTaskDialog
          open={showCreateDialog}
          onClose={() => setShowCreateDialog(false)}
          onSubmit={handleCreateTask}
          prefilledData={{
            associations: {
              [entityType === 'contact' ? 'contacts' : 'deals']: [entityId],
              companies: preloadedCompany ? [preloadedCompany.id] : [],
              salespeople: user?.uid ? [user.uid] : []
            }
          }}
          contacts={preloadedContacts || []}
          salespeople={preloadedSalespeople || []}
          currentUserId={user?.uid || ''}
        />
      )}

      {/* Task Details Dialog */}
      {showDetailsDialog && selectedTask && (
        <TaskDetailsDialog
          open={showDetailsDialog}
          onClose={() => {
            setShowDetailsDialog(false);
            setSelectedTask(null);
          }}
          task={selectedTask}
          onTaskUpdated={async (taskId: string) => {
            // Refresh dashboard data after update
            await loadDashboardData();
            setShowDetailsDialog(false);
            setSelectedTask(null);
          }}
          salespersonId={selectedTask.assignedTo || user?.uid || ''}
          tenantId={tenantId}
        />
      )}
    </Box>
  );
};

export default TasksDashboard; 
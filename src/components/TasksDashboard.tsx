import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  preloadedDeals?: any[];
  preloadedCompanies?: any[];
  onAddTask?: () => void;
  showOnlyTodos?: boolean;
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
  mainDashboardTasks: any[]; // All non-completed tasks for main dashboard
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
  preloadedDeals,
  preloadedCompanies,
  onAddTask,
  showOnlyTodos = false
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
  const subscriptionRef = useRef<(() => void) | null>(null);

  // Load dashboard data
  const loadDashboardData = useCallback(async () => {
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
      
      // Clean up any existing subscription
      if (subscriptionRef.current) {
        subscriptionRef.current();
      }
      
      const unsubscribe = taskService.subscribeToTasks(
        user.uid,
        tenantId,
        filter,
        (tasks) => {
          const baseTasks = showOnlyTodos
            ? tasks.filter(t => (t.classification || '').toLowerCase() === 'todo')
            : tasks;
          if (process.env.NODE_ENV === 'development') {
            console.log('🔍 TasksDashboard: Received tasks from service:', tasks);
            console.log('🔍 TasksDashboard: Visible (after filter) tasks:', baseTasks);
            console.log('🔍 TasksDashboard: Current user:', user.uid);
          }
          
          // Process tasks into dashboard data
          const today = new Date();
          const todayTasks = baseTasks.filter(task => {
            const dateStr = task.dueDate || task.scheduledDate;
            const taskDate = dateStr ? new Date(dateStr) : null;
            return taskDate && taskDate.toDateString() === today.toDateString();
          });
          
          const thisWeekTasks = baseTasks.filter(task => {
            const dateStr = task.dueDate || task.scheduledDate;
            const taskDate = dateStr ? new Date(dateStr) : null;
            if (!taskDate) return false;
            const weekStart = new Date(today);
            weekStart.setDate(today.getDate() - today.getDay());
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            return taskDate >= weekStart && taskDate <= weekEnd;
          });
          
          const completedTasks = baseTasks.filter(task => task.status === 'completed');
          
          // Show all tasks in the main list, not just those due today
          const allTasks = baseTasks.filter(task => task.status !== 'completed');
          
          // Add overdue tasks to today's tasks
          const overdueTasks = baseTasks.filter(task => task.status === 'overdue');
          const todayTasksWithOverdue = [...todayTasks, ...overdueTasks];
          
          // For the main dashboard, show a focused view: overdue, today, tomorrow, and this week
          const dashboardOverdueTasks = baseTasks.filter(task => task.status === 'overdue');
          
          const dashboardToday = new Date();
          const dashboardTomorrow = new Date(dashboardToday);
          dashboardTomorrow.setDate(dashboardToday.getDate() + 1);
          
          const dashboardTodayTasks = baseTasks.filter(task => {
            if (task.status === 'completed') return false;
            const dateStr = task.dueDate || task.scheduledDate;
            const taskDate = dateStr ? new Date(dateStr) : null;
            return taskDate && taskDate.toDateString() === dashboardToday.toDateString();
          });
          
          const dashboardTomorrowTasks = baseTasks.filter(task => {
            if (task.status === 'completed') return false;
            const dateStr = task.dueDate || task.scheduledDate;
            const taskDate = dateStr ? new Date(dateStr) : null;
            return taskDate && taskDate.toDateString() === dashboardTomorrow.toDateString();
          });
          
          // Get tasks for the next 7 days (excluding today and tomorrow which are handled above)
          const dashboardNextWeekTasks = baseTasks.filter(task => {
            if (task.status === 'completed') return false;
            const dateStr = task.dueDate || task.scheduledDate;
            const taskDate = dateStr ? new Date(dateStr) : null;
            if (!taskDate) return false;
            
            const weekStart = new Date(dashboardToday);
            weekStart.setDate(dashboardToday.getDate() + 2); // Start from day after tomorrow
            const weekEnd = new Date(dashboardToday);
            weekEnd.setDate(dashboardToday.getDate() + 8); // Next 7 days
            
            return taskDate >= weekStart && taskDate <= weekEnd;
          });
          
          // Combine all relevant tasks: overdue first, then today, tomorrow, next week
          // Use a Map to ensure unique tasks by ID
          const uniqueTasksMap = new Map();
          
          // Add tasks in priority order (overdue first, then today, etc.)
          const allTaskArrays = [
            dashboardOverdueTasks,
            dashboardTodayTasks,
            dashboardTomorrowTasks,
            dashboardNextWeekTasks
          ];
          
          allTaskArrays.forEach(taskArray => {
            taskArray.forEach(task => {
              uniqueTasksMap.set(task.id, task);
            });
          });
          
          let mainDashboardTasks = Array.from(uniqueTasksMap.values());

          // If To-Dos widget requests all todos, override with all open todos (no time window)
          if (showOnlyTodos) {
            const openTodos = baseTasks.filter(t => (t.classification || '').toLowerCase() === 'todo' && t.status !== 'completed');
            mainDashboardTasks = openTodos.sort((a, b) => {
              const aDateStr = a.dueDate || a.scheduledDate || '';
              const bDateStr = b.dueDate || b.scheduledDate || '';
              const aDate = aDateStr ? new Date(aDateStr + (aDateStr.length === 10 ? 'T00:00:00' : '')).getTime() : 0;
              const bDate = bDateStr ? new Date(bDateStr + (bDateStr.length === 10 ? 'T00:00:00' : '')).getTime() : 0;
              return aDate - bDate;
            });
          }
          
          console.log('🔍 TasksDashboard: Filtered tasks:', {
            totalTasks: tasks.length,
            mainDashboardTasks: mainDashboardTasks.length,
            breakdown: {
              overdue: dashboardOverdueTasks.length,
              today: dashboardTodayTasks.length,
              tomorrow: dashboardTomorrowTasks.length,
              nextWeek: dashboardNextWeekTasks.length
            },
            mainDashboardTasksDetails: mainDashboardTasks.map(t => ({
              id: t.id,
              title: t.title,
              status: t.status,
              dueDate: t.dueDate,
              assignedTo: t.assignedTo
            }))
          });
          
          const dashboardData: TaskDashboardData = {
            today: {
              totalTasks: todayTasksWithOverdue.length,
              completedTasks: todayTasksWithOverdue.filter(t => t.status === 'completed').length,
              pendingTasks: todayTasksWithOverdue.filter(t => t.status !== 'completed').length,
              tasks: todayTasksWithOverdue
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
            mainDashboardTasks: mainDashboardTasks,
            priorities: {
              high: baseTasks.filter(t => t.priority === 'high').length,
              medium: baseTasks.filter(t => t.priority === 'medium').length,
              low: baseTasks.filter(t => t.priority === 'low').length
            },
            types: {
              email: baseTasks.filter(t => t.type === 'email').length,
              phone_call: baseTasks.filter(t => t.type === 'phone_call').length,
              scheduled_meeting_virtual: baseTasks.filter(t => t.type === 'scheduled_meeting_virtual').length,
              research: baseTasks.filter(t => t.type === 'research').length,
              custom: baseTasks.filter(t => t.type === 'custom').length
            }
          };
          
          setDashboardData(dashboardData);
          setLoading(false);
        }
      );
      
      // Store the unsubscribe function in the ref
      subscriptionRef.current = unsubscribe;
      
      return unsubscribe;
    } catch (err) {
      console.error('Error loading dashboard data:', err);
      setError('Failed to load dashboard data');
      setLoading(false);
    }
  }, [entityId, tenantId, user?.uid || '', entityType]);

  // Load associations
  const loadAssociations = useCallback(async () => {
    if (preloadedContacts || preloadedSalespeople || preloadedCompany) {
      if (preloadedContacts) setAssociatedContacts(preloadedContacts);
      if (preloadedSalespeople) setAssociatedSalespeople(preloadedSalespeople);
      if (preloadedCompany) setAssociatedCompany(preloadedCompany);
    }
  }, [preloadedContacts, preloadedSalespeople, preloadedCompany]);

  // Only load associations when preloaded data changes
  useEffect(() => {
    loadAssociations();
  }, [loadAssociations]);

  useEffect(() => {
    loadDashboardData();
    
    // Cleanup function to unsubscribe when component unmounts or dependencies change
    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current();
        subscriptionRef.current = null;
      }
    };
  }, [loadDashboardData]);

  // Handle task creation
  const handleCreateTask = useCallback(async (taskData: any) => {
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
  }, [tenantId, user?.uid, entityType, entityId]);

  // Handle task editing
  const handleEditTask = useCallback((task: any) => {
    setSelectedTask(task);
    setShowDetailsDialog(true);
  }, []);

  // Handle task completion
  const handleQuickComplete = useCallback(async (taskId: string) => {
    try {
      const taskService = TaskService.getInstance();
      await taskService.quickCompleteTask(taskId, tenantId, user?.uid || '');
    } catch (error) {
      console.error('Error completing task:', error);
    }
  }, [tenantId, user?.uid]);

  // Handle task click
  const handleTaskClick = useCallback((task: any) => {
    setSelectedTask(task);
    setShowDetailsDialog(true);
  }, []);

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
            showCompany={entityType === 'contact' || entityType === 'salesperson'}
            showDeal={entityType === 'deal' || entityType === 'salesperson'}
            showContacts={true}
            deal={entityType === 'deal' ? entity : undefined}
            company={preloadedCompany}
            contacts={preloadedContacts || []}
            salespeople={preloadedSalespeople || []}
            // Pass additional context data for association resolution
            deals={preloadedDeals || []}
            companies={preloadedCompanies || []}
            variant="default"
          />
        ))}
      </Box>
    );
  };

  return (
    <Box>
      {/* Combined Task List - Show all non-completed tasks for the main dashboard */}
      {activeTab === 0 && (
        <TasksList
          tasks={dashboardData?.mainDashboardTasks || []}
          emptyStateMessage={`No tasks for this ${entityType}`}
          preloadedContacts={preloadedContacts}
          preloadedSalespeople={preloadedSalespeople}
          preloadedCompany={preloadedCompany}
        />
      )}
      

      {activeTab === 1 && (
        <TasksList
          tasks={(() => {
            // Combine tasks but ensure uniqueness by ID
            const thisWeekTasks = dashboardData?.thisWeek?.tasks || [];
            const completedTasks = dashboardData?.completed?.tasks || [];
            
            // Create a Map to ensure unique tasks by ID
            const uniqueTasksMap = new Map();
            
            // Add this week tasks first
            thisWeekTasks.forEach(task => {
              uniqueTasksMap.set(task.id, task);
            });
            
            // Add completed tasks (will overwrite if same ID exists)
            completedTasks.forEach(task => {
              uniqueTasksMap.set(task.id, task);
            });
            
            return Array.from(uniqueTasksMap.values());
          })()}
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
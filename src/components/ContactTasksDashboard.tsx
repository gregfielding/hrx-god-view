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
import { TaskStatus, TaskClassification, TaskCategory } from '../types/Tasks';

import CreateTaskDialog from './CreateTaskDialog';
import CreateFollowUpCampaignDialog from './CreateFollowUpCampaignDialog';
import TaskDetailsDialog from './TaskDetailsDialog';
import TaskCard from './TaskCard';

interface ContactTasksDashboardProps {
  contactId: string;
  tenantId: string;
  contact: any; // Contact information
  // NEW: Pre-loaded associations to prevent duplicate calls
  preloadedContacts?: any[];
  preloadedSalespeople?: any[];
  preloadedCompany?: any;
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

const ContactTasksDashboard: React.FC<ContactTasksDashboardProps> = ({
  contactId,
  tenantId,
  contact,
  preloadedContacts,
  preloadedSalespeople,
  preloadedCompany
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

  // Removed loadDashboardData call - real-time subscription handles data loading
  // useEffect(() => {
  //   loadDashboardData();
  // }, [contactId, tenantId]);

  // Set up real-time subscription for task updates
  useEffect(() => {
    if (!user) return;

    const unsubscribe = taskService.subscribeToTasks(
      user.uid,
      tenantId,
      { contactId },
      (tasks) => {
        console.log('🔍 ContactTasksDashboard received tasks:', tasks.length, tasks);
        // Process tasks into dashboard format for backward compatibility
        const openTasks = tasks.filter(task => task.status !== 'completed');
        const completedTasks = tasks.filter(task => task.status === 'completed');
        console.log('🔍 Open tasks:', openTasks.length, openTasks);
        console.log('🔍 Task statuses:', tasks.map(t => ({ id: t.id, status: t.status, title: t.title })));
        
        const today = new Date().toISOString().split('T')[0];
        const thisWeekStart = new Date();
        thisWeekStart.setHours(0, 0, 0, 0);
        const thisWeekEnd = new Date(thisWeekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
        
        // For contact tasks, show ALL open tasks regardless of date
        // This ensures we see all tasks associated with the contact
        const todayTasks = openTasks.filter(task => {
          const taskDate = task.dueDate || task.scheduledDate;
          if (!taskDate) return true; // Show tasks without dates
          return taskDate === today;
        });
        
        // For contacts, always show all open tasks (no date filtering)
        const displayTasks = openTasks;
        console.log('🔍 Display tasks:', displayTasks.length, displayTasks);
        
        setDashboardData({
          today: { 
            totalTasks: displayTasks.length,
            completedTasks: displayTasks.filter(t => t.status === 'completed').length,
            pendingTasks: displayTasks.filter(t => t.status !== 'completed').length,
            tasks: displayTasks
          },
          thisWeek: { 
            totalTasks: displayTasks.length,
            completedTasks: displayTasks.filter(t => t.status === 'completed').length,
            pendingTasks: displayTasks.filter(t => t.status !== 'completed').length,
            quotaProgress: {
              percentage: displayTasks.length > 0 ? (displayTasks.filter(t => t.status === 'completed').length / displayTasks.length) * 100 : 0,
              completed: displayTasks.filter(t => t.status === 'completed').length,
              target: displayTasks.length
            },
            tasks: displayTasks
          },
          completed: { 
            totalTasks: completedTasks.length,
            tasks: completedTasks
          },
          priorities: {
            high: openTasks.filter(t => t.priority === 'high').length,
            medium: openTasks.filter(t => t.priority === 'medium').length,
            low: openTasks.filter(t => t.priority === 'low').length
          },
          types: {
            email: openTasks.filter(t => t.type === 'email').length,
            phone_call: openTasks.filter(t => t.type === 'phone_call').length,
            scheduled_meeting_virtual: openTasks.filter(t => t.type === 'scheduled_meeting_virtual').length,
            research: openTasks.filter(t => t.type === 'research').length,
            custom: openTasks.filter(t => t.type === 'custom').length
          }
        });
        setLoading(false);
        setError(null);
      }
    );

    return () => unsubscribe();
  }, [user, tenantId, contactId]);

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
                // Associate the assigned salespeople with the contact if not already associated
        const assignedSalespersonIds = Array.isArray(taskData.assignedTo) ? taskData.assignedTo : (taskData.assignedTo ? [taskData.assignedTo] : []);
        for (const assignedSalespersonId of assignedSalespersonIds) {
          if (assignedSalespersonId && assignedSalespersonId !== user.uid) {
            try {
              // Import the simple association service
              const { getFunctions, httpsCallable } = await import('firebase/functions');
              const functions = getFunctions();
              const manageAssociationsCallable = httpsCallable(functions, 'manageAssociations');
              try {
                await manageAssociationsCallable({
                  action: 'add',
                  sourceEntityType: 'contact',
                  sourceEntityId: contactId,
                  targetEntityType: 'salesperson',
                  targetEntityId: assignedSalespersonId,
                  tenantId
                });
              } catch (fnErr) {
                console.warn('manageAssociations failed, skipping salesperson-contact association:', fnErr);
              }
              console.log(`✅ Associated salesperson ${assignedSalespersonId} with contact ${contactId}`);
            } catch (associationError) {
              console.warn('Failed to associate salesperson with contact:', associationError);
              // Don't fail the task creation if association fails
            }
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
            companies: Array.isArray(contact?.associations?.companies)
              ? contact.associations.companies.map((c: any) => (typeof c === 'string' ? c : c?.id)).filter(Boolean)
              : [],
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
      
            // Associate the assigned salespeople with the contact if not already associated
      const assignedSalespersonIds = Array.isArray(campaignData.assignedTo) ? campaignData.assignedTo : (campaignData.assignedTo ? [campaignData.assignedTo] : []);
      for (const assignedSalespersonId of assignedSalespersonIds) {
        if (assignedSalespersonId && assignedSalespersonId !== user.uid) {
          try {
            // Import the simple association service
            const { getFunctions, httpsCallable } = await import('firebase/functions');
            const functions = getFunctions();
            const manageAssociationsCallable = httpsCallable(functions, 'manageAssociations');
            try {
              await manageAssociationsCallable({
                action: 'add',
                sourceEntityType: 'contact',
                sourceEntityId: contactId,
                targetEntityType: 'salesperson',
                targetEntityId: assignedSalespersonId,
                tenantId
              });
            } catch (fnErr) {
              console.warn('manageAssociations failed, skipping salesperson-contact association:', fnErr);
            }
            console.log(`✅ Associated salesperson ${assignedSalespersonId} with contact ${contactId} for follow-up campaign`);
          } catch (associationError) {
            console.warn('Failed to associate salesperson with contact:', associationError);
            // Don't fail the campaign creation if association fails
          }
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
      // Find the task to determine if it's completed or not
      const task = dashboardData?.today?.tasks?.find(t => t.id === taskId) ||
                   dashboardData?.thisWeek?.tasks?.find(t => t.id === taskId) ||
                   dashboardData?.completed?.tasks?.find(t => t.id === taskId);
      
      if (!task) return;

      if (task.status === 'completed') {
        // Task is completed, so uncomplete it by restoring the correct status
        const dateToUse = task.classification === 'todo' ? task.dueDate : task.scheduledDate;
        const scheduledDate = new Date(dateToUse + 'T00:00:00');
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const scheduledDay = new Date(scheduledDate.getFullYear(), scheduledDate.getMonth(), scheduledDate.getDate());
        
        let newStatus: TaskStatus;
        if (scheduledDay < today) {
          newStatus = 'overdue';
        } else if (scheduledDay.getTime() === today.getTime()) {
          newStatus = 'due';
        } else {
          newStatus = 'upcoming';
        }

        await taskService.updateTask(taskId, { 
          status: newStatus,
          completedAt: null
        }, tenantId);
      } else {
        // Task is not completed, so complete it
        await taskService.quickCompleteTask(taskId, tenantId, user.uid);
      }
      
      // No need to refresh data - real-time subscription will handle updates
    } catch (err) {
      console.error('Error updating task status:', err);
      setError('Failed to update task status');
    }
  };

  const handleEditTask = (task: any) => {
    setSelectedTask(task);
    setShowDetailsDialog(true);
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
        category: 'follow_up' as TaskCategory, // Use valid TaskCategory value
        quotaCategory: suggestion.category || 'business_generating',
        associations: {
          contacts: [contactId],
          companies: Array.isArray(contact?.associations?.companies)
            ? contact.associations.companies.map((c: any) => (typeof c === 'string' ? c : c?.id)).filter(Boolean)
            : [],
          deals: Array.isArray(contact?.associations?.deals)
            ? contact.associations.deals.map((d: any) => (typeof d === 'string' ? d : d?.id)).filter(Boolean)
            : []
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

  const calculateUrgency = (task: any) => {
    const dueDate = new Date((task.dueDate || task.scheduledDate) + 'T00:00:00');
    const now = new Date();
    const diffHours = (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60);
    
    if (diffHours < 0) return 'overdue';
    if (diffHours < 24) return 'urgent';
    if (diffHours < 72) return 'soon';
    return 'normal';
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

  const AISuggestionsList: React.FC<AISuggestionsListProps> = ({
    suggestions,
    onAccept,
    onReject,
    showEmptyState,
    emptyStateMessage
  }) => {
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
    if (suggestions.length === 0 && showEmptyState) {
      return (
        <Card>
          <CardContent>
            <Typography variant="body1" color="textSecondary" align="center">
              {emptyStateMessage}
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
                    {getTaskTypeIcon(suggestion.type)}
                    <Typography variant="h6" sx={{ ml: 1, flex: 1 }}>
                      {suggestion.title}
                    </Typography>
                    <Chip
                      label={suggestion.priority}
                      color={getStatusColor(suggestion.priority) as any}
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

  return (
    <Box>
      {/* Combined Task List - Active tasks first, then completed tasks */}
      {activeTab === 0 && (
        <TasksList
          tasks={[
            ...(dashboardData?.today?.tasks || []),
            ...(dashboardData?.completed?.tasks || [])
          ]}
          onTaskClick={(task) => {
            setSelectedTask(task);
            setShowDetailsDialog(true);
          }}
          onQuickComplete={handleQuickComplete}
          onEditTask={handleEditTask}
          showEmptyState={true}
          emptyStateMessage="No tasks for this contact"
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
          onTaskClick={(task) => {
            setSelectedTask(task);
            setShowDetailsDialog(true);
          }}
          onQuickComplete={handleQuickComplete}
          onEditTask={handleEditTask}
          showEmptyState={true}
          emptyStateMessage="No tasks for this period"
          preloadedContacts={preloadedContacts}
          preloadedSalespeople={preloadedSalespeople}
          preloadedCompany={preloadedCompany}
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
          onEditTask={handleEditTask}
          showEmptyState={true}
          emptyStateMessage="No completed tasks"
          preloadedContacts={preloadedContacts}
          preloadedSalespeople={preloadedSalespeople}
          preloadedCompany={preloadedCompany}
        />
      )}
      {activeTab === 3 && (
        <AISuggestionsList
          suggestions={aiSuggestions}
          onAccept={handleAcceptSuggestion}
          onReject={handleRejectSuggestion}
          showEmptyState={true}
          emptyStateMessage="No AI suggestions available"
        />
      )}

      {/* Dialogs */}
      {showCreateDialog && (
        <CreateTaskDialog
          open={showCreateDialog}
          onClose={() => setShowCreateDialog(false)}
          onSubmit={handleCreateTask}
          prefilledData={{
            assignedTo: user?.uid || '',
            associations: {
              companies: Array.isArray((contact as any)?.associations?.companies)
                ? (contact as any).associations.companies.map((c: any) => (typeof c === 'string' ? c : c?.id)).filter(Boolean)
                : [],
              contacts: [contactId],
              deals: Array.isArray((contact as any)?.associations?.deals)
                ? (contact as any).associations.deals.map((d: any) => (typeof d === 'string' ? d : d?.id)).filter(Boolean)
                : [],
              salespeople: []
            }
          }}
          currentUserId={user?.uid || ''}
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
          contactCompanyId={Array.isArray((contact as any)?.associations?.companies)
            ? ((contact as any).associations.companies.map((c: any) => (typeof c === 'string' ? c : c?.id)).filter(Boolean)[0] || '')
            : ''}
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
  onEditTask?: (task: any) => void; // New prop for edit functionality
  showEmptyState: boolean;
  emptyStateMessage: string;
  preloadedContacts?: any[];
  preloadedSalespeople?: any[];
  preloadedCompany?: any;
}

const TasksList: React.FC<TasksListProps> = ({
  tasks,
  onTaskClick,
  onQuickComplete,
  onEditTask,
  showEmptyState,
  emptyStateMessage,
  preloadedContacts,
  preloadedSalespeople,
  preloadedCompany
}) => {
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

  const getTaskStatusDisplay = (task: any) => {
    if (task.status === 'completed') return 'completed';
    if (task.status === 'due') return 'due';
    if (task.status === 'upcoming') return 'upcoming';
    if (task.status === 'postponed') return 'postponed';
    if (task.status === 'cancelled') return 'cancelled';
    return 'pending';
  };

  if (tasks.length === 0 && showEmptyState) {
    return (
      <Card>
        <CardContent>
          <Typography variant="body1" color="textSecondary" align="center">
            {emptyStateMessage}
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
          onEditTask={onEditTask}
          getStatusColor={getStatusColor}
          getTaskStatusDisplay={getTaskStatusDisplay}
          showCompany={true}
          showDeal={true}
          showContacts={true}
          deal={task.deal}
          company={preloadedCompany}
          contacts={preloadedContacts || []}
          salespeople={preloadedSalespeople || []}
          variant="default"
        />
      ))}
    </Box>
  );
};



// interface TasksAnalyticsProps {
//   dashboardData: TaskDashboardData | null;
// }
// const TasksAnalytics: React.FC<TasksAnalyticsProps> = ({ dashboardData }) => {
//   return null;
// };

export default ContactTasksDashboard; 
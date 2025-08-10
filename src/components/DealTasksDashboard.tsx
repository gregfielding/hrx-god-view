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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
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

import { createAssociationService } from '../utils/associationService';
import { useAuth } from '../contexts/AuthContext';
import { TaskService } from '../utils/taskService';
import { TaskStatus, TaskClassification } from '../types/Tasks';

import CreateTaskDialog from './CreateTaskDialog';
import TaskDetailsDialog from './TaskDetailsDialog';
import TaskCard from './TaskCard';
import EnhancedTasksLayout from './EnhancedTasksLayout';

interface DealTasksDashboardProps {
  dealId: string;
  tenantId: string;
  deal: any; // Deal information
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

const DealTasksDashboard: React.FC<DealTasksDashboardProps> = ({
  dealId,
  tenantId,
  deal
}) => {
  const { user } = useAuth();
  const [dashboardData, setDashboardData] = useState<TaskDashboardData | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [activeTab, setActiveTab] = useState(0);
  const [associatedCompany, setAssociatedCompany] = useState<any>(null);
  const [associatedContacts, setAssociatedContacts] = useState<any[]>([]);
  const [associatedSalespeople, setAssociatedSalespeople] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [loadingAssociations, setLoadingAssociations] = useState(false);
  const [prefilledTaskData, setPrefilledTaskData] = useState<any>(null);

  const taskService = TaskService.getInstance();

  useEffect(() => {
    loadDashboardData();
    loadAssociatedData();
  }, [dealId, tenantId]);

  const loadAssociatedData = async () => {
    if (!user || !tenantId || !dealId) return;
    
    setLoadingAssociations(true);
    try {
      console.log('🔍 TESTING: Loading associations for deal:', dealId);
      
      // TEST: Use the new unified association service
      try {
        const { createUnifiedAssociationService } = await import('../utils/unifiedAssociationService');
        const associationService = createUnifiedAssociationService(tenantId, user.uid);
        
        console.log('🔍 Loading unified associations for deal:', dealId);
        const result = await associationService.getEntityAssociations('deal', dealId);
        
        console.log('📊 Unified association result:', result);
        console.log('📊 Companies:', result.entities.companies);
        console.log('📊 Contacts:', result.entities.contacts);
        console.log('📊 Salespeople:', result.entities.salespeople);
        
        // Set company
        if (result.entities.companies && result.entities.companies.length > 0) {
          setAssociatedCompany(result.entities.companies[0]);
        }
        
        // Set contacts
        if (result.entities.contacts) {
          console.log('📊 Setting associated contacts:', result.entities.contacts);
          setAssociatedContacts(result.entities.contacts);
        }
        
        // Set salespeople
        if (result.entities.salespeople) {
          console.log('📊 Setting associated salespeople:', result.entities.salespeople);
          setAssociatedSalespeople(result.entities.salespeople);
        }
        
        console.log('✅ Unified service test completed successfully');
        return;
        
      } catch (unifiedError) {
        console.error('❌ Unified service failed, falling back to old method:', unifiedError);
      }
      
      // FALLBACK: Use the old association service
      const associationService = createAssociationService(tenantId, user.uid);
      
      // Load company associated with the deal
      const companyResult = await associationService.queryAssociations({
        entityType: 'deal',
        entityId: dealId,
        targetTypes: ['company']
      });
      
      if (companyResult.entities.companies && companyResult.entities.companies.length > 0) {
        setAssociatedCompany(companyResult.entities.companies[0]);
      }
      
      // Load contacts associated with the deal
      const contactResult = await associationService.queryAssociations({
        entityType: 'deal',
        entityId: dealId,
        targetTypes: ['contact']
      });
      
      if (contactResult.entities.contacts) {
        console.log('📊 Setting associated contacts (fallback):', contactResult.entities.contacts);
        setAssociatedContacts(contactResult.entities.contacts);
      }
      
      // Load salespeople associated with the deal
      const salespeopleResult = await associationService.queryAssociations({
        entityType: 'deal',
        entityId: dealId,
        targetTypes: ['salesperson']
      });
      
      if (salespeopleResult.entities.salespeople) {
        console.log('📊 Setting associated salespeople (fallback):', salespeopleResult.entities.salespeople);
        setAssociatedSalespeople(salespeopleResult.entities.salespeople);
      }
      
    } catch (err) {
      console.error('Error loading associated data:', err);
      
      // Fallback: Try to use deal's own association data
      console.log('🔄 Trying fallback with deal data:', deal);
      if (deal?.associations) {
        console.log('📊 Deal associations:', deal.associations);
        
        // If we have contact IDs in the deal, try to fetch them directly
        if (deal.associations.contacts && deal.associations.contacts.length > 0) {
          console.log('📊 Deal has contact IDs:', deal.associations.contacts);
          // For now, just set empty array to avoid showing IDs
          setAssociatedContacts([]);
        }
        
        if (deal.associations.salespeople && deal.associations.salespeople.length > 0) {
          console.log('📊 Deal has salespeople IDs:', deal.associations.salespeople);
          // For now, just set empty array to avoid showing IDs
          setAssociatedSalespeople([]);
        }
      }
    } finally {
      setLoadingAssociations(false);
    }
  };

  // Filter out AI suggestions that match existing tasks
  const filterDuplicateSuggestions = (suggestions: any[], existingTasks: any[]) => {
    if (!suggestions || suggestions.length === 0) return [];
    if (!existingTasks || existingTasks.length === 0) return suggestions;

    return suggestions.filter(suggestion => {
      // Check if any existing task matches this suggestion
      const isDuplicate = existingTasks.some(task => {
        // Compare by title (case-insensitive)
        const titleMatch = task.title?.toLowerCase() === suggestion.title?.toLowerCase();
        
        // Compare by type
        const typeMatch = task.type === suggestion.type;
        
        // Compare by category
        const categoryMatch = task.category === suggestion.category;
        
        // If title matches, it's definitely a duplicate
        if (titleMatch) {
          console.log('Debug: Filtering out duplicate suggestion by title:', suggestion.title);
          return true;
        }
        
        // If type and category match, it's likely a duplicate
        if (typeMatch && categoryMatch) {
          console.log('Debug: Filtering out duplicate suggestion by type/category:', suggestion.title);
          return true;
        }
        
        return false;
      });
      
      return !isDuplicate;
    });
  };

  const loadDashboardData = async () => {
    if (!user) return;

    setLoading(true);
    setError(null);

    try {
      // Debug: Directly query tasks from Firestore
      console.log('Debug: Loading tasks for deal:', dealId);
      const { collection, query, where, getDocs } = await import('firebase/firestore');
      const { db } = await import('../firebase');
      
      // Query all tasks for this deal
      const tasksRef = collection(db, 'tenants', tenantId, 'tasks');
      const tasksQuery = query(
        tasksRef,
        where('associations.deals', 'array-contains', dealId)
      );
      
      const tasksSnapshot = await getDocs(tasksQuery);
      const allTasks = tasksSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      console.log('Debug: Found tasks for deal:', allTasks);

      // Also check for tasks assigned to the current user
      const userTasksQuery = query(
        tasksRef,
        where('assignedTo', '==', user.uid)
      );
      
      const userTasksSnapshot = await getDocs(userTasksQuery);
      const userTasks = userTasksSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      console.log('Debug: Found tasks for user:', userTasks);

      // Load deal-specific tasks
      const dashboardResult = await taskService.getTaskDashboard(
        user.uid,
        new Date().toISOString(),
        tenantId,
        { dealId } // Filter by deal
      );

      console.log('Debug: Dashboard result:', dashboardResult);
      console.log('Debug: Today tasks count:', dashboardResult?.today?.tasks?.length || 0);
      console.log('Debug: This week tasks count:', dashboardResult?.thisWeek?.tasks?.length || 0);

      // Load AI suggestions for this deal
      const suggestionsResult = await taskService.getAITaskSuggestions(
        user.uid,
        tenantId,
        { dealId, dealStage: deal?.stage }
      );

      // If dashboard result is empty but we found tasks directly, create a fallback structure
      if ((!dashboardResult?.today?.tasks || dashboardResult.today.tasks.length === 0) && allTasks.length > 0) {
        console.log('Debug: Creating fallback dashboard structure with', allTasks.length, 'tasks');
        
        // Create a simple dashboard structure with all tasks
        const fallbackDashboard = {
          today: {
            totalTasks: allTasks.length,
            completedTasks: allTasks.filter((t: any) => t.status === 'completed').length,
            pendingTasks: allTasks.filter((t: any) => t.status !== 'completed').length,
            tasks: allTasks
          },
          thisWeek: {
            totalTasks: allTasks.length,
            completedTasks: allTasks.filter((t: any) => t.status === 'completed').length,
            pendingTasks: allTasks.filter((t: any) => t.status !== 'completed').length,
            quotaProgress: {
              percentage: 0,
              completed: allTasks.filter((t: any) => t.status === 'completed').length,
              target: 30
            },
            tasks: allTasks
          },
          completed: {
            totalTasks: allTasks.filter((t: any) => t.status === 'completed').length,
            tasks: allTasks.filter((t: any) => t.status === 'completed')
          },
          priorities: {
            high: allTasks.filter((t: any) => t.priority === 'high').length,
            medium: allTasks.filter((t: any) => t.priority === 'medium').length,
            low: allTasks.filter((t: any) => t.priority === 'low').length
          },
          types: {
            email: allTasks.filter((t: any) => t.type === 'email').length,
            phone_call: allTasks.filter((t: any) => t.type === 'phone_call').length,
            scheduled_meeting_virtual: allTasks.filter((t: any) => t.type === 'scheduled_meeting_virtual').length,
            research: allTasks.filter((t: any) => t.type === 'research').length,
            custom: allTasks.filter((t: any) => t.type === 'custom').length
          }
        };
        
        setDashboardData(fallbackDashboard);
      } else {
        setDashboardData(dashboardResult);
      }
      
      // Filter out AI suggestions that match existing tasks
      const filteredSuggestions = filterDuplicateSuggestions(suggestionsResult || [], allTasks);
      console.log('Debug: Original suggestions count:', suggestionsResult?.length || 0);
      console.log('Debug: Filtered suggestions count:', filteredSuggestions.length);
      
      setAiSuggestions(filteredSuggestions);
    } catch (err) {
      console.error('Error loading deal tasks dashboard:', err);
      
      // Provide more specific error messages
      let errorMessage = 'Failed to load deal tasks';
      if (err instanceof Error) {
        if (err.message.includes('index')) {
          errorMessage = 'Task indexes are still building. Please try again in a few minutes.';
        } else if (err.message.includes('permission')) {
          errorMessage = 'You do not have permission to view these tasks.';
        } else if (err.message.includes('network')) {
          errorMessage = 'Network error. Please check your connection and try again.';
        } else {
          errorMessage = `Error: ${err.message}`;
        }
      }
      
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTask = async (taskData: any) => {
    if (!user) return;

    try {
      // Pre-select the deal association and add required fields
      const taskWithDeal = {
        ...taskData,
        assignedTo: taskData.assignedTo || user.uid,
        createdBy: user.uid,
        tenantId: tenantId,
        associations: {
          ...taskData.associations,
          deals: [dealId]
        }
      };

      const result = await taskService.createTask(taskWithDeal);
      
      if (result.success) {
        setShowCreateDialog(false);
        setPrefilledTaskData(null); // Clear pre-filled data
        await loadDashboardData(); // Refresh data
      }
    } catch (err) {
      console.error('Error creating task:', err);
      setError('Failed to create task');
    }
  };

  const handleQuickComplete = async (taskId: string) => {
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
        await taskService.completeTask(taskId, { 
          outcome: 'positive', 
          notes: 'Task completed'
        }, tenantId, user?.uid || '');
      }
      
      await loadDashboardData(); // Refresh data
    } catch (err) {
      console.error('Error updating task status:', err);
      setError('Failed to update task status');
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
      status: 'upcoming' as TaskStatus,
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
      selectedCompany: associatedCompany?.id || deal?.companyId || '',
      selectedContact: '',
      selectedDeal: dealId,
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

  // const handleRejectSuggestion = async (suggestionId: string) => {
  //   try {
  //     await taskService.rejectAITaskSuggestion(suggestionId, tenantId, user?.uid || '');
  //     await loadDashboardData(); // Refresh data
  //   } catch (err) {
  //     console.error('Error rejecting suggestion:', err);
  //     setError('Failed to reject suggestion');
  //   }
  // };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'success';
      case 'due': return 'warning'; // Yellow for due today
      case 'overdue': return 'error'; // Red for overdue
      case 'upcoming': return 'success'; // Green for future
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

  const handleEditTask = (task: any) => {
    setSelectedTask(task);
    setShowDetailsDialog(true);
  };

  const handleDeleteTask = async (taskId: string) => {
    if (window.confirm('Are you sure you want to delete this task?')) {
      try {
        const taskService = TaskService.getInstance();
        await taskService.deleteTask(taskId, tenantId, user?.uid || '');
        loadDashboardData(); // Refresh the dashboard
      } catch (error) {
        console.error('Error deleting task:', error);
        setError('Failed to delete task');
      }
    }
  };

  if (loading) {
    return (
      <Box sx={{ p: 0 }}>
        <LinearProgress />
        <Typography variant="body2" sx={{ mt: 2 }}>
          Loading deal tasks...
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert 
          severity="error" 
          onClose={() => setError(null)}
          action={
            <Button 
              color="inherit" 
              size="small" 
              onClick={() => {
                setError(null);
                loadDashboardData();
              }}
            >
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
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

      {/* Tab Content with Enhanced Layout */}
      {activeTab === 0 && (
        <EnhancedTasksLayout
          tasks={dashboardData?.today?.tasks || []}
          onTaskClick={(task) => {
            setSelectedTask(task);
            setShowDetailsDialog(true);
          }}
          onQuickComplete={handleQuickComplete}
          onEditTask={handleEditTask}
          onDeleteTask={handleDeleteTask}
          onCreateTask={() => setShowCreateDialog(true)}
          getStatusColor={getStatusColor}
          getTaskTypeIcon={getTaskTypeIcon}
          calculateUrgency={calculateUrgency}
          getTaskStatusDisplay={getTaskStatusDisplay}
          deal={deal}
          associatedContacts={associatedContacts}
          associatedSalespeople={associatedSalespeople}
        />
      )}

      {activeTab === 1 && (
        <EnhancedTasksLayout
          tasks={dashboardData?.thisWeek?.tasks || []}
          onTaskClick={(task) => {
            setSelectedTask(task);
            setShowDetailsDialog(true);
          }}
          onQuickComplete={handleQuickComplete}
          onEditTask={handleEditTask}
          onDeleteTask={handleDeleteTask}
          onCreateTask={() => setShowCreateDialog(true)}
          getStatusColor={getStatusColor}
          getTaskTypeIcon={getTaskTypeIcon}
          calculateUrgency={calculateUrgency}
          getTaskStatusDisplay={getTaskStatusDisplay}
          deal={deal}
          associatedContacts={associatedContacts}
          associatedSalespeople={associatedSalespeople}
        />
      )}

      {activeTab === 2 && (
        <EnhancedTasksLayout
          tasks={dashboardData?.completed?.tasks || []}
          onTaskClick={(task) => {
            setSelectedTask(task);
            setShowDetailsDialog(true);
          }}
          onQuickComplete={handleQuickComplete}
          onEditTask={handleEditTask}
          onDeleteTask={handleDeleteTask}
          onCreateTask={() => setShowCreateDialog(true)}
          getStatusColor={getStatusColor}
          getTaskTypeIcon={getTaskTypeIcon}
          calculateUrgency={calculateUrgency}
          getTaskStatusDisplay={getTaskStatusDisplay}
          deal={deal}
          associatedContacts={associatedContacts}
          associatedSalespeople={associatedSalespeople}
        />
      )}

      {activeTab === 3 && (
        <Box>
          <AISuggestionsList
            suggestions={aiSuggestions}
            onAccept={handleAcceptSuggestion}
            getPriorityColor={getStatusColor}
            getTaskIcon={getTaskTypeIcon}
          />
          <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center' }}>
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={loadDashboardData}
              disabled={loading}
            >
              Refresh AI Suggestions
            </Button>
          </Box>
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
          salespeople={associatedSalespeople}
          contacts={associatedContacts}
          currentUserId={user?.uid || ''}
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
          contacts={associatedContacts}
          salespeople={associatedSalespeople}
        />
      )}


    </Box>
  );
};

// Helper Components
interface ClassificationBasedTasksLayoutProps {
  tasks: any[];
  onTaskClick: (task: any) => void;
  onQuickComplete: (taskId: string) => void;
  getStatusColor: (status: string) => string;
  getTaskTypeIcon: (type: string) => React.ReactNode;
  calculateUrgency: (task: any) => string;
  getTaskStatusDisplay: (task: any) => string;
  deal?: any;
  associatedContacts?: any[];
  associatedSalespeople?: any[];
}

interface TasksListProps {
  tasks: any[];
  onTaskClick: (task: any) => void;
  onQuickComplete: (taskId: string) => void;
  getStatusColor: (status: string) => string;
  getTaskTypeIcon: (type: string) => React.ReactNode;
  calculateUrgency: (task: any) => string;
  getTaskStatusDisplay: (task: any) => string;
  deal?: any;
  associatedContacts?: any[];
  associatedSalespeople?: any[];
}

const ClassificationBasedTasksLayout: React.FC<ClassificationBasedTasksLayoutProps> = ({
  tasks,
  onTaskClick,
  onQuickComplete,
  getStatusColor,
  getTaskTypeIcon,
  calculateUrgency,
  getTaskStatusDisplay,
  deal,
  associatedContacts = [],
  associatedSalespeople = []
}) => {
  const [expandedTodos, setExpandedTodos] = useState<Set<string>>(new Set());
  
  // Separate tasks by classification
  const todoTasks = tasks.filter(task => task.classification === 'todo');
  const appointmentTasks = tasks.filter(task => 
    task.classification === 'appointment' || !task.classification
  );

  const handleTodoHover = (taskId: string, isHovering: boolean) => {
    if (isHovering) {
      setExpandedTodos(prev => new Set(prev).add(taskId));
    } else {
      setExpandedTodos(prev => {
        const newSet = new Set(prev);
        newSet.delete(taskId);
        return newSet;
      });
    }
  };

  return (
    <Box sx={{ display: 'flex', gap: 2, height: 'calc(100vh - 300px)' }}>
      {/* Left Side - Todo Tasks (25%) */}
      <Box sx={{ width: '25%', borderRight: 1, borderColor: 'divider', pr: 2 }}>
        <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>
          Todo Tasks ({todoTasks.length})
        </Typography>
        <Box sx={{ 
          height: '100%', 
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 1
        }}>
          {todoTasks.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
              No todo tasks
            </Typography>
          ) : (
            todoTasks.map((task) => (
              <Card
                key={task.id}
                sx={{
                  cursor: 'pointer',
                  '&:hover': { 
                    transform: 'scale(1.02)',
                    transition: 'all 0.2s ease-in-out'
                  },
                  border: 1,
                  borderColor: 'divider',
                  p: 1.5,
                  transition: 'all 0.2s ease-in-out'
                }}
                onClick={() => onTaskClick(task)}
                onMouseEnter={() => handleTodoHover(task.id, true)}
                onMouseLeave={() => handleTodoHover(task.id, false)}
              >
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 'bold', mb: 0.5 }}>
                      {task.title}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
                      <Chip
                        label={getTaskStatusDisplay(task)}
                        size="small"
                        variant={task.status === 'overdue' ? 'outlined' : 'filled'}
                        color={task.status === 'overdue' ? 'error' : (getStatusColor(task.status) as any)}
                        sx={{ 
                          fontSize: '0.7rem',
                          height: '20px',
                          ...(task.status !== 'overdue' && {
                            color: 'white'
                          })
                        }}
                      />
                      <Chip
                        label={task.priority}
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: '0.7rem', height: '20px' }}
                      />
                    </Box>
                    {/* Description appears on hover */}
                    <Box
                      sx={{
                        maxHeight: expandedTodos.has(task.id) ? '100px' : 0,
                        overflow: 'hidden',
                        transition: 'max-height 0.3s ease-in-out'
                      }}
                    >
                      {task.description && (
                        <Typography 
                          variant="caption" 
                          color="text.secondary"
                          sx={{ 
                            display: 'block',
                            mt: 1,
                            lineHeight: 1.4
                          }}
                        >
                          {task.description}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      onQuickComplete(task.id);
                    }}
                    sx={{ color: 'success.main' }}
                  >
                    <CheckCircleIcon fontSize="small" />
                  </IconButton>
                </Box>
              </Card>
            ))
          )}
        </Box>
      </Box>

      {/* Right Side - Appointment Tasks (75%) */}
      <Box sx={{ width: '75%', pl: 2 }}>
        <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>
          Appointments ({appointmentTasks.length})
        </Typography>
        <Box sx={{ 
          height: '100%', 
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 2
        }}>
          {appointmentTasks.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
              No appointments scheduled
            </Typography>
          ) : (
            appointmentTasks.map((task) => (
              <Card
                key={task.id}
                sx={{
                  cursor: 'pointer',
                  '&:hover': { bgcolor: 'action.hover' },
                  border: 1,
                  borderColor: 'divider',
                  p: 2
                }}
                onClick={() => onTaskClick(task)}
              >
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 'fit-content' }}>
                    {getTaskTypeIcon(task.type)}
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                        {task.title}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {task.startTime ? new Date(task.startTime).toLocaleTimeString([], { 
                          hour: '2-digit', 
                          minute: '2-digit' 
                        }) : (task.classification === 'todo' ? task.dueDate : task.scheduledDate)}
                        {task.duration && ` • ${task.duration} min`}
                      </Typography>
                    </Box>
                  </Box>
                  
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    {task.description && (
                      <Typography variant="body2" sx={{ mb: 1 }}>
                        {task.description}
                      </Typography>
                    )}
                    
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                      <Chip
                        label={getTaskStatusDisplay(task)}
                        size="small"
                        sx={{ 
                          bgcolor: getStatusColor(task.status),
                          color: 'white'
                        }}
                      />
                      <Chip
                        label={task.priority}
                        size="small"
                        variant="outlined"
                      />
                      {task.aiSuggested && (
                        <Chip
                          label="AI Suggested"
                          size="small"
                          color="primary"
                          variant="outlined"
                          icon={<PsychologyIcon />}
                        />
                      )}
                    </Box>
                    
                    {/* Associated contacts/companies */}
                    {task.associations?.contacts && task.associations.contacts.length > 0 && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <Typography variant="caption" color="text.secondary">
                          Contacts:
                        </Typography>
                        {task.associations.contacts.slice(0, 2).map((contactId: string) => {
                          const contact = associatedContacts.find(c => c.id === contactId);
                          return (
                            <Chip
                              key={contactId}
                              label={contact?.fullName || contactId}
                              size="small"
                              variant="outlined"
                            />
                          );
                        })}
                        {task.associations.contacts.length > 2 && (
                          <Typography variant="caption" color="text.secondary">
                            +{task.associations.contacts.length - 2} more
                          </Typography>
                        )}
                      </Box>
                    )}
                    
                    {task.associations?.companies && task.associations.companies.length > 0 && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="caption" color="text.secondary">
                          Company:
                        </Typography>
                        {task.associations.companies.slice(0, 1).map((companyId: string) => {
                          const company = deal?.companyId === companyId ? deal : null;
                          return (
                            <Chip
                              key={companyId}
                              label={company?.companyName || companyId}
                              size="small"
                              variant="outlined"
                            />
                          );
                        })}
                      </Box>
                    )}
                  </Box>
                  
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        onQuickComplete(task.id);
                      }}
                      sx={{ color: 'success.main' }}
                    >
                      <CheckCircleIcon fontSize="small" />
                    </IconButton>
                  </Box>
                </Box>
              </Card>
            ))
          )}
        </Box>
      </Box>
    </Box>
  );
};

const TasksList: React.FC<TasksListProps> = ({
  tasks,
  onTaskClick,
  onQuickComplete,
  getStatusColor,
  getTaskTypeIcon,
  calculateUrgency,
  getTaskStatusDisplay,
  deal,
  associatedContacts = [],
  associatedSalespeople = []
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
          // In Deal Details context, we hide company and deal since we already know them
          showCompany={false}
          showDeal={false}
          showContacts={true}
          // Pass the deal context data
          deal={deal}
          contacts={associatedContacts}
          salespeople={associatedSalespeople}
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
                <IconButton
                  size="small"
                  color="success"
                  onClick={() => onAccept(suggestion)}
                >
                  <AddIcon />
                </IconButton>
              </Box>
            </Box>
          </CardContent>
        </Card>
      ))}
    </List>
  );
};

interface TasksAnalyticsProps {
  dashboardData: TaskDashboardData | null;
}

// Temporarily disable unused component to unblock builds; re-enable when analytics UI is used
// const TasksAnalytics: React.FC<TasksAnalyticsProps> = ({ dashboardData }) => {
//   return (
//     <Grid container spacing={3}>
//       <Grid item xs={12} md={6}>
//         <Card>
//           <CardContent>
//             <Typography variant="h6" gutterBottom>
//               Priority Breakdown
//             </Typography>
//             <Box sx={{ mt: 2 }}>
//               <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
//                 <Typography variant="body2">High Priority</Typography>
//                 <Typography variant="body2">{dashboardData?.priorities?.high || 0}</Typography>
//               </Box>
//               <LinearProgress 
//                 variant="determinate" 
//                 value={((dashboardData?.priorities?.high || 0) / Math.max(1, (dashboardData?.priorities?.high || 0) + (dashboardData?.priorities?.medium || 0) + (dashboardData?.priorities?.low || 0))) * 100}
//                 color="error"
//                 sx={{ mb: 2 }}
//               />
//               
//               <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
//                 <Typography variant="body2">Medium Priority</Typography>
//                 <Typography variant="body2">{dashboardData?.priorities?.medium || 0}</Typography>
//               </Box>
//               <LinearProgress 
//                 variant="determinate" 
//                 value={((dashboardData?.priorities?.medium || 0) / Math.max(1, (dashboardData?.priorities?.high || 0) + (dashboardData?.priorities?.medium || 0) + (dashboardData?.priorities?.low || 0))) * 100}
//                 color="warning"
//                 sx={{ mb: 2 }}
//               />
//               
//               <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
//                 <Typography variant="body2">Low Priority</Typography>
//                 <Typography variant="body2">{dashboardData?.priorities?.low || 0}</Typography>
//               </Box>
//               <LinearProgress 
//                 variant="determinate" 
//                 value={((dashboardData?.priorities?.low || 0) / Math.max(1, (dashboardData?.priorities?.high || 0) + (dashboardData?.priorities?.medium || 0) + (dashboardData?.priorities?.low || 0))) * 100}
//                 color="success"
//               />
//             </Box>
//           </CardContent>
//         </Card>
//       </Grid>
//       
//       <Grid item xs={12} md={6}>
//         <Card>
//           <CardContent>
//             <Typography variant="h6" gutterBottom>
//               Task Types
//             </Typography>
//             <Box sx={{ mt: 2 }}>
//               {Object.entries(dashboardData?.types || {}).map(([type, count]) => (
//                 <Box key={type} sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
//                   <Typography variant="body2" sx={{ textTransform: 'capitalize' }}>
//                     {type.replace('_', ' ')}
//                   </Typography>
//                   <Typography variant="body2">{count}</Typography>
//                 </Box>
//               ))}
//             </Box>
//           </CardContent>
//         </Card>
//       </Grid>
//     </Grid>
//   );
// };

export default DealTasksDashboard; 
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
  showCompletedInTodos?: boolean;
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
  showOnlyTodos = false,
  showCompletedInTodos = true
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
      // For contact pages, show ALL tasks for that contact (not just assigned to current user)
      // For salesperson dashboard, show tasks assigned to the current user
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
        async (tasks) => {
          const baseTasks = showOnlyTodos
            ? tasks.filter(t => (t.classification || '').toLowerCase() === 'todo')
            : tasks;
          // Avoid console spam in dashboard contexts; keep logs out of the hot subscription path.

          // Load contact and company data for tasks that have associations
          const contactIds = new Set<string>();
          const companyIds = new Set<string>();
          
          baseTasks.forEach(task => {
            if (task.associations?.contacts) {
              task.associations.contacts.forEach((contact: any) => {
                // Handle both string IDs and object references
                const contactId = typeof contact === 'string' ? contact : contact?.id;
                if (contactId && typeof contactId === 'string') {
                  contactIds.add(contactId);
                } else {
                  console.warn('Invalid contact ID in task associations:', contact);
                }
              });
            }
            if (task.associations?.companies) {
              task.associations.companies.forEach((company: any) => {
                // Handle both string IDs and object references
                const companyId = typeof company === 'string' ? company : company?.id;
                if (companyId && typeof companyId === 'string') {
                  companyIds.add(companyId);
                } else {
                  console.warn('Invalid company ID in task associations:', company);
                }
              });
            }
          });

          // Load contact data if we have contact IDs
          let loadedContacts: any[] = [];
          if (contactIds.size > 0) {
            try {
              const { collection, query, where, getDocs } = await import('firebase/firestore');
              const { db } = await import('../firebase');
              
              const contactIdsArray = Array.from(contactIds);
              // (debug removed)
              
              // Validate all IDs are strings
              const validContactIds = contactIdsArray.filter(id => typeof id === 'string' && id.length > 0);
              // (debug removed)
              
              if (validContactIds.length > 0) {
                const chunk = <T,>(arr: T[], size: number) =>
                  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

                const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
                const chunks = chunk(validContactIds, 30); // Firestore 'in' supports max 30
                const all: any[] = [];
                for (const ids of chunks) {
                  const contactsQuery = query(contactsRef, where('__name__', 'in', ids));
                  const contactsSnapshot = await getDocs(contactsQuery);
                  all.push(...contactsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
                }
                loadedContacts = all;
              }
            } catch (error) {
              console.error('Error loading contacts for tasks:', error);
            }
          }

          // Load company data if we have company IDs
          let loadedCompanies: any[] = [];
          if (companyIds.size > 0) {
            try {
              const { collection, query, where, getDocs } = await import('firebase/firestore');
              const { db } = await import('../firebase');
              
              const companyIdsArray = Array.from(companyIds);
              // (debug removed)
              
              // Validate all IDs are strings
              const validCompanyIds = companyIdsArray.filter(id => typeof id === 'string' && id.length > 0);
              // (debug removed)
              
              if (validCompanyIds.length > 0) {
                const chunk = <T,>(arr: T[], size: number) =>
                  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

                const companiesRef = collection(db, 'tenants', tenantId, 'crm_companies');
                const chunks = chunk(validCompanyIds, 30); // Firestore 'in' supports max 30
                const all: any[] = [];
                for (const ids of chunks) {
                  const companiesQuery = query(companiesRef, where('__name__', 'in', ids));
                  const companiesSnapshot = await getDocs(companiesQuery);
                  all.push(...companiesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
                }
                loadedCompanies = all;
              }
            } catch (error) {
              console.error('Error loading companies for tasks:', error);
            }
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

          // If To-Dos widget requests all todos, override with ALL todos (no date window)
          if (showOnlyTodos) {
            // For entity-focused views (like Contact Details), show ALL todos
            // including future-dated ones. Completed items are excluded from To-Dos.
            const isTodo = (t: any) => (t.classification || '').toLowerCase() === 'todo';
            const isCompleted = (t: any) => String(t.status || '').toLowerCase() === 'completed';

            const openTodos = baseTasks.filter(t => isTodo(t) && !isCompleted(t));
            const completedTodos = baseTasks.filter(t => isTodo(t) && isCompleted(t));

            const sortByDueAsc = (a: any, b: any) => {
              const aDateStr = a.dueDate || a.scheduledDate || '';
              const bDateStr = b.dueDate || b.scheduledDate || '';
              const aDate = aDateStr ? new Date(aDateStr + (aDateStr.length === 10 ? 'T00:00:00' : '')).getTime() : 0;
              const bDate = bDateStr ? new Date(bDateStr + (bDateStr.length === 10 ? 'T00:00:00' : '')).getTime() : 0;
              return aDate - bDate;
            };

            const sortCompletedDesc = (a: any, b: any) => {
              const aTime = (a.completedAt?.toDate?.() || (a.completedAt ? new Date(a.completedAt) : null) ||
                             a.updatedAt?.toDate?.() || (a.updatedAt ? new Date(a.updatedAt) : null) ||
                             (a.dueDate ? new Date(a.dueDate) : null))?.getTime?.() || 0;
              const bTime = (b.completedAt?.toDate?.() || (b.completedAt ? new Date(b.completedAt) : null) ||
                             b.updatedAt?.toDate?.() || (b.updatedAt ? new Date(b.updatedAt) : null) ||
                             (b.dueDate ? new Date(b.dueDate) : null))?.getTime?.() || 0;
              return bTime - aTime;
            };

            const openSorted = openTodos.sort(sortByDueAsc);
            const completedSorted = completedTodos.sort(sortCompletedDesc);
            mainDashboardTasks = showCompletedInTodos ? [...openSorted, ...completedSorted] : openSorted;
          }
          
          // (debug removed)
          
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
          
          // Update the associated contacts and companies with the loaded data
          setAssociatedContacts(loadedContacts);
          setAssociatedCompany(loadedCompanies.length > 0 ? loadedCompanies[0] : null);
          
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
      case 'past due': return 'error';
      case 'due': return 'warning';
      case 'pending': return 'info';
      case 'scheduled': return 'primary';
      default: return 'default';
    }
  };

  // Get task status display
  const getTaskStatusDisplay = (task: any) => {
    if (task.status === 'completed') return 'completed';
    
    // Use dueDate for todos, scheduledDate for appointments
    const dateToUse = task.classification === 'todo' ? task.dueDate : task.scheduledDate;
    if (dateToUse) {
      const scheduledDate = new Date(dateToUse + 'T00:00:00');
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const scheduledDay = new Date(scheduledDate.getFullYear(), scheduledDate.getMonth(), scheduledDate.getDate());
      
      if (scheduledDay < today) return 'Past Due';
      if (scheduledDay.getTime() === today.getTime()) return 'due';
      return 'scheduled';
    }
    
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

    const toDate = (t: any): Date | null => {
      const dateStr = t.dueDate || t.scheduledDate;
      if (!dateStr) return null;
      const d = new Date(dateStr + (String(dateStr).length === 10 ? 'T00:00:00' : ''));
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const isSameDay = (a: Date, b: Date) =>
      a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Dashboard To‑Dos UX: group into Overdue / Today / Upcoming when in To‑Dos mode
    const shouldGroupTodos = showOnlyTodos;
    const overdue: any[] = [];
    const dueToday: any[] = [];
    const upcoming: any[] = [];
    const noDate: any[] = [];

    if (shouldGroupTodos) {
      tasks.forEach((t) => {
        const d = toDate(t);
        if (!d) {
          noDate.push(t);
          return;
        }
        const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        if (day.getTime() < today.getTime()) overdue.push(t);
        else if (isSameDay(day, today)) dueToday.push(t);
        else upcoming.push(t);
      });
    }

    const Section: React.FC<{ title: string; items: any[] }> = ({ title, items }) => {
      if (items.length === 0) return null;
      return (
        <Box sx={{ mb: 1.5 }}>
          <Typography
            variant="caption"
            sx={{ fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6B7280', px: 1 }}
          >
            {title}
          </Typography>
          <Box sx={{ mt: 1 }}>
            {items.map((task) => (
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
                company={associatedCompany || preloadedCompany}
                contacts={associatedContacts || preloadedContacts || []}
                salespeople={preloadedSalespeople || []}
                deals={preloadedDeals || []}
                companies={preloadedCompanies || []}
                variant="compact"
              />
            ))}
          </Box>
        </Box>
      );
    };

    if (shouldGroupTodos) {
      return (
        <Box sx={{ px: 1, pb: 1 }}>
          <Section title="Overdue" items={overdue} />
          <Section title="Today" items={dueToday} />
          <Section title="Upcoming" items={[...upcoming, ...noDate]} />
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
            company={associatedCompany || preloadedCompany}
            contacts={associatedContacts || preloadedContacts || []}
            salespeople={preloadedSalespeople || []}
            deals={preloadedDeals || []}
            companies={preloadedCompanies || []}
            variant={showOnlyTodos ? 'compact' : 'default'}
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
          preloadedContacts={associatedContacts || preloadedContacts}
          preloadedSalespeople={preloadedSalespeople}
          preloadedCompany={associatedCompany || preloadedCompany}
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
          preloadedContacts={associatedContacts || preloadedContacts}
          preloadedSalespeople={preloadedSalespeople}
          preloadedCompany={associatedCompany || preloadedCompany}
        />
      )}
      {activeTab === 2 && (
        <TasksList
          tasks={dashboardData?.completed?.tasks || []}
          emptyStateMessage="No completed tasks"
          preloadedContacts={associatedContacts || preloadedContacts}
          preloadedSalespeople={preloadedSalespeople}
          preloadedCompany={associatedCompany || preloadedCompany}
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
// 🎯 TASK SERVICE - Frontend Service Layer
// Handles all task-related operations and integrates with backend Firebase Functions

import { httpsCallable } from 'firebase/functions';
import { collection, collectionGroup, query, where, onSnapshot } from 'firebase/firestore';

import { functions, db } from '../firebase';
import { CRMTask, TaskDashboard as TaskDashboardData } from '../types/Tasks';

import { ActivityService } from './activityService';

export class TaskService {
  private static instance: TaskService;
  
  private constructor() {
    // Private constructor for singleton pattern
  }
  
  static getInstance(): TaskService {
    if (!TaskService.instance) {
      TaskService.instance = new TaskService();
    }
    return TaskService.instance;
  }

  // 🎯 CORE TASK OPERATIONS
  
  async createTask(taskData: Omit<CRMTask, 'id' | 'createdAt' | 'updatedAt'>): Promise<{ taskId: string; success: boolean }> {
    try {
      const createTaskFunction = httpsCallable(functions, 'createTask');
      const result = await createTaskFunction(taskData);
      const response = result.data as { taskId: string; success: boolean };
      
      // Log activity
      const activityService = new ActivityService(taskData.tenantId, taskData.createdBy);
      await activityService.logTaskActivity(
        'salesperson',
        taskData.assignedTo,
        {
          title: taskData.title,
          description: taskData.description || '',
          status: taskData.status === 'completed' ? 'completed' : 'pending',
          priority: taskData.priority === 'urgent' ? 'high' : taskData.priority
        }
      );
      
      return response;
    } catch (error) {
      console.error('Error creating task:', error);
      throw error;
    }
  }

  async updateTask(taskId: string, updates: Partial<CRMTask>, tenantId: string): Promise<{ success: boolean }> {
    try {
      const updateTaskFunction = httpsCallable(functions, 'updateTask');
      const result = await updateTaskFunction({ taskId, updates, tenantId });
      const response = result.data as { success: boolean };
      
      // Log activity
      if (updates.tenantId && updates.createdBy) {
        const activityService = new ActivityService(updates.tenantId, updates.createdBy);
        await activityService.logTaskActivity(
          'salesperson',
          updates.assignedTo || '',
          {
            title: updates.title || '',
            description: updates.description || '',
            status: updates.status === 'completed' ? 'completed' : 'pending',
            priority: updates.priority === 'urgent' ? 'high' : (updates.priority || 'medium')
          }
        );
      }
      
      return response;
    } catch (error) {
      console.error('Error updating task:', error);
      throw error;
    }
  }

  async completeTask(taskId: string, completionData: { outcome: string; notes?: string }, tenantId: string, userId: string): Promise<{ success: boolean }> {
    try {
      const completeTaskFunction = httpsCallable(functions, 'completeTask');
      const result = await completeTaskFunction({ taskId, completionData, tenantId });
      const response = result.data as { success: boolean };
      
      // Log activity
      const activityService = new ActivityService(tenantId, userId);
      await activityService.logTaskActivity(
        'salesperson',
        userId,
        {
          title: `Completed task`,
          description: completionData.notes || 'Task completed',
          status: 'completed',
          priority: 'medium'
        }
      );
      
      return response;
    } catch (error) {
      console.error('Error completing task:', error);
      throw error;
    }
  }

  async deleteTask(taskId: string, tenantId: string, userId: string): Promise<{ success: boolean }> {
    try {
      const deleteTaskFunction = httpsCallable(functions, 'deleteTask');
      const result = await deleteTaskFunction({ taskId, tenantId });
      const response = result.data as { success: boolean };
      
      // Log activity
      const activityService = new ActivityService(tenantId, userId);
      await activityService.logTaskActivity(
        'salesperson',
        userId,
        {
          title: `Deleted task`,
          description: 'Task was deleted',
          status: 'cancelled',
          priority: 'medium'
        }
      );
      
      return response;
    } catch (error) {
      console.error('Error deleting task:', error);
      throw error;
    }
  }

  // 📅 TASK QUERIES & FILTERING
  
  async getTasks(query: any): Promise<CRMTask[]> {
    try {
      const getTasksFunction = httpsCallable(functions, 'getTasks');
      const result = await getTasksFunction({ query });
      return result.data as CRMTask[];
    } catch (error) {
      console.error('Error fetching tasks:', error);
      throw error;
    }
  }

  async getTasksForDate(date: string, userId?: string): Promise<CRMTask[]> {
    try {
      const getTasksForDateFunction = httpsCallable(functions, 'getTasksForDate');
      const result = await getTasksForDateFunction({ date, userId });
      return result.data as CRMTask[];
    } catch (error) {
      console.error('Error fetching tasks for date:', error);
      throw error;
    }
  }

  async getTaskDashboard(
    userId: string, 
    date: string, 
    tenantId: string,
    filters?: { dealId?: string; companyId?: string; contactId?: string }
  ): Promise<any> {
    try {
      const getTaskDashboardFunction = httpsCallable(functions, 'getTaskDashboard');
      const result = await getTaskDashboardFunction({
        userId,
        date,
        tenantId,
        filters
      });
      return result.data;
    } catch (error) {
      console.error('Error fetching task dashboard:', error);
      throw error;
    }
  }

  // 🚀 QUICK ACTIONS
  
  async quickCompleteTask(taskId: string, tenantId: string, userId: string): Promise<{ success: boolean }> {
    try {
      // Use the more reliable completeTask function instead of quickCompleteTask
      const completeFunction = httpsCallable(functions, 'completeTask');
      const result = await completeFunction({ 
        taskId, 
        tenantId,
        actionResult: 'Quickly completed via UI'
      });
      const response = result.data as { success: boolean };
      
      // Log activity
      const activityService = new ActivityService(tenantId, userId);
      await activityService.logTaskActivity(
        'salesperson',
        userId,
        {
          title: 'Task completed',
          description: 'Task was quickly completed',
          status: 'completed',
          priority: 'medium'
        }
      );
      
      return response;
    } catch (error) {
      console.error('Error quick completing task:', error);
      throw error;
    }
  }

  async postponeTask(taskId: string, newDate: string, tenantId: string, userId: string): Promise<{ success: boolean }> {
    try {
      const postponeFunction = httpsCallable(functions, 'postponeTask');
      const result = await postponeFunction({ taskId, newDate });
      const response = result.data as { success: boolean };
      
      // Log activity
      const activityService = new ActivityService(tenantId, userId);
      await activityService.logTaskActivity(
        'salesperson',
        userId,
        {
          title: 'Task postponed',
          description: `Task postponed to ${newDate}`,
          status: 'pending',
          priority: 'medium'
        }
      );
      
      return response;
    } catch (error) {
      console.error('Error postponing task:', error);
      throw error;
    }
  }

  async rescheduleTask(taskId: string, newDate: string, tenantId: string, userId: string): Promise<{ success: boolean }> {
    try {
      const rescheduleFunction = httpsCallable(functions, 'rescheduleTask');
      const result = await rescheduleFunction({ taskId, newDate });
      const response = result.data as { success: boolean };
      
      // Log activity
      const activityService = new ActivityService(tenantId, userId);
      await activityService.logTaskActivity(
        'salesperson',
        userId,
        {
          title: 'Task rescheduled',
          description: `Task rescheduled to ${newDate}`,
          status: 'pending',
          priority: 'medium'
        }
      );
      
      return response;
    } catch (error) {
      console.error('Error rescheduling task:', error);
      throw error;
    }
  }

  async reassignTask(taskId: string, newAssignee: string, tenantId: string, userId: string): Promise<{ success: boolean }> {
    try {
      const reassignFunction = httpsCallable(functions, 'reassignTask');
      const result = await reassignFunction({ taskId, newAssignee });
      const response = result.data as { success: boolean };
      
      // Log activity
      const activityService = new ActivityService(tenantId, userId);
      await activityService.logTaskActivity(
        'salesperson',
        userId,
        {
          title: 'Task reassigned',
          description: `Task reassigned to ${newAssignee}`,
          status: 'pending',
          priority: 'medium'
        }
      );
      
      return response;
    } catch (error) {
      console.error('Error reassigning task:', error);
      throw error;
    }
  }

  // 🤖 AI TASK SUGGESTIONS
  
  async getAITaskSuggestions(
    userId: string, 
    tenantId: string,
    filters?: { dealId?: string; companyId?: string; contactId?: string; dealStage?: string }
  ): Promise<any[]> {
    try {
      const getAITaskSuggestionsFunction = httpsCallable(functions, 'getAITaskSuggestions');
      const result = await getAITaskSuggestionsFunction({
        userId,
        tenantId,
        filters
      });
      return (result.data as any[]) || [];
    } catch (error) {
      console.error('Error fetching AI task suggestions:', error);
      throw error;
    }
  }

  async acceptAITaskSuggestion(suggestionId: string, tenantId: string, userId: string): Promise<{ taskId: string; success: boolean }> {
    try {
      const acceptSuggestionFunction = httpsCallable(functions, 'acceptAITaskSuggestion');
      const result = await acceptSuggestionFunction({ suggestionId });
      const response = result.data as { taskId: string; success: boolean };
      
      // Log activity
      const activityService = new ActivityService(tenantId, userId);
      await activityService.logTaskActivity(
        'salesperson',
        userId,
        {
          title: 'AI suggestion accepted',
          description: 'AI task suggestion was accepted',
          status: 'completed',
          priority: 'medium'
        }
      );
      
      return response;
    } catch (error) {
      console.error('Error accepting AI task suggestion:', error);
      throw error;
    }
  }

  async rejectAITaskSuggestion(suggestionId: string, reason?: string, tenantId?: string, userId?: string): Promise<{ success: boolean }> {
    try {
      const rejectSuggestionFunction = httpsCallable(functions, 'rejectAITaskSuggestion');
      const result = await rejectSuggestionFunction({ suggestionId, reason });
      const response = result.data as { success: boolean };
      
      // Log activity if tenantId and userId are provided
      if (tenantId && userId) {
        const activityService = new ActivityService(tenantId, userId);
        await activityService.logTaskActivity(
          'salesperson',
          userId,
          {
            title: 'AI suggestion rejected',
            description: reason || 'AI task suggestion was rejected',
            status: 'cancelled',
            priority: 'medium'
          }
        );
      }
      
      return response;
    } catch (error) {
      console.error('Error rejecting AI task suggestion:', error);
      throw error;
    }
  }

  // 📊 TASK ANALYTICS & REPORTING
  
  async getTaskAnalytics(userId: string, period: string): Promise<any> {
    try {
      const getTaskAnalyticsFunction = httpsCallable(functions, 'getTaskAnalytics');
      const result = await getTaskAnalyticsFunction({ userId, period });
      return result.data;
    } catch (error) {
      console.error('Error fetching task analytics:', error);
      throw error;
    }
  }

  // 🎯 TASK CAMPAIGNS
  
  async createTaskCampaign(campaign: Omit<any, 'id' | 'createdAt' | 'updatedAt'>): Promise<any> {
    try {
      const createTaskCampaignFunction = httpsCallable(functions, 'createTaskCampaign');
      const result = await createTaskCampaignFunction({ campaign });
      
      return result.data as any;
    } catch (error) {
      console.error('Error creating task campaign:', error);
      throw error;
    }
  }

  async getTaskCampaigns(tenantId: string, userId?: string): Promise<any[]> {
    try {
      const getTaskCampaignsFunction = httpsCallable(functions, 'getTaskCampaigns');
      const result = await getTaskCampaignsFunction({ tenantId, userId });
      return result.data as any[];
    } catch (error) {
      console.error('Error fetching task campaigns:', error);
      throw error;
    }
  }

  // 📝 TASK TEMPLATES
  
  async createTaskTemplate(template: Omit<any, 'id' | 'createdAt' | 'updatedAt'>): Promise<any> {
    try {
      const createTaskTemplateFunction = httpsCallable(functions, 'createTaskTemplate');
      const result = await createTaskTemplateFunction({ template });
      return result.data as any;
    } catch (error) {
      console.error('Error creating task template:', error);
      throw error;
    }
  }

  async getTaskTemplates(tenantId: string): Promise<any[]> {
    try {
      const getTaskTemplatesFunction = httpsCallable(functions, 'getTaskTemplates');
      const result = await getTaskTemplatesFunction({ tenantId });
      return result.data as any[];
    } catch (error) {
      console.error('Error fetching task templates:', error);
      throw error;
    }
  }

  // 🔔 REMINDERS & NOTIFICATIONS
  
  async getPendingReminders(userId: string): Promise<any[]> {
    try {
      const getPendingRemindersFunction = httpsCallable(functions, 'getPendingReminders');
      const result = await getPendingRemindersFunction({ userId });
      return result.data as any[];
    } catch (error) {
      console.error('Error fetching pending reminders:', error);
      throw error;
    }
  }

  // 🎯 BATCH OPERATIONS
  
  async batchTaskOperation(operation: any): Promise<void> {
    try {
      const batchTaskOperationFunction = httpsCallable(functions, 'batchTaskOperation');
      await batchTaskOperationFunction({ operation });
    } catch (error) {
      console.error('Error performing batch task operation:', error);
      throw error;
    }
  }

  // 📅 CALENDAR INTEGRATION
  
  async getCalendarView(userId: string, startDate: string, endDate: string): Promise<any[]> {
    try {
      const getCalendarViewFunction = httpsCallable(functions, 'getCalendarView');
      const result = await getCalendarViewFunction({ userId, startDate, endDate });
      return result.data as any[];
    } catch (error) {
      console.error('Error fetching calendar view:', error);
      throw error;
    }
  }

  // 🔄 REAL-TIME UPDATES
  
  subscribeToTaskUpdates(userId: string, tenantId: string, callback: (tasks: CRMTask[]) => void): () => void {
    const tasksRef = collection(db, 'tenants', tenantId, 'tasks');
    const q = query(tasksRef, where('assignedTo', '==', userId));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const tasks: CRMTask[] = [];
      snapshot.forEach((doc) => {
        tasks.push({ id: doc.id, ...doc.data() } as CRMTask);
      });
      callback(tasks);
    }, (error) => {
      console.error('Error listening to task updates:', error);
    });
    
    return unsubscribe;
  }

  subscribeToTasks(
    userId: string, 
    tenantId: string,
    filters: { dealId?: string; companyId?: string; contactId?: string } = {},
    callback: (tasks: any[]) => void
  ): () => void {
    const tasksRef = collection(db, 'tenants', tenantId, 'tasks');
    
    // Build query based on filters
    let primaryQuery;
    
    // Special handling for dealId: support both schemas
    if (filters.dealId) {
      const crmTasksRef = collection(db, 'tenants', tenantId, 'crm_tasks');
      // Collection group fallback across any nested tasks collections
      const cgTasks = collectionGroup(db as any, 'tasks');
      const qByAssociations = query(tasksRef, where('associations.deals', 'array-contains', filters.dealId));
      const qByTopLevel = query(tasksRef, where('deals', 'array-contains', filters.dealId));
      const qCrmAssoc = query(crmTasksRef, where('associations.deals', 'array-contains', filters.dealId));
      const qCrmTop = query(crmTasksRef, where('deals', 'array-contains', filters.dealId));

      let assocTasks: any[] = [];
      let topLevelTasks: any[] = [];
      let crmAssocTasks: any[] = [];
      let crmTopTasks: any[] = [];
      let cgAssocTasks: any[] = [];

      const combineAndEmit = () => {
        const byId = new Map<string, any>();
        [...assocTasks, ...topLevelTasks, ...crmAssocTasks, ...crmTopTasks, ...cgAssocTasks].forEach((t) => byId.set(t.id, t));
        const tasks = Array.from(byId.values());
        // Sort: open first by due date, then completed by completion date
        const sortedTasks = tasks.sort((a, b) => {
          const aIsCompleted = a.status === 'completed';
          const bIsCompleted = b.status === 'completed';
          if (aIsCompleted && !bIsCompleted) return 1;
          if (!aIsCompleted && bIsCompleted) return -1;
          if (aIsCompleted && bIsCompleted) {
            const aDate = a.completedAt ? new Date(a.completedAt).getTime() : 0;
            const bDate = b.completedAt ? new Date(b.completedAt).getTime() : 0;
            return bDate - aDate;
          }
          const aDate = a.dueDate ? new Date(a.dueDate + 'T00:00:00').getTime() : 0;
          const bDate = b.dueDate ? new Date(b.dueDate + 'T00:00:00').getTime() : 0;
          return aDate - bDate;
        });
        callback(sortedTasks);
      };

      const unsubA = onSnapshot(qByAssociations, (snapshot) => {
        if (process.env.NODE_ENV === 'development') {
          console.log('🔎 TaskService(deal): assoc.deals snapshot size =', snapshot.size);
        }
        const list: any[] = [];
        snapshot.forEach((doc) => list.push({ id: doc.id, ...doc.data() }));
        if (process.env.NODE_ENV === 'development') {
          try {
            console.log('🔎 TaskService(deal): assoc.deals tasks =>', list.map((t:any) => ({
              id: t.id,
              title: t.title,
              assignedTo: t.assignedTo,
              status: t.status,
              classification: t.classification,
              deals: t.associations?.deals
            })));
          } catch {}
        }
        assocTasks = list;
        combineAndEmit();
      }, (error) => console.error('Error listening to deal-associations tasks:', error));

      const unsubB = onSnapshot(qByTopLevel, (snapshot) => {
        if (process.env.NODE_ENV === 'development') {
          console.log('🔎 TaskService(deal): top-level deals snapshot size =', snapshot.size);
        }
        const list: any[] = [];
        snapshot.forEach((doc) => list.push({ id: doc.id, ...doc.data() }));
        if (process.env.NODE_ENV === 'development') {
          try {
            console.log('🔎 TaskService(deal): top-level deals tasks =>', list.map((t:any) => ({
              id: t.id,
              title: t.title,
              assignedTo: t.assignedTo,
              status: t.status,
              classification: t.classification,
              deals: t.deals
            })));
          } catch {}
        }
        topLevelTasks = list;
        combineAndEmit();
      }, (error) => console.error('Error listening to deal top-level tasks:', error));

      const unsubC = onSnapshot(qCrmAssoc, (snapshot) => {
        if (process.env.NODE_ENV === 'development') {
          console.log('🔎 TaskService(deal): CRM assoc.deals snapshot size =', snapshot.size);
        }
        const list: any[] = [];
        snapshot.forEach((doc) => list.push({ id: doc.id, ...doc.data() }));
        if (process.env.NODE_ENV === 'development') {
          try {
            console.log('🔎 TaskService(deal): CRM assoc.deals tasks =>', list.map((t:any) => ({
              id: t.id,
              title: t.title,
              assignedTo: t.assignedTo,
              status: t.status,
              classification: t.classification,
              deals: t.associations?.deals
            })));
          } catch {}
        }
        crmAssocTasks = list;
        combineAndEmit();
      }, (error) => console.error('Error listening to CRM deal-associations tasks:', error));

      const unsubD = onSnapshot(qCrmTop, (snapshot) => {
        if (process.env.NODE_ENV === 'development') {
          console.log('🔎 TaskService(deal): CRM top-level deals snapshot size =', snapshot.size);
        }
        const list: any[] = [];
        snapshot.forEach((doc) => list.push({ id: doc.id, ...doc.data() }));
        if (process.env.NODE_ENV === 'development') {
          try {
            console.log('🔎 TaskService(deal): CRM top-level deals tasks =>', list.map((t:any) => ({
              id: t.id,
              title: t.title,
              assignedTo: t.assignedTo,
              status: t.status,
              classification: t.classification,
              deals: t.deals
            })));
          } catch {}
        }
        crmTopTasks = list;
        combineAndEmit();
      }, (error) => console.error('Error listening to CRM deal top-level tasks:', error));

      // Collection group listener (fallback)
      const cgQuery = query(cgTasks as any,
        where('tenantId', '==', tenantId),
        where('associations.deals', 'array-contains', filters.dealId)
      );
      const unsubE = onSnapshot(cgQuery as any, (snapshot) => {
        if (process.env.NODE_ENV === 'development') {
          console.log('🔎 TaskService(deal): collectionGroup assoc.deals snapshot size =', snapshot.size);
        }
        const list: any[] = [];
        snapshot.forEach((doc) => list.push({ id: doc.id, ...doc.data() }));
        if (process.env.NODE_ENV === 'development') {
          try {
            console.log('🔎 TaskService(deal): collectionGroup assoc.deals tasks =>', list.map((t:any) => ({
              id: t.id,
              title: t.title,
              assignedTo: t.assignedTo,
              status: t.status,
              classification: t.classification,
              deals: t.associations?.deals
            })));
          } catch {}
        }
        cgAssocTasks = list;
        combineAndEmit();
      }, (error) => {
        // Many projects disallow collectionGroup reads in rules; treat as optional
        // and silence the noisy console error if it's a permission issue.
        // We already have primary listeners on tenant-scoped collections.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const code = (error as any)?.code || (error as any)?.message;
        if (code === 'permission-denied' || (typeof code === 'string' && code.includes('insufficient permissions'))) {
          if (process.env.NODE_ENV === 'development') {
            console.log('ℹ️ Skipping collectionGroup fallback due to security rules. This is safe.');
          }
          return;
        }
        console.error('Error listening to collectionGroup tasks:', error);
      });

      return () => {
        unsubA();
        unsubB();
        unsubC();
        unsubD();
        unsubE();
      };
    } else {
      // Salesperson dashboard: include tasks assigned to user OR where user is in associations.salespeople
      // Build two listeners and merge results
      const qAssigned = query(tasksRef, where('assignedTo', '==', userId));
      const qBySalesperson = query(tasksRef, where('associations.salespeople', 'array-contains', userId));

      let assignedTasks: any[] = [];
      let salespersonTasks: any[] = [];

      const emitMerged = () => {
        const byId = new Map<string, any>();
        [...assignedTasks, ...salespersonTasks].forEach((t) => byId.set(t.id, t));
        const tasks = Array.from(byId.values());
        const sortedTasks = tasks.sort((a, b) => {
          const aIsCompleted = a.status === 'completed';
          const bIsCompleted = b.status === 'completed';
          if (aIsCompleted && !bIsCompleted) return 1;
          if (!aIsCompleted && bIsCompleted) return -1;
          if (aIsCompleted && bIsCompleted) {
            const aDate = a.completedAt ? new Date(a.completedAt).getTime() : 0;
            const bDate = b.completedAt ? new Date(b.completedAt).getTime() : 0;
            return bDate - aDate;
          }
          const aDate = a.dueDate ? new Date(a.dueDate + 'T00:00:00').getTime() : 0;
          const bDate = b.dueDate ? new Date(b.dueDate + 'T00:00:00').getTime() : 0;
          return aDate - bDate;
        });
        callback(sortedTasks);
      };

      const unsubAssigned = onSnapshot(qAssigned, (snapshot) => {
        const list: any[] = [];
        snapshot.forEach((doc) => list.push({ id: doc.id, ...doc.data() }));
        assignedTasks = list;
        emitMerged();
      }, (error) => console.error('Error listening to assigned tasks:', error));

      const unsubSalesperson = onSnapshot(qBySalesperson, (snapshot) => {
        const list: any[] = [];
        snapshot.forEach((doc) => list.push({ id: doc.id, ...doc.data() }));
        salespersonTasks = list;
        emitMerged();
      }, (error) => console.error('Error listening to salesperson-associated tasks:', error));

      return () => {
        unsubAssigned();
        unsubSalesperson();
      };
    }
  }

  private processTasksIntoDashboard(tasks: any[], date: string): any {
    const today = new Date(date);
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());
    
    const todayTasks = tasks.filter(task => {
      const taskDate = task.dueDate || task.scheduledDate;
      if (!taskDate) return false;
      const taskDateObj = new Date(taskDate + 'T00:00:00');
      return taskDateObj.toDateString() === today.toDateString();
    });
    
    const thisWeekTasks = tasks.filter(task => {
      const taskDate = task.dueDate || task.scheduledDate;
      if (!taskDate) return false;
      const taskDateObj = new Date(taskDate + 'T00:00:00');
      return taskDateObj >= startOfWeek && taskDateObj <= today;
    });
    
    const completedTasks = tasks.filter(task => task.status === 'completed');
    
    return {
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
          percentage: 0,
          completed: 0,
          target: 0
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
  }

  // 🎯 UTILITY METHODS
  
  getTaskStatusColor(status: string): string {
    const statusColors = {
      upcoming: '#87CEEB', // Light Blue
      due: '#FFA500', // Orange
      completed: '#32CD32', // Green
      postponed: '#808080', // Gray
      cancelled: '#FF0000', // Red
      in_progress: '#FFD700', // Gold
      draft: '#D3D3D3' // Light Gray
    };
    return statusColors[status as keyof typeof statusColors] || '#000000';
  }

  getTaskTypeIcon(type: string): string {
    const typeIcons = {
      email: '📧',
      phone_call: '📞',
      in_person_drop_by: '🏢',
      scheduled_meeting_in_person: '🤝',
      scheduled_meeting_virtual: '💻',
      linkedin_message: '💼',
      send_gift: '🎁',
      custom: '📝',
      research: '🔍',
      proposal_preparation: '📋',
      contract_review: '📄',
      follow_up: '🔄',
      check_in: '✅',
      presentation: '📊',
      demo: '🎬',
      negotiation: '🤝',
      closing: '💰',
      administrative: '📋'
    };
    return typeIcons[type as keyof typeof typeIcons] || '📝';
  }

  calculateTaskUrgency(task: CRMTask): number {
    const now = new Date();
    const dueDate = task.dueDate ? new Date(task.dueDate) : new Date(task.scheduledDate);
    const daysUntilDue = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    
    let urgency = 5; // Base urgency
    
    // Adjust based on priority
    switch (task.priority) {
      case 'urgent': urgency += 3; break;
      case 'high': urgency += 2; break;
      case 'medium': urgency += 1; break;
      case 'low': urgency -= 1; break;
    }
    
    // Adjust based on time until due
    if (daysUntilDue < 0) urgency += 3; // Overdue
    else if (daysUntilDue === 0) urgency += 2; // Due today
    else if (daysUntilDue <= 1) urgency += 1; // Due tomorrow
    
    return Math.min(10, Math.max(1, urgency));
  }

  async generateTaskContent(taskId: string, tenantId: string, userId: string): Promise<any> {
    try {
      const generateTaskContentFunction = httpsCallable(functions, 'generateTaskContent');
      const result = await generateTaskContentFunction({
        taskId,
        tenantId,
        userId
      });
      return result.data;
    } catch (error) {
      console.error('Error generating task content:', error);
      throw error;
    }
  }
} 
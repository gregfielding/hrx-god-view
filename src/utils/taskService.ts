// 🎯 TASK SERVICE - Frontend Service Layer
// Handles all task-related operations and integrates with backend Firebase Functions

import { httpsCallable } from 'firebase/functions';
import { collection, collectionGroup, query, where, onSnapshot } from 'firebase/firestore';

import { functions, db } from '../firebase';
import { CRMTask, TaskDashboard } from '../types/Tasks';

// Define the interface that components expect
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
      
      // Activity logging temporarily disabled
      
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
      
      // Activity logging temporarily disabled
      
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
      
      // Activity logging temporarily disabled
      
      return response;
    } catch (error) {
      console.error('Error completing task:', error);
      throw error;
    }
  }

  async quickCompleteTask(taskId: string, tenantId: string, userId: string): Promise<{ success: boolean }> {
    try {
      const quickCompleteTaskFunction = httpsCallable(functions, 'quickCompleteTask');
      const result = await quickCompleteTaskFunction({ taskId, tenantId });
      const response = result.data as { success: boolean };
      
      // Activity logging temporarily disabled
      
      return response;
    } catch (error) {
      console.error('Error quick completing task:', error);
      throw error;
    }
  }

  async deleteTask(taskId: string, tenantId: string, userId?: string): Promise<{ success: boolean }> {
    try {
      const deleteTaskFunction = httpsCallable(functions, 'deleteTask');
      const result = await deleteTaskFunction({ taskId, tenantId, userId });
      const response = result.data as { success: boolean };
      
      // Activity logging temporarily disabled
      
      return response;
    } catch (error) {
      console.error('Error deleting task:', error);
      throw error;
    }
  }

  async getTasks(tenantId: string, filters: any = {}): Promise<CRMTask[]> {
    try {
      const getTasksFunction = httpsCallable(functions, 'getTasks');
      const result = await getTasksFunction({ tenantId, filters });
      const response = result.data as CRMTask[];
      
      // Activity logging temporarily disabled
      
      return response;
    } catch (error) {
      console.error('Error getting tasks:', error);
      throw error;
    }
  }

  async getTasksForDate(tenantId: string, date: string, userId?: string, filters?: any): Promise<CRMTask[]> {
    try {
      const getTasksForDateFunction = httpsCallable(functions, 'getTasksForDate');
      const result = await getTasksForDateFunction({ tenantId, date, userId, filters });
      const response = result.data as CRMTask[];
      
      // Activity logging temporarily disabled
      
      return response;
    } catch (error) {
      console.error('Error getting tasks for date:', error);
      throw error;
    }
  }

  async getTaskDashboard(tenantId: string, userId: string, date?: string, filters?: any): Promise<TaskDashboardData> {
    try {
      const getTaskDashboardFunction = httpsCallable(functions, 'getTaskDashboard');
      const result = await getTaskDashboardFunction({ tenantId, userId, date, filters });
      const response = result.data as TaskDashboardData;
      
      // Activity logging temporarily disabled
      
      return response;
    } catch (error) {
      console.error('Error getting task dashboard:', error);
      throw error;
    }
  }

  async getAITaskSuggestions(userId: string, tenantId: string, filters?: any): Promise<any[]> {
    try {
      const getAITaskSuggestionsFunction = httpsCallable(functions, 'getAITaskSuggestions');
      const result = await getAITaskSuggestionsFunction({ userId, tenantId, filters });
      const response = result.data as any[];
      
      // Activity logging temporarily disabled
      
      return response;
    } catch (error) {
      console.error('Error getting AI task suggestions:', error);
      throw error;
    }
  }

  async acceptAITaskSuggestion(suggestionId: string, tenantId: string, userId: string): Promise<{ success: boolean }> {
    try {
      const acceptAITaskSuggestionFunction = httpsCallable(functions, 'acceptAITaskSuggestion');
      const result = await acceptAITaskSuggestionFunction({ suggestionId, tenantId, userId });
      const response = result.data as { success: boolean };
      
      // Activity logging temporarily disabled
      
      return response;
    } catch (error) {
      console.error('Error accepting AI task suggestion:', error);
      throw error;
    }
  }

  async rejectAITaskSuggestion(suggestionId: string, tenantId: string, userId: string): Promise<{ success: boolean }> {
    try {
      const rejectAITaskSuggestionFunction = httpsCallable(functions, 'rejectAITaskSuggestion');
      const result = await rejectAITaskSuggestionFunction({ suggestionId, tenantId, userId });
      const response = result.data as { success: boolean };
      
      // Activity logging temporarily disabled
      
      return response;
    } catch (error) {
      console.error('Error rejecting AI task suggestion:', error);
      throw error;
    }
  }

  async getDealStageAISuggestions(dealId: string, tenantId: string, userId: string): Promise<any[]> {
    try {
      const getDealStageAISuggestionsFunction = httpsCallable(functions, 'getDealStageAISuggestions');
      const result = await getDealStageAISuggestionsFunction({ dealId, tenantId, userId });
      const response = result.data as any[];
      
      // Activity logging temporarily disabled
      
      return response;
    } catch (error) {
      console.error('Error getting deal stage AI suggestions:', error);
      throw error;
    }
  }

  async generateTaskContent(taskId: string, tenantId: string, userId: string): Promise<{ success: boolean; content: any; suggestions?: any[]; insights?: any[] }> {
    try {
      const generateTaskContentFunction = httpsCallable(functions, 'generateTaskContent');
      const result = await generateTaskContentFunction({ taskId, tenantId, userId });
      const response = result.data as { title: string; description: string };
      
      // Activity logging temporarily disabled
      
      // Convert to the format expected by components
      return {
        success: true,
        content: {
          title: response.title,
          description: response.description
        },
        suggestions: [],
        insights: []
      };
    } catch (error) {
      console.error('Error generating task content:', error);
      throw error;
    }
  }

  async createNextRepeatingTask(taskId: string, tenantId: string, userId: string): Promise<{ taskId: string; success: boolean }> {
    try {
      const createNextRepeatingTaskFunction = httpsCallable(functions, 'createNextRepeatingTask');
      const result = await createNextRepeatingTaskFunction({ taskId, tenantId, userId });
      const response = result.data as { taskId: string; success: boolean };
      
      // Activity logging temporarily disabled
      
      return response;
    } catch (error) {
      console.error('Error creating next repeating task:', error);
      throw error;
    }
  }

  // 🎯 REAL-TIME SUBSCRIPTIONS
  
  subscribeToTasks(
    userId: string, 
    tenantId: string,
    filters: { dealId?: string; companyId?: string; contactId?: string; assignedTo?: string } = {},
    callback: (tasks: any[]) => void
  ): () => void {
    console.log('🔍 Subscribing to tasks with filters:', filters);
    
    const tasksRef = collection(db, 'tenants', tenantId, 'tasks');
    const crmTasksRef = collection(db, 'tenants', tenantId, 'crm_tasks');
    
    const unsubscribeTasks: (() => void) | null = null;
    const unsubscribeCrmTasks: (() => void) | null = null;
    
    const taskSources = new Map<string, any[]>(); // Track tasks by source to avoid duplicates
    
    const updateCallback = () => {
      // Merge all task sources and remove duplicates
      const mergedTasks = new Map<string, any>();
      
      taskSources.forEach((tasks, source) => {
        tasks.forEach(task => {
          mergedTasks.set(task.id, task);
        });
      });
      
      // Convert to array and sort by creation date (newest first)
      const sortedTasks = Array.from(mergedTasks.values()).sort((a, b) => {
        const aDate = a.createdAt?.toDate?.() || a.createdAt || new Date(0);
        const bDate = b.createdAt?.toDate?.() || b.createdAt || new Date(0);
        return bDate.getTime() - aDate.getTime();
      });
      
      callback(sortedTasks);
    };
    
    if (filters.dealId) {
      // Deal page: show tasks related to this deal
      const qByDealId = query(tasksRef, where('dealId', '==', filters.dealId));
      const qByAssociations = query(tasksRef, where('associations.deals', 'array-contains', filters.dealId));
      const qCrmByDealId = query(crmTasksRef, where('dealId', '==', filters.dealId));
      const qCrmByAssociations = query(crmTasksRef, where('associations.deals', 'array-contains', filters.dealId));
      
      // Listen to all four queries and merge results
      const listeners = [
        onSnapshot(qByDealId, (snapshot) => {
          const tasks = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, source: 'tasks' }));
          taskSources.set('dealId-tasks', tasks);
          updateCallback();
        }),
        onSnapshot(qByAssociations, (snapshot) => {
          const tasks = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, source: 'tasks' }));
          taskSources.set('dealAssociations-tasks', tasks);
          updateCallback();
        }),
        onSnapshot(qCrmByDealId, (snapshot) => {
          const tasks = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, source: 'crm_tasks' }));
          taskSources.set('dealId-crm_tasks', tasks);
          updateCallback();
        }),
        onSnapshot(qCrmByAssociations, (snapshot) => {
          const tasks = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, source: 'crm_tasks' }));
          taskSources.set('dealAssociations-crm_tasks', tasks);
          updateCallback();
        })
      ];
      
      return () => listeners.forEach(unsubscribe => unsubscribe());
      
    } else if (filters.companyId) {
      // Company page: show tasks related to this company
      const qByCompanyId = query(tasksRef, where('companyId', '==', filters.companyId));
      const qByAssociations = query(tasksRef, where('associations.companies', 'array-contains', filters.companyId));
      const qCrmByCompanyId = query(crmTasksRef, where('companyId', '==', filters.companyId));
      const qCrmByAssociations = query(crmTasksRef, where('associations.companies', 'array-contains', filters.companyId));
      
      // Listen to all four queries and merge results
      const listeners = [
        onSnapshot(qByCompanyId, (snapshot) => {
          const tasks = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, source: 'tasks' }));
          taskSources.set('companyId-tasks', tasks);
          updateCallback();
        }),
        onSnapshot(qByAssociations, (snapshot) => {
          const tasks = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, source: 'tasks' }));
          taskSources.set('companyAssociations-tasks', tasks);
          updateCallback();
        }),
        onSnapshot(qCrmByCompanyId, (snapshot) => {
          const tasks = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, source: 'crm_tasks' }));
          taskSources.set('companyId-crm_tasks', tasks);
          updateCallback();
        }),
        onSnapshot(qCrmByAssociations, (snapshot) => {
          const tasks = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, source: 'crm_tasks' }));
          taskSources.set('companyAssociations-crm_tasks', tasks);
          updateCallback();
        })
      ];
      
      return () => listeners.forEach(unsubscribe => unsubscribe());
      
    } else if (filters.contactId) {
      // Contact page: show ALL tasks for this contact (regardless of assignment)
      // This includes tasks assigned to the contact, tasks where contact is in associations, etc.
      const crmTasksRef = collection(db, 'tenants', tenantId, 'crm_tasks'); // Added this line
      const qByContactId = query(tasksRef, where('contactId', '==', filters.contactId));
      const qByAssociations = query(tasksRef, where('associations.contacts', 'array-contains', filters.contactId));
      const qCrmByContactId = query(crmTasksRef, where('contactId', '==', filters.contactId));
      const qCrmByAssociations = query(crmTasksRef, where('associations.contacts', 'array-contains', filters.contactId));
      
      // Listen to all four queries and merge results
      const listeners = [
        onSnapshot(qByContactId, (snapshot) => {
          const tasks = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, source: 'tasks' }));
          taskSources.set('contactId-tasks', tasks);
          updateCallback();
        }),
        onSnapshot(qByAssociations, (snapshot) => {
          const tasks = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, source: 'tasks' }));
          taskSources.set('contactAssociations-tasks', tasks);
          updateCallback();
        }),
        onSnapshot(qCrmByContactId, (snapshot) => {
          const tasks = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, source: 'crm_tasks' }));
          taskSources.set('contactId-crm_tasks', tasks);
          updateCallback();
        }),
        onSnapshot(qCrmByAssociations, (snapshot) => {
          const tasks = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, source: 'crm_tasks' }));
          taskSources.set('contactAssociations-crm_tasks', tasks);
          updateCallback();
        })
      ];
      
      return () => listeners.forEach(unsubscribe => unsubscribe());
      
    } else if (filters.assignedTo) { // This handles the salesperson dashboard case
      // Salesperson dashboard: include tasks assigned to user OR where user is in associations.salespeople
      // Note: assignedTo can be either a string or an array, so we need to handle both cases
      const qAssigned = query(tasksRef, where('assignedTo', '==', filters.assignedTo));
      const qAssignedArray = query(tasksRef, where('assignedTo', 'array-contains', filters.assignedTo));
      const qBySalesperson = query(tasksRef, where('associations.salespeople', 'array-contains', filters.assignedTo));
      const qCrmAssigned = query(crmTasksRef, where('assignedTo', '==', filters.assignedTo));
      const qCrmAssignedArray = query(crmTasksRef, where('assignedTo', 'array-contains', filters.assignedTo));
      const qCrmBySalesperson = query(crmTasksRef, where('associations.salespeople', 'array-contains', filters.assignedTo));
      
      // Listen to all six queries and merge results
      const listeners = [
        onSnapshot(qAssigned, (snapshot) => {
          const tasks = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, source: 'tasks' }));
          taskSources.set('assigned-tasks', tasks);
          updateCallback();
        }),
        onSnapshot(qAssignedArray, (snapshot) => {
          const tasks = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, source: 'tasks' }));
          taskSources.set('assignedArray-tasks', tasks);
          updateCallback();
        }),
        onSnapshot(qBySalesperson, (snapshot) => {
          const tasks = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, source: 'tasks' }));
          taskSources.set('salespersonAssociations-tasks', tasks);
          updateCallback();
        }),
        onSnapshot(qCrmAssigned, (snapshot) => {
          const tasks = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, source: 'crm_tasks' }));
          taskSources.set('assigned-crm_tasks', tasks);
          updateCallback();
        }),
        onSnapshot(qCrmAssignedArray, (snapshot) => {
          const tasks = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, source: 'crm_tasks' }));
          taskSources.set('assignedArray-crm_tasks', tasks);
          updateCallback();
        }),
        onSnapshot(qCrmBySalesperson, (snapshot) => {
          const tasks = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, source: 'crm_tasks' }));
          taskSources.set('salespersonAssociations-crm_tasks', tasks);
          updateCallback();
        })
      ];
      
      return () => listeners.forEach(unsubscribe => unsubscribe());
      
    } else {
      // Default: no specific filter, perhaps show all or handle a different default
      const q = query(tasksRef);
      const qCrm = query(crmTasksRef);
      
      const listeners = [
        onSnapshot(q, (snapshot) => {
          const tasks = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, source: 'tasks' }));
          taskSources.set('default-tasks', tasks);
          updateCallback();
        }),
        onSnapshot(qCrm, (snapshot) => {
          const tasks = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, source: 'crm_tasks' }));
          taskSources.set('default-crm_tasks', tasks);
          updateCallback();
        })
      ];
      
      return () => listeners.forEach(unsubscribe => unsubscribe());
    }
  }
}

// Export singleton instance
export const taskService = TaskService.getInstance(); 
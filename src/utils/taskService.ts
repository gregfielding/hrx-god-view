// 🎯 TASK SERVICE - Frontend Service Layer
// Handles all task-related operations and integrates with backend Firebase Functions

import { httpsCallable } from 'firebase/functions';

import { functions } from '../firebase';
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
      const quickCompleteFunction = httpsCallable(functions, 'quickCompleteTask');
      const result = await quickCompleteFunction({ taskId });
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
  
  // TODO: Implement real-time subscription for task updates
  subscribeToTaskUpdates(userId: string, callback: (tasks: CRMTask[]) => void): () => void {
    // TODO: Implement Firebase real-time listener
    console.log('Real-time task subscription not yet implemented');
    return () => {
      console.log('Unsubscribing from task updates');
    }; // Return unsubscribe function
  }

  // TODO: Implement real-time subscription for dashboard updates
  subscribeToDashboardUpdates(userId: string, callback: (dashboard: TaskDashboardData) => void): () => void {
    // TODO: Implement Firebase real-time listener
    console.log('Real-time dashboard subscription not yet implemented');
    return () => {
      console.log('Unsubscribing from dashboard updates');
    }; // Return unsubscribe function
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
import { getFunctions, httpsCallable } from 'firebase/functions';
import { TaskService } from './taskService';

const functions = getFunctions();

// Gmail-Tasks Integration Service
export class GmailTasksService {
  private static instance: GmailTasksService;
  private taskService: TaskService;

  private constructor() {
    this.taskService = TaskService.getInstance();
  }

  public static getInstance(): GmailTasksService {
    if (!GmailTasksService.instance) {
      GmailTasksService.instance = new GmailTasksService();
    }
    return GmailTasksService.instance;
  }

  // Sync Gmail emails and create tasks
  async syncGmailAndCreateTasks(tenantId: string, userId: string) {
    try {
      const syncGmailAndCreateTasksFn = httpsCallable(functions, 'syncGmailAndCreateTasks');
      const result = await syncGmailAndCreateTasksFn({ tenantId, userId });
      
      const data = result.data as any;
      console.log('Gmail sync result:', data);
      
      return {
        success: data.success,
        emailsAnalyzed: data.emailsAnalyzed,
        tasksCreated: data.tasksCreated,
        message: data.message
      };
    } catch (error: any) {
      console.error('Error syncing Gmail and creating tasks:', error);
      throw new Error(`Failed to sync Gmail: ${error.message}`);
    }
  }

  // Sync Gmail calendar events as tasks
  async syncGmailCalendarAsTasks(tenantId: string, userId: string) {
    try {
      const syncGmailCalendarAsTasksFn = httpsCallable(functions, 'syncGmailCalendarAsTasks');
      const result = await syncGmailCalendarAsTasksFn({ tenantId, userId });
      
      const data = result.data as any;
      console.log('Calendar sync result:', data);
      
      return {
        success: data.success,
        eventsProcessed: data.eventsProcessed,
        tasksCreated: data.tasksCreated,
        message: data.message
      };
    } catch (error: any) {
      console.error('Error syncing Gmail calendar as tasks:', error);
      throw new Error(`Failed to sync calendar: ${error.message}`);
    }
  }

  // Send email task via Gmail
  async sendEmailTaskViaGmail(taskId: string, tenantId: string) {
    try {
      const sendEmailTaskViaGmailFn = httpsCallable(functions, 'sendEmailTaskViaGmail');
      const result = await sendEmailTaskViaGmailFn({ taskId, tenantId });
      
      const data = result.data as any;
      console.log('Email send result:', data);
      
      return {
        success: data.success,
        messageId: data.messageId,
        message: data.message
      };
    } catch (error: any) {
      console.error('Error sending email task via Gmail:', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  // Complete sync (emails + calendar)
  async completeGmailSync(tenantId: string, userId: string) {
    try {
      const results = await Promise.all([
        this.syncGmailAndCreateTasks(tenantId, userId),
        this.syncGmailCalendarAsTasks(tenantId, userId)
      ]);

      const emailResult = results[0];
      const calendarResult = results[1];

      return {
        success: emailResult.success && calendarResult.success,
        emailSync: emailResult,
        calendarSync: calendarResult,
        totalTasksCreated: emailResult.tasksCreated + calendarResult.tasksCreated,
        message: `Sync completed: ${emailResult.tasksCreated + calendarResult.tasksCreated} tasks created`
      };
    } catch (error: any) {
      console.error('Error in complete Gmail sync:', error);
      throw new Error(`Failed to complete sync: ${error.message}`);
    }
  }

  // Get sync status and statistics
  async getGmailSyncStatus(tenantId: string) {
    try {
      // This would typically call a function to get sync statistics
      // For now, we'll return a basic status
      return {
        lastSync: new Date().toISOString(),
        status: 'ready',
        message: 'Gmail integration ready for sync'
      };
    } catch (error: any) {
      console.error('Error getting Gmail sync status:', error);
      throw new Error(`Failed to get sync status: ${error.message}`);
    }
  }
} 
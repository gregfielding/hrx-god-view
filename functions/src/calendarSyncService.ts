import { getFirestore } from 'firebase-admin/firestore';
import { google } from 'googleapis';
import { defineString } from 'firebase-functions/params';

const db = getFirestore();

// Fix OAuth configuration to use consistent parameter definitions
const clientId = defineString('GOOGLE_CLIENT_ID');
const clientSecret = defineString('GOOGLE_CLIENT_SECRET');
const redirectUri = defineString('GOOGLE_REDIRECT_URI');

const oauth2Client = new google.auth.OAuth2(
  clientId.value(),
  clientSecret.value(),
  redirectUri.value()
);

/**
 * Sync task to Google Calendar
 */
export async function syncTaskToCalendar(userId: string, tenantId: string, taskId: string, taskData: any, userTimezone: string = 'America/Los_Angeles') {
  try {
    console.log(`🔄 Starting calendar sync for task ${taskId} (user: ${userId})`);
    
    // Get user's Calendar tokens
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      console.log(`❌ User ${userId} not found`);
      return { success: false, message: 'User not found' };
    }

    const userData = userDoc.data();
    const calendarTokens = userData?.calendarTokens;

    if (!calendarTokens?.access_token) {
      console.log(`❌ Google Calendar not connected for user: ${userId}`);
      return { success: false, message: 'Google Calendar not connected. Please authenticate first.' };
    }

    // Check if token is expired and needs refresh
    if (calendarTokens.expiry_date && new Date(calendarTokens.expiry_date) <= new Date()) {
      console.log(`🔄 Token expired for user ${userId}, attempting refresh...`);
      try {
        oauth2Client.setCredentials(calendarTokens);
        const { credentials } = await oauth2Client.refreshAccessToken();
        
        // Update user's tokens
        await db.collection('users').doc(userId).update({
          calendarTokens: {
            ...calendarTokens,
            access_token: credentials.access_token,
            expiry_date: credentials.expiry_date
          }
        });
        
        console.log(`✅ Token refreshed for user ${userId}`);
      } catch (refreshError) {
        console.error(`❌ Failed to refresh token for user ${userId}:`, refreshError);
        return { success: false, message: 'Calendar authentication expired. Please reconnect.' };
      }
    }

    // Set up Calendar API client
    oauth2Client.setCredentials(calendarTokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Determine if this is an appointment or todo
    const isAppointment = taskData.classification === 'appointment';
    
    if (isAppointment && taskData.startTime) {
      console.log(`📅 Creating calendar event for appointment: ${taskData.title}`);
      
      // Create calendar event for appointment
      const event: any = {
        summary: taskData.title,
        description: taskData.description || '',
        start: {
          dateTime: taskData.startTime,
          timeZone: userTimezone
        },
        end: {
          dateTime: taskData.endTime || new Date(new Date(taskData.startTime).getTime() + (taskData.duration || 60) * 60000).toISOString(),
          timeZone: userTimezone
        },
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 24 * 60 },
            { method: 'popup', minutes: 10 }
          ]
        },
        extendedProperties: {
          private: {
            taskId: taskId,
            tenantId: tenantId,
            crmTask: 'true'
          }
        }
      };

      // Add Google Meet for virtual meetings
      if (taskData.type === 'scheduled_meeting_virtual') {
        event.conferenceData = {
          createRequest: {
            requestId: `meet-${taskId}-${Date.now()}`,
            conferenceSolutionKey: {
              type: 'hangoutsMeet'
            }
          }
        };
      }

      // Add attendees if provided
      if (taskData.meetingAttendees && taskData.meetingAttendees.length > 0) {
        event.attendees = taskData.meetingAttendees.map((attendee: any) => ({
          email: attendee.email,
          displayName: attendee.displayName
        }));
      }

      const response = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: event,
        conferenceDataVersion: taskData.type === 'scheduled_meeting_virtual' ? 1 : 0
      });

      // Update task with calendar event ID and Google Meet info
      const updateData: any = {
        googleCalendarEventId: response.data.id,
        lastGoogleSync: new Date(),
        syncStatus: 'synced'
      };

      // Add Google Meet link if available
      if (response.data.conferenceData?.entryPoints) {
        const meetEntry = response.data.conferenceData.entryPoints.find((entry: any) => entry.entryPointType === 'video');
        if (meetEntry) {
          updateData.googleMeetLink = meetEntry.uri;
          updateData.googleMeetConferenceId = response.data.conferenceData.conferenceId;
        }
      }

      await db.collection('tenants').doc(tenantId).collection('tasks').doc(taskId).update(updateData);

      console.log(`✅ Task ${taskId} synced to Google Calendar successfully`);
      return {
        success: true,
        eventId: response.data.id,
        message: 'Task synced to Google Calendar'
      };
    } else {
      // For todos, we'll create a Google Task
      console.log(`📝 Syncing todo task ${taskId} to Google Tasks`);
      
      try {
        // Set up Tasks API client
        const tasks = google.tasks({ version: 'v1', auth: oauth2Client });
        
        // Get user's task lists
        const taskListsResponse = await tasks.tasklists.list();
        const taskLists = taskListsResponse.data.items || [];
        
        // Use the first available task list (usually "My Tasks")
        const taskListId = taskLists.length > 0 ? taskLists[0].id : '@default';
        
        // Create the task
        const taskBody = {
          title: taskData.title,
          notes: taskData.description || '',
          due: taskData.dueDate ? new Date(taskData.dueDate).toISOString() : undefined,
          status: taskData.status === 'completed' ? 'completed' : 'needsAction'
        };
        
        const response = await tasks.tasks.insert({
          tasklist: taskListId,
          requestBody: taskBody
        });
        
        // Update task with Google Tasks sync info
        const updateData = {
          googleTasksTaskId: response.data.id,
          googleTasksListId: taskListId,
          syncStatus: 'synced',
          lastGoogleSync: new Date()
        };
        
        await db.collection('tenants').doc(tenantId).collection('tasks').doc(taskId).update(updateData);
        
        console.log(`✅ Todo task ${taskId} synced to Google Tasks successfully`);
        return {
          success: true,
          taskId: response.data.id,
          message: 'Todo synced to Google Tasks'
        };
        
      } catch (tasksError) {
        console.error(`❌ Error syncing todo ${taskId} to Google Tasks:`, tasksError);
        
        // Update task with failed sync status
        await db.collection('tenants').doc(tenantId).collection('tasks').doc(taskId).update({
          syncStatus: 'failed',
          lastGoogleSync: new Date()
        });
        
        return {
          success: false,
          message: `Failed to sync todo to Google Tasks: ${tasksError instanceof Error ? tasksError.message : 'Unknown error'}`
        };
      }
    }

  } catch (error) {
    console.error(`❌ Error syncing task ${taskId} to Calendar:`, error);
    
    // Update task with failed sync status
    try {
      await db.collection('tenants').doc(tenantId).collection('tasks').doc(taskId).update({
        syncStatus: 'failed',
        lastGoogleSync: new Date()
      });
    } catch (updateError) {
      console.error('Failed to update task sync status:', updateError);
    }
    
    return {
      success: false,
      message: `Failed to sync task: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Update calendar event or Google Task when task is updated
 */
export async function updateGoogleSync(userId: string, tenantId: string, taskId: string, taskData: any) {
  try {
    // Get user's Calendar tokens
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    const userData = userDoc.data();
    const calendarTokens = userData?.calendarTokens;

    if (!calendarTokens?.access_token) {
      return { success: false, message: 'Google Calendar not connected' };
    }

    // Set up Calendar API client
    oauth2Client.setCredentials(calendarTokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Get the task to find the calendar event ID
    const taskDoc = await db.collection('tenants').doc(tenantId).collection('tasks').doc(taskId).get();
    if (!taskDoc.exists) {
      throw new Error('Task not found');
    }

    const task = taskDoc.data();
    const eventId = task?.googleCalendarEventId;
    const tasksTaskId = task?.googleTasksTaskId;
    const tasksListId = task?.googleTasksListId;

    // Update based on task classification
    if (taskData.classification === 'appointment' && eventId) {
      // Update calendar event for appointments
      const event = {
        summary: taskData.title,
        description: taskData.description || '',
        start: {
          dateTime: taskData.startTime,
          timeZone: 'America/Los_Angeles'
        },
        end: {
          dateTime: taskData.endTime || new Date(new Date(taskData.startTime).getTime() + (taskData.duration || 60) * 60000).toISOString(),
          timeZone: 'America/Los_Angeles'
        }
      };

      await calendar.events.update({
        calendarId: 'primary',
        eventId: eventId,
        requestBody: event
      });

      console.log(`✅ Calendar event updated for task ${taskId}`);
    } else if (taskData.classification === 'todo' && tasksTaskId && tasksListId) {
      // Update Google Task for todos
      const tasks = google.tasks({ version: 'v1', auth: oauth2Client });
      
      const taskBody = {
        title: taskData.title,
        notes: taskData.description || '',
        due: taskData.dueDate ? new Date(taskData.dueDate).toISOString() : undefined,
        status: taskData.status === 'completed' ? 'completed' : 'needsAction'
      };

      await tasks.tasks.update({
        tasklist: tasksListId,
        task: tasksTaskId,
        requestBody: taskBody
      });

      console.log(`✅ Google Task updated for task ${taskId}`);
    } else {
      return { success: false, message: 'Task not synced to Google yet' };
    }

    // Update task sync status
    await db.collection('tenants').doc(tenantId).collection('tasks').doc(taskId).update({
      lastGoogleSync: new Date(),
      syncStatus: 'synced'
    });

    return { success: true, message: 'Google sync updated' };

  } catch (error) {
    console.error('Error updating calendar event:', error);
    return {
      success: false,
      message: `Failed to update calendar event: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Delete calendar event or Google Task when task is deleted
 */
export async function deleteGoogleSync(userId: string, tenantId: string, taskId: string) {
  try {
    // Get user's Calendar tokens
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    const userData = userDoc.data();
    const calendarTokens = userData?.calendarTokens;

    if (!calendarTokens?.access_token) {
      return { success: false, message: 'Google Calendar not connected' };
    }

    // Set up Calendar API client
    oauth2Client.setCredentials(calendarTokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Get the task to find the calendar event ID
    const taskDoc = await db.collection('tenants').doc(tenantId).collection('tasks').doc(taskId).get();
    if (!taskDoc.exists) {
      throw new Error('Task not found');
    }

    const task = taskDoc.data();
    const eventId = task?.googleCalendarEventId;
    const tasksTaskId = task?.googleTasksTaskId;
    const tasksListId = task?.googleTasksListId;

    if (eventId) {
      // Delete calendar event
      await calendar.events.delete({
        calendarId: 'primary',
        eventId: eventId
      });
      console.log(`✅ Calendar event deleted for task ${taskId}`);
    }

    if (tasksTaskId && tasksListId) {
      // Delete Google Task
      const tasks = google.tasks({ version: 'v1', auth: oauth2Client });
      await tasks.tasks.delete({
        tasklist: tasksListId,
        task: tasksTaskId
      });
      console.log(`✅ Google Task deleted for task ${taskId}`);
    }

    // Update task sync status
    await db.collection('tenants').doc(tenantId).collection('tasks').doc(taskId).update({
      googleCalendarEventId: null,
      lastGoogleSync: new Date(),
      syncStatus: 'deleted'
    });

    return { success: true, message: 'Calendar event deleted' };

  } catch (error) {
    console.error('Error deleting calendar event:', error);
    return {
      success: false,
      message: `Failed to delete calendar event: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

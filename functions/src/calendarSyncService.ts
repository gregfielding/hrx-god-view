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
    console.log(`📋 Task data:`, {
      title: taskData.title,
      classification: taskData.classification,
      startTime: taskData.startTime,
      duration: taskData.duration,
      type: taskData.type,
      status: taskData.status
    });
    
    // Get user's Calendar tokens
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      console.log(`❌ User ${userId} not found`);
      return { success: false, message: 'User not found' };
    }

    const userData = userDoc.data();
    const calendarTokens = userData?.calendarTokens;

    console.log(`🔍 User calendar tokens check:`, {
      hasUserData: !!userData,
      hasCalendarTokens: !!calendarTokens,
      hasAccessToken: !!calendarTokens?.access_token,
      hasRefreshToken: !!calendarTokens?.refresh_token,
      expiryDate: calendarTokens?.expiry_date,
      isExpired: calendarTokens?.expiry_date ? new Date(calendarTokens.expiry_date) <= new Date() : 'unknown'
    });

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
    
    console.log(`🔍 Task classification check:`, {
      classification: taskData.classification,
      isAppointment,
      hasStartTime: !!taskData.startTime,
      startTime: taskData.startTime
    });
    
    if (isAppointment && taskData.startTime) {
      console.log(`📅 Creating calendar event for appointment: ${taskData.title}`);
      
      // Build rich description with all available task data
      let description = taskData.description || '';
      
      // Add notes if available
      if (taskData.notes && taskData.notes.trim()) {
        description += `\n\n📝 Notes: ${taskData.notes}`;
      }
      
      // Add agenda if available
      if (taskData.agenda && taskData.agenda.trim()) {
        description += `\n\n📋 Agenda: ${taskData.agenda}`;
      }
      
      // Add goals if available
      if (taskData.goals && taskData.goals.length > 0) {
        description += `\n\n🎯 Goals: ${taskData.goals.join(', ')}`;
      }
      
      // Add follow-up notes if available
      if (taskData.followUpNotes && taskData.followUpNotes.trim()) {
        description += `\n\n📌 Follow-up: ${taskData.followUpNotes}`;
      }
      
      // Add call script if available
      if (taskData.callScript && taskData.callScript.trim()) {
        description += `\n\n📞 Call Script: ${taskData.callScript}`;
      }
      
      // Add associated contacts if available
      if (taskData.associations?.contacts && taskData.associations.contacts.length > 0) {
        try {
          const contactIds = taskData.associations.contacts.map((c: any) => typeof c === 'string' ? c : c?.id).filter(Boolean);
          if (contactIds.length > 0) {
            const contactsSnapshot = await db.collection('tenants').doc(tenantId).collection('crm_contacts')
              .where('__name__', 'in', contactIds.slice(0, 10)) // Limit to 10 contacts
              .get();
            
            const contactNames = contactsSnapshot.docs.map(doc => {
              const data = doc.data();
              return data?.fullName || data?.firstName + ' ' + data?.lastName || 'Unknown Contact';
            });
            
            if (contactNames.length > 0) {
              description += `\n\n👥 Contacts: ${contactNames.join(', ')}`;
            }
          }
        } catch (error) {
          console.log('⚠️ Could not fetch contact names:', error.message);
        }
      }
      
      // Add associated companies if available
      if (taskData.associations?.companies && taskData.associations.companies.length > 0) {
        try {
          const companyIds = taskData.associations.companies.map((c: any) => typeof c === 'string' ? c : c?.id).filter(Boolean);
          if (companyIds.length > 0) {
            const companiesSnapshot = await db.collection('tenants').doc(tenantId).collection('crm_companies')
              .where('__name__', 'in', companyIds.slice(0, 5)) // Limit to 5 companies
              .get();
            
            const companyNames = companiesSnapshot.docs.map(doc => {
              const data = doc.data();
              return data?.companyName || data?.name || 'Unknown Company';
            });
            
            if (companyNames.length > 0) {
              description += `\n\n🏢 Companies: ${companyNames.join(', ')}`;
            }
          }
        } catch (error) {
          console.log('⚠️ Could not fetch company names:', error.message);
        }
      }
      
      // Add associated deals if available
      if (taskData.associations?.deals && taskData.associations.deals.length > 0) {
        try {
          const dealIds = taskData.associations.deals.map((d: any) => typeof d === 'string' ? d : d?.id).filter(Boolean);
          if (dealIds.length > 0) {
            const dealsSnapshot = await db.collection('tenants').doc(tenantId).collection('crm_deals')
              .where('__name__', 'in', dealIds.slice(0, 3)) // Limit to 3 deals
              .get();
            
            const dealNames = dealsSnapshot.docs.map(doc => {
              const data = doc.data();
              return data?.name || data?.title || 'Unknown Deal';
            });
            
            if (dealNames.length > 0) {
              description += `\n\n💼 Deals: ${dealNames.join(', ')}`;
            }
          }
        } catch (error) {
          console.log('⚠️ Could not fetch deal names:', error.message);
        }
      }
      
      // Add task metadata
      description += `\n\n---\n📊 Task Details:`;
      description += `\n• Type: ${taskData.type || 'N/A'}`;
      description += `\n• Category: ${taskData.category || 'N/A'}`;
      description += `\n• Priority: ${taskData.priority || 'N/A'}`;
      description += `\n• Status: ${taskData.status || 'N/A'}`;
      if (taskData.assignedToName) {
        description += `\n• Assigned to: ${taskData.assignedToName}`;
      }
      
      // Add tags if available
      if (taskData.tags && taskData.tags.length > 0) {
        description += `\n• Tags: ${taskData.tags.join(', ')}`;
      }
      
      // Add research topics if available
      if (taskData.researchTopics && taskData.researchTopics.length > 0) {
        description += `\n• Research: ${taskData.researchTopics.join(', ')}`;
      }
      
      // Create calendar event for appointment
      const event: any = {
        summary: taskData.title,
        description: description || `Task: ${taskData.title}`,
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

      console.log(`📤 Sending calendar event to Google:`, JSON.stringify(event, null, 2));

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
        console.log(`🎥 Adding Google Meet for virtual meeting`);
      }

      // Add attendees if provided
      if (taskData.meetingAttendees && taskData.meetingAttendees.length > 0) {
        event.attendees = taskData.meetingAttendees.map((attendee: any) => ({
          email: attendee.email,
          displayName: attendee.displayName
        }));
        console.log(`👥 Adding ${event.attendees.length} attendees to calendar event`);
      }

      const response = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: event,
        conferenceDataVersion: taskData.type === 'scheduled_meeting_virtual' ? 1 : 0
      });

      console.log(`📥 Google Calendar API response:`, {
        status: response.status,
        statusText: response.statusText,
        eventId: response.data.id,
        htmlLink: response.data.htmlLink,
        conferenceData: response.data.conferenceData
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
          console.log(`🔗 Google Meet link added: ${meetEntry.uri}`);
        }
      }

      console.log(`💾 Updating task with calendar sync data:`, updateData);
      await db.collection('tenants').doc(tenantId).collection('tasks').doc(taskId).update(updateData);

      console.log(`✅ Task ${taskId} synced to Google Calendar successfully`);
      return {
        success: true,
        eventId: response.data.id,
        message: 'Task synced to Google Calendar'
      };
    } else {
      console.log(`ℹ️ Task ${taskId} is not an appointment or missing startTime - skipping calendar sync`);
      console.log(`📋 Task details:`, {
        classification: taskData.classification,
        startTime: taskData.startTime,
        isAppointment,
        hasStartTime: !!taskData.startTime
      });
      
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

import { getFirestore } from 'firebase-admin/firestore';
import { google } from 'googleapis';

const db = getFirestore();

// Google Calendar API configuration - used for OAuth flow
// const CALENDAR_SCOPES = [
//   'https://www.googleapis.com/auth/calendar',
//   'https://www.googleapis.com/auth/calendar.events',
//   'https://www.googleapis.com/auth/calendar.settings.readonly'
// ] as const;

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

/**
 * Sync task to Google Calendar
 */
export async function syncTaskToCalendar(userId: string, tenantId: string, taskId: string, taskData: any) {
  try {
    // Get user's Calendar tokens
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    const userData = userDoc.data();
    const calendarTokens = userData?.calendarTokens;

    if (!calendarTokens?.access_token) {
      console.log('Google Calendar not connected for user:', userId);
      return { success: false, message: 'Google Calendar not connected' };
    }

    // Set up Calendar API client
    oauth2Client.setCredentials(calendarTokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Determine if this is an appointment or todo
    const isAppointment = taskData.classification === 'appointment';
    
    if (isAppointment && taskData.startTime) {
      // Create calendar event for appointment
      const event: any = {
        summary: taskData.title,
        description: taskData.description || '',
        start: {
          dateTime: taskData.startTime,
          timeZone: 'America/Los_Angeles'
        },
        end: {
          dateTime: taskData.endTime || new Date(new Date(taskData.startTime).getTime() + (taskData.duration || 60) * 60000).toISOString(),
          timeZone: 'America/Los_Angeles'
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

      return {
        success: true,
        eventId: response.data.id,
        message: 'Task synced to Google Calendar'
      };
    } else {
      // For todos, we'll create a Google Task instead
      // Note: Google Tasks API requires separate implementation
      console.log('Todo tasks will be implemented with Google Tasks API');
      
      return {
        success: true,
        message: 'Todo task sync to Google Tasks coming soon'
      };
    }

  } catch (error) {
    console.error('Error syncing task to Calendar:', error);
    return {
      success: false,
      message: `Failed to sync task: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Update calendar event when task is updated
 */
export async function updateCalendarEvent(userId: string, tenantId: string, taskId: string, taskData: any) {
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

    if (!eventId) {
      return { success: false, message: 'Task not synced to calendar yet' };
    }

    // Update calendar event
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

    // Update task sync status
    await db.collection('tenants').doc(tenantId).collection('tasks').doc(taskId).update({
      lastGoogleSync: new Date(),
      syncStatus: 'synced'
    });

    return { success: true, message: 'Calendar event updated' };

  } catch (error) {
    console.error('Error updating calendar event:', error);
    return {
      success: false,
      message: `Failed to update calendar event: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Delete calendar event when task is deleted
 */
export async function deleteCalendarEvent(userId: string, tenantId: string, taskId: string) {
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

    if (eventId) {
      // Delete calendar event
      await calendar.events.delete({
        calendarId: 'primary',
        eventId: eventId
      });
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

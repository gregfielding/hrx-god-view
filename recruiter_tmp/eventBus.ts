import { onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { createEvent, processEvents, cleanupOldEvents } from './utils/events';
import type { Event } from './types/recruiter.types';

/**
 * Creates an event in the event bus
 * Callable function for creating events from the frontend
 */
export const createEventFunction = onCall({
  cors: true,
  maxInstances: 10,
}, async (request) => {
  try {
    const { data } = request;
    const { eventData } = data;

    if (!eventData) {
      throw new Error('Event data is required');
    }

    // Validate that the user has permission to create events
    const { auth } = request;
    if (!auth) {
      throw new Error('Authentication required');
    }

    // Add user info to event data
    const eventWithUser = {
      ...eventData,
      createdBy: auth.uid,
      updatedBy: auth.uid,
    };

    const createdEvent = await createEvent(eventWithUser);

    return {
      success: true,
      event: createdEvent,
    };
  } catch (error) {
    console.error('Error in createEventFunction:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
});

/**
 * Processes events on a schedule
 * Runs every minute to process unprocessed events
 */
export const processEventsScheduled = onSchedule({
  schedule: 'every 1 minutes',
  maxInstances: 1,
}, async (event) => {
  try {
    console.log('Starting scheduled event processing...');
    await processEvents(10); // Process 10 events at a time
    console.log('Scheduled event processing completed.');
  } catch (error) {
    console.error('Error in processEventsScheduled:', error);
    throw error; // Let Firebase handle the retry
  }
});

/**
 * Cleans up old events on a schedule
 * Runs daily to remove old processed events
 */
export const cleanupEventsScheduled = onSchedule({
  schedule: '0 2 * * *', // Daily at 2 AM
  maxInstances: 1,
}, async (event) => {
  try {
    console.log('Starting scheduled event cleanup...');
    await cleanupOldEvents(30); // Keep 30 days of events
    console.log('Scheduled event cleanup completed.');
  } catch (error) {
    console.error('Error in cleanupEventsScheduled:', error);
    throw error; // Let Firebase handle the retry
  }
});

/**
 * Trigger function for when events are created
 * This can be used for immediate processing of critical events
 */
export const onEventCreated = onDocumentCreated({
  document: 'events/{eventId}',
  maxInstances: 10,
}, async (event) => {
  try {
    const eventData = event.data?.data() as Event;
    
    if (!eventData) {
      console.error('No event data found');
      return;
    }

    console.log(`Event created: ${event.id} (${eventData.type})`);

    if (eventData.type === 'crm.handoff.requested') {
      console.log('Critical handoff event detected - could trigger immediate processing');
    }
  } catch (error) {
    console.error('Error in onEventCreated:', error);
    throw error;
  }
});

/**
 * Manual event processing function
 * Callable function for manually triggering event processing
 */
export const processEventsManual = onCall({
  cors: true,
  maxInstances: 1,
}, async (request) => {
  try {
    const { data } = request;
    const { batchSize = 10 } = data;

    // Validate that the user has admin permissions
    const { auth } = request;
    if (!auth) {
      throw new Error('Authentication required');
    }

    // Check if user has admin role
    const userRole = (auth.token as any).role;
    if (!['HRX_Admin', 'Agency_Admin'].includes(userRole)) {
      throw new Error('Admin permissions required');
    }

    console.log(`Manual event processing triggered by ${auth.uid}`);
    
    const processedCount = await processEvents(batchSize);

    return {
      success: true,
      processedCount,
    };
  } catch (error) {
    console.error('Error in processEventsManual:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
});

/**
 * Get events for an entity
 * Callable function for retrieving events
 */
export const getEventsForEntity = onCall({
  cors: true,
  maxInstances: 10,
}, async (request) => {
  try {
    const { data } = request;
    const { tenantId, entityType, entityId, limit = 50 } = data;

    if (!tenantId || !entityType || !entityId) {
      throw new Error('Tenant ID, entity type, and entity ID are required');
    }

    // Validate that the user has access to this tenant
    const { auth } = request;
    if (!auth) {
      throw new Error('Authentication required');
    }

    const userTenantId = (auth.token as any).tenantId;
    if (userTenantId !== tenantId) {
      throw new Error('Access denied to this tenant');
    }

    const { getEventsForEntity: getEvents } = await import('./utils/events');
    const events = await getEvents(tenantId, entityType, entityId, limit);

    return {
      success: true,
      events,
    };
  } catch (error) {
    console.error('Error in getEventsForEntity:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
});

/**
 * Get events by type
 * Callable function for retrieving events by type
 */
export const getEventsByType = onCall({
  cors: true,
  maxInstances: 10,
}, async (request) => {
  try {
    const { data } = request;
    const { tenantId, eventType, limit = 50 } = data;

    if (!tenantId || !eventType) {
      throw new Error('Tenant ID and event type are required');
    }

    // Validate that the user has access to this tenant
    const { auth } = request;
    if (!auth) {
      throw new Error('Authentication required');
    }

    const userTenantId = (auth.token as any).tenantId;
    if (userTenantId !== tenantId) {
      throw new Error('Access denied to this tenant');
    }

    const { getEventsByType } = await import('./utils/events');
    const events = await getEventsByType(tenantId, eventType, limit);

    return {
      success: true,
      events,
    };
  } catch (error) {
    console.error('Error in getEventsByType:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
});

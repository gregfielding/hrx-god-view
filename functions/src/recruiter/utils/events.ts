import { getFirestore } from 'firebase-admin/firestore';
import { EventSchema } from '../types/zod/base.z';
import type { Event } from '../types/recruiter.types';

const db = getFirestore();

type NewEventInput = Omit<Event, 'createdAt' | 'updatedAt' | 'processed' | 'retryCount' | 'processedAt'> & {
  createdBy?: string;
  updatedBy?: string;
};

/**
 * Creates an event in the event bus
 * @param eventData - The event data to create
 * @returns Promise<Event & { id: string }>
 */
export const createEvent = async (eventData: NewEventInput): Promise<Event & { id: string }> => {
  try {
    // Validate event data
    const validatedEvent = EventSchema.parse({
      ...eventData,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: eventData.createdBy || 'system',
      updatedBy: eventData.updatedBy || 'system',
      processed: false,
      retryCount: 0,
    });

    // Check for existing event with same dedupeKey
    const existingEventQuery = await db
      .collection('events')
      .where('dedupeKey', '==', validatedEvent.dedupeKey)
      .where('tenantId', '==', validatedEvent.tenantId)
      .limit(1)
      .get();

    if (!existingEventQuery.empty) {
      console.log(`Event with dedupeKey ${validatedEvent.dedupeKey} already exists, skipping creation`);
      const existing = existingEventQuery.docs[0];
      return { ...(existing.data() as Event), id: existing.id };
    }

    // Create the event
    const eventRef = await db.collection('events').add(validatedEvent);
    const createdEvent = { ...validatedEvent, id: eventRef.id } as Event & { id: string };

    console.log(`Event created: ${eventRef.id} (${validatedEvent.type})`);
    return createdEvent;
  } catch (error) {
    console.error('Error creating event:', error);
    throw new Error(`Failed to create event: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Processes unprocessed events
 * @param batchSize - Number of events to process in one batch
 * @returns Promise<number> - Number of events processed
 */
export const processEvents = async (batchSize: number = 10): Promise<number> => {
  try {
    // Get unprocessed events
    const unprocessedEventsQuery = await db
      .collection('events')
      .where('processed', '==', false)
      .where('retryCount', '<', 3) // Max 3 retries
      .orderBy('retryCount')
      .orderBy('createdAt')
      .limit(batchSize)
      .get();

    if (unprocessedEventsQuery.empty) {
      console.log('No unprocessed events found');
      return 0;
    }

    let processedCount = 0;
    const batch = db.batch();

    for (const doc of unprocessedEventsQuery.docs) {
      const event = doc.data() as Event;
      
      try {
        // Process the event based on its type
        await processEventByType(event);
        
        // Mark as processed
        batch.update(doc.ref, {
          processed: true,
          processedAt: Date.now(),
          updatedAt: Date.now(),
        });
        
        processedCount++;
        console.log(`Event processed successfully: ${doc.id} (${event.type})`);
      } catch (error) {
        console.error(`Error processing event ${doc.id}:`, error);
        
        // Increment retry count
        const newRetryCount = (event.retryCount || 0) + 1;
        batch.update(doc.ref, {
          retryCount: newRetryCount,
          error: error instanceof Error ? error.message : 'Unknown error',
          updatedAt: Date.now(),
        });
        
        // If max retries reached, mark as failed
        if (newRetryCount >= 3) {
          batch.update(doc.ref, {
            processed: true, // Mark as processed to stop retrying
            processedAt: Date.now(),
          });
          console.error(`Event ${doc.id} failed after ${newRetryCount} retries`);
        }
      }
    }

    // Commit the batch
    await batch.commit();
    console.log(`Processed ${processedCount} events`);
    return processedCount;
  } catch (error) {
    console.error('Error processing events:', error);
    throw new Error(`Failed to process events: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Processes an event based on its type
 * @param event - The event to process
 */
const processEventByType = async (event: Event): Promise<void> => {
  switch (event.type) {
    case 'crm.handoff.requested':
      await processHandoffRequested(event);
      break;
    case 'company.updated':
      await processCompanyUpdated(event);
      break;
    case 'contact.linked':
      await processContactLinked(event);
      break;
    case 'jobOrder.created':
      await processJobOrderCreated(event);
      break;
    case 'candidate.created':
      await processCandidateCreated(event);
      break;
    case 'submittal.created':
      await processSubmittalCreated(event);
      break;
    case 'interview.scheduled':
      await processInterviewScheduled(event);
      break;
    case 'offer.created':
      await processOfferCreated(event);
      break;
    case 'placement.created':
      await processPlacementCreated(event);
      break;
    default:
      console.warn(`Unknown event type: ${event.type}`);
      throw new Error(`Unknown event type: ${event.type}`);
  }
};

/**
 * Process handoff requested event
 * @param event - The handoff event
 */
const processHandoffRequested = async (event: Event): Promise<void> => {
  console.log(`Processing handoff requested for deal: ${event.entityId}`);
  console.log('Handoff processing not yet implemented');
};

/**
 * Process company updated event
 * @param event - The company update event
 */
const processCompanyUpdated = async (event: Event): Promise<void> => {
  console.log(`Processing company update for company: ${event.entityId}`);
  console.log('Company update processing not yet implemented');
};

/**
 * Process contact linked event
 * @param event - The contact link event
 */
const processContactLinked = async (event: Event): Promise<void> => {
  console.log(`Processing contact linked for contact: ${event.entityId}`);
  console.log('Contact link processing not yet implemented');
};

/**
 * Process job order created event
 * @param event - The job order creation event
 */
const processJobOrderCreated = async (event: Event): Promise<void> => {
  console.log(`Processing job order created: ${event.entityId}`);
  console.log('Job order creation processing not yet implemented');
};

/**
 * Process candidate created event
 * @param event - The candidate creation event
 */
const processCandidateCreated = async (event: Event): Promise<void> => {
  console.log(`Processing candidate created: ${event.entityId}`);
  console.log('Candidate creation processing not yet implemented');
};

/**
 * Process submittal created event
 * @param event - The submittal creation event
 */
const processSubmittalCreated = async (event: Event): Promise<void> => {
  console.log(`Processing submittal created: ${event.entityId}`);
  console.log('Submittal creation processing not yet implemented');
};

/**
 * Process interview scheduled event
 * @param event - The interview scheduling event
 */
const processInterviewScheduled = async (event: Event): Promise<void> => {
  console.log(`Processing interview scheduled: ${event.entityId}`);
  console.log('Interview scheduling processing not yet implemented');
};

/**
 * Process offer created event
 * @param event - The offer creation event
 */
const processOfferCreated = async (event: Event): Promise<void> => {
  console.log(`Processing offer created: ${event.entityId}`);
  console.log('Offer creation processing not yet implemented');
};

/**
 * Process placement created event
 * @param event - The placement creation event
 */
const processPlacementCreated = async (event: Event): Promise<void> => {
  console.log(`Processing placement created: ${event.entityId}`);
  console.log('Placement creation processing not yet implemented');
};

/**
 * Gets events for a specific entity
 */
export const getEventsForEntity = async (
  tenantId: string,
  entityType: string,
  entityId: string,
  limit: number = 50
): Promise<(Event & { id: string })[]> => {
  try {
    const eventsQuery = await db
      .collection('events')
      .where('tenantId', '==', tenantId)
      .where('entityType', '==', entityType)
      .where('entityId', '==', entityId)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    return eventsQuery.docs.map(doc => ({ ...(doc.data() as Event), id: doc.id }));
  } catch (error) {
    console.error('Error getting events for entity:', error);
    throw new Error(`Failed to get events: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Gets events by type for a tenant
 */
export const getEventsByType = async (
  tenantId: string,
  eventType: string,
  limit: number = 50
): Promise<(Event & { id: string })[]> => {
  try {
    const eventsQuery = await db
      .collection('events')
      .where('tenantId', '==', tenantId)
      .where('type', '==', eventType)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    return eventsQuery.docs.map(doc => ({ ...(doc.data() as Event), id: doc.id }));
  } catch (error) {
    console.error('Error getting events by type:', error);
    throw new Error(`Failed to get events: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Cleans up old processed events
 */
export const cleanupOldEvents = async (daysToKeep: number = 30): Promise<number> => {
  try {
    const cutoffDate = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
    
    const oldEventsQuery = await db
      .collection('events')
      .where('processed', '==', true)
      .where('processedAt', '<', cutoffDate)
      .limit(1000) // Process in batches
      .get();

    if (oldEventsQuery.empty) {
      console.log('No old events to clean up');
      return 0;
    }

    const batch = db.batch();
    oldEventsQuery.docs.forEach(doc => {
      batch.delete(doc.ref);
    });

    await batch.commit();
    console.log(`Cleaned up ${oldEventsQuery.docs.length} old events`);
    return oldEventsQuery.docs.length;
  } catch (error) {
    console.error('Error cleaning up old events:', error);
    throw new Error(`Failed to cleanup events: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

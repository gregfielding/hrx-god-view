import { 
  collection, 
  doc, 
  query, 
  where, 
  getDocs,
  Timestamp,
  getDoc,
  setDoc,
  updateDoc,
  WriteBatch,
  orderBy,
  limit,
  startAfter
} from 'firebase/firestore';

import { db } from '../firebase';

// Helper function to safely convert timestamps
const safeTimestampToDate = (timestamp: any): Date => {
  try {
    if (timestamp?.toDate) {
      // Firestore Timestamp
      return timestamp.toDate();
    } else if (timestamp instanceof Date) {
      // Already a Date object
      return timestamp;
    } else if (typeof timestamp === 'number') {
      // Unix timestamp
      const date = new Date(timestamp);
      return isNaN(date.getTime()) ? new Date() : date;
    } else if (typeof timestamp === 'string') {
      // Date string
      const date = new Date(timestamp);
      return isNaN(date.getTime()) ? new Date() : date;
    } else {
      // Fallback to current date
      return new Date();
    }
  } catch (error) {
    console.warn('Invalid timestamp conversion:', timestamp, error);
    return new Date();
  }
};

export interface ActivityLog {
  id?: string;
  tenantId: string;
  entityType: 'contact' | 'deal' | 'company' | 'salesperson';
  entityId: string;
  activityType: 'email' | 'task' | 'note' | 'call' | 'meeting' | 'follow_up' | 'status_change' | 'custom';
  title: string;
  description: string;
  timestamp: Timestamp;
  userId: string;
  userName: string;
  
  // Related entities for cross-filtering
  relatedEntities?: {
    contacts?: string[];
    deals?: string[];
    companies?: string[];
  };
  
  // Metadata for AI context
  metadata?: {
    emailSubject?: string;
    emailFrom?: string;
    emailTo?: string[];
    taskStatus?: 'completed' | 'pending' | 'cancelled';
    taskType?: string;
    callDuration?: number;
    meetingType?: 'internal' | 'client' | 'prospect';
    sentiment?: 'positive' | 'neutral' | 'negative';
    priority?: 'low' | 'medium' | 'high';
    direction?: string;
    noteType?: string;
    tags?: string[];
    [key: string]: any;
  };
  
  // AI logging fields
  aiLogged?: boolean;
  aiContext?: string;
  aiInsights?: string[];
}

export interface ActivityQuery {
  tenantId: string;
  entityType?: 'contact' | 'deal' | 'company' | 'salesperson';
  entityId?: string;
  activityType?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}

export interface UnifiedActivityItem {
  id: string;
  type: 'email' | 'task' | 'note' | 'call' | 'meeting' | 'ai_activity';
  title: string;
  description: string;
  timestamp: Date;
  salespersonId?: string;
  salespersonName?: string;
  metadata?: {
    priority?: string;
    taskType?: string;
    from?: string;
    to?: string;
    direction?: string;
    subject?: string;
    status?: string;
    [key: string]: any;
  };
  source: 'tasks' | 'email_logs' | 'contact_notes' | 'ai_logs' | 'activities' | 'notes';
}

/**
 * Unified function to load contact activities from all sources
 * This ensures consistency across Last Activity column, Contact Activity Tab, and Contact Details Dashboard
 */
export async function loadContactActivities(
  tenantId: string, 
  contactId: string, 
  options: {
    limit?: number;
    includeTasks?: boolean;
    includeEmails?: boolean;
    includeNotes?: boolean;
    includeAIActivities?: boolean;
    onlyCompletedTasks?: boolean;
  } = {}
): Promise<UnifiedActivityItem[]> {
  const {
    limit: limitCount = 50,
    includeTasks = true,
    includeEmails = true,
    includeNotes = true,
    includeAIActivities = false,
    onlyCompletedTasks = true
  } = options;

  const activities: UnifiedActivityItem[] = [];

  // 1. Load completed tasks associated with this contact
  if (includeTasks) {
    try {
      const tasksRef = collection(db, 'tenants', tenantId, 'tasks');
      const tasksQuery = query(
        tasksRef,
        where('associations.contacts', 'array-contains', contactId),
        ...(onlyCompletedTasks ? [where('status', '==', 'completed')] : []),
        orderBy('updatedAt', 'desc'),
        limit(limitCount)
      );
      const tasksSnapshot = await getDocs(tasksQuery);
      
      tasksSnapshot.docs.forEach(doc => {
        const data = doc.data();
        activities.push({
          id: `task_${doc.id}`,
          type: 'task',
          title: data.title || 'Task completed',
          description: data.description || '',
          timestamp: safeTimestampToDate(data.completedAt || data.updatedAt),
          salespersonId: data.assignedTo || data.createdBy,
          metadata: { 
            priority: data.priority, 
            taskType: data.type,
            status: data.status
          },
          source: 'tasks'
        });
      });
    } catch (error) {
      console.warn('Failed to load tasks for contact:', error);
    }
  }

  // 2. Load email logs for this contact
  if (includeEmails) {
    try {
      const emailsRef = collection(db, 'tenants', tenantId, 'email_logs');
      const emailsQuery = query(
        emailsRef,
        where('contactId', '==', contactId),
        orderBy('timestamp', 'desc'),
        limit(limitCount)
      );
      const emailsSnapshot = await getDocs(emailsQuery);
      
      emailsSnapshot.docs.forEach(doc => {
        const data = doc.data();
        const direction = (data.direction || '').toLowerCase();
        const toList: string[] = Array.isArray(data.to)
          ? data.to
          : (typeof data.to === 'string' && data.to ? [data.to] : []);
        const toDisplay = toList.join(', ');
        const fromDisplay: string = typeof data.from === 'string' ? data.from : '';

        const description = direction === 'outbound'
          ? `Email sent to ${toDisplay || 'recipient'}`
          : `Email received from ${fromDisplay || 'sender'}`;

        activities.push({
          id: `email_${doc.id}`,
          type: 'email',
          title: `Email: ${data.subject || '(no subject)'}`,
          description,
          timestamp: safeTimestampToDate(data.timestamp),
          salespersonId: data.userId || data.salespersonId,
          metadata: { 
            from: data.from, 
            to: data.to, 
            direction: direction || 'sent',
            subject: data.subject,
            gmailMessageId: data.messageId
          },
          source: 'email_logs'
        });
      });
    } catch (error) {
      console.warn('Failed to load emails for contact:', error);
    }
  }

  // 3. Load notes for this contact
  if (includeNotes) {
    try {
      const notesRef = collection(db, 'tenants', tenantId, 'contact_notes');
      const notesQuery = query(
        notesRef,
        where('contactId', '==', contactId),
        orderBy('createdAt', 'desc'),
        limit(limitCount)
      );
      const notesSnapshot = await getDocs(notesQuery);
      
      notesSnapshot.docs.forEach(doc => {
        const data = doc.data();
        activities.push({
          id: `note_${doc.id}`,
          type: 'note',
          title: 'Note added',
          description: data.content || '',
          timestamp: safeTimestampToDate(data.createdAt || data.updatedAt),
          salespersonId: data.createdBy || data.userId,
          metadata: { 
            noteType: data.type || 'general'
          },
          source: 'contact_notes'
        });
      });
    } catch (error) {
      console.warn('Failed to load notes for contact:', error);
    }
  }

  // 4. Load AI activities (optional, due to permissions)
  if (includeAIActivities) {
    try {
      const aiRef = collection(db, 'tenants', tenantId, 'ai_logs');
      const aiQuery = query(
        aiRef,
        where('entityId', '==', contactId),
        where('entityType', '==', 'contact'),
        orderBy('timestamp', 'desc'),
        limit(limitCount)
      );
      const aiSnapshot = await getDocs(aiQuery);
      
      aiSnapshot.docs.forEach(doc => {
        const data = doc.data();
        activities.push({
          id: `ai_${doc.id}`,
          type: 'ai_activity',
          title: data.reason || 'AI Activity',
          description: data.aiResponse || '',
          timestamp: safeTimestampToDate(data.timestamp || data.createdAt),
          salespersonId: data.userId,
          metadata: { 
            eventType: data.eventType,
            aiTags: data.aiTags,
            urgencyScore: data.urgencyScore
          },
          source: 'ai_logs'
        });
      });
    } catch (error) {
      // Silently handle permission errors for ai_logs collection
      if (error.code === 'permission-denied' || error.message?.includes('permission')) {
        console.log('AI logs not accessible, skipping AI activities');
      } else {
        console.warn('Failed to load AI activities for contact:', error);
      }
    }
  }

  // Sort all activities by timestamp (newest first)
  activities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  return activities;
}

/**
 * Get the most recent activity for a contact (for Last Activity column)
 */
export async function getLastContactActivity(
  tenantId: string, 
  contactId: string
): Promise<UnifiedActivityItem | null> {
  const activities = await loadContactActivities(tenantId, contactId, {
    limit: 1,
    includeTasks: true,
    includeEmails: true,
    includeNotes: true,
    includeAIActivities: false
  });
  
  return activities.length > 0 ? activities[0] : null;
}

/**
 * Log a new activity
 */
export async function logActivity(activity: ActivityLog): Promise<void> {
  const activitiesRef = collection(db, 'tenants', activity.tenantId, 'activities');
  await setDoc(doc(activitiesRef), {
    ...activity,
    timestamp: activity.timestamp || Timestamp.now(),
    createdAt: Timestamp.now()
  });
}

/**
 * Log a task activity
 */
export async function logTaskActivity(
  tenantId: string,
  taskId: string,
  taskData: any,
  activityType: 'created' | 'completed' | 'updated' | 'assigned'
): Promise<void> {
  const activity: ActivityLog = {
    tenantId,
    entityType: 'contact',
    entityId: taskData.associations?.contacts?.[0] || '',
    activityType: 'task',
    title: `Task ${activityType}: ${taskData.title}`,
    description: taskData.description || '',
    timestamp: Timestamp.now(),
    userId: taskData.assignedTo || taskData.createdBy || '',
    userName: taskData.assignedToName || taskData.createdByName || '',
    relatedEntities: {
      contacts: taskData.associations?.contacts || [],
      deals: taskData.associations?.deals || [],
      companies: taskData.associations?.companies || []
    },
    metadata: {
      taskStatus: taskData.status,
      priority: taskData.priority,
      taskType: taskData.type
    }
  };

  await logActivity(activity);
}

/**
 * Log an email activity
 */
export async function logEmailActivity(
  tenantId: string,
  emailData: any
): Promise<void> {
  const activity: ActivityLog = {
    tenantId,
    entityType: 'contact',
    entityId: emailData.contactId || '',
    activityType: 'email',
    title: `Email ${emailData.direction || 'sent'}: ${emailData.subject}`,
    description: emailData.bodySnippet || emailData.snippet || '',
    timestamp: emailData.timestamp || Timestamp.now(),
    userId: emailData.userId || emailData.salespersonId || '',
    userName: emailData.userName || emailData.salespersonName || '',
    metadata: {
      emailSubject: emailData.subject,
      emailFrom: emailData.from,
      emailTo: emailData.to,
      direction: emailData.direction
    }
  };

  await logActivity(activity);
}

/**
 * Log a note activity
 */
export async function logNoteActivity(
  tenantId: string,
  noteData: any
): Promise<void> {
  const activity: ActivityLog = {
    tenantId,
    entityType: 'contact',
    entityId: noteData.contactId || '',
    activityType: 'note',
    title: 'Note added',
    description: noteData.content || '',
    timestamp: noteData.createdAt || Timestamp.now(),
    userId: noteData.createdBy || noteData.userId || '',
    userName: noteData.createdByName || noteData.userName || '',
    metadata: {
      noteType: noteData.type || 'general'
    }
  };

  await logActivity(activity);
}

/**
 * Unified function to load salesperson activities from all sources
 * This provides a comprehensive view of all activities performed by a salesperson
 */
export async function loadSalespersonActivities(
  tenantId: string, 
  salespersonId: string, 
  options: {
    limit?: number;
    includeTasks?: boolean;
    includeEmails?: boolean;
    includeNotes?: boolean;
    includeAIActivities?: boolean;
    includeCalls?: boolean;
    includeMeetings?: boolean;
    onlyCompletedTasks?: boolean;
    startDate?: Date;
    endDate?: Date;
  } = {}
): Promise<UnifiedActivityItem[]> {
  const {
    limit: limitCount = 50,
    includeTasks = true,
    includeEmails = true,
    includeNotes = true,
    includeAIActivities = false,
    includeCalls = true,
    includeMeetings = true,
    onlyCompletedTasks = true,
    startDate,
    endDate
  } = options;

  const activities: UnifiedActivityItem[] = [];

  // 1. Load tasks assigned to or created by this salesperson
  if (includeTasks) {
    try {
      const tasksRef = collection(db, 'tenants', tenantId, 'tasks');
      const tasksQuery = query(
        tasksRef,
        where('assignedTo', '==', salespersonId),
        ...(onlyCompletedTasks ? [where('status', '==', 'completed')] : []),
        ...(startDate ? [where('updatedAt', '>=', startDate)] : []),
        ...(endDate ? [where('updatedAt', '<=', endDate)] : []),
        orderBy('updatedAt', 'desc'),
        limit(limitCount)
      );
      const tasksSnapshot = await getDocs(tasksQuery);
      
      tasksSnapshot.docs.forEach(doc => {
        const data = doc.data();
        activities.push({
          id: `task_${doc.id}`,
          type: 'task',
          title: data.title || 'Task completed',
          description: data.description || '',
          timestamp: safeTimestampToDate(data.completedAt || data.updatedAt),
          salespersonId: data.assignedTo || data.createdBy,
          metadata: { 
            priority: data.priority, 
            taskType: data.type,
            classification: data.classification || 'todo',
            status: data.status,
            relatedContact: data.associations?.contacts?.[0],
            relatedDeal: data.associations?.deals?.[0],
            relatedCompany: data.associations?.companies?.[0]
          },
          source: 'tasks'
        });
      });
    } catch (error) {
      console.warn('Failed to load tasks for salesperson:', error);
    }
  }

  // 2. Load email logs sent by this salesperson (only CRM contact emails)
  if (includeEmails) {
    try {
      // Get all CRM contact IDs first for filtering
      const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
      const contactsSnapshot = await getDocs(contactsRef);
      const crmContactIds = new Set(contactsSnapshot.docs.map(doc => doc.id));
      console.log(`📧 Found ${crmContactIds.size} CRM contacts in tenant`);
      
      // Track processed emails to prevent duplicates
      const processedEmails = new Set<string>();
      let totalEmailsProcessed = 0;
      let totalEmailsIncluded = 0;
      
      // Use pagination to handle large email collections
      const emailsRef = collection(db, 'tenants', tenantId, 'email_logs');
      let lastDoc = null;
      const batchSize = 1000; // Stay well under Firestore's 10k limit
      
      while (totalEmailsProcessed < 5000) { // Cap at 5000 emails to prevent infinite loops
        const emailsQuery = query(
          emailsRef,
          where('userId', '==', salespersonId),
          where('contactId', '!=', null),
          ...(startDate ? [where('timestamp', '>=', startDate)] : []),
          ...(endDate ? [where('timestamp', '<=', endDate)] : []),
          orderBy('timestamp', 'desc'),
          limit(batchSize),
          ...(lastDoc ? [startAfter(lastDoc)] : [])
        );
        
        const emailsSnapshot = await getDocs(emailsQuery);
        
        if (emailsSnapshot.empty) {
          break; // No more emails to process
        }
        
        console.log(`📧 Processing batch of ${emailsSnapshot.docs.length} emails (total processed: ${totalEmailsProcessed})`);
        
        emailsSnapshot.docs.forEach(doc => {
          const data = doc.data();
          totalEmailsProcessed++;
          
          // Debug logging for first few emails
          if (totalEmailsProcessed <= 5) {
            console.log(`📧 Email ${totalEmailsProcessed}: contactId="${data.contactId}", subject="${data.subject}"`);
          }
          
          // Since we're filtering at the database level, just verify the contactId exists in CRM
          if (data.contactId && crmContactIds.has(data.contactId)) {
            
            // Create a more sophisticated unique key for deduplication
            // Use messageId if available, otherwise create a composite key
            let emailKey: string;
            
            if (data.messageId) {
              // If we have a messageId, use it as the primary key
              emailKey = data.messageId;
            } else {
              // Create a composite key using multiple fields to ensure uniqueness
              const timestamp = data.timestamp ? new Date(data.timestamp).getTime() : 0;
              const subject = (data.subject || '').trim().toLowerCase();
              const from = (data.from || '').trim().toLowerCase();
              const to = Array.isArray(data.to) ? data.to.join(',').toLowerCase() : (data.to || '').toLowerCase();
              const direction = (data.direction || '').toLowerCase();
              
              emailKey = `${timestamp}_${subject}_${from}_${to}_${direction}_${data.contactId}`;
            }
            
            // Check if we've already processed this email
            if (!processedEmails.has(emailKey)) {
              processedEmails.add(emailKey);
              totalEmailsIncluded++;
              
              activities.push({
                id: `email_${doc.id}`,
                type: 'email',
                title: `Email ${data.direction || 'sent'}: ${data.subject || 'No subject'}`,
                description: data.bodySnippet || data.snippet || '',
                timestamp: safeTimestampToDate(data.timestamp),
                salespersonId: data.userId || data.salespersonId,
                metadata: {
                  from: data.from,
                  to: data.to,
                  direction: data.direction,
                  subject: data.subject,
                  contactId: data.contactId,
                  dealId: data.dealId,
                  messageId: data.messageId,
                  gmailMessageId: data.gmailMessageId,
                  bodySnippet: data.bodySnippet || '',
                  body: data.bodySnippet || data.body || data.snippet || data.content || '',
                },
                source: 'email_logs'
              });
            } else {
              console.log(`📧 Skipping duplicate email: ${data.subject} (${data.timestamp})`);
            }
          }
        });
        
        // Update lastDoc for next iteration
        lastDoc = emailsSnapshot.docs[emailsSnapshot.docs.length - 1];
        
        // If we got fewer docs than batchSize, we've reached the end
        if (emailsSnapshot.docs.length < batchSize) {
          break;
        }
      }
      
      console.log(`📧 Total emails processed: ${totalEmailsProcessed}, included ${totalEmailsIncluded} emails with valid CRM contactId`);
    } catch (error) {
      console.warn('Failed to load emails for salesperson:', error);
    }
  }

  // 3. Load notes created by this salesperson
  if (includeNotes) {
    try {
      // Load notes from the main 'notes' collection (used by deals, contacts, etc.)
      const notesRef = collection(db, 'tenants', tenantId, 'notes');
      const notesQuery = query(
        notesRef,
        where('authorId', '==', salespersonId), // Use authorId instead of createdBy
        ...(startDate ? [where('timestamp', '>=', startDate)] : []),
        ...(endDate ? [where('timestamp', '<=', endDate)] : []),
        orderBy('timestamp', 'desc'),
        limit(limitCount)
      );
      const notesSnapshot = await getDocs(notesQuery);
      
      notesSnapshot.docs.forEach(doc => {
        const data = doc.data();
        activities.push({
          id: `note_${doc.id}`,
          type: 'note',
          title: data.category ? `Note (${data.category})` : 'Note added',
          description: data.content || '',
          timestamp: safeTimestampToDate(data.timestamp),
          salespersonId: data.authorId,
          metadata: {
            noteType: data.category || 'general',
            entityType: data.entityType,
            entityId: data.entityId,
            authorName: data.authorName,
            priority: data.priority,
            source: data.source
          },
          source: 'notes'
        });
      });

      // Also load notes from the legacy 'contact_notes' collection if it exists
      try {
        const contactNotesRef = collection(db, 'tenants', tenantId, 'contact_notes');
        const contactNotesQuery = query(
          contactNotesRef,
          where('createdBy', '==', salespersonId),
          ...(startDate ? [where('createdAt', '>=', startDate)] : []),
          ...(endDate ? [where('createdAt', '<=', endDate)] : []),
          orderBy('createdAt', 'desc'),
          limit(limitCount)
        );
        const contactNotesSnapshot = await getDocs(contactNotesQuery);
        
        contactNotesSnapshot.docs.forEach(doc => {
          const data = doc.data();
          activities.push({
            id: `contact_note_${doc.id}`,
            type: 'note',
            title: 'Note added',
            description: data.content || '',
            timestamp: safeTimestampToDate(data.createdAt),
            salespersonId: data.createdBy,
            metadata: {
              noteType: data.type || 'general',
              contactId: data.contactId,
              dealId: data.dealId
            },
            source: 'contact_notes'
          });
        });
      } catch (contactNotesError) {
        // Silently ignore if contact_notes collection doesn't exist
        console.debug('Contact notes collection not available:', contactNotesError.message);
      }
    } catch (error) {
      console.warn('Failed to load notes for salesperson:', error);
    }
  }

  // 4. Load AI activities for this salesperson
  if (includeAIActivities) {
    try {
      const aiLogsRef = collection(db, 'tenants', tenantId, 'ai_logs');
      const aiLogsQuery = query(
        aiLogsRef,
        where('userId', '==', salespersonId),
        ...(startDate ? [where('timestamp', '>=', startDate)] : []),
        ...(endDate ? [where('timestamp', '<=', endDate)] : []),
        orderBy('timestamp', 'desc'),
        limit(limitCount)
      );
      const aiLogsSnapshot = await getDocs(aiLogsQuery);
      
      aiLogsSnapshot.docs.forEach(doc => {
        const data = doc.data();
        activities.push({
          id: `ai_${doc.id}`,
          type: 'ai_activity',
          title: data.title || 'AI Activity',
          description: data.description || '',
          timestamp: safeTimestampToDate(data.timestamp),
          salespersonId: data.userId,
          metadata: {
            entityType: data.entityType,
            entityId: data.entityId,
            activityType: data.activityType
          },
          source: 'ai_logs'
        });
      });
    } catch (error) {
      console.warn('Failed to load AI activities for salesperson:', error);
    }
  }

  // 5. Load call activities (from activity_logs - if collection exists)
  if (includeCalls) {
    try {
      const activityLogsRef = collection(db, 'tenants', tenantId, 'activity_logs');
      const callsQuery = query(
        activityLogsRef,
        where('userId', '==', salespersonId),
        where('activityType', '==', 'call'),
        ...(startDate ? [where('timestamp', '>=', startDate)] : []),
        ...(endDate ? [where('timestamp', '<=', endDate)] : []),
        orderBy('timestamp', 'desc'),
        limit(limitCount)
      );
      const callsSnapshot = await getDocs(callsQuery);
      
      callsSnapshot.docs.forEach(doc => {
        const data = doc.data();
        activities.push({
          id: `call_${doc.id}`,
          type: 'call',
          title: data.title || 'Call made',
          description: data.description || '',
          timestamp: safeTimestampToDate(data.timestamp),
          salespersonId: data.userId,
          metadata: {
            duration: data.metadata?.callDuration,
            contactId: data.entityId,
            entityType: data.entityType
          },
          source: 'activities'
        });
      });
    } catch (error) {
      // Silently ignore if collection doesn't exist or has permission issues
      // This is expected since calls/meetings might not be implemented yet
      console.debug('Calls collection not available or empty:', error.message);
    }
  }

  // 6. Load meeting activities (from activity_logs - if collection exists)
  if (includeMeetings) {
    try {
      const activityLogsRef = collection(db, 'tenants', tenantId, 'activity_logs');
      const meetingsQuery = query(
        activityLogsRef,
        where('userId', '==', salespersonId),
        where('activityType', '==', 'meeting'),
        ...(startDate ? [where('timestamp', '>=', startDate)] : []),
        ...(endDate ? [where('timestamp', '<=', endDate)] : []),
        orderBy('timestamp', 'desc'),
        limit(limitCount)
      );
      const meetingsSnapshot = await getDocs(meetingsQuery);
      
      meetingsSnapshot.docs.forEach(doc => {
        const data = doc.data();
        activities.push({
          id: `meeting_${doc.id}`,
          type: 'meeting',
          title: data.title || 'Meeting held',
          description: data.description || '',
          timestamp: safeTimestampToDate(data.timestamp),
          salespersonId: data.userId,
          metadata: {
            meetingType: data.metadata?.meetingType,
            contactId: data.entityId,
            entityType: data.entityType
          },
          source: 'activities'
        });
      });
    } catch (error) {
      // Silently ignore if collection doesn't exist or has permission issues
      // This is expected since calls/meetings might not be implemented yet
      console.debug('Meetings collection not available or empty:', error.message);
    }
  }

  // Sort all activities by timestamp (most recent first)
  activities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  // Final deduplication pass - remove any remaining duplicates based on content similarity
  const finalActivities: UnifiedActivityItem[] = [];
  const seenActivities = new Set<string>();

  activities.forEach(activity => {
    // Create a unique identifier for this activity
    let activityKey: string;
    
    if (activity.source === 'email_logs') {
      // For emails, use a combination of subject, timestamp, and contactId
      const subject = (activity.metadata?.subject || '').trim().toLowerCase();
      const timestamp = activity.timestamp ? activity.timestamp.getTime() : 0;
      const contactId = activity.metadata?.contactId || '';
      const direction = activity.metadata?.direction || '';
      
      activityKey = `email_${subject}_${timestamp}_${contactId}_${direction}`;
    } else {
      // For other activities, use type, title, timestamp, and salespersonId
      const title = (activity.title || '').trim().toLowerCase();
      const timestamp = activity.timestamp ? activity.timestamp.getTime() : 0;
      
      activityKey = `${activity.type}_${title}_${timestamp}_${activity.salespersonId}`;
    }
    
    if (!seenActivities.has(activityKey)) {
      seenActivities.add(activityKey);
      finalActivities.push(activity);
    } else {
      console.log(`🔄 Final deduplication: Skipping duplicate activity: ${activity.title}`);
    }
  });

  console.log(`📊 Final deduplication: ${activities.length} activities → ${finalActivities.length} unique activities`);

  // Apply limit to final result
  return finalActivities.slice(0, limitCount);
}

/**
 * Get the last activity for a salesperson (for dashboard display)
 */
export async function getLastSalespersonActivity(
  tenantId: string, 
  salespersonId: string
): Promise<UnifiedActivityItem | null> {
  const activities = await loadSalespersonActivities(tenantId, salespersonId, {
    limit: 1,
    includeTasks: true,
    includeEmails: true,
    includeNotes: true,
    includeAIActivities: false,
    includeCalls: true,
    includeMeetings: true,
    onlyCompletedTasks: true
  });

  return activities.length > 0 ? activities[0] : null;
}

/**
 * Get salesperson activity summary (counts by type)
 */
export async function getSalespersonActivitySummary(
  tenantId: string,
  salespersonId: string,
  startDate?: Date,
  endDate?: Date
): Promise<{
  totalActivities: number;
  todosCompleted: number;
  emailsSent: number;
  appointmentsHeld: number;
  notesCreated: number;
  lastActivityDate?: Date;
}> {
  const activities = await loadSalespersonActivities(tenantId, salespersonId, {
    limit: 5000, // Get all activities within date range
    includeTasks: true,
    includeEmails: true,
    includeNotes: true,
    includeAIActivities: false,
    includeCalls: true,
    includeMeetings: true,
    onlyCompletedTasks: true,
    startDate,
    endDate
  });

  // Helper function to get activity category
  const getActivityCategory = (activity: UnifiedActivityItem): string => {
    if (activity.source === 'email_logs') return 'emails';
    if (activity.source === 'contact_notes') return 'notes';
    if (activity.source === 'tasks') {
      const taskData = activity as any;
      return taskData.metadata?.classification === 'appointment' ? 'appointments' : 'todos';
    }
    return 'todos';
  };

  const summary = {
    totalActivities: activities.length,
    todosCompleted: activities.filter(a => getActivityCategory(a) === 'todos').length,
    emailsSent: activities.filter(a => getActivityCategory(a) === 'emails').length,
    appointmentsHeld: activities.filter(a => getActivityCategory(a) === 'appointments').length,
    notesCreated: activities.filter(a => getActivityCategory(a) === 'notes').length,
    lastActivityDate: activities.length > 0 ? activities[0].timestamp : undefined
  };

  return summary;
}
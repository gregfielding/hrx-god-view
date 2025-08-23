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
  limit
} from 'firebase/firestore';

import { db } from '../firebase';

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
  source: 'tasks' | 'email_logs' | 'contact_notes' | 'ai_logs' | 'activities';
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
          timestamp: data.completedAt ? new Date(data.completedAt) : (data.updatedAt?.toDate?.() || new Date()),
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
        activities.push({
          id: `email_${doc.id}`,
          type: 'email',
          title: `Email: ${data.subject || '(no subject)'}`,
          description: `Email ${data.direction === 'outbound' ? 'sent to' : 'received from'} ${Array.isArray(data.to) ? data.to.join(', ') : data.to || 'recipients'}`,
          timestamp: data.timestamp?.toDate?.() || new Date(),
          salespersonId: data.userId || data.salespersonId,
          metadata: { 
            from: data.from, 
            to: data.to, 
            direction: data.direction || 'sent',
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
          timestamp: data.createdAt?.toDate?.() || data.updatedAt?.toDate?.() || new Date(),
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
          timestamp: data.timestamp?.toDate?.() || data.createdAt?.toDate?.() || new Date(),
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